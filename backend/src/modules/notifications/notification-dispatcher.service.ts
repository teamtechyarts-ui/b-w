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

type NotificationChannel = 'push' | 'sms' | 'whatsapp' | 'email' | 'in_app';

type PersistedNotification = {
  id: string;
  profile_id: string;
  order_id?: string | null;
  channel?: NotificationChannel | null;
  notification_type?: string | null;
  event_type?: string | null;
  title: string;
  body?: string | null;
  message?: string | null;
  data?: unknown;
  status: NotificationStatus;
  processing_started_at?: string | null;
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
const STALE_PROCESSING_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes before a processing claim is considered stale
const STALE_PROCESSING_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours max age for automatic retry
const LEASE_NAME = 'notification_queue_sweep';
const LEASE_TTL_SECONDS = 360; // 6 minutes
const LEASE_RENEWAL_INTERVAL_MS = 120 * 1000; // 2 minutes renewal while long-running sweep is active
const MAX_RETRY_ATTEMPTS = 3;
const SUCCESSFUL_NOTIFICATION_STATUSES = new Set<NotificationStatus>([
  'sent',
  'delivered',
  'read',
]);
const PERMANENT_FAILURE_REASONS = new Set([
  'no_active_devices',
  'push_disabled',
  'provider_not_configured',
  'invalid_token',
  'stale_processing_expired',
  'stale_processing_max_attempts',
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

  private async attemptAcquireOrRenewLease(
    phase: 'acquire' | 'renew' = 'acquire',
  ): Promise<{
    acquired: boolean;
    skipReason?: 'lease_rpc_error' | 'lease_not_acquired';
  }> {
    try {
      const db = this.db() as any;
      if (typeof db?.rpc !== 'function') {
        console.warn('[NOTIFICATION_LEASE_RESULT]', {
          phase,
          workerId: this.workerId,
          leaseName: LEASE_NAME,
          acquired: false,
          reason: 'lease_rpc_error',
          errorCode: 'RPC_UNAVAILABLE',
          errorMessage: 'Supabase admin client rpc() is unavailable',
        });
        return { acquired: false, skipReason: 'lease_rpc_error' };
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
          reason: 'lease_rpc_error',
          errorCode: error?.code ?? null,
          errorMessage: error?.message ?? 'unknown_error',
        });
        return { acquired: false, skipReason: 'lease_rpc_error' };
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
        reason: isOwner ? 'acquired' : 'lease_not_acquired',
        returnedHolderId: row?.holder_id ?? null,
        returnedAcquired: row?.acquired ?? null,
        leasedUntil: row?.leased_until ?? null,
      });
      return isOwner
        ? { acquired: true }
        : { acquired: false, skipReason: 'lease_not_acquired' };
    } catch (err) {
      this.holdsLease = false;
      console.warn('[NOTIFICATION_LEASE_RESULT]', {
        phase,
        workerId: this.workerId,
        leaseName: LEASE_NAME,
        acquired: false,
        reason: 'lease_rpc_error',
        errorCode: (err as any)?.code ?? 'RPC_EXCEPTION',
        errorMessage: err instanceof Error ? err.message : 'unknown_exception',
      });
      return { acquired: false, skipReason: 'lease_rpc_error' };
    }
  }

  async acquireOrRenewLease(
    phase: 'acquire' | 'renew' = 'acquire',
  ): Promise<boolean> {
    const result = await this.attemptAcquireOrRenewLease(phase);
    return result.acquired;
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

  private resolveConfirmedSuccessfulStatus(
    attempts: Array<{ status?: string | null }>,
  ): NotificationStatus | null {
    if (attempts.some((a) => a.status === 'read')) return 'read';
    if (attempts.some((a) => a.status === 'delivered')) return 'delivered';
    if (attempts.some((a) => a.status === 'sent')) return 'sent';
    return null;
  }

  async recoverStaleProcessing(
    limit = 20,
    shouldContinue: () => boolean = () => true,
  ): Promise<number> {
    const now = Date.now();
    const staleCutoffIso = new Date(
      now - STALE_PROCESSING_TIMEOUT_MS,
    ).toISOString();

    const { data: staleRows, error: staleError } = await this.db()
      .from('notifications')
      .select('id,created_at,processing_started_at')
      .eq('status', 'processing')
      .lt('processing_started_at', staleCutoffIso)
      .order('processing_started_at', { ascending: true })
      .limit(limit);

    if (staleError || !staleRows || staleRows.length === 0) {
      if (staleError) {
        console.warn('[NOTIFICATION_STALE_RECOVERY_ERROR]', {
          workerId: this.workerId,
          stage: 'select_stale',
          errorCode: staleError?.code ?? null,
          errorMessage: staleError?.message ?? 'unknown_error',
        });
      }
      return 0;
    }

    const staleIds = staleRows.map((row: { id: string }) => row.id);
    const { data: attemptsData, error: attemptsError } = await this.db()
      .from('notification_delivery_attempts')
      .select('notification_id,attempt_number,status,provider_response')
      .in('notification_id', staleIds)
      .order('attempt_number', { ascending: false });

    if (attemptsError) {
      console.warn('[NOTIFICATION_STALE_RECOVERY_ERROR]', {
        workerId: this.workerId,
        stage: 'select_attempts',
        errorCode: attemptsError?.code ?? null,
        errorMessage: attemptsError?.message ?? 'unknown_error',
      });
      return 0;
    }

    const attemptsByNotification = new Map<string, any[]>();
    for (const attempt of attemptsData ?? []) {
      const list = attemptsByNotification.get(attempt.notification_id) ?? [];
      list.push(attempt);
      attemptsByNotification.set(attempt.notification_id, list);
    }

    let recoveredCount = 0;

    for (const row of staleRows as Array<{
      id: string;
      created_at?: string | null;
      processing_started_at?: string | null;
    }>) {
      if (!shouldContinue()) {
        break;
      }
      if (!row.processing_started_at) {
        continue;
      }

      const startedAtMs = Date.parse(row.processing_started_at);
      if (Number.isNaN(startedAtMs) || now - startedAtMs < STALE_PROCESSING_TIMEOUT_MS) {
        continue;
      }

      const attempts = attemptsByNotification.get(row.id) ?? [];
      const latestAttempt = attempts[0] ?? null;
      const latestAttemptNumber = Number(latestAttempt?.attempt_number ?? 0);
      const confirmedSuccessStatus =
        this.resolveConfirmedSuccessfulStatus(attempts);

      if (confirmedSuccessStatus) {
        const { data: updated, error: updateError } = await this.db()
          .from('notifications')
          .update({
            status: confirmedSuccessStatus,
            processing_started_at: null,
          })
          .eq('id', row.id)
          .eq('status', 'processing')
          .eq('processing_started_at', row.processing_started_at)
          .select('id')
          .maybeSingle();

        if (!updateError && updated) {
          recoveredCount++;
          console.log('[NOTIFICATION_STALE_RECOVERED]', {
            workerId: this.workerId,
            notificationId: row.id,
            action: 'reconciled_success',
            targetStatus: confirmedSuccessStatus,
          });
        }
        continue;
      }

      const createdAtMs = row.created_at ? Date.parse(row.created_at) : NaN;
      const isExpired =
        !Number.isNaN(createdAtMs) &&
        now - createdAtMs >= STALE_PROCESSING_MAX_AGE_MS;
      const isMaxAttemptsOrPermanent =
        latestAttemptNumber >= MAX_RETRY_ATTEMPTS ||
        (latestAttempt !== null && !this.isRetryableAttempt(latestAttempt));

      const recoveryReason = isExpired
        ? 'stale_processing_expired'
        : isMaxAttemptsOrPermanent
          ? 'stale_processing_max_attempts'
          : 'stale_processing_recovered';

      const { data: updated, error: updateError } = await this.db()
        .from('notifications')
        .update({ status: 'failed', processing_started_at: null })
        .eq('id', row.id)
        .eq('status', 'processing')
        .eq('processing_started_at', row.processing_started_at)
        .select('id')
        .maybeSingle();

      if (updateError || !updated) {
        continue;
      }

      recoveredCount++;

      console.log('[NOTIFICATION_STALE_RECOVERED]', {
        workerId: this.workerId,
        notificationId: row.id,
        action: recoveryReason,
        targetStatus: 'failed',
        existingAttemptCount: latestAttemptNumber,
      });
    }

    return recoveredCount;
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
      const leaseAttempt = await this.attemptAcquireOrRenewLease('acquire');
      if (!leaseAttempt.acquired) {
        console.log('[NOTIFICATION_QUEUE_SWEEP_SKIPPED]', {
          workerId: this.workerId,
          leaseName: LEASE_NAME,
          reason: leaseAttempt.skipReason ?? 'lease_not_acquired',
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

      // 2. Recover stale processing rows & retry recent failed notifications at most once every FAILED_RETRY_INTERVAL_MS (15m)
      const now = Date.now();
      if (now - this.lastFailedRetryAt < FAILED_RETRY_INTERVAL_MS) {
        return 0;
      }
      this.lastFailedRetryAt = now;

      await this.recoverStaleProcessing(
        limit,
        () => !leaseLost && this.holdsLease,
      );

      if (leaseLost || !this.holdsLease) {
        return 0;
      }

      const oneDayAgo = new Date(now - STALE_PROCESSING_MAX_AGE_MS).toISOString();
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

    const claimTimestamp = new Date().toISOString();
    const { data: claimed, error: claimError } = await this.db()
      .from('notifications')
      .update({ status: 'processing', processing_started_at: claimTimestamp })
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
    const isInApp = claimedNotification.channel === 'in_app';
    const claimToken = claimedNotification.processing_started_at ?? claimTimestamp;
    let finalized = false;
    let sentCountSoFar = 0;

    try {
      if (isInApp && !this.pushProvider.configured) {
        const result = await this.finalizeWithoutProviderAttempt(
          claimedNotification,
          claimToken,
          'sent',
          'provider_not_configured',
        );
        finalized = true;
        return result;
      }

      const { data: preferences, error: preferencesError } = await this.db()
        .from('notification_preferences')
        .select('push_enabled')
        .eq('profile_id', claimedNotification.profile_id)
        .maybeSingle();

      if (preferencesError) {
        if (isInApp) {
          console.warn('[NOTIFICATION_DB_ERROR]', {
            workerId: this.workerId,
            notificationId: claimedNotification.id,
            channel: claimedNotification.channel ?? null,
            eventType:
              claimedNotification.event_type ??
              claimedNotification.notification_type ??
              null,
            stage: 'select_preferences',
            errorCode: preferencesError?.code ?? null,
            errorMessage: preferencesError?.message ?? 'unknown_error',
          });
          const result = await this.finalizeWithoutProviderAttempt(
            claimedNotification,
            claimToken,
            'sent',
            'preferences_unavailable',
          );
          finalized = true;
          return result;
        }
        await this.finish(
          claimedNotification,
          claimToken,
          'failed',
          [],
          'preferences_unavailable',
        );
        finalized = true;
        throw new BadRequestException('Unable to load notification preferences');
      }

      if (preferences?.push_enabled === false) {
        if (isInApp) {
          const result = await this.finalizeWithoutProviderAttempt(
            claimedNotification,
            claimToken,
            'sent',
            'push_disabled',
          );
          finalized = true;
          return result;
        }
        const result = await this.finish(
          claimedNotification,
          claimToken,
          'cancelled',
          [],
          'push_disabled',
        );
        finalized = true;
        return result;
      }

      const { data: devices, error: devicesError } = await this.db()
        .from('device_tokens')
        .select('id,push_token')
        .eq('profile_id', claimedNotification.profile_id)
        .eq('is_active', true);

      if (devicesError) {
        if (isInApp) {
          console.warn('[NOTIFICATION_DB_ERROR]', {
            workerId: this.workerId,
            notificationId: claimedNotification.id,
            channel: claimedNotification.channel ?? null,
            eventType:
              claimedNotification.event_type ??
              claimedNotification.notification_type ??
              null,
            stage: 'select_device_tokens',
            errorCode: devicesError?.code ?? null,
            errorMessage: devicesError?.message ?? 'unknown_error',
          });
          const result = await this.finalizeWithoutProviderAttempt(
            claimedNotification,
            claimToken,
            'sent',
            'devices_unavailable',
          );
          finalized = true;
          return result;
        }
        await this.finish(
          claimedNotification,
          claimToken,
          'failed',
          [],
          'devices_unavailable',
        );
        finalized = true;
        throw new BadRequestException('Unable to load active device tokens');
      }

      const activeDevices = (devices ?? []) as DeviceToken[];

      if (activeDevices.length === 0) {
        if (isInApp) {
          const result = await this.finalizeWithoutProviderAttempt(
            claimedNotification,
            claimToken,
            'sent',
            'no_active_devices',
          );
          finalized = true;
          return result;
        }
        const result = await this.finish(
          claimedNotification,
          claimToken,
          'failed',
          [],
          'no_active_devices',
        );
        finalized = true;
        return result;
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

      const sentCount = deliveryResults.filter(
        (result) => result.status === 'sent',
      ).length;
      sentCountSoFar = sentCount;

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
            claimToken,
            isInApp ? 'sent' : 'failed',
            deliveryResults,
            'token_deactivation_failed',
            sentCount > 0 ? 'sent' : 'failed',
          );
          finalized = true;
          throw new BadRequestException('Unable to deactivate invalid device tokens');
        }
      }

      const pushAttemptStatus: NotificationStatus =
        sentCount > 0 ? 'sent' : 'failed';
      const finalNotificationStatus: NotificationStatus = isInApp
        ? 'sent'
        : pushAttemptStatus;

      if (isInApp && pushAttemptStatus === 'failed') {
        console.warn('[NOTIFICATION_IN_APP_PUSH_FAILED]', {
          workerId: this.workerId,
          notificationId: claimedNotification.id,
          channel: 'in_app',
          eventType:
            claimedNotification.event_type ??
            claimedNotification.notification_type ??
            null,
          attemptedDeviceCount: deliveryResults.length,
          failedCount: deliveryResults.length,
        });
      }

      const result = await this.finish(
        claimedNotification,
        claimToken,
        finalNotificationStatus,
        deliveryResults,
        isInApp && pushAttemptStatus === 'failed'
          ? 'push_delivery_failed'
          : undefined,
        pushAttemptStatus,
      );
      finalized = true;
      return result;
    } catch (err) {
      if (!finalized) {
        console.warn('[NOTIFICATION_DISPATCH_EXCEPTION]', {
          workerId: this.workerId,
          notificationId: claimedNotification.id,
          channel: claimedNotification.channel ?? null,
          eventType:
            claimedNotification.event_type ??
            claimedNotification.notification_type ??
            null,
          sentCountSoFar,
          errorMessage: err instanceof Error ? err.message : 'unknown_error',
        });
        await this.reconcileClaimedNotificationOnError(
          claimedNotification,
          claimToken,
          sentCountSoFar,
        );
      }
      throw err;
    }
  }

  private async finalizeWithoutProviderAttempt(
    notification: PersistedNotification,
    claimToken: string,
    status: NotificationStatus,
    pushSkipReason: string,
  ): Promise<NotificationDispatchResult> {
    const { data: updatedNotification, error: statusError } = await this.db()
      .from('notifications')
      .update({ status, processing_started_at: null })
      .eq('id', notification.id)
      .eq('status', 'processing')
      .eq('processing_started_at', claimToken)
      .select('id')
      .maybeSingle();

    if (statusError) {
      console.warn('[NOTIFICATION_DB_ERROR]', {
        workerId: this.workerId,
        notificationId: notification.id,
        channel: notification.channel ?? null,
        eventType:
          notification.event_type ?? notification.notification_type ?? null,
        stage: 'update_notification_status',
        errorCode: statusError?.code ?? null,
        errorMessage: statusError?.message ?? 'unknown_error',
      });
      throw new BadRequestException('Unable to update notification status');
    }

    if (!updatedNotification) {
      console.warn('[NOTIFICATION_FINISH_STALE_CLAIM]', {
        workerId: this.workerId,
        notificationId: notification.id,
        channel: notification.channel ?? null,
        attemptedStatus: status,
      });
      return {
        notificationId: notification.id,
        dispatched: false,
        status: 'processing',
        attemptedDeviceCount: 0,
        sentCount: 0,
        failedCount: 0,
        reason: 'stale_claim',
      };
    }

    console.log('[NOTIFICATION_IN_APP_DELIVERED]', {
      workerId: this.workerId,
      notificationId: notification.id,
      channel: notification.channel ?? 'in_app',
      eventType:
        notification.event_type ?? notification.notification_type ?? null,
      pushStatus: 'skipped',
      pushReason: pushSkipReason,
    });

    return {
      notificationId: notification.id,
      dispatched: true,
      status,
      attemptedDeviceCount: 0,
      sentCount: 0,
      failedCount: 0,
      reason: pushSkipReason,
    };
  }

  private async reconcileClaimedNotificationOnError(
    notification: PersistedNotification,
    claimToken: string,
    sentCountSoFar: number,
  ): Promise<void> {
    const notificationId = notification.id;
    const isInApp = notification.channel === 'in_app';
    try {
      const { data: attemptsData, error: attemptsError } = await this.db()
        .from('notification_delivery_attempts')
        .select('status,attempt_number')
        .eq('notification_id', notificationId)
        .order('attempt_number', { ascending: false });

      if (attemptsError) {
        console.warn('[NOTIFICATION_DB_ERROR]', {
          workerId: this.workerId,
          notificationId,
          channel: notification.channel ?? null,
          eventType:
            notification.event_type ?? notification.notification_type ?? null,
          stage: 'reconcile_select_attempts',
          errorCode: attemptsError?.code ?? null,
          errorMessage: attemptsError?.message ?? 'unknown_error',
        });
      }

      const confirmedSuccessStatus =
        !attemptsError && Array.isArray(attemptsData)
          ? this.resolveConfirmedSuccessfulStatus(attemptsData)
          : null;

      // Never blindly reset to queued; preserve persisted in-app delivery and confirmed/in-flight FCM success.
      const targetStatus: NotificationStatus =
        confirmedSuccessStatus ??
        (isInApp || sentCountSoFar > 0 ? 'sent' : 'failed');

      const { data: updated, error: updateError } = await this.db()
        .from('notifications')
        .update({ status: targetStatus, processing_started_at: null })
        .eq('id', notificationId)
        .eq('status', 'processing')
        .eq('processing_started_at', claimToken)
        .select('id')
        .maybeSingle();

      if (updateError) {
        console.warn('[NOTIFICATION_DISPATCH_RECONCILE_FAILED]', {
          workerId: this.workerId,
          notificationId,
          channel: notification.channel ?? null,
          eventType:
            notification.event_type ?? notification.notification_type ?? null,
          targetStatus,
          errorCode: updateError?.code ?? null,
          errorMessage: updateError?.message ?? 'unknown_error',
        });
        return;
      }

      if (!updated) {
        console.warn('[NOTIFICATION_DISPATCH_RECONCILE_STALE_CLAIM]', {
          workerId: this.workerId,
          notificationId,
          targetStatus,
        });
        return;
      }

      console.log('[NOTIFICATION_DISPATCH_RECONCILED]', {
        workerId: this.workerId,
        notificationId,
        channel: notification.channel ?? null,
        targetStatus,
      });
    } catch (reconcileErr) {
      console.warn('[NOTIFICATION_DISPATCH_RECONCILE_FAILED]', {
        workerId: this.workerId,
        notificationId,
        channel: notification.channel ?? null,
        errorMessage:
          reconcileErr instanceof Error ? reconcileErr.message : 'unknown_error',
      });
    }
  }

  private async finish(
    notification: PersistedNotification,
    claimToken: string,
    status: NotificationStatus,
    results: DeviceDeliveryResult[],
    reason?: string,
    attemptStatus: NotificationStatus = status,
  ): Promise<NotificationDispatchResult> {
    const { data: previousAttempt, error: attemptReadError } = await this.db()
      .from('notification_delivery_attempts')
      .select('attempt_number')
      .eq('notification_id', notification.id)
      .order('attempt_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (attemptReadError) {
      console.warn('[NOTIFICATION_DB_ERROR]', {
        workerId: this.workerId,
        notificationId: notification.id,
        channel: notification.channel ?? null,
        eventType:
          notification.event_type ?? notification.notification_type ?? null,
        stage: 'select_attempts',
        errorCode: attemptReadError?.code ?? null,
        errorMessage: attemptReadError?.message ?? 'unknown_error',
      });
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
        status: attemptStatus,
      });

    if (attemptError) {
      console.warn('[NOTIFICATION_DB_ERROR]', {
        workerId: this.workerId,
        notificationId: notification.id,
        channel: notification.channel ?? null,
        eventType:
          notification.event_type ?? notification.notification_type ?? null,
        stage: 'insert_attempt',
        errorCode: attemptError?.code ?? null,
        errorMessage: attemptError?.message ?? 'unknown_error',
      });
      throw new BadRequestException('Unable to record notification attempt');
    }

    const { data: updatedNotification, error: statusError } = await this.db()
      .from('notifications')
      .update({ status, processing_started_at: null })
      .eq('id', notification.id)
      .eq('status', 'processing')
      .eq('processing_started_at', claimToken)
      .select('id')
      .maybeSingle();

    if (statusError) {
      console.warn('[NOTIFICATION_DB_ERROR]', {
        workerId: this.workerId,
        notificationId: notification.id,
        channel: notification.channel ?? null,
        eventType:
          notification.event_type ?? notification.notification_type ?? null,
        stage: 'update_notification_status',
        errorCode: statusError?.code ?? null,
        errorMessage: statusError?.message ?? 'unknown_error',
      });
      throw new BadRequestException('Unable to update notification status');
    }

    if (!updatedNotification) {
      console.warn('[NOTIFICATION_FINISH_STALE_CLAIM]', {
        workerId: this.workerId,
        notificationId: notification.id,
        channel: notification.channel ?? null,
        attemptedStatus: status,
      });
      return {
        notificationId: notification.id,
        dispatched: false,
        status: 'processing',
        attemptedDeviceCount: results.length,
        sentCount,
        failedCount,
        reason: 'stale_claim',
      };
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
