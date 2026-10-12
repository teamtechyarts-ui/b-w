import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {AdminCustomer, getAdminCustomers, lookupAdminQr} from '../services/adminManagementApi';
import NativeQrScannerButton from '../components/NativeQrScannerButton';

type Props = {accessToken: string; onBack: () => void; onCustomer: (id: string) => void; onOrder: (id: string) => void};

export default function AdminCustomersScreen({accessToken, onBack, onCustomer, onOrder}: Props) {
  const [search, setSearch] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [findingQr, setFindingQr] = useState(false);
  const [qrError, setQrError] = useState('');
  const [customers, setCustomers] = useState<AdminCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (term = '') => {
    setLoading(true);
    setError('');
    try {
      setCustomers(await getAdminCustomers(accessToken, term));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Customer directory unavailable.');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    load();
  }, [load]);

  const lookup = async (scannedCode?: string) => {
    if (findingQr) return;
    const payload = (scannedCode ?? qrCode).trim();
    if (!payload) {
      setQrError('Please enter an order number, handoff code, or scan a QR.');
      return;
    }
    setFindingQr(true);
    setQrError('');
    try {
      if (scannedCode) setQrCode(scannedCode);
      const result = await lookupAdminQr(accessToken, payload);
      if (!result.orderId) throw new Error('No order found matching this code.');
      onOrder(result.orderId);
    } catch (cause) {
      setQrError(cause instanceof Error ? cause.message : 'Unable to look up order.');
    } finally {
      setFindingQr(false);
    }
  };

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity accessibilityRole="button" onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>← Admin Dashboard</Text>
        </TouchableOpacity>

        <Text style={styles.eyebrow}>ORDER & CUSTOMER MANAGEMENT</Text>
        <Text style={styles.title}>Customers & Orders</Text>

        {/* Quick Order Lookup Card */}
        <View style={styles.lookupCard}>
          <Text style={styles.sectionTitle}>Find an Order</Text>
          <Text style={styles.muted}>
            Scan an order QR code, or enter an Order Number (e.g. BW-...) / BW1 handoff code.
          </Text>
          <NativeQrScannerButton label="Scan order QR" onScanned={lookup} />
          <TextInput
            accessibilityLabel="Handoff QR code"
            placeholder="Order # (e.g. BW-...) or BW1 code"
            autoCapitalize="none"
            value={qrCode}
            onChangeText={(text) => {
              setQrCode(text);
              if (qrError) setQrError('');
            }}
            style={styles.input}
          />
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.primaryButton}
            disabled={findingQr}
            onPress={() => lookup()}
          >
            <Text style={styles.primaryButtonText}>{findingQr ? 'Looking up…' : 'Look up order'}</Text>
          </TouchableOpacity>
          {qrError ? (
            <View style={styles.errorBanner}>
              <Text accessibilityRole="alert" style={styles.errorBannerText}>{qrError}</Text>
            </View>
          ) : null}
        </View>

        {/* Customer Directory Search */}
        <View style={styles.directoryHeader}>
          <Text style={styles.sectionTitle}>Customer Directory</Text>
          <Text style={styles.muted}>Search customers by name, phone number, or order number.</Text>
        </View>

        <View style={styles.searchRow}>
          <TextInput
            accessibilityLabel="Search customers"
            placeholder="Search by name, phone, or order #"
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={() => load(search)}
            style={[styles.input, {flex: 1}]}
          />
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.searchButton}
            onPress={() => load(search)}
          >
            <Text style={styles.searchButtonText}>Search</Text>
          </TouchableOpacity>
          {search ? (
            <TouchableOpacity
              accessibilityRole="button"
              style={styles.clearButton}
              onPress={() => {
                setSearch('');
                load('');
              }}
            >
              <Text style={styles.clearButtonText}>Clear</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color="#151515" accessibilityLabel="Loading customers" />
            <Text style={styles.muted}>Loading customers…</Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorCard}>
            <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text>
            <TouchableOpacity accessibilityRole="button" onPress={() => load(search)} style={styles.retryButton}>
              <Text style={styles.retryButtonText}>Retry search</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {!loading && !error && !customers.length ? (
          <View style={styles.emptyCard}>
            <Text style={styles.muted}>No customers found matching your criteria.</Text>
          </View>
        ) : null}

        {!loading && !error ? (
          customers.map((customer) => (
            <TouchableOpacity
              key={customer.id}
              accessibilityRole="button"
              style={styles.customerCard}
              onPress={() => onCustomer(customer.id)}
            >
              <View style={styles.customerCardHeader}>
                <Text style={styles.customerName}>{customer.profiles?.full_name || 'Customer'}</Text>
                <View style={[styles.activePill, customer.profiles?.is_active ? styles.activePillGreen : styles.activePillRed]}>
                  <Text style={styles.activePillText}>{customer.profiles?.is_active ? 'Active' : 'Disabled'}</Text>
                </View>
              </View>
              <Text style={styles.customerPhone}>{customer.profiles?.phone || 'No phone on profile'}</Text>
              <View style={styles.customerFooter}>
                <Text style={styles.customerDate}>
                  Registered: {new Date(customer.created_at).toLocaleDateString('en-IN')}
                </Text>
                <Text style={styles.viewOrdersLink}>View orders →</Text>
              </View>
            </TouchableOpacity>
          ))
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
  sectionTitle: {fontSize: 18, fontWeight: '900', color: '#151515'},
  directoryHeader: {gap: 2, marginTop: 4},
  lookupCard: {backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2DED6', borderRadius: 16, padding: 16, gap: 10},
  muted: {fontSize: 13, color: '#67635B'},
  input: {borderWidth: 1, borderColor: '#CFCAC0', backgroundColor: '#fff', borderRadius: 10, padding: 12, fontSize: 14},
  primaryButton: {minHeight: 46, backgroundColor: '#151515', borderRadius: 12, justifyContent: 'center', alignItems: 'center'},
  primaryButtonText: {color: '#fff', fontWeight: '900', fontSize: 14},
  searchRow: {flexDirection: 'row', gap: 8, alignItems: 'center'},
  searchButton: {backgroundColor: '#151515', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10},
  searchButtonText: {color: '#fff', fontWeight: '800', fontSize: 13},
  clearButton: {paddingHorizontal: 10, paddingVertical: 12},
  clearButtonText: {color: '#67635B', fontWeight: '800', fontSize: 13},
  loadingContainer: {padding: 20, alignItems: 'center', gap: 6},
  customerCard: {backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2DED6', borderRadius: 16, padding: 16, gap: 6},
  customerCardHeader: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  customerName: {fontSize: 16, fontWeight: '900', color: '#151515'},
  customerPhone: {fontSize: 13, color: '#4B5563'},
  customerFooter: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4},
  customerDate: {fontSize: 11, color: '#67635B'},
  viewOrdersLink: {fontSize: 12, fontWeight: '800', color: '#0284C7'},
  activePill: {paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4},
  activePillGreen: {backgroundColor: '#DCFCE7'},
  activePillRed: {backgroundColor: '#FEE2E2'},
  activePillText: {fontSize: 10, fontWeight: '800', color: '#166534'},
  emptyCard: {backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2DED6', borderRadius: 16, padding: 20, alignItems: 'center'},
  errorCard: {backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA', borderRadius: 12, padding: 14, gap: 8},
  errorText: {color: '#DC2626', fontSize: 13, fontWeight: '700'},
  retryButton: {backgroundColor: '#DC2626', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, alignSelf: 'flex-start'},
  retryButtonText: {color: '#fff', fontWeight: '800', fontSize: 12},
  errorBanner: {backgroundColor: '#FEF2F2', padding: 10, borderRadius: 8},
  errorBannerText: {color: '#DC2626', fontSize: 12, fontWeight: '700'},
});
