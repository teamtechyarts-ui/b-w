import {AppState, AppStateStatus, Platform} from 'react-native';
import {io, Socket} from 'socket.io-client';
import {API_BASE_URL} from '../config/environment';

export interface RealtimeConfig {
  url: string;
  anonKey?: string;
}

export type RealtimeEventType =
  | 'ORDER_STATUS_CHANGED'
  | 'ORDER_CREATED'
  | 'JOB_AVAILABLE'
  | 'JOB_CLAIMED'
  | 'JOB_CONFLICT'
  | 'ASSIGNMENT_UPDATED'
  | 'FACILITY_INTAKE'
  | 'FACILITY_VERIFICATION'
  | 'PROCESSING_STAGE_STARTED'
  | 'PROCESSING_STAGE_COMPLETED'
  | 'PROCESSING_STAGE_CHANGED'
  | 'QC_DECIDED'
  | 'QC_UPDATED'
  | 'CLAIM_UPDATED'
  | 'REFUND_UPDATED'
  | 'DRIVER_AVAILABILITY_CHANGED'
  | 'NOTIFICATION_CREATED'
  | 'NOTIFICATION_READ'
  | 'NOTIFICATION_READ_ALL'
  | 'DRIVER_ARRIVED'
  | 'DRIVER_ARRIVED_AT_FACILITY'
  | 'FACILITY_HANDOVER'
  | 'FACILITY_COLLECTED'
  | 'FACILITY_PACKING_CONFIRMED'
  | 'DELIVERY_REASSIGNED'
  | 'RECONNECT_RECONCILE'
  | 'order.created'
  | 'order.updated'
  | 'pickup.updated'
  | 'delivery.updated'
  | 'delivery.status_changed'
  | 'dashboard.updated'
  | 'notification.created'
  | 'task.updated'
  | 'attendance.updated';

export interface RealtimeEventPayload {
  eventId?: string;
  eventType: RealtimeEventType;
  entityId: string;
  orderId?: string;
  orderNumber?: string;
  status?: string;
  facilityId?: string;
  driverId?: string;
  customerId?: string;
  data?: any;
  notification?: any;
  timestamp: string;
  localReceivedAt?: number;
}

export type RealtimeEventListener = (event: RealtimeEventPayload) => void;

interface ChannelSubscription {
  channelName: string;
  refCount: number;
  listeners: Set<RealtimeEventListener>;
  teardownTimer?: ReturnType<typeof setTimeout>;
}

export function resolveSocketUrl(): string {
  // Base URL without /v1 prefix
  return API_BASE_URL.replace(/\/v1\/?$/, '');
}

class RealtimeService {
  private socket: Socket | null = null;
  private currentToken: string | null = null;
  private channels = new Map<string, ChannelSubscription>();
  private appState: AppStateStatus = (AppState.currentState || 'active') as AppStateStatus;
  private appStateSubscription: any = null;
  private isSocketConnected = false;
  private reconnectListeners = new Set<() => void>();
  private recentDedupeKeys = new Map<string, number>();

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

  public getSocket(): Socket | null {
    return this.socket;
  }

  public isConnected(): boolean {
    return this.isSocketConnected;
  }

  public async getOrInitSocket(accessToken?: string): Promise<Socket | null> {
    if (process.env.NODE_ENV === 'test' || typeof jest !== 'undefined') {
      if (!this.socket) {
        this.socket = {
          connected: true,
          emit: () => this.socket,
          on: () => this.socket,
          off: () => this.socket,
          disconnect: () => this.socket,
          connect: () => this.socket,
        } as unknown as Socket;
        this.isSocketConnected = true;
      }
      return this.socket;
    }

    const token = accessToken || this.currentToken;

    if (this.socket) {
      if (token && token !== this.currentToken) {
        this.currentToken = token;
        this.socket.auth = {token};
        if (this.socket.connected) {
          this.socket.disconnect().connect();
        } else {
          this.socket.connect();
        }
      }
      return this.socket;
    }

    if (!token) {
      return null;
    }

    this.currentToken = token;
    const socketUrl = resolveSocketUrl();

    try {
      this.socket = io(socketUrl, {
        auth: {token},
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000,
        transports: ['websocket', 'polling'],
      });

      this.setupSocketListeners(this.socket);
      return this.socket;
    } catch (err) {
      console.warn('[RealtimeService] Socket initialization error:', err);
      return null;
    }
  }

