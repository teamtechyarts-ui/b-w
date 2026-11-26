import { randomUUID } from 'node:crypto';
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

const QUEUE_POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes safety-net sweep (event-driven is primary)
const FAILED_RETRY_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes max frequency for transient failed retries
const LEASE_NAME = 'notification_queue_sweep';
const LEASE_TTL_SECONDS = 360; // 6 minutes
const LEASE_RENEWAL_INTERVAL_MS = 120 * 1000; // 2 minutes renewal while long-running sweep is active
const MAX_RETRY_ATTEMPTS = 3;
const PERMANENT_FAILURE_REASONS = new Set([
  'no_active_devices',
  'push_disabled',
  'provider_not_configured',
  'invalid_token',
]);

export function shouldRunBackgroundQueueWorker(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const explicitFlag = env.NOTIFICATION_QUEUE_WORKER?.trim().toLowerCase();
  if (explicitFlag === 'false') {
    return false;
  }
  if (explicitFlag === 'true') {
    return true;
  }

  const designatedId = env.NOTIFICATION_PRIMARY_WORKER_ID?.trim();
  if (designatedId) {
    const currentId = (
      env.NOTIFICATION_WORKER_ID ??
      env.NODE_APP_INSTANCE ??
      env.PM2_INSTANCE_ID ??
      env.HOSTNAME ??
      ''
    ).trim();
    return currentId === designatedId;
  }

  const instanceId = (env.NODE_APP_INSTANCE ?? env.PM2_INSTANCE_ID)?.trim();
  if (instanceId !== undefined && instanceId !== '') {
    return instanceId === '0';
  }

  return true;
}

