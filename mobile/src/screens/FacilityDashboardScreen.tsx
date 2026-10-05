import React, { useCallback, useEffect, useState } from 'react';
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
import {
  AvailableDeliveryDriver,
  FacilityDashboard,
  getAvailableDeliveryDrivers,
  getFacilityDashboard,
  handoverFacilityOrderToDriver,
  reassignFacilityDelivery,
} from '../services/facilityDashboardApi';
import { confirmFacilityReceiptByOrderId } from '../services/facilityIntakeApi';

const READY_STATUSES = [
  'ready_for_delivery',
  'delivery_assigned',
  'delivery_failed',
];

const PROCESSING_STATUSES = [
  'verification',
  'processing',
  'quality_check',
  'rework_required',
];

type Props = {
  accessToken: string;
  onLogout: () => Promise<void>;
  onIntake: () => void;
  onOrder: (orderId: string) => void;
};

export default function FacilityDashboardScreen({
  accessToken,
  onLogout,
  onIntake,
  onOrder,
}: Props) {
  const [tab, setTab] = useState<'incoming' | 'received' | 'processing' | 'ready'>(
    'incoming',
  );
  const [dashboard, setDashboard] = useState<FacilityDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [message, setMessage] = useState('');
  const [driverOrderId, setDriverOrderId] = useState<string | null>(null);
  const [drivers, setDrivers] = useState<AvailableDeliveryDriver[]>([]);
  const [loadingDrivers, setLoadingDrivers] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [handingOverId, setHandingOverId] = useState<string | null>(null);
  const [receivingOrderId, setReceivingOrderId] = useState<string | null>(null);

  const load = useCallback(
    async (refresh = false) => {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError('');
      try {
        const result = await getFacilityDashboard(accessToken);
        setDashboard(result);
      } catch (cause) {
        setDashboard(null);
        setError(
          cause instanceof Error
            ? cause.message
            : 'Facility dashboard unavailable.',
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

  const receiveOrderDirectly = async (orderNumber: string) => {
    if (receivingOrderId) return;
    setReceivingOrderId(orderNumber);
    setActionError('');
    setMessage('');
    try {
      await confirmFacilityReceiptByOrderId(accessToken, orderNumber);
      setMessage(`Order ${orderNumber} received at facility.`);
      await load(true);
      setTab('received');
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : 'Unable to receive order at facility.',
      );
    } finally {
      setReceivingOrderId(null);
    }
  };

  const handover = async (orderId: string, driverId?: string) => {
    if (handingOverId) return;
    setHandingOverId(orderId);
    setActionError('');
    setMessage('');
    try {
      await handoverFacilityOrderToDriver(accessToken, orderId, driverId);
      setMessage('Order handed over to delivery driver.');
      await load(true);
      setTab('ready');
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : 'Unable to hand over order.',
      );
    } finally {
      setHandingOverId(null);
    }
  };

  const showDrivers = async (orderId: string) => {
    setDriverOrderId(orderId);
    setDrivers([]);
    setLoadingDrivers(true);
    setActionError('');
    setMessage('');
    try {
      const result = await getAvailableDeliveryDrivers(accessToken, orderId);
      setDrivers(result.drivers);
    } catch (cause) {
      setActionError(
        cause instanceof Error
          ? cause.message
          : 'Available Drivers unavailable.',
      );
    } finally {
      setLoadingDrivers(false);
    }
  };

  const reassign = async (orderId: string, driver: AvailableDeliveryDriver) => {
    if (reassigning) return;
    setReassigning(true);
    setActionError('');
    setMessage('');
    try {
      await reassignFacilityDelivery(accessToken, orderId, driver.id);
      setDriverOrderId(null);
      setDrivers([]);
      setMessage(`Delivery assigned to ${driver.name}. Waiting for acceptance.`);
      await load(true);
      setTab('ready');
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : 'Unable to reassign delivery.',
      );
    } finally {
      setReassigning(false);
    }
  };

  const filteredOrders = (dashboard?.orders ?? []).filter(order => {
    if (tab === 'incoming') {
      return order.current_status === 'in_transit_to_facility';
    }
    if (tab === 'received') {
      return order.current_status === 'received_at_facility';
    }
    if (tab === 'processing') {
      return PROCESSING_STATUSES.includes(order.current_status);
    }
    return READY_STATUSES.includes(order.current_status);
  });

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              load(true);
            }}
          />
        }
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>FACILITY OPERATIONS</Text>
            <Text style={styles.title}>Work queue</Text>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => {
              load(true);
            }}
          >
            <Text style={styles.link}>Refresh</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          accessibilityRole="button"
          style={styles.scanButton}
          onPress={onIntake}
        >
          <Text style={styles.scanText}>▣ Scan incoming order</Text>
        </TouchableOpacity>

        {loading ? (
          <ActivityIndicator accessibilityLabel="Loading facility dashboard" />
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
        {actionError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {actionError}
          </Text>
        ) : null}
        {message ? <Text accessibilityRole="alert" style={styles.successMessage}>{message}</Text> : null}
        {error ? (
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => {
              load();
            }}
          >
            <Text style={styles.link}>Retry dashboard</Text>
          </TouchableOpacity>
        ) : null}

        {dashboard ? (
          <>
            <View style={styles.facilityCard}>
              <View style={styles.facilityIdentity}>
                <Text style={styles.heading}>{dashboard.facility.name}</Text>
                <Text style={styles.muted}>
                  {dashboard.role === 'manager'
                    ? 'Facility Manager'
                    : 'Facility Employee'}
                </Text>
              </View>
            </View>
            {dashboard.facility.address ? (
              <Text style={styles.muted}>{dashboard.facility.address}</Text>
            ) : null}

            <View style={styles.tabs}>
              {(
                [
                  {
                    key: 'incoming',
                    label: 'Incoming',
                    count: dashboard.summary.incoming,
                  },
                  {
                    key: 'received',
                    label: 'Received',
                    count: dashboard.summary.received,
                  },
                  {
                    key: 'processing',
                    label: 'Processing',
                    count: dashboard.summary.processing,
                  },
                  {
                    key: 'ready',
                    label: 'Ready',
                    count: dashboard.summary.ready,
                  },
                ] as const
              ).map(item => (
                <TouchableOpacity
                  key={item.key}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: tab === item.key }}
                  style={[styles.tab, tab === item.key && styles.activeTab]}
                  onPress={() => setTab(item.key)}
                >
                  <Text
                    style={[
                      styles.tabText,
                      tab === item.key && styles.activeTabText,
                    ]}
                  >
                    {item.label} {item.count}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.heading}>
              {tab === 'incoming'
                ? 'Incoming orders'
                : tab === 'received'
                ? 'Received orders'
                : tab === 'processing'
                ? 'In processing'
                : 'Ready for delivery'}
            </Text>

            {filteredOrders.map(order => (
              <View key={order.id} style={styles.card}>
                {tab === 'incoming' ? (
                  <View style={styles.orderTop}>
                    <View style={styles.orderRowBetween}>
                      <Text style={styles.orderNumber}>{order.order_number}</Text>
                      <View style={styles.incomingTag}>
                        <Text style={styles.incomingTagText}>Driver arriving</Text>
                      </View>
                    </View>
                    <Text style={styles.driverInfoText}>
                      Driver: {order.pickupDriverName || order.pickupAssignment?.driverName || 'Pickup Driver'}
                    </Text>
                    <View style={styles.incomingActionRow}>
                      <TouchableOpacity
                        accessibilityRole="button"
                        style={styles.receiveButton}
                        disabled={receivingOrderId === order.order_number}
                        onPress={() => receiveOrderDirectly(order.order_number)}
                      >
                        {receivingOrderId === order.order_number ? (
                          <ActivityIndicator color="#fff" size="small" />
                        ) : (
                          <Text style={styles.receiveButtonText}>Receive Order</Text>
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity
                        accessibilityRole="button"
                        style={styles.scanSecondaryButton}
                        onPress={onIntake}
                      >
                        <Text style={styles.scanSecondaryButtonText}>Scan QR</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity
                    accessibilityRole="button"
                    onPress={() => onOrder(order.id)}
                  >
                    <View style={styles.orderTop}>
                      <View style={styles.orderRowBetween}>
                        <Text style={styles.orderNumber}>{order.order_number}</Text>
                        {tab === 'processing' && order.processingStage ? (
                          <View style={styles.stageTag}>
                            <Text style={styles.stageTagText}>
                              {order.processingStage.toUpperCase()}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={styles.status}>
                        {order.current_status.replace(/_/g, ' ')}
                      </Text>
                    </View>
                    <Text style={styles.link}>
                      {tab === 'received'
                        ? 'Verify garments'
                        : tab === 'processing'
                        ? 'Continue processing'
                        : 'Review handoff'}{' '}
                      →
                    </Text>
                  </TouchableOpacity>
                )}

                {tab === 'ready' && order.deliveryAssignment && order.deliveryAssignment.status !== 'rejected' ? (
                  <View style={styles.driverSection}>
                    <Text style={styles.driverNameText}>
                      Delivery Driver: {order.deliveryAssignment.driverName || 'Assigned Driver'}
                    </Text>
                    {order.deliveryAssignment.status === 'assigned' ? (
                      <Text style={styles.muted}>Waiting for Driver acceptance.</Text>
                    ) : null}
                    {order.deliveryAssignment.status === 'accepted' || order.deliveryAssignment.status === 'en_route' ? (
                      <Text style={styles.driverEnRouteText}>Driver en route to facility</Text>
                    ) : null}
                    {order.deliveryAssignment.status === 'arrived' ? (
                      <Text style={styles.driverArrivedText}>Driver arrived at facility</Text>
                    ) : null}
                    {order.deliveryAssignment.handedOver ? (
                      <View style={styles.handoverSuccessBadge}>
                        <Text style={styles.handoverSuccessText}>
                          Handed Over to Driver
                          {order.deliveryAssignment.handedOverAt
                            ? ` (${new Date(order.deliveryAssignment.handedOverAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })})`
                            : ''}
                        </Text>
                      </View>
                    ) : (
                      <TouchableOpacity
                        accessibilityRole="button"
                        style={styles.handoverButton}
                        disabled={handingOverId === order.id}
                        onPress={() => handover(order.id, order.deliveryAssignment?.driverId)}
                      >
                        {handingOverId === order.id ? (
                          <ActivityIndicator color="#fff" size="small" />
                        ) : (
                          <Text style={styles.handoverButtonText}>Hand Over Order</Text>
                        )}
                      </TouchableOpacity>
                    )}
                  </View>
                ) : null}

                {tab === 'ready' &&
                !order.deliveryAssignment &&
                order.current_status === 'delivery_assigned' ? (
                  <Text style={styles.muted}>
                    Waiting for Driver acceptance.
                  </Text>
                ) : null}

                {tab === 'ready' &&
                order.current_status === 'ready_for_delivery' ? (
                  <Text style={styles.muted}>Ready for Driver assignment.</Text>
                ) : null}

                {tab === 'ready' &&
                order.current_status === 'delivery_failed' ? (
                  <>
                    <Text style={styles.rejected}>
                      Driver rejected the delivery
                      {order.deliveryAssignment?.rejectionReason
                        ? `: ${order.deliveryAssignment.rejectionReason}`
                        : '.'}
                    </Text>
                    <TouchableOpacity
                      accessibilityRole="button"
                      style={styles.reassignButton}
                      disabled={reassigning}
                      onPress={() => showDrivers(order.id)}
                    >
                      <Text style={styles.reassignText}>Reassign Driver</Text>
                    </TouchableOpacity>
                  </>
                ) : null}

                {driverOrderId === order.id ? (
                  <View style={styles.driverList}>
                    <Text style={styles.driverListTitle}>Available Drivers</Text>
                    {loadingDrivers ? (
                      <ActivityIndicator accessibilityLabel="Loading available Drivers" />
                    ) : null}
                    {!loadingDrivers && !drivers.length && !actionError ? (
                      <Text style={styles.muted}>No other Drivers are available.</Text>
                    ) : null}
                    {drivers.map(driver => (
                      <TouchableOpacity
                        accessibilityRole="button"
                        key={driver.id}
                        disabled={reassigning}
                        style={styles.driverOption}
                        onPress={() => reassign(order.id, driver)}
                      >
                        <Text style={styles.driverName}>{driver.name}</Text>
                        <Text style={styles.muted}>
                          {driver.activeJobs} active jobs
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}
              </View>
            ))}

            {!filteredOrders.length ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>No {tab} orders</Text>
                <Text style={styles.muted}>This queue is clear.</Text>
              </View>
            ) : null}
          </>
        ) : null}

        <TouchableOpacity
          accessibilityRole="button"
          style={styles.logout}
          onPress={() => {
            onLogout();
          }}
        >
          <Text style={styles.logoutText}>Log out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F7F6F2' },
  content: { padding: 18, gap: 14, paddingBottom: 36 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  eyebrow: {
    fontSize: 11,
    letterSpacing: 1.4,
    color: '#67635B',
    fontWeight: '800',
  },
  title: { fontSize: 30, fontWeight: '900' },
  heading: { fontSize: 20, fontWeight: '900', flexShrink: 1 },
  scanButton: {
    backgroundColor: '#151515',
    borderRadius: 14,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanText: { color: '#fff', fontSize: 16, fontWeight: '900' },
  facilityCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2DED6',
    gap: 10,
  },
  facilityIdentity: { flex: 1, minWidth: 0, gap: 3 },
  incomingBadge: {
    backgroundColor: '#FFF1CF',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexShrink: 0,
  },
  incomingBadgeText: {
    fontWeight: '800',
    fontSize: 12,
    color: '#8A5D00',
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: '#EAE7E0',
    borderRadius: 14,
    padding: 4,
  },
  tab: { flex: 1, paddingVertical: 11, alignItems: 'center', borderRadius: 11 },
  activeTab: { backgroundColor: '#fff' },
  tabText: {
    fontWeight: '800',
    color: '#656159',
    fontSize: 12,
    textAlign: 'center',
  },
  activeTabText: { color: '#151515' },
  card: {
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2DED6',
    backgroundColor: '#fff',
    borderRadius: 16,
    gap: 9,
  },
  orderTop: { gap: 6, alignItems: 'flex-start' },
  orderRowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  orderNumber: { fontWeight: '900', fontSize: 16, flexShrink: 1 },
  incomingTag: {
    backgroundColor: '#FEF3C7',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  incomingTagText: {
    color: '#92400E',
    fontWeight: '800',
    fontSize: 11,
  },
  stageTag: {
    backgroundColor: '#E0E7FF',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  stageTagText: {
    color: '#3730A3',
    fontWeight: '800',
    fontSize: 11,
  },
  status: { color: '#67635B', textTransform: 'capitalize', flexShrink: 1 },
  driverInfoText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#4B5563',
  },
  incomingActionRow: {
    flexDirection: 'row',
    gap: 8,
    width: '100%',
    marginTop: 6,
  },
  receiveButton: {
    flex: 2,
    backgroundColor: '#15803D',
    borderRadius: 10,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  receiveButtonText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 13,
  },
  scanSecondaryButton: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  scanSecondaryButtonText: {
    color: '#374151',
    fontWeight: '800',
    fontSize: 13,
  },
  link: { fontWeight: '900', color: '#151515' },
  muted: { color: '#6D685F', flexShrink: 1 },
  empty: { backgroundColor: '#EDEAE3', borderRadius: 16, padding: 18 },
  emptyTitle: { fontWeight: '900', fontSize: 17 },
  logout: { alignItems: 'center', padding: 14 },
  logoutText: { fontWeight: '800', color: '#8C2D26' },
  error: { color: '#9A241E' },
  successMessage: { color: '#15803D', fontWeight: '700' },
  rejected: { color: '#982C23', fontWeight: '700' },
  reassignButton: {
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: '#151515',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reassignText: { color: '#fff', fontWeight: '900' },
  driverList: { gap: 8, paddingTop: 4 },
  driverListTitle: { fontWeight: '900', fontSize: 16 },
  driverOption: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D8D3CA',
    backgroundColor: '#FAF9F6',
  },
  driverName: { fontWeight: '900' },
  driverSection: {
    backgroundColor: '#F3EFEB',
    borderRadius: 12,
    padding: 12,
    gap: 8,
    marginTop: 4,
  },
  driverNameText: {
    fontWeight: '800',
    fontSize: 14,
    color: '#151515',
  },
  driverEnRouteText: {
    fontSize: 12,
    color: '#2563EB',
    fontWeight: '700',
  },
  driverArrivedText: {
    fontSize: 12,
    color: '#15803D',
    fontWeight: '800',
  },
  handoverButton: {
    backgroundColor: '#176E47',
    borderRadius: 10,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  handoverButtonText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 13,
  },
  handoverSuccessBadge: {
    backgroundColor: '#E7F4ED',
    borderRadius: 8,
    padding: 8,
    alignItems: 'center',
  },
  handoverSuccessText: {
    color: '#176E47',
    fontWeight: '800',
    fontSize: 12,
  },
});
