import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {openDriverNotification} from '../services/driverNotifications';
import {useDriverRealtime} from '../hooks/useRealtime';
import {RealtimeEventPayload} from '../services/realtimeService';
import {
  CustomerNotification,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationOrderNumber,
} from '../services/notificationsApi';
import {useSafeFocusEffect} from '../hooks/useSafeFocusEffect';

type Props = {
  accessToken: string;
  role: string | null;
  onBack: () => void;
  onJob: (assignmentId: string) => void;
};

export default function DriverNotificationsScreen({
  accessToken,
  role,
  onBack,
  onJob,
}: Props) {
  const [items, setItems] = useState<CustomerNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [error, setError] = useState('');

  const requestSeqRef = useRef(0);
  const itemsRef = useRef<CustomerNotification[]>([]);
  itemsRef.current = items;

  const load = useCallback(
    async (refresh = false) => {
      const seq = ++requestSeqRef.current;
      if (refresh) setRefreshing(true);
      else if (itemsRef.current.length === 0) setLoading(true);
      setError('');
      try {
        const nextItems = await getNotifications(accessToken);
        if (seq === requestSeqRef.current) {
          setItems(nextItems);
        }
      } catch {
        if (seq === requestSeqRef.current) {
          setError('Driver notifications unavailable. Retry when connected.');
        }
      } finally {
        if (seq === requestSeqRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [accessToken],
  );

  useEffect(() => {
    if (role === 'driver') load();
  }, [load, role]);

  useSafeFocusEffect(
    useCallback(() => {
      if (role === 'driver') load(true);
    }, [load, role]),
  );

  const handleRealtimeEvent = useCallback(
    (event: RealtimeEventPayload) => {
      if (event.eventType === 'NOTIFICATION_CREATED' && event.notification) {
        const newNotif = event.notification as CustomerNotification;
        setItems(prev => {
          if (prev.some(p => p.id === newNotif.id)) return prev;
          return [newNotif, ...prev];
        });
      } else if (
        event.eventType === 'JOB_AVAILABLE' ||
        event.eventType === 'JOB_CLAIMED' ||
        event.eventType === 'ASSIGNMENT_UPDATED' ||
        event.eventType === 'ORDER_STATUS_CHANGED'
      ) {
        load(true);
      }
    },
    [load],
  );

  useDriverRealtime(null, handleRealtimeEvent, accessToken, role === 'driver');

  const handleMarkAllRead = async () => {
    if (markingAllRead) return;
    setMarkingAllRead(true);
    // Optimistic UI update
    setItems(current => current.map(item => ({...item, is_read: true})));
    try {
      await markAllNotificationsRead(accessToken);
    } catch {
      // Retain optimistic state
    } finally {
      setMarkingAllRead(false);
    }
  };

  const open = async (item: CustomerNotification) => {
    if (busyId) return;
    setBusyId(item.id);
    setError('');
    // Optimistic mark as read
    if (!item.is_read) {
      setItems(current =>
        current.map(value =>
          value.id === item.id ? {...value, is_read: true} : value,
        ),
      );
      if (typeof markNotificationRead === 'function') {
        try {
          markNotificationRead(accessToken, item.id).catch(() => {});
        } catch {
          // safe fallback
        }
      }
    }
    try {
      await openDriverNotification(accessToken, role, item, onJob);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to open Driver job.');
    } finally {
      setBusyId(null);
    }
  };

  const unreadCount = items.filter(i => !i.is_read).length;

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />
        }>
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack}>
            <Text style={styles.link}>← Back to dashboard</Text>
          </TouchableOpacity>
          {unreadCount > 0 ? (
            <TouchableOpacity
              onPress={handleMarkAllRead}
              disabled={markingAllRead}
              accessibilityRole="button"
              accessibilityLabel="Mark all as read">
              <Text style={styles.markAllText}>
                {markingAllRead ? 'Marking...' : 'Mark all read'}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <Text style={styles.title}>Driver notifications</Text>
        {role !== 'driver' ? (
          <Text accessibilityRole="alert">Sign in as a Driver to view notifications.</Text>
        ) : null}
        {loading && items.length === 0 && role === 'driver' ? (
          <ActivityIndicator accessibilityLabel="Loading Driver notifications" />
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
        {error ? (
          <TouchableOpacity onPress={() => load()}>
            <Text style={styles.link}>Retry notifications</Text>
          </TouchableOpacity>
        ) : null}
        {!loading && !error && !items.length ? (
          <Text>No Driver notifications yet.</Text>
        ) : null}
        {role === 'driver'
          ? items.map(item => {
              const orderNum = notificationOrderNumber(item);

              return (
                <TouchableOpacity
                  key={item.id}
                  accessibilityRole="button"
                  disabled={Boolean(busyId)}
                  onPress={() => open(item)}
                  style={[styles.card, !item.is_read && styles.unread]}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.heading}>{item.title}</Text>
                    {!item.is_read && <View style={styles.unreadDot} />}
                  </View>

                  {orderNum ? (
                    <View style={styles.orderBadge}>
                      <Text style={styles.orderBadgeText}>Order {orderNum}</Text>
                    </View>
                  ) : null}

                  <Text style={styles.body}>
                    {item.body || item.message || 'Assignment update'}
                  </Text>
                  <Text style={styles.actionText}>
                    {busyId === item.id ? 'Opening job...' : 'View assigned job →'}
                  </Text>
                </TouchableOpacity>
              );
            })
          : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#fff'},
  content: {padding: 20, gap: 16},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {fontSize: 26, fontWeight: '700'},
  link: {fontWeight: '700', color: '#111827'},
  markAllText: {fontSize: 13, fontWeight: '700', color: '#2563EB'},
  error: {color: '#a11'},
  card: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    padding: 14,
    gap: 6,
    backgroundColor: '#fff',
  },
  unread: {backgroundColor: '#f3f0ea', borderColor: '#111'},
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heading: {fontWeight: '700', fontSize: 16, color: '#111'},
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2563EB',
  },
  orderBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#111827',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 5,
  },
  orderBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  body: {
    fontSize: 13,
    color: '#4B5563',
    lineHeight: 18,
  },
  actionText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111827',
    marginTop: 4,
  },
});
