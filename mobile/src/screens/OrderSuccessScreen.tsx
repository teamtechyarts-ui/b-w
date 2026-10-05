import React from 'react';
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
import {borderRadius, colors, shadows, spacing, typography} from '../theme/designSystem';
import type {SuccessfulOrder} from '../types/order';
import {formatMoney} from '../utils/orderPricing';

type OrderSuccessScreenProps = {
  order: SuccessfulOrder;
  onBackHome: () => void;
  onViewOrders: () => void;
};

export default function OrderSuccessScreen({
  order,
  onBackHome,
  onViewOrders,
}: OrderSuccessScreenProps) {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        <View style={styles.successIcon}>
          <AppIcon name="check" size={36} color={colors.textInverse} strokeWidth={3} />
        </View>

        <Text style={styles.title}>Order Confirmed</Text>

        <Text style={styles.subtitle}>
          Your laundry pickup has been scheduled successfully.
        </Text>

        <View style={styles.card}>
          {order.orderNumber ? (
            <>
              <View style={styles.row}>
                <Text style={styles.label}>Order Number</Text>
                <Text style={styles.value}>{order.orderNumber}</Text>
              </View>
              <View style={styles.divider} />
            </>
          ) : null}

          <View style={styles.row}>
            <Text style={styles.label}>Status</Text>
            <Text style={styles.value}>{order.status}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.row}>
            <Text style={styles.label}>Pickup</Text>
            <View style={styles.right}>
              <Text style={styles.value}>{order.pickupDateLabel}</Text>
              <Text style={styles.subValue}>{order.pickupSlotLabel}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.row}>
            <Text style={styles.label}>Payment</Text>
            <Text style={styles.value}>
              {order.paymentMethod === 'cash_on_delivery'
                ? 'Cash on Delivery'
                : 'Online Payment'}
            </Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Payment Summary</Text>

        <View style={styles.priceCard}>
          <View style={styles.priceRow}>
            <Text style={styles.priceLabel}>Service Subtotal</Text>
            <Text style={styles.priceValue}>
              ₹{formatMoney(order.subtotal)}
            </Text>
          </View>

          <View style={styles.priceRow}>
            <Text style={styles.priceLabel}>Pickup & Delivery</Text>
            <Text style={styles.priceValue}>
              {order.pickupDeliveryCharge === 0
                ? 'FREE'
                : `₹${formatMoney(order.pickupDeliveryCharge)}`}
            </Text>
          </View>

          <View style={styles.priceRow}>
            <Text style={styles.priceLabel}>
              GST @ {order.gstRate}%
            </Text>
            <Text style={styles.priceValue}>
              ₹{formatMoney(order.gstAmount)}
            </Text>
          </View>

          <View style={styles.priceDivider} />

          <View style={styles.priceRow}>
            <Text style={styles.grandTotalLabel}>Grand Total</Text>
            <Text style={styles.grandTotalValue}>
              ₹{formatMoney(order.totalAmount)}
            </Text>
          </View>
        </View>

        <Text style={styles.serverNote}>
          These totals were confirmed by the server when your order was created.
        </Text>

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Back to Home"
          style={styles.primaryButton}
          onPress={onBackHome}>
          <Text style={styles.primaryButtonText}>Back to Home</Text>
        </TouchableOpacity>

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="View Your Orders"
          style={styles.secondaryButton}
          onPress={onViewOrders}>
          <Text style={styles.secondaryButtonText}>View Your Orders</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xxxl,
  },
  successIcon: {
    width: 72,
    height: 72,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: spacing.xl,
    ...shadows.md,
  },
  title: {
    ...typography.h1,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.xl,
    ...shadows.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  label: {
    fontSize: 12,
    color: colors.textMuted,
    marginRight: spacing.lg,
  },
  value: {
    flexShrink: 1,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'right',
  },
  right: {
    flex: 1,
    alignItems: 'flex-end',
  },
  subValue: {
    marginTop: 3,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'right',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  priceCard: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    ...shadows.md,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  priceLabel: {
    color: '#9CA3AF',
    fontSize: 12,
  },
  priceValue: {
    color: colors.textInverse,
    fontSize: 13,
    fontWeight: '700',
  },
  priceDivider: {
    height: 1,
    backgroundColor: '#1F2937',
    marginVertical: spacing.xs,
  },
  grandTotalLabel: {
    color: colors.textInverse,
    fontSize: 15,
    fontWeight: '800',
  },
  grandTotalValue: {
    color: colors.textInverse,
    fontSize: 20,
    fontWeight: '900',
  },
  serverNote: {
    fontSize: 11,
    color: colors.textMuted,
    lineHeight: 16,
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
    textAlign: 'center',
  },
  primaryButton: {
    width: '100%',
    minHeight: 52,
    paddingVertical: spacing.lg,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    ...shadows.sm,
  },
  primaryButtonText: {
    color: colors.textInverse,
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    marginTop: spacing.md,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
});