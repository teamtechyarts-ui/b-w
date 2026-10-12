import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import AppIcon from '../components/AppIcon';
import OrderStatusBadge from '../components/OrderStatusBadge';
import {
  borderRadius,
  colors,
  shadows,
  spacing,
  typography,
} from '../theme/designSystem';
import {getOrders} from '../services/ordersApi';
import {
  CLAIM_TYPES,
  getOrderClaims,
  type ClaimType,
  type CustomerClaim,
} from '../services/claimsApi';
import {getPaymentSummary, type PaymentSummary} from '../services/paymentsApi';
import type {CustomerOrder} from '../types/order';
import {useCustomerRealtime} from '../hooks/useRealtime';
import {formatMoney} from '../utils/orderPricing';

type Props = {
  accessToken: string;
  onBack: () => void;
  onOpenOrder: (orderId: string) => void;
};

type TabType = 'all' | 'claims' | 'refunds' | 'cancellations';

type EnrichedClaim = CustomerClaim & {
  orderId: string;
  orderNumber: string;
  orderStatus: string;
};

type EnrichedRefund = {
  refundRequestId: string;
  amount: number;
  reason: string;
  status: string;
  cancellation: boolean;
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  created_at?: string;
};

type EnrichedCancellation = {
  id: string;
  orderNumber: string;
  current_status: string;
  total_amount: number | string;
  reason?: string | null;
  cancelled_at?: string | null;
  itemCount: number;
};

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

function claimStatusLabel(status: string) {
  switch (status) {
    case 'submitted':
      return 'Submitted';
    case 'under_review':
      return 'Under Review';
    case 'approved':
      return 'Approved';
    case 'rejected':
      return 'Rejected';
    case 'resolved':
      return 'Resolved';
    default:
      return status.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
  }
}

function claimTypeLabel(type: ClaimType) {
  const match = CLAIM_TYPES.find(t => t.value === type);
  return match?.label || type.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
}

function refundStatusLabel(status: string) {
  switch (status) {
    case 'requested':
      return 'Requested';
    case 'approved':
      return 'Approved';
    case 'processing':
      return 'Processing';
    case 'completed':
    case 'processed':
      return 'Completed';
    case 'rejected':
      return 'Rejected';
    case 'failed':
      return 'Failed';
    default:
      return status.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
  }
}

