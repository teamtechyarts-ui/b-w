import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createClient,
  RealtimeChannel,
  SupabaseClient,
  User,
} from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  public readonly client: SupabaseClient;
  public readonly admin: SupabaseClient;

  private readonly url: string;
  private readonly anonKey: string;

  constructor(private readonly config: ConfigService) {
    this.url =
      this.config.getOrThrow<string>('SUPABASE_URL');

    this.anonKey =
      this.config.get<string>('SUPABASE_PUBLISHABLE_KEY') ??
      this.config.getOrThrow<string>('SUPABASE_ANON_KEY');

    const serviceRoleKey =
      this.config.get<string>('SUPABASE_SECRET_KEY') ??
      this.config.getOrThrow<string>(
        'SUPABASE_SERVICE_ROLE_KEY',
      );

    this.client = createClient(
      this.url,
      this.anonKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

    this.admin = createClient(
      this.url,
      serviceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );
    this.serviceRoleKey = serviceRoleKey;
  }

  private readonly serviceRoleKey: string;
  private readonly channelPool = new Map<string, RealtimeChannel>();

  getUrl(): string {
    return this.url;
  }

  getAnonKey(): string {
    return this.anonKey;
  }

  private notificationDispatcher?: (notificationId: string) => Promise<unknown>;
  private realtimeService?: any;

  public setNotificationDispatcher(
    dispatcher: (notificationId: string) => Promise<unknown>,
  ) {
    this.notificationDispatcher = dispatcher;
  }

  public getNotificationDispatcher() {
    return this.notificationDispatcher;
  }

  public setRealtimeService(service: any) {
    this.realtimeService = service;
  }

  async broadcastEvent(channelName: string, event: string, payload: any): Promise<void> {
    try {
      const sanitized = { ...payload };
      delete sanitized.pickupOtp;
      delete sanitized.deliveryOtp;
      delete sanitized.otp;
      delete sanitized.driverPin;
      delete sanitized.pin;
      delete sanitized.secret;
      delete sanitized.paymentSecret;

      const messagePayload = {
        ...sanitized,
        timestamp: sanitized.timestamp || new Date().toISOString(),
      };

      // 1. Primary: Supabase Realtime REST Broadcast endpoint (instant delivery, zero socket thrashing)
      try {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), 4000) : null;
        const res = await fetch(`${this.url}/realtime/v1/api/broadcast`, {
          method: 'POST',
          headers: {
            apikey: this.serviceRoleKey,
            Authorization: `Bearer ${this.serviceRoleKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messages: [
              {
                topic: channelName,
                event,
                payload: messagePayload,
              },
            ],
          }),
          signal: controller?.signal,
        });
        if (timer) clearTimeout(timer);
        if (res.ok) {
          return;
        }
      } catch {
        // Fallback to WebSocket channel with verified subscription
      }

      // 2. Fallback: WebSocket channel with verified Phoenix subscription
      let ch = this.channelPool.get(channelName);
      if (!ch) {
        ch = this.admin.channel(channelName);
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 2000);
          ch!.subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              clearTimeout(timeout);
              resolve();
            }
          });
        });
        // Keep channel pool bounded
        if (this.channelPool.size > 200) {
          const firstKey = this.channelPool.keys().next().value;
          if (firstKey) {
            const oldCh = this.channelPool.get(firstKey);
            try { oldCh?.unsubscribe(); } catch {}
            this.channelPool.delete(firstKey);
          }
        }
        this.channelPool.set(channelName, ch);
      }

      await ch.send({
        type: 'broadcast',
        event,
        payload: messagePayload,
      });

      // 3. Emit via NestJS WebSocket Gateway (Socket.IO) to connected authenticated clients
      if (this.realtimeService) {
        try {
          if (
            channelName.startsWith('customer:') ||
            channelName.startsWith('driver:') ||
            channelName.startsWith('user:')
          ) {
            const userId = channelName.split(':')[1];
            this.realtimeService.emitToUser(userId, event, messagePayload);
          } else if (channelName.startsWith('role:')) {
            const role = channelName.split(':')[1];
            this.realtimeService.emitToRole(role, event, messagePayload);
          } else if (channelName.startsWith('facility:')) {
            const facilityId = channelName.split(':')[1];
            this.realtimeService.emitToFacility(facilityId, event, messagePayload);
          } else if (channelName.startsWith('order:')) {
            const orderId = channelName.split(':')[1];
            this.realtimeService.emitToOrder(orderId, event, messagePayload);
          } else {
            this.realtimeService.emitBroadcast(event, messagePayload);
          }
        } catch {
          // Socket emit error must not break primary business transaction
        }
      }
    } catch {
      // Broadcast error must not break primary business transaction
    }
  }

  async createAndBroadcastNotification(params: {
    profileId: string;
    orderId?: string | null;
    notificationType: string;
    title: string;
    body: string;
    data?: Record<string, any>;
    channels?: string[];
  }): Promise<any> {
    if (!params.profileId) return null;

    try {
      // 1. Deduplication check: Avoid inserting duplicate notification if identical event exists for this order & user
      if (params.orderId && params.notificationType && typeof this.admin?.from === 'function') {
        const { data: existing } = await this.admin
          .from('notifications')
          .select('id, created_at, status')
          .eq('profile_id', params.profileId)
          .eq('order_id', params.orderId)
          .eq('notification_type', params.notificationType)
          .maybeSingle();

        if (existing) {
          return existing;
        }
      }

      // 2. Persist notification in database
      const orderId = params.orderId || null;
      let row: any = null;
      if (typeof this.admin?.from === 'function') {
        const { data: inserted, error } = await this.admin
          .from('notifications')
          .insert({
            profile_id: params.profileId,
            order_id: orderId,
            notification_type: params.notificationType,
            event_type: params.notificationType,
            title: params.title,
            body: params.body,
            message: params.body,
            data: params.data || {},
            status: 'queued',
          })
          .select()
          .maybeSingle();

        if (error) {
          console.warn('[SupabaseService] Notification insert warning:', error.message);
        } else {
          row = inserted;
        }
      }

      const notificationItem = row || {
        id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        profile_id: params.profileId,
        order_id: orderId,
        notification_type: params.notificationType,
        event_type: params.notificationType,
        title: params.title,
        body: params.body,
        message: params.body,
        data: params.data || {},
        is_read: false,
        read_at: null,
        created_at: new Date().toISOString(),
        status: 'queued',
      };

      // 3. Broadcast real-time notification payload
      const broadcastPayload = {
        eventType: 'NOTIFICATION_CREATED',
        entityId: notificationItem.id,
        orderId,
        notification: notificationItem,
        data: params.data || {},
        timestamp: new Date().toISOString(),
      };

      const targetChannels = params.channels && params.channels.length > 0
        ? params.channels
        : [`customer:${params.profileId}`, `driver:${params.profileId}`];

      await Promise.allSettled(
        targetChannels.map((ch) =>
          this.broadcastEvent(ch, 'NOTIFICATION_CREATED', broadcastPayload),
        ),
      );

      // 4. Dispatch persisted notification to active devices via FCM push
      if (row?.id && this.notificationDispatcher) {
        this.notificationDispatcher(row.id).catch((err: any) => {
          console.warn('[SupabaseService] Push notification dispatch failed:', err?.message);
        });
      }

      if (this.realtimeService) {
        try {
          this.realtimeService.emitNotificationCreated(params.profileId, notificationItem);
        } catch {}
      }

      return notificationItem;
    } catch (err) {
      console.warn('[SupabaseService] createAndBroadcastNotification error:', err);
      return null;
    }
  }

  createAuthClient(): SupabaseClient {
    return createClient(this.url, this.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async getUser(accessToken: string): Promise<User | null> {
    if (!accessToken) {
      return null;
    }

    const {
      data,
      error,
    } = await this.client.auth.getUser(accessToken);

    if (error || !data?.user) {
      return null;
    }

    return data.user as User;
  }

  async updateUserPassword(
    accessToken: string,
    newPassword: string,
  ): Promise<{ error: { message: string } | null }> {
    try {
      const res = await fetch(`${this.url}/auth/v1/user`, {
        method: 'PUT',
        headers: {
          apikey: this.anonKey,
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password: newPassword }),
      });

      if (!res.ok) {
        const data: any = await res.json().catch(() => null);
        const message =
          data?.msg || data?.message || 'Unable to update password. Please try again.';
        return { error: { message } };
      }

      return { error: null };
    } catch (cause: any) {
      return { error: { message: cause?.message || 'Network error updating password' } };
    }
  }

  createUserClient(
    accessToken: string,
  ): SupabaseClient {
    const client = createClient(
      this.url,
      this.anonKey,
      {
        global: {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

    const originalUpdateUser = client.auth.updateUser.bind(client.auth);
    client.auth.updateUser = (async (attributes: any, options?: any) => {
      if (attributes?.password) {
        const updateResult = await this.updateUserPassword(accessToken, attributes.password);
        if (updateResult.error) {
          return { data: { user: null }, error: updateResult.error as any };
        }
        const user = await this.getUser(accessToken);
        return { data: { user }, error: null };
      }
      return originalUpdateUser(attributes, options);
    }) as any;

    return client;
  }
}
