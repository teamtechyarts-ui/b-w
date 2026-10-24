import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Alert,
  NativeModules,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useSafeFocusEffect} from '../hooks/useSafeFocusEffect';
import {useCustomerRealtime} from '../hooks/useRealtime';
import {RealtimeEventPayload} from '../services/realtimeService';
import {
  CustomerNotification,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationOrderId,
  notificationOrderNumber,
  sendDevTestNotification,
} from '../services/notificationsApi';

type Props = {
  accessToken: string;
  onBack: () => void;
  onOpenOrder: (orderId: string) => void;
};

export default function NotificationsScreen({
  accessToken,
  onBack,
  onOpenOrder,
}: Props) {
  const [items, setItems] = useState<CustomerNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [testPushBusy, setTestPushBusy] = useState(false);

  const handleSendTestPush = async () => {
    setTestPushBusy(true);
    try {
      const res = await sendDevTestNotification(accessToken, {
        title: 'Bright & White Push Test',
        body: 'Push notification received successfully on your device!',
      });
      if (res.ok) {
        Alert.alert(
          'Push Sent',
          'FCM accepted the notification for delivery. Check your device notification shade/tray.',
        );
      } else {
        Alert.alert(
          'Push Test Result',
          res.reason === 'no_active_devices'
            ? 'No registered active devices found for this account. Ensure notification permissions are allowed.'
            : `FCM dispatch status: ${res.status} (${res.reason || 'not delivered'})`,
        );
      }
    } catch (err: any) {
      Alert.alert(
        'Push Test Error',
        err?.message || 'Unable to trigger test push notification.',
      );
    } finally {
      setTestPushBusy(false);
    }
  };

  const requestIosPermission = async () => {
    setPermissionBusy(true);
    setPermissionMessage(null);
    try {
      const granted =
        await NativeModules.BWNotificationPermission?.requestPermission?.();
      if (typeof granted !== 'boolean')
        throw new Error('Notification permission is unavailable.');
      setPermissionMessage(
        granted
          ? 'iPhone alerts are allowed.'
          : 'iPhone alerts are off. You can change this in Settings.',
      );
    } catch {
      setPermissionMessage(
        'Unable to request iPhone alerts. Please try again.',
      );
    } finally {
      setPermissionBusy(false);
    }
  };

  const requestSeqRef = useRef(0);
  const itemsRef = useRef<CustomerNotification[]>([]);
  itemsRef.current = items;

  const load = useCallback(
    async (refresh = false) => {
      const seq = ++requestSeqRef.current;
      try {
        if (refresh) setRefreshing(true);
        else if (itemsRef.current.length === 0) setLoading(true);
        setError(null);
        const nextItems = await getNotifications(accessToken);
        if (seq === requestSeqRef.current) {
          setItems(nextItems);
        }
      } catch (loadError: any) {
        if (seq === requestSeqRef.current) {
          setError(
            loadError?.message || 'Notifications are temporarily unavailable.',
          );
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
    load();
  }, [load]);

  useSafeFocusEffect(
    useCallback(() => {
      load(true);
    }, [load]),
  );

  const handleRealtimeEvent = useCallback(
    (event: RealtimeEventPayload) => {
      if (event.eventType === 'NOTIFICATION_CREATED' && event.notification) {
        const newNotif = event.notification as CustomerNotification;
        setItems(prev => {
          if (prev.some(p => p.id === newNotif.id)) return prev;
          return [newNotif, ...prev];
        });
      } else if (event.eventType === 'ORDER_STATUS_CHANGED') {
        load(true);
      }
    },
    [load],
  );

  useCustomerRealtime(null, handleRealtimeEvent, accessToken);

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
    if (!item.is_read) {
      // Optimistic mark as read
      setItems(current =>
        current.map(value =>
          value.id === item.id ? {...value, is_read: true} : value,
        ),
      );
      markNotificationRead(accessToken, item.id).catch(() => {});
    }
    const orderId = notificationOrderId(item);
    if (orderId) onOpenOrder(orderId);
  };

  const unreadCount = items.filter(i => !i.is_read).length;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} accessibilityRole="button" accessibilityLabel="Go back">
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Notifications</Text>
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
        ) : (
          <View style={styles.spacer} />
        )}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />
        }>
        {Platform.OS === 'ios' ? (
          <View style={styles.permissionCard}>
            <Text style={styles.itemTitle}>Order alerts</Text>
            <TouchableOpacity
              accessibilityRole="button"
              disabled={permissionBusy}
              onPress={requestIosPermission}>
              <Text style={styles.permissionButton}>
                {permissionBusy ? 'Checking permission...' : 'Enable iPhone alerts'}
              </Text>
            </TouchableOpacity>
            {permissionMessage ? (
              <Text accessibilityRole="alert" style={styles.message}>
                {permissionMessage}
              </Text>
            ) : null}
          </View>
        ) : null}

        {__DEV__ ? (
          <View style={styles.permissionCard}>
            <Text style={styles.itemTitle}>Developer Push Test</Text>
            <Text style={[styles.message, {marginBottom: 8}]}>
              Send a test FCM push notification to your registered device.
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              disabled={testPushBusy}
              onPress={handleSendTestPush}>
              <Text style={styles.permissionButton}>
                {testPushBusy ? 'Sending Test Push...' : 'Send Test Notification'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {loading && items.length === 0 ? <Text style={styles.message}>Loading notifications...</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!loading && !error && items.length === 0 ? (
          <Text style={styles.message}>You have no notifications yet.</Text>
        ) : null}

        {items.map(item => {
          const orderNum = notificationOrderNumber(item);
          const orderId = notificationOrderId(item);

          return (
            <TouchableOpacity
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={`Notification: ${item.title}`}
              style={[styles.item, !item.is_read && styles.unread]}
              onPress={() => open(item)}>
              <View style={styles.itemHeaderRow}>
                <Text style={styles.itemTitle}>{item.title}</Text>
                {!item.is_read && <View style={styles.unreadBadge} />}
              </View>

              {orderNum ? (
                <View style={styles.orderBadge}>
                  <Text style={styles.orderBadgeText}>Order {orderNum}</Text>
                </View>
              ) : null}

              <Text style={styles.itemBody}>
                {item.body || item.message || 'Order update'}
              </Text>

              <View style={styles.itemFooter}>
                <Text style={styles.itemDate}>
                  {new Date(item.created_at).toLocaleString('en-IN')}
                </Text>
                {orderId ? (
                  <Text style={styles.viewOrderAction}>View Order →</Text>
                ) : null}
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#FFFFFF'},
  header: {
    height: 65,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  back: {fontWeight: '700', fontSize: 15, color: '#111827'},
  title: {fontSize: 18, fontWeight: '800', color: '#111827'},
  markAllText: {fontSize: 13, fontWeight: '700', color: '#2563EB'},
  spacer: {width: 42},
  content: {padding: 20, gap: 12},
  item: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    padding: 16,
    backgroundColor: '#FFFFFF',
  },
  unread: {
    backgroundColor: '#F9F8F6',
    borderColor: '#111827',
  },
  itemHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  itemTitle: {fontSize: 15, fontWeight: '800', color: '#111827', flex: 1},
  unreadBadge: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2563EB',
    marginLeft: 8,
  },
  orderBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#111827',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginBottom: 6,
  },
  orderBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  itemBody: {
    marginTop: 2,
    fontSize: 13,
    color: '#4B5563',
    lineHeight: 19,
  },
  itemFooter: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemDate: {fontSize: 11, color: '#9CA3AF'},
  viewOrderAction: {fontSize: 12, fontWeight: '800', color: '#111827'},
  message: {textAlign: 'center', color: '#666666', marginTop: 12},
  error: {color: '#B42318', textAlign: 'center', marginTop: 40},
  permissionCard: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    padding: 15,
    backgroundColor: '#F9FAFB',
  },
  permissionButton: {marginTop: 10, fontWeight: '700', color: '#111827'},
});