export default function ClaimsRefundsScreen({
  accessToken,
  onBack,
  onOpenOrder,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const [claims, setClaims] = useState<EnrichedClaim[]>([]);
  const [refunds, setRefunds] = useState<EnrichedRefund[]>([]);
  const [cancellations, setCancellations] = useState<EnrichedCancellation[]>([]);

  const loadData = useCallback(
    async (isRefresh = false) => {
      try {
        if (isRefresh) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }
        setError('');
        const rawOrders = await getOrders(accessToken);
        if (!Array.isArray(rawOrders)) {
          throw new Error('Unable to load orders.');
        }
        const orders: CustomerOrder[] = rawOrders;

        const allClaims: EnrichedClaim[] = [];
        const allRefunds: EnrichedRefund[] = [];
        const allCancellations: EnrichedCancellation[] = [];

        // Identify cancelled orders
        for (const order of orders) {
          const orderNumber = order.order_number || order.id.slice(0, 8);
          if (order.current_status === 'cancelled') {
            const cancelHistoryItem = (order.order_status_history ?? []).find(
              h => h.to_status === 'cancelled' || h.new_status === 'cancelled',
            );
            const itemCount = (order.order_items ?? []).reduce(
              (sum, item) => sum + Number(item.quantity || 0),
              0,
            );
            allCancellations.push({
              id: order.id,
              orderNumber,
              current_status: order.current_status,
              total_amount: order.total_amount,
              reason: cancelHistoryItem?.reason || 'Customer cancelled',
              cancelled_at: cancelHistoryItem?.created_at || order.updated_at || order.created_at,
              itemCount,
            });
          }
        }

        // Fetch claims and payment summaries for all orders in parallel
        await Promise.allSettled(
          orders.map(async order => {
            const orderNumber = order.order_number || order.id.slice(0, 8);

            // Fetch claims
            try {
              const orderClaims = await getOrderClaims(accessToken, order.id);
              if (Array.isArray(orderClaims) && orderClaims.length > 0) {
                for (const c of orderClaims) {
                  allClaims.push({
                    ...c,
                    orderId: order.id,
                    orderNumber,
                    orderStatus: order.current_status,
                  });
                }
              }
            } catch {
              // Order may have no claims or endpoint error; proceed gracefully
            }

            // Fetch refund summary
            try {
              const paymentSummary: PaymentSummary = await getPaymentSummary(
                accessToken,
                order.id,
              );
              if (
                paymentSummary &&
                Array.isArray(paymentSummary.refunds) &&
                paymentSummary.refunds.length > 0
              ) {
                for (const r of paymentSummary.refunds) {
                  allRefunds.push({
                    ...r,
                    orderId: order.id,
                    orderNumber,
                    orderStatus: order.current_status,
                  });
                }
              }
            } catch {
              // Order may have no payments/refunds; proceed gracefully
            }
          }),
        );

        // Sort claims by created date descending
        allClaims.sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );

        setClaims(allClaims);
        setRefunds(allRefunds);
        setCancellations(allCancellations);
        setError('');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Unable to load claims & refunds.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [accessToken],
  );

  useCustomerRealtime(
    null,
    useCallback(() => {
      loadData(true);
    }, [loadData]),
    accessToken,
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  const totalClaimsCount = claims.length;
  const totalRefundsCount = refunds.length;
  const totalCancellationsCount = cancellations.length;

  const totalItemsCount =
    totalClaimsCount + totalRefundsCount + totalCancellationsCount;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={styles.backBtn}
          onPress={onBack}>
          <View style={styles.backRow}>
            <AppIcon name="arrow-left" size={16} color={colors.textPrimary} />
            <Text style={styles.backText}>Back</Text>
          </View>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Claims & refunds</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadData(true)}
            tintColor={colors.primary}
          />
        }>
        {/* Title Section */}
        <View style={styles.titleSection}>
          <Text style={styles.pageTitle}>Claims & Refunds</Text>
          <Text style={styles.pageSubtitle}>
            Track your order issues, claim resolutions, refunds, and cancellations.
          </Text>
        </View>

        {/* Summary Metrics */}
        <View style={styles.metricsRow}>
          <TouchableOpacity
            style={[
              styles.metricCard,
              activeTab === 'claims' && styles.metricCardActive,
            ]}
            onPress={() => setActiveTab('claims')}
            accessibilityRole="button"
            accessibilityLabel={`${totalClaimsCount} Claims`}>
            <Text style={styles.metricNumber}>{totalClaimsCount}</Text>
            <Text style={styles.metricLabel}>Claims</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.metricCard,
              activeTab === 'refunds' && styles.metricCardActive,
            ]}
            onPress={() => setActiveTab('refunds')}
            accessibilityRole="button"
            accessibilityLabel={`${totalRefundsCount} Refunds`}>
            <Text style={styles.metricNumber}>{totalRefundsCount}</Text>
            <Text style={styles.metricLabel}>Refunds</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.metricCard,
              activeTab === 'cancellations' && styles.metricCardActive,
            ]}
            onPress={() => setActiveTab('cancellations')}
            accessibilityRole="button"
            accessibilityLabel={`${totalCancellationsCount} Cancellations`}>
            <Text style={styles.metricNumber}>{totalCancellationsCount}</Text>
            <Text style={styles.metricLabel}>Cancellations</Text>
          </TouchableOpacity>
        </View>

        {/* Filter Tabs */}
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'all' && styles.tabButtonActive]}
            onPress={() => setActiveTab('all')}
            accessibilityRole="button"
            accessibilityLabel="All items tab">
            <Text
              style={[
                styles.tabButtonText,
                activeTab === 'all' && styles.tabButtonTextActive,
              ]}>
              All ({totalItemsCount})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.tabButton,
              activeTab === 'claims' && styles.tabButtonActive,
            ]}
            onPress={() => setActiveTab('claims')}
            accessibilityRole="button"
            accessibilityLabel="Claims tab">
            <Text
              style={[
                styles.tabButtonText,
                activeTab === 'claims' && styles.tabButtonTextActive,
              ]}>
              Claims ({totalClaimsCount})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.tabButton,
              activeTab === 'refunds' && styles.tabButtonActive,
            ]}
            onPress={() => setActiveTab('refunds')}
            accessibilityRole="button"
            accessibilityLabel="Refunds tab">
            <Text
              style={[
                styles.tabButtonText,
                activeTab === 'refunds' && styles.tabButtonTextActive,
              ]}>
              Refunds ({totalRefundsCount})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.tabButton,
              activeTab === 'cancellations' && styles.tabButtonActive,
            ]}
            onPress={() => setActiveTab('cancellations')}
            accessibilityRole="button"
            accessibilityLabel="Cancellations tab">
            <Text
              style={[
                styles.tabButtonText,
                activeTab === 'cancellations' && styles.tabButtonTextActive,
              ]}>
              Cancellations ({totalCancellationsCount})
            </Text>
          </TouchableOpacity>
        </View>

        {/* Error State */}
        {error ? (
          <View style={styles.errorBox} accessibilityRole="alert">
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity
              testID="retry-button"
              style={styles.retryBtn}
              onPress={() => loadData()}
              accessibilityRole="button"
              accessibilityLabel="Try again">
              <Text style={styles.retryBtnText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Loading Indicator */}
        {loading && !refreshing ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Loading claims & refunds...</Text>
          </View>
        ) : null}

        {/* Content Lists */}
        {!loading && !error ? (
          <View style={styles.contentSection}>
            {/* Claims Section */}
            {(activeTab === 'all' || activeTab === 'claims') && claims.length > 0 ? (
              <View style={styles.groupSection}>
                <Text style={styles.groupTitle}>Claims ({claims.length})</Text>
                {claims.map(claim => {
                  const photoCount = claim.customer_claim_photos?.length || 0;
                  return (
                    <TouchableOpacity
                      key={claim.id}
                      style={styles.card}
                      activeOpacity={0.7}
                      onPress={() => onOpenOrder(claim.orderId)}
                      accessibilityRole="button"
                      accessibilityLabel={`Claim for order ${claim.orderNumber}, ${claimTypeLabel(claim.claim_type)}, Status ${claimStatusLabel(claim.status)}`}>
                      <View style={styles.cardTopRow}>
                        <View style={styles.orderLabelContainer}>
                          <Text style={styles.cardOrderLabel}>ORDER</Text>
                          <Text style={styles.cardOrderNumber}>
                            {claim.orderNumber}
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.statusBadge,
                            claim.status === 'approved' || claim.status === 'resolved'
                              ? styles.statusBadgeSuccess
                              : claim.status === 'rejected'
                              ? styles.statusBadgeDanger
                              : styles.statusBadgeWarning,
                          ]}>
                          <Text
                            style={[
                              styles.statusBadgeText,
                              claim.status === 'approved' || claim.status === 'resolved'
                                ? styles.statusBadgeTextSuccess
                                : claim.status === 'rejected'
                                ? styles.statusBadgeTextDanger
                                : styles.statusBadgeTextWarning,
                            ]}>
                            {claimStatusLabel(claim.status)}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.cardDivider} />

                      <View style={styles.cardBody}>
                        <Text style={styles.claimType}>
                          {claimTypeLabel(claim.claim_type)}
                        </Text>
                        <Text style={styles.claimDescription} numberOfLines={3}>
                          {claim.description}
                        </Text>

                        <View style={styles.cardMetaRow}>
                          <Text style={styles.cardMetaText}>
                            Submitted on {formatShortDate(claim.created_at)}
                          </Text>
                          {photoCount > 0 ? (
                            <View style={styles.photoCountBadge}>
                              <Text style={styles.photoCountText}>
                                {photoCount} {photoCount === 1 ? 'Photo' : 'Photos'}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                      </View>

                      <View style={styles.cardFooter}>
                        <Text style={styles.actionLink}>View Order & Claim Details</Text>
                        <AppIcon
                          name="arrow-right"
                          size={14}
                          color={colors.primary}
                          strokeWidth={2.5}
                        />
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}

            {/* Refunds Section */}
            {(activeTab === 'all' || activeTab === 'refunds') && refunds.length > 0 ? (
              <View style={styles.groupSection}>
                <Text style={styles.groupTitle}>Refunds ({refunds.length})</Text>
                {refunds.map((refund, idx) => (
                  <TouchableOpacity
                    key={refund.refundRequestId || `refund-${idx}`}
                    style={styles.card}
                    activeOpacity={0.7}
                    onPress={() => onOpenOrder(refund.orderId)}
                    accessibilityRole="button"
                    accessibilityLabel={`Refund for order ${refund.orderNumber}, Amount ₹${formatMoney(refund.amount)}, Status ${refundStatusLabel(refund.status)}`}>
                    <View style={styles.cardTopRow}>
                      <View style={styles.orderLabelContainer}>
                        <Text style={styles.cardOrderLabel}>ORDER</Text>
                        <Text style={styles.cardOrderNumber}>
                          {refund.orderNumber}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.statusBadge,
                          refund.status === 'completed' || refund.status === 'processed'
                            ? styles.statusBadgeSuccess
                            : refund.status === 'rejected' || refund.status === 'failed'
                            ? styles.statusBadgeDanger
                            : styles.statusBadgeInfo,
                        ]}>
                        <Text
                          style={[
                            styles.statusBadgeText,
                            refund.status === 'completed' || refund.status === 'processed'
                              ? styles.statusBadgeTextSuccess
                              : refund.status === 'rejected' || refund.status === 'failed'
                              ? styles.statusBadgeTextDanger
                              : styles.statusBadgeTextInfo,
                          ]}>
                          {refundStatusLabel(refund.status)}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.cardDivider} />

                    <View style={styles.cardBody}>
                      <View style={styles.refundAmountRow}>
                        <Text style={styles.refundAmountLabel}>Refund Amount</Text>
                        <Text style={styles.refundAmountValue}>
                          ₹{formatMoney(refund.amount)}
                        </Text>
                      </View>
                      {refund.reason ? (
                        <Text style={styles.claimDescription} numberOfLines={2}>
                          Reason: {refund.reason}
                        </Text>
                      ) : null}
                    </View>

                    <View style={styles.cardFooter}>
                      <Text style={styles.actionLink}>View Order & Refund Details</Text>
                      <AppIcon
                        name="arrow-right"
                        size={14}
                        color={colors.primary}
                        strokeWidth={2.5}
                      />
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            {/* Cancellations Section */}
            {(activeTab === 'all' || activeTab === 'cancellations') &&
            cancellations.length > 0 ? (
              <View style={styles.groupSection}>
                <Text style={styles.groupTitle}>
                  Cancellations ({cancellations.length})
                </Text>
                {cancellations.map(cancellation => (
                  <TouchableOpacity
                    key={cancellation.id}
                    style={styles.card}
                    activeOpacity={0.7}
                    onPress={() => onOpenOrder(cancellation.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Cancelled order ${cancellation.orderNumber}, Total ₹${formatMoney(cancellation.total_amount)}`}>
                    <View style={styles.cardTopRow}>
                      <View style={styles.orderLabelContainer}>
                        <Text style={styles.cardOrderLabel}>ORDER</Text>
                        <Text style={styles.cardOrderNumber}>
                          {cancellation.orderNumber}
                        </Text>
                      </View>
                      <OrderStatusBadge status={cancellation.current_status} />
                    </View>

                    <View style={styles.cardDivider} />

                    <View style={styles.cardBody}>
                      <View style={styles.refundAmountRow}>
                        <Text style={styles.refundAmountLabel}>Order Total</Text>
                        <Text style={styles.refundAmountValue}>
                          ₹{formatMoney(cancellation.total_amount)}
                        </Text>
                      </View>
                      {cancellation.reason ? (
                        <Text style={styles.claimDescription} numberOfLines={2}>
                          Reason: {cancellation.reason}
                        </Text>
                      ) : null}
                      <Text style={styles.cardMetaText}>
                        Cancelled on {formatShortDate(cancellation.cancelled_at)}
                      </Text>
                    </View>

                    <View style={styles.cardFooter}>
                      <Text style={styles.actionLink}>View Cancelled Order</Text>
                      <AppIcon
                        name="arrow-right"
                        size={14}
                        color={colors.primary}
                        strokeWidth={2.5}
                      />
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            {/* Empty States */}
            {activeTab === 'all' && totalItemsCount === 0 ? (
              <View style={styles.emptyStateContainer}>
                <AppIcon name="shield" size={48} color={colors.textSubtle} />
                <Text style={styles.emptyStateTitle}>No Claims or Issues</Text>
                <Text style={styles.emptyStateSubtitle}>
                  You haven't submitted any claims, refund requests, or cancellations.
                  If you need assistance with an active or delivered order, open Your Orders
                  and tap Order Help.
                </Text>
              </View>
            ) : null}

            {activeTab === 'claims' && claims.length === 0 ? (
              <View style={styles.emptyStateContainer}>
                <AppIcon name="shield" size={48} color={colors.textSubtle} />
                <Text style={styles.emptyStateTitle}>No Claims Submitted</Text>
                <Text style={styles.emptyStateSubtitle}>
                  If you received a delivered order with missing or damaged items, you can raise a
                  claim directly from the order details screen.
                </Text>
              </View>
            ) : null}

            {activeTab === 'refunds' && refunds.length === 0 ? (
              <View style={styles.emptyStateContainer}>
                <AppIcon name="card" size={48} color={colors.textSubtle} />
                <Text style={styles.emptyStateTitle}>No Refunds</Text>
                <Text style={styles.emptyStateSubtitle}>
                  You have no pending or completed refund requests.
                </Text>
              </View>
            ) : null}

            {activeTab === 'cancellations' && cancellations.length === 0 ? (
              <View style={styles.emptyStateContainer}>
                <AppIcon name="close" size={48} color={colors.textSubtle} />
                <Text style={styles.emptyStateTitle}>No Cancellations</Text>
                <Text style={styles.emptyStateSubtitle}>
                  You haven't cancelled any orders.
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  backBtn: {
    paddingVertical: spacing.xs,
    paddingRight: spacing.sm,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  backText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  headerSpacer: {
    width: 48,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: 40,
  },
  titleSection: {
    marginBottom: spacing.lg,
  },
  pageTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  pageSubtitle: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 4,
    lineHeight: 20,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  metricCard: {
    flex: 1,
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    ...shadows.sm,
  },
  metricCardActive: {
    borderColor: colors.primary,
    backgroundColor: '#F3F4F6',
  },
  metricNumber: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  metricLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    marginTop: 2,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: 3,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  tabButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: borderRadius.sm,
  },
  tabButtonActive: {
    backgroundColor: colors.primary,
  },
  tabButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  tabButtonTextActive: {
    color: colors.textInverse,
    fontWeight: '700',
  },
  loadingContainer: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: spacing.md,
  },
  loadingText: {
    fontSize: 14,
    color: colors.textMuted,
  },
  errorBox: {
    backgroundColor: colors.dangerSurface,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  errorText: {
    flex: 1,
    color: colors.dangerText,
    fontSize: 13,
    fontWeight: '500',
  },
  retryBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    backgroundColor: colors.danger,
    borderRadius: borderRadius.xs,
    marginLeft: spacing.sm,
  },
  retryBtnText: {
    color: colors.textInverse,
    fontSize: 12,
    fontWeight: '600',
  },
  contentSection: {
    gap: spacing.xl,
  },
  groupSection: {
    gap: spacing.md,
  },
  groupTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    ...shadows.sm,
    gap: spacing.sm,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  orderLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  cardOrderLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSubtle,
    letterSpacing: 0.5,
  },
  cardOrderNumber: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  cardDivider: {
    height: 1,
    backgroundColor: colors.border,
  },
  cardBody: {
    gap: 6,
  },
  claimType: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  claimDescription: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  cardMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  cardMetaText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  photoCountBadge: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  photoCountText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#1E40AF',
  },
  refundAmountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  refundAmountLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  refundAmountValue: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 4,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionLink: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: borderRadius.sm,
  },
  statusBadgeSuccess: {
    backgroundColor: colors.successSurface,
    borderWidth: 1,
    borderColor: colors.successBorder,
  },
  statusBadgeWarning: {
    backgroundColor: colors.warningSurface,
    borderWidth: 1,
    borderColor: colors.warningBorder,
  },
  statusBadgeDanger: {
    backgroundColor: colors.dangerSurface,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  statusBadgeInfo: {
    backgroundColor: colors.infoSurface,
    borderWidth: 1,
    borderColor: colors.infoBorder,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  statusBadgeTextSuccess: {
    color: colors.successText,
  },
  statusBadgeTextWarning: {
    color: colors.warningText,
  },
  statusBadgeTextDanger: {
    color: colors.dangerText,
  },
  statusBadgeTextInfo: {
    color: colors.infoText,
  },
  emptyStateContainer: {
    paddingVertical: 40,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  emptyStateTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: spacing.xs,
  },
  emptyStateSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
});
