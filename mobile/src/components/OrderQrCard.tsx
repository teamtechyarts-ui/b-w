import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {getCustomerOrderQr} from '../services/qrApi';
import QrGraphic from './QrGraphic';

type Props = {accessToken: string; orderId: string};
export default function OrderQrCard({accessToken, orderId}: Props) {
  const [payload, setPayload] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setPayload((await getCustomerOrderQr(accessToken, orderId)).payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Order QR is unavailable.');
    } finally {
      setLoading(false);
    }
  }, [accessToken, orderId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>ORDER QR</Text>
      <Text style={styles.detail}>Show this QR code to the B&W team member during handoff.</Text>
      {loading ? <ActivityIndicator accessibilityLabel="Loading order QR" color="#1F5849" /> : null}
      {payload ? <QrGraphic payload={payload} /> : null}
      {error ? (
        <View style={styles.errorRow}>
          <Text style={styles.error}>{error}</Text>
          <TouchableOpacity onPress={load} accessibilityRole="button" accessibilityLabel="Retry loading order QR">
            <Text style={styles.retry}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {padding: 18, borderWidth: 1, borderColor: '#E2DED6', borderRadius: 16, backgroundColor: '#fff', marginBottom: 16, alignItems: 'center'},
  title: {fontSize: 16, fontWeight: '800', letterSpacing: 0.5, color: '#1B1B18', marginBottom: 6},
  detail: {color: '#656159', textAlign: 'center', fontSize: 13, lineHeight: 18, marginBottom: 14},
  errorRow: {alignItems: 'center', gap: 7, marginTop: 8},
  error: {color: '#9A241E', fontSize: 13},
  retry: {fontWeight: '700', color: '#1F5849', fontSize: 13},
});

