import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {AdminDashboard, getAdminDashboard} from '../services/adminDashboardApi';
import AppIcon, {IconName} from '../components/AppIcon';

type Props = {
  accessToken: string;
  onLogout: () => Promise<void>;
  onCustomers?: () => void;
  onStaff?: () => void;
  onAssignments?: () => void;
  onCatalogue?: () => void;
  onIssues?: () => void;
  onGrowth?: () => void;
  onFacilities?: () => void;
  onReports?: () => void;
  onLocations?: () => void;
};

type ActionCardProps = {
  iconName: IconName;
  title: string;
  description: string;
  badge?: string | number;
  onPress?: () => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
};

function ActionCard({
  iconName,
  title,
  description,
  badge,
  onPress,
  accessibilityLabel,
  accessibilityHint,
}: ActionCardProps) {
  if (!onPress) return null;

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      activeOpacity={0.7}
      style={styles.actionCard}
      onPress={onPress}>
      <View style={styles.actionCardIconBox}>
        <AppIcon name={iconName} size={20} color="#111827" />
      </View>
      <View style={styles.actionCardContent}>
        <View style={styles.actionCardTitleRow}>
          <Text style={styles.actionCardTitle}>{title}</Text>
          {badge !== undefined && badge !== 0 && (
            <View style={styles.actionBadge}>
              <Text style={styles.actionBadgeText}>{badge}</Text>
            </View>
          )}
        </View>
        <Text style={styles.actionCardDescription} numberOfLines={2}>
          {description}
        </Text>
      </View>
      <Text style={styles.actionCardArrow}>→</Text>
    </TouchableOpacity>
  );
}

const statusLabel = (value: string) =>
  value
    .split('_')
    .map(part =>
      part.toLowerCase() === 'otp'
        ? 'OTP'
        : `${part.charAt(0).toUpperCase()}${part.slice(1)}`,
    )
    .join(' ');

