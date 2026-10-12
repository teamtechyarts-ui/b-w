import {useCallback, useEffect, useRef} from 'react';
import {
  realtimeService,
  RealtimeEventListener,
  RealtimeEventPayload,
} from '../services/realtimeService';

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

/**
 * Customer hook: Subscribes to customer order status changes, delivery updates, and claims.
 */
export function useCustomerRealtime(
  customerIdOrProfileId: string | null | undefined,
  onEvent: (event: RealtimeEventPayload) => void,
  accessToken?: string,
  enabled: boolean = true,
) {
  useRealtimeSubscription('orders:all', onEvent, accessToken, enabled);
  const channelName = customerIdOrProfileId
    ? `customer:${customerIdOrProfileId}`
    : null;
  useRealtimeSubscription(channelName, onEvent, accessToken, enabled && !!customerIdOrProfileId);

  const derivedId = extractSubFromJwt(accessToken);
  const derivedChannel =
    derivedId && derivedId !== customerIdOrProfileId
      ? `customer:${derivedId}`
      : null;
  useRealtimeSubscription(
    derivedChannel,
    onEvent,
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
  useRealtimeSubscription('driver:available', onEvent, accessToken, enabled);
  useRealtimeSubscription('jobs:drivers', onEvent, accessToken, enabled);

  // If driverId is known, also listen to private driver-specific assignment channel
  const privateChannel = driverId ? `driver:${driverId}` : null;
  useRealtimeSubscription(privateChannel, onEvent, accessToken, enabled && !!driverId);
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
  useRealtimeSubscription('facility:all', onEvent, accessToken, enabled);
  const channelName = facilityId ? `facility:${facilityId}` : null;
  useRealtimeSubscription(channelName, onEvent, accessToken, enabled && !!facilityId);
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
  const channelName = orderId ? `order:${orderId}` : null;
  useRealtimeSubscription(channelName, onEvent, accessToken, enabled && !!orderId);

  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const handleAllOrders = useCallback(
    (event: RealtimeEventPayload) => {
      const payloadOrderId = event.orderId || event.entityId || (event as any).record?.id;
      if (orderId && payloadOrderId === orderId) {
        onEventRef.current(event);
      }
    },
    [orderId],
  );

  useRealtimeSubscription('orders:all', handleAllOrders, accessToken, enabled && !!orderId);
}
