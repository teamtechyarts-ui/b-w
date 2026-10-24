import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
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
  FacilityDashboardOrder,
  getAvailableDeliveryDrivers,
  getFacilityDashboard,
  handoverFacilityOrderToDriver,
  reassignFacilityDelivery,
} from '../services/facilityDashboardApi';
import { confirmFacilityReceiptByOrderId } from '../services/facilityIntakeApi';
import { useFacilityRealtime } from '../hooks/useRealtime';
import { RealtimeEventPayload, realtimeService } from '../services/realtimeService';

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

const DEPARTING_STATUSES = [
  'en_route_delivery',
  'delivered',
  'completed',
  'cancelled',
];

function computeFacilitySummary(orders: FacilityDashboardOrder[]): FacilityDashboard['summary'] {
  let incoming = 0;
  let received = 0;
  let processing = 0;
  let ready = 0;

  for (const order of orders) {
    if (order.current_status === 'in_transit_to_facility') {
      incoming++;
    } else if (order.current_status === 'received_at_facility') {
      received++;
    } else if (PROCESSING_STATUSES.includes(order.current_status)) {
      processing++;
    } else if (READY_STATUSES.includes(order.current_status)) {
      ready++;
    }
  }

  return { incoming, received, processing, ready };
}

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
  const dashboardRef = useRef<FacilityDashboard | null>(null);
  dashboardRef.current = dashboard;
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

  const requestIdRef = useRef(0);
  const latestEventTimeByOrderRef = useRef<Map<string, number>>(new Map());
  const processedEventsRef = useRef<Set<string>>(new Set());
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (isManualRefresh = false, isBackground = false) => {
      const currentRequestId = ++requestIdRef.current;
      if (isManualRefresh) setRefreshing(true);
      else if (!dashboardRef.current && !isBackground) setLoading(true);
      setError('');
      try {
        const result = await getFacilityDashboard(accessToken);
        if (currentRequestId !== requestIdRef.current) {
          // Newer load request was started or completed, discard stale response
          return;
        }

        // Reconcile with latest local event timestamps to prevent stale server responses from overwriting newer event-driven state
        const reconciledOrders = result.orders.map(serverOrder => {
          const localEventTime = latestEventTimeByOrderRef.current.get(serverOrder.id);
          if (localEventTime) {
            const serverTime = serverOrder.updated_at ? new Date(serverOrder.updated_at).getTime() : 0;
            if (!serverOrder.updated_at || serverTime < localEventTime) {
              const existingLocal = dashboardRef.current?.orders.find(o => o.id === serverOrder.id);
              if (existingLocal) {
                return {
                  ...serverOrder,
                  current_status: existingLocal.current_status,
                  processingStage: existingLocal.processingStage,
                  driverArrivedAtFacility: existingLocal.driverArrivedAtFacility,
                  deliveryAssignment: existingLocal.deliveryAssignment,
                  pickupAssignment: existingLocal.pickupAssignment,
                };
              }
            }
          }
          return serverOrder;
        });

        const reconciledDashboard: FacilityDashboard = {
          ...result,
          orders: reconciledOrders,
          summary: computeFacilitySummary(reconciledOrders),
        };

        setDashboard(reconciledDashboard);
        dashboardRef.current = reconciledDashboard;
        setActionError(prev => {
          if (prev.includes('Driver has not yet confirmed arrival')) {
            return '';
          }
          return prev;
        });
      } catch (cause) {
        if (currentRequestId !== requestIdRef.current) return;
        if (!isBackground) {
          setDashboard(null);
          dashboardRef.current = null;
          setError(
            cause instanceof Error
              ? cause.message
              : 'Facility dashboard unavailable.',
          );
        }
      } finally {
        if (currentRequestId === requestIdRef.current) {
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

  // Reconnection and foreground listeners to reconcile missed changes
  useEffect(() => {
    const unsubReconnect = realtimeService.onReconnect(() => {
      load(false, true);
    });
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') {
        load(false, true);
      }
    });
    return () => {
      unsubReconnect();
      subscription.remove();
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
      }
    };
  }, [load]);

  useFacilityRealtime(
    dashboard?.facility?.id ?? null,
    useCallback(
      (event: RealtimeEventPayload) => {
        if (event.eventType === 'RECONNECT_RECONCILE') {
          load(false, true);
          return;
        }

        const payload = (event as any).payload || event;
        const targetOrderId = payload?.orderId || event.orderId || event.entityId;
        const targetOrderNumber = payload?.orderNumber || (event as any).orderNumber;

        if (!targetOrderId && !targetOrderNumber) return;

        // Duplicate event deduplication
        const eventFingerprint = `${event.eventType}_${targetOrderId || ''}_${targetOrderNumber || ''}_${payload?.status || ''}_${payload?.stage || ''}_${payload?.action || ''}_${payload?.timestamp || ''}`;
        if (processedEventsRef.current.has(eventFingerprint)) {
          return;
        }
        processedEventsRef.current.add(eventFingerprint);
        if (processedEventsRef.current.size > 200) {
          const first = processedEventsRef.current.values().next().value;
          if (first) processedEventsRef.current.delete(first);
        }

        // Track local event timestamp for target order to protect against stale in-flight responses
        const now = Date.now();
        if (targetOrderId) {
          latestEventTimeByOrderRef.current.set(targetOrderId, now);
        }

        const eventType = event.eventType;

        setDashboard(prev => {
          if (!prev) return prev;

          const existingIndex = prev.orders.findIndex(
            o => (targetOrderId && o.id === targetOrderId) || (targetOrderNumber && o.order_number === targetOrderNumber),
          );
          const existingOrder = existingIndex >= 0 ? prev.orders[existingIndex] : null;

          let updatedOrders = [...prev.orders];

          if (eventType === 'DRIVER_ARRIVED_AT_FACILITY' || (eventType === 'DRIVER_ARRIVED' && payload?.assignmentType === 'facility')) {
            if (existingOrder) {
              const isDelivery = payload.assignmentType === 'delivery' || READY_STATUSES.includes(existingOrder.current_status);
              const updatedOrder: FacilityDashboardOrder = {
                ...existingOrder,
                driverArrivedAtFacility: true,
                deliveryAssignment: isDelivery
                  ? {
                      id: payload.assignmentId || existingOrder.deliveryAssignment?.id || '',
                      driverId: payload.driverId || existingOrder.deliveryAssignment?.driverId || '',
                      driverName: payload.driverName || existingOrder.deliveryAssignment?.driverName || 'Assigned Driver',
                      status: 'arrived',
                      rejectionReason: existingOrder.deliveryAssignment?.rejectionReason || null,
                      handedOver: existingOrder.deliveryAssignment?.handedOver || false,
                      handedOverAt: existingOrder.deliveryAssignment?.handedOverAt || null,
                      collected: existingOrder.deliveryAssignment?.collected || false,
                      collectedAt: existingOrder.deliveryAssignment?.collectedAt || null,
                    }
                  : existingOrder.deliveryAssignment,
                pickupAssignment: !isDelivery && existingOrder.pickupAssignment
                  ? {
                      ...existingOrder.pickupAssignment,
                      status: 'arrived',
                      driverName: payload.driverName || existingOrder.pickupAssignment.driverName,
                      driverId: payload.driverId || existingOrder.pickupAssignment.driverId,
                    }
                  : existingOrder.pickupAssignment,
                pickupDriverName: !isDelivery ? (payload.driverName || existingOrder.pickupDriverName) : existingOrder.pickupDriverName,
              };
              updatedOrders[existingIndex] = updatedOrder;
            }
            setActionError(err =>
              err.includes('Driver has not yet confirmed arrival') ? '' : err,
            );
          } else if (eventType === 'FACILITY_INTAKE') {
            const newStatus = payload.status || 'received_at_facility';
            if (existingOrder) {
              updatedOrders[existingIndex] = {
                ...existingOrder,
                current_status: newStatus,
                driverArrivedAtFacility: true,
              };
            } else if (targetOrderId) {
              updatedOrders.unshift({
                id: targetOrderId,
                order_number: targetOrderNumber || `BW-${targetOrderId.slice(0, 8).toUpperCase()}`,
                current_status: newStatus,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                driverArrivedAtFacility: true,
                deliveryAssignment: null,
                pickupAssignment: null,
                processingStage: null,
              });
            }
          } else if (eventType === 'FACILITY_VERIFICATION') {
            const newStatus = payload.status || 'verification';
            if (existingOrder) {
              updatedOrders[existingIndex] = {
                ...existingOrder,
                current_status: newStatus,
                processingStage: 'verification',
              };
            }
          } else if (eventType === 'PROCESSING_STAGE_STARTED') {
            const newStage = payload.stage || payload.processType || 'processing';
            const newStatus = payload.status || 'processing';
            if (existingOrder) {
              updatedOrders[existingIndex] = {
                ...existingOrder,
                current_status: newStatus,
                processingStage: newStage,
              };
            }
          } else if (eventType === 'PROCESSING_STAGE_COMPLETED') {
            const newStage = payload.stage || null;
            const newStatus = payload.status || existingOrder?.current_status || 'processing';
            if (existingOrder) {
              updatedOrders[existingIndex] = {
                ...existingOrder,
                current_status: newStatus,
                processingStage: newStage,
              };
            }
          } else if (eventType === 'FACILITY_PACKING_CONFIRMED') {
            const newStatus = payload.status || existingOrder?.current_status || 'processing';
            if (existingOrder) {
              updatedOrders[existingIndex] = {
                ...existingOrder,
                current_status: newStatus,
              };
            }
          } else if (eventType === 'QC_DECIDED') {
            const approved = payload.approved ?? true;
            const newStatus = payload.status || (approved ? 'ready_for_delivery' : 'rework_required');
            if (existingOrder) {
              updatedOrders[existingIndex] = {
                ...existingOrder,
                current_status: newStatus,
                processingStage: approved ? null : 'rework_required',
              };
            }
          } else if (eventType === 'FACILITY_HANDOVER') {
            if (existingOrder) {
              updatedOrders[existingIndex] = {
                ...existingOrder,
                deliveryAssignment: existingOrder.deliveryAssignment
                  ? {
                      ...existingOrder.deliveryAssignment,
                      handedOver: true,
                      handedOverAt: payload.timestamp || new Date().toISOString(),
                    }
                  : null,
              };
            }
          } else if (eventType === 'FACILITY_COLLECTED') {
            if (existingOrder) {
              updatedOrders[existingIndex] = {
                ...existingOrder,
                deliveryAssignment: existingOrder.deliveryAssignment
                  ? {
                      ...existingOrder.deliveryAssignment,
                      status: 'collected',
                      handedOver: true,
                      collected: true,
                      collectedAt: payload.timestamp || new Date().toISOString(),
                    }
                  : null,
              };
            }
          } else if (eventType === 'JOB_CLAIMED' || eventType === 'ASSIGNMENT_UPDATED' || eventType === 'DELIVERY_REASSIGNED') {
            if (existingOrder) {
              updatedOrders[existingIndex] = {
                ...existingOrder,
                deliveryAssignment: existingOrder.deliveryAssignment
                  ? {
                      ...existingOrder.deliveryAssignment,
                      status: payload.action === 'reassign' || eventType === 'DELIVERY_REASSIGNED' ? 'assigned' : 'accepted',
                      driverId: payload.driverId || payload.newDriverId || existingOrder.deliveryAssignment.driverId,
                      driverName: payload.driverName || existingOrder.deliveryAssignment.driverName || 'Assigned Driver',
                    }
                  : {
                      id: payload.assignmentId || '',
                      driverId: payload.driverId || payload.newDriverId || '',
                      driverName: payload.driverName || 'Assigned Driver',
                      status: 'accepted',
                      rejectionReason: null,
                      handedOver: false,
                      handedOverAt: null,
                      collected: false,
                      collectedAt: null,
                    },
              };
            }
          } else if (eventType === 'ORDER_STATUS_CHANGED') {
            const newStatus = payload.status || event.status;
            if (newStatus) {
              if (DEPARTING_STATUSES.includes(newStatus)) {
                // Order has left the facility queue (e.g. en_route_delivery, delivered, completed, cancelled)
                updatedOrders = updatedOrders.filter(
                  o => o.id !== targetOrderId && o.order_number !== targetOrderNumber,
                );
              } else if (existingOrder) {
                updatedOrders[existingIndex] = {
                  ...existingOrder,
                  current_status: newStatus,
                  processingStage: READY_STATUSES.includes(newStatus) ? null : existingOrder.processingStage,
                  driverArrivedAtFacility: newStatus === 'in_transit_to_facility' ? false : existingOrder.driverArrivedAtFacility,
                };
              } else if (targetOrderId && (newStatus === 'in_transit_to_facility' || newStatus === 'received_at_facility')) {
                // New incoming order assigned to this facility
                updatedOrders.unshift({
                  id: targetOrderId,
                  order_number: targetOrderNumber || `BW-${targetOrderId.slice(0, 8).toUpperCase()}`,
                  current_status: newStatus,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                  driverArrivedAtFacility: false,
                  deliveryAssignment: null,
                  pickupAssignment: null,
                  processingStage: null,
                });
              }
            }
          } else if (eventType === 'ORDER_CREATED') {
            const newStatus = payload.status || 'in_transit_to_facility';
            if (!existingOrder && targetOrderId && (newStatus === 'in_transit_to_facility' || newStatus === 'confirmed')) {
              updatedOrders.unshift({
                id: targetOrderId,
                order_number: targetOrderNumber || `BW-${targetOrderId.slice(0, 8).toUpperCase()}`,
                current_status: newStatus === 'confirmed' ? 'in_transit_to_facility' : newStatus,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                driverArrivedAtFacility: false,
                deliveryAssignment: null,
                pickupAssignment: null,
                processingStage: null,
              });
            }
          }

          const nextDashboard: FacilityDashboard = {
            ...prev,
            orders: updatedOrders,
            summary: computeFacilitySummary(updatedOrders),
          };
          dashboardRef.current = nextDashboard;
          return nextDashboard;
        });
      },
      [load],
    ),
    accessToken,
  );

  const receiveOrderDirectly = async (orderNumber: string) => {
    if (receivingOrderId) return;
    const targetOrder = dashboard?.orders.find(o => o.order_number === orderNumber);
    if (targetOrder && !targetOrder.driverArrivedAtFacility) {
      setActionError(`Driver has not yet confirmed arrival at the facility for order ${orderNumber}.`);
      return;
    }
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
      setDashboard(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          orders: prev.orders.map(o =>
            o.id === orderId && o.deliveryAssignment
              ? {
                  ...o,
                  deliveryAssignment: {
                    ...o.deliveryAssignment,
                    handedOver: true,
                    handedOverAt: new Date().toISOString(),
                  },
                }
              : o,
          ),
        };
      });
      await load(false, true);
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

        {loading && !dashboard ? (
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
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Dismiss error"
              style={styles.errorDismissButton}
              onPress={() => setActionError('')}
            >
              <Text style={styles.errorDismissText}>Dismiss</Text>
            </TouchableOpacity>
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
                      {order.driverArrivedAtFacility ? (
                        <View style={styles.driverArrivedBadge}>
                          <Text style={styles.driverArrivedBadgeText}>DRIVER ARRIVED</Text>
                        </View>
                      ) : (
                        <View style={styles.incomingTag}>
                          <Text style={styles.incomingTagText}>In Transit</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.driverInfoText}>
                      Driver: {order.pickupDriverName || order.pickupAssignment?.driverName || 'Pickup Driver'}
                    </Text>
                    <Text style={styles.driverSubtext}>
                      {order.driverArrivedAtFacility ? 'Driver arrived at facility' : 'Driver en route to facility'}
                    </Text>
                    <View style={styles.incomingActionRow}>
                      <TouchableOpacity
                        accessibilityRole="button"
                        style={[
                          styles.receiveButton,
                          !order.driverArrivedAtFacility && styles.receiveButtonDisabled,
                        ]}
                        disabled={receivingOrderId === order.order_number || !order.driverArrivedAtFacility}
                        onPress={() => receiveOrderDirectly(order.order_number)}
                      >
                        {receivingOrderId === order.order_number ? (
                          <ActivityIndicator color="#fff" size="small" />
                        ) : (
                          <Text
                            style={[
                              styles.receiveButtonText,
                              !order.driverArrivedAtFacility && styles.receiveButtonDisabledText,
                            ]}
                          >
                            {order.driverArrivedAtFacility ? 'Receive Order' : 'Awaiting Arrival'}
                          </Text>
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
  driverSubtext: {
    fontSize: 12,
    color: colors.textMuted,
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
  receiveButtonDisabled: {
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    opacity: 0.7,
  },
  receiveButtonText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
  },
  receiveButtonDisabledText: {
    color: colors.textMuted,
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
  errorDismissButton: {
    alignSelf: 'flex-start',
    paddingVertical: 3,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.xs,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    marginTop: 2,
  },
  errorDismissText: {
    color: colors.dangerText,
    fontSize: 11,
    fontWeight: '700',
  },
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

