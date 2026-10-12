import {createClient, RealtimeChannel, SupabaseClient} from '@supabase/supabase-js';
import {AppState, AppStateStatus, Platform} from 'react-native';
import Config from 'react-native-config';
import {API_BASE_URL} from '../config/environment';

export interface RealtimeConfig {
  url: string;
  anonKey: string;
}

export type RealtimeEventType =
  | 'ORDER_STATUS_CHANGED'
  | 'ORDER_CREATED'
  | 'JOB_AVAILABLE'
  | 'JOB_CLAIMED'
  | 'JOB_CONFLICT'
  | 'ASSIGNMENT_UPDATED'
  | 'FACILITY_INTAKE'
  | 'PROCESSING_STAGE_CHANGED'
  | 'QC_UPDATED'
  | 'CLAIM_UPDATED'
  | 'REFUND_UPDATED'
  | 'DRIVER_AVAILABILITY_CHANGED'
  | 'RECONNECT_RECONCILE';

export interface RealtimeEventPayload {
  eventType: RealtimeEventType;
  entityId: string;
  orderId?: string;
  orderNumber?: string;
  status?: string;
  facilityId?: string;
  driverId?: string;
  data?: any;
  timestamp: string;
  localReceivedAt?: number;
}

export type RealtimeEventListener = (event: RealtimeEventPayload) => void;

interface ChannelSubscription {
  channel: RealtimeChannel;
  refCount: number;
  listeners: Set<RealtimeEventListener>;
  teardownTimer?: ReturnType<typeof setTimeout>;
}

class RealtimeService {
  private client: SupabaseClient | null = null;
  private config: RealtimeConfig | null = null;
  private configPromise: Promise<RealtimeConfig | null> | null = null;
  private currentToken: string | null = null;
  private channels = new Map<string, ChannelSubscription>();
  private appState: AppStateStatus = (AppState.currentState || 'active') as AppStateStatus;
  private appStateSubscription: any = null;
  private isConnected = false;
  private reconnectListeners = new Set<() => void>();

  constructor() {
    this.initAppStateListener();
  }

  private initAppStateListener() {
    if (typeof AppState?.addEventListener === 'function') {
      this.appStateSubscription = AppState.addEventListener(
        'change',
        (nextState: AppStateStatus) => {
          const becameActive =
            this.appState.match(/inactive|background/) && nextState === 'active';
          this.appState = nextState;

          if (becameActive) {
            this.handleAppForeground();
          }
        },
      );
    }
  }

  private async fetchRealtimeConfig(): Promise<RealtimeConfig | null> {
    // In test environments, return mock config immediately to avoid hanging
    if (process.env.NODE_ENV === 'test' || typeof jest !== 'undefined') {
      return {
        url: 'http://127.0.0.1:54321',
        anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.test',
      };
    }

    // 1. Check direct config / env vars
    const envUrl = Config.BW_SUPABASE_URL || Config.SUPABASE_URL;
    const envKey =
      Config.BW_SUPABASE_ANON_KEY ||
      Config.SUPABASE_ANON_KEY ||
      Config.SUPABASE_PUBLISHABLE_KEY;

    if (envUrl && envKey) {
      return {url: envUrl.trim(), anonKey: envKey.trim()};
    }

    // 2. Discover from backend endpoint /api/v1/auth/realtime-config with 2s timeout
    try {
      const baseUrl = API_BASE_URL.replace(/\/$/, '');
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeoutId = controller ? setTimeout(() => controller.abort(), 2000) : null;
      const response = await fetch(`${baseUrl}/auth/realtime-config`, {
        signal: controller?.signal,
      });
      if (timeoutId) clearTimeout(timeoutId);
      if (response.ok) {
        const data: any = await response.json();
        if (data?.url && data?.anonKey) {
          return {url: data.url, anonKey: data.anonKey};
        }
      }
    } catch {
      // Backend discovery fallback
    }

    // 3. Fallback defaults for dev mode
    if (__DEV__) {
      const host = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';
      return {
        url: `http://${host}:54321`,
        anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.dummy',
      };
    }

    return null;
  }

  public async getOrInitClient(accessToken?: string): Promise<SupabaseClient | null> {
    if (!this.config) {
      if (!this.configPromise) {
        this.configPromise = this.fetchRealtimeConfig();
      }
      this.config = await this.configPromise;
    }

    if (!this.config) {
      return null;
    }

    if (!this.client) {
      this.client = createClient(this.config.url, this.config.anonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
        realtime: {
          params: {
            eventsPerSecond: 20,
          },
        },
      });
    }

    if (accessToken && accessToken !== this.currentToken) {
      this.currentToken = accessToken;
      try {
        this.client.realtime.setAuth(accessToken);
      } catch {
        // Safe token set
      }
    }

