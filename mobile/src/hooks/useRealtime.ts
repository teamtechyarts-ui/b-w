import {useCallback, useEffect, useRef} from 'react';
import {
  realtimeService,
  RealtimeEventListener,
  RealtimeEventPayload,
} from '../services/realtimeService';
import {invalidateOrdersCache} from '../services/ordersApi';

/**
 * Low-level hook to subscribe to any Supabase Realtime channel.
 * Multiplexes channel connections across components.
 */
export function useRealtimeSubscription(
  channelName: string | null | undefined,
  onEvent: RealtimeEventListener,
  accessToken?: string,
  enabled: boolean = true,
) {
  const listenerRef = useRef<RealtimeEventListener>(onEvent);
  listenerRef.current = onEvent;

  useEffect(() => {
    if (!enabled || !channelName) return;

    const listener: RealtimeEventListener = (event: RealtimeEventPayload) => {
      listenerRef.current(event);
    };

    let isCancelled = false;
    let cleanupFn: (() => void) | undefined;

    realtimeService
      .subscribeToChannel(channelName, listener, accessToken)
      .then(unsub => {
        if (isCancelled) {
          try {
            unsub();
          } catch {
            // Safe cleanup
          }
        } else {
          cleanupFn = unsub;
        }
      })
      .catch(err => {
        if (!isCancelled) {
          console.warn(`[useRealtimeSubscription] Failed to subscribe to ${channelName}:`, err);
        }
      });

    return () => {
      isCancelled = true;
      if (cleanupFn) {
        cleanupFn();
      }
    };
  }, [channelName, accessToken, enabled]);
}

function extractSubFromJwt(token?: string): string | null {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length >= 2) {
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const json =
        typeof atob === 'function'
          ? atob(base64)
          : typeof Buffer !== 'undefined'
          ? Buffer.from(base64, 'base64').toString('utf8')
          : null;
      if (json) {
        const payload = JSON.parse(json);
        return payload.sub || payload.user_id || payload.id || null;
      }
    }
  } catch {
    // safe fallback
  }
  return null;
}

// Cross-channel deduplication for multiplexed event broadcasts
const recentEventTimestamps = new Map<string, number>();

export function isDuplicateRealtimeEvent(
  event: RealtimeEventPayload,
  windowMs = 2500,
): boolean {
  if (!event || !event.eventType) return false;
  const eventId =
    (event as any).id ||
    event.entityId ||
    (event as any).notification?.id ||
    (event.orderId ? `${event.eventType}:${event.orderId}` : null);

  if (!eventId) return false;
  const key = `${event.eventType}:${eventId}`;
  const now = Date.now();

  if (recentEventTimestamps.size > 200) {
    for (const [k, timestamp] of recentEventTimestamps.entries()) {
      if (now - timestamp > 10000) {
        recentEventTimestamps.delete(k);
      }
    }
  }

  const lastSeen = recentEventTimestamps.get(key);
  if (lastSeen && now - lastSeen < windowMs) {
    return true;
  }
  recentEventTimestamps.set(key, now);
  return false;
}

/**
 * Customer hook: Subscribes to customer order status changes, delivery updates, and claims.
 */
export function useCustomerRealtime(
  customerIdOrProfileId: string | null | undefined,
  onEvent: (event: RealtimeEventPayload) => void,
  accessToken?: string,
  enabled: boolean = true,
) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const handleCustomerEvent = useCallback((event: RealtimeEventPayload) => {
    if (isDuplicateRealtimeEvent(event)) {
      return;
    }
    invalidateOrdersCache();
    onEventRef.current(event);
  }, []);

  useRealtimeSubscription('orders:all', handleCustomerEvent, accessToken, enabled);
  const channelName = customerIdOrProfileId
    ? `customer:${customerIdOrProfileId}`
    : null;
  useRealtimeSubscription(channelName, handleCustomerEvent, accessToken, enabled && !!customerIdOrProfileId);

  const derivedId = extractSubFromJwt(accessToken);
  const derivedChannel =
    derivedId && derivedId !== customerIdOrProfileId
      ? `customer:${derivedId}`
      : null;
  useRealtimeSubscription(
    derivedChannel,
    handleCustomerEvent,
    accessToken,
    enabled && !!derivedChannel,
  );
}

