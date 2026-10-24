import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
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
export class NotificationDispatcher implements OnModuleInit {
  constructor(
    private readonly supabase: SupabaseService,
    @Inject(PUSH_PROVIDER) private readonly pushProvider: PushProvider,
  ) {}

  onModuleInit() {
    this.supabase.setNotificationDispatcher((id) => this.dispatchPersisted(id));
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
        let result: PushSendResult;

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

        if (result.ok) {
          return {
            deviceTokenId: device.id,
            status: 'sent',
            providerMessageId: result.providerMessageId,
          };
        }

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
