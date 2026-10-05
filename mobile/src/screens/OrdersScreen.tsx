import React, {
  useCallback,
  useMemo,
  useState,
} from 'react';
import {
  FlatList,
  RefreshControl,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {useFocusEffect} from '@react-navigation/native';
import AppIcon from '../components/AppIcon';
import OrderStatusBadge from '../components/OrderStatusBadge';
import StateView from '../components/StateView';
import {
  borderRadius,
  colors,
  shadows,
  spacing,
  typography,
} from '../theme/designSystem';

import {getOrders} from '../services/ordersApi';
import {CustomerOrder, isPastOrder} from '../types/order';
import {filterOrderHistory} from '../utils/orderHistory';
import {formatMoney} from '../utils/orderPricing';

type OrdersScreenProps = {
  accessToken: string;
  onBack: () => void;
  onOpenOrder: (orderId: string) => void;
};

type Tab = 'active' | 'past';

function formatOrderDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function OrdersScreen({
  accessToken,
  onBack,
  onOpenOrder,
}: OrdersScreenProps) {
  const [tab, setTab] = useState<Tab>('active');
  const [search, setSearch] = useState('');
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOrders = useCallback(
    async (isRefresh = false) => {
      try {
        if (isRefresh) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }
        setError(null);
        const result = await getOrders(accessToken);
        setOrders(result);
      } catch (loadError: any) {
        setError(loadError?.message || 'Unable to load orders.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [accessToken],
  );

  useFocusEffect(
    useCallback(() => {
      loadOrders();
    }, [loadOrders]),
  );

  const activeOrders = useMemo(
    () => orders.filter(order => !isPastOrder(order.current_status)),
    [orders],
  );

  const pastOrders = useMemo(
    () => orders.filter(order => isPastOrder(order.current_status)),
    [orders],
  );

  const visibleOrders = filterOrderHistory(
    tab === 'active' ? activeOrders : pastOrders,
    search,
  );

  const renderOrderItem = ({item: order}: {item: CustomerOrder}) => {
    const itemCount = (order.order_items ?? []).reduce(
      (total, item) => total + Number(item.quantity),
      0,
    );

    const orderNumber = order.order_number || order.id.slice(0, 8);

    return (
      <TouchableOpacity
        key={order.id}
        accessibilityRole="button"
        accessibilityLabel={`Order ${orderNumber}, Status ${order.current_status}, Total ₹${formatMoney(order.total_amount)}`}
        activeOpacity={0.7}
        style={styles.orderCard}
        onPress={() => onOpenOrder(order.id)}>
        <View style={styles.orderTopRow}>
          <View style={styles.flex}>
            <Text style={styles.orderNumberLabel}>ORDER NUMBER</Text>
            <Text style={styles.orderNumber}>{orderNumber}</Text>
          </View>
          <OrderStatusBadge status={order.current_status} />
        </View>

        <View style={styles.divider} />

        <View style={styles.orderInfoRow}>
          <View style={styles.orderInfoBlock}>
            <Text style={styles.infoLabel}>Scheduled Pickup</Text>
            <Text style={styles.infoValue}>
              {formatOrderDateTime(order.pickup_scheduled_at)}
            </Text>
            {order.pickup_slot_label ? (
              <Text style={styles.slotText}>{order.pickup_slot_label}</Text>
            ) : null}
          </View>

          <View style={styles.orderInfoBlockRight}>
            <Text style={styles.infoLabel}>Total Amount</Text>
            <Text style={styles.amount}>₹{formatMoney(order.total_amount)}</Text>
          </View>
        </View>

        <View style={styles.orderFooter}>
          <Text style={styles.itemCount}>
            {itemCount} {itemCount === 1 ? 'garment' : 'garments'}
          </Text>

          <View style={styles.viewDetailsRow}>
            <Text style={styles.viewDetails}>View Order</Text>
            <AppIcon name="arrow-right" size={14} color={colors.primary} strokeWidth={2.5} />
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={styles.backBtn}
          onPress={onBack}>
          <View style={styles.backRow}>
            <AppIcon name="arrow-left" size={16} color={colors.textPrimary} />
            <Text style={styles.back}>Back</Text>
          </View>
        </TouchableOpacity>

        <Text style={styles.headerTitle}>Your Orders</Text>

        <View style={styles.headerSpacer} />
      </View>

      {/* Search Input */}
      <View style={styles.searchContainer}>
        <AppIcon name="search" size={16} color={colors.textMuted} />
        <TextInput
          accessibilityLabel="Search orders"
          placeholder="Search by order number or status"
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
          style={styles.searchInput}
        />
        {search ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            onPress={() => setSearch('')}>
            <AppIcon name="close" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`Active orders tab (${activeOrders.length})`}
          style={[styles.tab, tab === 'active' && styles.tabActive]}
          onPress={() => setTab('active')}>
          <Text style={[styles.tabText, tab === 'active' && styles.tabTextActive]}>
            Active ({activeOrders.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`Past orders tab (${pastOrders.length})`}
          style={[styles.tab, tab === 'past' && styles.tabActive]}
          onPress={() => setTab('past')}>
          <Text style={[styles.tabText, tab === 'past' && styles.tabTextActive]}>
            Past ({pastOrders.length})
          </Text>
        </TouchableOpacity>
      </View>

      {loading && !refreshing ? (
        <StateView type="loading" message="Loading your orders..." />
      ) : error ? (
        <StateView
          type="error"
          title="Unable to load orders"
          message={error}
          actionLabel="Retry"
          onAction={() => loadOrders()}
        />
      ) : (
        <FlatList
          data={visibleOrders}
          keyExtractor={item => item.id}
          renderItem={renderOrderItem}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadOrders(true)}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <StateView
              type="empty"
              icon="box"
              title={
                search.trim()
                  ? 'No matching orders'
                  : tab === 'active'
                  ? 'No active orders'
                  : 'No past orders'
              }
              message={
                search.trim()
                  ? 'Try searching with another order number or keyword.'
                  : tab === 'active'
                  ? 'Your active laundry orders will appear here once scheduled.'
                  : 'Completed and delivered laundry orders will appear here.'
              }
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  header: {
    height: 56,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backBtn: {
    minWidth: 54,
    minHeight: 44,
    justifyContent: 'center',
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  back: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  headerSpacer: {
    width: 54,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    height: 44,
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    ...typography.body,
    color: colors.textPrimary,
    paddingVertical: 0,
  },
  tabs: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: 4,
    borderRadius: borderRadius.md,
    backgroundColor: '#E5E7EB',
    flexDirection: 'row',
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    minHeight: 38,
    justifyContent: 'center',
  },
  tabActive: {
    backgroundColor: colors.primary,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  tabTextActive: {
    color: colors.textInverse,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  orderCard: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.sm,
  },
  orderTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  orderNumberLabel: {
    fontSize: 10,
    color: colors.textMuted,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  orderNumber: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  orderInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  orderInfoBlock: {
    flex: 1,
    paddingRight: spacing.md,
  },
  orderInfoBlockRight: {
    alignItems: 'flex-end',
  },
  infoLabel: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
    lineHeight: 18,
  },
  slotText: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  amount: {
    fontSize: 18,
    fontWeight: '900',
    color: colors.textPrimary,
  },
  orderFooter: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemCount: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
  },
  viewDetailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  viewDetails: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.primary,
  },
});
