import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  AdminGrowthOffer,
  AdminGrowthOverview,
  createAdminOffer,
  getAdminGrowth,
  OfferInput,
  setAdminOfferActive,
  updateAdminOffer,
} from '../services/adminGrowthApi';

type Props = {
  accessToken: string;
  onBack: () => void;
};

type OfferFormData = {
  couponCode: string;
  name: string;
  discountType: 'fixed' | 'percentage';
  discountValue: string;
  minimumOrderAmount: string;
  maximumDiscount: string;
  startsAt: string;
  expiresAt: string;
  usageLimit: string;
  eligibilityNote: string;
};

const defaultOfferForm: OfferFormData = {
  couponCode: '',
  name: '',
  discountType: 'fixed',
  discountValue: '',
  minimumOrderAmount: '0',
  maximumDiscount: '',
  startsAt: '',
  expiresAt: '',
  usageLimit: '',
  eligibilityNote: '',
};

const formatMoney = (value: number | string) => `₹${Number(value || 0).toFixed(2)}`;

const formatDate = (isoString: string | null | undefined) => {
  if (!isoString) return 'No expiration';
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return isoString;
    return d.toLocaleDateString('en-IN', {day: 'numeric', month: 'short', year: 'numeric'});
  } catch {
    return isoString;
  }
};

