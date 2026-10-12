import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AppIcon from '../components/AppIcon';
import { colors, spacing, borderRadius, typography, shadows } from '../theme/designSystem';
import {
  AvailableDeliveryDriver,
  FacilityDashboard,
  getAvailableDeliveryDrivers,
  getFacilityDashboard,
  handoverFacilityOrderToDriver,
  reassignFacilityDelivery,
} from '../services/facilityDashboardApi';
import { confirmFacilityReceiptByOrderId } from '../services/facilityIntakeApi';
import { useFacilityRealtime } from '../hooks/useRealtime';
import { RealtimeEventPayload } from '../services/realtimeService';

const READY_STATUSES = [
  'ready_for_delivery',
  'delivery_assigned',
  'delivery_accepted',
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

  useFacilityRealtime(
    dashboard?.facility?.id ?? null,
    useCallback(
      (event: RealtimeEventPayload) => {
        load(true);
      },
      [load],
    ),
    accessToken,
  );

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
    <SafeAreaView style={styles.page} edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
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
          <View style={styles.headerTextGroup}>
            <Text style={styles.eyebrow}>FACILITY OPERATIONS</Text>
            <Text style={styles.title}>Work queue</Text>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.refreshButton}
            onPress={() => {
              load(true);
            }}
          >
            <AppIcon name="refresh" size={14} color={colors.primary} />
            <Text style={styles.link}>Refresh</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          accessibilityRole="button"
          style={styles.scanButton}
          onPress={onIntake}
        >
          <View style={styles.scanButtonContent}>
            <AppIcon name="search" size={18} color="#FFFFFF" strokeWidth={2.5} />
            <Text style={styles.scanText}>Scan incoming order</Text>
          </View>
        </TouchableOpacity>

        {loading ? (
          <ActivityIndicator accessibilityLabel="Loading facility dashboard" color={colors.primary} />
        ) : null}
        {error ? (
          <View style={styles.errorBanner}>
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              style={styles.retryButton}
              onPress={() => {
                load();
              }}
            >
              <Text style={styles.retryText}>Retry dashboard</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {actionError ? (
          <View style={styles.errorBanner}>
            <Text accessibilityRole="alert" style={styles.error}>
              {actionError}
            </Text>
          </View>
        ) : null}
        {message ? (
          <View style={styles.successBanner}>
            <Text accessibilityRole="alert" style={styles.successMessage}>
              {message}
            </Text>
          </View>
        ) : null}

        {dashboard ? (
          <>
            <View style={styles.facilityCard}>
              <View style={styles.facilityIdentity}>
                <View style={styles.facilityHeaderRow}>
                  <Text style={styles.facilityName}>{dashboard.facility.name}</Text>
                  <View style={styles.roleBadge}>
                    <Text style={styles.roleBadgeText}>
                      {dashboard.role === 'manager'
                        ? 'Facility Manager'
                        : 'Facility Employee'}
                    </Text>
                  </View>
                </View>
                {dashboard.facility.address ? (
                  <Text style={styles.facilityAddress} numberOfLines={1}>
                    {dashboard.facility.address}
                  </Text>
                ) : null}
              </View>
            </View>

            <View style={styles.tabsContainer}>
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
              ).map(item => {
                const isActive = tab === item.key;
                return (
                  <TouchableOpacity
                    key={item.key}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: isActive }}
                    style={[styles.tab, isActive && styles.activeTab]}
                    onPress={() => setTab(item.key)}
                  >
                    <Text
                      style={[
                        styles.tabText,
                        isActive && styles.activeTabText,
                      ]}
                      numberOfLines={1}
                    >
                      {item.label} {item.count}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeading}>
                {tab === 'incoming'
                  ? 'Incoming orders'
                  : tab === 'received'
                  ? 'Received orders'
                  : tab === 'processing'
                  ? 'In processing'
                  : 'Ready for delivery'}
              </Text>
              <Text style={styles.sectionCountBadge}>
                {filteredOrders.length} {filteredOrders.length === 1 ? 'order' : 'orders'}
              </Text>
            </View>

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
                    activeOpacity={0.7}
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
                        ) : tab === 'ready' && order.deliveryAssignment?.status === 'arrived' && !order.deliveryAssignment.handedOver ? (
                          <View style={styles.driverArrivedBadge}>
                            <Text style={styles.driverArrivedBadgeText}>
                              DRIVER ARRIVED
                            </Text>
                          </View>
                        ) : (
                          <View style={styles.statusPill}>
                            <Text style={styles.statusPillText}>
                              {order.current_status.replace(/_/g, ' ')}
                            </Text>
                          </View>
                        )}
                      </View>
                      {tab !== 'processing' ? (
                        <Text style={styles.status}>
                          {tab === 'ready' && order.deliveryAssignment?.status === 'arrived' && !order.deliveryAssignment.handedOver
                            ? 'Awaiting driver handover'
                            : order.current_status.replace(/_/g, ' ')}
                        </Text>
                      ) : null}
                    </View>
                    <View style={styles.actionRow}>
                      <Text style={styles.link}>
                        {tab === 'received'
                          ? 'Verify garments'
                          : tab === 'processing'
                          ? 'Continue processing'
                          : 'Review handoff'}{' '}
                        →
                      </Text>
                    </View>
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
                    {order.deliveryAssignment.status === 'accepted' ? (
                      <Text style={styles.muted}>Driver accepted delivery job</Text>
                    ) : null}
                    {order.deliveryAssignment.status === 'en_route' ? (
                      <Text style={styles.driverEnRouteText}>Driver en route to facility</Text>
                    ) : null}
                    {order.deliveryAssignment.status === 'arrived' ? (
                      <Text style={styles.driverArrivedText}>Driver arrived at facility (awaiting handover)</Text>
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
                  <View style={styles.reassignSection}>
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
                  </View>
                ) : null}

                {driverOrderId === order.id ? (
                  <View style={styles.driverList}>
                    <Text style={styles.driverListTitle}>Available Drivers</Text>
                    {loadingDrivers ? (
                      <ActivityIndicator accessibilityLabel="Loading available Drivers" size="small" />
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
  page: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxxl },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  headerTextGroup: { flex: 1 },
  eyebrow: {
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.textMuted,
    fontWeight: '800',
  },
  title: { fontSize: 24, fontWeight: '800', color: colors.textPrimary, marginTop: 2 },
  refreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 36,
  },
  scanButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sm,
  },
  scanButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  scanText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  facilityCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.sm,
  },
  facilityIdentity: { gap: 4 },
  facilityHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  facilityName: { fontSize: 16, fontWeight: '800', color: colors.textPrimary, flexShrink: 1 },
  facilityAddress: { fontSize: 12, color: colors.textMuted },
  roleBadge: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  roleBadgeText: {
    fontWeight: '700',
    fontSize: 11,
    color: colors.textSecondary,
  },
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: '#EAE7E0',
    borderRadius: borderRadius.md,
    padding: 3,
    gap: 2,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.sm,
    minHeight: 40,
  },
  activeTab: { backgroundColor: colors.surface, ...shadows.sm },
  tabText: {
    fontWeight: '700',
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
  },
  activeTabText: { color: colors.textPrimary, fontWeight: '800' },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  sectionHeading: { fontSize: 17, fontWeight: '800', color: colors.textPrimary },
  sectionCountBadge: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  card: {
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    gap: spacing.sm,
    ...shadows.sm,
  },
  orderTop: { gap: 4, alignItems: 'flex-start' },
  orderRowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  orderNumber: { fontWeight: '800', fontSize: 15, color: colors.textPrimary, flexShrink: 1 },
  incomingTag: {
    backgroundColor: colors.warningSurface,
    borderRadius: borderRadius.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.warningBorder,
  },
  incomingTagText: {
    color: colors.warningText,
    fontWeight: '700',
    fontSize: 11,
  },
  stageTag: {
    backgroundColor: colors.infoSurface,
    borderRadius: borderRadius.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.infoBorder,
  },
  stageTagText: {
    color: colors.infoText,
    fontWeight: '800',
    fontSize: 11,
  },
  driverArrivedBadge: {
    backgroundColor: colors.successSurface,
    borderRadius: borderRadius.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.successBorder,
  },
  driverArrivedBadgeText: {
    color: colors.successText,
    fontWeight: '800',
    fontSize: 11,
  },
  statusPill: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  statusPillText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  status: { color: colors.textMuted, fontSize: 12, textTransform: 'capitalize' },
  driverInfoText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: 2,
  },
  incomingActionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    width: '100%',
    marginTop: spacing.xs,
  },
  receiveButton: {
    flex: 2,
    backgroundColor: colors.success,
    borderRadius: borderRadius.sm,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  receiveButtonText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
  },
  scanSecondaryButton: {
    flex: 1,
    backgroundColor: colors.surfaceSubtle,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  scanSecondaryButtonText: {
    color: colors.textPrimary,
    fontWeight: '700',
    fontSize: 13,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 4,
  },
  link: { fontWeight: '700', color: colors.textPrimary, fontSize: 13 },
  muted: { color: colors.textMuted, fontSize: 13 },
  empty: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyTitle: { fontWeight: '800', fontSize: 15, color: colors.textPrimary },
  logout: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    minHeight: 48,
    marginTop: spacing.md,
  },
  logoutText: { fontWeight: '700', color: colors.dangerText, fontSize: 14 },
  errorBanner: {
    backgroundColor: colors.dangerSurface,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: borderRadius.sm,
    padding: spacing.md,
    gap: spacing.xs,
  },
  error: { color: colors.dangerText, fontSize: 13, fontWeight: '600' },
  retryButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.danger,
    borderRadius: borderRadius.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginTop: spacing.xs,
  },
  retryText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12 },
  successBanner: {
    backgroundColor: colors.successSurface,
    borderWidth: 1,
    borderColor: colors.successBorder,
    borderRadius: borderRadius.sm,
    padding: spacing.md,
  },
  successMessage: { color: colors.successText, fontWeight: '700', fontSize: 13 },
  reassignSection: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  rejected: { color: colors.dangerText, fontWeight: '700', fontSize: 13 },
  reassignButton: {
    minHeight: 44,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  reassignText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },
  driverList: { gap: spacing.xs, paddingTop: spacing.xs },
  driverListTitle: { fontWeight: '800', fontSize: 14, color: colors.textPrimary },
  driverOption: {
    padding: spacing.md,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSubtle,
    minHeight: 44,
    justifyContent: 'center',
  },
  driverName: { fontWeight: '800', color: colors.textPrimary, fontSize: 13 },
  driverSection: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: borderRadius.sm,
    padding: spacing.md,
    gap: spacing.xs,
    marginTop: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  driverNameText: {
    fontWeight: '800',
    fontSize: 13,
    color: colors.textPrimary,
  },
  driverEnRouteText: {
    fontSize: 12,
    color: colors.infoText,
    fontWeight: '700',
  },
  driverArrivedText: {
    fontSize: 12,
    color: colors.successText,
    fontWeight: '800',
  },
  handoverButton: {
    backgroundColor: colors.success,
    borderRadius: borderRadius.sm,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    marginTop: spacing.xs,
  },
  handoverButtonText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
  },
  handoverSuccessBadge: {
    backgroundColor: colors.successSurface,
    borderRadius: borderRadius.xs,
    padding: spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.successBorder,
  },
  handoverSuccessText: {
    color: colors.successText,
    fontWeight: '800',
    fontSize: 12,
  },
});

