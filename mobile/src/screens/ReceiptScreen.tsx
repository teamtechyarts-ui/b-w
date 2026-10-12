import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {getOrder} from '../services/ordersApi';
import {getPaymentSummary, type PaymentSummary} from '../services/paymentsApi';
import {CustomerOrder, orderStatusLabel} from '../types/order';
import {formatPaymentMethod, customerStatus} from '../utils/customerPresentation';
import {formatMoney} from '../utils/orderPricing';

type Props = {accessToken: string; orderId: string; onBack: () => void};

function formatDateTime(value?: string | null) {
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

function formatShortDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function ReceiptScreen({accessToken, orderId, onBack}: Props) {
  const [order, setOrder] = useState<CustomerOrder | null>(null);
  const [payment, setPayment] = useState<PaymentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getOrder(accessToken, orderId);
      setOrder(result);
      try {
        setPayment(await getPaymentSummary(accessToken, orderId));
      } catch {
        setPayment(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Receipt is temporarily unavailable.');
    } finally {
      setLoading(false);
    }
  }, [accessToken, orderId]);

  useEffect(() => {
    load();
  }, [load]);

  const isDelivered =
    order?.current_status === 'delivered' ||
    order?.current_status === 'claim_period_active' ||
    order?.current_status === 'completed';

  const pickupDeliveryCharge = Number(order?.pickup_delivery_charge ?? 0);

  return (
    <SafeAreaView style={styles.page}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} accessibilityRole="button" accessibilityLabel="Back">
          <Text style={styles.backLink}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Order Receipt</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator style={styles.spinner} color="#1F5849" accessibilityLabel="Loading receipt" />
        ) : null}

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={load} style={styles.retryBtn} accessibilityRole="button">
              <Text style={styles.retryBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {order ? (
          <>
            {/* Hero Receipt Info */}
            <View style={styles.heroCard}>
              <View style={styles.heroTopRow}>
                <View style={styles.flex}>
                  <Text style={styles.orderLabel}>ORDER RECEIPT</Text>
                  <Text style={styles.orderNumber}>{order.order_number || order.id}</Text>
                </View>
                <View style={styles.statusBadge}>
                  <Text style={styles.statusBadgeText}>
                    {orderStatusLabel(order.current_status)}
                  </Text>
                </View>
              </View>

              <Text style={styles.orderDate}>
                {formatDateTime(order.created_at)}
              </Text>
            </View>

            {/* Items Section */}
            <Text style={styles.sectionHeader}>ITEMS</Text>
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
                  </View>
                  <Text style={styles.itemAmount}>₹{formatMoney(item.line_total)}</Text>
                </View>
              ))}
            </View>

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

              {Number(order.gst_amount) > 0 ? (
                <View style={styles.priceRow}>
                  <Text style={styles.priceLabel}>
                    GST {Number(order.gst_rate) > 0 ? `(${Number(order.gst_rate)}%)` : ''}
                  </Text>
                  <Text style={styles.priceValue}>₹{formatMoney(order.gst_amount)}</Text>
                </View>
              ) : null}

              <View style={styles.priceDivider} />

              <View style={styles.priceRow}>
                <Text style={styles.totalLabel}>TOTAL</Text>
                <Text style={styles.totalAmount}>₹{formatMoney(order.total_amount)}</Text>
              </View>
            </View>

            {/* Payment Section */}
            <Text style={styles.sectionHeader}>PAYMENT</Text>
            <View style={styles.card}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Payment Method</Text>
                <Text style={styles.detailValue}>
                  {formatPaymentMethod(order.payment_method)}
                </Text>
              </View>

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Payment Status</Text>
                <Text style={styles.detailValue}>
                  {(payment?.payment?.status ? customerStatus(payment.payment.status) : null) ??
                    (order.payment_method === 'cash_on_delivery'
                      ? 'Cash on Delivery'
                      : 'Payment recorded')}
                </Text>
              </View>

              {payment?.refunds && payment.refunds.length > 0 ? (
                <View style={styles.refundsContainer}>
                  {payment.refunds.map(refund => (
                    <View key={refund.refundRequestId} style={styles.refundRow}>
                      <Text style={styles.refundLabel}>Refund ({customerStatus(refund.status)})</Text>
                      <Text style={styles.refundValue}>₹{formatMoney(refund.amount)}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>

            {/* Order Status Section */}
            <Text style={styles.sectionHeader}>ORDER STATUS</Text>
            <View style={styles.card}>
              <Text style={styles.statusTitle}>
                {orderStatusLabel(order.current_status)}
              </Text>
              {isDelivered ? (
                <Text style={styles.statusSubtitle}>
                  Delivered {formatShortDate(order.delivered_at || order.updated_at)}
                </Text>
              ) : null}
            </View>

            {/* Disclaimer */}
            <View style={styles.disclaimerBox}>
              <Text style={styles.disclaimerText}>Receipt only. Tax invoice not available.</Text>
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#F8F9FA'},
  flex: {flex: 1},
  header: {
    height: 56,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#EBEBEB',
  },
  backLink: {fontSize: 15, fontWeight: '700', color: '#1B1B18', minWidth: 60},
  headerTitle: {fontSize: 17, fontWeight: '800', color: '#1B1B18'},
  headerSpacer: {width: 60},
  content: {padding: 16, paddingBottom: 36},
  spinner: {marginVertical: 24},
  errorBox: {
    backgroundColor: '#FDF2F2',
    borderWidth: 1,
    borderColor: '#F8D7DA',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  errorText: {fontSize: 13, color: '#9A241E', marginBottom: 10},
  retryBtn: {
    backgroundColor: '#1F5849',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignSelf: 'flex-start',
  },
  retryBtnText: {color: '#FFFFFF', fontSize: 12, fontWeight: '700'},
  heroCard: {
    backgroundColor: '#1B1B18',
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
  },
  heroTopRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  orderLabel: {fontSize: 10, fontWeight: '800', letterSpacing: 0.8, color: '#9E9E9E'},
  orderNumber: {fontSize: 18, fontWeight: '800', color: '#FFFFFF', marginTop: 2},
  orderDate: {fontSize: 12, color: '#B0ADA6', marginTop: 10},
  statusBadge: {
    backgroundColor: '#383630',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusBadgeText: {fontSize: 11, fontWeight: '700', color: '#FFFFFF'},
  sectionHeader: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
    color: '#656159',
    marginBottom: 8,
    marginTop: 4,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2DED6',
    padding: 16,
    marginBottom: 16,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  itemBorder: {borderBottomWidth: 1, borderBottomColor: '#F0EEEA'},
  itemName: {fontSize: 14, fontWeight: '700', color: '#1B1B18'},
  itemMeta: {fontSize: 12, color: '#656159', marginTop: 2},
  itemAmount: {fontSize: 14, fontWeight: '700', color: '#1B1B18', marginLeft: 12},
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
  priceLabel: {fontSize: 13, color: '#B0ADA6'},
  priceValue: {fontSize: 13, color: '#FFFFFF', fontWeight: '700'},
  priceDivider: {height: 1, backgroundColor: '#383630', marginVertical: 8},
  totalLabel: {fontSize: 15, fontWeight: '800', color: '#FFFFFF'},
  totalAmount: {fontSize: 20, fontWeight: '900', color: '#FFFFFF'},
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  detailLabel: {fontSize: 13, color: '#656159'},
  detailValue: {fontSize: 13, fontWeight: '700', color: '#1B1B18'},
  refundsContainer: {marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#F0EEEA'},
  refundRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  refundLabel: {fontSize: 12, color: '#9A241E', fontWeight: '600'},
  refundValue: {fontSize: 12, fontWeight: '700', color: '#9A241E'},
  statusTitle: {fontSize: 15, fontWeight: '800', color: '#1B1B18'},
  statusSubtitle: {fontSize: 12, color: '#656159', marginTop: 4},
  disclaimerBox: {alignItems: 'center', marginVertical: 12},
  disclaimerText: {fontSize: 11, color: '#9E9E9E', textAlign: 'center'},
});
