import React, {useMemo} from 'react';
import {
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
import StateView from '../components/StateView';
import {borderRadius, colors, shadows, spacing, typography} from '../theme/designSystem';
import {
  calculateCheckoutPricing,
  formatMoney,
} from '../utils/orderPricing';
import type {CheckoutPricingPolicy} from '../utils/orderPricing';

type CartItem = {
  id: string;
  categoryId: string | null;
  categoryName: string | null;
  name: string;
  description: string | null;
  pricingUnit: string;
  price: number | null;
  facilityId: string | null;
  quantity: number;
};

type CartScreenProps = {
  items: CartItem[];
  itemCount: number;
  subtotal: number;
  pricingPolicy?: CheckoutPricingPolicy;

  onBack: () => void;
  onHome: () => void;
  onBrowseServices: () => void;
  onContinue: () => void;

  onUpdateQuantity: (
    item: CartItem,
    change: number,
  ) => void;
};

export default function CartScreen({
  items,
  itemCount,
  subtotal,
  pricingPolicy,
  onBack,
  onHome,
  onBrowseServices,
  onContinue,
  onUpdateQuantity,
}: CartScreenProps) {
  const pricing = useMemo(
    () => calculateCheckoutPricing(subtotal, 0, pricingPolicy),
    [subtotal, pricingPolicy],
  );

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

          <Text style={styles.pageHeaderTitle}>Your Cart</Text>

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Go to home"
            style={styles.headerBtn}
            onPress={onHome}>
            <Text style={styles.homeLink}>Home</Text>
          </TouchableOpacity>
        </View>

        {items.length > 0 ? (
          <CheckoutProgressBar currentStep="cart" />
        ) : null}

        {items.length === 0 ? (
          <View style={styles.emptyWrap}>
            <StateView
              type="empty"
              icon="cart"
              title="Your cart is empty"
              message="Explore our laundry and garment care services to add items and schedule a pickup."
              actionLabel="Browse Services"
              onAction={onBrowseServices}
            />
          </View>
        ) : (
          <>
            <ScrollView
              style={styles.flex}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}>
              <View style={styles.cartMetaRow}>
                <Text style={styles.summaryTitle}>
                  {itemCount} {itemCount === 1 ? 'service item' : 'service items'}
                </Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Add more services"
                  onPress={onBrowseServices}>
                  <View style={styles.addMoreRow}>
                    <AppIcon name="plus" size={14} color={colors.primary} strokeWidth={2.5} />
                    <Text style={styles.addMoreLink}>Add More</Text>
                  </View>
                </TouchableOpacity>
              </View>

              {items.map(item => (
                <View key={item.id} style={styles.itemCard}>
                  <View style={styles.itemTop}>
                    <View style={styles.itemInfo}>
                      {item.categoryName ? (
                        <View style={styles.categoryBadgeContainer}>
                          <Text style={styles.categoryBadge}>
                            {item.categoryName.toUpperCase()}
                          </Text>
                        </View>
                      ) : null}

                      <Text style={styles.itemName}>{item.name}</Text>

                      <Text style={styles.itemUnit}>
                        ₹{formatMoney(item.price ?? 0)} / {item.pricingUnit}
                      </Text>
                    </View>

                    <Text style={styles.lineTotal}>
                      ₹{formatMoney((item.price ?? 0) * item.quantity)}
                    </Text>
                  </View>

                  <View style={styles.itemBottomRow}>
                    <View style={styles.stepperBox}>
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={`Decrease ${item.name} quantity`}
                        style={styles.stepperBtn}
                        onPress={() => onUpdateQuantity(item, -1)}>
                        <AppIcon name="minus" size={12} color={colors.textPrimary} strokeWidth={2.5} />
                      </TouchableOpacity>

                      <Text style={styles.stepperQtyText}>{item.quantity}</Text>

                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={`Increase ${item.name} quantity`}
                        style={styles.stepperBtn}
                        onPress={() => onUpdateQuantity(item, 1)}>
                        <AppIcon name="plus" size={12} color={colors.textPrimary} strokeWidth={2.5} />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              ))}

              {/* Price Summary */}
              <View style={styles.priceSummaryCard}>
                <Text style={styles.priceSectionTitle}>Estimated Summary</Text>

                <View style={styles.priceRow}>
                  <Text style={styles.priceLabel}>Service Subtotal</Text>
                  <Text style={styles.priceValue}>
                    ₹{formatMoney(pricing.subtotal)}
                  </Text>
                </View>

                <View style={styles.priceRow}>
                  <Text style={styles.priceLabel}>Estimated Pickup & Delivery</Text>
                  <Text
                    style={[
                      styles.priceValue,
                      pricing.hasFreeDelivery && styles.freeDeliveryValue,
                    ]}>
                    {pricing.hasFreeDelivery
                      ? 'FREE'
                      : `₹${formatMoney(pricing.pickupDeliveryCharge)}`}
                  </Text>
                </View>

                <View style={styles.priceRow}>
                  <Text style={styles.priceLabel}>
                    GST ({pricing.gstRate}%)
                  </Text>
                  <Text style={styles.priceValue}>
                    ₹{formatMoney(pricing.gstAmount)}
                  </Text>
                </View>

                <View style={styles.priceDivider} />

                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Estimated Total</Text>
                  <Text style={styles.totalValue}>
                    ₹{formatMoney(pricing.grandTotal)}
                  </Text>
                </View>
              </View>
            </ScrollView>

            {/* Sticky Bottom Checkout CTA */}
            <View style={styles.bottomArea}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Select Address • ₹${formatMoney(pricing.grandTotal)}`}
                style={styles.checkoutButton}
                onPress={onContinue}>
                <View style={styles.btnContentRow}>
                  <Text style={styles.checkoutButtonText}>
                    Select Pickup Address
                  </Text>
                  <AppIcon name="arrow-right" size={18} color={colors.textInverse} strokeWidth={2.5} />
                </View>
              </TouchableOpacity>
            </View>
          </>
        )}
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
  homeLink: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'right',
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  scrollContent: {
    paddingBottom: 110,
  },
  cartMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
    marginTop: spacing.xs,
  },
  summaryTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  addMoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  addMoreLink: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  itemCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.sm,
  },
  itemTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  itemInfo: {
    flex: 1,
    paddingRight: spacing.md,
  },
  categoryBadgeContainer: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: borderRadius.xs,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: 'flex-start',
    marginBottom: 4,
  },
  categoryBadge: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.textMuted,
    letterSpacing: 0.5,
  },
  itemName: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  itemUnit: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  lineTotal: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  itemBottomRow: {
    marginTop: spacing.md,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  stepperBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceSubtle,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 2,
  },
  stepperBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.xs,
    backgroundColor: colors.surface,
  },
  stepperQtyText: {
    minWidth: 28,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  priceSummaryCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginTop: spacing.sm,
    ...shadows.sm,
  },
  priceSectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  priceLabel: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  priceValue: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  freeDeliveryValue: {
    color: colors.success,
  },
  priceDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  totalValue: {
    fontSize: 18,
    fontWeight: '900',
    color: colors.textPrimary,
  },
  bottomArea: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.md,
    backgroundColor: 'transparent',
  },
  checkoutButton: {
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
  checkoutButtonText: {
    color: colors.textInverse,
    fontSize: 16,
    fontWeight: '800',
  },
});