    return this.client;
  }

  public async subscribeToChannel(
    channelName: string,
    listener: RealtimeEventListener,
    accessToken?: string,
  ): Promise<() => void> {
    const client = await this.getOrInitClient(accessToken);
    if (!client) {
      return () => {};
    }

    let sub = this.channels.get(channelName);

    if (sub) {
      if (sub.teardownTimer) {
        clearTimeout(sub.teardownTimer);
        sub.teardownTimer = undefined;
      }
      sub.refCount += 1;
      sub.listeners.add(listener);
    } else {
      const listeners = new Set<RealtimeEventListener>([listener]);
      const channel = client.channel(channelName);

      // Listen for broadcast events
      channel.on('broadcast', {event: '*'}, (msg: any) => {
        const payload: RealtimeEventPayload = {
          eventType: msg.event as RealtimeEventType,
          entityId: msg.payload?.entityId || msg.payload?.id || '',
          orderId: msg.payload?.orderId || msg.payload?.id,
          orderNumber: msg.payload?.orderNumber,
          status: msg.payload?.status || msg.payload?.current_status,
          facilityId: msg.payload?.facilityId,
          driverId: msg.payload?.driverId,
          data: msg.payload?.data || msg.payload,
          timestamp: msg.payload?.timestamp || new Date().toISOString(),
          localReceivedAt: Date.now(),
        };

        listeners.forEach(cb => {
          try {
            cb(payload);
          } catch (err) {
            console.warn('[Realtime] Listener error:', err);
          }
        });
      });

      // Listen for postgres_changes on relevant operational tables
      channel
        .on(
          'postgres_changes',
          {event: '*', schema: 'public', table: 'orders'},
          (msg: any) => {
            const row = msg.new || msg.old || {};
            const eventType: RealtimeEventType =
              msg.eventType === 'INSERT'
                ? 'ORDER_CREATED'
                : 'ORDER_STATUS_CHANGED';

            const payload: RealtimeEventPayload = {
              eventType,
              entityId: row.id || '',
              orderId: row.id,
              orderNumber: row.order_number,
              status: row.current_status,
              facilityId: row.facility_id,
              data: row,
              timestamp: row.updated_at || row.created_at || new Date().toISOString(),
              localReceivedAt: Date.now(),
            };

            listeners.forEach(cb => {
              try {
                cb(payload);
              } catch (err) {
                console.warn('[Realtime] Orders postgres_changes listener error:', err);
              }
            });
          },
        )
        .on(
          'postgres_changes',
          {event: '*', schema: 'public', table: 'driver_assignments'},
          (msg: any) => {
            const row = msg.new || msg.old || {};
            const eventType: RealtimeEventType =
              row.status === 'assigned' || row.status === 'accepted'
                ? 'JOB_CLAIMED'
                : 'ASSIGNMENT_UPDATED';

            const payload: RealtimeEventPayload = {
              eventType,
              entityId: row.id || '',
              orderId: row.order_id,
              status: row.status,
              driverId: row.driver_id,
              data: row,
              timestamp: row.updated_at || row.assigned_at || new Date().toISOString(),
              localReceivedAt: Date.now(),
            };

            listeners.forEach(cb => {
              try {
                cb(payload);
              } catch (err) {
                console.warn('[Realtime] Assignment postgres_changes listener error:', err);
              }
            });
          },
        )
        .on(
          'postgres_changes',
          {event: '*', schema: 'public', table: 'customer_order_claims'},
          (msg: any) => {
            const row = msg.new || msg.old || {};
            const payload: RealtimeEventPayload = {
              eventType: 'CLAIM_UPDATED',
              entityId: row.id || '',
              orderId: row.order_id,
              status: row.status,
              data: row,
              timestamp: row.updated_at || row.created_at || new Date().toISOString(),
              localReceivedAt: Date.now(),
            };

            listeners.forEach(cb => {
              try {
                cb(payload);
              } catch (err) {
                console.warn('[Realtime] Claim postgres_changes listener error:', err);
              }
            });
          },
        )
        .on(
          'postgres_changes',
          {event: '*', schema: 'public', table: 'customer_claims'},
          (msg: any) => {
            const row = msg.new || msg.old || {};
            const payload: RealtimeEventPayload = {
              eventType: 'CLAIM_UPDATED',
              entityId: row.id || '',
              orderId: row.order_id,
              status: row.status,
              data: row,
              timestamp: row.updated_at || row.created_at || new Date().toISOString(),
              localReceivedAt: Date.now(),
            };

            listeners.forEach(cb => {
              try {
                cb(payload);
              } catch (err) {
                console.warn('[Realtime] Claim postgres_changes listener error:', err);
              }
            });
          },
        )
        .on(
          'postgres_changes',
          {event: '*', schema: 'public', table: 'refund_requests'},
          (msg: any) => {
            const row = msg.new || msg.old || {};
            const payload: RealtimeEventPayload = {
              eventType: 'REFUND_UPDATED',
              entityId: row.id || '',
              orderId: row.order_id,
              status: row.status,
              data: row,
              timestamp: row.updated_at || row.created_at || new Date().toISOString(),
              localReceivedAt: Date.now(),
            };

            listeners.forEach(cb => {
              try {
                cb(payload);
              } catch (err) {
                console.warn('[Realtime] Refund postgres_changes listener error:', err);
              }
            });
          },
        )
        .on(
          'postgres_changes',
          {event: '*', schema: 'public', table: 'facility_order_operations'},
          (msg: any) => {
            const row = msg.new || msg.old || {};
            const payload: RealtimeEventPayload = {
              eventType: 'PROCESSING_STAGE_CHANGED',
              entityId: row.id || '',
              orderId: row.order_id,
              facilityId: row.facility_id,
              status: row.status,
              data: row,
              timestamp: row.updated_at || new Date().toISOString(),
              localReceivedAt: Date.now(),
            };

            listeners.forEach(cb => {
              try {
                cb(payload);
              } catch (err) {
                console.warn('[Realtime] Facility postgres_changes listener error:', err);
              }
            });
          },
        );

      channel.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          this.isConnected = true;
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          this.isConnected = false;
        }
      });

      sub = {
        channel,
        refCount: 1,
        listeners,
      };
      this.channels.set(channelName, sub);
    }

    return () => {
      this.unsubscribeFromChannel(channelName, listener);
    };
  }

  private unsubscribeFromChannel(
    channelName: string,
    listener: RealtimeEventListener,
  ) {
    const sub = this.channels.get(channelName);
    if (!sub) return;

    sub.listeners.delete(listener);
    sub.refCount -= 1;

    if (sub.refCount <= 0) {
      if (sub.teardownTimer) {
        clearTimeout(sub.teardownTimer);
      }
      // Debounce teardown by 500ms to preserve connection during fast tab transitions
      sub.teardownTimer = setTimeout(() => {
        if (sub.refCount <= 0) {
          try {
            sub.channel.unsubscribe();
          } catch {
            // Safe cleanup
          }
          this.channels.delete(channelName);
        }
      }, 500);
    }
  }

  public onReconnect(callback: () => void): () => void {
    this.reconnectListeners.add(callback);
    return () => {
      this.reconnectListeners.delete(callback);
    };
  }

  private handleAppForeground() {
    // Notify all active listeners to perform bounded reconciliation refetch
    this.reconnectListeners.forEach(cb => {
      try {
        cb();
      } catch (err) {
        console.warn('[Realtime] Reconnect callback error:', err);
      }
    });

    const uniqueListeners = new Set<RealtimeEventListener>();
    this.channels.forEach(sub => {
      sub.listeners.forEach(cb => {
        uniqueListeners.add(cb);
      });
    });

    const reconcilePayload: RealtimeEventPayload = {
      eventType: 'RECONNECT_RECONCILE',
      entityId: 'global',
      timestamp: new Date().toISOString(),
      localReceivedAt: Date.now(),
    };

    uniqueListeners.forEach(cb => {
      try {
        cb(reconcilePayload);
      } catch {
        // Safe catch
      }
    });
  }

  public publishLocalEvent(channelName: string, event: RealtimeEventPayload) {
    const sub = this.channels.get(channelName);
    if (sub) {
      const payload: RealtimeEventPayload = {
        ...event,
        localReceivedAt: Date.now(),
      };
      sub.listeners.forEach(cb => {
        try {
          cb(payload);
        } catch (err) {
          console.warn('[Realtime] Local event callback error:', err);
        }
      });
    }
  }

  public registerLocalListener(
    channelName: string,
    listener: RealtimeEventListener,
  ): () => void {
    let sub = this.channels.get(channelName);
    if (!sub) {
      const dummyChannel = {
        unsubscribe: () => {},
        subscribe: (cb?: any) => (cb ? cb('SUBSCRIBED') : {}),
      } as unknown as RealtimeChannel;
      sub = {
        channel: dummyChannel,
        refCount: 1,
        listeners: new Set<RealtimeEventListener>(),
      };
      this.channels.set(channelName, sub);
    } else {
      sub.refCount += 1;
    }
    sub.listeners.add(listener);

    return () => {
      this.unsubscribeFromChannel(channelName, listener);
    };
  }

  public emitLocalEvent(channelName: string, event: RealtimeEventPayload) {
    this.publishLocalEvent(channelName, event);
  }

  public triggerReconciliation() {
    this.handleAppForeground();
  }
}

export const realtimeService = new RealtimeService();
