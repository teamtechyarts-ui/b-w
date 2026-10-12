import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import AppIcon from '../components/AppIcon';
import { borderRadius, colors, shadows, spacing, typography } from '../theme/designSystem';
import type { SuccessfulOrder } from '../types/order';
import { formatMoney } from '../utils/orderPricing';

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
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(24)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 6,
        tension: 60,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 450,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 450,
        useNativeDriver: true,
      }),
    ]).start();
  }, [scaleAnim, fadeAnim, slideAnim]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        <Animated.View
          style={[
            styles.successIconWrapper,
            {
              transform: [{ scale: scaleAnim }],
            },
          ]}>
          <View style={styles.successIcon}>
            <AppIcon name="check" size={38} color={colors.textInverse} strokeWidth={3} />
          </View>
        </Animated.View>

        <Animated.View
          style={{
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
            width: '100%',
            alignItems: 'center',
          }}>
          <Text style={styles.title}>Order Placed Successfully!</Text>

          <Text style={styles.subtitle}>
            Your laundry order has been placed successfully.
          </Text>

          <View style={styles.card}>
            {order.orderNumber ? (
              <>
                <View style={styles.row}>
                  <Text style={styles.label}>Order Number</Text>
                  <View style={styles.orderNumberBadge}>
                    <Text style={styles.orderNumberText}>{order.orderNumber}</Text>
                  </View>
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
              <Text style={styles.label}>Pickup Schedule</Text>
              <View style={styles.right}>
                <Text style={styles.value}>{order.pickupDateLabel}</Text>
                {order.pickupSlotLabel ? (
                  <Text style={styles.subValue}>{order.pickupSlotLabel}</Text>
                ) : null}
              </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.row}>
              <Text style={styles.label}>Payment Method</Text>
              <Text style={styles.value}>
                {order.paymentMethod === 'cash_on_delivery'
                  ? 'Cash on Delivery (COD)'
                  : 'Online Payment'}
              </Text>
            </View>
          </View>

          <View style={styles.priceSection}>
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
          </View>

          <Text style={styles.serverNote}>
            These details were confirmed by the server for order #{order.orderNumber || order.id}.
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
        </Animated.View>
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
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xxxl,
  },
  successIconWrapper: {
    marginBottom: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successIcon: {
    width: 76,
    height: 76,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.lg,
  },
  title: {
    ...typography.h1,
    fontSize: 22,
    fontWeight: '800',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: spacing.xs,
    marginBottom: spacing.xl,
  },
  card: {
    width: '100%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.xl,
    ...shadows.sm,
  },
  orderNumberBadge: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  orderNumberText: {
    fontWeight: '800',
    color: colors.primary,
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 13,
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
    marginTop: 2,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'right',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  priceSection: {
    width: '100%',
    marginBottom: spacing.md,
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
    fontSize: 14,
    fontWeight: '800',
  },
  grandTotalValue: {
    color: colors.textInverse,
    fontSize: 16,
    fontWeight: '800',
  },
  serverNote: {
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.xl,
    marginTop: spacing.xs,
  },
  primaryButton: {
    width: '100%',
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    ...shadows.sm,
  },
  primaryButtonText: {
    color: colors.textInverse,
    fontWeight: '800',
    fontSize: 15,
  },
  secondaryButton: {
    width: '100%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: colors.textPrimary,
    fontWeight: '700',
    fontSize: 14,
  },
});