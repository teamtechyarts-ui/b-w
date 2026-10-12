import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {AdminCustomer, AdminOrderSummary, getAdminCustomer, getAdminCustomerOrders} from '../services/adminManagementApi';

type Props = {accessToken: string; customerId: string; onBack: () => void; onOrder: (id: string) => void};
const money = (val: number | string | null | undefined) => `₹${Number(val ?? 0).toFixed(2)}`;

export default function AdminCustomerDetailScreen({accessToken, customerId, onBack, onOrder}: Props) {
  const [customer, setCustomer] = useState<AdminCustomer | null>(null);
  const [orders, setOrders] = useState<AdminOrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [person, history] = await Promise.all([
        getAdminCustomer(accessToken, customerId),
        getAdminCustomerOrders(accessToken, customerId),
      ]);
      setCustomer(person);
      setOrders(history);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Customer details unavailable.');
    } finally {
      setLoading(false);
    }
  }, [accessToken, customerId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity accessibilityRole="button" onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>← Back to Customers</Text>
        </TouchableOpacity>

        <Text style={styles.eyebrow}>CUSTOMER MANAGEMENT</Text>
        <Text style={styles.title}>Customer Profile</Text>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#151515" accessibilityLabel="Loading customer profile" />
            <Text style={styles.muted}>Loading customer profile and orders…</Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorCard}>
            <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text>
            <TouchableOpacity accessibilityRole="button" onPress={load} style={styles.retryButton}>
              <Text style={styles.retryButtonText}>Retry customer</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {!loading && !error && customer ? (
          <>
            {/* Profile Overview */}
            <View style={styles.card}>
              <Text style={styles.cardHeader}>Personal Details</Text>
              <View style={styles.infoRow}>
                <Text style={styles.label}>Name:</Text>
                <Text style={styles.boldValue}>{customer.profiles?.full_name || 'Not provided'}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.value}>Contact: {customer.profiles?.phone || 'Not provided'}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.label}>Account:</Text>
                <Text style={[styles.boldValue, {color: customer.profiles?.is_active ? '#16A34A' : '#DC2626'}]}>
                  {customer.profiles?.is_active ? 'Active' : 'Disabled'}
                </Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.label}>Customer ID:</Text>
                <Text style={styles.monoValue} numberOfLines={1}>{customer.id}</Text>
              </View>
            </View>

            {/* Saved Addresses */}
            <View style={styles.card}>
              <Text style={styles.cardHeader}>Saved Addresses</Text>
              {customer.customer_addresses?.length ? (
                customer.customer_addresses.map((address) => (
                  <View key={address.id} style={styles.addressItem}>
                    <View style={styles.addressHeader}>
                      <Text style={styles.addressLabel}>{address.label || 'Address'}</Text>
                      {address.is_default ? (
                        <View style={styles.defaultBadge}>
                          <Text style={styles.defaultBadgeText}>Default</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.addressText}>
                      {address.address_line1}
                      {address.address_line2 ? `, ${address.address_line2}` : ''}
                      {address.city ? `, ${address.city}` : ''}
                      {address.postal_code ? ` - ${address.postal_code}` : ''}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={styles.muted}>No saved addresses.</Text>
              )}
            </View>

            {/* Order History */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Order History ({orders.length})</Text>
            </View>

            {orders.length ? (
              orders.map((order) => (
                <TouchableOpacity
                  key={order.id}
                  accessibilityRole="button"
                  style={styles.orderCard}
                  onPress={() => onOrder(order.id)}
                >
                  <View style={styles.orderCardHeader}>
                    <Text style={styles.orderNumber}>{order.order_number}</Text>
                    <View
                      style={[
                        styles.statusBadge,
                        order.current_status === 'confirmed' ? styles.statusConfirmed : styles.statusDefault,
                      ]}
                    >
                      <Text style={styles.statusBadgeText}>{order.current_status.toUpperCase().replace(/_/g, ' ')}</Text>
                    </View>
                  </View>
                  <View style={styles.orderCardFooter}>
                    <Text style={styles.orderDate}>
                      {new Date(order.created_at).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </Text>
                    <Text style={styles.orderAmount}>{money(order.total_amount)}</Text>
                  </View>
                  <Text style={styles.tapToView}>Tap to view complete details →</Text>
                </TouchableOpacity>
              ))
            ) : (
              <View style={styles.emptyCard}>
                <Text style={styles.muted}>No orders yet.</Text>
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
  eyebrow: {fontSize: 11, letterSpacing: 1.2, fontWeight: '800', color: '#67635B'},
  title: {fontSize: 26, fontWeight: '900', color: '#151515'},
  loadingContainer: {padding: 24, alignItems: 'center', gap: 8},
  card: {backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2DED6', borderRadius: 16, padding: 16, gap: 8},
  cardHeader: {fontSize: 16, fontWeight: '900', color: '#151515', marginBottom: 4},
  sectionHeader: {marginTop: 6},
  sectionTitle: {fontSize: 18, fontWeight: '900', color: '#151515'},
  infoRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8},
  label: {fontSize: 13, color: '#67635B'},
  value: {fontSize: 13, color: '#151515'},
  boldValue: {fontSize: 13, fontWeight: '800', color: '#151515'},
  monoValue: {fontSize: 11, fontFamily: 'monospace', color: '#6B7280'},
  addressItem: {paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#F3F4F6', gap: 2},
  addressHeader: {flexDirection: 'row', alignItems: 'center', gap: 6},
  addressLabel: {fontSize: 13, fontWeight: '800', color: '#374151'},
  defaultBadge: {backgroundColor: '#E0E7FF', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4},
  defaultBadgeText: {fontSize: 10, fontWeight: '800', color: '#4338CA'},
  addressText: {fontSize: 13, color: '#4B5563', lineHeight: 18},
  orderCard: {backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2DED6', borderRadius: 16, padding: 16, gap: 8},
  orderCardHeader: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  orderNumber: {fontSize: 15, fontWeight: '900', color: '#151515'},
  statusBadge: {paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6},
  statusConfirmed: {backgroundColor: '#DCFCE7', borderWidth: 1, borderColor: '#86EFAC'},
  statusDefault: {backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#D1D5DB'},
  statusBadgeText: {fontSize: 11, fontWeight: '900', color: '#166534'},
  orderCardFooter: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  orderDate: {fontSize: 12, color: '#67635B'},
  orderAmount: {fontSize: 16, fontWeight: '900', color: '#151515'},
  tapToView: {fontSize: 12, fontWeight: '800', color: '#0284C7', marginTop: 2},
  emptyCard: {backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2DED6', borderRadius: 16, padding: 20, alignItems: 'center'},
  muted: {fontSize: 13, color: '#67635B'},
  errorCard: {backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA', borderRadius: 12, padding: 14, gap: 8},
  errorText: {color: '#DC2626', fontSize: 13, fontWeight: '700'},
  retryButton: {backgroundColor: '#DC2626', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, alignSelf: 'flex-start'},
  retryButtonText: {color: '#fff', fontWeight: '800', fontSize: 12},
});
