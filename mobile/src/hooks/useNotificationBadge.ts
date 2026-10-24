import {useCallback, useEffect, useRef, useState} from 'react';
import {AppState, AppStateStatus} from 'react-native';
import {
  getUnreadNotificationsCount,
  incrementUnreadNotificationsCount,
  refreshUnreadNotificationsCount,
  setUnreadNotificationsCount,
  subscribeToUnreadNotificationsCount,
} from '../services/notificationsApi';
import {
  useAdminRealtime,
  useCustomerRealtime,
  useDriverRealtime,
  useFacilityRealtime,
} from './useRealtime';
import {RealtimeEventPayload} from '../services/realtimeService';
import {soundService} from '../services/soundService';

export function useNotificationBadge(
  accessToken?: string,
  role?: string | null,
  profileId?: string | null,
  enabled: boolean = true,
): number {
  const [unreadCount, setUnreadCountState] = useState<number>(() =>
    getUnreadNotificationsCount(),
  );

  // Sync with global unread count state
  useEffect(() => {
    return subscribeToUnreadNotificationsCount(count => {
      setUnreadCountState(count);
    });
  }, []);

  // Refresh from server on mount and when accessToken becomes available
  useEffect(() => {
    if (enabled && accessToken) {
      refreshUnreadNotificationsCount(accessToken).catch(() => {});
    }
  }, [accessToken, enabled]);

  // Reconcile on AppState return to foreground
  useEffect(() => {
    if (!enabled || !accessToken) return;

    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        refreshUnreadNotificationsCount(accessToken).catch(() => {});
      }
    });

    return () => {
      sub?.remove();
    };
  }, [accessToken, enabled]);

  const seenNotificationIdsRef = useRef<Set<string>>(new Set());
  const refreshTimerRef = useRef<any>(null);

  const scheduleServerCountRefresh = useCallback((token?: string) => {
    if (!token) return;
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      refreshUnreadNotificationsCount(token).catch(() => {});
    }, 400);
  }, []);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  // Handle incoming real-time notifications and operational events
  const handleRealtimeNotification = useCallback((event: RealtimeEventPayload) => {
    if (event.eventType === 'NOTIFICATION_CREATED') {
      const notifId =
        event.entityId ||
        (event as any).notification?.id ||
        (event as any).id ||
        (event.orderId ? `order_${event.orderId}` : null);

      if (notifId) {
        if (seenNotificationIdsRef.current.has(notifId)) {
          return;
        }
        seenNotificationIdsRef.current.add(notifId);
        if (seenNotificationIdsRef.current.size > 200) {
          const first = seenNotificationIdsRef.current.values().next().value;
          if (first) seenNotificationIdsRef.current.delete(first);
        }
      }

      incrementUnreadNotificationsCount(1);
      scheduleServerCountRefresh(accessToken);

      soundService.playNotificationSound({
        id: notifId,
        eventType: event.eventType,
        orderId: event.orderId,
      });
    } else if (event.eventType === 'NOTIFICATION_READ_ALL') {
      seenNotificationIdsRef.current.clear();
      setUnreadNotificationsCount(0);
    } else if (
      [
        'CLAIM_SUBMITTED',
        'CLAIM_APPROVED',
        'CLAIM_RESOLVED',
        'REFUND_APPROVED',
        'REFUND_COMPLETED',
        'ORDER_ASSIGNED',
        'DRIVER_ARRIVED',
        'FACILITY_PROCESSED',
        'STAGE_PROGRESSION',
      ].includes(event.eventType)
    ) {
      soundService.playNotificationSound({
        id: event.entityId || `${event.eventType}_${event.orderId}`,
        eventType: event.eventType,
        orderId: event.orderId,
      });
    }
  }, []);

  // Customer channel subscription
  useCustomerRealtime(
    profileId,
    handleRealtimeNotification,
    accessToken,
    enabled && Boolean(accessToken) && role !== 'driver' && role !== 'facility_operator',
  );

  // Driver channel subscription
  useDriverRealtime(
    profileId,
    handleRealtimeNotification,
    accessToken,
    enabled && Boolean(accessToken) && role === 'driver',
  );

  // Facility channel subscription
  useFacilityRealtime(
    profileId,
    handleRealtimeNotification,
    accessToken,
    enabled && Boolean(accessToken) && role === 'facility_operator',
  );

  // Admin channel subscription
  useAdminRealtime(
    handleRealtimeNotification,
    accessToken,
    enabled && Boolean(accessToken) && role === 'admin',
  );

  return unreadCount;
}