export default function AdminDashboardScreen({
  accessToken,
  onLogout,
  onCustomers,
  onStaff,
  onAssignments,
  onCatalogue,
  onIssues,
  onGrowth,
  onFacilities,
  onReports,
  onLocations,
}: Props) {
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [showAllStatuses, setShowAllStatuses] = useState(false);

  const load = useCallback(
    async (refresh = false) => {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError('');
      try {
        setDashboard(await getAdminDashboard(accessToken));
      } catch (cause) {
        setDashboard(null);
        setError(
          cause instanceof Error
            ? cause.message
            : 'Admin dashboard unavailable.',
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [accessToken],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Group orders into Pickup, Facility, Delivery stages
  const orderFlow = useMemo(() => {
    if (!dashboard) {
      return {pickup: 0, facility: 0, delivery: 0, completed: 0};
    }
    const pickupStatuses = new Set([
      'draft',
      'pending_payment',
      'confirmed',
      'pickup_assigned',
      'pickup_accepted',
      'en_route_pickup',
      'pickup_otp_pending',
      'picked_up',
      'in_transit_to_facility',
    ]);
    const facilityStatuses = new Set([
      'received_at_facility',
      'verification',
      'washing',
      'drying',
      'ironing',
      'folding',
      'packaging',
      'processing',
      'quality_check',
      'ready_for_delivery',
    ]);
    const deliveryStatuses = new Set([
      'delivery_assigned',
      'delivery_accepted',
      'en_route_delivery',
      'delivery_otp_pending',
      'delivered',
      'claim_period_active',
    ]);

    let pickup = 0;
    let facility = 0;
    let delivery = 0;
    let completed = 0;

    dashboard.ordersByStatus.forEach(item => {
      if (pickupStatuses.has(item.status)) pickup += item.count;
      else if (facilityStatuses.has(item.status)) facility += item.count;
      else if (deliveryStatuses.has(item.status)) delivery += item.count;
      else if (item.status === 'completed') completed += item.count;
    });

    return {pickup, facility, delivery, completed};
  }, [dashboard]);

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load(true)}
          />
        }>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTextContainer}>
            <Text style={styles.eyebrow}>B&W ADMIN</Text>
            <Text style={styles.title}>Operations Centre</Text>
            <Text style={styles.subtitle}>
              Live overview and operational command
            </Text>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Refresh dashboard metrics"
            style={styles.refreshButton}
            onPress={() => load(true)}
            disabled={refreshing}>
            {refreshing ? (
              <ActivityIndicator size="small" color="#111827" />
            ) : (
              <Text style={styles.refreshButtonText}>↻ Refresh</Text>
            )}
          </TouchableOpacity>
        </View>

        {loading && !dashboard ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator
              size="small"
              color="#111827"
              accessibilityLabel="Loading Admin dashboard"
            />
            <Text style={styles.loadingText}>Loading operational data...</Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorBanner}>
            <Text accessibilityRole="alert" style={styles.errorText}>
              {error}
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Retry loading dashboard"
              style={styles.retryButton}
              onPress={() => load()}>
              <Text style={styles.retryButtonText}>Retry dashboard</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {dashboard ? (
          <>
            {/* LIVE OVERVIEW GRID (2x2) */}
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>LIVE OVERVIEW</Text>
            </View>
            <View style={styles.overviewGrid}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Active orders: ${dashboard.activeOrders}`}
                accessibilityHint="Open Orders and Customers"
                activeOpacity={0.7}
                style={[styles.overviewCard, styles.overviewCardDark]}
                onPress={onCustomers}>
                <Text style={styles.overviewNumberDark}>
                  {dashboard.activeOrders}
                </Text>
                <Text style={styles.overviewLabelDark}>Active orders →</Text>
              </TouchableOpacity>

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Order value: ₹${dashboard.grossRevenue.toFixed(2)}`}
                accessibilityHint="Open Analytics and Reports"
                activeOpacity={0.7}
                style={styles.overviewCard}
                onPress={onReports}>
                <Text style={styles.overviewNumber}>
                  ₹{dashboard.grossRevenue.toFixed(2)}
                </Text>
                <Text style={styles.overviewLabel}>Order value →</Text>
              </TouchableOpacity>

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Active drivers: ${dashboard.activeDrivers}`}
                accessibilityHint="Open Staff Management"
                activeOpacity={0.7}
                style={styles.overviewCard}
                onPress={onStaff}>
                <Text style={styles.overviewNumber}>
                  {dashboard.activeDrivers}
                </Text>
                <Text style={styles.overviewLabel}>Drivers →</Text>
              </TouchableOpacity>

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Active facilities: ${dashboard.activeFacilities}`}
                accessibilityHint="Open Laundry Locations"
                activeOpacity={0.7}
                style={styles.overviewCard}
                onPress={onLocations || onFacilities}>
                <Text style={styles.overviewNumber}>
                  {dashboard.activeFacilities}
                </Text>
                <Text style={styles.overviewLabel}>Facilities →</Text>
              </TouchableOpacity>
            </View>

            {/* NEEDS ATTENTION SECTION */}
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>NEEDS ATTENTION</Text>
            </View>
            <View style={styles.attentionContainer}>
              {dashboard.readyOrders > 0 ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={`${dashboard.readyOrders} orders ready for delivery`}
                  accessibilityHint="Open Driver Dispatch"
                  style={styles.attentionCard}
                  onPress={onAssignments}>
                  <View style={styles.attentionIconBox}>
                    <AppIcon name="truck" size={18} color="#1E40AF" />
                  </View>
                  <View style={styles.attentionContent}>
                    <View style={styles.attentionTitleRow}>
                      <Text style={styles.attentionTitle}>
                        Ready for delivery
                      </Text>
                      <View style={styles.attentionBadge}>
                        <Text style={styles.attentionBadgeText}>
                          {dashboard.readyOrders}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.attentionDescription}>
                      Orders cleaned & packed, waiting for delivery dispatch
                    </Text>
                  </View>
                  <Text style={styles.attentionArrow}>→</Text>
                </TouchableOpacity>
              ) : null}

              {dashboard.processingOrders > 0 ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={`${dashboard.processingOrders} orders in facility processing`}
                  accessibilityHint="Open Facility Operations"
                  style={styles.attentionCard}
                  onPress={onFacilities}>
                  <View style={styles.attentionIconBox}>
                    <AppIcon name="gear" size={18} color="#9A3412" />
                  </View>
                  <View style={styles.attentionContent}>
                    <View style={styles.attentionTitleRow}>
                      <Text style={styles.attentionTitle}>
                        Facility processing
                      </Text>
                      <View style={styles.attentionBadge}>
                        <Text style={styles.attentionBadgeText}>
                          {dashboard.processingOrders}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.attentionDescription}>
                      Orders actively undergoing cleaning & inspection
                    </Text>
                  </View>
                  <Text style={styles.attentionArrow}>→</Text>
                </TouchableOpacity>
              ) : null}

              {dashboard.readyOrders === 0 &&
              dashboard.processingOrders === 0 ? (
                <View style={styles.allClearCard}>
                  <AppIcon name="check" size={18} color="#065F46" />
                  <Text style={styles.allClearText}>
                    All operations are up to date
                  </Text>
                </View>
              ) : null}
            </View>
          </>
        ) : null}

        {/* OPERATIONS NAVIGATION SECTION */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>OPERATIONS</Text>
        </View>
        <View style={styles.menuContainer}>
          <ActionCard
            iconName="box"
            title="Orders & Customers"
            description="Search customers, orders and QR codes"
            onPress={onCustomers}
            accessibilityLabel="Open Orders and Customers"
            accessibilityHint="Search customer orders, QR codes and history"
          />
          <ActionCard
            iconName="truck"
            title="Driver Dispatch"
            description="Available jobs, assignments and live driver activity"
            onPress={onAssignments}
            accessibilityLabel="Open Driver Dispatch"
            accessibilityHint="Review available jobs, claiming and driver dispatch"
          />
          <ActionCard
            iconName="facility"
            title="Facility Operations"
            description="Incoming orders, processing, QC and handovers"
            onPress={onFacilities}
            accessibilityLabel="Open Facility Operations"
            accessibilityHint="Monitor facility processing, intake and delivery handovers"
          />
          <ActionCard
            iconName="shield"
            title="Claims & Refunds"
            description="Resolve customer issues and review claims"
            onPress={onIssues}
            accessibilityLabel="Open Claims and Refunds"
            accessibilityHint="Review active claims and refund decisions"
          />
        </View>

        {/* MANAGEMENT NAVIGATION SECTION */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>MANAGEMENT</Text>
        </View>
        <View style={styles.menuContainer}>
          <ActionCard
            iconName="users"
            title="Staff Management"
            description="Drivers and facility teams"
            onPress={onStaff}
            accessibilityLabel="Open Staff Management"
            accessibilityHint="Manage driver accounts and facility staff assignments"
          />
          <ActionCard
            iconName="tag"
            title="Services & Pricing"
            description="Catalogue and pricing policy"
            onPress={onCatalogue}
            accessibilityLabel="Open Services and Pricing"
            accessibilityHint="Configure services, garment categories and pricing tiers"
          />
          <ActionCard
            iconName="location"
            title="Laundry Locations"
            description="Facilities, coordinates and service radius"
            onPress={onLocations}
            accessibilityLabel="Open Laundry Locations"
            accessibilityHint="Manage facilities, coordinates and geographic service zones"
          />
          <ActionCard
            iconName="sparkles"
            title="Growth Programs"
            description="Coupons and promotional offers"
            onPress={onGrowth}
            accessibilityLabel="Open Growth Programs"
            accessibilityHint="Manage discounts, loyalty points and promotional packages"
          />
          <ActionCard
            iconName="tag"
            title="Analytics & Reports"
            description="Performance, trends and action history"
            onPress={onReports}
            accessibilityLabel="Open Analytics and Reports"
            accessibilityHint="View gross revenue, machine utilization and audit trails"
          />
        </View>

        {/* ORDER FLOW SECTION */}
        {dashboard ? (
          <>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>ORDER FLOW</Text>
            </View>
            <View style={styles.orderFlowGrid}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Pickup stage: ${orderFlow.pickup} orders`}
                accessibilityHint="Open Orders and Customers"
                activeOpacity={0.7}
                style={styles.orderFlowCard}
                onPress={onCustomers}>
                <View style={styles.orderFlowHeader}>
                  <Text style={styles.orderFlowTitle}>Pickup Stage</Text>
                  <Text style={styles.orderFlowCount}>{orderFlow.pickup}</Text>
                </View>
                <Text style={styles.orderFlowDesc}>
                  Confirmed, en route & in transit to facility
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Facility stage: ${orderFlow.facility} orders`}
                accessibilityHint="Open Facility Operations"
                activeOpacity={0.7}
                style={styles.orderFlowCard}
                onPress={onFacilities}>
                <View style={styles.orderFlowHeader}>
                  <Text style={styles.orderFlowTitle}>Facility Stage</Text>
                  <Text style={styles.orderFlowCount}>{orderFlow.facility}</Text>
                </View>
                <Text style={styles.orderFlowDesc}>
                  Intake, washing, packaging & QC ready
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Delivery stage: ${orderFlow.delivery} orders`}
                accessibilityHint="Open Driver Dispatch"
                activeOpacity={0.7}
                style={styles.orderFlowCard}
                onPress={onAssignments}>
                <View style={styles.orderFlowHeader}>
                  <Text style={styles.orderFlowTitle}>Delivery Stage</Text>
                  <Text style={styles.orderFlowCount}>{orderFlow.delivery}</Text>
                </View>
                <Text style={styles.orderFlowDesc}>
                  Assigned, en route to customer & OTP pending
                </Text>
              </TouchableOpacity>
            </View>

            {/* EXPANDABLE STATUS BREAKDOWN */}
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={
                showAllStatuses
                  ? 'Hide detailed order statuses'
                  : 'View all order statuses'
              }
              style={styles.expandStatusesToggle}
              onPress={() => setShowAllStatuses(show => !show)}>
              <Text style={styles.expandStatusesText}>
                {showAllStatuses
                  ? 'Hide detailed status list ▴'
                  : 'View all order statuses →'}
              </Text>
            </TouchableOpacity>

            {showAllStatuses ? (
              <View style={styles.statusCard}>
                {dashboard.ordersByStatus.length ? (
                  dashboard.ordersByStatus.map(row => (
                    <View key={row.status} style={styles.statusRow}>
                      <Text style={styles.statusName}>
                        {statusLabel(row.status)}
                      </Text>
                      <Text style={styles.statusCount}>{row.count}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.noOrdersText}>No orders yet.</Text>
                )}
              </View>
            ) : null}
          </>
        ) : null}

        {/* LOGOUT ACTION */}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Log out of Admin account"
          style={styles.logoutButton}
          onPress={() => onLogout()}>
          <Text style={styles.logoutText}>Log out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#F7F6F2',
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 36,
    gap: 14,
  },

  /* Header */
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  headerTextContainer: {
    flex: 1,
    paddingRight: 10,
  },
  eyebrow: {
    fontSize: 11,
    letterSpacing: 1.4,
    fontWeight: '800',
    color: '#67635B',
  },
  title: {
    fontSize: 26,
    fontWeight: '900',
    color: '#111827',
    letterSpacing: -0.5,
    marginTop: 2,
  },
  subtitle: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  refreshButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    marginTop: 4,
  },
  refreshButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#111827',
  },

  /* Loading & Error States */
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '600',
  },
  errorBanner: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  errorText: {
    color: '#991B1B',
    fontSize: 13,
    fontWeight: '600',
  },
  retryButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#991B1B',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },

  /* Section Titles */
  sectionHeaderRow: {
    marginTop: 4,
    marginBottom: -4,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#6B7280',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },

  /* Overview Grid (2x2) */
  overviewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  overviewCard: {
    width: '48.5%',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    padding: 14,
    justifyContent: 'space-between',
    minHeight: 82,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  overviewCardDark: {
    backgroundColor: '#111827',
    borderColor: '#111827',
  },
  overviewNumber: {
    fontSize: 22,
    fontWeight: '900',
    color: '#111827',
  },
  overviewNumberDark: {
    fontSize: 22,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  overviewLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6B7280',
    marginTop: 4,
  },
  overviewLabelDark: {
    fontSize: 12,
    fontWeight: '700',
    color: '#D1D5DB',
    marginTop: 4,
  },

  /* Needs Attention */
  attentionContainer: {
    gap: 8,
  },
  attentionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 14,
    padding: 14,
    backgroundColor: '#FFFBEB',
  },
  attentionIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  attentionIcon: {
    fontSize: 18,
  },
  attentionContent: {
    flex: 1,
    paddingRight: 8,
  },
  attentionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  attentionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#92400E',
  },
  attentionBadge: {
    backgroundColor: '#D97706',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  attentionBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  attentionDescription: {
    fontSize: 12,
    color: '#78350F',
    marginTop: 2,
    lineHeight: 16,
  },
  attentionArrow: {
    fontSize: 18,
    fontWeight: '800',
    color: '#D97706',
  },
  allClearCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  allClearIcon: {
    fontSize: 15,
    fontWeight: '800',
    color: '#059669',
  },
  allClearText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#065F46',
  },

  /* Menus & Action Cards */
  menuContainer: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F3F4F6',
    minHeight: 64,
  },
  actionCardIconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  actionCardIcon: {
    fontSize: 18,
  },
  actionCardContent: {
    flex: 1,
    paddingRight: 10,
  },
  actionCardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionCardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
  },
  actionBadge: {
    backgroundColor: '#111827',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  actionBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  actionCardDescription: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
    lineHeight: 16,
  },
  actionCardArrow: {
    fontSize: 16,
    fontWeight: '800',
    color: '#9CA3AF',
  },

  /* Order Flow Grid */
  orderFlowGrid: {
    gap: 8,
  },
  orderFlowCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    padding: 14,
  },
  orderFlowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  orderFlowTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
  },
  orderFlowCount: {
    fontSize: 15,
    fontWeight: '900',
    color: '#111827',
  },
  orderFlowDesc: {
    fontSize: 12,
    color: '#6B7280',
  },
  expandStatusesToggle: {
    alignSelf: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  expandStatusesText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#2563EB',
  },

  /* Status Breakdown Card */
  statusCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    overflow: 'hidden',
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F3F4F6',
  },
  statusName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
  },
  statusCount: {
    fontSize: 13,
    fontWeight: '900',
    color: '#111827',
  },
  noOrdersText: {
    padding: 14,
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
  },

  /* Logout */
  logoutButton: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  logoutText: {
    color: '#DC2626',
    fontWeight: '800',
    fontSize: 14,
  },
});
