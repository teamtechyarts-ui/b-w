import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AppIcon from '../components/AppIcon';
import { colors, spacing, borderRadius, typography, shadows } from '../theme/designSystem';
import {
  FacilityIntakeDetails,
  IntakeItem,
  ItemMeasurement,
  getFacilityIntake,
  resolveFacilityDiscrepancy,
  verifyFacilityIntake,
} from '../services/facilityVerificationApi';
import FacilityProcessingPanel from './FacilityProcessingPanel';
import FacilityPackingPanel from './FacilityPackingPanel';
import {useOrderRealtime} from '../hooks/useRealtime';

type Props = {
  accessToken: string;
  orderId: string;
  onBack: () => void;
  onChanged: () => void;
};
type Entry = {
  quantity: string;
  weight: string;
  damaged: boolean;
  notes: string;
};

function initialEntries(items: IntakeItem[]): Record<string, Entry> {
  return Object.fromEntries(
    items.map(item => [
      item.id,
      {
        quantity: String(item.quantity),
        weight: item.weight_kg == null ? '' : String(item.weight_kg),
        damaged: false,
        notes: '',
      },
    ]),
  );
}

export default function FacilityVerificationScreen({
  accessToken,
  orderId,
  onBack,
  onChanged,
}: Props) {
  const insets = useSafeAreaInsets();
  const [detail, setDetail] = useState<FacilityIntakeDetails | null>(null);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [resolutionNotes, setResolutionNotes] = useState<
    Record<string, string>
  >({});
  const [overallNotes, setOverallNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [packingReady, setPackingReady] = useState(false);
  const [workflowRefresh, setWorkflowRefresh] = useState(0);
  const lock = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getFacilityIntake(accessToken, orderId);
      setDetail(result);
      if (result.orderStatus === 'received_at_facility')
        setEntries(initialEntries(result.items));
    } catch (cause) {
      setDetail(null);
      setError(
        cause instanceof Error
          ? cause.message
          : 'Garment verification unavailable.',
      );
    } finally {
      setLoading(false);
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
                  orderStatus: nextStatus,
                }
              : prev,
          );
        }
        load();
      },

      [load],
    ),
    accessToken,
    !!accessToken && !!orderId,
  );

  useEffect(() => {
    load();
  }, [load]);

  const edit = (id: string, patch: Partial<Entry>) =>
    setEntries(current => ({ ...current, [id]: { ...current[id], ...patch } }));

  const submit = async () => {
    if (lock.current || !detail) return;
    setError('');
    setMessage('');
    const items: ItemMeasurement[] = [];
    for (const item of detail.items) {
      const entry = entries[item.id];
      const quantity = Number(entry?.quantity);
      const weight = entry?.weight.trim() ? Number(entry.weight) : null;
      if (
        !entry ||
        !Number.isInteger(quantity) ||
        quantity < 0 ||
        (weight !== null && (!Number.isFinite(weight) || weight < 0))
      ) {
        setError('Enter a valid measured count and weight for every item.');
        return;
      }
      const differentWeight =
        item.weight_kg != null && weight !== Number(item.weight_kg);
      if (
        (quantity !== item.quantity || differentWeight || entry.damaged) &&
        !entry.notes.trim()
      ) {
        setError(`Add discrepancy notes for ${item.item_name}.`);
        return;
      }
      items.push({
        orderItemId: item.id,
        countedQuantity: quantity,
        weightKg: weight,
        damaged: entry.damaged,
        notes: entry.notes.trim(),
      });
    }
    if (!items.length) {
      setError('No garment items are available to verify.');
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      const result = await verifyFacilityIntake(
        accessToken,
        orderId,
        items,
        overallNotes.trim(),
      );
      setMessage(
        result.discrepancyCount
          ? `Verification saved with ${result.discrepancyCount} open discrepancy records. Manager resolution is required before processing.`
          : 'Garment verification saved.',
      );
      onChanged();
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to save garment verification.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  const resolve = async (id: string) => {
    if (lock.current) return;
    const notes = resolutionNotes[id]?.trim();
    if (!notes) {
      setError('Resolution notes are required.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await resolveFacilityDiscrepancy(accessToken, orderId, id, notes);
      setMessage('Discrepancy resolved and retained in the intake history.');
      onChanged();
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to resolve discrepancy.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  const openCount =
    detail?.discrepancies.filter(item => item.status === 'open').length ?? 0;

  const isVerificationMode = detail?.orderStatus === 'received_at_facility';

  return (
    <SafeAreaView style={styles.page} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            isVerificationMode && { paddingBottom: 110 + (insets?.bottom ?? 0) },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
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
              <Text style={styles.eyebrow}>ORDER WORKFLOW</Text>
              <Text style={styles.title}>Garment verification</Text>
            </View>
          </View>

          {loading ? (
            <ActivityIndicator
              accessibilityLabel="Loading garment verification"
              color={colors.primary}
              style={styles.loader}
            />
          ) : null}

          {error ? (
            <View style={styles.errorBanner}>
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
              {!isVerificationMode ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  style={styles.retryButton}
                  onPress={() => {
                    load();
                  }}
                >
                  <Text style={styles.link}>Retry verification</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}

          {message ? (
            <View style={styles.successBanner}>
              <Text accessibilityLiveRegion="polite" style={styles.successMessage}>
                {message}
              </Text>
            </View>
          ) : null}

          {detail ? (
            <>
              {/* Compact Order Summary Bar */}
              <View style={styles.orderSummary}>
                <View style={styles.summaryTopRow}>
                  <Text style={styles.heading}>Order {detail.orderNumber}</Text>
                  <View style={styles.statusPill}>
                    <Text style={styles.statusText}>
                      {detail.orderStatus.replace(/_/g, ' ')}
                    </Text>
                  </View>
                </View>
                <Text style={styles.summaryLine}>{detail.facility.name}</Text>
              </View>

              {/* Verification Form */}
              {isVerificationMode ? (
                <>
                  <View style={styles.instruction}>
                    <Text style={styles.instructionTitle}>1. Compare the handoff</Text>
                    <Text style={styles.instructionText}>
                      Confirm physical count and weight for each garment. Add notes only when something differs or is damaged.
                    </Text>
                  </View>

                  {detail.items.length ? (
                    detail.items.map(item => {
                      const entry = entries[item.id];
                      const hasDiscrepancy =
                        entry &&
                        (Number(entry.quantity) !== item.quantity ||
                          (item.weight_kg != null &&
                            entry.weight.trim() !== '' &&
                            Number(entry.weight) !== Number(item.weight_kg)) ||
                          entry.damaged);

                      return (
                        <View key={item.id} style={styles.card}>
                          <View style={styles.cardHeader}>
                            <Text style={styles.itemName}>{item.item_name}</Text>
                            <View style={styles.expectedBadge}>
                              <Text style={styles.expected}>
                                Expected: {item.quantity} item{item.quantity === 1 ? '' : 's'}
                                {item.weight_kg == null ? '' : ` · ${item.weight_kg} kg`}
                              </Text>
                            </View>
                          </View>

                          <View style={styles.fieldGrid}>
                            <View style={styles.fieldCol}>
                              <Text style={styles.fieldLabel}>Count received</Text>
                              <TextInput
                                accessibilityLabel={`Measured count for ${item.item_name}`}
                                keyboardType="number-pad"
                                value={entry?.quantity ?? ''}
                                onChangeText={quantity => edit(item.id, { quantity })}
                                style={styles.input}
                              />
                            </View>

                            <View style={styles.fieldCol}>
                              <Text style={styles.fieldLabel}>Weight received</Text>
                              <TextInput
                                accessibilityLabel={`Measured weight for ${item.item_name}`}
                                keyboardType="decimal-pad"
                                value={entry?.weight ?? ''}
                                onChangeText={weight => edit(item.id, { weight })}
                                placeholder="Measured kg, if applicable"
                                placeholderTextColor={colors.textSubtle}
                                style={styles.input}
                              />
                            </View>
                          </View>

                          <TouchableOpacity
                            accessibilityRole="button"
                            style={[
                              styles.damageToggle,
                              entry?.damaged && styles.damageToggleActive,
                            ]}
                            onPress={() =>
                              edit(item.id, { damaged: !entry?.damaged })
                            }
                          >
                            <Text
                              style={[
                                styles.link,
                                styles.damageToggleText,
                                entry?.damaged && styles.damageToggleTextActive,
                              ]}
                            >
                              {entry?.damaged
                                ? 'Damaged at receipt: Yes'
                                : 'Damaged at receipt: No'}
                            </Text>
                          </TouchableOpacity>

                          <View style={styles.notesGroup}>
                            <Text style={[styles.fieldLabel, hasDiscrepancy && styles.fieldLabelRequired]}>
                              {hasDiscrepancy ? 'Discrepancy note (Required):' : 'Item notes (optional):'}
                            </Text>
                            <TextInput
                              accessibilityLabel={`Discrepancy notes for ${item.item_name}`}
                              value={entry?.notes ?? ''}
                              onChangeText={notes => edit(item.id, { notes })}
                              placeholder="Notes for missing, extra, damaged or weight mismatch"
                              placeholderTextColor={colors.textSubtle}
                              multiline
                              style={[
                                styles.input,
                                styles.notesInput,
                                hasDiscrepancy && !entry?.notes.trim() && styles.inputWarning,
                              ]}
                            />
                          </View>
                        </View>
                      );
                    })
                  ) : (
                    <Text style={styles.muted}>No garments are listed for this order.</Text>
                  )}

                  <View style={styles.overallNotesCard}>
                    <Text style={styles.fieldLabel}>Overall verification notes (optional)</Text>
                    <TextInput
                      accessibilityLabel="Overall verification notes"
                      value={overallNotes}
                      onChangeText={setOverallNotes}
                      placeholder="Overall intake notes (optional)"
                      placeholderTextColor={colors.textSubtle}
                      multiline
                      style={[styles.input, styles.notesInput]}
                    />
                  </View>
                </>
              ) : null}

              {detail.inspections.length ? (
                <Text style={styles.recordSummaryText}>
                  Measured item records: {detail.inspections.length}
                </Text>
              ) : null}

              {/* Discrepancies Section */}
              <View style={styles.discrepancyHeaderRow}>
                <Text style={styles.heading}>
                  Intake discrepancies · {openCount} open
                </Text>
              </View>

              {detail.discrepancies.length ? (
                detail.discrepancies.map(discrepancy => (
                  <View key={discrepancy.id} style={styles.discrepancyCard}>
                    <View style={styles.discrepancyTop}>
                      <Text style={styles.discrepancyKind}>
                        {discrepancy.kind.replace(/_/g, ' ')} · {discrepancy.status}
                      </Text>
                      <View style={[styles.discrepancyStatusPill, discrepancy.status === 'open' ? styles.pillOpen : styles.pillResolved]}>
                        <Text style={styles.discrepancyStatusText}>{discrepancy.status}</Text>
                      </View>
                    </View>
                    <Text style={styles.discrepancyCounts}>
                      Listed {discrepancy.expected_quantity}; counted {discrepancy.counted_quantity}
                    </Text>
                    {discrepancy.notes ? (
                      <Text style={styles.discrepancyNotes}>{discrepancy.notes}</Text>
                    ) : null}
                    {discrepancy.status === 'resolved' ? (
                      <View style={styles.resolvedBox}>
                        <Text style={styles.resolvedText}>
                          Resolution: {discrepancy.resolution_notes}
                        </Text>
                      </View>
                    ) : null}
                    {discrepancy.status === 'open' && detail.role === 'manager' ? (
                      <View style={styles.managerResolveBox}>
                        <TextInput
                          accessibilityLabel={`Resolution notes for ${discrepancy.kind}`}
                          value={resolutionNotes[discrepancy.id] ?? ''}
                          onChangeText={notes =>
                            setResolutionNotes(current => ({
                              ...current,
                              [discrepancy.id]: notes,
                            }))
                          }
                          placeholder="Resolution notes"
                          placeholderTextColor={colors.textSubtle}
                          multiline
                          style={[styles.input, styles.notesInput]}
                        />
                        <TouchableOpacity
                          accessibilityRole="button"
                          style={styles.resolveButton}
                          disabled={busy}
                          onPress={() => {
                            resolve(discrepancy.id);
                          }}
                        >
                          <Text style={[styles.link, styles.resolveButtonText]}>Resolve discrepancy</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}
                  </View>
                ))
              ) : (
                <Text style={styles.muted}>No intake discrepancies recorded.</Text>
              )}

              {openCount ? (
                <View style={styles.discrepancyAlert}>
                  <Text style={styles.alertTitle}>Action required</Text>
                  <Text accessibilityRole="alert" style={styles.alertText}>
                    Processing is blocked until every intake discrepancy is resolved.
                  </Text>
                </View>
              ) : null}

              {/* Processing and Packing Panels */}
              {[
                'verification',
                'processing',
                'rework_required',
                'ready_for_delivery',
                'quality_check',
              ].includes(detail.orderStatus) ? (
                <>
                  <FacilityPackingPanel
                    key={`pack-${workflowRefresh}`}
                    accessToken={accessToken}
                    orderId={orderId}
                    onReadiness={setPackingReady}
                    onChanged={() => {
                      onChanged();
                      load();
                      setWorkflowRefresh(value => value + 1);
                    }}
                  />
                  <FacilityProcessingPanel
                    key={`process-${workflowRefresh}`}
                    accessToken={accessToken}
                    orderId={orderId}
                    items={detail.items}
                    packingReady={packingReady}
                    onChanged={() => {
                      onChanged();
                      load();
                      setPackingReady(false);
                      setWorkflowRefresh(value => value + 1);
                    }}
                  />
                </>
              ) : null}
            </>
          ) : !loading && !error ? (
            <Text style={styles.muted}>Order intake data unavailable.</Text>
          ) : null}
        </ScrollView>

        {/* Sticky Bottom Action Bar for Verification Mode */}
        {isVerificationMode && detail ? (
          <View
            style={[
              styles.stickyBottomBar,
              { paddingBottom: Math.max(spacing.md, insets?.bottom ?? 0) },
            ]}
          >
            <TouchableOpacity
              accessibilityRole="button"
              style={[
                styles.primarySubmitButton,
                (busy || !detail.items.length) && styles.submitButtonDisabled,
              ]}
              disabled={busy || !detail.items.length}
              onPress={submit}
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.primarySubmitText}>
                  Save garment verification
                </Text>
              )}
            </TouchableOpacity>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxxl },
  loader: { marginVertical: spacing.md },
  header: {
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    minHeight: 36,
    paddingVertical: 4,
  },
  headerTitleGroup: { marginTop: 2 },
  eyebrow: {
    fontSize: 11,
    letterSpacing: 1.2,
    fontWeight: '800',
    color: colors.textMuted,
  },
  title: { fontSize: 22, fontWeight: '800', color: colors.textPrimary, marginTop: 2 },
  heading: { fontSize: 16, fontWeight: '800', color: colors.textPrimary, flexShrink: 1 },
  orderSummary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    gap: 4,
    ...shadows.sm,
  },
  summaryTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLine: { color: colors.textSecondary, fontSize: 13 },
  statusPill: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusText: {
    color: colors.textSecondary,
    fontWeight: '700',
    fontSize: 11,
    textTransform: 'capitalize',
  },
  instruction: {
    backgroundColor: colors.infoSurface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    gap: 4,
    borderWidth: 1,
    borderColor: colors.infoBorder,
  },
  instructionTitle: { fontWeight: '800', fontSize: 14, color: colors.infoText },
  instructionText: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    gap: spacing.sm,
    ...shadows.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  itemName: { fontSize: 15, fontWeight: '800', color: colors.textPrimary, flexShrink: 1 },
  expectedBadge: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: borderRadius.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  expected: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  fieldGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  fieldCol: {
    flex: 1,
    gap: 4,
  },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  fieldLabelRequired: { color: colors.warningText, fontWeight: '800' },
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
  inputWarning: {
    borderColor: colors.warning,
    backgroundColor: colors.warningSurface,
  },
  damageToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceSubtle,
    minHeight: 40,
  },
  damageToggleActive: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  damageToggleText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  damageToggleTextActive: {
    color: colors.dangerText,
    fontWeight: '800',
  },
  notesGroup: {
    gap: 4,
    marginTop: 2,
  },
  notesInput: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  overallNotesCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  recordSummaryText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  discrepancyHeaderRow: {
    marginTop: spacing.xs,
  },
  discrepancyCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  discrepancyTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  discrepancyKind: { fontSize: 13, fontWeight: '800', color: colors.textPrimary, textTransform: 'capitalize' },
  discrepancyStatusPill: {
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  pillOpen: { backgroundColor: colors.warningSurface },
  pillResolved: { backgroundColor: colors.successSurface },
  discrepancyStatusText: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, textTransform: 'capitalize' },
  discrepancyCounts: { fontSize: 13, color: colors.textSecondary },
  discrepancyNotes: { fontSize: 12, color: colors.textMuted, fontStyle: 'italic' },
  resolvedBox: {
    backgroundColor: colors.successSurface,
    padding: spacing.sm,
    borderRadius: borderRadius.xs,
    marginTop: 2,
  },
  resolvedText: { fontSize: 12, color: colors.successText, fontWeight: '600' },
  managerResolveBox: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  resolveButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.sm,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resolveButtonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  discrepancyAlert: {
    backgroundColor: colors.warningSurface,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    gap: 4,
  },
  alertTitle: { fontWeight: '800', fontSize: 14, color: colors.warningText },
  alertText: { fontSize: 13, color: colors.warningText },
  link: { fontWeight: '700', color: colors.textPrimary },
  muted: { color: colors.textMuted, fontSize: 13 },
  errorBanner: {
    backgroundColor: colors.dangerSurface,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: borderRadius.sm,
    padding: spacing.md,
    gap: spacing.xs,
  },
  error: { color: colors.dangerText, fontSize: 13, fontWeight: '600' },
  retryButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.danger,
    borderRadius: borderRadius.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  retryText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12 },
  successBanner: {
    backgroundColor: colors.successSurface,
    borderWidth: 1,
    borderColor: colors.successBorder,
    borderRadius: borderRadius.sm,
    padding: spacing.md,
  },
  successMessage: { color: colors.successText, fontWeight: '700', fontSize: 13 },
  stickyBottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.xs,
    ...shadows.lg,
  },
  inlineStickyError: {
    color: colors.dangerText,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  primarySubmitButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  primarySubmitText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15,
  },
});