@Injectable()
export class NotificationDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly workerId: string = randomUUID();
  private queueInterval: NodeJS.Timeout | null = null;
  private isProcessingQueue = false;
  private lastFailedRetryAt = 0;
  private holdsLease = false;

  constructor(
    private readonly supabase: SupabaseService,
    @Inject(PUSH_PROVIDER) private readonly pushProvider: PushProvider,
  ) {}

  getWorkerId(): string {
    return this.workerId;
  }

  onModuleInit() {
    this.onModuleDestroy();
    // Preserve event-driven notification dispatch on every backend instance.
    this.supabase.setNotificationDispatcher((id) => this.dispatchPersisted(id));

    const backgroundWorkerEnabled = shouldRunBackgroundQueueWorker();
    console.log('[NOTIFICATION_WORKER_INIT]', {
      workerId: this.workerId,
      leaseName: LEASE_NAME,
      backgroundWorkerEnabled,
      pollIntervalMs: QUEUE_POLL_INTERVAL_MS,
      leaseTtlSeconds: LEASE_TTL_SECONDS,
      leaseRenewalIntervalMs: LEASE_RENEWAL_INTERVAL_MS,
    });

    if (!backgroundWorkerEnabled) {
      return;
    }

    // Safety-net background sweep coordinated across instances via distributed DB lease.
    this.queueInterval = setInterval(() => {
      if (!this.pushProvider.configured) {
        return;
      }
      this.processPendingQueue().catch(() => {});
    }, QUEUE_POLL_INTERVAL_MS);
    if (typeof this.queueInterval.unref === 'function') {
      this.queueInterval.unref();
    }
  }

  onModuleDestroy() {
    if (this.queueInterval) {
      clearInterval(this.queueInterval);
      this.queueInterval = null;
    }
    if (this.holdsLease) {
      this.holdsLease = false;
      this.releaseLease().catch(() => {});
    }
  }

  async acquireOrRenewLease(
    phase: 'acquire' | 'renew' = 'acquire',
  ): Promise<boolean> {
    try {
      const db = this.db() as any;
      if (typeof db?.rpc !== 'function') {
        console.warn('[NOTIFICATION_LEASE_RESULT]', {
          phase,
          workerId: this.workerId,
          leaseName: LEASE_NAME,
          acquired: false,
          reason: 'rpc_unavailable',
        });
        return false;
      }
      const { data, error } = await db.rpc('acquire_or_renew_worker_lease', {
        p_lease_name: LEASE_NAME,
        p_holder_id: this.workerId,
        p_ttl_seconds: LEASE_TTL_SECONDS,
      });
      if (error) {
        this.holdsLease = false;
        console.warn('[NOTIFICATION_LEASE_RESULT]', {
          phase,
          workerId: this.workerId,
          leaseName: LEASE_NAME,
          acquired: false,
          reason: 'rpc_error',
          errorMessage: error?.message ?? 'unknown_error',
        });
        return false;
      }
      const row = Array.isArray(data) ? data[0] : data;
      const isOwner = Boolean(
        row && row.holder_id === this.workerId && row.acquired !== false,
      );
      this.holdsLease = isOwner;
      console.log('[NOTIFICATION_LEASE_RESULT]', {
        phase,
        workerId: this.workerId,
        leaseName: LEASE_NAME,
        acquired: isOwner,
        returnedHolderId: row?.holder_id ?? null,
        returnedAcquired: row?.acquired ?? null,
        leasedUntil: row?.leased_until ?? null,
      });
      return isOwner;
    } catch (err) {
      this.holdsLease = false;
      console.warn('[NOTIFICATION_LEASE_RESULT]', {
        phase,
        workerId: this.workerId,
        leaseName: LEASE_NAME,
        acquired: false,
        reason: 'rpc_exception',
        errorMessage: err instanceof Error ? err.message : 'unknown_exception',
      });
      return false;
    }
  }

  async releaseLease(): Promise<boolean> {
    try {
      const db = this.db() as any;
      if (typeof db?.rpc !== 'function') {
        return false;
      }
      const { data, error } = await db.rpc('release_worker_lease', {
        p_lease_name: LEASE_NAME,
        p_holder_id: this.workerId,
      });
      this.holdsLease = false;
      if (error) {
        return false;
      }
      return Boolean(data);
    } catch {
      this.holdsLease = false;
      return false;
    }
  }

  private isRetryableAttempt(attempt: {
    attempt_number?: number;
    provider_response?: any;
  } | null): boolean {
    if (!attempt) return true;
    if (Number(attempt.attempt_number ?? 0) >= MAX_RETRY_ATTEMPTS) {
      return false;
    }
    const reason = attempt.provider_response?.reason;
    if (typeof reason === 'string' && PERMANENT_FAILURE_REASONS.has(reason)) {
      return false;
    }
    const devices = Array.isArray(attempt.provider_response?.devices)
      ? attempt.provider_response.devices
      : [];
    if (
      devices.length > 0 &&
      devices.every(
        (d: any) =>
          typeof d?.reason === 'string' && PERMANENT_FAILURE_REASONS.has(d.reason),
      )
    ) {
      return false;
    }
    return true;
  }

  async processPendingQueue(
    limit = 20,
    renewalIntervalMs = LEASE_RENEWAL_INTERVAL_MS,
  ): Promise<number> {
    if (this.isProcessingQueue) {
      console.log('[NOTIFICATION_QUEUE_SWEEP_SKIPPED]', {
        workerId: this.workerId,
        leaseName: LEASE_NAME,
        reason: 'already_processing',
      });
      return 0;
    }
    if (!this.pushProvider.configured) {
      console.log('[NOTIFICATION_QUEUE_SWEEP_SKIPPED]', {
        workerId: this.workerId,
        leaseName: LEASE_NAME,
        reason: 'provider_not_configured',
      });
      return 0;
    }
    this.isProcessingQueue = true;

    let leaseLost = false;
    let renewalTimer: NodeJS.Timeout | null = null;

    try {
      const acquired = await this.acquireOrRenewLease('acquire');
      if (!acquired) {
        console.log('[NOTIFICATION_QUEUE_SWEEP_SKIPPED]', {
          workerId: this.workerId,
          leaseName: LEASE_NAME,
          reason: 'lease_not_acquired',
        });
        return 0;
      }

      console.log('[NOTIFICATION_QUEUE_SWEEP_STARTED]', {
        workerId: this.workerId,
        leaseName: LEASE_NAME,
        limit,
      });

      renewalTimer = setInterval(() => {
        this.acquireOrRenewLease('renew')
          .then((stillOwner) => {
            if (!stillOwner) {
              leaseLost = true;
              console.warn('[NOTIFICATION_LEASE_LOST]', {
                workerId: this.workerId,
                leaseName: LEASE_NAME,
              });
            }
          })
          .catch(() => {
            leaseLost = true;
            console.warn('[NOTIFICATION_LEASE_LOST]', {
              workerId: this.workerId,
              leaseName: LEASE_NAME,
            });
          });
      }, renewalIntervalMs);
      if (typeof renewalTimer.unref === 'function') {
        renewalTimer.unref();
      }

      // 1. Prioritize queued notifications
      const { data: queuedData, error: queuedError } = await this.db()
        .from('notifications')
        .select('id')
        .eq('status', 'queued')
        .order('created_at', { ascending: true })
        .limit(limit);

      let processedCount = 0;
      if (!queuedError && queuedData && queuedData.length > 0) {
        for (const row of queuedData) {
          if (leaseLost || !this.holdsLease) {
            break;
          }
          try {
            const res = await this.dispatchPersisted(row.id);
            if (res.dispatched) processedCount++;
          } catch {
            // Individual failure must not block the queue
          }
        }
        return processedCount;
      }

      if (leaseLost || !this.holdsLease) {
        return 0;
      }

      // 2. Retry recent failed notifications at most once every FAILED_RETRY_INTERVAL_MS (15m)
      const now = Date.now();
      if (now - this.lastFailedRetryAt < FAILED_RETRY_INTERVAL_MS) {
        return 0;
      }
      this.lastFailedRetryAt = now;

      const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
      const { data: failedData, error: failedError } = await this.db()
        .from('notifications')
        .select('id')
        .eq('status', 'failed')
        .gte('created_at', oneDayAgo)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (!failedError && failedData && failedData.length > 0) {
        const failedIds = failedData.map((row: { id: string }) => row.id);
        const { data: attemptsData } = await this.db()
          .from('notification_delivery_attempts')
          .select('notification_id,attempt_number,provider_response')
          .in('notification_id', failedIds)
          .order('attempt_number', { ascending: false });

        const latestAttemptById = new Map<string, any>();
        for (const attempt of attemptsData ?? []) {
          if (!latestAttemptById.has(attempt.notification_id)) {
            latestAttemptById.set(attempt.notification_id, attempt);
          }
        }

        for (const row of failedData) {
          if (leaseLost || !this.holdsLease) {
            break;
          }
          if (!this.isRetryableAttempt(latestAttemptById.get(row.id) ?? null)) {
            continue;
          }
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
    } finally {
      if (renewalTimer) {
        clearInterval(renewalTimer);
      }
      this.isProcessingQueue = false;
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
          return {
            deviceTokenId: device.id,
            status: 'sent',
            providerMessageId: result.providerMessageId,
          };
        }

        console.warn('[FCM_SEND_FAILED]', {
          notificationId: claimedNotification.id,
          orderId: claimedNotification.order_id || null,
          deviceTokenId: device.id,
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
      console.warn('[INVALID_TOKENS_DEACTIVATED]', {
        notificationId: claimedNotification.id,
        count: invalidTokenIds.length,
      });

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
