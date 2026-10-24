import React, {useEffect, useState} from 'react';
import {ActivityIndicator, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {getMyPackages} from '../services/packagesApi';
import type {CustomerPackage} from '../services/packagesApi';
import type {CartItem} from '../types/service';
import {packageDiscount} from '../utils/packagePricing';
import {formatMoney} from '../utils/orderPricing';

type Props = {accessToken: string; items: CartItem[]; selected: CustomerPackage | null; onChange: (value: CustomerPackage | null) => void};
export default function PackageCheckoutSection({accessToken, items, selected, onChange}: Props) {
  const [mine, setMine] = useState<CustomerPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    getMyPackages(accessToken).then(data => {if (active) setMine(data);})
      .catch(cause => {if (active) setError(cause instanceof Error ? cause.message : 'Package balance unavailable.');})
      .finally(() => {if (active) setLoading(false);});
    return () => {active = false;};
  }, [accessToken]);
  const eligible = mine.filter(item => packageDiscount(item, items) > 0);
  return <View style={styles.card}>
    <Text style={styles.title}>Package credits</Text>
    {loading ? <ActivityIndicator accessibilityLabel="Loading package credits" /> : null}
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {!loading && !error && !eligible.length ? <Text>No package credits apply to these services.</Text> : null}
    {eligible.map(item => {
      const isChecked = selected?.id === item.id;
      return (
        <TouchableOpacity key={item.id} onPress={() => onChange(isChecked ? null : item)} style={styles.row}>
          <View style={styles.radioRow}>
            <View style={[styles.radioOuter, isChecked && styles.radioOuterSelected]}>
              {isChecked ? <View style={styles.radioInner} /> : null}
            </View>
            <Text style={styles.packageLabel}>{item.packages?.name ?? 'Package'} · save about ₹{formatMoney(packageDiscount(item, items))}</Text>
          </View>
          <Text style={styles.validityText}>Valid until {new Date(item.expires_at).toLocaleDateString()}</Text>
        </TouchableOpacity>
      );
    })}
    {selected ? <TouchableOpacity onPress={() => onChange(null)}><Text style={styles.link}>Remove package</Text></TouchableOpacity> : null}
    <Text style={styles.note}>Final credit use and price are confirmed by the server when you place the order.</Text>
  </View>;
}
const styles = StyleSheet.create({
  card: {borderWidth: 1, borderColor: '#ddd', borderRadius: 16, padding: 16, gap: 10, marginBottom: 14},
  title: {fontWeight: '700', fontSize: 16},
  row: {paddingVertical: 8, gap: 4},
  radioRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  radioOuter: {width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#888', alignItems: 'center', justifyContent: 'center'},
  radioOuterSelected: {borderColor: '#111'},
  radioInner: {width: 10, height: 10, borderRadius: 5, backgroundColor: '#111'},
  packageLabel: {flex: 1, fontWeight: '600', color: '#111'},
  validityText: {fontSize: 12, color: '#666', marginLeft: 26},
  link: {fontWeight: '700'},
  note: {color: '#555', fontSize: 12},
  error: {color: '#a11'},
});
