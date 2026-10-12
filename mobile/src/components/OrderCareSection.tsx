import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type {CustomerOrder} from '../types/order';
import {cancelOrder, canCancelOrder} from '../services/ordersApi';
import {
  canRaiseClaim,
  chooseClaimPhoto,
  CLAIM_TYPES,
  createClaim,
  deviceReachableUploadUrl,
  getOrderClaims,
  uploadClaimPhoto,
  type ClaimPhoto,
  type ClaimType,
  type CustomerClaim,
  type CustomerClaimPhotoRecord,
} from '../services/claimsApi';
import {getPaymentSummary, requestRefund, type PaymentSummary} from '../services/paymentsApi';

type Props = {
  accessToken: string;
  order: CustomerOrder;
  refreshKey: number;
  onActionComplete: () => Promise<void>;
};

function message(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function label(value: string) {
  return value.replace(/_/g, ' ').replace(/^./, letter => letter.toUpperCase());
}

function claimStatusLabel(status: string) {
  switch (status) {
    case 'submitted':
      return 'Submitted';
    case 'under_review':
      return 'Under review';
    case 'approved':
      return 'Approved';
    case 'rejected':
      return 'Rejected';
    case 'resolved':
      return 'Resolved';
    default:
      return label(status);
  }
}

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

export default function OrderCareSection({accessToken, order, refreshKey, onActionComplete}: Props) {
  const [claims, setClaims] = useState<CustomerClaim[]>([]);
  const [payment, setPayment] = useState<PaymentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Cancellation
  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  // New claim
  const [showClaim, setShowClaim] = useState(false);
  const [claimType, setClaimType] = useState<ClaimType>('damage');
  const [description, setDescription] = useState('');
  const [showNewClaimAddPhotos, setShowNewClaimAddPhotos] = useState(false);
  const [newClaimPendingPhotos, setNewClaimPendingPhotos] = useState<ClaimPhoto[]>([]);
  const [newClaimPhotoError, setNewClaimPhotoError] = useState<string | null>(null);

  // Existing claims photo staging
  const [showAddPhotosForClaim, setShowAddPhotosForClaim] = useState<string | null>(null);
  const [existingClaimPendingPhotos, setExistingClaimPendingPhotos] = useState<Record<string, ClaimPhoto[]>>({});
  const [existingClaimPhotoError, setExistingClaimPhotoError] = useState<Record<string, string | null>>({});

  // Refund
  const [showRefund, setShowRefund] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');

  // Photo viewer & errors
  const [viewingPhotoUrl, setViewingPhotoUrl] = useState<string | null>(null);
  const [photoErrors, setPhotoErrors] = useState<Record<string, boolean>>({});

  const postDelivery =
    Boolean(order.delivered_at) ||
    ['delivered', 'claim_period_active', 'completed'].includes(order.current_status);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [claimResult, paymentResult] = await Promise.allSettled([
      postDelivery ? getOrderClaims(accessToken, order.id) : Promise.resolve([]),
      getPaymentSummary(accessToken, order.id),
    ]);
    const failures: string[] = [];
    if (claimResult.status === 'fulfilled') {
      setClaims(claimResult.value);
    } else {
      failures.push(`Claims: ${message(claimResult.reason)}`);
    }
    if (paymentResult.status === 'fulfilled') {
      setPayment(paymentResult.value);
    }
    setLoadError(failures.length ? failures.join('\n') : null);
    setLoading(false);
  }, [accessToken, order.id, postDelivery]);

  useEffect(() => {
    reload();
  }, [reload, refreshKey]);

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setActionError(null);
    setSuccess(null);
    try {
      await action();
      setSuccess(done);
      await onActionComplete();
      await reload();
    } catch (error) {
      setActionError(message(error));
    } finally {
      setBusy(false);
    }
  };

  const submitCancel = () =>
    run(async () => {
      await cancelOrder(accessToken, order.id, cancelReason);
      setShowCancel(false);
      setCancelReason('');
    }, 'Order cancelled.');

  // Photo picker for new claim (staged locally)
  const pickPhotoForNewClaim = async (source: 'library' | 'camera') => {
    setNewClaimPhotoError(null);
    try {
      const selected = await chooseClaimPhoto(source);
      if (!selected) return; // User cancelled
      setNewClaimPendingPhotos(prev => [...prev, selected]);
    } catch (err: any) {
      const raw = message(err);
      const friendly = raw.includes('Failed to fetch') ? 'Photo selection failed. Please try again.' : raw;
      setNewClaimPhotoError(friendly);
    }
  };

  const removePendingPhotoForNewClaim = (index: number) => {
    setNewClaimPendingPhotos(prev => prev.filter((_, idx) => idx !== index));
  };

  // Submit new claim
  const submitNewClaim = async () => {
    setBusy(true);
    setActionError(null);
    setSuccess(null);
    setNewClaimPhotoError(null);

    let createdClaim: CustomerClaim | null = null;
    try {
      createdClaim = await createClaim(accessToken, order.id, claimType, description);
    } catch (error) {
      setBusy(false);
      setActionError(message(error));
      return;
    }

    const pending = [...newClaimPendingPhotos];
    const failedPhotos: ClaimPhoto[] = [];
    let uploadedCount = 0;
    let lastUploadError = '';

    if (createdClaim && pending.length > 0) {
      setUploadingPhoto(true);
      for (const p of pending) {
        try {
          await uploadClaimPhoto(accessToken, createdClaim.id, p);
          uploadedCount++;
        } catch (uploadErr) {
          lastUploadError = message(uploadErr);
          failedPhotos.push(p);
        }
      }
      setUploadingPhoto(false);
    }

    setShowClaim(false);
    setDescription('');
    setNewClaimPendingPhotos([]);
    setShowNewClaimAddPhotos(false);
    setBusy(false);

    if (failedPhotos.length > 0) {
      setActionError(
        `Claim submitted, but ${failedPhotos.length} photo(s) could not be attached: ${lastUploadError}. You can retry adding photos to your submitted claim.`,
      );
    } else {
      setSuccess(uploadedCount > 0 ? 'Claim submitted with photos.' : 'Claim submitted.');
    }

    await onActionComplete();
    await reload();
  };

  // Photo picker for existing claim (staged locally)
  const pickPhotoForClaim = async (claimId: string, source: 'library' | 'camera') => {
    setExistingClaimPhotoError(prev => ({...prev, [claimId]: null}));
    try {
      const selected = await chooseClaimPhoto(source);
      if (!selected) return; // User cancelled
      setExistingClaimPendingPhotos(prev => ({
        ...prev,
        [claimId]: [...(prev[claimId] || []), selected],
      }));
    } catch (err: any) {
      const raw = message(err);
      const friendly = raw.includes('Failed to fetch') ? 'Photo selection failed. Please try again.' : raw;
      setExistingClaimPhotoError(prev => ({...prev, [claimId]: friendly}));
    }
  };

  const removePendingPhotoForClaim = (claimId: string, index: number) => {
    setExistingClaimPendingPhotos(prev => ({
      ...prev,
      [claimId]: (prev[claimId] || []).filter((_, idx) => idx !== index),
    }));
  };

  const cancelPendingPhotosForClaim = (claimId: string) => {
    setExistingClaimPendingPhotos(prev => ({...prev, [claimId]: []}));
    setShowAddPhotosForClaim(null);
    setExistingClaimPhotoError(prev => ({...prev, [claimId]: null}));
  };

  // Explicit submit photos action for existing claim
  const submitPendingPhotosForClaim = async (claimId: string) => {
    const pending = existingClaimPendingPhotos[claimId] || [];
    if (pending.length === 0) return;

    setUploadingPhoto(true);
    setBusy(true);
    setExistingClaimPhotoError(prev => ({...prev, [claimId]: null}));
    setSuccess(null);
    setActionError(null);

    const remaining: ClaimPhoto[] = [];
    let successCount = 0;
    let lastError = '';

    for (const p of pending) {
      try {
        await uploadClaimPhoto(accessToken, claimId, p);
        successCount++;
      } catch (err: any) {
        lastError = message(err);
        remaining.push(p);
      }
    }

    setExistingClaimPendingPhotos(prev => ({
      ...prev,
      [claimId]: remaining,
    }));

    if (remaining.length === 0) {
      setShowAddPhotosForClaim(null);
      setSuccess(successCount === 1 ? 'Photo added to claim.' : `${successCount} photos added to claim.`);
    } else {
      const msg = lastError.includes('Failed to fetch') ? 'Photo upload failed. Please try again.' : lastError;
      setExistingClaimPhotoError(prev => ({
        ...prev,
        [claimId]:
          successCount > 0
            ? `${successCount} photo(s) uploaded, but ${remaining.length} photo(s) failed: ${msg}`
            : `Photo upload failed: ${msg}`,
      }));
    }

    await onActionComplete();
    await reload();
    setUploadingPhoto(false);
    setBusy(false);
  };

  const submitRefund = () =>
    run(async () => {
      if (!payment?.payment) throw new Error('Payment is unavailable.');
      await requestRefund(accessToken, payment.payment.paymentOrderId, Number(refundAmount), refundReason);
      setShowRefund(false);
      setRefundAmount('');
      setRefundReason('');
    }, 'Refund request submitted.');

  const claimWindow = canRaiseClaim(order.current_status, order.claim_deadline_at);
  const mayRefund = payment?.refundEligibility?.eligible === true;
  const hasExistingClaim = claims.length > 0;

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>ORDER HELP</Text>
      {success ? (
        <Text accessibilityRole="alert" style={styles.success}>
          {success}
        </Text>
      ) : null}
      {actionError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {actionError}
        </Text>
      ) : null}

      {/* Cancellation option if supported */}
      {canCancelOrder(order.current_status) ? (
        <View style={styles.card}>
          <Text style={styles.title}>Cancel Order</Text>
          {!showCancel ? (
            <TouchableOpacity accessibilityRole="button" onPress={() => setShowCancel(true)}>
              <Text style={styles.link}>Cancel Order</Text>
            </TouchableOpacity>
          ) : (
            <>
              <TextInput
                accessibilityLabel="Cancellation reason"
                placeholder="Reason for cancellation"
                placeholderTextColor="#9E9E9E"
                value={cancelReason}
                onChangeText={setCancelReason}
                multiline
                style={styles.input}
              />
              <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={submitCancel}>
                <Text style={styles.link}>Confirm cancellation</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      ) : null}

      {/* Post Delivery Claims Section */}
      {postDelivery ? (
        <View style={styles.card}>
          <Text style={styles.title}>
            {hasExistingClaim ? 'Claim Submitted' : 'Claims & Support'}
          </Text>

          {loading ? <Text style={styles.info}>Loading claim status...</Text> : null}

          {/* If existing claim is present */}
          {hasExistingClaim
            ? claims.map(claim => {
                const photos: CustomerClaimPhotoRecord[] = claim.customer_claim_photos ?? [];
                const pendingForThisClaim = existingClaimPendingPhotos[claim.id] || [];
                const isAddingPhotos = showAddPhotosForClaim === claim.id || pendingForThisClaim.length > 0;
                const canAddMorePhotos = ['submitted', 'under_review'].includes(claim.status);
                const claimError = existingClaimPhotoError[claim.id];

                return (
                  <View key={claim.id} style={styles.claimBlock}>
                    <View style={styles.claimHeaderRow}>
                      <Text style={styles.claimType}>{label(claim.claim_type)}</Text>
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{claimStatusLabel(claim.status)}</Text>
                      </View>
                    </View>

                    <Text style={styles.claimDesc}>{claim.description}</Text>

                    <Text style={styles.info}>
                      Submitted · {formatShortDate(claim.created_at)}
                    </Text>

                    {/* Previously Uploaded Claim Photos Grid */}
                    <View style={styles.claimPhotosSection}>
                      <View style={styles.photoHeaderRow}>
                        <Text style={styles.photoSectionTitle}>SUBMITTED EVIDENCE</Text>
                        <Text style={styles.photoCountBadge}>
                          Photos: {photos.length}
                        </Text>
                      </View>

                      {photos.length > 0 ? (
                        <View style={styles.thumbnailsGrid}>
                          {photos.map((p, idx) => {
                            const photoKey = p.id || p.storage_path || String(idx);
                            const rawUrl = p.signedUrl || null;
                            const uri = rawUrl ? deviceReachableUploadUrl(rawUrl) : null;
                            const hasError = !uri || photoErrors[photoKey];

                            if (hasError) {
                              return (
                                <View key={photoKey} style={styles.photoUnavailableCard}>
                                  <Text style={styles.photoUnavailableText}>Photo unavailable</Text>
                                  <TouchableOpacity
                                    accessibilityRole="button"
                                    style={styles.retryBtn}
                                    onPress={() => {
                                      setPhotoErrors(prev => ({...prev, [photoKey]: false}));
                                      reload();
                                    }}>
                                    <Text style={styles.retryBtnText}>Retry</Text>
                                  </TouchableOpacity>
                                </View>
                              );
                            }

                            return (
                              <View key={photoKey} style={styles.thumbnailCard}>
                                <TouchableOpacity
                                  accessibilityRole="button"
                                  accessibilityLabel={`View claim photo evidence ${idx + 1}`}
                                  style={styles.thumbnailWrapper}
                                  onPress={() => setViewingPhotoUrl(uri)}>
                                  <Image
                                    source={{uri}}
                                    style={styles.thumbnailImage}
                                    resizeMode="cover"
                                    onError={() => setPhotoErrors(prev => ({...prev, [photoKey]: true}))}
                                  />
                                </TouchableOpacity>
                                <Text style={styles.tapToViewText}>Tap to view</Text>
                              </View>
                            );
                          })}
                        </View>
                      ) : (
                        <Text style={styles.noPhotosText}>No photos were attached with this claim.</Text>
                      )}

                      {/* Optional Evidence Addition Area */}
                      {canAddMorePhotos ? (
                        <View style={styles.evidenceUploadContainer}>
                          {!isAddingPhotos ? (
                            <View style={styles.optionalPhotoPrompt}>
                              <Text style={styles.photoSectionSubtitle}>
                                Add photos of the issue to support your claim.
                              </Text>
                              <TouchableOpacity
                                accessibilityRole="button"
                                style={styles.addPhotosSecondaryBtn}
                                onPress={() => {
                                  setShowAddPhotosForClaim(claim.id);
                                  setExistingClaimPhotoError(prev => ({...prev, [claim.id]: null}));
                                }}>
                                <Text style={styles.addPhotosSecondaryBtnText}>Add photos (optional)</Text>
                              </TouchableOpacity>
                            </View>
                          ) : pendingForThisClaim.length === 0 ? (
                            /* Selection view before choosing */
                            <View style={styles.pickerChooserBox}>
                              <Text style={styles.photoSectionSubtitle}>
                                Choose a photo source to add evidence:
                              </Text>
                              <View style={styles.claimActionRow}>
                                <TouchableOpacity
                                  accessibilityRole="button"
                                  disabled={busy || uploadingPhoto}
                                  style={styles.actionBtn}
                                  onPress={() => pickPhotoForClaim(claim.id, 'camera')}>
                                  <Text style={styles.actionBtnText}>Take photo</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  accessibilityRole="button"
                                  disabled={busy || uploadingPhoto}
                                  style={styles.actionBtnSecondary}
                                  onPress={() => pickPhotoForClaim(claim.id, 'library')}>
                                  <Text style={styles.actionBtnTextSecondary}>Choose from phone</Text>
                                </TouchableOpacity>
                              </View>
                              <TouchableOpacity
                                accessibilityRole="button"
                                style={styles.cancelLinkBtn}
                                onPress={() => setShowAddPhotosForClaim(null)}>
                                <Text style={styles.cancelLinkText}>Cancel</Text>
                              </TouchableOpacity>
                            </View>
                          ) : (
                            /* Staged Pending Photos Preview & Submit */
                            <View style={styles.stagedPhotosBox}>
                              <Text style={styles.pendingPhotosHeader}>
                                Pending photos: {pendingForThisClaim.length}
                              </Text>
                              <View style={styles.thumbnailsGrid}>
                                {pendingForThisClaim.map((p, idx) => (
                                  <View key={`${p.name}-${idx}`} style={styles.thumbnailCard}>
                                    <TouchableOpacity
                                      accessibilityRole="button"
                                      accessibilityLabel={`Preview pending photo ${idx + 1}`}
                                      style={styles.thumbnailWrapper}
                                      onPress={() => setViewingPhotoUrl(p.uri)}>
                                      <Image source={{uri: p.uri}} style={styles.thumbnailImage} resizeMode="cover" />
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                      accessibilityRole="button"
                                      accessibilityLabel={`Remove pending photo ${idx + 1}`}
                                      style={styles.removePendingBtn}
                                      onPress={() => removePendingPhotoForClaim(claim.id, idx)}>
                                      <Text style={styles.removePendingText}>Remove</Text>
                                    </TouchableOpacity>
                                  </View>
                                ))}
                              </View>

                              <View style={styles.pendingBtnRow}>
                                <TouchableOpacity
                                  accessibilityRole="button"
                                  disabled={busy || uploadingPhoto}
                                  style={styles.addAnotherBtn}
                                  onPress={() => pickPhotoForClaim(claim.id, 'library')}>
                                  <Text style={styles.addAnotherBtnText}>+ Add another photo</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  accessibilityRole="button"
                                  disabled={busy || uploadingPhoto}
                                  style={styles.cancelPendingBtn}
                                  onPress={() => cancelPendingPhotosForClaim(claim.id)}>
                                  <Text style={styles.cancelPendingBtnText}>Cancel</Text>
                                </TouchableOpacity>
                              </View>

                              <TouchableOpacity
                                accessibilityRole="button"
                                disabled={busy || uploadingPhoto || pendingForThisClaim.length === 0}
                                style={[
                                  styles.submitPhotosBtn,
                                  (busy || uploadingPhoto || pendingForThisClaim.length === 0) && styles.btnDisabled,
                                ]}
                                onPress={() => submitPendingPhotosForClaim(claim.id)}>
                                {uploadingPhoto ? (
                                  <View style={styles.uploadingRow}>
                                    <ActivityIndicator size="small" color="#FFFFFF" />
                                    <Text style={styles.submitPhotosBtnText}>Submitting photos...</Text>
                                  </View>
                                ) : (
                                  <Text style={styles.submitPhotosBtnText}>Submit photos</Text>
                                )}
                              </TouchableOpacity>
                            </View>
                          )}

                          {claimError ? (
                            <View style={styles.inlineErrorBox}>
                              <Text style={styles.inlineErrorText}>{claimError}</Text>
                              {pendingForThisClaim.length > 0 ? (
                                <TouchableOpacity
                                  accessibilityRole="button"
                                  onPress={() => submitPendingPhotosForClaim(claim.id)}>
                                  <Text style={styles.retryActionText}>Retry submit</Text>
                                </TouchableOpacity>
                              ) : null}
                            </View>
                          ) : null}
                        </View>
                      ) : (
                        <Text style={styles.claimLockedText}>
                          Additional photos cannot be added for this claim ({claimStatusLabel(claim.status).toLowerCase()}).
                        </Text>
                      )}
                    </View>
                  </View>
                );
              })
            : null}

          {/* Only show Raise a Claim if NO existing claim is active and window is valid */}
          {!hasExistingClaim && !loading ? (
            claimWindow ? (
              !showClaim ? (
                <View style={styles.noClaimPrompt}>
                  <Text style={styles.info}>Need help with this order?</Text>
                  <TouchableOpacity
                    accessibilityRole="button"
                    style={styles.raiseClaimBtn}
                    onPress={() => setShowClaim(true)}>
                    <Text style={styles.raiseClaimBtnText}>Raise a claim</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <Text style={styles.info}>Claim reason</Text>
                  <View style={styles.choices}>
                    {CLAIM_TYPES.map(option => (
                      <TouchableOpacity
                        key={option.value}
                        accessibilityRole="button"
                        accessibilityState={{selected: claimType === option.value}}
                        onPress={() => setClaimType(option.value)}
                        style={[styles.choice, claimType === option.value && styles.chosen]}>
                        <Text
                          style={[
                            styles.choiceText,
                            claimType === option.value && styles.chosenText,
                          ]}>
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TextInput
                    accessibilityLabel="Claim description"
                    placeholder="Describe the issue in detail (10-4000 characters)..."
                    placeholderTextColor="#9E9E9E"
                    value={description}
                    onChangeText={setDescription}
                    multiline
                    style={styles.input}
                  />

                  {/* New Claim Photos (Optional) */}
                  <View style={styles.newClaimPhotoSection}>
                    <View style={styles.photoHeaderRow}>
                      <Text style={styles.photoSectionTitle}>CLAIM PHOTOS (OPTIONAL)</Text>
                      {newClaimPendingPhotos.length > 0 ? (
                        <Text style={styles.photoCountBadge}>
                          Pending: {newClaimPendingPhotos.length}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={styles.photoSectionSubtitle}>
                      Add photos of the issue to support your claim.
                    </Text>

                    {!showNewClaimAddPhotos && newClaimPendingPhotos.length === 0 ? (
                      <TouchableOpacity
                        accessibilityRole="button"
                        style={styles.addPhotosSecondaryBtn}
                        onPress={() => setShowNewClaimAddPhotos(true)}>
                        <Text style={styles.addPhotosSecondaryBtnText}>Add photos (optional)</Text>
                      </TouchableOpacity>
                    ) : newClaimPendingPhotos.length === 0 ? (
                      <View style={styles.pickerChooserBox}>
                        <View style={styles.claimActionRow}>
                          <TouchableOpacity
                            accessibilityRole="button"
                            disabled={busy}
                            style={styles.actionBtn}
                            onPress={() => pickPhotoForNewClaim('camera')}>
                            <Text style={styles.actionBtnText}>Take photo</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            accessibilityRole="button"
                            disabled={busy}
                            style={styles.actionBtnSecondary}
                            onPress={() => pickPhotoForNewClaim('library')}>
                            <Text style={styles.actionBtnTextSecondary}>Choose from phone</Text>
                          </TouchableOpacity>
                        </View>
                        <TouchableOpacity
                          accessibilityRole="button"
                          style={styles.cancelLinkBtn}
                          onPress={() => setShowNewClaimAddPhotos(false)}>
                          <Text style={styles.cancelLinkText}>Cancel</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <View style={styles.stagedPhotosBox}>
                        <Text style={styles.pendingPhotosHeader}>
                          Pending photos: {newClaimPendingPhotos.length}
                        </Text>
                        <View style={styles.thumbnailsGrid}>
                          {newClaimPendingPhotos.map((p, idx) => (
                            <View key={`${p.name}-${idx}`} style={styles.thumbnailCard}>
                              <TouchableOpacity
                                accessibilityRole="button"
                                accessibilityLabel={`Preview pending photo ${idx + 1}`}
                                style={styles.thumbnailWrapper}
                                onPress={() => setViewingPhotoUrl(p.uri)}>
                                <Image source={{uri: p.uri}} style={styles.thumbnailImage} resizeMode="cover" />
                              </TouchableOpacity>
                              <TouchableOpacity
                                accessibilityRole="button"
                                accessibilityLabel={`Remove pending photo ${idx + 1}`}
                                style={styles.removePendingBtn}
                                onPress={() => removePendingPhotoForNewClaim(idx)}>
                                <Text style={styles.removePendingText}>Remove</Text>
                              </TouchableOpacity>
                            </View>
                          ))}
                        </View>

                        <View style={styles.pendingBtnRow}>
                          <TouchableOpacity
                            accessibilityRole="button"
                            disabled={busy}
                            style={styles.addAnotherBtn}
                            onPress={() => pickPhotoForNewClaim('library')}>
                            <Text style={styles.addAnotherBtnText}>+ Add another photo</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            accessibilityRole="button"
                            disabled={busy}
                            style={styles.cancelPendingBtn}
                            onPress={() => {
                              setNewClaimPendingPhotos([]);
                              setShowNewClaimAddPhotos(false);
                            }}>
                            <Text style={styles.cancelPendingBtnText}>Cancel</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}

                    {newClaimPhotoError ? (
                      <View style={styles.inlineErrorBox}>
                        <Text style={styles.inlineErrorText}>{newClaimPhotoError}</Text>
                      </View>
                    ) : null}
                  </View>

                  <TouchableOpacity
                    accessibilityRole="button"
                    style={[styles.raiseClaimBtn, busy && styles.btnDisabled]}
                    disabled={busy}
                    onPress={submitNewClaim}>
                    {busy ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={styles.raiseClaimBtnText}>Submit Claim</Text>
                    )}
                  </TouchableOpacity>
                </>
              )
            ) : (
              <Text style={styles.info}>Claims are no longer available for this order.</Text>
            )
          ) : null}
        </View>
      ) : null}

      {/* Payment / Refund Section */}
      <View style={styles.card}>
        <Text style={styles.title}>Payment</Text>
        {loading ? <Text style={styles.info}>Loading payment status...</Text> : null}
        {!loading && !payment?.payment ? (
          <Text style={styles.info}>Cash on Delivery or payment not recorded.</Text>
        ) : null}
        {payment?.payment ? (
          <Text style={styles.value}>Payment: {label(payment.payment.status)}</Text>
        ) : null}
        {payment && payment.refunds.length === 0 && mayRefund ? (
          <Text style={styles.info}>No refund requests.</Text>
        ) : null}
        {payment?.refunds.map(refund => (
          <View key={refund.refundRequestId} style={styles.row}>
            <Text style={styles.value}>
              Refund: {label(refund.status)} · ₹{refund.amount.toFixed(2)}
            </Text>
            <Text style={styles.info}>{refund.reason}</Text>
          </View>
        ))}
        {mayRefund ? (
          !showRefund ? (
            <TouchableOpacity accessibilityRole="button" onPress={() => setShowRefund(true)}>
              <Text style={styles.link}>Request Refund</Text>
            </TouchableOpacity>
          ) : (
            <>
              <TextInput
                accessibilityLabel="Refund amount"
                placeholder="Amount in rupees"
                placeholderTextColor="#9E9E9E"
                keyboardType="decimal-pad"
                value={refundAmount}
                onChangeText={setRefundAmount}
                style={styles.input}
              />
              <TextInput
                accessibilityLabel="Refund reason"
                placeholder="Reason for refund"
                placeholderTextColor="#9E9E9E"
                value={refundReason}
                onChangeText={setRefundReason}
                multiline
                style={styles.input}
              />
              <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={submitRefund}>
                <Text style={styles.link}>Submit Refund Request</Text>
              </TouchableOpacity>
            </>
          )
        ) : null}
      </View>

      {loadError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {loadError}
        </Text>
      ) : null}
      {loadError ? (
        <TouchableOpacity accessibilityRole="button" onPress={() => reload()}>
          <Text style={styles.link}>Retry order help</Text>
        </TouchableOpacity>
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
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {marginBottom: 16},
  heading: {fontSize: 12, fontWeight: '800', letterSpacing: 0.6, color: '#656159', marginBottom: 8, marginTop: 6},
  card: {
    borderWidth: 1,
    borderColor: '#E2DED6',
    borderRadius: 14,
    padding: 16,
    backgroundColor: '#FFFFFF',
    marginBottom: 14,
  },
  title: {fontSize: 14, fontWeight: '800', color: '#1B1B18', marginBottom: 8},
  claimBlock: {paddingVertical: 6},
  claimHeaderRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4},
  claimType: {fontSize: 14, fontWeight: '800', color: '#1B1B18'},
  claimDesc: {fontSize: 13, color: '#4A463F', lineHeight: 18, marginTop: 4, marginBottom: 6},
  badge: {
    backgroundColor: '#F3EFE6',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#E2D8C6',
  },
  badgeText: {fontSize: 11, fontWeight: '700', color: '#1F5849'},
  claimPhotosSection: {
    backgroundColor: '#FAF8F5',
    borderWidth: 1,
    borderColor: '#E8E3DA',
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
  },
  newClaimPhotoSection: {
    backgroundColor: '#FAF8F5',
    borderWidth: 1,
    borderColor: '#E8E3DA',
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
    marginBottom: 4,
  },
  photoHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  photoSectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: '#3A3834',
  },
  photoCountBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1F5849',
    backgroundColor: '#E6EFEA',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  photoSectionSubtitle: {
    fontSize: 12,
    color: '#656159',
    marginBottom: 10,
  },
  noPhotosText: {
    fontSize: 12,
    color: '#8A857C',
    fontStyle: 'italic',
    marginBottom: 8,
  },
  claimLockedText: {
    fontSize: 12,
    color: '#7A756D',
    marginTop: 6,
    fontStyle: 'italic',
  },
  thumbnailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
  },
  thumbnailCard: {
    alignItems: 'center',
  },
  tapToViewText: {
    fontSize: 10,
    color: '#656159',
    marginTop: 4,
    fontWeight: '500',
  },
  photoUnavailableCard: {
    width: 80,
    minHeight: 72,
    padding: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#DCD7CE',
    backgroundColor: '#F5F2EC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoUnavailableText: {
    fontSize: 10,
    color: '#656159',
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 4,
  },
  retryBtn: {
    backgroundColor: '#1F5849',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  retryBtnText: {
    fontSize: 10,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  thumbnailWrapper: {
    width: 76,
    height: 76,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#DCD7CE',
    backgroundColor: '#EAE6DF',
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  evidenceUploadContainer: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#E8E3DA',
    paddingTop: 10,
  },
  optionalPhotoPrompt: {
    gap: 8,
  },
  addPhotosSecondaryBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#1F5849',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
  },
  addPhotosSecondaryBtnText: {
    color: '#1F5849',
    fontSize: 12,
    fontWeight: '700',
  },
  pickerChooserBox: {
    gap: 8,
  },
  claimActionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    backgroundColor: '#1F5849',
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  actionBtnSecondary: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#1F5849',
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnTextSecondary: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1F5849',
  },
  cancelLinkBtn: {
    alignSelf: 'center',
    paddingVertical: 4,
  },
  cancelLinkText: {
    fontSize: 12,
    color: '#656159',
    fontWeight: '600',
  },
  stagedPhotosBox: {
    gap: 8,
  },
  pendingPhotosHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1F5849',
    marginBottom: 4,
  },
  removePendingBtn: {
    marginTop: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  removePendingText: {
    fontSize: 11,
    color: '#9A241E',
    fontWeight: '700',
  },
  pendingBtnRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    marginBottom: 6,
  },
  addAnotherBtn: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DCD7CE',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  addAnotherBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1F5849',
  },
  cancelPendingBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  cancelPendingBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#656159',
  },
  submitPhotosBtn: {
    backgroundColor: '#1F5849',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
  },
  submitPhotosBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  uploadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  noClaimPrompt: {gap: 8, marginTop: 4},
  raiseClaimBtn: {
    backgroundColor: '#1F5849',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginTop: 8,
    minHeight: 40,
    justifyContent: 'center',
  },
  raiseClaimBtnText: {color: '#FFFFFF', fontSize: 13, fontWeight: '700'},
  row: {borderTopWidth: 1, borderTopColor: '#EEEEEE', paddingTop: 10, marginTop: 10},
  info: {fontSize: 12, color: '#656159', marginTop: 4, lineHeight: 17},
  value: {fontSize: 13, fontWeight: '700', color: '#1B1B18'},
  link: {fontSize: 13, fontWeight: '700', color: '#1F5849', marginTop: 10},
  input: {
    borderWidth: 1,
    borderColor: '#DCD7CE',
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
    fontSize: 13,
    minHeight: 42,
    backgroundColor: '#FBFBFA',
  },
  choices: {flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 8},
  choice: {borderWidth: 1, borderColor: '#DCD7CE', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6},
  chosen: {backgroundColor: '#1F5849', borderColor: '#1F5849'},
  choiceText: {fontSize: 12, fontWeight: '600', color: '#1B1B18'},
  chosenText: {color: '#FFFFFF'},
  error: {color: '#9A241E', fontSize: 12, marginBottom: 8, fontWeight: '600'},
  success: {color: '#1F5849', fontSize: 12, marginBottom: 8, fontWeight: '700'},
  inlineErrorBox: {
    marginTop: 8,
    padding: 8,
    backgroundColor: '#FDF2F2',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#F8D7DA',
    gap: 4,
  },
  inlineErrorText: {
    color: '#9A241E',
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 15,
  },
  retryActionText: {
    color: '#1F5849',
    fontSize: 11,
    fontWeight: '700',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalHeader: {
    position: 'absolute',
    top: 40,
    right: 20,
    zIndex: 10,
  },
  modalCloseBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  modalCloseBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  modalImage: {
    width: '100%',
    height: '80%',
  },
});
