import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AppIcon from '../components/AppIcon';
import { colors, spacing, borderRadius, typography, shadows } from '../theme/designSystem';
import {
  ProcessingHistory,
  ProcessingStage,
  completeFacilityStage,
  getFacilityProcessing,
  recordFacilityQualityDecision,
  startFacilityStage,
} from '../services/facilityProcessingApi';
import {useOrderRealtime} from '../hooks/useRealtime';

const labels: Record<ProcessingStage, string> = {
  washing: 'Wash',
  drying: 'Dry',
  ironing: 'Iron',
  folding: 'Fold',
  packaging: 'Pack',
};

const workflow = ['Wash', 'Dry', 'Iron', 'Fold', 'Pack', 'QC'] as const;

type Props = {
  accessToken: string;
  orderId: string;
  onChanged: () => void;
  items?: Array<{ id: string; item_name: string }>;
  packingReady?: boolean;
};

export default function FacilityProcessingPanel({
  accessToken,
  orderId,
  onChanged,
  items = [],
  packingReady = false,
}: Props) {
  const [history, setHistory] = useState<ProcessingHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reason, setReason] = useState('');
  const [defectCode, setDefectCode] = useState('');
  const [affectedItemIds, setAffectedItemIds] = useState<string[]>([]);
  const lock = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setHistory(await getFacilityProcessing(accessToken, orderId));
    } catch (cause) {
      setHistory(null);
      setError(
        cause instanceof Error
          ? cause.message
          : 'Facility processing history unavailable.',
      );
    } finally {
      setLoading(false);
    }
  }, [accessToken, orderId]);

  useOrderRealtime(
    orderId,
    useCallback(() => {
      refresh();
      onChanged();
    }, [refresh, onChanged]),
    accessToken,
    !!accessToken && !!orderId,
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  const act = async (action: () => Promise<unknown>, success: string) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(success);
      await refresh();
      onChanged();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Processing action failed.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  const decide = (approved: boolean) => {
    if (
      approved &&
      (history?.rewashCycle ?? 0) >= 2 &&
      reason.trim().length < 5
    ) {
      setError('Reconciliation notes are required after two rewash cycles.');
      return;
    }
    if (!approved && (!defectCode || reason.trim().length < 5)) {
      setError('Choose a defect and enter a reason of at least 5 characters.');
      return;
    }
    act(
      () =>
        recordFacilityQualityDecision(accessToken, orderId, {
          approved,
          notes: reason.trim(),
          defectCode: approved ? undefined : defectCode,
          affectedItemIds: approved ? [] : affectedItemIds,
        }),
      approved
        ? 'QC passed. Order is ready for delivery.'
        : 'QC failed. Rewash is required.',
    );
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

  const stepState = (label: (typeof workflow)[number]) => {
    const stageType: Record<string, ProcessingStage> = {
      Wash: 'washing',
      Dry: 'drying',
      Iron: 'ironing',
      Fold: 'folding',
      Pack: 'packaging',
    };
    const isPostQc = [
      'ready_for_delivery',
      'delivery_assigned',
      'delivery_accepted',
      'en_route_delivery',
      'delivery_otp_pending',
      'delivered',
      'claim_period_active',
    ].includes(history?.orderStatus ?? '');

    if (label === 'QC') {
      if (
        (history?.qualityDecisions?.some(item => item.approved) &&
          !history?.rewashCycle) ||
        isPostQc
      ) {
        return 'complete';
      }
      return history?.canQualityCheck ? 'active' : 'waiting';
    }

    const opType = stageType[label];
    const stage = history?.stages
      ?.filter(item => item.operation_type === opType)
      ?.at(-1);

    if (stage?.completed_at || isPostQc) return 'complete';
    if ((stage && !stage.completed_at) || history?.nextStage === opType)
      return 'active';
    return 'waiting';
  };

  return (
    <View style={styles.panel}>
      <Text style={styles.heading}>Processing workflow</Text>

      {/* Modern Compact Stepper */}
      <View style={styles.stepper} accessibilityLabel="Processing stages stepper">
        {workflow.map((label, index) => {
          const state = stepState(label);
          return (
            <React.Fragment key={label}>
              <View style={styles.stepWrap} testID={`step-${label.toLowerCase()}-${state}`}>
                <View
                  style={[
                    styles.stepDot,
                    state === 'complete' && styles.stepComplete,
                    state === 'active' && styles.stepActive,
                  ]}
                  accessibilityLabel={`${label} stage: ${state}`}
                >
                  {state === 'complete' ? (
                    <AppIcon name="check" size={12} color="#FFFFFF" strokeWidth={3} />
                  ) : (
                    <Text
                      style={[
                        styles.stepNumber,
                        state !== 'waiting' && styles.stepNumberActive,
                      ]}
                    >
                      {index + 1}
                    </Text>
                  )}
                </View>
                <Text
                  style={[
                    styles.stepLabel,
                    state === 'active' && styles.stepLabelActive,
                  ]}
                >
                  {label}
                </Text>
              </View>
              {index < workflow.length - 1 ? (
                <View
                  style={[
                    styles.connector,
                    stepState(workflow[index + 1]) !== 'waiting' && styles.connectorActive,
                  ]}
                />
              ) : null}
            </React.Fragment>
          );
        })}
      </View>

      {loading ? (
        <ActivityIndicator
          accessibilityLabel="Loading processing history"
          color={colors.primary}
          style={styles.loader}
        />
      ) : null}

      {error ? (
        <View style={styles.errorCard}>
          <Text accessibilityRole="alert" style={styles.errorText}>
            {error}
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.retryButton}
            onPress={() => {
              refresh();
            }}
          >
            <Text style={styles.retryButtonText}>Retry processing</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {message ? (
        <View style={styles.successBanner}>
          <Text accessibilityLiveRegion="polite" style={styles.successMessage}>
            {message}
          </Text>
        </View>
      ) : null}

      {history?.openDiscrepancies ? (
        <View style={styles.blockAlert}>
          <Text style={styles.alertTitle}>Processing paused</Text>
          <Text accessibilityRole="alert" style={styles.alertText}>
            Resolve all intake discrepancies before processing.
          </Text>
        </View>
      ) : null}

      {history && !history.stages.length ? (
        <View style={styles.initialStateCard}>
          <Text style={styles.initialStateTitle}>Ready to start processing</Text>
          <Text style={styles.initialStateText}>
            Intake verification is complete. Start the first processing stage below.
          </Text>
        </View>
      ) : null}

      {/* Primary Action Button for Next Stage */}
      {history?.nextStage && !history.openDiscrepancies ? (
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.actionButton}
          disabled={busy}
          onPress={() => {
            act(
              () =>
                startFacilityStage(accessToken, orderId, history.nextStage!),
              `${labels[history.nextStage!]} started.`,
            );
          }}
        >
          {busy ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={styles.actionButtonText}>
              Start {labels[history.nextStage]}
            </Text>
          )}
        </TouchableOpacity>
      ) : null}

      {/* Stages in progress & history */}
      {history?.stages.map(stage => (
        <View key={stage.id} style={styles.stageCard}>
          <View style={styles.stageHeaderRow}>
            <Text style={styles.stageTitle}>
              Cycle {stage.rewash_cycle ?? 0} · {labels[stage.operation_type]} ·{' '}
              {stage.completed_at ? 'Completed' : 'In progress'}
            </Text>
          </View>

          <Text style={styles.stageTime}>
            Started: {formatTimestamp(stage.started_at)}
          </Text>
          {stage.completed_at ? (
            <Text style={styles.stageTime}>
              Completed: {formatTimestamp(stage.completed_at)}
            </Text>
          ) : null}

          {stage.completed_at || history.orderStatus !== 'processing' ? null : (
            <TouchableOpacity
              accessibilityRole="button"
              style={styles.completeButton}
              disabled={busy}
              onPress={() => {
                act(
                  () => completeFacilityStage(accessToken, stage.id),
                  `${labels[stage.operation_type]} completed.`,
                );
              }}
            >
              {busy ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <Text style={styles.completeButtonText}>
                  Complete {labels[stage.operation_type]}
                </Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      ))}

      {history?.qualityDecisions?.length ? (
        <Text style={styles.sectionTitle}>QC history</Text>
      ) : null}
      {history?.qualityDecisions?.map(decision => (
        <View key={decision.id} style={styles.stageCard}>
          <View style={styles.stageHeaderRow}>
            <Text style={styles.stageTitle}>
              Cycle {decision.cycle_number} ·{' '}
              {decision.approved ? 'Passed' : 'Failed — rewash required'}
            </Text>
          </View>
          <Text style={styles.stageTime}>
            Decided: {formatTimestamp(decision.created_at)}
          </Text>
          {decision.defect_code ? (
            <Text style={styles.qcDetail}>Defect: {decision.defect_code}</Text>
          ) : null}
          {decision.reason ? <Text style={styles.qcDetail}>Reason: {decision.reason}</Text> : null}
          {decision.affected_item_ids.length ? (
            <Text style={styles.qcDetail}>Affected items: {decision.affected_item_ids.length}</Text>
          ) : (
            <Text style={styles.qcDetail}>Applies to whole order</Text>
          )}
        </View>
      ))}

      {history?.canQualityCheck ? (
        <View style={styles.qcPanel}>
          <View style={styles.qcHeader}>
            <Text style={styles.heading}>Quality inspection</Text>
            <View style={styles.cycleBadge}>
              <Text style={styles.cycle}>Cycle {history.rewashCycle ?? 0}</Text>
            </View>
          </View>
          <TextInput
            accessibilityLabel="QC reason"
            value={reason}
            onChangeText={setReason}
            placeholder="Defect or inspection notes"
            placeholderTextColor={colors.textSubtle}
            multiline
            style={[styles.input, styles.qcInput]}
          />
          <Text style={styles.defectHeading}>For a failed inspection, select one defect:</Text>
          <View style={styles.defectGrid}>
            {['stain', 'damage', 'finish', 'missing', 'other'].map(code => (
              <TouchableOpacity
                key={code}
                accessibilityRole="radio"
                accessibilityLabel={code}
                accessibilityState={{ selected: defectCode === code }}
                style={[styles.radioRow, defectCode === code && styles.radioRowSelected]}
                onPress={() => setDefectCode(code)}
              >
                <View style={[styles.radioCircle, defectCode === code && styles.radioCircleSelected]}>
                  {defectCode === code ? <View style={styles.radioInner} /> : null}
                </View>
                <Text style={[styles.radioLabel, defectCode === code && styles.radioLabelSelected]}>
                  {code}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.defectHeading}>
            Choose affected items, or leave all unchecked for the whole order:
          </Text>
          {items.map(item => (
            <TouchableOpacity
              key={item.id}
              accessibilityRole="checkbox"
              accessibilityLabel={item.item_name}
              accessibilityState={{ checked: affectedItemIds.includes(item.id) }}
              style={styles.itemCheckRow}
              onPress={() =>
                setAffectedItemIds(current =>
                  current.includes(item.id)
                    ? current.filter(id => id !== item.id)
                    : [...current, item.id],
                )
              }
            >
              <View style={[styles.itemCheckBox, affectedItemIds.includes(item.id) && styles.itemCheckBoxChecked]}>
                {affectedItemIds.includes(item.id) ? (
                  <AppIcon name="check" size={10} color="#FFFFFF" strokeWidth={3} />
                ) : null}
              </View>
              <Text style={styles.itemCheckText}>
                {item.item_name}
              </Text>
            </TouchableOpacity>
          ))}

          {!packingReady ? (
            <Text style={styles.warningHint}>
              Confirm final packing before QC can make this order ready.
            </Text>
          ) : null}

          <View style={styles.qcActionGroup}>
            <TouchableOpacity
              accessibilityRole="button"
              style={[styles.passButton, (!packingReady || busy) && styles.buttonDisabled]}
              disabled={busy || !packingReady}
              onPress={() => decide(true)}
            >
              <Text style={styles.passText}>Pass QC</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              style={[
                styles.failButton,
                (busy || (history.rewashCycle ?? 0) >= 2) && styles.buttonDisabled,
              ]}
              disabled={busy || (history.rewashCycle ?? 0) >= 2}
              onPress={() => decide(false)}
            >
              <Text style={styles.failText}>Fail QC — require rewash</Text>
            </TouchableOpacity>
          </View>

          {(history.rewashCycle ?? 0) >= 2 ? (
            <Text style={styles.warningHint}>
              Rewash limit reached. Reconciliation notes are required for final approval.
            </Text>
          ) : null}
        </View>
      ) : null}

      {history?.orderStatus === 'rework_required' ? (
        <View style={styles.reworkBanner}>
          <Text style={styles.reworkText}>QC failed. Start a new washing cycle after reconciliation.</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: spacing.sm, paddingVertical: spacing.sm },
  heading: { fontSize: 17, fontWeight: '800', color: colors.textPrimary },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: colors.textPrimary, marginTop: spacing.xs },
  loader: { marginVertical: spacing.sm },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: spacing.xs,
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.sm,
  },
  stepWrap: { alignItems: 'center', width: 36, gap: 4 },
  stepDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#E4E0D8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepComplete: { backgroundColor: colors.success },
  stepActive: { backgroundColor: colors.primary },
  stepNumber: { fontWeight: '800', color: colors.textMuted, fontSize: 11 },
  stepNumberActive: { color: '#FFFFFF' },
  stepLabel: { fontSize: 10, fontWeight: '700', color: colors.textMuted },
  stepLabelActive: { color: colors.textPrimary, fontWeight: '800' },
  connector: { height: 2, flex: 1, backgroundColor: colors.border, marginBottom: 16 },
  connectorActive: { backgroundColor: colors.success },
  blockAlert: {
    backgroundColor: colors.warningSurface,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    gap: 4,
  },
  alertTitle: { fontWeight: '800', fontSize: 14, color: colors.warningText },
  alertText: { fontSize: 13, color: colors.warningText },
  initialStateCard: {
    backgroundColor: colors.infoSurface,
    borderWidth: 1,
    borderColor: colors.infoBorder,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    gap: 4,
  },
  initialStateTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.infoText,
  },
  initialStateText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  stageCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    gap: 4,
    ...shadows.sm,
  },
  stageHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  stageTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  stagePill: {
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  stagePillActive: { backgroundColor: colors.infoSurface },
  stagePillComplete: { backgroundColor: colors.successSurface },
  stagePillDanger: { backgroundColor: colors.dangerSurface },
  stagePillText: { fontSize: 11, fontWeight: '700', color: colors.textSecondary },
  stageTime: {
    fontSize: 12,
    color: colors.textMuted,
  },
  qcDetail: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  actionButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    marginVertical: spacing.xs,
    ...shadows.sm,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15,
  },
  completeButton: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    marginTop: spacing.xs,
  },
  completeButtonText: {
    color: colors.textPrimary,
    fontWeight: '800',
    fontSize: 13,
  },
  errorCard: {
    backgroundColor: colors.dangerSurface,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  errorText: {
    color: colors.dangerText,
    fontWeight: '600',
    fontSize: 13,
  },
  retryButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.danger,
    borderRadius: borderRadius.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
  successBanner: {
    backgroundColor: colors.successSurface,
    borderWidth: 1,
    borderColor: colors.successBorder,
    borderRadius: borderRadius.sm,
    padding: spacing.md,
  },
  successMessage: { color: colors.successText, fontWeight: '700', fontSize: 13 },
  qcPanel: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    gap: spacing.sm,
    marginTop: spacing.xs,
    ...shadows.sm,
  },
  qcHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cycleBadge: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cycle: { fontWeight: '700', color: colors.textSecondary, fontSize: 11 },
  input: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    fontSize: 14,
    color: colors.textPrimary,
  },
  qcInput: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  passButton: {
    backgroundColor: colors.success,
    borderRadius: borderRadius.md,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  passText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
  defectHeading: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    marginTop: 2,
  },
  defectGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSubtle,
    gap: 6,
    minHeight: 36,
  },
  radioRowSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  radioCircle: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioCircleSelected: {
    borderColor: colors.primary,
  },
  radioInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  radioLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'capitalize',
  },
  radioLabelSelected: {
    color: colors.textPrimary,
    fontWeight: '700',
  },
  itemCheckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    gap: spacing.sm,
    minHeight: 36,
  },
  itemCheckBox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  itemCheckBoxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  itemCheckText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  warningHint: {
    fontSize: 12,
    color: colors.warningText,
    fontWeight: '600',
  },
  qcActionGroup: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  failButton: {
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: borderRadius.md,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  failText: { color: colors.dangerText, fontWeight: '800', fontSize: 13 },
  buttonDisabled: { opacity: 0.5 },
  reworkBanner: {
    backgroundColor: colors.warningSurface,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.warningBorder,
  },
  reworkText: { color: colors.warningText, fontSize: 13, fontWeight: '600' },
});

