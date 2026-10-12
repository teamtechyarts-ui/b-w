import React, {useCallback, useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {getMyPackages, getPackages} from '../services/packagesApi';
import type {CustomerPackage, PackageOffer} from '../services/packagesApi';
import {formatMoney} from '../utils/orderPricing';

type Props = {accessToken: string; onBack: () => void; onOpenPackage: (id: string) => void};
export default function PackagesScreen({accessToken, onBack, onOpenPackage}: Props) {
  const [offers, setOffers] = useState<PackageOffer[]>([]);
  const [mine, setMine] = useState<CustomerPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [available, history] = await Promise.all([getPackages(accessToken), getMyPackages(accessToken)]);
      setOffers(available); setMine(history);
    } catch (cause) {setError(cause instanceof Error ? cause.message : 'Packages are unavailable.');}
    finally {setLoading(false);}
  }, [accessToken]);
  useFocusEffect(useCallback(() => {refresh();}, [refresh]));
  return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.content}>
    <TouchableOpacity onPress={onBack}><Text style={styles.link}>← Back</Text></TouchableOpacity>
    <Text style={styles.title}>Packages & subscriptions</Text>
    {loading ? <ActivityIndicator accessibilityLabel="Loading packages" /> : null}
    {error ? <View><Text style={styles.error}>{error}</Text><TouchableOpacity onPress={() => {refresh();}}><Text style={styles.link}>Retry</Text></TouchableOpacity></View> : null}
    {!loading && !error ? <>
      <Text style={styles.heading}>Available packages</Text>
      {offers.length ? offers.map(offer => <TouchableOpacity key={offer.id} style={styles.card} onPress={() => onOpenPackage(offer.id)}>
        <Text style={styles.cardTitle}>{offer.name}</Text><Text>{offer.description || 'Monthly service credits'}</Text>
        <Text>₹{formatMoney(Number(offer.monthly_price))} · {offer.validity_days ? `${offer.validity_days} days` : 'One month'}</Text><Text style={styles.link}>View details →</Text>
      </TouchableOpacity>) : <Text>No packages are available right now.</Text>}
      <Text style={styles.heading}>Your packages & history</Text>
      {mine.length ? mine.map(subscription => <View key={subscription.id} style={styles.card}>
        <Text style={styles.cardTitle}>{subscription.packages?.name ?? 'Package'}</Text>
        <Text>{subscription.isUsable ? 'Active' : subscription.status === 'active' ? 'Expired' : subscription.status}</Text>
        <Text>Valid until {new Date(subscription.expires_at).toLocaleDateString()}</Text>
        {subscription.services.map(service => <Text key={service.service_id}>Service credit: {service.remaining == null ? 'Unlimited' : `${service.remaining} remaining of ${service.usage_limit}`}</Text>)}
        <Text>Orders using this package: {subscription.usage.filter(row => !row.reversed_at).length}</Text>
        {subscription.usage.length ? subscription.usage.map((row, index) => <Text key={`${row.order_id}-${index}`}>{new Date(row.created_at).toLocaleDateString()} · {row.usage_quantity} credit{row.usage_quantity === 1 ? '' : 's'} · {row.reversed_at ? 'restored' : 'used'}</Text>) : <Text>No usage yet.</Text>}
        <TouchableOpacity onPress={() => onOpenPackage(subscription.package_id)}><Text style={styles.link}>Details / renew →</Text></TouchableOpacity>
      </View>) : <Text>No package purchases yet.</Text>}
    </> : null}
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({page: {flex: 1, backgroundColor: '#fff'}, content: {padding: 20, gap: 12}, title: {fontSize: 24, fontWeight: '700'}, heading: {fontSize: 18, fontWeight: '700', marginTop: 12}, card: {padding: 16, borderWidth: 1, borderColor: '#ddd', borderRadius: 14, gap: 7}, cardTitle: {fontWeight: '700', fontSize: 16}, link: {fontWeight: '700'}, error: {color: '#a11'}});
