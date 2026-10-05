import React, {useState} from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import AppIcon from '../components/AppIcon';
import CheckoutProgressBar from '../components/CheckoutProgressBar';
import TermsAndConditionsModal from '../components/TermsAndConditionsModal';
import {borderRadius, colors, shadows, spacing, typography} from '../theme/designSystem';
import type {PaymentMethod} from '../types/payment';
import type {CheckoutPricing} from '../utils/orderPricing';
import {formatMoney} from '../utils/orderPricing';

type PaymentScreenProps = {
  pricing: CheckoutPricing;
  selectedPaymentMethod: PaymentMethod | null;
  termsAccepted: boolean;
  placingOrder: boolean;
  errorMessage?: string | null;
  onClearError?: () => void;

  onBack: () => void;
  onSelectPaymentMethod: (method: PaymentMethod) => void;
  onTermsAcceptedChange: (value: boolean) => void;
  onPlaceOrder: () => void;
};

export default function PaymentScreen({
  pricing,
  selectedPaymentMethod,
  termsAccepted,
  placingOrder,
  errorMessage,
  onClearError,
  onBack,
  onSelectPaymentMethod,
  onTermsAcceptedChange,
  onPlaceOrder,
}: PaymentScreenProps) {
  const [termsVisible, setTermsVisible] = useState(false);

  const disabled = !selectedPaymentMethod || !termsAccepted || placingOrder;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.screenContainer}>
        {/* Header */}
        <View style={styles.pageHeader}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Go back"
            disabled={placingOrder}
            style={styles.headerBtn}
            onPress={onBack}>
            <View style={styles.backRow}>
              <AppIcon name="arrow-left" size={16} color={colors.textPrimary} />
              <Text style={styles.pageBack}>Back</Text>
            </View>
          </TouchableOpacity>

          <Text style={styles.pageHeaderTitle}>Payment</Text>

          <View style={styles.headerSpacer} />
        </View>

        {/* Progress Bar */}
        <CheckoutProgressBar currentStep="payment" />

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}>
          
          {/* Price Summary Banner Card */}
          <View style={styles.totalHeroCard}>
            <View style={styles.totalHeroTop}>
              <Text style={styles.totalHeroLabel}>GRAND TOTAL</Text>
              <Text style={styles.totalHeroAmount}>
                ₹{formatMoney(pricing.grandTotal)}
              </Text>
            </View>

            <View style={styles.totalBreakdown}>
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>Service Subtotal</Text>
                <Text style={styles.breakdownValue}>
                  ₹{formatMoney(pricing.subtotal)}
                </Text>
              </View>

              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>Pickup & Delivery</Text>
                <Text style={[styles.breakdownValue, pricing.hasFreeDelivery && styles.freeDeliveryValue]}>
                  {pricing.hasFreeDelivery ? 'FREE' : `₹${formatMoney(pricing.pickupDeliveryCharge)}`}
                </Text>
              </View>

              {pricing.discountAmount > 0 ? (
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>Discount</Text>
                  <Text style={styles.discountValue}>
                    -₹{formatMoney(pricing.discountAmount)}
                  </Text>
                </View>
              ) : null}

              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>GST ({pricing.gstRate}%)</Text>
                <Text style={styles.breakdownValue}>
                  ₹{formatMoney(pricing.gstAmount)}
                </Text>
              </View>
            </View>
          </View>

          {/* Section: Payment Method */}
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>SELECT PAYMENT METHOD</Text>
          </View>

          {/* Cash on Delivery Card */}
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Pay with Cash on Delivery"
            accessibilityState={{selected: selectedPaymentMethod === 'cash_on_delivery'}}
            disabled={placingOrder}
            style={[
              styles.paymentCard,
              selectedPaymentMethod === 'cash_on_delivery' && styles.paymentCardSelected,
            ]}
            onPress={() => onSelectPaymentMethod('cash_on_delivery')}>
            <View style={styles.radioOuter}>
              {selectedPaymentMethod === 'cash_on_delivery' ? (
                <View style={styles.radioInner} />
              ) : null}
            </View>

            <View style={styles.methodIconBox}>
              <AppIcon name="cash" size={20} color={colors.textPrimary} />
            </View>

            <View style={styles.methodTextCol}>
              <Text style={styles.methodTitle}>Cash on Delivery</Text>
              <Text style={styles.methodDesc}>
                Pay when your order is delivered as per standard COD rules.
              </Text>
            </View>
          </TouchableOpacity>

          {/* Online Payment Card */}
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Pay Online via UPI, Cards, NetBanking"
            accessibilityState={{selected: selectedPaymentMethod === 'razorpay'}}
            disabled={placingOrder}
            style={[
              styles.paymentCard,
              selectedPaymentMethod === 'razorpay' && styles.paymentCardSelected,
            ]}
            onPress={() => onSelectPaymentMethod('razorpay')}>
            <View style={styles.radioOuter}>
              {selectedPaymentMethod === 'razorpay' ? (
                <View style={styles.radioInner} />
              ) : null}
            </View>

            <View style={styles.methodIconBox}>
              <AppIcon name="card" size={20} color={colors.textPrimary} />
            </View>

            <View style={styles.methodTextCol}>
              <View style={styles.onlineHeaderRow}>
                <Text style={styles.methodTitle}>Online Payment</Text>
                <View style={styles.badgeOnline}>
                  <Text style={styles.badgeOnlineText}>UPI / CARDS / NETBANKING</Text>
                </View>
              </View>
              <Text style={styles.methodDesc}>
                Pay securely online through Razorpay (UPI, Credit/Debit Cards, NetBanking).
              </Text>
            </View>
          </TouchableOpacity>

          {/* Section: Customer Consent */}
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>CUSTOMER CONSENT</Text>
          </View>

          <View style={styles.consentCard}>
            <TouchableOpacity
              accessibilityRole="checkbox"
              accessibilityState={{checked: termsAccepted}}
              accessibilityLabel="I agree to Terms & Conditions and Service Policy"
              disabled={placingOrder}
              activeOpacity={0.8}
              style={styles.consentRow}
              onPress={() => onTermsAcceptedChange(!termsAccepted)}>
              <View
                style={[
                  styles.checkbox,
                  termsAccepted && styles.checkboxChecked,
                ]}>
                {termsAccepted ? (
                  <AppIcon name="check" size={14} color={colors.textInverse} strokeWidth={3} />
                ) : null}
              </View>

              <View style={styles.termsTextContainer}>
                <Text style={styles.termsText}>
                  I agree to the{' '}
                  <Text
                    style={styles.termsLink}
                    onPress={() => setTermsVisible(true)}>
                    Terms & Conditions
                  </Text>
                  {' '}and Service Policy.
                </Text>
              </View>
            </TouchableOpacity>

            {!termsAccepted ? (
              <Text style={styles.consentWarning}>
                Please check the box above to confirm your order agreement.
              </Text>
            ) : (
              <View style={styles.consentSuccessRow}>
                <AppIcon name="check" size={14} color={colors.success} strokeWidth={2.5} />
                <Text style={styles.consentSuccess}>
                  Terms accepted for this order.
                </Text>
              </View>
            )}
          </View>

          {/* Inline Error Card */}
          {errorMessage ? (
            <View style={styles.errorCard} accessibilityRole="alert">
              <View style={styles.errorCardHeader}>
                <AppIcon name="alert" size={18} color={colors.danger} strokeWidth={2} />
                <Text style={styles.errorCardTitle}>Online payment unavailable</Text>
              </View>
              <Text style={styles.errorCardMessage}>{errorMessage}</Text>
              <View style={styles.errorActionRow}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Try payment again"
                  style={styles.retryBtn}
                  onPress={onPlaceOrder}>
                  <Text style={styles.retryBtnText}>Try Again</Text>
                </TouchableOpacity>
                {selectedPaymentMethod === 'razorpay' ? (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Switch to Cash on Delivery"
                    style={styles.switchCodBtn}
                    onPress={() => {
                      onSelectPaymentMethod('cash_on_delivery');
                      onClearError?.();
                    }}>
                    <Text style={styles.switchCodBtnText}>Pay with COD instead</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          ) : null}

          {/* Trust / Security Reassurance */}
          <View style={styles.securityBox}>
            <AppIcon name="shield" size={18} color={colors.textPrimary} />
            <View style={styles.securityTextCol}>
              <Text style={styles.securityTitle}>Secure Laundry Booking</Text>
              <Text style={styles.securityText}>
                Your order is processed securely and final item inspection totals are verified by our facility.
              </Text>
            </View>
          </View>
        </ScrollView>

        {/* Sticky Bottom Place Order CTA */}
        <View style={styles.bottomArea}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={
              selectedPaymentMethod === 'razorpay'
                ? `Pay ₹${formatMoney(pricing.grandTotal)}`
                : `Place Order ₹${formatMoney(pricing.grandTotal)}`
            }
            disabled={disabled}
            style={[
              styles.placeOrderButton,
              disabled && styles.buttonDisabled,
            ]}
            onPress={onPlaceOrder}>
            {placingOrder ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={colors.textInverse} size="small" />
                <Text style={styles.loadingText}>Processing order...</Text>
              </View>
            ) : (
              <View style={styles.btnContentRow}>
                <Text style={styles.placeOrderButtonText}>
                  {selectedPaymentMethod === 'razorpay'
                    ? `Pay ₹${formatMoney(pricing.grandTotal)}`
                    : `Place Order • ₹${formatMoney(pricing.grandTotal)}`}
                </Text>
                <AppIcon name="arrow-right" size={18} color={colors.textInverse} strokeWidth={2.5} />
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Terms Modal */}
        <TermsAndConditionsModal
          visible={termsVisible}
          onClose={() => setTermsVisible(false)}
        />
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
  totalHeroCard: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    ...shadows.md,
  },
  totalHeroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
  },
  totalHeroLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#9CA3AF',
    letterSpacing: 0.5,
  },
  totalHeroAmount: {
    fontSize: 22,
    fontWeight: '900',
    color: colors.textInverse,
  },
  totalBreakdown: {
    paddingTop: spacing.sm,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  breakdownLabel: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  breakdownValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#F3F4F6',
  },
  freeDeliveryValue: {
    color: colors.success,
  },
  discountValue: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.success,
  },
  sectionHeaderRow: {
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textSecondary,
    letterSpacing: 0.5,
  },
  paymentCard: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    ...shadows.sm,
  },
  paymentCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.surface,
    ...shadows.md,
  },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  methodIconBox: {
    width: 38,
    height: 38,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  methodTextCol: {
    flex: 1,
  },
  onlineHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  methodTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  methodDesc: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
    lineHeight: 15,
  },
  badgeOnline: {
    backgroundColor: colors.infoSurface,
    borderRadius: borderRadius.xs,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeOnlineText: {
    fontSize: 8,
    fontWeight: '800',
    color: colors.info,
    letterSpacing: 0.5,
  },
  consentCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
    marginTop: 1,
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
  },
  termsTextContainer: {
    flex: 1,
  },
  termsText: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  termsLink: {
    fontWeight: '800',
    color: colors.textPrimary,
    textDecorationLine: 'underline',
  },
  consentWarning: {
    fontSize: 11,
    color: colors.warningText,
    marginTop: spacing.sm,
    marginLeft: 32,
  },
  consentSuccessRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
    marginLeft: 32,
  },
  consentSuccess: {
    fontSize: 11,
    color: colors.success,
    fontWeight: '700',
  },
  securityBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceSubtle,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginTop: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  securityTextCol: {
    flex: 1,
  },
  securityTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  securityText: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
    lineHeight: 15,
  },
  errorCard: {
    backgroundColor: '#FEF2F2',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: '#FECACA',
    marginBottom: spacing.sm,
  },
  errorCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  errorCardTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.danger,
  },
  errorCardMessage: {
    fontSize: 12,
    color: colors.textPrimary,
    lineHeight: 17,
    marginBottom: spacing.sm,
  },
  errorActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  retryBtn: {
    backgroundColor: colors.danger,
    borderRadius: borderRadius.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    minHeight: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  retryBtnText: {
    color: colors.textInverse,
    fontSize: 12,
    fontWeight: '800',
  },
  switchCodBtn: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    minHeight: 36,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  switchCodBtnText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  bottomArea: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.md,
    backgroundColor: 'transparent',
  },
  placeOrderButton: {
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
  placeOrderButtonText: {
    color: colors.textInverse,
    fontSize: 16,
    fontWeight: '800',
  },
  buttonDisabled: {
    backgroundColor: colors.textSubtle,
    shadowOpacity: 0,
    elevation: 0,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  loadingText: {
    color: colors.textInverse,
    fontSize: 15,
    fontWeight: '700',
  },
});
