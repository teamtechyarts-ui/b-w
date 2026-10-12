import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import {formatPaymentMethod, customerTimelineReason} from '../utils/customerPresentation';
import {getMyAddresses} from '../services/customersApi';
import type {AddressItem} from '../types/address';
import LoadingView from '../components/LoadingView';
import AppIcon from '../components/AppIcon';
import OrderCareSection from '../components/OrderCareSection';
import OrderStatusBadge from '../components/OrderStatusBadge';
import OrderQrCard from '../components/OrderQrCard';
import {getOrder, getOrderStatusHistory} from '../services/ordersApi';
import {
  createCustomerOrderOtp,
  CustomerOrderOtp,
  getCustomerOtpTypeForStatus,
} from '../services/orderOtpApi';
import {
  canCustomerTrackOrder,
  getOrderTracking,
  hasLiveDriverLocation,
  OrderTracking,
} from '../services/orderTrackingApi';
import {
  CustomerOrder,
  OrderStatusHistoryItem,
  orderStatusLabel,
} from '../types/order';
import {useOrderRealtime} from '../hooks/useRealtime';
import {RealtimeEventPayload} from '../services/realtimeService';

type OrderDetailsScreenProps = {
  accessToken: string;
  orderId: string;
  onBack: () => void;
  onReceipt: (orderId: string) => void;
  onReorder: (order: CustomerOrder) => void;
};

