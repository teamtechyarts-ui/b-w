import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {
  AdminIssueDetail,
  approveAdminRefund,
  decideAdminClaim,
  executeAdminClaimRefund,
  getAdminIssueOrder,
  rejectAdminRefund,
  requestAdminRefund,
} from '../services/adminIssuesApi';
import {deviceReachableUploadUrl} from '../services/claimsApi';
import {orderStatusLabel} from '../types/order';
import AppIcon from '../components/AppIcon';

type Props = {
  accessToken: string;
  orderId: string;
  onBack: () => void;
  onOrder: () => void;
};

const money = (value: number | string) => `₹${Number(value).toFixed(2)}`;

function formatShortDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function label(value: string) {
  return value.replace(/_/g, ' ').toUpperCase();
}

type ManualMethod = 'cash' | 'upi' | 'bank_transfer' | 'store_credit';

export default function AdminIssueDetailScreen({
  accessToken,
  orderId,
  onBack,
  onOrder,
}: Props) {
  const [detail, setDetail] = useState<AdminIssueDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [decisionError, setDecisionError] = useState('');
  const [refundError, setRefundError] = useState('');
  const [success, setSuccess] = useState('');
  const [notes, setNotes] = useState('');
  const [amount, setAmount] = useState('');
  const [viewingPhotoUrl, setViewingPhotoUrl] = useState<string | null>(null);
  const [photoErrors, setPhotoErrors] = useState<Record<string, boolean>>({});

  // Issue Refund Modal state
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundModalAmount, setRefundModalAmount] = useState('');
  const [refundModalNotes, setRefundModalNotes] = useState('');
  const [refundModalError, setRefundModalError] = useState('');
  const [refundModalBusy, setRefundModalBusy] = useState(false);
  const [manualMethod, setManualMethod] = useState<ManualMethod>('cash');

  const formatFriendlyError = (cause: any, defaultMsg: string): string => {
    const msg = cause instanceof Error ? cause.message : String(cause);
    if (
      msg.includes('schema cache') ||
      msg.includes('PGRST202') ||
      (msg.includes('function') && msg.includes('not find'))
    ) {
      return 'Claim review is temporarily unavailable. Please try again later.';
    }
    if (
      msg.includes('403') ||
      /permission|forbidden|unauthorized|admin role required/i.test(msg)
    ) {
      return 'Admin role required to perform this action.';
    }
    if (/decision notes must contain|minimum 3 characters/i.test(msg)) {
      return 'Please enter decision notes (minimum 3 characters).';
    }
    if (/invalid claim transition/i.test(msg)) {
      return 'Cannot update claim: invalid status transition.';
    }
    if (
      /Razorpay credentials are not configured|not configured for this environment/i.test(
        msg,
      )
    ) {
      return 'Payment provider is in test/development mode without live credentials.';
    }
    if (msg && !msg.includes('{') && msg.length < 140) {
      return msg;
    }
    return defaultMsg;
  };

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setLoadError('');
      try {
        setDetail(await getAdminIssueOrder(accessToken, orderId));
      } catch (cause: any) {
        const msg = cause instanceof Error ? cause.message : String(cause);
        if (
          msg.includes('403') ||
          /permission|forbidden|unauthorized/i.test(msg)
        ) {
          setLoadError("You don't have permission to view this issue.");
        } else if (msg.includes('404') || /order not found/i.test(msg)) {
          setLoadError('Order not found.');
        } else {
          setLoadError('Unable to load issue details.');
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [accessToken, orderId],
  );

  useEffect(() => {
    load();
  }, [load]);

  const primaryClaim = detail?.claims?.[0];
  const customerProfile = (detail?.order as any)?.customers?.profiles;
  const customerInfo = [customerProfile?.full_name, customerProfile?.phone]
    .filter(Boolean)
    .join(' · ');

  // Identify eligible refundable payment
  const activePayment = detail?.payments?.find(
    p =>
      ['paid', 'partially_refunded', 'authorized'].includes(p.status) &&
      p.refundableAmount > 0,
  );
  const totalRefundableAmount = (detail?.payments ?? []).reduce(
    (sum, p) => sum + Number(p.refundableAmount || 0),
    0,
  );
  const isCodOrder =
    detail?.order?.payment_method === 'cash_on_delivery' ||
    detail?.order?.payment_method === 'cod';

  const decision = async (
    claimId: string,
    status: 'under_review' | 'approved' | 'rejected' | 'resolved',
    customNotes?: string,
  ) => {
    if (busy) return;
    const finalNotes = (customNotes ?? notes).trim();
    if (!finalNotes || finalNotes.length < 3) {
      setDecisionError('Please enter decision notes (minimum 3 characters).');
      return;
    }
    setBusy(true);
    setDecisionError('');
    setRefundError('');
    setSuccess('');
    try {
      await decideAdminClaim(accessToken, orderId, claimId, status, finalNotes);
      await load(true);
      setSuccess(`Claim ${status.replace(/_/g, ' ')} successfully.`);
      setNotes('');
    } catch (cause: any) {
      const actionName =
        status === 'under_review'
          ? 'start the claim review'
          : status === 'rejected'
          ? 'reject the claim'
          : status === 'approved'
          ? 'approve the claim'
          : 'resolve the claim';
      setDecisionError(
        formatFriendlyError(cause, `Unable to ${actionName}. Please try again.`),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleRefundAction = async (
    action: () => Promise<unknown>,
    successMsg: string,
    failureMsg: string,
  ) => {
    if (busy) return;
    setBusy(true);
    setRefundError('');
    setDecisionError('');
    setSuccess('');
    try {
      await action();
      await load(true);
      setSuccess(successMsg);
      setNotes('');
      setAmount('');
    } catch (cause: any) {
      setRefundError(formatFriendlyError(cause, failureMsg));
    } finally {
      setBusy(false);
    }
  };

  const openRefundModal = () => {
    setRefundModalError('');
    const defaultAmount =
      totalRefundableAmount > 0
        ? String(totalRefundableAmount)
        : String(detail?.order.total_amount || '');
    setRefundModalAmount(defaultAmount);
    setRefundModalNotes(
      primaryClaim?.resolution_notes ||
        (notes.trim() ? notes.trim() : `Refund for claim ${primaryClaim?.id?.slice(0, 8) || ''}`),
    );
    setShowRefundModal(true);
  };

  const submitModalRefund = async () => {
    if (refundModalBusy) return;
    const parsedAmount = Number(refundModalAmount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setRefundModalError('Enter a valid positive refund amount.');
      return;
    }

    const trimmedNotes = refundModalNotes.trim();
    if (!trimmedNotes || trimmedNotes.length < 3) {
      setRefundModalError('Please enter decision notes (minimum 3 characters).');
      return;
    }

    // Cash on Delivery (COD) or No Online Capture -> Manual Reimbursement Workflow
    if (isCodOrder || !activePayment) {
      setRefundModalBusy(true);
      setRefundModalError('');
      try {
        const codResolutionNote = `[COD Manual Reimbursement - ${manualMethod.toUpperCase()}] Amount: ₹${parsedAmount.toFixed(
          2,
        )}. Notes: ${trimmedNotes}`;
        if (primaryClaim?.id && primaryClaim.status === 'approved') {
          await decideAdminClaim(
            accessToken,
            orderId,
            primaryClaim.id,
            'resolved',
            codResolutionNote,
          );
        }
        await load(true);
        setShowRefundModal(false);
        setSuccess(
          `Manual COD reimbursement of ₹${parsedAmount.toFixed(
            2,
          )} recorded and claim resolved.`,
        );
      } catch (err: any) {
        setRefundModalError(
          formatFriendlyError(
            err,
            'Unable to record manual reimbursement. Please try again.',
          ),
        );
      } finally {
        setRefundModalBusy(false);
      }
      return;
    }

    // Online Electronic Payment Workflow
    if (parsedAmount > activePayment.refundableAmount) {
      setRefundModalError(
        `Refund amount cannot exceed available ₹${activePayment.refundableAmount.toFixed(
          2,
        )}.`,
      );
      return;
    }

    setRefundModalBusy(true);
    setRefundModalError('');
    try {
      const result: any = await executeAdminClaimRefund(
        accessToken,
        orderId,
        activePayment.id,
        parsedAmount,
        trimmedNotes,
      );

      await load(true);
      setShowRefundModal(false);
      const refId = result?.providerRefundId ? ` (Ref: ${result.providerRefundId})` : '';
      setSuccess(
        `Refund of ₹${parsedAmount.toFixed(2)} issued successfully via Razorpay${refId}.`,
      );
    } catch (err: any) {
      setRefundModalError(
        formatFriendlyError(err, 'Unable to process refund. Please check details and try again.'),
      );
    } finally {
      setRefundModalBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.page}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back to Customer Issues">
          <Text style={styles.backLink}>← Customer Issues</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Claim & Issue Details</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        {loading && !detail ? (
          <ActivityIndicator
            style={styles.spinner}
            color="#1F5849"
            accessibilityLabel="Loading issue details"
          />
        ) : null}

        {/* Page / Load level error only */}
        {loadError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{loadError}</Text>
            {loadError !== "You don't have permission to view this issue." ? (
              <TouchableOpacity
                style={styles.retryBtn}
                onPress={() => load(true)}
                accessibilityRole="button">
                <Text style={styles.retryBtnText}>Try again</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {success ? (
          <View style={styles.successBox}>
            <Text style={styles.successText}>{success}</Text>
          </View>
        ) : null}

        {detail ? (
          <>
            {/* Summary Hero Card */}
            <View style={styles.heroCard}>
              <View style={styles.heroTopRow}>
                <View style={styles.flex}>
                  <Text style={styles.heroType}>
                    {primaryClaim ? label(primaryClaim.claim_type) : 'CUSTOMER ISSUE'}
                  </Text>
                  <Text style={styles.heroOrderNumber}>
                    Order {detail.order.order_number || detail.order.id}
                  </Text>
                </View>
                {primaryClaim ? (
                  <View
                    style={[
                      styles.statusBadge,
                      primaryClaim.status === 'approved'
                        ? styles.statusBadgeApproved
                        : primaryClaim.status === 'rejected'
                        ? styles.statusBadgeRejected
                        : primaryClaim.status === 'resolved'
                        ? styles.statusBadgeResolved
                        : styles.statusBadgeDefault,
                    ]}>
                    <Text
                      style={[
                        styles.statusBadgeText,
                        primaryClaim.status === 'approved'
                          ? styles.statusBadgeTextApproved
                          : primaryClaim.status === 'rejected'
                          ? styles.statusBadgeTextRejected
                          : primaryClaim.status === 'resolved'
                          ? styles.statusBadgeTextResolved
                          : styles.statusBadgeTextDefault,
                      ]}>
                      {primaryClaim.status.replace(/_/g, ' ')}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.statusBadge}>
                    <Text style={styles.statusBadgeText}>
                      {orderStatusLabel(detail.order.current_status)}
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* Claim Details Section */}
            {primaryClaim ? (
              <View style={styles.card}>
                <Text style={styles.cardSectionHeader}>ISSUE DETAILS</Text>

                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Issue</Text>
                  <Text style={styles.detailValue}>{label(primaryClaim.claim_type)}</Text>
                </View>

                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Description</Text>
                  <Text style={styles.detailValueText}>{primaryClaim.description}</Text>
                </View>

                {customerInfo ? (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Customer</Text>
                    <Text style={styles.detailValue}>{customerInfo}</Text>
                  </View>
                ) : null}

                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Submitted</Text>
                  <Text style={styles.detailValue}>
                    {formatShortDate(primaryClaim.created_at)}
                  </Text>
                </View>

                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Claim Status</Text>
                  <Text style={styles.detailValueHighlight}>
                    {primaryClaim.status.replace(/_/g, ' ')}
                  </Text>
                </View>

                {primaryClaim.resolution_notes ? (
                  <View style={styles.resolutionBox}>
                    <Text style={styles.resolutionLabel}>Resolution Notes:</Text>
                    <Text style={styles.resolutionText}>
                      {primaryClaim.resolution_notes}
                    </Text>
                  </View>
                ) : null}

                {/* Evidence Photos */}
                <Text style={styles.photoHeader}>
                  PHOTOS ({primaryClaim.customer_claim_photos?.length ?? 0})
                </Text>
                {primaryClaim.customer_claim_photos &&
                primaryClaim.customer_claim_photos.length > 0 ? (
                  <View style={styles.photosGrid}>
                    {primaryClaim.customer_claim_photos.map((photo, idx) => {
                      const photoKey = photo.id || photo.storage_path || String(idx);
                      const photoUri = photo.signedUrl
                        ? deviceReachableUploadUrl(photo.signedUrl)
                        : null;
                      const hasError = !photoUri || photoErrors[photoKey];

                      if (hasError) {
                        return (
                          <View key={photoKey} style={styles.photoUnavailableCard}>
                            <Text style={styles.photoUnavailableText}>
                              Photo unavailable
                            </Text>
                            <TouchableOpacity
                              accessibilityRole="button"
                              style={styles.retryBtn}
                              onPress={() => {
                                setPhotoErrors(prev => ({...prev, [photoKey]: false}));
                                load();
                              }}>
                              <Text style={styles.retryBtnText}>Retry</Text>
                            </TouchableOpacity>
                          </View>
                        );
                      }

                      return (
                        <View key={photoKey} style={styles.adminPhotoCard}>
                          <TouchableOpacity
                            accessibilityLabel={`View claim photo evidence ${idx + 1}`}
                            onPress={() => setViewingPhotoUrl(photoUri)}>
                            <Image
                              accessibilityLabel="Claim evidence photo"
                              source={{uri: photoUri}}
                              style={styles.photo}
                              resizeMode="cover"
                              onError={() =>
                                setPhotoErrors(prev => ({...prev, [photoKey]: true}))
                              }
                            />
                          </TouchableOpacity>
                          <Text style={styles.tapToInspectText}>Tap to inspect</Text>
                        </View>
                      );
                    })}
                  </View>
                ) : (
                  <Text style={styles.noPhotosText}>No photos attached.</Text>
                )}

                {/* Decision Notes & Actions */}
                {['submitted', 'under_review', 'approved'].includes(primaryClaim.status) ? (
                  <>
                    <Text style={styles.photoHeader}>ADMIN DECISION NOTES</Text>
                    <TextInput
                      accessibilityLabel="Admin decision notes"
                      placeholder="Enter required decision notes (min 3 chars)..."
                      placeholderTextColor="#9E9E9E"
                      multiline
                      value={notes}
                      onChangeText={setNotes}
                      style={styles.notesInput}
                    />
                  </>
                ) : null}

                {/* Lifecycle Action Buttons */}
                <View style={styles.actionRow}>
                  {primaryClaim.status === 'submitted' ? (
                    <>
                      <TouchableOpacity
                        style={[styles.actionBtnPrimary, busy && styles.btnDisabled]}
                        disabled={busy}
                        onPress={() => decision(primaryClaim.id, 'under_review')}
                        accessibilityRole="button">
                        {busy ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <Text style={styles.actionBtnPrimaryText}>Start Review</Text>
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.actionBtnDanger, busy && styles.btnDisabled]}
                        disabled={busy}
                        onPress={() => decision(primaryClaim.id, 'rejected')}
                        accessibilityRole="button">
                        <Text style={styles.actionBtnDangerText}>Reject Claim</Text>
                      </TouchableOpacity>
                    </>
                  ) : null}

                  {primaryClaim.status === 'under_review' ? (
                    <>
                      <TouchableOpacity
                        style={[styles.actionBtnPrimary, busy && styles.btnDisabled]}
                        disabled={busy}
                        onPress={() => decision(primaryClaim.id, 'approved')}
                        accessibilityRole="button">
                        {busy ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <Text style={styles.actionBtnPrimaryText}>Approve Claim</Text>
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.actionBtnDanger, busy && styles.btnDisabled]}
                        disabled={busy}
                        onPress={() => decision(primaryClaim.id, 'rejected')}
                        accessibilityRole="button">
                        <Text style={styles.actionBtnDangerText}>Reject Claim</Text>
                      </TouchableOpacity>
                    </>
                  ) : null}

                  {primaryClaim.status === 'approved' ? (
                    <>
                      <TouchableOpacity
                        style={[styles.actionBtnRefund, busy && styles.btnDisabled]}
                        disabled={busy}
                        onPress={openRefundModal}
                        accessibilityRole="button"
                        accessibilityLabel="Issue Refund">
                        <View style={{flexDirection: 'row', alignItems: 'center', gap: 6}}>
                          <AppIcon name="card" size={15} color="#991B1B" />
                          <Text style={styles.actionBtnRefundText}>Issue Refund</Text>
                        </View>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.actionBtnResolve, busy && styles.btnDisabled]}
                        disabled={busy}
                        onPress={() => decision(primaryClaim.id, 'resolved')}
                        accessibilityRole="button"
                        accessibilityLabel="Resolve Claim">
                        {busy ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <View style={{flexDirection: 'row', alignItems: 'center', gap: 6}}>
                            <AppIcon name="check" size={15} color="#FFFFFF" strokeWidth={2.5} />
                            <Text style={styles.actionBtnResolveText}>Resolve Claim</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    </>
                  ) : null}
                </View>

                {/* Action-specific decision error rendered directly below decision controls */}
                {decisionError ? (
                  <View style={styles.inlineErrorBox}>
                    <Text style={styles.inlineErrorText}>{decisionError}</Text>
                  </View>
                ) : null}
              </View>
            ) : (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>No claim has been submitted for this order.</Text>
              </View>
            )}

            {/* Order Info Card */}
            <Text style={styles.sectionHeader}>ORDER INFORMATION</Text>
            <View style={styles.card}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Order Number</Text>
                <Text style={styles.detailValue}>
                  {detail.order.order_number || detail.order.id}
                </Text>
              </View>

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Payment Method</Text>
                <Text style={styles.detailValue}>
                  {isCodOrder ? 'Cash on Delivery (COD)' : 'Razorpay Online'}
                </Text>
              </View>

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Order Status</Text>
                <Text style={styles.detailValue}>
                  {orderStatusLabel(detail.order.current_status)}
                </Text>
              </View>

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Total Amount</Text>
                <Text style={styles.detailValue}>{money(detail.order.total_amount)}</Text>
              </View>

              <TouchableOpacity
                style={styles.viewOrderBtn}
                onPress={onOrder}
                accessibilityRole="button">
                <Text style={styles.viewOrderBtnText}>
                  View Order Details & Controls →
                </Text>
              </TouchableOpacity>
            </View>

            {/* Payments & Refunds Section */}
            <Text style={styles.sectionHeader}>PAYMENTS & REFUNDS</Text>
            {detail.payments.length > 0 ? (
              <>
                {detail.payments.map(payment => (
                  <View key={payment.id} style={styles.card}>
                    <View style={styles.cardHeaderRow}>
                      <Text style={styles.paymentProvider}>
                        {label(payment.provider)} PAYMENT
                      </Text>
                      <View style={styles.statusBadge}>
                        <Text style={styles.statusBadgeText}>{payment.status}</Text>
                      </View>
                    </View>
                    <Text style={styles.paymentAmount}>
                      Total Captured: {money(payment.amount)}
                    </Text>
                    <Text style={styles.refundableText}>
                      Available to refund: {money(payment.refundableAmount)}
                    </Text>

                    {payment.refund_requests.length > 0 ? (
                      payment.refund_requests.map(refund => (
                        <View key={refund.id} style={styles.refundSubCard}>
                          <View style={styles.cardHeaderRow}>
                            <Text style={styles.refundAmount}>
                              Refund {money(refund.amount)}
                            </Text>
                            <View
                              style={[
                                styles.statusBadge,
                                refund.status === 'completed' ||
                                refund.status === 'processed'
                                  ? styles.statusBadgeSuccess
                                  : refund.status === 'rejected' ||
                                    refund.status === 'failed'
                                  ? styles.statusBadgeDanger
                                  : styles.statusBadgeInfo,
                              ]}>
                              <Text style={styles.statusBadgeText}>
                                {refund.status.replace(/_/g, ' ')}
                              </Text>
                            </View>
                          </View>
                          <Text style={styles.refundReason}>
                            Reason: {refund.reason}
                          </Text>
                          {refund.decision_notes ? (
                            <Text style={styles.refundNotesText}>
                              Notes: {refund.decision_notes}
                            </Text>
                          ) : null}
                          <Text style={styles.cardMeta}>
                            Created: {formatDateTime(refund.created_at)}
                          </Text>

                          {['requested', 'under_review'].includes(refund.status) ? (
                            <View style={styles.actionRow}>
                              <TouchableOpacity
                                style={[
                                  styles.actionBtnPrimary,
                                  busy && styles.btnDisabled,
                                ]}
                                disabled={busy}
                                onPress={() =>
                                  handleRefundAction(
                                    () =>
                                      approveAdminRefund(
                                        accessToken,
                                        orderId,
                                        refund.id,
                                        notes.trim() || 'Approved by Admin',
                                      ),
                                    'Refund approved and processed through provider.',
                                    'Unable to approve refund. Please try again.',
                                  )
                                }
                                accessibilityRole="button">
                                <Text style={styles.actionBtnPrimaryText}>
                                  Approve & Process Refund
                                </Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[
                                  styles.actionBtnDanger,
                                  busy && styles.btnDisabled,
                                ]}
                                disabled={busy}
                                onPress={() =>
                                  handleRefundAction(
                                    () =>
                                      rejectAdminRefund(
                                        accessToken,
                                        orderId,
                                        refund.id,
                                        notes.trim() || 'Declined by Admin',
                                      ),
                                    'Refund request rejected.',
                                    'Unable to reject refund. Please try again.',
                                  )
                                }
                                accessibilityRole="button">
                                <Text style={styles.actionBtnDangerText}>
                                  Reject Refund
                                </Text>
                              </TouchableOpacity>
                            </View>
                          ) : null}

                          {refund.status === 'failed' ? (
                            <View style={styles.actionRow}>
                              <TouchableOpacity
                                style={[
                                  styles.actionBtnPrimary,
                                  busy && styles.btnDisabled,
                                ]}
                                disabled={busy}
                                onPress={() =>
                                  handleRefundAction(
                                    () =>
                                      approveAdminRefund(
                                        accessToken,
                                        orderId,
                                        refund.id,
                                        notes.trim() || 'Retry by Admin',
                                      ),
                                    'Refund retry submitted to provider.',
                                    'Unable to retry refund. Please check payment provider status.',
                                  )
                                }
                                accessibilityRole="button">
                                <Text style={styles.actionBtnPrimaryText}>
                                  Retry Provider Refund
                                </Text>
                              </TouchableOpacity>
                            </View>
                          ) : null}
                        </View>
                      ))
                    ) : (
                      <Text style={styles.emptySubText}>
                        No refund requests created for this payment.
                      </Text>
                    )}

                    {payment.refundableAmount > 0 ? (
                      <View style={styles.directRefundBox}>
                        <Text style={styles.photoHeader}>Issue Direct Refund</Text>
                        <TextInput
                          accessibilityLabel={`Refund amount for ${payment.id}`}
                          placeholder="Refund amount in ₹"
                          placeholderTextColor="#9E9E9E"
                          keyboardType="decimal-pad"
                          value={amount}
                          onChangeText={setAmount}
                          style={styles.amountInput}
                        />
                        <TouchableOpacity
                          style={[styles.actionBtnPrimary, busy && styles.btnDisabled]}
                          disabled={busy}
                          onPress={() => {
                            const parsedAmount = Number(amount);
                            if (!parsedAmount || parsedAmount <= 0) {
                              setRefundError('Enter a valid positive refund amount.');
                              return;
                            }
                            if (parsedAmount > payment.refundableAmount) {
                              setRefundError(
                                `Refund amount cannot exceed available ₹${payment.refundableAmount.toFixed(
                                  2,
                                )}.`,
                              );
                              return;
                            }
                            if (!notes.trim() || notes.trim().length < 3) {
                              setRefundError(
                                'Please enter decision notes in the field above (min 3 characters).',
                              );
                              return;
                            }
                            handleRefundAction(
                              () =>
                                requestAdminRefund(
                                  accessToken,
                                  orderId,
                                  payment.id,
                                  parsedAmount,
                                  notes,
                                ),
                              'Refund request created.',
                              'Unable to submit refund request. Please try again.',
                            );
                          }}
                          accessibilityRole="button">
                          <Text style={styles.actionBtnPrimaryText}>
                            Create Refund Request
                          </Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}

                    {/* Action-specific refund error */}
                    {refundError ? (
                      <View style={styles.inlineErrorBox}>
                        <Text style={styles.inlineErrorText}>{refundError}</Text>
                      </View>
                    ) : null}
                  </View>
                ))}
              </>
            ) : (
              <View style={styles.card}>
                <Text style={styles.emptyText}>
                  {isCodOrder
                    ? 'This order was placed with Cash on Delivery (COD). No online payment was captured through Razorpay. Use the Manual Reimbursement workflow to record offline customer reimbursements.'
                    : 'No payment records found for this order.'}
                </Text>
              </View>
            )}

            {/* Cancellation History */}
            {detail.cancellationHistory.length > 0 ? (
              <>
                <Text style={styles.sectionHeader}>CANCELLATION HISTORY</Text>
                <View style={styles.card}>
                  {detail.cancellationHistory.map(item => (
                    <View key={item.id} style={styles.auditRow}>
                      <Text style={styles.auditDate}>
                        {formatDateTime(item.created_at)}
                      </Text>
                      <Text style={styles.auditText}>
                        {item.reason || 'No reason recorded'}
                      </Text>
                    </View>
                  ))}
                </View>
              </>
            ) : null}

            {/* Admin Audit Decisions */}
            {detail.audit.length > 0 ? (
              <>
                <Text style={styles.sectionHeader}>ADMIN DECISION AUDIT</Text>
                <View style={styles.card}>
                  {detail.audit.map(item => (
                    <View key={item.id} style={styles.auditRow}>
                      <View style={styles.cardHeaderRow}>
                        <Text style={styles.auditAction}>
                          {item.action.replace(/_/g, ' ')}
                        </Text>
                        <Text style={styles.auditDate}>
                          {formatDateTime(item.created_at)}
                        </Text>
                      </View>
                      <Text style={styles.auditNotes}>{item.notes}</Text>
                    </View>
                  ))}
                </View>
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      {/* Issue Refund Modal */}
      {showRefundModal ? (
        <Modal
          visible={showRefundModal}
          transparent
          animationType="slide"
          onRequestClose={() => setShowRefundModal(false)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalDialogCard}>
              <View style={styles.modalDialogHeader}>
                <Text style={styles.modalDialogTitle}>
                  {isCodOrder || !activePayment
                    ? 'Record Manual Reimbursement'
                    : 'Issue Online Refund'}
                </Text>
                <TouchableOpacity
                  onPress={() => setShowRefundModal(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Close refund modal"
                  style={styles.modalCloseBtnSmall}>
                  <AppIcon name="close" size={14} color="#64748B" />
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.modalDialogBody} showsVerticalScrollIndicator={false}>
                {/* Summary Info */}
                <View style={styles.modalSummaryBox}>
                  <Text style={styles.modalSummaryText}>
                    Order: <Text style={styles.bold}>{detail?.order.order_number || orderId}</Text>
                  </Text>
                  {primaryClaim ? (
                    <Text style={styles.modalSummaryText}>
                      Claim: <Text style={styles.bold}>{label(primaryClaim.claim_type)}</Text>
                    </Text>
                  ) : null}
                  <Text style={styles.modalSummaryText}>
                    Order Total: <Text style={styles.bold}>{money(detail?.order.total_amount || 0)}</Text>
                  </Text>
                  <Text style={styles.modalSummaryText}>
                    Payment: <Text style={styles.bold}>{isCodOrder ? 'Cash on Delivery (COD)' : 'Razorpay Online'}</Text>
                  </Text>
                  {activePayment ? (
                    <Text style={styles.modalSummaryHighlight}>
                      Available to refund: {money(activePayment.refundableAmount)}
                    </Text>
                  ) : null}
                </View>

                {isCodOrder || !activePayment ? (
                  <View style={styles.codNoticeBox}>
                    <Text style={styles.codNoticeTitle}>Cash on Delivery Notice</Text>
                    <Text style={styles.codNoticeText}>
                      No online payment was collected electronically. Select the offline reimbursement
                      method and provide a decision note to record this reimbursement in the audit trail.
                    </Text>
                    <Text style={styles.inputFieldLabel}>Reimbursement Method:</Text>
                    <View style={styles.methodSelectorRow}>
                      {(['cash', 'upi', 'bank_transfer', 'store_credit'] as ManualMethod[]).map(
                        m => (
                          <TouchableOpacity
                            key={m}
                            style={[
                              styles.methodBtn,
                              manualMethod === m && styles.methodBtnActive,
                            ]}
                            onPress={() => setManualMethod(m)}
                            accessibilityRole="button"
                            accessibilityLabel={`Select ${m} method`}>
                            <Text
                              style={[
                                styles.methodBtnText,
                                manualMethod === m && styles.methodBtnTextActive,
                              ]}>
                              {m.replace(/_/g, ' ').toUpperCase()}
                            </Text>
                          </TouchableOpacity>
                        ),
                      )}
                    </View>
                  </View>
                ) : null}

                {/* Refund Amount Input */}
                <Text style={styles.inputFieldLabel}>Refund Amount (₹):</Text>
                <TextInput
                  accessibilityLabel="Refund amount input"
                  placeholder="Enter amount in ₹"
                  placeholderTextColor="#9E9E9E"
                  keyboardType="decimal-pad"
                  value={refundModalAmount}
                  onChangeText={setRefundModalAmount}
                  style={styles.modalInput}
                />

                {/* Decision Notes Input */}
                <Text style={styles.inputFieldLabel}>Decision & Authorization Notes:</Text>
                <TextInput
                  accessibilityLabel="Refund decision notes"
                  placeholder="Enter mandatory reason for refund (min 3 chars)..."
                  placeholderTextColor="#9E9E9E"
                  multiline
                  numberOfLines={3}
                  value={refundModalNotes}
                  onChangeText={setRefundModalNotes}
                  style={styles.modalNotesInput}
                />

                {/* Modal Error */}
                {refundModalError ? (
                  <View style={styles.inlineErrorBox}>
                    <Text style={styles.inlineErrorText}>{refundModalError}</Text>
                  </View>
                ) : null}
              </ScrollView>

              <View style={styles.modalDialogFooter}>
                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  disabled={refundModalBusy}
                  onPress={() => setShowRefundModal(false)}
                  accessibilityRole="button">
                  <Text style={styles.modalCancelBtnText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.modalSubmitBtn, refundModalBusy && styles.btnDisabled]}
                  disabled={refundModalBusy}
                  onPress={submitModalRefund}
                  accessibilityRole="button">
                  {refundModalBusy ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.modalSubmitBtnText}>
                      {isCodOrder || !activePayment
                        ? 'Confirm Manual Reimbursement'
                        : 'Confirm & Issue Refund'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}

      {/* Full screen photo preview modal */}
      {viewingPhotoUrl ? (
        <Modal
          visible={Boolean(viewingPhotoUrl)}
          transparent
          animationType="fade"
          onRequestClose={() => setViewingPhotoUrl(null)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalHeader}>
              <TouchableOpacity
                accessibilityRole="button"
                style={styles.modalCloseBtn}
                onPress={() => setViewingPhotoUrl(null)}>
                <Text style={styles.modalCloseBtnText}>Close</Text>
              </TouchableOpacity>
            </View>
            <Image
              source={{uri: viewingPhotoUrl}}
              style={styles.modalImage}
              resizeMode="contain"
            />
          </View>
        </Modal>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#F8F9FA'},
  flex: {flex: 1},
  bold: {fontWeight: '700', color: '#1B1B18'},
  header: {
    height: 56,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#EBEBEB',
  },
  backLink: {fontSize: 14, fontWeight: '700', color: '#1F5849', minWidth: 60},
  headerTitle: {fontSize: 17, fontWeight: '800', color: '#1B1B18'},
  headerSpacer: {width: 60},
  content: {padding: 16, paddingBottom: 36},
  spinner: {marginVertical: 20},
  errorBox: {
    backgroundColor: '#FDF2F2',
    borderColor: '#F8D7DA',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  errorText: {fontSize: 13, color: '#9A241E', lineHeight: 18, marginBottom: 8},
  retryBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#1F5849',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
  },
  retryBtnText: {fontSize: 12, fontWeight: '700', color: '#FFFFFF'},
  successBox: {
    backgroundColor: '#EAF6EC',
    borderColor: '#C3E6CB',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  successText: {fontSize: 13, color: '#155724', fontWeight: '600'},
  heroCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2DED6',
    padding: 16,
    marginBottom: 16,
  },
  heroTopRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  heroType: {fontSize: 12, fontWeight: '800', color: '#656159', letterSpacing: 0.5, marginBottom: 4},
  heroOrderNumber: {fontSize: 18, fontWeight: '900', color: '#1B1B18'},
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2DED6',
    padding: 16,
    marginBottom: 16,
  },
  cardSectionHeader: {fontSize: 12, fontWeight: '800', color: '#656159', letterSpacing: 0.5, marginBottom: 12},
  sectionHeader: {fontSize: 12, fontWeight: '800', color: '#656159', letterSpacing: 0.5, marginTop: 4, marginBottom: 10},
  detailRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10},
  detailLabel: {fontSize: 13, color: '#656159', fontWeight: '500', width: '35%'},
  detailValue: {fontSize: 13, color: '#1B1B18', fontWeight: '700', width: '65%', textAlign: 'right'},
  detailValueText: {fontSize: 13, color: '#1B1B18', width: '65%', textAlign: 'right', lineHeight: 18},
  detailValueHighlight: {fontSize: 13, fontWeight: '800', color: '#1F5849', width: '65%', textAlign: 'right', textTransform: 'capitalize'},
  resolutionBox: {
    backgroundColor: '#F8F9FA',
    borderLeftWidth: 3,
    borderLeftColor: '#1F5849',
    padding: 10,
    borderRadius: 6,
    marginVertical: 10,
  },
  resolutionLabel: {fontSize: 11, fontWeight: '700', color: '#656159', marginBottom: 2},
  resolutionText: {fontSize: 13, color: '#1B1B18', lineHeight: 18},
  photoHeader: {fontSize: 12, fontWeight: '800', color: '#656159', letterSpacing: 0.5, marginTop: 12, marginBottom: 8},
  photosGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 10},
  adminPhotoCard: {width: 100, alignItems: 'center'},
  photo: {width: 100, height: 100, borderRadius: 8, backgroundColor: '#EBEBEB'},
  tapToInspectText: {fontSize: 10, color: '#656159', marginTop: 4, fontWeight: '600'},
  photoUnavailableCard: {
    width: 100,
    height: 100,
    borderRadius: 8,
    backgroundColor: '#F5F5F5',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 6,
  },
  photoUnavailableText: {fontSize: 10, color: '#757575', textAlign: 'center', marginBottom: 6},
  noPhotosText: {fontSize: 13, color: '#8A857C', fontStyle: 'italic', marginBottom: 8},
  notesInput: {
    borderWidth: 1,
    borderColor: '#D4CEBF',
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
    color: '#1B1B18',
    backgroundColor: '#FFFFFF',
    minHeight: 70,
    textAlignVertical: 'top',
    marginBottom: 12,
  },
  actionRow: {flexDirection: 'row', gap: 10, marginTop: 6, flexWrap: 'wrap'},
  actionBtnPrimary: {
    flex: 1,
    minHeight: 44,
    backgroundColor: '#1F5849',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  actionBtnPrimaryText: {color: '#FFFFFF', fontSize: 13, fontWeight: '700'},
  actionBtnDanger: {
    flex: 1,
    minHeight: 44,
    backgroundColor: '#FFF1F0',
    borderColor: '#FFA39E',
    borderWidth: 1,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  actionBtnDangerText: {color: '#CF1322', fontSize: 13, fontWeight: '700'},
  actionBtnRefund: {
    flex: 1,
    minHeight: 44,
    backgroundColor: '#B7791F',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  actionBtnRefundText: {color: '#FFFFFF', fontSize: 13, fontWeight: '800'},
  actionBtnResolve: {
    flex: 1,
    minHeight: 44,
    backgroundColor: '#1F5849',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  actionBtnResolveText: {color: '#FFFFFF', fontSize: 13, fontWeight: '700'},
  btnDisabled: {opacity: 0.6},
  inlineErrorBox: {
    marginTop: 10,
    padding: 10,
    backgroundColor: '#FDF2F2',
    borderRadius: 8,
  },
  inlineErrorText: {color: '#9A241E', fontSize: 12, fontWeight: '600'},
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EBEBEB',
    borderStyle: 'dashed',
    padding: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyText: {fontSize: 13, color: '#8A857C', lineHeight: 18, textAlign: 'center'},
  viewOrderBtn: {marginTop: 6, paddingVertical: 8},
  viewOrderBtnText: {fontSize: 13, fontWeight: '700', color: '#1F5849'},
  cardHeaderRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8},
  paymentProvider: {fontSize: 13, fontWeight: '800', color: '#1B1B18'},
  paymentAmount: {fontSize: 15, fontWeight: '800', color: '#1B1B18', marginBottom: 2},
  refundableText: {fontSize: 12, fontWeight: '700', color: '#1F5849', marginBottom: 12},
  refundSubCard: {
    backgroundColor: '#F9F8F6',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#EAE6DD',
    padding: 12,
    marginBottom: 10,
  },
  refundAmount: {fontSize: 14, fontWeight: '800', color: '#1B1B18'},
  refundStatus: {fontSize: 11, fontWeight: '700', color: '#1F5849', textTransform: 'capitalize'},
  refundReason: {fontSize: 12, color: '#4A463F', marginTop: 4, marginBottom: 4},
  refundNotesText: {fontSize: 11, color: '#656159', fontStyle: 'italic', marginBottom: 4},
  cardMeta: {fontSize: 11, color: '#7A756D'},
  emptySubText: {fontSize: 12, color: '#8A857C', fontStyle: 'italic', marginVertical: 6},
  directRefundBox: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F0EEEA',
  },
  amountInput: {
    borderWidth: 1,
    borderColor: '#D4CEBF',
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    color: '#1B1B18',
    backgroundColor: '#FFFFFF',
    marginBottom: 10,
  },
  auditRow: {paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F0EEEA'},
  auditDate: {fontSize: 11, color: '#8A857C'},
  auditAction: {fontSize: 12, fontWeight: '800', color: '#1B1B18'},
  auditText: {fontSize: 12, color: '#4A463F', marginTop: 2},
  auditNotes: {fontSize: 12, color: '#1B1B18', marginTop: 2, fontStyle: 'italic'},
  statusBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
  },
  statusBadgeDefault: {backgroundColor: '#F3EFE6', borderColor: '#E2D8C6'},
  statusBadgeApproved: {backgroundColor: '#FEF3C7', borderColor: '#FDE68A'},
  statusBadgeRejected: {backgroundColor: '#FEE2E2', borderColor: '#FECACA'},
  statusBadgeResolved: {backgroundColor: '#DCFCE7', borderColor: '#BBF7D0'},
  statusBadgeSuccess: {backgroundColor: '#DCFCE7', borderColor: '#BBF7D0'},
  statusBadgeDanger: {backgroundColor: '#FEE2E2', borderColor: '#FECACA'},
  statusBadgeInfo: {backgroundColor: '#E0F2FE', borderColor: '#BAE6FD'},
  statusBadgeText: {fontSize: 11, fontWeight: '700', textTransform: 'capitalize'},
  statusBadgeTextDefault: {color: '#1F5849'},
  statusBadgeTextApproved: {color: '#92400E'},
  statusBadgeTextRejected: {color: '#991B1B'},
  statusBadgeTextResolved: {color: '#166534'},
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalHeader: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 10,
  },
  modalCloseBtn: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  modalCloseBtnText: {color: '#1B1B18', fontWeight: '700', fontSize: 13},
  modalImage: {width: '100%', height: '80%'},
  modalDialogCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    width: '100%',
    maxHeight: '90%',
    padding: 18,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 8,
  },
  modalDialogHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#EBEBEB',
  },
  modalDialogTitle: {fontSize: 16, fontWeight: '800', color: '#1B1B18'},
  modalCloseBtnSmall: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#F3EFE6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCloseBtnTextSmall: {fontSize: 14, fontWeight: '800', color: '#656159'},
  modalDialogBody: {maxHeight: 400},
  modalSummaryBox: {
    backgroundColor: '#F9F8F6',
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#EAE6DD',
  },
  modalSummaryText: {fontSize: 12, color: '#4A463F', marginBottom: 4},
  modalSummaryHighlight: {fontSize: 13, fontWeight: '800', color: '#1F5849', marginTop: 4},
  codNoticeBox: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FDE68A',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  codNoticeTitle: {fontSize: 12, fontWeight: '800', color: '#92400E', marginBottom: 4},
  codNoticeText: {fontSize: 12, color: '#78350F', lineHeight: 16, marginBottom: 8},
  inputFieldLabel: {fontSize: 12, fontWeight: '700', color: '#4A463F', marginBottom: 6},
  methodSelectorRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8},
  methodBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#D4CEBF',
    backgroundColor: '#FFFFFF',
  },
  methodBtnActive: {backgroundColor: '#1F5849', borderColor: '#1F5849'},
  methodBtnText: {fontSize: 10, fontWeight: '700', color: '#4A463F'},
  methodBtnTextActive: {color: '#FFFFFF'},
  modalInput: {
    borderWidth: 1,
    borderColor: '#D4CEBF',
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    color: '#1B1B18',
    backgroundColor: '#FFFFFF',
    marginBottom: 14,
  },
  modalNotesInput: {
    borderWidth: 1,
    borderColor: '#D4CEBF',
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
    color: '#1B1B18',
    backgroundColor: '#FFFFFF',
    minHeight: 70,
    textAlignVertical: 'top',
    marginBottom: 14,
  },
  modalDialogFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#EBEBEB',
  },
  modalCancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D4CEBF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCancelBtnText: {fontSize: 13, fontWeight: '700', color: '#656159'},
  modalSubmitBtn: {
    backgroundColor: '#1F5849',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 140,
  },
  modalSubmitBtnText: {fontSize: 13, fontWeight: '800', color: '#FFFFFF'},
});
