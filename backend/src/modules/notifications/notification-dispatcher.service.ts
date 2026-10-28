import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import {
  PUSH_PROVIDER,
  PushProvider,
  PushSendResult,
} from './providers/push.provider';

type NotificationStatus =
  | 'queued'
  | 'processing'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'cancelled';

type PersistedNotification = {
  id: string;
  profile_id: string;
  order_id?: string | null;
  notification_type?: string | null;
  event_type?: string | null;
  title: string;
  body?: string | null;
  message?: string | null;
  data?: unknown;
  status: NotificationStatus;
};

type DeviceToken = {
  id: string;
  push_token: string;
};

type DeviceDeliveryResult = {
  deviceTokenId: string;
  status: 'sent' | 'failed';
  providerMessageId?: string;
  reason?: string;
  errorCode?: string;
};

export type NotificationDispatchResult = {
  notificationId: string;
  dispatched: boolean;
  status: NotificationStatus;
  attemptedDeviceCount: number;
  sentCount: number;
  failedCount: number;
  reason?: string;
};

function toPushData(notification: PersistedNotification) {
  const result: Record<string, string> = {
    notificationId: notification.id,
  };
  const notificationType =
    notification.notification_type ?? notification.event_type;

  if (notificationType) {
    result.notificationType = notificationType;
  }

  if (
    typeof notification.data !== 'object' ||
    notification.data === null ||
    Array.isArray(notification.data)
  ) {
    return result;
  }

  for (const [key, value] of Object.entries(notification.data)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (typeof value === 'string') {
      result[key] = value;
      continue;
    }

    try {
      result[key] = JSON.stringify(value);
    } catch {
      // A malformed optional data value must not block the notification itself.
    }
  }

  return result;
}

function failedProviderResult(): PushSendResult {
  return { ok: false, reason: 'provider_error' };
}

