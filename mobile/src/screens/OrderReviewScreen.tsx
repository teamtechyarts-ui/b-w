import React, {
  useEffect,
  useMemo,
  useState,
} from 'react';
import CouponSection from '../components/CouponSection';
import CheckoutProgressBar from '../components/CheckoutProgressBar';
import AppIcon from '../components/AppIcon';
import type {CustomerPackage} from '../services/packagesApi';
import {packageDiscount} from '../utils/packagePricing';
import type {CouponResult} from '../services/growthApi';
import {ServiceabilityResponse, checkOrderServiceability} from '../services/ordersApi';
import {borderRadius, colors, shadows, spacing, typography} from '../theme/designSystem';

import {
  ActivityIndicator,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import type {AddressItem} from '../types/address';
import type {CartItem} from '../types/service';
import {
  calculateCheckoutPricing,
  formatMoney,
} from '../utils/orderPricing';
import type {CheckoutPricingPolicy} from '../utils/orderPricing';

type OrderReviewScreenProps = {
  selectedAddress: AddressItem | null;
  pickupDateLabel: string;
  pickupSlotLabel: string;
  cartItems: CartItem[];
  cartSubtotal: number;
  pricingPolicy?: CheckoutPricingPolicy;
  accessToken: string;
  coupon: CouponResult | null;
  onCouponChange: (coupon: CouponResult | null) => void;
  loyaltyPoints: number;
  onLoyaltyPointsChange: (points: number) => void;
  selectedPackage: CustomerPackage | null;
  onPackageChange: (value: CustomerPackage | null) => void;

  onBack: () => void;
  onChangeAddress: () => void;
  onChangePickupTime: () => void;
  onContinueToPayment: () => void;
};

export default function OrderReviewScreen({
  selectedAddress,
  pickupDateLabel,
  pickupSlotLabel,
  cartItems,
  cartSubtotal,
  pricingPolicy,
  accessToken,
  coupon,
  onCouponChange,
  loyaltyPoints,
  onLoyaltyPointsChange,
  selectedPackage,
  onPackageChange,
  onBack,
  onChangeAddress,
  onChangePickupTime,
  onContinueToPayment,
}: OrderReviewScreenProps) {
  const [pointsPerRupee, setPointsPerRupee] = useState(10);
  const [serviceability, setServiceability] = useState<ServiceabilityResponse | null>(null);
  const [checkingServiceability, setCheckingServiceability] = useState(false);

  useEffect(() => {
    let active = true;
    if (!selectedAddress) {
      setServiceability(null);
      return;
    }

    const postalCode = selectedAddress.postal_code ? String(selectedAddress.postal_code).trim() : '';
    if (!postalCode || !/^\d{6}$/.test(postalCode)) {
      setServiceability({
        serviceable: false,
        reason: 'INVALID_PINCODE',
        message: 'Please enter a valid 6-digit pincode.',
      });
      return;
    }

    if (!accessToken) return;

    setCheckingServiceability(true);
    setServiceability(null);
    checkOrderServiceability(accessToken, selectedAddress.id)
      .then(res => {
        if (active) setServiceability(res);
      })
      .catch(err => {
        if (active) {
          setServiceability({
            serviceable: false,
            reason: 'OUTSIDE_SERVICE_AREA',
            message: err instanceof Error ? err.message : 'Unable to check serviceability.',
          });
        }
      })
      .finally(() => {
        if (active) setCheckingServiceability(false);
      });

    return () => {
      active = false;
    };
  }, [accessToken, selectedAddress]);

  const pricing = useMemo(
    () =>
      calculateCheckoutPricing(
        cartSubtotal,
        Math.min(coupon?.discount ?? 0, Math.max(0, cartSubtotal - packageDiscount(selectedPackage, cartItems))) +
          loyaltyPoints / pointsPerRupee +
          packageDiscount(selectedPackage, cartItems),
        pricingPolicy,
      ),
    [
      cartSubtotal,
      coupon,
      loyaltyPoints,
      pointsPerRupee,
      selectedPackage,
      cartItems,
      pricingPolicy,
    ],
  );

  const isContinueDisabled =
    cartSubtotal < (pricingPolicy?.minimumOrderAmount ?? 0) ||
    checkingServiceability ||
    (serviceability !== null && !serviceability.serviceable);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.screenContainer}>
        {/* Header */}
        <View style={styles.pageHeader}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={styles.headerBtn}
            onPress={onBack}>
            <View style={styles.backRow}>
              <AppIcon name="arrow-left" size={16} color={colors.textPrimary} />
              <Text style={styles.pageBack}>Back</Text>
            </View>
          </TouchableOpacity>

          <Text style={styles.pageHeaderTitle}>Order Review</Text>

          <View style={styles.headerSpacer} />
        </View>

        {/* Progress Bar */}
        <CheckoutProgressBar currentStep="review" />

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}>
          
          {/* Section 1: Pickup Address */}
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>PICKUP ADDRESS</Text>
            <TouchableOpacity onPress={onChangeAddress} accessibilityRole="button" accessibilityLabel="Change pickup address">
              <Text style={styles.changeLinkText}>Change</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.reviewCard}>
            <View style={styles.cardHeaderRow}>
              <View style={styles.iconCircle}>
                <AppIcon name="location" size={18} color={colors.textPrimary} />
              </View>
              <View style={styles.cardHeaderInfo}>
                <Text style={styles.cardMainTitle}>
                  {selectedAddress?.label || 'Pickup Address'}
                </Text>
                <Text style={styles.addressLine}>
                  {selectedAddress?.address_line1 || '-'}
                </Text>
                {selectedAddress?.address_line2 ? (
                  <Text style={styles.addressLine}>
                    {selectedAddress.address_line2}
                  </Text>
                ) : null}
                <Text style={styles.addressLine}>
                  {[
                    selectedAddress?.city,
                    selectedAddress?.state,
                    selectedAddress?.postal_code,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </Text>
              </View>
            </View>

            {/* Serviceability Status Feedback */}
            {checkingServiceability ? (
              <View style={styles.serviceabilityLoadingRow}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.serviceabilityLoadingText}>
                  Checking laundry serviceability...
                </Text>
              </View>
            ) : serviceability?.serviceable ? (
              <View style={styles.serviceableCard}>
                <View style={styles.feedbackHeaderRow}>
                  <AppIcon name="check" size={16} color={colors.success} strokeWidth={2.5} />
                  <Text style={styles.serviceableTitle}>Service available in your area</Text>
                </View>
                {serviceability.facilityName ? (
                  <Text style={styles.serviceableDetail}>
                    {serviceability.facilityName}
                  </Text>
                ) : null}
              </View>
            ) : serviceability && !serviceability.serviceable && (serviceability.reason === 'INVALID_PINCODE' || serviceability.reason === 'MISSING_PINCODE') ? (
              <View style={styles.locationRequiredCard}>
                <View style={styles.feedbackHeaderRow}>
                  <AppIcon name="warning" size={16} color={colors.warning} strokeWidth={2} />
                  <Text style={styles.locationRequiredTitle}>Pincode required</Text>
                </View>
                <Text style={styles.locationRequiredDetail}>
                  Please enter a valid 6-digit pincode for your pickup address.
                </Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Update Address"
                  style={styles.btnUpdateAddress}
                  onPress={onChangeAddress}>
                  <Text style={styles.btnUpdateAddressText}>Update Address</Text>
                </TouchableOpacity>
              </View>
            ) : serviceability && !serviceability.serviceable ? (
              <View style={styles.outsideServiceCard}>
                <View style={styles.feedbackHeaderRow}>
                  <AppIcon name="alert" size={16} color={colors.danger} strokeWidth={2} />
                  <Text style={styles.outsideServiceTitle}>Service not available</Text>
                </View>
                <Text style={styles.outsideServiceDetail}>
                  {serviceability.message || 'We currently do not provide pickup and delivery service in this pincode.'}
                </Text>
              </View>
            ) : null}
          </View>

          {/* Section 2: Pickup Schedule */}
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>PICKUP SCHEDULE</Text>
            <TouchableOpacity onPress={onChangePickupTime} accessibilityRole="button" accessibilityLabel="Change pickup time">
              <Text style={styles.changeLinkText}>Change</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.reviewCard}>
            <View style={styles.scheduleRow}>
              <View style={styles.iconCircle}>
                <AppIcon name="calendar" size={18} color={colors.textPrimary} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.itemMetaLabel}>Pickup Date</Text>
                <Text style={styles.cardMainTitle}>
                  {pickupDateLabel || '-'}
                </Text>
              </View>
            </View>

            <View style={styles.cardDivider} />

            <View style={styles.scheduleRow}>
              <View style={styles.iconCircle}>
                <AppIcon name="clock" size={18} color={colors.textPrimary} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.itemMetaLabel}>Pickup Time Window</Text>
                <Text style={styles.cardMainTitle}>
                  {pickupSlotLabel || '-'}
                </Text>
              </View>
            </View>
          </View>

          {/* Section 3: Laundry Items */}
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>LAUNDRY ITEMS ({cartItems.length})</Text>
          </View>

          <View style={styles.reviewCard}>
            {cartItems.map((item, index) => (
              <View
                key={item.id}
                style={[
                  styles.itemRow,
                  index < cartItems.length - 1 && styles.itemBorder,
                ]}>
                <View style={styles.flex}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  <Text style={styles.itemQtyPrice}>
                    {item.quantity} × ₹{formatMoney(item.price ?? 0)} / {item.pricingUnit}
                  </Text>
                </View>

                <Text style={styles.itemLineTotal}>
                  ₹{formatMoney((item.price ?? 0) * item.quantity)}
                </Text>
              </View>
            ))}
          </View>

          {/* Coupons & Offers */}
          <CouponSection
            accessToken={accessToken}
            subtotal={cartSubtotal}
            applied={coupon}
            onChange={onCouponChange}
          />

          {/* Section 4: Price Summary */}
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>PRICE SUMMARY</Text>
          </View>

          <View style={styles.priceSummaryCard}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Service Subtotal</Text>
              <Text style={styles.summaryValue}>
                ₹{formatMoney(pricing.subtotal)}
              </Text>
            </View>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Pickup & Delivery</Text>
              <Text
                style={[
                  styles.summaryValue,
                  pricing.hasFreeDelivery && styles.freeDeliveryValue,
                ]}>
                {pricing.hasFreeDelivery
                  ? 'FREE'
                  : `₹${formatMoney(pricing.pickupDeliveryCharge)}`}
              </Text>
            </View>

            {pricing.discountAmount > 0 ? (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Coupon discount</Text>
                <Text style={styles.discountValue}>
                  -₹{formatMoney(pricing.discountAmount)}
                </Text>
              </View>
            ) : null}

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>
                GST ({pricing.gstRate}%)
              </Text>
              <Text style={styles.summaryValue}>
                ₹{formatMoney(pricing.gstAmount)}
              </Text>
            </View>

            <View style={styles.summaryDivider} />

            <View style={styles.grandTotalRow}>
              <View>
                <Text style={styles.grandTotalLabel}>Grand Total</Text>
                <Text style={styles.grandTotalSub}>All taxes & fees included</Text>
              </View>
              <Text style={styles.grandTotalValue}>
                ₹{formatMoney(pricing.grandTotal)}
              </Text>
            </View>

            {!pricing.hasFreeDelivery ? (
              <View style={styles.freeDeliveryHintBox}>
                <AppIcon name="info" size={14} color={colors.info} />
                <Text style={styles.freeDeliveryHint}>
                  Add ₹{formatMoney(pricing.amountUntilFreeDelivery)} more for free pickup & delivery.
                </Text>
              </View>
            ) : null}
          </View>
        </ScrollView>

        {/* Sticky Bottom CTA Bar */}
        <View style={styles.bottomArea}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Continue to Payment ₹${formatMoney(pricing.grandTotal)}`}
            style={[
              styles.continueButton,
              isContinueDisabled && styles.continueButtonDisabled,
            ]}
            disabled={isContinueDisabled}
            onPress={onContinueToPayment}>
            <View style={styles.btnContentRow}>
              <Text style={styles.continueButtonText}>
                {checkingServiceability
                  ? 'Checking serviceability...'
                  : serviceability && !serviceability.serviceable
                  ? 'Service Unavailable'
                  : `Continue to Payment • ₹${formatMoney(pricing.grandTotal)}`}
              </Text>
              {!checkingServiceability && (!serviceability || serviceability.serviceable) ? (
                <AppIcon name="arrow-right" size={18} color={colors.textInverse} strokeWidth={2.5} />
              ) : null}
            </View>
          </TouchableOpacity>
          {cartSubtotal < (pricingPolicy?.minimumOrderAmount ?? 0) ? (
            <Text style={styles.minOrderWarning} accessibilityRole="alert">
              Minimum order ₹{formatMoney(pricingPolicy!.minimumOrderAmount)}.
            </Text>
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  screenContainer: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  pageHeader: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerBtn: {
    minWidth: 54,
    minHeight: 44,
    justifyContent: 'center',
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  pageBack: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  pageHeaderTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  headerSpacer: {
    width: 54,
  },
  scrollContent: {
    paddingBottom: 110,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textSecondary,
    letterSpacing: 0.5,
  },
  changeLinkText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  reviewCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.xs,
    ...shadows.sm,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  cardHeaderInfo: {
    flex: 1,
  },
  cardMainTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  addressLine: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
    lineHeight: 16,
  },
  cardDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemMetaLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  itemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  itemQtyPrice: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  itemLineTotal: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  priceSummaryCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  summaryLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  summaryValue: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  freeDeliveryValue: {
    color: colors.success,
  },
  discountValue: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.success,
  },
  summaryDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  grandTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  grandTotalLabel: {
    fontSize: 16,
    fontWeight: '900',
    color: colors.textPrimary,
  },
  grandTotalSub: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
  },
  grandTotalValue: {
    fontSize: 20,
    fontWeight: '900',
    color: colors.textPrimary,
  },
  freeDeliveryHintBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
    backgroundColor: colors.infoSurface,
    padding: spacing.sm,
    borderRadius: borderRadius.sm,
  },
  freeDeliveryHint: {
    fontSize: 11,
    color: colors.info,
    fontWeight: '600',
    flex: 1,
  },
  bottomArea: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.md,
    backgroundColor: 'transparent',
  },
  continueButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    ...shadows.lg,
  },
  btnContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  continueButtonDisabled: {
    backgroundColor: colors.textSubtle,
    shadowOpacity: 0,
    elevation: 0,
  },
  continueButtonText: {
    color: colors.textInverse,
    fontSize: 16,
    fontWeight: '800',
  },
  minOrderWarning: {
    fontSize: 11,
    color: colors.danger,
    textAlign: 'center',
    marginTop: 6,
  },
  serviceabilityLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceSubtle,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  serviceabilityLoadingText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  serviceableCard: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  feedbackHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  serviceableTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.successText,
  },
  serviceableDetail: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.success,
    marginTop: 2,
    marginLeft: 20,
  },
  locationRequiredCard: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  locationRequiredTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.warningText,
  },
  locationRequiredDetail: {
    fontSize: 11,
    color: colors.warningText,
    marginTop: 2,
  },
  btnUpdateAddress: {
    backgroundColor: colors.warning,
    borderRadius: borderRadius.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
  },
  btnUpdateAddressText: {
    color: colors.textInverse,
    fontSize: 11,
    fontWeight: '700',
  },
  outsideServiceCard: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  outsideServiceTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.dangerText,
  },
  outsideServiceDetail: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.dangerText,
    marginTop: 2,
  },
});
