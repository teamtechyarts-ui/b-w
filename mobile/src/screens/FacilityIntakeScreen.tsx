import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AppIcon from '../components/AppIcon';
import { colors, spacing, borderRadius, typography, shadows } from '../theme/designSystem';
import {
  IntakePreview,
  confirmFacilityReceipt,
  confirmFacilityReceiptByOrderId,
  previewFacilityReceipt,
  previewFacilityReceiptByOrderId,
} from '../services/facilityIntakeApi';
import NativeQrScannerButton from '../components/NativeQrScannerButton';

type Props = {
  accessToken: string;
  onBack: () => void;
  onReceived: () => void;
};

export default function FacilityIntakeScreen({
  accessToken,
  onBack,
  onReceived,
}: Props) {
  const [orderNumber, setOrderNumber] = useState('');
  const [receiptInput, setReceiptInput] = useState<{
    kind: 'qr' | 'order';
    value: string;
  } | null>(null);
  const [preview, setPreview] = useState<IntakePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const lock = useRef(false);

  const lookupQr = async (scannedCode: string) => {
    if (lock.current) return;
    const token = scannedCode.trim();
    setPreview(null);
    setError('');
    setSuccess('');
    if (
      !/^(?:BW1:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        token,
      )
    ) {
      setError('The scanned QR is not a valid B&W handoff code.');
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      setPreview(await previewFacilityReceipt(accessToken, token));
      setReceiptInput({ kind: 'qr', value: token });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Order intake unavailable.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  const lookupOrder = async () => {
    if (lock.current) return;
    const normalized = orderNumber.trim().toUpperCase();
    setPreview(null);
    setReceiptInput(null);
    setError('');
    setSuccess('');
    if (!/^BW-[A-Z0-9-]{6,40}$/.test(normalized)) {
      setError(
        'Enter the complete B&W order ID, for example BW-20260921-ABC12345.',
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      setPreview(
        await previewFacilityReceiptByOrderId(accessToken, normalized),
      );
      setReceiptInput({ kind: 'order', value: normalized });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Order intake unavailable.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (lock.current || !preview || !receiptInput) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const receipt =
        receiptInput.kind === 'qr'
          ? await confirmFacilityReceipt(accessToken, receiptInput.value)
          : await confirmFacilityReceiptByOrderId(
              accessToken,
              receiptInput.value,
            );
      if (!receipt.received || receipt.orderId !== preview.orderId)
        throw new Error(
          'Receipt could not be confirmed. Refresh and check the order.',
        );
      setPreview(null);
      setReceiptInput(null);
      setOrderNumber('');
      setSuccess(`Order ${preview.orderNumber} received at facility.`);
      onReceived();
    } catch (cause) {
      setPreview(null);
      setError(
        cause instanceof Error ? cause.message : 'Unable to confirm receipt.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.page} edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.backButton}
            onPress={onBack}
          >
            <AppIcon name="arrow-left" size={16} color={colors.primary} />
            <Text style={styles.link}>← Back</Text>
          </TouchableOpacity>
          <View style={styles.headerTitleGroup}>
            <Text style={styles.eyebrow}>SECURE HANDOFF</Text>
            <Text style={styles.title}>Receive an order</Text>
          </View>
        </View>

        <Text style={styles.help}>
          Scan the driver’s handoff QR or enter the order ID shown on the Driver
          screen. Review physical items before accepting.
        </Text>

        <NativeQrScannerButton
          label="Scan driver’s handoff QR"
          onScanned={lookupQr}
        />

        <View style={styles.divider}>
          <View style={styles.line} />
          <Text style={styles.or}>OR ENTER ORDER ID</Text>
          <View style={styles.line} />
        </View>

        <TextInput
          accessibilityLabel="Order ID"
          autoCapitalize="characters"
          value={orderNumber}
          onChangeText={value => {
            setOrderNumber(value);
            setPreview(null);
            setReceiptInput(null);
            setError('');
          }}
          placeholder="BW-20260921-ABC12345"
          placeholderTextColor={colors.textSubtle}
          style={styles.input}
        />

        <TouchableOpacity
          accessibilityRole="button"
          style={styles.secondaryButton}
          disabled={busy}
          onPress={lookupOrder}
        >
          <Text style={styles.secondaryText}>Find order by ID</Text>
        </TouchableOpacity>

        {busy ? (
          <ActivityIndicator accessibilityLabel="Checking facility intake" color={colors.primary} />
        ) : null}

        {error ? (
          <View style={styles.errorBanner}>
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          </View>
        ) : null}

        {success ? (
          <View style={styles.successBanner}>
            <Text accessibilityLiveRegion="polite" style={styles.successMessage}>{success}</Text>
          </View>
        ) : null}

        {preview ? (
          <View style={styles.card}>
            <View style={styles.previewHeader}>
              <Text style={styles.heading}>Order {preview.orderNumber}</Text>
              <View style={styles.statusPill}>
                <Text style={styles.statusPillText}>
                  {preview.orderStatus.replace(/_/g, ' ')}
                </Text>
              </View>
            </View>
            <Text style={styles.facilityName}>Assigned facility: {preview.facility.name}</Text>
            <Text style={styles.status}>Status: {preview.orderStatus.replace(/_/g, ' ')}</Text>

            <View style={styles.itemsSection}>
              <Text style={styles.itemsHeading}>Physical handover items</Text>
              {preview.items.length ? (
                preview.items.map((item, index) => (
                  <View key={`${item.item_name}-${index}`} style={styles.itemRow}>
                    <Text style={styles.itemText}>
                      {item.quantity} × {item.item_name}
                      {item.weight_kg ? ` · ${item.weight_kg} kg` : ''}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={styles.muted}>
                  No item details recorded. Check with dispatch before confirming.
                </Text>
              )}
            </View>

            <TouchableOpacity
              accessibilityRole="button"
              style={[styles.primaryButton, (busy || !preview.items.length) && styles.buttonDisabled]}
              disabled={busy || !preview.items.length}
              onPress={confirm}
            >
              <Text style={styles.primaryText}>Confirm physical receipt</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxxl },
  header: { gap: spacing.xs, paddingVertical: spacing.xs },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    minHeight: 36,
  },
  headerTitleGroup: { marginTop: 2 },
  eyebrow: {
    fontSize: 11,
    letterSpacing: 1.2,
    fontWeight: '800',
    color: colors.textMuted,
  },
  title: { fontSize: 22, fontWeight: '800', color: colors.textPrimary, marginTop: 2 },
  heading: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
  help: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  link: { fontWeight: '700', color: colors.textPrimary },
  input: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
    color: colors.textPrimary,
    minHeight: 44,
  },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    gap: spacing.sm,
    ...shadows.sm,
  },
  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusPill: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'capitalize',
  },
  facilityName: { fontSize: 13, color: colors.textSecondary },
  status: { fontSize: 13, color: colors.textMuted, textTransform: 'capitalize' },
  itemsSection: {
    gap: 4,
    backgroundColor: colors.surfaceSubtle,
    padding: spacing.sm,
    borderRadius: borderRadius.sm,
    marginTop: spacing.xs,
  },
  itemsHeading: { fontSize: 13, fontWeight: '800', color: colors.textPrimary, marginBottom: 2 },
  itemRow: { paddingVertical: 2 },
  itemText: { fontSize: 13, color: colors.textPrimary, fontWeight: '600' },
  muted: { fontSize: 12, color: colors.textMuted },
  divider: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginVertical: spacing.xs },
  line: { height: 1, flex: 1, backgroundColor: colors.border },
  or: { fontSize: 10, letterSpacing: 1, fontWeight: '800', color: colors.textMuted },
  primaryButton: {
    minHeight: 48,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xs,
  },
  primaryText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
  secondaryButton: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
  },
  secondaryText: { fontWeight: '700', color: colors.textPrimary, fontSize: 13 },
  buttonDisabled: { opacity: 0.5 },
  errorBanner: {
    backgroundColor: colors.dangerSurface,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: borderRadius.sm,
    padding: spacing.md,
  },
  error: { color: colors.dangerText, fontSize: 13, fontWeight: '600' },
  successBanner: {
    backgroundColor: colors.successSurface,
    borderWidth: 1,
    borderColor: colors.successBorder,
    borderRadius: borderRadius.sm,
    padding: spacing.md,
  },
  successMessage: { color: colors.successText, fontWeight: '700', fontSize: 13 },
});

