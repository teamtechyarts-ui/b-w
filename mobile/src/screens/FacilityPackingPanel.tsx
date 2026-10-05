import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  PackingDetails,
  confirmFacilityPacking,
  getFacilityPacking,
} from '../services/facilityPackingApi';

type Props = {
  accessToken: string;
  orderId: string;
  onChanged: () => void;
  onReadiness: (ready: boolean) => void;
};
export default function FacilityPackingPanel({
  accessToken,
  orderId,
  onChanged,
  onReadiness,
}: Props) {
  const [details, setDetails] = useState<PackingDetails | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getFacilityPacking(accessToken, orderId);
      setDetails(result);
      setCounts(
        Object.fromEntries(
          result.items.map(item => [
            item.id,
            String(item.verifiedQuantity ?? ''),
          ]),
        ),
      );
      onReadiness(
        !result.packingRequired ||
          result.history.some(row => row.cycle_number === result.cycleNumber),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Final packing unavailable.',
      );
      onReadiness(false);
    } finally {
      setLoading(false);
    }
  }, [accessToken, orderId, onReadiness]);
  useEffect(() => {
    load();
  }, [load]);
  const submit = async () => {
    if (lock.current || !details) return;
    setError('');
    setMessage('');
    const items = details.items.map(item => ({
      orderItemId: item.id,
      packedQuantity: Number(counts[item.id]),
    }));
    if (
      !items.length ||
      details.items.some(
        (item, index) =>
          item.verifiedQuantity == null ||
          counts[item.id]?.trim() === '' ||
          !Number.isInteger(items[index].packedQuantity) ||
          items[index].packedQuantity !== item.verifiedQuantity,
      )
    ) {
      setError(
        'Packed counts must match the Facility-verified intake count for every item.',
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      await confirmFacilityPacking(accessToken, orderId, items, notes.trim());
      setMessage(
        'Final packing confirmed. QC approval can make this order ready for delivery.',
      );
      await load();
      onChanged();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to confirm final packing.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
function formatTimestamp(isoString?: string | null): string {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}

  return (
    <View style={styles.panel}>
      <Text style={styles.heading}>
        Final packing · cycle {details?.cycleNumber ?? 0}
      </Text>
      {loading ? (
        <ActivityIndicator accessibilityLabel="Loading final packing" />
      ) : null}
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      {error ? (
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => {
            load();
          }}
        >
          <Text>Retry packing</Text>
        </TouchableOpacity>
      ) : null}
      {message ? <Text accessibilityLiveRegion="polite">{message}</Text> : null}
      {details?.history.map(record => (
        <View key={record.id} style={styles.record}>
          <Text style={styles.recordTitle}>
            Cycle {record.cycle_number} · Packing confirmed
          </Text>
          <Text>Packed: {formatTimestamp(record.packed_at)}</Text>
          <Text>
            Items:{' '}
            {record.items.reduce((sum, item) => sum + item.packed_quantity, 0)}
          </Text>
          {record.notes ? <Text>Notes: {record.notes}</Text> : null}
        </View>
      ))}
      {details && !details.history.length ? (
        <Text style={styles.mutedText}>
          {[
            'ready_for_delivery',
            'delivery_assigned',
            'delivery_accepted',
            'en_route_delivery',
            'delivery_otp_pending',
            'delivered',
            'claim_period_active',
          ].includes(details.orderStatus)
            ? 'Packing verified and sealed for delivery dispatch.'
            : 'No final packing recorded yet.'}
        </Text>
      ) : null}
      {details?.canPack ? (
        <>
          <Text>
            Confirm every garment against the Facility-verified intake count.
          </Text>
          {details.items.map(item => (
            <View key={item.id}>
              <Text>
                {item.item_name} · verified{' '}
                {item.verifiedQuantity ?? 'unavailable'}
              </Text>
              <TextInput
                accessibilityLabel={`Packed count for ${item.item_name}`}
                keyboardType="number-pad"
                value={counts[item.id] ?? ''}
                onChangeText={count =>
                  setCounts(current => ({ ...current, [item.id]: count }))
                }
                style={styles.input}
              />
            </View>
          ))}
          <TextInput
            accessibilityLabel="Final packing notes"
            value={notes}
            onChangeText={setNotes}
            placeholder="Packing notes (optional)"
            multiline
            style={styles.input}
          />
          <TouchableOpacity
            accessibilityRole="button"
            disabled={busy}
            onPress={() => {
              submit();
            }}
          >
            <Text>Confirm final packing</Text>
          </TouchableOpacity>
        </>
      ) : null}
      {details &&
      !details.canPack &&
      details.orderStatus === 'processing' &&
      !details.history.some(
        record => record.cycle_number === details.cycleNumber,
      ) ? (
        <Text>Complete the Pack processing step before final packing.</Text>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  panel: { gap: 10, paddingVertical: 14 },
  heading: { fontSize: 19, fontWeight: '700' },
  input: { borderWidth: 1, borderColor: '#bbb', borderRadius: 9, padding: 10 },
  record: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 9,
    padding: 10,
    gap: 5,
  },
  recordTitle: { fontWeight: '800' },
  mutedText: { color: '#67635B', fontSize: 13 },
});