export default function AdminGrowthScreen({accessToken, onBack}: Props) {
  const [data, setData] = useState<AdminGrowthOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Offer Modal State
  const [modalVisible, setModalVisible] = useState(false);
  const [editingOfferId, setEditingOfferId] = useState<string | null>(null);
  const [form, setForm] = useState<OfferFormData>(defaultOfferForm);
  const [formError, setFormError] = useState('');

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError('');
    try {
      const next = await getAdminGrowth(accessToken);
      setData(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Growth programs unavailable.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [accessToken]);

  useEffect(() => {
    load();
  }, [load]);

  const handleOpenCreate = () => {
    setEditingOfferId(null);
    setForm(defaultOfferForm);
    setFormError('');
    setModalVisible(true);
  };

  const handleOpenEdit = (offer: AdminGrowthOffer) => {
    setEditingOfferId(offer.id);
    setForm({
      couponCode: offer.coupon_code || '',
      name: offer.name || '',
      discountType: offer.discount_type || 'fixed',
      discountValue: String(offer.discount_value ?? ''),
      minimumOrderAmount: String(offer.minimum_order_amount ?? '0'),
      maximumDiscount: offer.maximum_discount != null ? String(offer.maximum_discount) : '',
      startsAt: offer.starts_at || '',
      expiresAt: offer.expires_at || '',
      usageLimit: offer.usage_limit != null ? String(offer.usage_limit) : '',
      eligibilityNote: offer.eligibility_note || '',
    });
    setFormError('');
    setModalVisible(true);
  };

  const handleToggleActive = async (offer: AdminGrowthOffer) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const nextState = !offer.is_active;
      await setAdminOfferActive(accessToken, offer.id, nextState);
      await load(true);
      setSuccess(`Offer "${offer.coupon_code}" is now ${nextState ? 'ACTIVE' : 'INACTIVE'}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update offer status.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveOffer = async () => {
    setFormError('');
    const couponCode = form.couponCode.trim().toUpperCase();
    const name = form.name.trim();
    const discountValue = Number(form.discountValue);
    const minimumOrderAmount = Number(form.minimumOrderAmount || '0');
    const maximumDiscount = form.maximumDiscount.trim() ? Number(form.maximumDiscount) : null;
    const usageLimit = form.usageLimit.trim() ? Number(form.usageLimit) : null;
    const startsAt = form.startsAt.trim() ? new Date(form.startsAt.trim()).toISOString() : null;
    const expiresAt = form.expiresAt.trim() ? new Date(form.expiresAt.trim()).toISOString() : null;
    const eligibilityNote = form.eligibilityNote.trim();

    if (!couponCode || !/^[A-Z0-9-]{1,64}$/.test(couponCode)) {
      setFormError('Coupon code must contain 1-64 uppercase letters, numbers, or dashes.');
      return;
    }
    if (name.length < 2 || name.length > 120) {
      setFormError('Offer name must be between 2 and 120 characters.');
      return;
    }
    if (!Number.isFinite(discountValue) || discountValue <= 0) {
      setFormError('Discount value must be a positive number.');
      return;
    }
    if (form.discountType === 'percentage' && discountValue > 100) {
      setFormError('Percentage discount cannot exceed 100%.');
      return;
    }
    if (!Number.isFinite(minimumOrderAmount) || minimumOrderAmount < 0) {
      setFormError('Minimum order amount must be 0 or greater.');
      return;
    }
    if (maximumDiscount !== null && (!Number.isFinite(maximumDiscount) || maximumDiscount < 0)) {
      setFormError('Maximum discount must be 0 or greater.');
      return;
    }
    if (usageLimit !== null && (!Number.isSafeInteger(usageLimit) || usageLimit < 1)) {
      setFormError('Usage limit must be a positive integer.');
      return;
    }
    if (startsAt && expiresAt && new Date(expiresAt) <= new Date(startsAt)) {
      setFormError('Expiration date must be after start date.');
      return;
    }

    const payload: OfferInput = {
      couponCode,
      name,
      discountType: form.discountType,
      discountValue,
      minimumOrderAmount,
      maximumDiscount,
      startsAt,
      expiresAt,
      usageLimit,
      eligibilityNote,
    };

    setBusy(true);
    try {
      if (editingOfferId) {
        await updateAdminOffer(accessToken, editingOfferId, payload);
        setSuccess(`Offer "${couponCode}" updated successfully.`);
      } else {
        await createAdminOffer(accessToken, payload);
        setSuccess(`Offer "${couponCode}" created successfully.`);
      }
      setModalVisible(false);
      await load(true);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Failed to save offer.');
    } finally {
      setBusy(false);
    }
  };

  const offers = data?.offers || [];
  const activeOffersCount = offers.filter(o => o.is_active).length;
  const totalRedemptionsCount = data?.redemptions?.length || offers.reduce((sum, o) => sum + (o.redeemedCount || 0), 0);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />
        }>
        {/* Navigation & Header */}
        <View style={styles.header}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Admin dashboard"
            style={styles.backButton}
            onPress={onBack}>
            <Text style={styles.backButtonText}>← Admin dashboard</Text>
          </TouchableOpacity>

          <View style={styles.headerTitleRow}>
            <View style={styles.flex}>
              <Text style={styles.eyebrow}>GROWTH</Text>
              <Text style={styles.title}>Growth Programs</Text>
              <Text style={styles.subtitle}>
                Manage customer coupons and promotional offers.
              </Text>
            </View>

            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Refresh"
              style={styles.refreshButton}
              onPress={() => load(true)}>
              <Text style={styles.refreshButtonText}>Refresh</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Global Notifications */}
        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{error}</Text>
            <TouchableOpacity onPress={() => load(false)}>
              <Text style={styles.retryLinkText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {success ? (
          <View style={styles.successBanner}>
            <Text style={styles.successBannerText}>{success}</Text>
          </View>
        ) : null}

        {loading && !refreshing ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#111" />
            <Text style={styles.loadingText}>Loading offers...</Text>
          </View>
        ) : (
          <>
            {/* SUMMARY CARDS */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>SUMMARY</Text>
            </View>

            <View style={styles.summaryGrid}>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryNumber}>{activeOffersCount}</Text>
                <Text style={styles.summaryLabel}>Active Offers</Text>
              </View>

              <View style={styles.summaryCard}>
                <Text style={styles.summaryNumber}>{totalRedemptionsCount}</Text>
                <Text style={styles.summaryLabel}>Redemptions</Text>
              </View>
            </View>

            {/* COUPONS & OFFERS SECTION */}
            <View style={styles.couponsHeaderRow}>
              <Text style={styles.sectionTitle}>COUPONS & OFFERS</Text>

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Create Offer"
                style={styles.createButton}
                onPress={handleOpenCreate}>
                <Text style={styles.createButtonText}>+ Create Offer</Text>
              </TouchableOpacity>
            </View>

            {offers.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>No offers yet</Text>
                <Text style={styles.emptySubtitle}>
                  Create promotional coupons with fixed or percentage discounts.
                </Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  style={styles.emptyAction}
                  onPress={handleOpenCreate}>
                  <Text style={styles.emptyActionText}>+ Create First Offer</Text>
                </TouchableOpacity>
              </View>
            ) : (
              offers.map(offer => {
                const isPercentage = offer.discount_type === 'percentage';
                const discountText = isPercentage
                  ? `${Number(offer.discount_value)}% OFF`
                  : `₹${Number(offer.discount_value).toFixed(2)} OFF`;
                const maxDiscountText =
                  offer.maximum_discount != null
                    ? ` (Up to ₹${Number(offer.maximum_discount).toFixed(2)})`
                    : '';
                const minOrderText =
                  Number(offer.minimum_order_amount || 0) > 0
                    ? `Minimum order ₹${Number(offer.minimum_order_amount).toFixed(2)}`
                    : 'No minimum order';
                const usageText =
                  offer.usage_limit != null
                    ? `Used ${offer.redeemedCount || 0} / ${offer.usage_limit}`
                    : `Used ${offer.redeemedCount || 0} (Unlimited)`;

                return (
                  <View key={offer.id} style={styles.offerCard}>
                    {/* Top Row: Code and Status */}
                    <View style={styles.offerCardTop}>
                      <Text style={styles.offerCode}>{offer.coupon_code || offer.name}</Text>
                      <View
                        style={[
                          styles.statusBadge,
                          offer.is_active ? styles.statusBadgeActive : styles.statusBadgeInactive,
                        ]}>
                        <Text
                          style={[
                            styles.statusBadgeText,
                            offer.is_active ? styles.statusTextActive : styles.statusTextInactive,
                          ]}>
                          {offer.is_active ? 'ACTIVE' : 'INACTIVE'}
                        </Text>
                      </View>
                    </View>

                    {/* Offer Name */}
                    <Text style={styles.offerName}>{offer.name}</Text>

                    {/* Discount & Order Rules */}
                    <View style={styles.offerDetails}>
                      <Text style={styles.offerDiscount}>
                        {discountText}
                        {maxDiscountText}
                      </Text>
                      <Text style={styles.offerMetaText}>{minOrderText}</Text>
                    </View>

                    {/* Usage & Expiration */}
                    <View style={styles.offerMetaRow}>
                      <Text style={styles.offerMetaText}>{usageText}</Text>
                      <Text style={styles.offerMetaText}>
                        Expires {formatDate(offer.expires_at)}
                      </Text>
                    </View>

                    {/* Eligibility Note if configured */}
                    {offer.eligibility_note ? (
                      <View style={styles.eligibilityBox}>
                        <Text style={styles.eligibilityText}>
                          ℹ️ {offer.eligibility_note}
                        </Text>
                      </View>
                    ) : null}

                    {/* Action Buttons */}
                    <View style={styles.cardActionRow}>
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={`Edit ${offer.coupon_code}`}
                        style={styles.editButton}
                        onPress={() => handleOpenEdit(offer)}>
                        <Text style={styles.editButtonText}>Edit</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={offer.is_active ? 'Deactivate' : 'Activate'}
                        disabled={busy}
                        style={[
                          styles.toggleButton,
                          offer.is_active ? styles.deactivateButton : styles.activateButton,
                        ]}
                        onPress={() => handleToggleActive(offer)}>
                        <Text
                          style={[
                            styles.toggleButtonText,
                            offer.is_active ? styles.deactivateText : styles.activateText,
                          ]}>
                          {offer.is_active ? 'Deactivate' : 'Activate'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })
            )}
          </>
        )}
      </ScrollView>

      {/* CREATE / EDIT OFFER MODAL */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setModalVisible(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}>
          <SafeAreaView style={styles.modalContentWrapper}>
            <View style={styles.modalCard}>
              {/* Modal Header */}
              <View style={styles.modalHeader}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Close form"
                  style={styles.modalCloseButton}
                  onPress={() => setModalVisible(false)}>
                  <Text style={styles.modalBackText}>←</Text>
                </TouchableOpacity>
                <Text style={styles.modalTitle}>
                  {editingOfferId ? 'Edit Offer' : 'Create Offer'}
                </Text>
                <View style={styles.modalSpacer} />
              </View>

              <ScrollView
                style={styles.modalScroll}
                contentContainerStyle={styles.modalScrollContent}
                keyboardShouldPersistTaps="handled">
                {formError ? (
                  <View style={styles.formErrorBanner}>
                    <Text style={styles.formErrorText}>{formError}</Text>
                  </View>
                ) : null}

                {/* Section: Basic Details */}
                <Text style={styles.formSectionHeader}>Basic details</Text>

                <Text style={styles.inputLabel}>Coupon code *</Text>
                <TextInput
                  accessibilityLabel="Coupon code"
                  placeholder="e.g. FIRSTUSER"
                  placeholderTextColor="#999"
                  value={form.couponCode}
                  onChangeText={val => setForm(f => ({...f, couponCode: val.toUpperCase()}))}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  style={styles.textInput}
                />

                <Text style={styles.inputLabel}>Offer name *</Text>
                <TextInput
                  accessibilityLabel="Offer name"
                  placeholder="e.g. First User Discount"
                  placeholderTextColor="#999"
                  value={form.name}
                  onChangeText={val => setForm(f => ({...f, name: val}))}
                  style={styles.textInput}
                />

                {/* Section: Discount */}
                <Text style={styles.formSectionHeader}>Discount</Text>

                <Text style={styles.inputLabel}>Discount type</Text>
                <View style={styles.segmentedRow}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    style={[
                      styles.segmentButton,
                      form.discountType === 'fixed' && styles.segmentButtonActive,
                    ]}
                    onPress={() => setForm(f => ({...f, discountType: 'fixed'}))}>
                    <Text
                      style={[
                        styles.segmentText,
                        form.discountType === 'fixed' && styles.segmentTextActive,
                      ]}>
                      Fixed amount (₹)
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    accessibilityRole="button"
                    style={[
                      styles.segmentButton,
                      form.discountType === 'percentage' && styles.segmentButtonActive,
                    ]}
                    onPress={() => setForm(f => ({...f, discountType: 'percentage'}))}>
                    <Text
                      style={[
                        styles.segmentText,
                        form.discountType === 'percentage' && styles.segmentTextActive,
                      ]}>
                      Percentage (%)
                    </Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.inputLabel}>
                  Discount value * {form.discountType === 'percentage' ? '(%)' : '(₹)'}
                </Text>
                <TextInput
                  accessibilityLabel="Discount value"
                  placeholder={form.discountType === 'percentage' ? 'e.g. 20' : 'e.g. 50'}
                  placeholderTextColor="#999"
                  keyboardType="numeric"
                  value={form.discountValue}
                  onChangeText={val => setForm(f => ({...f, discountValue: val}))}
                  style={styles.textInput}
                />

                {/* Section: Order Rules */}
                <Text style={styles.formSectionHeader}>Order rules</Text>

                <Text style={styles.inputLabel}>Minimum order amount (₹)</Text>
                <TextInput
                  accessibilityLabel="Minimum order amount"
                  placeholder="0"
                  placeholderTextColor="#999"
                  keyboardType="numeric"
                  value={form.minimumOrderAmount}
                  onChangeText={val => setForm(f => ({...f, minimumOrderAmount: val}))}
                  style={styles.textInput}
                />

                <Text style={styles.inputLabel}>Maximum discount (₹, optional)</Text>
                <TextInput
                  accessibilityLabel="Maximum discount"
                  placeholder="Leave empty for unlimited"
                  placeholderTextColor="#999"
                  keyboardType="numeric"
                  value={form.maximumDiscount}
                  onChangeText={val => setForm(f => ({...f, maximumDiscount: val}))}
                  style={styles.textInput}
                />

                {/* Section: Validity */}
                <Text style={styles.formSectionHeader}>Validity</Text>

                <Text style={styles.inputLabel}>Starts at (YYYY-MM-DD, optional)</Text>
                <TextInput
                  accessibilityLabel="Starts at"
                  placeholder="e.g. 2026-10-01"
                  placeholderTextColor="#999"
                  value={form.startsAt}
                  onChangeText={val => setForm(f => ({...f, startsAt: val}))}
                  style={styles.textInput}
                />

                <Text style={styles.inputLabel}>Expires at (YYYY-MM-DD, optional)</Text>
                <TextInput
                  accessibilityLabel="Expires at"
                  placeholder="e.g. 2027-10-01"
                  placeholderTextColor="#999"
                  value={form.expiresAt}
                  onChangeText={val => setForm(f => ({...f, expiresAt: val}))}
                  style={styles.textInput}
                />

                {/* Section: Usage */}
                <Text style={styles.formSectionHeader}>Usage</Text>

                <Text style={styles.inputLabel}>Usage limit (Redemptions, optional)</Text>
                <TextInput
                  accessibilityLabel="Usage limit"
                  placeholder="Leave empty for unlimited"
                  placeholderTextColor="#999"
                  keyboardType="number-pad"
                  value={form.usageLimit}
                  onChangeText={val => setForm(f => ({...f, usageLimit: val}))}
                  style={styles.textInput}
                />

                {/* Section: Eligibility */}
                <Text style={styles.formSectionHeader}>Eligibility</Text>

                <Text style={styles.inputLabel}>Eligibility note (Optional)</Text>
                <TextInput
                  accessibilityLabel="Eligibility note"
                  placeholder="e.g. New customers only"
                  placeholderTextColor="#999"
                  value={form.eligibilityNote}
                  onChangeText={val => setForm(f => ({...f, eligibilityNote: val}))}
                  style={styles.textInput}
                />
              </ScrollView>

              {/* Bottom Actions */}
              <View style={styles.modalFooter}>
                <TouchableOpacity
                  accessibilityRole="button"
                  style={styles.cancelButton}
                  onPress={() => setModalVisible(false)}>
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={busy}
                  style={styles.saveButton}
                  onPress={handleSaveOffer}>
                  {busy ? (
                    <ActivityIndicator color="#FFF" />
                  ) : (
                    <Text style={styles.saveButtonText}>Save Offer</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F7F6F2',
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 16,
  },
  backButton: {
    paddingVertical: 8,
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
  },
  backButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginTop: 4,
    gap: 12,
  },
  eyebrow: {
    fontSize: 11,
    letterSpacing: 1.4,
    fontWeight: '800',
    color: '#67635B',
    marginBottom: 4,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: '#151515',
  },
  subtitle: {
    fontSize: 14,
    color: '#6D685F',
    marginTop: 4,
  },
  refreshButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D0CBC1',
    backgroundColor: '#FFF',
    minHeight: 44,
    justifyContent: 'center',
  },
  refreshButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111',
  },
  errorBanner: {
    backgroundColor: '#FCEBEB',
    borderWidth: 1,
    borderColor: '#F09999',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  errorBannerText: {
    color: '#A11',
    fontWeight: '700',
    flex: 1,
    fontSize: 13,
  },
  retryLinkText: {
    color: '#A11',
    fontWeight: '900',
    textDecorationLine: 'underline',
    marginLeft: 10,
  },
  successBanner: {
    backgroundColor: '#EDF9F0',
    borderWidth: 1,
    borderColor: '#A6E3B8',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  successBannerText: {
    color: '#13642C',
    fontWeight: '700',
    fontSize: 13,
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    fontWeight: '600',
    color: '#67635B',
  },
  sectionHeader: {
    marginTop: 8,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.2,
    color: '#67635B',
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E2DED6',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
  },
  summaryNumber: {
    fontSize: 28,
    fontWeight: '900',
    color: '#151515',
  },
  summaryLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6D685F',
    marginTop: 4,
  },
  couponsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    minHeight: 44,
  },
  createButton: {
    backgroundColor: '#151515',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    minHeight: 44,
    justifyContent: 'center',
  },
  createButtonText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '800',
  },
  emptyCard: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E2DED6',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginTop: 8,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#151515',
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#6D685F',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 16,
  },
  emptyAction: {
    backgroundColor: '#151515',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    minHeight: 44,
    justifyContent: 'center',
  },
  emptyActionText: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: 14,
  },
  offerCard: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E2DED6',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  offerCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  offerCode: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0.8,
    color: '#151515',
  },
  statusBadge: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  statusBadgeActive: {
    backgroundColor: '#E6F4EA',
  },
  statusBadgeInactive: {
    backgroundColor: '#F1F1EF',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  statusTextActive: {
    color: '#137333',
  },
  statusTextInactive: {
    color: '#706D67',
  },
  offerName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#4B4842',
    marginTop: 4,
  },
  offerDetails: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#EBE8E1',
  },
  offerDiscount: {
    fontSize: 16,
    fontWeight: '900',
    color: '#151515',
  },
  offerMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  offerMetaText: {
    fontSize: 13,
    color: '#6D685F',
    fontWeight: '600',
  },
  eligibilityBox: {
    backgroundColor: '#F7F6F2',
    padding: 8,
    borderRadius: 8,
    marginTop: 8,
  },
  eligibilityText: {
    fontSize: 12,
    color: '#555149',
    fontWeight: '600',
  },
  cardActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#EBE8E1',
  },
  editButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#D0CBC1',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  editButtonText: {
    fontWeight: '800',
    color: '#151515',
    fontSize: 14,
  },
  toggleButton: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  activateButton: {
    backgroundColor: '#151515',
  },
  deactivateButton: {
    backgroundColor: '#F5ECEB',
    borderWidth: 1,
    borderColor: '#E8C7C4',
  },
  toggleButtonText: {
    fontWeight: '800',
    fontSize: 14,
  },
  activateText: {
    color: '#FFF',
  },
  deactivateText: {
    color: '#A11',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalContentWrapper: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '92%',
    paddingBottom: Platform.OS === 'ios' ? 20 : 16,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#EAE7E0',
  },
  modalCloseButton: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  modalBackText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#151515',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#151515',
  },
  modalSpacer: {
    minWidth: 44,
  },
  modalScroll: {
    paddingHorizontal: 20,
  },
  modalScrollContent: {
    paddingVertical: 16,
    paddingBottom: 30,
  },
  formErrorBanner: {
    backgroundColor: '#FCEBEB',
    borderWidth: 1,
    borderColor: '#F09999',
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  formErrorText: {
    color: '#A11',
    fontWeight: '700',
    fontSize: 13,
  },
  formSectionHeader: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1,
    color: '#67635B',
    marginTop: 14,
    marginBottom: 8,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#333',
    marginBottom: 6,
    marginTop: 6,
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#D4CFC5',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: '#151515',
    backgroundColor: '#FFF',
    minHeight: 44,
  },
  segmentedRow: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#D4CFC5',
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 8,
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F7F6F2',
    minHeight: 44,
  },
  segmentButtonActive: {
    backgroundColor: '#151515',
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#555',
  },
  segmentTextActive: {
    color: '#FFF',
  },
  modalFooter: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#EAE7E0',
  },
  cancelButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#D0CBC1',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#333',
  },
  saveButton: {
    flex: 1,
    backgroundColor: '#151515',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  saveButtonText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFF',
  },
});