  private setupSocketListeners(socket: Socket) {
    socket.on('connect', () => {
      this.isSocketConnected = true;
      console.log('[RealtimeService] WebSocket connected successfully');

      // Resubscribe active entity rooms (e.g. order rooms)
      for (const channelName of this.channels.keys()) {
        if (channelName.startsWith('order:')) {
          const orderId = channelName.slice(6);
          socket.emit('subscribe:order', {orderId});
        }
      }

      this.notifyReconnect();
    });

    socket.on('disconnect', (reason: string) => {
      this.isSocketConnected = false;
      console.log('[RealtimeService] WebSocket disconnected:', reason);
    });

    socket.on('connect_error', (err: any) => {
      this.isSocketConnected = false;
      // Do not log tokens or sensitive data
      console.warn('[RealtimeService] Connection error:', err?.message || 'Network unavailable');
    });

    socket.on('auth_error', (err: any) => {
      this.isSocketConnected = false;
      console.warn('[RealtimeService] Authentication error from gateway:', err?.message);
    });

    // Listen to standard versioned and legacy event types
    const supportedEvents: RealtimeEventType[] = [
      'order.created',
      'order.updated',
      'pickup.updated',
      'delivery.updated',
      'delivery.status_changed',
      'dashboard.updated',
      'notification.created',
      'task.updated',
      'attendance.updated',
      'ORDER_CREATED',
      'ORDER_STATUS_CHANGED',
      'JOB_AVAILABLE',
      'JOB_CLAIMED',
      'JOB_CONFLICT',
      'ASSIGNMENT_UPDATED',
      'FACILITY_INTAKE',
      'FACILITY_VERIFICATION',
      'PROCESSING_STAGE_STARTED',
      'PROCESSING_STAGE_COMPLETED',
      'PROCESSING_STAGE_CHANGED',
      'QC_DECIDED',
      'QC_UPDATED',
      'CLAIM_UPDATED',
      'REFUND_UPDATED',
      'DRIVER_AVAILABILITY_CHANGED',
      'NOTIFICATION_CREATED',
      'NOTIFICATION_READ',
      'NOTIFICATION_READ_ALL',
      'DRIVER_ARRIVED',
      'DRIVER_ARRIVED_AT_FACILITY',
      'FACILITY_HANDOVER',
      'FACILITY_COLLECTED',
      'FACILITY_PACKING_CONFIRMED',
      'DELIVERY_REASSIGNED',
    ];

    for (const evt of supportedEvents) {
      socket.on(evt, (payload: any) => {
        this.dispatchIncomingEvent(evt, payload);
      });
    }
  }

  private isDuplicateEvent(eventId?: string, entityId?: string, eventType?: string): boolean {
    const key = eventId || `${eventType}:${entityId}`;
    if (!key) return false;

    const now = Date.now();
    // Bounded cleanup
    if (this.recentDedupeKeys.size > 200) {
      for (const [k, timestamp] of this.recentDedupeKeys.entries()) {
        if (now - timestamp > 10000) {
          this.recentDedupeKeys.delete(k);
        }
      }
    }

    const lastSeen = this.recentDedupeKeys.get(key);
    if (lastSeen && now - lastSeen < 3000) {
      return true;
    }
    this.recentDedupeKeys.set(key, now);
    return false;
  }

  private dispatchIncomingEvent(eventType: RealtimeEventType, raw: any) {
    if (!raw) return;

    const eventId = raw.eventId || raw.id;
    const entityId = raw.entityId || raw.orderId || raw.id || '';

    if (this.isDuplicateEvent(eventId, entityId, eventType)) {
      return;
    }

    const payload: RealtimeEventPayload = {
      eventId,
      eventType,
      entityId,
      orderId: raw.orderId || raw.order_id || (raw.order && raw.order.id) || (raw.data && raw.data.order_id),
      orderNumber: raw.orderNumber || raw.order_number || (raw.order && raw.order.order_number),
      status: raw.status || raw.current_status || (raw.order && raw.order.current_status),
      facilityId: raw.facilityId || raw.facility_id,
      driverId: raw.driverId || raw.driver_id,
      customerId: raw.customerId || raw.customer_id,
      data: raw.data !== undefined ? raw.data : raw,
      notification: raw.notification,
      timestamp: raw.timestamp || new Date().toISOString(),
      localReceivedAt: Date.now(),
    };

    // Broadcast to matching channel subscriptions
    for (const [channelName, sub] of this.channels.entries()) {
      if (this.channelMatchesEvent(channelName, payload)) {
        sub.listeners.forEach(cb => {
          try {
            cb(payload);
          } catch (err) {
            console.warn(`[RealtimeService] Listener error on channel ${channelName}:`, err);
          }
        });
      }
    }
  }

