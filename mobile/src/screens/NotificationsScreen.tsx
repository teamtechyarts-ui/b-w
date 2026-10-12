import React, {useCallback, useEffect, useState} from 'react';
import {
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
import {
  CustomerNotification,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationOrderId,
  notificationOrderNumber,
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

  const load = useCallback(
    async (refresh = false) => {
      try {
        refresh ? setRefreshing(true) : setLoading(true);
        setError(null);
        setItems(await getNotifications(accessToken));
      } catch (loadError: any) {
        setError(
          loadError?.message || 'Notifications are temporarily unavailable.',
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [accessToken],
  );

  useEffect(() => {
    load();
  }, [load]);

  const handleMarkAllRead = async () => {
    if (markingAllRead) return;
    setMarkingAllRead(true);
    try {
      await markAllNotificationsRead(accessToken);
      setItems(current => current.map(item => ({...item, is_read: true})));
    } catch {
      // Graceful fallback: local update
      setItems(current => current.map(item => ({...item, is_read: true})));
    } finally {
      setMarkingAllRead(false);
    }
  };

  const open = async (item: CustomerNotification) => {
    if (!item.is_read) {
      try {
        const updated = await markNotificationRead(accessToken, item.id);
        setItems(current =>
          current.map(value => (value.id === item.id ? updated : value)),
        );
      } catch {
        setItems(current =>
          current.map(value =>
            value.id === item.id ? {...value, is_read: true} : value,
          ),
        );
      }
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

        {loading ? <Text style={styles.message}>Loading notifications...</Text> : null}
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
