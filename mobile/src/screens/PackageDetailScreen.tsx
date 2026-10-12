import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {getPackage, purchasePackage} from '../services/packagesApi';
import type {PackageOffer} from '../services/packagesApi';
import type {ServiceItem} from '../types/service';
import {formatMoney} from '../utils/orderPricing';

type Props = {services: ServiceItem[]; accessToken: string; packageId: string; onBack: () => void};
export default function PackageDetailScreen({services, accessToken, packageId, onBack}: Props) {
  const [offer, setOffer] = useState<PackageOffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {setOffer(await getPackage(accessToken, packageId));}
    catch (cause) {setError(cause instanceof Error ? cause.message : 'Package unavailable.');}
    finally {setLoading(false);}
  }, [accessToken, packageId]);
  useEffect(() => {load();}, [load]);
  const buy = async () => {
    if (buying) return;
    setBuying(true); setError(''); setSuccess('');
    try {await purchasePackage(accessToken, packageId); setSuccess('Package activated. You can apply its credits at checkout.');}
    catch (cause) {setError(cause instanceof Error ? cause.message : 'Purchase failed.');}
    finally {setBuying(false);}
  };
  return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.content}>
    <TouchableOpacity onPress={onBack}><Text style={styles.link}>← Back to packages</Text></TouchableOpacity>
    {loading ? <ActivityIndicator accessibilityLabel="Loading package details" /> : null}
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {!offer && !loading ? <TouchableOpacity onPress={() => {load();}}><Text style={styles.link}>Retry</Text></TouchableOpacity> : null}
    {offer ? <>
      <Text style={styles.title}>{offer.name}</Text><Text>{offer.description || 'Monthly package'}</Text>
      <Text style={styles.price}>₹{formatMoney(Number(offer.monthly_price))} · {offer.validity_days ? `${offer.validity_days} days` : 'One month'}</Text>
      <Text style={styles.heading}>Included service credits</Text>
      {offer.package_services.map(service => <Text key={service.service_id}>{service.usage_limit == null ? 'Unlimited' : service.usage_limit} uses · {services.find(item => item.id === service.service_id)?.name ?? 'Laundry service'}</Text>)}
      <Text>Valid for {offer.validity_days ? `${offer.validity_days} days` : 'one month'} from purchase. Credits are applied to eligible services at checkout.</Text>
      {success ? <Text accessibilityLabel="Package purchase success">{success}</Text> : null}
      <TouchableOpacity disabled={buying} style={styles.button} onPress={() => Alert.alert('Confirm package purchase', 'Development uses a simulated payment. No real charge will be made.', [{text: 'Cancel'}, {text: 'Confirm', onPress: () => {buy();}}])}>
        <Text style={styles.buttonText}>{buying ? 'Activating…' : 'Purchase / renew package'}</Text>
      </TouchableOpacity>
    </> : null}
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({page: {flex: 1, backgroundColor: '#fff'}, content: {padding: 20, gap: 16}, title: {fontWeight: '700', fontSize: 24}, heading: {fontWeight: '700', fontSize: 18}, price: {fontWeight: '700', fontSize: 20}, link: {fontWeight: '700'}, error: {color: '#a11'}, button: {backgroundColor: '#111', borderRadius: 12, padding: 16}, buttonText: {color: '#fff', textAlign: 'center', fontWeight: '700'}});