  private channelMatchesEvent(channelName: string, event: RealtimeEventPayload): boolean {
    // 1. Exact event name match
    if (channelName === event.eventType) return true;

    // 2. Global operational channels
    if (channelName === 'orders:all') {
      return (
        event.eventType === 'order.created' ||
        event.eventType === 'order.updated' ||
        event.eventType === 'ORDER_CREATED' ||
        event.eventType === 'ORDER_STATUS_CHANGED' ||
        Boolean(event.orderId)
      );
    }

    if (channelName === 'driver:available' || channelName === 'jobs:drivers') {
      return (
        event.eventType === 'JOB_AVAILABLE' ||
        event.eventType === 'JOB_CLAIMED' ||
        event.eventType === 'JOB_CONFLICT' ||
        event.eventType === 'pickup.updated' ||
        event.eventType === 'delivery.updated' ||
        event.eventType === 'ASSIGNMENT_UPDATED' ||
        event.eventType === 'order.created' ||
        event.eventType === 'ORDER_CREATED'
      );
    }

    if (channelName === 'facility:all') {
      return (
        event.eventType === 'FACILITY_INTAKE' ||
        event.eventType === 'FACILITY_VERIFICATION' ||
        event.eventType === 'PROCESSING_STAGE_CHANGED' ||
        event.eventType === 'task.updated' ||
        event.eventType === 'dashboard.updated' ||
        Boolean(event.facilityId)
      );
    }

    if (channelName === 'admin:operations') {
      return true;
    }

    // 3. User-specific / Customer channel: `customer:<id>` or `driver:<id>` or `user:<id>`
    if (channelName.startsWith('customer:')) {
      const customerId = channelName.slice(9);
      return (
        event.customerId === customerId ||
        event.entityId === customerId ||
        (event.data && (event.data.customer_id === customerId || event.data.profile_id === customerId))
      );
    }

    if (channelName.startsWith('driver:')) {
      const driverId = channelName.slice(7);
      return (
        event.driverId === driverId ||
        event.entityId === driverId ||
        (event.data && (event.data.driver_id === driverId || event.data.profile_id === driverId))
      );
    }

    if (channelName.startsWith('facility:')) {
      const facilityId = channelName.slice(9);
      return event.facilityId === facilityId || (event.data && event.data.facility_id === facilityId);
    }

    if (channelName.startsWith('order:')) {
      const orderId = channelName.slice(6);
      return event.orderId === orderId || event.entityId === orderId;
    }

    return false;
  }

  public async subscribeToChannel(
    channelName: string,
    listener: RealtimeEventListener,
    accessToken?: string,
  ): Promise<() => void> {
    await this.getOrInitSocket(accessToken);

    let sub = this.channels.get(channelName);
    if (sub) {
      if (sub.teardownTimer) {
        clearTimeout(sub.teardownTimer);
        sub.teardownTimer = undefined;
      }
      sub.refCount += 1;
      sub.listeners.add(listener);
    } else {
      sub = {
        channelName,
        refCount: 1,
        listeners: new Set<RealtimeEventListener>([listener]),
      };
      this.channels.set(channelName, sub);

      // If subscribing to a specific order, register on the backend socket gateway
      if (channelName.startsWith('order:') && this.socket && this.isSocketConnected) {
        const orderId = channelName.slice(6);
        this.socket.emit('subscribe:order', {orderId});
      }
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
      sub.teardownTimer = setTimeout(() => {
        if (sub.refCount <= 0) {
          if (channelName.startsWith('order:') && this.socket && this.isSocketConnected) {
            const orderId = channelName.slice(6);
            this.socket.emit('unsubscribe:order', {orderId});
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

  private notifyReconnect() {
    this.reconnectListeners.forEach(cb => {
      try {
        cb();
      } catch (err) {
        console.warn('[RealtimeService] Reconnect callback error:', err);
      }
    });

    const reconcilePayload: RealtimeEventPayload = {
      eventType: 'RECONNECT_RECONCILE',
      entityId: 'global',
      timestamp: new Date().toISOString(),
      localReceivedAt: Date.now(),
    };

    const uniqueListeners = new Set<RealtimeEventListener>();
    this.channels.forEach(sub => {
      sub.listeners.forEach(cb => uniqueListeners.add(cb));
    });

    uniqueListeners.forEach(cb => {
      try {
        cb(reconcilePayload);
      } catch {
        // Safe catch
      }
    });
  }

  private handleAppForeground() {
    if (this.socket && !this.isSocketConnected) {
      this.socket.connect();
    } else if (this.isSocketConnected) {
      this.notifyReconnect();
    }
  }

  public setAuthToken(token: string | null) {
    if (token === this.currentToken) return;
    this.currentToken = token;
    if (this.socket) {
      if (token) {
        this.socket.auth = {token};
        if (this.socket.connected) {
          this.socket.disconnect().connect();
        } else {
          this.socket.connect();
        }
      } else {
        this.disconnect();
      }
    }
  }

  public disconnect() {
    if (this.socket) {
      try {
        this.socket.disconnect();
      } catch {
        // Safe catch
      }
      this.socket = null;
    }
    this.isSocketConnected = false;
    this.currentToken = null;
    this.channels.clear();
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
          console.warn('[RealtimeService] Local event callback error:', err);
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
      sub = {
        channelName,
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
