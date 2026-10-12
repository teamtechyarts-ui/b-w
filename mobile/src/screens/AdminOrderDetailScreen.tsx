import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {AdminOrderDetail, canAdminCancelOrder, cancelAdminOrder, getAdminOrder} from '../services/adminManagementApi';
import QrGraphic from '../components/QrGraphic';
import {formatPaymentMethod} from '../utils/customerPresentation';
import {useOrderRealtime} from '../hooks/useRealtime';

type Props = {accessToken: string; orderId: string; onBack: () => void};
const money = (value: number | string | null | undefined) => `₹${Number(value ?? 0).toFixed(2)}`;

export default function AdminOrderDetailScreen({accessToken, orderId, onBack}: Props) {
  const [detail, setDetail] = useState<AdminOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [success, setSuccess] = useState('');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const data = await getAdminOrder(accessToken, orderId);
      setDetail(data);
    } catch (cause) {
      if (!silent) {
        setError(cause instanceof Error ? cause.message : 'Order details unavailable.');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [accessToken, orderId]);

  useOrderRealtime(
    orderId,
    useCallback(
      (event) => {
        const nextStatus = event.status || (event as any).payload?.status;
        if (nextStatus) {
          setDetail(prev =>
            prev
              ? {
                  ...prev,
                  order: {
                    ...prev.order,
                    current_status: nextStatus as any,
                  },
                }
              : prev,
          );
        }
        load(true);
      },

      [load],
    ),
    accessToken,
    !!accessToken,
  );

  useEffect(() => {
    load();
  }, [load]);

  const cancel = async () => {
    if (!detail || cancelling || !canAdminCancelOrder(detail.order.current_status)) return;
    setCancelling(true);
    setError('');
    setSuccess('');
    try {
      await cancelAdminOrder(accessToken, orderId, reason);
      setReason('');
      await load();
      setSuccess('Order cancelled.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Cancellation failed.');
    } finally {
      setCancelling(false);
    }
  };

  const order = detail?.order;

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity accessibilityRole="button" onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>← Back to customer</Text>
        </TouchableOpacity>

        <View style={styles.headerRow}>
          <View style={{flex: 1}}>
            <Text style={styles.eyebrow}>ADMIN ORDER DETAILS</Text>
            <Text style={styles.title} numberOfLines={2}>
              {order?.order_number || 'Order Details'}
            </Text>
          </View>
          {order?.current_status ? (
            <View style={[styles.statusBadge, order.current_status === 'confirmed' ? styles.statusConfirmed : styles.statusDefault]}>
              <Text style={styles.statusBadgeText}>{order.current_status.toUpperCase().replace(/_/g, ' ')}</Text>
            </View>
          ) : null}
        </View>

        <TouchableOpacity accessibilityRole="button" onPress={() => { load(); }} style={styles.refreshLink}>
          <Text style={styles.linkText}>Refresh order</Text>
        </TouchableOpacity>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#151515" accessibilityLabel="Loading Admin order" />
            <Text style={styles.muted}>Loading full order records…</Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorCard}>
            <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text>
            <TouchableOpacity accessibilityRole="button" onPress={() => { load(); }} style={styles.retryButton}>
              <Text style={styles.retryButtonText}>Retry order</Text>
            </TouchableOpacity>
          </View>
        ) : null}


        {success ? (
          <View style={styles.successCard}>
            <Text accessibilityRole="alert" style={styles.successText}>{success}</Text>
          </View>
        ) : null}

        {!loading && order ? (
          <>
            {/* Customer Details Card */}
            <View style={styles.card}>
              <Text style={styles.cardHeader}>Customer Profile</Text>
              <View style={styles.infoRow}>
                <Text style={styles.label}>Name:</Text>
                <Text style={styles.boldValue}>{order.customers?.profiles?.full_name || 'Not provided'}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.label}>Phone:</Text>
                <Text style={styles.value}>{order.customers?.profiles?.phone || 'Not provided'}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.label}>Customer ID:</Text>
                <Text style={styles.monoValue} numberOfLines={1}>{order.customers?.id || 'N/A'}</Text>
              </View>
            </View>

            {/* Laundry Facility Card (Phase 7) */}
            <View style={styles.card}>
              <Text style={styles.cardHeader}>Assigned Laundry Facility</Text>
              <View style={styles.infoRow}>
                <Text style={styles.label}>Facility:</Text>
                <Text style={styles.boldValue}>{order.facilities?.name || 'Central Facility'}</Text>
              </View>
              {order.facilities?.address ? (
                <View style={styles.infoRow}>
                  <Text style={styles.label}>Facility Address:</Text>
                  <Text style={styles.value}>{order.facilities.address}</Text>
                </View>
              ) : null}
              {order.facility_id ? (
                <View style={styles.infoRow}>
                  <Text style={styles.label}>Facility ID:</Text>
                  <Text style={styles.monoValue} numberOfLines={1}>{order.facility_id}</Text>
                </View>
              ) : null}
            </View>

            {/* Assigned Driver Card */}
            {order.driver_assignments && order.driver_assignments.length > 0 ? (
              <View style={styles.card}>
                <Text style={styles.cardHeader}>Assigned Driver</Text>
                {order.driver_assignments.map((assignment, idx) => (
                  <View key={assignment.id || idx} style={styles.addressBlock}>
                    <View style={styles.infoRow}>
                      <Text style={styles.label}>Driver Name:</Text>
                      <Text style={styles.boldValue}>
                        {assignment.drivers?.profiles?.full_name || 'Assigned Driver'}
                      </Text>
                    </View>
                    {assignment.drivers?.profiles?.phone ? (
                      <View style={styles.infoRow}>
                        <Text style={styles.label}>Phone:</Text>
                        <Text style={styles.value}>{assignment.drivers.profiles.phone}</Text>
                      </View>
                    ) : null}
                    <View style={styles.infoRow}>
                      <Text style={styles.label}>Assignment Status:</Text>
                      <Text style={styles.boldValue}>
                        {assignment.status.toUpperCase().replace(/_/g, ' ')}
                      </Text>
                    </View>
                    <View style={styles.infoRow}>
                      <Text style={styles.label}>Assigned At:</Text>
                      <Text style={styles.mutedSmall}>
                        {new Date(assignment.assigned_at).toLocaleString('en-IN')}
                      </Text>

                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Pickup & Delivery Addresses Card (Phase 8) */}
            <View style={styles.card}>
              <Text style={styles.cardHeader}>Pickup & Delivery Addresses</Text>
              <View style={styles.addressBlock}>
                <Text style={styles.subHeading}>Pickup Address</Text>
                <Text style={styles.addressText}>
                  {order.pickup_address?.address_line1 || 'No pickup address recorded'}
                  {order.pickup_address?.address_line2 ? `, ${order.pickup_address.address_line2}` : ''}
                  {order.pickup_address?.city ? `, ${order.pickup_address.city}` : ''}
                  {order.pickup_address?.postal_code ? ` - ${order.pickup_address.postal_code}` : ''}
                </Text>
                {order.pickup_slot_label ? (
                  <Text style={styles.slotText}>Slot: {order.pickup_slot_label}</Text>
                ) : null}
                {order.pickup_scheduled_at ? (
                  <Text style={styles.mutedSmall}>Scheduled: {new Date(order.pickup_scheduled_at).toLocaleDateString('en-IN')}</Text>
                ) : null}
              </View>

              <View style={styles.divider} />

              <View style={styles.addressBlock}>
                <Text style={styles.subHeading}>Delivery Address</Text>
                <Text style={styles.addressText}>
                  {order.delivery_address?.address_line1 || 'No delivery address recorded'}
                  {order.delivery_address?.address_line2 ? `, ${order.delivery_address.address_line2}` : ''}
                  {order.delivery_address?.city ? `, ${order.delivery_address.city}` : ''}
                  {order.delivery_address?.postal_code ? ` - ${order.delivery_address.postal_code}` : ''}
                </Text>
              </View>
            </View>

            {/* Garments / Items List (Phase 6) */}
            <View style={styles.card}>
              <Text style={styles.cardHeader}>Garments & Services</Text>
              {order.order_items?.length ? (
                order.order_items.map((item, idx) => (
                  <View key={item.id || idx} style={styles.itemRow}>
                    <View style={{flex: 1}}>
                      <Text style={styles.itemName}>{item.item_name}</Text>
                      <Text style={styles.itemMeta}>
                        Qty: {item.quantity} × {money(item.unit_price)}
                        {item.weight_kg ? ` · ${item.weight_kg} kg` : ''}
                      </Text>
                    </View>
                    <Text style={styles.itemPrice}>{money(item.line_total)}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.muted}>No garments recorded.</Text>
              )}
            </View>

            {/* Pricing & GST Breakdown (Phase 12) */}
            <View style={styles.card}>
              <Text style={styles.cardHeader}>Billing & Receipt</Text>
              <View style={styles.priceRow}>
                <Text style={styles.label}>Subtotal:</Text>
                <Text style={styles.value}>{money(order.subtotal)}</Text>
              </View>
              {Number(order.discount_amount) > 0 ? (
                <View style={styles.priceRow}>
                  <Text style={styles.label}>Discount:</Text>
                  <Text style={[styles.value, {color: '#16A34A'}]}>-{money(order.discount_amount)}</Text>
                </View>
              ) : null}
              <View style={styles.priceRow}>
                <Text style={styles.label}>Pickup & Delivery:</Text>
                <Text style={styles.value}>{money(order.pickup_delivery_charge || 0)}</Text>
              </View>
              <View style={styles.priceRow}>
                <Text style={styles.label}>Taxable Amount:</Text>
                <Text style={styles.value}>{money(order.taxable_amount || order.subtotal)}</Text>
              </View>
              <View style={styles.priceRow}>
                <Text style={styles.label}>GST ({Number(order.gst_rate || 18)}%): {money(order.gst_amount)}</Text>
                <Text style={styles.value}>{money(order.gst_amount)}</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.priceRow}>
                <Text style={styles.totalLabel}>Total Amount:</Text>
                <Text style={styles.totalValue}>{money(order.total_amount)}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.label}>Payment Method:</Text>
                <Text style={styles.boldValue}>{formatPaymentMethod(order.payment_method)}</Text>
              </View>
            </View>

            {/* Order Timeline */}
            <View style={styles.card}>
              <Text style={styles.cardHeader}>Order Status Timeline</Text>
              {order.order_status_history?.length ? (
                [...order.order_status_history]
                  .sort((a, b) => a.created_at.localeCompare(b.created_at))
                  .map((item, idx) => (
                    <View key={item.id || idx} style={styles.timelineItem}>
                      <View style={styles.timelineDot} />
                      <View style={{flex: 1}}>
                        <Text style={styles.timelineStatus}>{item.to_status.toUpperCase().replace(/_/g, ' ')}</Text>
                        <Text style={styles.timelineDate}>{new Date(item.created_at).toLocaleString('en-IN')}</Text>
                        {item.reason ? <Text style={styles.timelineReason}>{item.reason}</Text> : null}
                      </View>
                    </View>
                  ))
              ) : (
                <Text style={styles.muted}>No status history recorded.</Text>
              )}
            </View>

            {/* QR Handoff */}
            {order.order_qr_codes?.is_active ? (
              <View style={styles.qrCard}>
                <Text style={styles.cardHeader}>Handoff QR Code</Text>
                <Text style={styles.muted}>Scan for secure driver pickup and facility handoff.</Text>
                <QrGraphic payload={`BW1:${order.order_qr_codes.secure_token}`} accessibilityLabel="Admin order QR code" />
                <Text style={styles.monoValue}>BW1:{order.order_qr_codes.secure_token}</Text>
              </View>
            ) : null}

            {/* Payments Record */}
            <View style={styles.card}>
              <Text style={styles.cardHeader}>Payments & Transactions</Text>
              {detail?.payments?.length ? (
                detail.payments.map((p, idx) => (
                  <View key={p.id || idx} style={styles.paymentRow}>
                    <Text style={styles.boldValue}>{p.provider.toUpperCase()} · {p.status.toUpperCase()}</Text>
                    <Text style={styles.value}>{money(p.amount)} ({p.currency})</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.muted}>No payment record.</Text>
              )}
            </View>

            {/* Claims */}
            <View style={styles.card}>
              <Text style={styles.cardHeader}>Claims and Issues</Text>
              {detail?.claims?.length ? (
                detail.claims.map((claim, idx) => (
                  <View key={claim.id || idx} style={styles.paymentRow}>
                    <Text style={styles.boldValue}>{claim.claim_type.replace(/_/g, ' ')} · {claim.status}</Text>
                    <Text style={styles.value}>{claim.description}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.muted}>No claims.</Text>
              )}
            </View>

            {/* Admin Cancellation */}
            {canAdminCancelOrder(order.current_status) ? (
              <View style={styles.card}>
                <Text style={styles.cardHeader}>Admin Cancellation</Text>
                <Text style={styles.muted}>Enter reason for cancelling this order.</Text>
                <TextInput
                  accessibilityLabel="Admin cancellation reason"
                  multiline
                  placeholder="Reason for cancellation (min 3 chars)"
                  value={reason}
                  onChangeText={setReason}
                  style={styles.input}
                />
                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={cancelling || reason.trim().length < 3}
                  onPress={cancel}
                  style={[styles.cancelButton, (cancelling || reason.trim().length < 3) ? styles.buttonDisabled : null]}
                >
                  <Text style={styles.cancelButtonText}>{cancelling ? 'Cancelling…' : 'Cancel order'}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.card}>
                <Text style={styles.muted}>Cancellation is unavailable at this stage.</Text>
              </View>
            )}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#F7F6F2'},
  content: {padding: 16, gap: 14, paddingBottom: 40},
  backButton: {paddingVertical: 6},
  backText: {fontSize: 14, fontWeight: '800', color: '#151515'},
  headerRow: {flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10},
  eyebrow: {fontSize: 11, letterSpacing: 1.2, fontWeight: '800', color: '#67635B'},
  title: {fontSize: 24, fontWeight: '900', color: '#151515'},
  statusBadge: {paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, alignSelf: 'flex-start'},
  statusConfirmed: {backgroundColor: '#DCFCE7', borderWidth: 1, borderColor: '#86EFAC'},
  statusDefault: {backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#D1D5DB'},
  statusBadgeText: {fontSize: 11, fontWeight: '900', color: '#166534'},
  refreshLink: {alignSelf: 'flex-start'},
  linkText: {fontSize: 13, fontWeight: '800', color: '#0284C7'},
  loadingContainer: {padding: 24, alignItems: 'center', gap: 8},
  card: {backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2DED6', borderRadius: 16, padding: 16, gap: 8},
  cardHeader: {fontSize: 16, fontWeight: '900', color: '#151515', marginBottom: 2},
  subHeading: {fontSize: 14, fontWeight: '800', color: '#374151'},
  infoRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8},
  label: {fontSize: 13, color: '#67635B'},
  value: {fontSize: 13, color: '#151515'},
  boldValue: {fontSize: 13, fontWeight: '800', color: '#151515'},
  monoValue: {fontSize: 11, fontFamily: 'monospace', color: '#6B7280'},
  addressBlock: {gap: 4},
  addressText: {fontSize: 13, color: '#151515', lineHeight: 18},
  slotText: {fontSize: 12, fontWeight: '700', color: '#0284C7', marginTop: 2},
  mutedSmall: {fontSize: 11, color: '#67635B'},
  divider: {height: 1, backgroundColor: '#E5E7EB', marginVertical: 4},
  itemRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4},
  itemName: {fontSize: 14, fontWeight: '800', color: '#151515'},
  itemMeta: {fontSize: 12, color: '#67635B'},
  itemPrice: {fontSize: 14, fontWeight: '900', color: '#151515'},
  priceRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  totalLabel: {fontSize: 16, fontWeight: '900', color: '#151515'},
  totalValue: {fontSize: 18, fontWeight: '900', color: '#151515'},
  timelineItem: {flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 4},
  timelineDot: {width: 8, height: 8, borderRadius: 4, backgroundColor: '#10B981', marginTop: 5},
  timelineStatus: {fontSize: 12, fontWeight: '800', color: '#151515'},
  timelineDate: {fontSize: 11, color: '#6B7280'},
  timelineReason: {fontSize: 11, color: '#374151', fontStyle: 'italic'},
  qrCard: {alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2DED6', borderRadius: 16, padding: 16, gap: 10},
  paymentRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  muted: {fontSize: 13, color: '#67635B'},
  input: {borderWidth: 1, borderColor: '#CFCAC0', backgroundColor: '#fff', borderRadius: 10, padding: 10, minHeight: 60},
  cancelButton: {backgroundColor: '#DC2626', borderRadius: 10, paddingVertical: 12, alignItems: 'center'},
  cancelButtonText: {color: '#fff', fontWeight: '800', fontSize: 13},
  buttonDisabled: {opacity: 0.5},
  errorCard: {backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA', borderRadius: 12, padding: 14, gap: 8},
  errorText: {color: '#DC2626', fontSize: 13, fontWeight: '700'},
  retryButton: {backgroundColor: '#DC2626', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, alignSelf: 'flex-start'},
  retryButtonText: {color: '#fff', fontWeight: '800', fontSize: 12},
  successCard: {backgroundColor: '#ECFDF5', borderWidth: 1, borderColor: '#A7F3D0', borderRadius: 12, padding: 12},
  successText: {color: '#047857', fontWeight: '700', fontSize: 13},
});