/**
 * Driver hook: Subscribes to available pickup/delivery job pool, assignment updates,
 * and conflict drops (when another driver claims a job).
 */
export function useDriverRealtime(
  driverId: string | null | undefined,
  onEvent: (event: RealtimeEventPayload) => void,
  accessToken?: string,
  enabled: boolean = true,
) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const handleDriverEvent = useCallback((event: RealtimeEventPayload) => {
    if (isDuplicateRealtimeEvent(event)) {
      return;
    }
    onEventRef.current(event);
  }, []);

  useRealtimeSubscription('driver:available', handleDriverEvent, accessToken, enabled);
  useRealtimeSubscription('jobs:drivers', handleDriverEvent, accessToken, enabled);

  // If driverId is known, listen to private driver-specific assignment channel
  const privateChannel = driverId ? `driver:${driverId}` : null;
  useRealtimeSubscription(privateChannel, handleDriverEvent, accessToken, enabled && !!driverId);

  // Also derive driver profile sub from JWT to immediately listen to driver:${sub} before profile load
  const derivedSub = extractSubFromJwt(accessToken);
  const derivedChannel =
    derivedSub && derivedSub !== driverId ? `driver:${derivedSub}` : null;
  useRealtimeSubscription(
    derivedChannel,
    handleDriverEvent,
    accessToken,
    enabled && !!derivedChannel,
  );
}

/**
 * Facility hook: Subscribes to incoming shipments, intake status, processing stages,
 * QC results, and delivery driver collections for this facility.
 */
export function useFacilityRealtime(
  facilityId: string | null | undefined,
  onEvent: (event: RealtimeEventPayload) => void,
  accessToken?: string,
  enabled: boolean = true,
) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const handleFacilityEvent = useCallback((event: RealtimeEventPayload) => {
    onEventRef.current(event);
  }, []);

  useRealtimeSubscription('facility:all', handleFacilityEvent, accessToken, enabled);
  const channelName = facilityId ? `facility:${facilityId}` : null;
  useRealtimeSubscription(channelName, handleFacilityEvent, accessToken, enabled && !!facilityId);

  const handleOrdersAll = useCallback(
    (event: RealtimeEventPayload) => {
      const payload = (event as any).payload || event;
      const eventFacilityId =
        payload?.facilityId ||
        payload?.facility_id ||
        (event as any).facilityId ||
        (event as any).facility_id ||
        (event as any).record?.facility_id;

      // If event explicitly targets another facility, ignore it
      if (facilityId && eventFacilityId && eventFacilityId !== facilityId) {
        return;
      }

      onEventRef.current(event);
    },
    [facilityId],
  );

  useRealtimeSubscription('orders:all', handleOrdersAll, accessToken, enabled);
}

/**
 * Admin hook: Subscribes to global operations monitoring, order volume metrics,
 * driver assignments, customer claims, and refund requests.
 */
export function useAdminRealtime(
  onEvent: (event: RealtimeEventPayload) => void,
  accessToken?: string,
  enabled: boolean = true,
) {
  useRealtimeSubscription('admin:operations', onEvent, accessToken, enabled);
}

/**
 * Order-specific hook: Listens to real-time events for a single active order.
 */
export function useOrderRealtime(
  orderId: string | null | undefined,
  onEvent: (event: RealtimeEventPayload) => void,
  accessToken?: string,
  enabled: boolean = true,
) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const handleOrderEvent = useCallback(
    (event: RealtimeEventPayload) => {
      invalidateOrdersCache();
      onEventRef.current(event);
    },
    [],
  );

  const channelName = orderId ? `order:${orderId}` : null;
  useRealtimeSubscription(channelName, handleOrderEvent, accessToken, enabled && !!orderId);

  const handleAllOrders = useCallback(
    (event: RealtimeEventPayload) => {
      const payloadOrderId = event.orderId || event.entityId || (event as any).record?.id;
      if (orderId && payloadOrderId === orderId) {
        invalidateOrdersCache();
        onEventRef.current(event);
      }
    },
    [orderId],
  );

  useRealtimeSubscription('orders:all', handleAllOrders, accessToken, enabled && !!orderId);
}