@Injectable()
export class NotificationDispatcher implements OnModuleInit, OnModuleDestroy {
  private queueInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly supabase: SupabaseService,
    @Inject(PUSH_PROVIDER) private readonly pushProvider: PushProvider,
  ) {}

  onModuleInit() {
    this.supabase.setNotificationDispatcher((id) => this.dispatchPersisted(id));
    // Start periodic background worker to reliably consume queued notifications
    this.queueInterval = setInterval(() => {
      this.processPendingQueue().catch(() => {});
    }, 20000);
  }

  onModuleDestroy() {
    if (this.queueInterval) {
      clearInterval(this.queueInterval);
      this.queueInterval = null;
    }
  }

  async processPendingQueue(limit = 20): Promise<number> {
    try {
      // Prioritize freshly queued notifications first
      const { data: queuedData, error: queuedError } = await this.db()
        .from('notifications')
        .select('id')
        .eq('status', 'queued')
        .order('created_at', { ascending: true })
        .limit(limit);

      let processedCount = 0;
      if (!queuedError && queuedData && queuedData.length > 0) {
        for (const row of queuedData) {
          try {
            const res = await this.dispatchPersisted(row.id);
            if (res.dispatched) processedCount++;
          } catch {
            // Individual failure must not block the queue
          }
        }
        return processedCount;
      }

      // If no queued notifications exist, attempt retry for recent failed notifications only (past 24h)
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: failedData, error: failedError } = await this.db()
        .from('notifications')
        .select('id')
        .eq('status', 'failed')
        .gte('created_at', oneDayAgo)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (!failedError && failedData && failedData.length > 0) {
        for (const row of failedData) {
          try {
            const res = await this.dispatchPersisted(row.id);
            if (res.dispatched) processedCount++;
          } catch {
            // Individual failure must not block the queue
          }
        }
      }

      return processedCount;
    } catch {
      return 0;
    }
  }

  async getDiagnosticOverview() {
    const [queuedRes, sentRes, failedRes, devicesRes] = await Promise.allSettled([
      this.db().from('notifications').select('id', { count: 'exact', head: true }).eq('status', 'queued'),
      this.db().from('notifications').select('id', { count: 'exact', head: true }).eq('status', 'sent'),
      this.db().from('notifications').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
      this.db().from('device_tokens').select('id', { count: 'exact', head: true }).eq('is_active', true),
    ]);

    return {
      providerConfigured: this.pushProvider.configured,
      activeDevices: devicesRes.status === 'fulfilled' ? (devicesRes.value as any).count ?? 0 : 0,
      queuedNotifications: queuedRes.status === 'fulfilled' ? (queuedRes.value as any).count ?? 0 : 0,
      sentNotifications: sentRes.status === 'fulfilled' ? (sentRes.value as any).count ?? 0 : 0,
      failedNotifications: failedRes.status === 'fulfilled' ? (failedRes.value as any).count ?? 0 : 0,
      workerActive: Boolean(this.queueInterval),
    };
  }

  private db() {
    return this.supabase.admin;
  }

  async dispatchPersisted(
    notificationId: string,
  ): Promise<NotificationDispatchResult> {
    const { data, error } = await this.db()
      .from('notifications')
      .select('*')
      .eq('id', notificationId)
      .maybeSingle();

    if (error) {
      throw new BadRequestException('Unable to load notification');
    }

    const notification = data as PersistedNotification | null;
    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    if (notification.status !== 'queued' && notification.status !== 'failed') {
      return {
        notificationId,
        dispatched: false,
        status: notification.status,
        attemptedDeviceCount: 0,
        sentCount: 0,
        failedCount: 0,
        reason: 'not_dispatchable',
      };
    }

    const { data: claimed, error: claimError } = await this.db()
      .from('notifications')
      .update({ status: 'processing' })
      .eq('id', notificationId)
      .eq('status', notification.status)
      .select('*')
      .maybeSingle();

    if (claimError) {
      throw new BadRequestException('Unable to claim notification delivery');
    }

    if (!claimed) {
      return {
        notificationId,
        dispatched: false,
        status: 'processing',
        attemptedDeviceCount: 0,
        sentCount: 0,
        failedCount: 0,
        reason: 'already_claimed',
      };
    }

    const claimedNotification = claimed as PersistedNotification;
    const { data: preferences, error: preferencesError } = await this.db()
      .from('notification_preferences')
      .select('push_enabled')
      .eq('profile_id', claimedNotification.profile_id)
      .maybeSingle();

    if (preferencesError) {
      await this.finish(claimedNotification, 'failed', [], 'preferences_unavailable');
      throw new BadRequestException('Unable to load notification preferences');
    }

    if (preferences?.push_enabled === false) {
      return this.finish(claimedNotification, 'cancelled', [], 'push_disabled');
    }

    const { data: devices, error: devicesError } = await this.db()
      .from('device_tokens')
      .select('id,push_token')
      .eq('profile_id', claimedNotification.profile_id)
      .eq('is_active', true);

    if (devicesError) {
      await this.finish(claimedNotification, 'failed', [], 'devices_unavailable');
      throw new BadRequestException('Unable to load active device tokens');
    }

    const activeDevices = (devices ?? []) as DeviceToken[];
    console.log('[RECIPIENT_RESOLVED]', {
      notificationId: claimedNotification.id,
      recipientProfileId: claimedNotification.profile_id,
      activeDeviceCount: activeDevices.length,
    });

    if (activeDevices.length === 0) {
      return this.finish(
        claimedNotification,
        'failed',
        [],
        'no_active_devices',
      );
    }

    const pushData = toPushData(claimedNotification);
    const deliveryResults = await Promise.all(
      activeDevices.map(async (device): Promise<DeviceDeliveryResult> => {
        const maskedToken = device.push_token ? `${device.push_token.slice(0, 10)}...` : null;

        console.log('[FCM_TOKEN_FOUND]', {
          notificationId: claimedNotification.id,
          orderId: claimedNotification.order_id || null,
          recipientProfileId: claimedNotification.profile_id,
          deviceTokenId: device.id,
          tokenPreview: maskedToken,
        });

        console.log('[FCM_SEND_STARTED]', {
          notificationId: claimedNotification.id,
          orderId: claimedNotification.order_id || null,
          recipientProfileId: claimedNotification.profile_id,
          deviceTokenId: device.id,
          notificationType: claimedNotification.notification_type || claimedNotification.event_type,
          tokenPreview: maskedToken,
        });

        let result: PushSendResult = failedProviderResult();
        const maxAttempts = 2;

        for (let attempt = 0; attempt <= maxAttempts; attempt++) {
          try {
            result = await this.pushProvider.send({
              token: device.push_token,
              title: claimedNotification.title,
              body:
                claimedNotification.body ?? claimedNotification.message ?? '',
              data: pushData,
            });
          } catch {
            result = failedProviderResult();
          }

          if (result.ok || result.reason !== 'transient' || attempt === maxAttempts) {
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
        }

        if (result.ok) {
          console.log('[FCM_SEND_ACCEPTED]', {
            notificationId: claimedNotification.id,
            orderId: claimedNotification.order_id || null,
            recipientProfileId: claimedNotification.profile_id,
            deviceTokenId: device.id,
            tokenPreview: maskedToken,
            providerMessageId: result.providerMessageId,
          });
          return {
            deviceTokenId: device.id,
            status: 'sent',
            providerMessageId: result.providerMessageId,
          };
        }

        console.warn('[FCM_SEND_FAILED]', {
          notificationId: claimedNotification.id,
          orderId: claimedNotification.order_id || null,
          recipientProfileId: claimedNotification.profile_id,
          deviceTokenId: device.id,
          tokenPreview: maskedToken,
          reason: result.reason,
          errorCode: result.errorCode,
        });

        return {
          deviceTokenId: device.id,
          status: 'failed',
          reason: result.reason,
          ...(result.errorCode ? { errorCode: result.errorCode } : {}),
        };
      }),
    );

    const invalidTokenIds = deliveryResults
      .filter((result) => result.reason === 'invalid_token')
      .map((result) => result.deviceTokenId);

    if (invalidTokenIds.length > 0) {
      for (const invalidId of invalidTokenIds) {
        console.log('[INVALID_TOKEN_DEACTIVATED]', {
          deviceTokenId: invalidId,
          recipientProfileId: claimedNotification.profile_id,
        });
      }

      const { error: deactivateError } = await this.db()
        .from('device_tokens')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .in('id', invalidTokenIds);

      if (deactivateError) {
        await this.finish(
          claimedNotification,
          'failed',
          deliveryResults,
          'token_deactivation_failed',
        );
        throw new BadRequestException('Unable to deactivate invalid device tokens');
      }
    }

    const sentCount = deliveryResults.filter(
      (result) => result.status === 'sent',
    ).length;

    return this.finish(
      claimedNotification,
      sentCount > 0 ? 'sent' : 'failed',
      deliveryResults,
    );
  }

  private async finish(
    notification: PersistedNotification,
    status: NotificationStatus,
    results: DeviceDeliveryResult[],
    reason?: string,
  ): Promise<NotificationDispatchResult> {
    const { data: previousAttempt, error: attemptReadError } = await this.db()
      .from('notification_delivery_attempts')
      .select('attempt_number')
      .eq('notification_id', notification.id)
      .order('attempt_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (attemptReadError) {
      throw new BadRequestException('Unable to inspect notification attempts');
    }

    const sentCount = results.filter((result) => result.status === 'sent').length;
    const failedCount = results.filter(
      (result) => result.status === 'failed',
    ).length;
    const providerResponse = {
      provider: 'fcm',
      configured: this.pushProvider.configured,
      attemptedDeviceCount: results.length,
      sentCount,
      failedCount,
      ...(reason ? { reason } : {}),
      devices: results,
    };

    const { error: attemptError } = await this.db()
      .from('notification_delivery_attempts')
      .insert({
        notification_id: notification.id,
        attempt_number: Number(previousAttempt?.attempt_number ?? 0) + 1,
        provider_response: providerResponse,
        status,
      });

    if (attemptError) {
      throw new BadRequestException('Unable to record notification attempt');
    }

    const { error: statusError } = await this.db()
      .from('notifications')
      .update({ status })
      .eq('id', notification.id)
      .eq('status', 'processing');

    if (statusError) {
      throw new BadRequestException('Unable to update notification status');
    }

    return {
      notificationId: notification.id,
      dispatched: true,
      status,
      attemptedDeviceCount: results.length,
      sentCount,
      failedCount,
      ...(reason ? { reason } : {}),
    };
  }
}
