import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {openDriverNotification} from '../services/driverNotifications';
import {
  CustomerNotification,
  getNotifications,
  notificationOrderNumber,
} from '../services/notificationsApi';

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
  const [error, setError] = useState('');

  const load = useCallback(
    async (refresh = false) => {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError('');
      try {
        setItems(await getNotifications(accessToken));
      } catch {
        setError('Driver notifications unavailable. Retry when connected.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [accessToken],
  );

  useEffect(() => {
    if (role === 'driver') load();
  }, [load, role]);

  const open = async (item: CustomerNotification) => {
    if (busyId) return;
    setBusyId(item.id);
    setError('');
    try {
      await openDriverNotification(accessToken, role, item, onJob);
      setItems(current =>
        current.map(value =>
          value.id === item.id ? {...value, is_read: true} : value,
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to open Driver job.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />
        }>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.link}>← Back to dashboard</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Driver notifications</Text>
        {role !== 'driver' ? (
          <Text accessibilityRole="alert">Sign in as a Driver to view notifications.</Text>
        ) : null}
        {loading && role === 'driver' ? (
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
  title: {fontSize: 26, fontWeight: '700'},
  link: {fontWeight: '700', color: '#111827'},
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
