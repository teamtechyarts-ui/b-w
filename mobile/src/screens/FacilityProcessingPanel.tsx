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
import {
  ProcessingHistory,
  ProcessingStage,
  completeFacilityStage,
  getFacilityProcessing,
  recordFacilityQualityDecision,
  startFacilityStage,
} from '../services/facilityProcessingApi';

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
  packingReady = true,
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
      if (history?.qualityDecisions?.some(item => item.approved) || isPostQc) {
        return 'complete';
      }
      return history?.canQualityCheck ? 'active' : 'waiting';
    }
    if (label === 'Pack') {
      const stage = history?.stages
        .filter(item => item.operation_type === 'packaging')
        .at(-1);
      if (stage?.completed_at || packingReady || isPostQc) return 'complete';
      if (stage || history?.nextStage === 'packaging') return 'active';
      return 'waiting';
    }
    const stage = history?.stages
      .filter(item => item.operation_type === stageType[label])
      .at(-1);
    if (stage?.completed_at || isPostQc) return 'complete';
    if (stage || history?.nextStage === stageType[label]) return 'active';
    return 'waiting';
  };
  return (
    <View style={styles.panel}>
      <Text style={styles.heading}>Processing workflow</Text>
      <View style={styles.stepper}>
        {workflow.map((label, index) => {
          const state = stepState(label);
          return (
            <React.Fragment key={label}>
              <View style={styles.stepWrap}>
                <View
                  style={[
                    styles.stepDot,
                    state === 'complete' && styles.stepComplete,
                    state === 'active' && styles.stepActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.stepNumber,
                      state !== 'waiting' && styles.stepNumberActive,
                    ]}
                  >
                    {state === 'complete' ? <AppIcon name="check" size={10} color="#FFFFFF" /> : index + 1}
                  </Text>
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
                <View style={styles.connector} />
              ) : null}
            </React.Fragment>
          );
        })}
      </View>
      {loading ? (
        <ActivityIndicator accessibilityLabel="Loading processing history" />
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
      {message ? <Text accessibilityLiveRegion="polite">{message}</Text> : null}
      {history?.openDiscrepancies ? (
        <View style={styles.blockAlert}>
          <Text style={styles.alertTitle}>Processing paused</Text>
          <Text accessibilityRole="alert">
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
      {history?.stages.map(stage => (
        <View key={stage.id} style={styles.stageCard}>
          <Text style={styles.stageTitle}>
            Cycle {stage.rewash_cycle ?? 0} · {labels[stage.operation_type]} ·{' '}
            {stage.completed_at ? 'Completed' : 'In progress'}
          </Text>
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
                <ActivityIndicator color="#151515" size="small" />
              ) : (
                <Text style={styles.completeButtonText}>
                  Complete {labels[stage.operation_type]}
                </Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      ))}
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
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.actionButtonText}>
              Start {labels[history.nextStage]}
            </Text>
          )}
        </TouchableOpacity>
      ) : null}
      {history?.qualityDecisions?.length ? (
        <Text style={styles.heading}>QC history</Text>
      ) : null}
      {history?.qualityDecisions?.map(decision => (
        <View key={decision.id} style={styles.stageCard}>
          <Text style={styles.stageTitle}>
            Cycle {decision.cycle_number} ·{' '}
            {decision.approved ? 'Passed' : 'Failed — rewash required'}
          </Text>
          <Text style={styles.stageTime}>
            Decided: {formatTimestamp(decision.created_at)}
          </Text>
          {decision.defect_code ? (
            <Text>Defect: {decision.defect_code}</Text>
          ) : null}
          {decision.reason ? <Text>Reason: {decision.reason}</Text> : null}
          {decision.affected_item_ids.length ? (
            <Text>Affected items: {decision.affected_item_ids.length}</Text>
          ) : (
            <Text>Applies to whole order</Text>
          )}
        </View>
      ))}
      {history?.canQualityCheck ? (
        <View style={styles.panel}>
          <View style={styles.qcHeader}>
            <Text style={styles.heading}>Quality inspection</Text>
            <Text style={styles.cycle}>Cycle {history.rewashCycle ?? 0}</Text>
          </View>
          <TextInput
            accessibilityLabel="QC reason"
            value={reason}
            onChangeText={setReason}
            placeholder="Defect or inspection notes"
            multiline
            style={styles.input}
          />
          <Text style={styles.defectHeading}>For a failed inspection, select one defect:</Text>
          {['stain', 'damage', 'finish', 'missing', 'other'].map(code => (
            <TouchableOpacity
              key={code}
              accessibilityRole="radio"
              accessibilityLabel={code}
              accessibilityState={{ selected: defectCode === code }}
              style={styles.radioRow}
              onPress={() => setDefectCode(code)}
            >
              <View style={[styles.radioCircle, defectCode === code && styles.radioCircleSelected]}>
                {defectCode === code ? <View style={styles.radioInner} /> : null}
              </View>
              <Text style={styles.radioLabel}>{code}</Text>
            </TouchableOpacity>
          ))}
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
                {affectedItemIds.includes(item.id) ? <AppIcon name="check" size={10} color="#FFFFFF" /> : null}
              </View>
              <Text style={styles.itemCheckText}>
                {item.item_name}
              </Text>
            </TouchableOpacity>
          ))}
          {!packingReady ? (
            <Text>
              Confirm final packing before QC can make this order ready.
            </Text>
          ) : null}
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.passButton}
            disabled={busy || !packingReady}
            onPress={() => decide(true)}
          >
            <Text style={styles.passText}>Pass QC</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.failButton}
            disabled={busy || (history.rewashCycle ?? 0) >= 2}
            onPress={() => decide(false)}
          >
            <Text style={styles.failText}>Fail QC — require rewash</Text>
          </TouchableOpacity>
          {(history.rewashCycle ?? 0) >= 2 ? (
            <Text>
              Rewash limit reached. Reconciliation notes are required for final
              approval.
            </Text>
          ) : null}
        </View>
      ) : null}
      {history?.orderStatus === 'rework_required' ? (
        <Text>QC failed. Start a new washing cycle after reconciliation.</Text>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  panel: { gap: 10, paddingVertical: 14 },
  heading: { fontSize: 19, fontWeight: '900' },
  stepper: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginVertical: 8,
  },
  stepWrap: { alignItems: 'center', width: 38, gap: 5 },
  stepDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#E4E0D8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepComplete: { backgroundColor: '#176E47' },
  stepActive: { backgroundColor: '#151515' },
  stepNumber: { fontWeight: '900', color: '#777' },
  stepNumberActive: { color: '#fff' },
  stepLabel: { fontSize: 10, fontWeight: '800', color: '#777' },
  stepLabelActive: { color: '#151515' },
  connector: { height: 2, flex: 1, backgroundColor: '#D7D2C9', marginTop: 14 },
  blockAlert: {
    backgroundColor: '#FFF1CF',
    borderWidth: 1,
    borderColor: '#E6C46A',
    borderRadius: 14,
    padding: 13,
    gap: 4,
  },
  alertTitle: { fontWeight: '900' },
  initialStateCard: {
    backgroundColor: '#EEF4FF',
    borderWidth: 1,
    borderColor: '#C7D9F8',
    borderRadius: 14,
    padding: 14,
    gap: 4,
    marginVertical: 6,
  },
  initialStateTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#1E3A8A',
  },
  initialStateText: {
    fontSize: 13,
    color: '#3B5998',
  },
  stageCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E2DED6',
    borderRadius: 14,
    padding: 14,
    gap: 6,
    marginVertical: 4,
  },
  stageTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#151515',
  },
  stageTime: {
    fontSize: 12,
    color: '#67635B',
  },
  actionButton: {
    backgroundColor: '#151515',
    borderRadius: 13,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginVertical: 6,
  },
  actionButtonText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 15,
  },
  completeButton: {
    backgroundColor: '#EDEAE3',
    borderRadius: 10,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    marginTop: 6,
  },
  completeButtonText: {
    color: '#151515',
    fontWeight: '800',
    fontSize: 13,
  },
  errorCard: {
    backgroundColor: '#FDF2F2',
    borderWidth: 1,
    borderColor: '#F8B4B4',
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  errorText: {
    color: '#9A241E',
    fontWeight: '700',
    fontSize: 13,
  },
  retryButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#9A241E',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  retryButtonText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 12,
  },
  qcHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cycle: { fontWeight: '800', color: '#67635B' },
  input: {
    borderWidth: 1,
    borderColor: '#CFCAC0',
    borderRadius: 12,
    padding: 11,
    backgroundColor: '#fff',
  },
  passButton: {
    backgroundColor: '#176E47',
    borderRadius: 13,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  passText: { color: '#fff', fontWeight: '900' },
  defectHeading: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
    marginTop: 4,
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 8,
  },
  radioCircle: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#9CA3AF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioCircleSelected: {
    borderColor: '#111827',
  },
  radioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#111827',
  },
  radioLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2937',
  },
  itemCheckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 8,
  },
  itemCheckBox: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#9CA3AF',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  itemCheckBoxChecked: {
    backgroundColor: '#111827',
    borderColor: '#111827',
  },
  itemCheckText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2937',
  },
  failButton: {
    borderColor: '#B94A40',
    borderWidth: 1,
    borderRadius: 13,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  failText: { color: '#9A241E', fontWeight: '900' },
});
