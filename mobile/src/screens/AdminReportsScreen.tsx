import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {
  AdminReport,
  AuditPage,
  ReportFilters,
  getAdminAudit,
  getAdminReport,
} from '../services/adminReportsApi';
import AppIcon from '../components/AppIcon';
import {colors, spacing, borderRadius, typography, shadows} from '../theme/designSystem';

type Props = {
  accessToken: string;
  onBack: () => void;
};

const today = new Date();
const initial: ReportFilters = {
  from: new Date(today.getTime() - 29 * 86400000).toISOString().slice(0, 10),
  to: today.toISOString().slice(0, 10),
  source: 'all',
  q: '',
  limit: 50,
  offset: 0,
};

const money = (value: number) => `₹${Number(value || 0).toFixed(2)}`;
const label = (value: string) => value.replace(/_/g, ' ');
const orderCount = (value: number) => `${value} ${value === 1 ? 'order' : 'orders'}`;

const sources = [
  'all',
  'staff',
  'assignments',
  'catalogue',
  'issues',
  'growth',
  'financial',
];

export default function AdminReportsScreen({accessToken, onBack}: Props) {
  const [draft, setDraft] = useState<ReportFilters>(initial);
  const [filters, setFilters] = useState<ReportFilters>(initial);
  const [report, setReport] = useState<AdminReport | null>(null);
  const [audit, setAudit] = useState<AuditPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestSequence = useRef(0);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError('');
    try {
      const [nextReport, nextAudit] = await Promise.all([
        getAdminReport(accessToken, filters),
        getAdminAudit(accessToken, filters),
      ]);
      if (sequence === requestSequence.current) {
        setReport(nextReport);
        setAudit(nextAudit);
      }
    } catch (cause) {
      if (sequence === requestSequence.current) {
        setError(cause instanceof Error ? cause.message : 'Admin reports unavailable.');
      }
    } finally {
      inFlight.current = false;
      if (sequence === requestSequence.current) {
        setLoading(false);
      }
    }
  }, [accessToken, filters]);

  useEffect(() => {
    load();
  }, [load]);

  const apply = () => {
    requestSequence.current += 1;
    setReport(null);
    setAudit(null);
    setFilters({...draft, offset: 0});
  };

  const page = (offset: number) => setFilters(current => ({...current, offset}));

  return (
    <SafeAreaView style={styles.page} edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Header Navigation */}
        <View style={styles.headerNav}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Back to admin dashboard"
            style={styles.backButton}
            onPress={onBack}>
            <AppIcon name="arrow-left" size={16} color={colors.primary} />
            <Text style={styles.link}>← Admin dashboard</Text>
          </TouchableOpacity>
          <View style={styles.titleGroup}>
            <Text style={styles.eyebrow}>INSIGHTS</Text>
            <Text style={styles.title}>Analytics & audit</Text>
          </View>
        </View>

        {/* Filter Controls Card */}
        <View style={styles.filterCard}>
          <Text style={styles.filterSectionTitle}>Date range (UTC, maximum 366 days)</Text>
          <View style={styles.dateRow}>
            <View style={styles.dateCol}>
              <Text style={styles.inputLabel}>From</Text>
              <TextInput
                accessibilityLabel="From date"
                style={styles.input}
                value={draft.from}
                onChangeText={from => setDraft({...draft, from})}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textSubtle}
              />
            </View>
            <View style={styles.dateCol}>
              <Text style={styles.inputLabel}>To</Text>
              <TextInput
                accessibilityLabel="To date"
                style={styles.input}
                value={draft.to}
                onChangeText={to => setDraft({...draft, to})}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textSubtle}
              />
            </View>
          </View>

          <View style={styles.searchGroup}>
            <Text style={styles.inputLabel}>Search Activity</Text>
            <TextInput
              accessibilityLabel="Search audit action, actor or entity"
              style={styles.input}
              value={draft.q || ''}
              onChangeText={q => setDraft({...draft, q})}
              placeholder="Search audit action, actor or entity"
              placeholderTextColor={colors.textSubtle}
            />
          </View>

          <View style={styles.sourceGroup}>
            <Text style={styles.inputLabel}>Audit source</Text>
            <View style={styles.wrap}>
              {sources.map(source => {
                const isSelected = source === draft.source;
                return (
                  <TouchableOpacity
                    key={source}
                    accessibilityRole="button"
                    accessibilityLabel={`Filter source ${source}`}
                    onPress={() => setDraft({...draft, source})}
                    style={[styles.chip, isSelected && styles.chipSelected]}>
                    <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                      {isSelected ? '● ' : ''}
                      {label(source)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Action Buttons */}
          <View style={styles.filterActions}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Apply report filters"
              disabled={loading}
              onPress={apply}
              style={[styles.primaryActionBtn, loading && styles.btnDisabled]}>
              <Text style={styles.primaryActionBtnText}>Apply report filters</Text>
            </TouchableOpacity>

            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Refresh reports"
              disabled={loading}
              onPress={load}
              style={[styles.secondaryActionBtn, loading && styles.btnDisabled]}>
              <Text style={styles.secondaryActionBtnText}>Refresh reports</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Loading Indicator */}
        {loading ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator
              accessibilityLabel="Loading Admin reports"
              color={colors.primary}
              size="large"
            />
            <Text style={styles.loadingText}>Loading analytics and audit records...</Text>
          </View>
        ) : null}

        {/* Error Alert */}
        {error ? (
          <View style={styles.errorCard} accessibilityRole="alert">
            <Text style={styles.error}>{error}</Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Retry reports"
              style={styles.retryBtn}
              onPress={load}>
              <Text style={styles.retryBtnText}>Retry reports</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {report ? (
          <>
            {/* Top Key Metrics Grid */}
            <View style={styles.metricGrid}>
              <View style={styles.metricGridCard}>
                <Text style={styles.metricGridLabel}>Net Revenue</Text>
                <Text style={styles.metricGridValue}>{money(report.revenue.netCaptured)}</Text>
                <Text style={styles.metricGridSub}>Gross {money(report.revenue.grossCaptured)}</Text>
              </View>

              <View style={styles.metricGridCard}>
                <Text style={styles.metricGridLabel}>Orders Placed</Text>
                <Text style={styles.metricGridValue}>{report.orders.created}</Text>
                <Text style={styles.metricGridSub}>Avg {money(report.orders.averageOrderValue)}</Text>
              </View>

              <View style={styles.metricGridCard}>
                <Text style={styles.metricGridLabel}>Non-Cancelled</Text>
                <Text style={styles.metricGridValue}>{money(report.orders.nonCancelledValue)}</Text>
                <Text style={styles.metricGridSub}>{report.orders.delivered} delivered</Text>
              </View>

              <View style={styles.metricGridCard}>
                <Text style={styles.metricGridLabel}>Refunds & Claims</Text>
                <Text style={styles.metricGridValue}>{money(report.revenue.refunded)}</Text>
                <Text style={styles.metricGridSub}>{report.claims.created} claims opened</Text>
              </View>
            </View>

            {/* Revenue & Orders Breakdown Card */}
            <View style={styles.sectionCard}>
              <Text style={styles.heading}>
                Revenue and orders · {report.range.from} to {report.range.to}
              </Text>

              <View style={styles.breakdownGrid}>
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>Gross captured online</Text>
                  <Text style={styles.breakdownValue}>{money(report.revenue.grossCaptured)}</Text>
                </View>

                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>Completed refunds</Text>
                  <Text style={styles.breakdownValue}>{money(report.revenue.refunded)}</Text>
                </View>

                <View style={[styles.breakdownRow, styles.breakdownRowHighlight]}>
                  <Text style={styles.breakdownLabelHighlight}>Net captured</Text>
                  <Text style={styles.breakdownValueHighlight}>
                    Net captured {money(report.revenue.netCaptured)}
                  </Text>
                </View>

                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>Orders placed</Text>
                  <Text style={styles.breakdownValue}>
                    Orders placed {report.orders.created} · Average order value{' '}
                    {money(report.orders.averageOrderValue)}
                  </Text>
                </View>

                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>Non-cancelled value</Text>
                  <Text style={styles.breakdownValue}>
                    Non-cancelled order value {money(report.orders.nonCancelledValue)}
                  </Text>
                </View>

                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>Order statuses</Text>
                  <Text style={styles.breakdownValue}>
                    Cancellations {report.orders.cancellations} · Ready{' '}
                    {report.orders.readyForDelivery} · Delivered {report.orders.delivered}
                  </Text>
                </View>

                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>Claims & Refunds</Text>
                  <Text style={styles.breakdownValue}>
                    Claims opened {report.claims.created} · Refunds completed{' '}
                    {report.refunds.completed}
                  </Text>
                </View>
              </View>

              <Text style={styles.note}>
                {report.definitions.revenue} {report.definitions.orderValue}
              </Text>
            </View>

            {/* Order Trends */}
            <View style={styles.sectionCard}>
              <Text style={styles.heading}>Order trends</Text>
              {report.trend.length ? (
                <View style={styles.trendList}>
                  {report.trend.map(item => (
                    <View key={item.date} style={styles.trendRow}>
                      <View style={styles.trendLeft}>
                        <Text style={styles.bold}>{item.date}</Text>
                        <Text style={styles.trendSub}>
                          {orderCount(item.orders)} · {money(item.orderValue)} order value
                        </Text>
                      </View>
                      <Text style={styles.trendValue}>
                        {money(item.captured)} captured
                        {item.refunded ? ` · ${money(item.refunded)} refunded` : ''}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.emptyText}>No activity in this period.</Text>
              )}
            </View>

            {/* Drivers and Facilities */}
            <View style={styles.sectionCard}>
              <Text style={styles.heading}>Drivers and facilities</Text>
              <View style={styles.cardHighlightBox}>
                <Text style={styles.cardHighlightLine}>
                  Driver jobs assigned {report.drivers.assigned} · Completed{' '}
                  {report.drivers.completed}
                </Text>
                <Text style={styles.cardHighlightLine}>
                  Facility receipts {report.facilities.received} · Processing stages completed{' '}
                  {report.facilities.completedStages}
                </Text>
                <Text style={styles.cardHighlightLine}>
                  Active Facility orders {report.facilities.activeOrders} · Average processing age{' '}
                  {report.facilities.averageProcessingAgeHours}h · Over 24h{' '}
                  {report.facilities.stuckOver24Hours}
                </Text>
              </View>

              {report.drivers.byDriver.length > 0 ? (
                <View style={styles.subList}>
                  <Text style={styles.subListTitle}>Driver Performance</Text>
                  {report.drivers.byDriver.map((item, index) => (
                    <Text key={item.driverId} style={styles.subListItem}>
                      Driver {index + 1}: {item.assigned} assigned · {item.accepted} accepted ·{' '}
                      {item.completed} completed
                    </Text>
                  ))}
                </View>
              ) : null}

              {report.facilities.byFacility.length > 0 ? (
                <View style={styles.subList}>
                  <Text style={styles.subListTitle}>Facility Performance</Text>
                  {report.facilities.byFacility.map((item, index) => (
                    <Text key={item.facilityId} style={styles.subListItem}>
                      Facility {index + 1}: {item.received} received · {item.completedStages}{' '}
                      stages · {item.activeOrders} active
                    </Text>
                  ))}
                </View>
              ) : null}

              <Text style={styles.note}>{report.definitions.processingAge}</Text>
            </View>

            {/* Growth Programs */}
            <View style={styles.sectionCard}>
              <Text style={styles.heading}>Growth programs</Text>
              <View style={styles.growthGrid}>
                <View style={styles.growthItem}>
                  <Text style={styles.growthTitle}>Coupons</Text>
                  <Text style={styles.growthText}>
                    Coupon uses {report.growth.couponRedemptions} · Discount{' '}
                    {money(report.growth.couponDiscount)}
                  </Text>
                </View>
                <View style={styles.growthItem}>
                  <Text style={styles.growthTitle}>Loyalty</Text>
                  <Text style={styles.growthText}>
                    Loyalty earned {report.growth.loyaltyEarnedPoints} points · Redeemed{' '}
                    {report.growth.loyaltyRedeemedPoints} points
                  </Text>
                </View>
                <View style={styles.growthItem}>
                  <Text style={styles.growthTitle}>Packages</Text>
                  <Text style={styles.growthText}>
                    Packages purchased {report.growth.packagesPurchased} · Uses{' '}
                    {report.growth.packageUses} · Units {report.growth.packageUnitsUsed}
                  </Text>
                </View>
                <View style={styles.growthItem}>
                  <Text style={styles.growthTitle}>Referrals</Text>
                  <Text style={styles.growthText}>
                    Referrals {report.growth.referrals} · Rewards {report.growth.referralRewards}
                  </Text>
                </View>
              </View>
            </View>
          </>
        ) : null}

        {/* Audit Trail Section */}
        {audit ? (
          <View style={styles.sectionCard}>
            <Text style={styles.heading}>Admin action history · {audit.total} events</Text>
            {audit.events.length ? (
              <View style={styles.auditList}>
                {audit.events.map(item => (
                  <View key={`${item.source}-${item.id}`} style={styles.auditCard}>
                    <View style={styles.auditTopRow}>
                      <View style={styles.sourcePill}>
                        <Text style={styles.sourcePillText}>{label(item.source).toUpperCase()}</Text>
                      </View>
                      <Text style={styles.auditTime}>
                        {new Date(item.createdAt).toLocaleString('en-IN')}
                      </Text>
                    </View>
                    <Text style={styles.bold}>
                      {label(item.source)} · {label(item.action)}
                    </Text>
                    <Text style={styles.auditActor}>
                      {item.actorId
                        ? 'Performed by an administrator'
                        : 'Automated system action'}
                      {item.entityId ? ' · Related record available' : ''}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.emptyText}>No audit events match these filters.</Text>
            )}

            {/* Pagination Controls */}
            <View style={styles.paginationRow}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Previous audit page"
                disabled={audit.offset === 0}
                onPress={() => page(Math.max(0, audit.offset - audit.limit))}
                style={[styles.pageBtn, audit.offset === 0 && styles.pageBtnDisabled]}>
                <Text style={[styles.pageBtnText, audit.offset === 0 && styles.pageBtnTextDisabled]}>
                  Previous audit page
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Next audit page"
                disabled={audit.offset + audit.limit >= audit.total}
                onPress={() => page(audit.offset + audit.limit)}
                style={[
                  styles.pageBtn,
                  audit.offset + audit.limit >= audit.total && styles.pageBtnDisabled,
                ]}>
                <Text
                  style={[
                    styles.pageBtnText,
                    audit.offset + audit.limit >= audit.total && styles.pageBtnTextDisabled,
                  ]}>
                  Next audit page
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  headerNav: {
    gap: 4,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  link: {
    fontSize: typography.body.fontSize,
    fontWeight: '700',
    color: colors.primary,
  },
  titleGroup: {
    marginTop: 4,
  },
  eyebrow: {
    fontSize: typography.caption.fontSize,
    letterSpacing: 1.4,
    fontWeight: '800',
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: typography.h1.fontSize,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  heading: {
    fontSize: typography.h3.fontSize,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  filterCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
    ...shadows.sm,
  },
  filterSectionTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  dateRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  dateCol: {
    flex: 1,
    gap: 4,
  },
  inputLabel: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
    fontSize: typography.body.fontSize,
    color: colors.textPrimary,
    minHeight: 44,
  },
  searchGroup: {
    gap: 4,
  },
  sourceGroup: {
    gap: 6,
  },
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSubtle,
    borderRadius: borderRadius.full,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 36,
    justifyContent: 'center',
  },
  chipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'capitalize',
  },
  chipTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  filterActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  primaryActionBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.sm,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  primaryActionBtnText: {
    color: '#FFFFFF',
    fontSize: typography.body.fontSize,
    fontWeight: '700',
  },
  secondaryActionBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  secondaryActionBtnText: {
    color: colors.textPrimary,
    fontSize: typography.body.fontSize,
    fontWeight: '700',
  },
  btnDisabled: {
    opacity: 0.5,
  },
  loadingCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  loadingText: {
    fontSize: typography.body.fontSize,
    color: colors.textSecondary,
  },
  errorCard: {
    backgroundColor: colors.dangerSurface,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  error: {
    fontSize: typography.body.fontSize,
    color: colors.dangerText,
    fontWeight: '600',
  },
  retryBtn: {
    backgroundColor: colors.danger,
    borderRadius: borderRadius.sm,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
    minHeight: 40,
    justifyContent: 'center',
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: typography.body.fontSize,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  metricGridCard: {
    flex: 1,
    minWidth: '47%',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 2,
    ...shadows.sm,
  },
  metricGridLabel: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  metricGridValue: {
    fontSize: typography.h2.fontSize,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  metricGridSub: {
    fontSize: typography.caption.fontSize,
    color: colors.textSubtle,
    fontWeight: '500',
    marginTop: 2,
  },
  sectionCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
    ...shadows.sm,
  },
  breakdownGrid: {
    gap: 8,
  },
  breakdownRow: {
    flexDirection: 'column',
    gap: 2,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceSubtle,
  },
  breakdownRowHighlight: {
    backgroundColor: colors.surfaceSubtle,
    padding: spacing.sm,
    borderRadius: borderRadius.sm,
    borderBottomWidth: 0,
  },
  breakdownLabel: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  breakdownLabelHighlight: {
    fontSize: typography.caption.fontSize,
    color: colors.primary,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  breakdownValue: {
    fontSize: typography.body.fontSize,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  breakdownValueHighlight: {
    fontSize: typography.h3.fontSize,
    color: colors.primary,
    fontWeight: '800',
  },
  trendList: {
    gap: spacing.xs,
  },
  trendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.sm,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surfaceSubtle,
    gap: spacing.xs,
  },
  trendLeft: {
    flex: 1,
  },
  trendSub: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    marginTop: 2,
  },
  trendValue: {
    fontSize: typography.body.fontSize,
    fontWeight: '700',
    color: colors.success,
  },
  bold: {
    fontWeight: '700',
    fontSize: typography.body.fontSize,
    color: colors.textPrimary,
  },
  cardHighlightBox: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
    gap: 6,
  },
  cardHighlightLine: {
    fontSize: typography.body.fontSize,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  subList: {
    marginTop: spacing.xs,
    gap: 4,
  },
  subListTitle: {
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  subListItem: {
    fontSize: typography.body.fontSize,
    color: colors.textPrimary,
  },
  note: {
    fontSize: typography.caption.fontSize,
    color: colors.textSubtle,
    fontStyle: 'italic',
    marginTop: 4,
  },
  growthGrid: {
    gap: spacing.xs,
  },
  growthItem: {
    padding: spacing.sm,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surfaceSubtle,
    gap: 2,
  },
  growthTitle: {
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    color: colors.primary,
    textTransform: 'uppercase',
  },
  growthText: {
    fontSize: typography.body.fontSize,
    color: colors.textPrimary,
  },
  emptyText: {
    fontSize: typography.body.fontSize,
    color: colors.textSecondary,
    fontStyle: 'italic',
    paddingVertical: spacing.sm,
  },
  auditList: {
    gap: spacing.xs,
  },
  auditCard: {
    padding: spacing.sm,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surfaceSubtle,
    gap: 4,
  },
  auditTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sourcePill: {
    backgroundColor: colors.border,
    borderRadius: borderRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  sourcePillText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  auditTime: {
    fontSize: typography.caption.fontSize,
    color: colors.textSubtle,
  },
  auditActor: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  paginationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  pageBtn: {
    flex: 1,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    minHeight: 44,
  },
  pageBtnDisabled: {
    opacity: 0.4,
  },
  pageBtnText: {
    fontSize: typography.body.fontSize,
    fontWeight: '700',
    color: colors.primary,
  },
  pageBtnTextDisabled: {
    color: colors.textSubtle,
  },
});