function formatMoney(value: number | string | null | undefined) {
  const amount = Number(value ?? 0);
  if (Number.isNaN(amount)) return '0.00';
  return amount.toFixed(2);
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatShortDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function getHistoryStatus(item: OrderStatusHistoryItem) {
  return item.new_status ?? item.to_status ?? item.status ?? null;
}

function getTrackingDriverStatus(tracking: OrderTracking | null) {
  if (!tracking?.assignment) {
    return 'Driver assignment in progress';
  }
  const isPickup = tracking.assignment.type === 'pickup';
  switch (tracking.assignment.status) {
    case 'assigned':
      return isPickup ? 'Pickup driver assigned' : 'Delivery driver assigned';
    case 'accepted':
      return isPickup ? 'Pickup driver confirmed' : 'Delivery driver confirmed';
    case 'en_route':
      return 'Driver is on the way';
    case 'arrived':
      return 'Driver has arrived';
    case 'completed':
      return isPickup ? 'Order picked up' : 'Order delivered';
    default:
      return isPickup ? 'Pickup driver assigned' : 'Delivery driver assigned';
  }
}

export default function OrderDetailsScreen({
  accessToken,
  orderId,
  onBack,
  onReceipt,
  onReorder,
}: OrderDetailsScreenProps) {
  const [order, setOrder] = useState<CustomerOrder | null>(null);
  const [history, setHistory] = useState<OrderStatusHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [customerOtp, setCustomerOtp] = useState<CustomerOrderOtp | null>(null);
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const [tracking, setTracking] = useState<OrderTracking | null>(null);
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [trackingError, setTrackingError] = useState<string | null>(null);

  const [careRefreshKey, setCareRefreshKey] = useState(0);
  const [addresses, setAddresses] = useState<AddressItem[]>([]);

  type OtpVerificationSuccess = {
    type: 'pickup' | 'delivery';
    title: string;
    message: string;
  };

  const [otpVerifiedSuccess, setOtpVerifiedSuccess] =
    useState<OtpVerificationSuccess | null>(null);

  const successScale = useRef(new Animated.Value(0.7)).current;
  const successOpacity = useRef(new Animated.Value(0)).current;
  const previousStatusRef = useRef<string | null>(null);

  const triggerSuccessAnimation = useCallback(
    (data: OtpVerificationSuccess) => {
      setOtpVerifiedSuccess(data);
      successScale.setValue(0.7);
      successOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(successScale, {
          toValue: 1,
          friction: 6,
          tension: 50,
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(successOpacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: Platform.OS !== 'web',
        }),
      ]).start();
    },
    [successScale, successOpacity],
  );

  const checkStatusTransition = useCallback(
    (newStatus: string | undefined | null) => {
      if (!newStatus) return;
      const prev = previousStatusRef.current;
      if (!prev) {
        previousStatusRef.current = newStatus;
        return;
      }

      if (prev === newStatus) return;

      const isPickupPending =
        prev === 'pickup_otp_pending' ||
        prev === 'en_route_pickup' ||
        prev === 'pickup_arrived' ||
        prev === 'driver_assigned_pickup';

      const isPickupComplete = [
        'picked_up',
        'in_transit_to_facility',
        'received_at_facility',
        'intake_pending',
        'intake_completed',
        'washing',
        'drying',
        'ironing',
        'quality_check',
        'qc_completed',
      ].includes(newStatus);

      const isDeliveryPending =
        prev === 'delivery_otp_pending' ||
        prev === 'en_route_delivery' ||
        prev === 'delivery_arrived' ||
        prev === 'driver_assigned_delivery';

      const isDeliveryComplete = [
        'delivered',
        'claim_period_active',
        'completed',
      ].includes(newStatus);

      if (isPickupPending && isPickupComplete) {
        triggerSuccessAnimation({
          type: 'pickup',
          title: 'Pickup OTP Verified Successfully',
          message: 'Your laundry has been picked up successfully.',
        });
      } else if (isDeliveryPending && isDeliveryComplete) {
        triggerSuccessAnimation({
          type: 'delivery',
          title: 'Delivery OTP Verified Successfully',
          message: 'Your laundry has been delivered successfully.',
        });
      }

      previousStatusRef.current = newStatus;
    },
    [triggerSuccessAnimation],
  );

  // Periodically refresh current time to update OTP expiration status
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    getMyAddresses(accessToken)
      .then(result => {
        if (active) setAddresses(result);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [accessToken]);

  const addressText = (id: string) => {
    const address = addresses.find(item => item.id === id);
    return address
      ? [
          address.address_line1,
          address.address_line2,
          address.city,
          address.state,
          address.postal_code,
        ]
          .filter(Boolean)
          .join(', ')
      : 'Saved address details unavailable';
  };

  const loadDetails = useCallback(
    async (isRefresh = false) => {
      try {
        if (isRefresh) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }
        setError(null);

        const [orderResult, historyResult] = await Promise.all([
          getOrder(accessToken, orderId),
          getOrderStatusHistory(accessToken, orderId),
        ]);

        if (orderResult?.current_status) {
          checkStatusTransition(orderResult.current_status);
        }
        setOrder(orderResult);
        setHistory(historyResult);
        setCareRefreshKey(value => value + 1);
      } catch (loadError: any) {
        setError(loadError?.message || 'Unable to load order details.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [accessToken, orderId, checkStatusTransition],
  );

  useOrderRealtime(
    orderId,
    useCallback(
      (event: RealtimeEventPayload) => {
        if (event.status) {
          checkStatusTransition(event.status);
          setOrder(prev => (prev ? {...prev, current_status: event.status as any} : prev));
        }
        loadDetails(true);
      },
      [loadDetails, checkStatusTransition],
    ),
    accessToken,
  );

  useEffect(() => {
    loadDetails();
  }, [loadDetails]);

  const itemCount = useMemo(() => {
    return (order?.order_items ?? []).reduce(
      (total, item) => total + Number(item.quantity),
      0,
    );
  }, [order]);

  const otpType = getCustomerOtpTypeForStatus(order?.current_status ?? '');
  const isOtpExpired = customerOtp
    ? new Date(customerOtp.expiresAt).getTime() <= now
    : false;

  const trackingEnabled = canCustomerTrackOrder(order?.current_status ?? '');
  const liveLocationEnabled = hasLiveDriverLocation(order?.current_status ?? '');

  const loadTracking = useCallback(async () => {
    if (!trackingEnabled) {
      setTracking(null);
      setTrackingError(null);
      return;
    }

    try {
      setTrackingLoading(true);
      setTrackingError(null);
      const result = await getOrderTracking(accessToken, orderId);
      setTracking(result);
    } catch (trackingLoadError: any) {
      setTracking(null);
      setTrackingError(
        trackingLoadError?.message ||
          'Tracking is temporarily unavailable. Check your connection and try again.',
      );
    } finally {
      setTrackingLoading(false);
    }
  }, [accessToken, orderId, trackingEnabled]);

  useEffect(() => {
    loadTracking();
    if (!liveLocationEnabled) return undefined;

    const interval = setInterval(loadTracking, 30_000);
    return () => clearInterval(interval);
  }, [liveLocationEnabled, loadTracking]);

  useEffect(() => {
    if (customerOtp && customerOtp.otpType !== otpType) {
      setCustomerOtp(null);
      setOtpError(null);
    }
  }, [customerOtp, otpType]);

  const showOtp = useCallback(async () => {
    if (!otpType) return;

    try {
      setOtpLoading(true);
      setOtpError(null);
      const result = await createCustomerOrderOtp(accessToken, orderId, otpType);
      setCustomerOtp(result);
    } catch (requestError: any) {
      setOtpError(
        requestError?.message || 'Unable to retrieve your OTP. Please try again.',
      );
    } finally {
      setOtpLoading(false);
    }
  }, [accessToken, orderId, otpType]);

  // Automatically request OTP when customer arrives at OTP pending stage
  useEffect(() => {
    if (otpType && !customerOtp && !otpLoading && !otpError) {
      showOtp();
    }
  }, [otpType, customerOtp, otpLoading, otpError, showOtp]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} accessibilityRole="button" accessibilityLabel="Go back">
            <Text style={styles.back}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Order Details</Text>
          <View style={styles.headerSpacer} />
        </View>
        <LoadingView message="Loading order details..." />
      </SafeAreaView>
    );
  }

  if (error || !order) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} accessibilityRole="button" accessibilityLabel="Go back">
            <Text style={styles.back}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Order Details</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Unable to load order</Text>
          <Text style={styles.errorText}>{error || 'Order not found.'}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => loadDetails()} accessibilityRole="button">
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const pickupDeliveryCharge = Number(order.pickup_delivery_charge ?? 0);
  const gstRate = Number(order.gst_rate ?? 0);
  const gstAmount = Number(order.gst_amount ?? 0);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} accessibilityRole="button" accessibilityLabel="Go back">
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Order Details</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadDetails(true)}
            tintColor="#1F5849"
          />
        }
        showsVerticalScrollIndicator={false}>
        {/* Order Status Hero Card */}
        <View style={styles.heroCard}>
          <View style={styles.heroTop}>
            <View style={styles.flex}>
              <Text style={styles.orderLabel}>ORDER</Text>
              <Text style={styles.orderNumber}>{order.order_number || order.id}</Text>
            </View>
            <OrderStatusBadge status={order.current_status} />
          </View>
        </View>

        {/* Delivery / Pickup OTP Section or Success Confirmation */}
        {otpVerifiedSuccess ? (
          <Animated.View
            style={[
              styles.otpSuccessCard,
              {
                opacity: successOpacity,
                transform: [{scale: successScale}],
              },
            ]}
            testID="otp-verification-success-card"
            accessibilityRole="alert"
            accessibilityLiveRegion="polite">
            <View style={styles.otpSuccessIconCircle}>
              <AppIcon name="check" size={24} color="#FFFFFF" strokeWidth={3} />
            </View>
            <View style={styles.otpSuccessContent}>
              <Text style={styles.otpSuccessHeading}>{otpVerifiedSuccess.title}</Text>
              <Text style={styles.otpSuccessMessage}>{otpVerifiedSuccess.message}</Text>
              <View style={styles.otpSuccessBadge}>
                <Text style={styles.otpSuccessBadgeText}>VERIFIED</Text>
              </View>
            </View>
          </Animated.View>
        ) : otpType ? (
          <View style={styles.otpCard}>
            <Text style={styles.otpTitle}>
              {otpType === 'pickup' ? 'PICKUP OTP' : 'DELIVERY OTP'}
            </Text>

            {customerOtp && !isOtpExpired ? (
              <>
                <Text style={styles.otpDescription}>
                  {otpType === 'pickup'
                    ? 'Give this code to the driver when your garments are collected.'
                    : 'Give this code to the driver when your order is delivered.'}
                </Text>
                <Text style={styles.otpCode}>{customerOtp.otp}</Text>
                <Text style={styles.otpExpiry}>
                  Expires {formatDateTime(customerOtp.expiresAt)}
                </Text>
              </>
            ) : isOtpExpired ? (
              <>
                <Text style={styles.otpExpiredText}>
                  {otpType === 'pickup'
                    ? 'Your pickup OTP has expired.'
                    : 'Your delivery OTP has expired.'}
                </Text>
                <TouchableOpacity
                  style={styles.otpButton}
                  disabled={otpLoading}
                  onPress={showOtp}
                  accessibilityRole="button"
                  accessibilityLabel="Regenerate OTP">
                  <Text style={styles.otpButtonText}>
                    {otpLoading ? 'Regenerating OTP...' : 'Regenerate OTP'}
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.otpDescription}>
                  {otpType === 'pickup'
                    ? 'Give this code to the driver when your garments are collected.'
                    : 'Give this code to the driver when your order is delivered.'}
                </Text>
                <TouchableOpacity
                  style={styles.otpButton}
                  disabled={otpLoading}
                  onPress={showOtp}
                  accessibilityRole="button"
                  accessibilityLabel={`Show ${otpType === 'pickup' ? 'Pickup' : 'Delivery'} OTP`}>
                  <Text style={styles.otpButtonText}>
                    {otpLoading
                      ? 'Generating OTP...'
                      : `Show ${otpType === 'pickup' ? 'Pickup' : 'Delivery'} OTP`}
                  </Text>
                </TouchableOpacity>
              </>
            )}

            {otpError ? <Text style={styles.otpError}>{otpError}</Text> : null}
          </View>
        ) : null}

        {/* Tracking Card */}
        {trackingEnabled ? (
          <View style={styles.trackingCard}>
            <Text style={styles.trackingTitle}>
              {otpType === 'delivery' || order.current_status.includes('delivery')
                ? 'DELIVERY STATUS'
                : 'ORDER TRACKING'}
            </Text>

            {trackingLoading && !tracking ? (
              <Text style={styles.trackingText}>Checking driver status...</Text>
            ) : null}

            {trackingError ? (
              <Text style={styles.trackingError}>{trackingError}</Text>
            ) : null}

            {tracking ? (
              <>
                <Text style={styles.trackingPrimaryStatus}>
                  {getTrackingDriverStatus(tracking)}
                </Text>

                {liveLocationEnabled ? (
                  tracking.location ? (
                    <Text style={styles.trackingSubtext}>
                      {tracking.location.stale
                        ? 'Driver location is temporarily stale. It will refresh with the next update.'
                        : `Live driver location updated ${formatDateTime(
                            tracking.location.recordedAt,
                          )}.`}
                    </Text>
                  ) : (
                    <Text style={styles.trackingSubtext}>
                      Driver location will appear when available.
                    </Text>
                  )
                ) : (
                  <Text style={styles.trackingSubtext}>
                    Driver location will appear when available.
                  </Text>
                )}

                {tracking.distanceMeters != null ? (
                  <Text style={styles.trackingSubtext}>
                    Distance: {(tracking.distanceMeters / 1000).toFixed(1)} km
                  </Text>
                ) : null}

                {tracking.etaMinutes != null ? (
                  <Text style={styles.trackingSubtext}>
                    ETA: {Math.round(tracking.etaMinutes)} min
                  </Text>
                ) : null}
              </>
            ) : !trackingLoading && !trackingError ? (
              <Text style={styles.trackingSubtext}>
                Driver location will appear when available.
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* Pickup & Delivery Schedule */}
        <Text style={styles.sectionHeader}>PICKUP</Text>
        <View style={styles.card}>
          <Text style={styles.scheduleDate}>
            {formatShortDate(order.pickup_scheduled_at)}
          </Text>
          {order.pickup_slot_label ? (
            <Text style={styles.scheduleSlot}>{order.pickup_slot_label}</Text>
          ) : null}
        </View>

        {order.delivery_scheduled_at ? (
          <>
            <Text style={styles.sectionHeader}>DELIVERY</Text>
            <View style={styles.card}>
              <Text style={styles.scheduleDate}>
                {formatShortDate(order.delivery_scheduled_at)}
              </Text>
              {order.delivery_slot_label ? (
                <Text style={styles.scheduleSlot}>{order.delivery_slot_label}</Text>
              ) : null}
            </View>
          </>
        ) : null}

        {/* Order Summary */}
        <Text style={styles.sectionHeader}>ORDER SUMMARY</Text>
        <View style={styles.card}>
          <View style={styles.detailRow}>
            <Text style={styles.detailValue}>
              {itemCount} {itemCount === 1 ? 'item' : 'items'}
            </Text>
            <Text style={styles.detailValue}>
              {formatPaymentMethod(order.payment_method)}
            </Text>
          </View>
        </View>

        {/* Order QR */}
        <OrderQrCard accessToken={accessToken} orderId={orderId} />

        {/* Price Summary */}
        <Text style={styles.sectionHeader}>PRICE SUMMARY</Text>
        <View style={styles.priceCard}>
          <View style={styles.priceRow}>
            <Text style={styles.priceLabel}>Services</Text>
            <Text style={styles.priceValue}>₹{formatMoney(order.subtotal)}</Text>
          </View>

          {Number(order.discount_amount) > 0 ? (
            <View style={styles.priceRow}>
              <Text style={styles.priceLabel}>Discount</Text>
              <Text style={styles.priceValue}>-₹{formatMoney(order.discount_amount)}</Text>
            </View>
          ) : null}

          <View style={styles.priceRow}>
            <Text style={styles.priceLabel}>Pickup & Delivery</Text>
            <Text style={styles.priceValue}>
              {pickupDeliveryCharge === 0 ? 'FREE' : `₹${formatMoney(pickupDeliveryCharge)}`}
            </Text>
          </View>

          {gstRate > 0 || gstAmount > 0 ? (
            <View style={styles.priceRow}>
              <Text style={styles.priceLabel}>GST {gstRate > 0 ? `@ ${gstRate}%` : ''}</Text>
              <Text style={styles.priceValue}>₹{formatMoney(gstAmount)}</Text>
            </View>
          ) : null}

          <View style={styles.priceDivider} />

          <View style={styles.priceRow}>
            <Text style={styles.totalLabel}>TOTAL</Text>
            <Text style={styles.totalAmount}>₹{formatMoney(order.total_amount)}</Text>
          </View>
        </View>

        {/* Laundry Items */}
        <Text style={styles.sectionHeader}>YOUR ITEMS</Text>
        <View style={styles.card}>
          {(order.order_items ?? []).map((item, index) => (
            <View
              key={item.id}
              style={[
                styles.itemRow,
                index < (order.order_items ?? []).length - 1 && styles.itemBorder,
              ]}>
              <View style={styles.flex}>
                <Text style={styles.itemName}>{item.item_name}</Text>
                <Text style={styles.itemMeta}>
                  {item.quantity} × ₹{formatMoney(item.unit_price)}
                </Text>
                {item.customer_notes ? (
                  <Text style={styles.itemNote}>{item.customer_notes}</Text>
                ) : null}
              </View>
              <Text style={styles.itemAmount}>₹{formatMoney(item.line_total)}</Text>
            </View>
          ))}
        </View>

        {/* Addresses */}
        <Text style={styles.sectionHeader}>PICKUP ADDRESS</Text>
        <View style={styles.card}>
          <Text style={styles.addressValue}>{addressText(order.pickup_address_id)}</Text>
        </View>

        <Text style={styles.sectionHeader}>DELIVERY ADDRESS</Text>
        <View style={styles.card}>
          <Text style={styles.addressValue}>{addressText(order.delivery_address_id)}</Text>
        </View>

        {/* Status Timeline */}
        <Text style={styles.sectionHeader}>STATUS TIMELINE</Text>
        <View style={styles.timelineCard}>
          {history.length === 0 ? (
            <Text style={styles.emptyTimeline}>No status history available yet.</Text>
          ) : (
            history.map((item, index) => {
              const status = getHistoryStatus(item);
              return (
                <View key={item.id} style={styles.timelineRow}>
                  <View style={styles.timelineLeft}>
                    <View style={styles.timelineDot} />
                    {index < history.length - 1 ? <View style={styles.timelineLine} /> : null}
                  </View>
                  <View style={styles.timelineContent}>
                    <Text style={styles.timelineTitle}>
                      {status ? orderStatusLabel(status).toUpperCase() : 'ORDER UPDATED'}
                    </Text>
                    <Text style={styles.timelineDate}>{formatDateTime(item.created_at)}</Text>
                    {item.reason ? (
                      <Text style={styles.timelineReason}>
                        {customerTimelineReason(item.reason)}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })
          )}
        </View>

        {/* Order Care Section (Claims, Cancellations, Refunds) */}
        <OrderCareSection
          accessToken={accessToken}
          order={order}
          refreshKey={careRefreshKey}
          onActionComplete={() => loadDetails(true)}
        />

        {/* Receipts and Reorders */}
        <View style={styles.actionLinksCard}>
          <TouchableOpacity
            style={styles.actionLinkRow}
            onPress={() => onReceipt(order.id)}
            accessibilityRole="button"
            accessibilityLabel="View receipt and GST breakdown">
            <Text style={styles.actionLinkText}>View receipt and GST breakdown →</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionLinkRow}
            onPress={() => onReorder(order)}
            accessibilityRole="button"
            accessibilityLabel="Repeat this order">
            <Text style={styles.actionLinkText}>Repeat this order →</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  flex: {
    flex: 1,
  },
  header: {
    height: 56,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#EBEBEB',
  },
  back: {
    minWidth: 60,
    fontSize: 15,
    fontWeight: '700',
    color: '#1B1B18',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '800',
    color: '#1B1B18',
  },
  headerSpacer: {
    width: 60,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 36,
  },
  heroCard: {
    borderRadius: 16,
    padding: 18,
    backgroundColor: '#1B1B18',
    marginBottom: 16,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  orderLabel: {
    fontSize: 10,
    letterSpacing: 0.8,
    color: '#9E9E9E',
    fontWeight: '800',
  },
  orderNumber: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    marginTop: 4,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
    color: '#656159',
    marginBottom: 8,
    marginTop: 6,
  },
  card: {
    borderWidth: 1,
    borderColor: '#E2DED6',
    borderRadius: 14,
    padding: 16,
    backgroundColor: '#FFFFFF',
    marginBottom: 16,
  },
  scheduleDate: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1B1B18',
  },
  scheduleSlot: {
    fontSize: 13,
    color: '#656159',
    marginTop: 4,
    fontWeight: '500',
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1B1B18',
  },
  otpCard: {
    backgroundColor: '#F3EFE6',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2D8C6',
    padding: 18,
    marginBottom: 16,
  },
  otpSuccessCard: {
    backgroundColor: '#EDF7F2',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#A3D9B8',
    padding: 18,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#1F5849',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  otpSuccessIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1F5849',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  otpSuccessContent: {
    flex: 1,
  },
  otpSuccessHeading: {
    fontSize: 15,
    fontWeight: '800',
    color: '#16503F',
    marginBottom: 3,
    letterSpacing: -0.2,
  },
  otpSuccessMessage: {
    fontSize: 13,
    lineHeight: 18,
    color: '#3B4842',
    fontWeight: '500',
    marginBottom: 6,
  },
  otpSuccessBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#D1EADE',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  otpSuccessBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    color: '#1F5849',
  },
  otpTitle: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.6,
    color: '#1F5849',
    marginBottom: 6,
  },
  otpDescription: {
    color: '#4A463F',
    fontSize: 13,
    lineHeight: 18,
  },
  otpCode: {
    marginTop: 12,
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 6,
    color: '#1B1B18',
  },
  otpExpiry: {
    marginTop: 6,
    color: '#656159',
    fontSize: 12,
    fontWeight: '600',
  },
  otpExpiredText: {
    color: '#9A241E',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 4,
    marginBottom: 12,
  },
  otpButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#1F5849',
    borderRadius: 10,
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 44,
    justifyContent: 'center',
  },
  otpButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  otpError: {
    color: '#9A241E',
    fontSize: 12,
    lineHeight: 16,
    marginTop: 10,
    fontWeight: '600',
  },
  trackingCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2DED6',
    padding: 16,
    marginBottom: 16,
  },
  trackingTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
    color: '#656159',
    marginBottom: 8,
  },
  trackingPrimaryStatus: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1B1B18',
    marginBottom: 4,
  },
  trackingText: {
    color: '#656159',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  trackingSubtext: {
    color: '#656159',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  trackingError: {
    color: '#9A241E',
    fontSize: 12,
    lineHeight: 16,
    marginTop: 6,
  },
  priceCard: {
    backgroundColor: '#1B1B18',
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  priceLabel: {
    fontSize: 13,
    color: '#B0ADA6',
  },
  priceValue: {
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  priceDivider: {
    height: 1,
    backgroundColor: '#383630',
    marginVertical: 8,
  },
  totalLabel: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  totalAmount: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '900',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
  },
  itemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#F0EEEA',
  },
  itemName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1B1B18',
  },
  itemMeta: {
    fontSize: 12,
    color: '#656159',
    marginTop: 2,
  },
  itemNote: {
    marginTop: 4,
    fontSize: 11,
    color: '#8A857C',
    lineHeight: 15,
  },
  itemAmount: {
    marginLeft: 12,
    fontSize: 14,
    fontWeight: '700',
    color: '#1B1B18',
  },
  addressValue: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    color: '#1B1B18',
  },
  timelineCard: {
    borderWidth: 1,
    borderColor: '#E2DED6',
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    padding: 16,
    marginBottom: 16,
  },
  timelineRow: {
    flexDirection: 'row',
    minHeight: 64,
  },
  timelineLeft: {
    width: 22,
    alignItems: 'center',
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#1F5849',
    marginTop: 4,
  },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: '#DCD7CE',
    marginTop: 4,
  },
  timelineContent: {
    flex: 1,
    paddingLeft: 10,
    paddingBottom: 14,
  },
  timelineTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
    color: '#1B1B18',
  },
  timelineDate: {
    fontSize: 11,
    color: '#7A756D',
    marginTop: 2,
  },
  timelineReason: {
    fontSize: 11,
    lineHeight: 16,
    color: '#4A463F',
    marginTop: 4,
  },
  emptyTimeline: {
    fontSize: 13,
    color: '#7A756D',
    textAlign: 'center',
    paddingVertical: 16,
  },
  actionLinksCard: {
    marginBottom: 20,
    gap: 8,
  },
  actionLinkRow: {
    paddingVertical: 10,
  },
  actionLinkText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1F5849',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  errorTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#1B1B18',
  },
  errorText: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 18,
    color: '#656159',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 16,
    backgroundColor: '#1F5849',
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 12,
    minHeight: 44,
    justifyContent: 'center',
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
