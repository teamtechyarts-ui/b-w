import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {
  FacilityDetail,
  FacilityOrder,
  FacilityOrderAudit,
  FacilityOversight,
  FacilitySummary,
  getAdminFacility,
  getAdminFacilityOrder,
  listAdminFacilities,
} from '../services/adminFacilityOversightApi';
import AppIcon from '../components/AppIcon';

type Props = {
  accessToken: string;
  facilityId?: string;
  orderId?: string;
  onBack: () => void;
  onFacility?: (id: string) => void;
  onOrder?: (facilityId: string, orderId: string) => void;
};

const label = (value?: string | null) => {
  if (!value) return '';
  return value.replace(/_/g, ' ');
};

const formatStatusText = (status?: string | null) => {
  if (!status) return 'UNKNOWN';
  return status.replace(/_/g, ' ').toUpperCase();
};

const formatDate = (value?: string | null) => {
  if (!value) return 'Pending';
  try {
    return new Date(value).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return value;
  }
};

const formatRelativeAge = (hours?: number | null, updatedAt?: string | null) => {
  if (typeof hours === 'number' && hours >= 0) {
    if (hours < 1) return '< 1h';
    return `${Math.round(hours)}h`;
  }
  if (updatedAt) {
    const parsed = Date.parse(updatedAt);
    if (!isNaN(parsed)) {
      const diffHours = Math.max(0, (Date.now() - parsed) / 3600000);
      if (diffHours < 1) return '< 1h';
      return `${Math.round(diffHours)}h`;
    }
  }
  return 'Recent';
};

const getStatusTheme = (status?: string | null) => {
  switch (status) {
    case 'ready_for_delivery':
    case 'delivered':
      return {bg: '#ECFDF5', text: '#065F46', border: '#A7F3D0'};
    case 'processing':
    case 'washing':
    case 'drying':
    case 'ironing':
    case 'folding':
    case 'packaging':
      return {bg: '#EFF6FF', text: '#1E40AF', border: '#BFDBFE'};
    case 'verification':
    case 'quality_check':
      return {bg: '#F5F3FF', text: '#5B21B6', border: '#DDD6FE'};
    case 'rework_required':
    case 'stuck':
      return {bg: '#FEF2F2', text: '#991B1B', border: '#FECACA'};
    case 'received_at_facility':
    case 'in_transit_to_facility':
    case 'pickup_accepted':
    case 'en_route_pickup':
    case 'picked_up':
      return {bg: '#FFFBEB', text: '#92400E', border: '#FDE68A'};
    default:
      return {bg: '#F1F5F9', text: '#334155', border: '#CBD5E1'};
  }
};

export default function AdminFacilityOversightScreen({
  accessToken,
  facilityId,
  orderId,
  onBack,
  onFacility,
  onOrder,
}: Props) {
  const [overview, setOverview] = useState<FacilityOversight | null>(null);
  const [facility, setFacility] = useState<FacilityDetail | null>(null);
  const [audit, setAudit] = useState<FacilityOrderAudit | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [activeFilter, setActiveFilter] = useState<
    'all' | 'received' | 'verification' | 'processing' | 'ready' | 'attention'
  >('all');

  const load = useCallback(
    async (isManualRefresh = false) => {
      if (isManualRefresh) setRefreshing(true);
      else setLoading(true);
      setError('');
      try {
        if (facilityId && orderId) {
          const res = await getAdminFacilityOrder(accessToken, facilityId, orderId);
          setAudit(res);
        } else if (facilityId) {
          const res = await getAdminFacility(accessToken, facilityId);
          setFacility(res);
        } else {
          const res = await listAdminFacilities(accessToken);
          setOverview(res);
        }
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : 'Facility oversight unavailable.';
        setError(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [accessToken, facilityId, orderId],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Compute aggregated overview metrics across all facilities
  const overviewTotals = useMemo(() => {
    if (!overview?.facilities) {
      return {activeFacilities: 0, totalWorkload: 0, totalReady: 0, needAttention: 0, totalStuck: 0, totalAgeWarnings: 0, totalDiscrepancies: 0, totalQcFailures: 0};
    }
    const facs = overview.facilities;
    const activeFacilities = facs.filter(f => f.isActive).length;
    const totalWorkload = facs.reduce((sum, f) => sum + (f.workload || 0), 0);
    const totalReady = facs.reduce((sum, f) => sum + (f.ready || 0), 0);
    const totalStuck = facs.reduce((sum, f) => sum + (f.stuckOrders || 0), 0);
    const totalAgeWarnings = facs.reduce((sum, f) => sum + (f.ageWarnings || 0), 0);
    const totalDiscrepancies = facs.reduce((sum, f) => sum + (f.openDiscrepancies || 0), 0);
    const totalQcFailures = facs.reduce((sum, f) => sum + (f.qcFailures || 0), 0);
    const needAttention = totalStuck + totalAgeWarnings + totalDiscrepancies + totalQcFailures;

    return {
      activeFacilities,
      totalWorkload,
      totalReady,
      needAttention,
      totalStuck,
      totalAgeWarnings,
      totalDiscrepancies,
      totalQcFailures,
    };
  }, [overview]);

  // Compute filtered orders on Facility Workload screen
  const filteredOrders = useMemo(() => {
    if (!facility?.orders) return [];
    const list = facility.orders;
    if (activeFilter === 'all') return list;
    if (activeFilter === 'received') {
      return list.filter(o => o.current_status === 'received_at_facility');
    }
    if (activeFilter === 'verification') {
      return list.filter(o => o.current_status === 'verification');
    }
    if (activeFilter === 'processing') {
      return list.filter(o => o.current_status === 'processing');
    }
    if (activeFilter === 'ready') {
      return list.filter(o => o.current_status === 'ready_for_delivery');
    }
    if (activeFilter === 'attention') {
      return list.filter(
        o => o.stuck || o.ageWarning || (o.openDiscrepancies && o.openDiscrepancies > 0),
      );
    }
    return list;
  }, [facility, activeFilter]);

  // Render Single Facility Card in Overview
  const renderFacilityCard = (item: FacilitySummary) => {
    const processingCount = Object.values(item.stages || {}).reduce((a, b) => a + (b || 0), 0);
    const hasAttention = item.stuckOrders > 0 || item.ageWarnings > 0 || item.openDiscrepancies > 0 || item.qcFailures > 0;

    return (
      <TouchableOpacity
        key={item.id}
        accessibilityRole="button"
        accessibilityLabel={`Facility ${item.name}, ${item.isActive ? 'Active' : 'Inactive'}, ${item.workload} active orders`}
        accessibilityHint="Tap to view facility workload and orders"
        activeOpacity={0.75}
        style={[styles.facilityCard, !item.isActive && styles.facilityCardInactive]}
        onPress={() => onFacility?.(item.id)}>
        {/* Top Header Row */}
        <View style={styles.cardHeaderRow}>
          <View style={styles.cardHeaderLeft}>
            <View style={styles.facilityIconBadge}>
              <AppIcon name="facility" size={18} color="#111827" />
            </View>
            <View style={styles.facilityHeaderTitles}>
              <Text style={styles.facilityName} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.facilityAddress} numberOfLines={1}>
                {item.address || 'Address unavailable'}
              </Text>
            </View>
          </View>
          <View style={styles.cardHeaderRight}>
            <View
              style={[
                styles.statusBadge,
                item.isActive ? styles.statusBadgeActive : styles.statusBadgeInactive,
              ]}>
              <Text
                style={[
                  styles.statusBadgeText,
                  item.isActive ? styles.statusBadgeTextActive : styles.statusBadgeTextInactive,
                ]}>
                {item.isActive ? 'ACTIVE' : 'INACTIVE'}
              </Text>
            </View>
            <Text style={styles.cardChevron}>→</Text>
          </View>
        </View>

        {/* Workload Banner */}
        <View style={styles.workloadBanner}>
          <Text style={styles.workloadTitle}>Workload</Text>
          <Text style={styles.workloadCount}>
            {item.workload} active {item.workload === 1 ? 'order' : 'orders'}
          </Text>
        </View>

        {/* Micro Metric Tiles */}
        <View style={styles.metricTilesGrid}>
          <View style={styles.metricTile}>
            <Text style={styles.metricTileValue}>{item.received}</Text>
            <Text style={styles.metricTileLabel}>Received</Text>
          </View>
          <View style={styles.metricTile}>
            <Text style={styles.metricTileValue}>{item.verification}</Text>
            <Text style={styles.metricTileLabel}>Verification</Text>
          </View>
          <View style={styles.metricTile}>
            <Text style={styles.metricTileValue}>{processingCount}</Text>
            <Text style={styles.metricTileLabel}>Processing</Text>
          </View>
          <View style={styles.metricTile}>
            <Text style={[styles.metricTileValue, styles.textGreen]}>{item.ready}</Text>
            <Text style={styles.metricTileLabel}>Ready</Text>
          </View>
        </View>

        {/* Stage Micro Pills */}
        <View style={styles.stagesPillsRow}>
          <Text style={styles.stageMicroPill}>Wash {item.stages?.washing || 0}</Text>
          <Text style={styles.stageMicroPill}>Dry {item.stages?.drying || 0}</Text>
          <Text style={styles.stageMicroPill}>Iron {item.stages?.ironing || 0}</Text>
          <Text style={styles.stageMicroPill}>Fold {item.stages?.folding || 0}</Text>
          <Text style={styles.stageMicroPill}>Pack-prep {item.stages?.packaging || 0}</Text>
          <Text style={styles.stageMicroPill}>Packed {item.packed || 0}</Text>
        </View>

        {/* Attention Alerts Row (if any) */}
        {hasAttention && (
          <View style={styles.cardAttentionRow}>
            {item.stuckOrders > 0 && (
              <View style={styles.attentionPillDanger}>
                <Text style={styles.attentionPillDangerText}>{item.stuckOrders} stuck</Text>
              </View>
            )}
            {item.ageWarnings > 0 && (
              <View style={styles.attentionPillWarning}>
                <Text style={styles.attentionPillWarningText}>
                  {item.ageWarnings} age warnings
                </Text>
              </View>
            )}
            {item.openDiscrepancies > 0 && (
              <View style={styles.attentionPillWarning}>
                <Text style={styles.attentionPillWarningText}>
                  {item.openDiscrepancies} discrepancies
                </Text>
              </View>
            )}
            {item.qcFailures > 0 && (
              <View style={styles.attentionPillDanger}>
                <Text style={styles.attentionPillDangerText}>{item.qcFailures} QC failures</Text>
              </View>
            )}
            {item.rewashCycles > 0 && (
              <View style={styles.attentionPillWarning}>
                <Text style={styles.attentionPillWarningText}>
                  Rewash cycles {item.rewashCycles}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Facility Resources & Oldest Active Footer */}
        <View style={styles.cardFooterRow}>
          <Text style={styles.cardFooterText}>
            {item.activeStaff} staff · {item.activeMachines} machines ({item.installedMachineCapacityKg} kg)
          </Text>
          {item.oldestActiveHours > 0 && (
            <Text style={styles.cardFooterMuted}>Oldest active: {item.oldestActiveHours}h</Text>
          )}
        </View>

        {/* Action Link Text */}
        <View style={styles.cardActionRow}>
          <Text style={styles.cardActionLink}>View Facility orders →</Text>
        </View>
      </TouchableOpacity>
    );
  };

  // Render Order Card on Workload screen
  const renderOrderCard = (order: FacilityOrder) => {
    const theme = getStatusTheme(order.current_status);
    const hasAttention = order.stuck || order.ageWarning || (order.openDiscrepancies && order.openDiscrepancies > 0);

    return (
      <TouchableOpacity
        key={order.id}
        accessibilityRole="button"
        accessibilityLabel={`Order ${order.order_number}, Status: ${formatStatusText(order.current_status)}, Stage: ${order.latestStage || 'None'}`}
        accessibilityHint="Tap to view order processing history and audit"
        activeOpacity={0.75}
        style={styles.orderCard}
        onPress={() => onOrder?.(facility!.summary.id, order.id)}>
        {/* Top Row: Order Number & Status Badge */}
        <View style={styles.orderCardTopRow}>
          <View style={styles.orderNumberBox}>
            <Text style={styles.orderNumberText}>{order.order_number}</Text>
          </View>
          <View
            style={[
              styles.orderStatusBadge,
              {backgroundColor: theme.bg, borderColor: theme.border},
            ]}>
            <Text style={[styles.orderStatusBadgeText, {color: theme.text}]}>
              {formatStatusText(order.current_status)}
            </Text>
          </View>
        </View>

        {/* Stage & Age Row */}
        <View style={styles.orderDetailRow}>
          <View style={styles.orderStageBox}>
            <Text style={styles.orderStageLabel}>Latest Stage</Text>
            <Text style={styles.orderStageValue}>
              {order.latestStage ? label(order.latestStage) : 'None'}
            </Text>
          </View>
          <View style={styles.orderAgeBox}>
            <Text style={styles.orderStageLabel}>Age</Text>
            <Text style={styles.orderAgeValue}>
              {formatRelativeAge(order.processingAgeHours, order.updated_at)}
            </Text>
          </View>
        </View>

        {/* Operational Status Callout */}
        <View style={styles.orderOperationalRow}>
          {order.stuck ? (
            <View style={styles.attentionTagDanger}>
              <Text style={styles.attentionTagDangerText}>Stuck order ({order.processingAgeHours}h)</Text>
            </View>
          ) : order.ageWarning ? (
            <View style={styles.attentionTagWarning}>
              <Text style={styles.attentionTagWarningText}>Age warning ({order.processingAgeHours}h)</Text>
            </View>
          ) : (
            <View style={styles.onTrackTag}>
              <Text style={styles.onTrackTagText}>On track</Text>
            </View>
          )}

          {order.openDiscrepancies > 0 ? (
            <View style={styles.attentionTagWarning}>
              <Text style={styles.attentionTagWarningText}>
                Open discrepancies {order.openDiscrepancies}
              </Text>
            </View>
          ) : (
            <Text style={styles.discrepancyClearText}>Open discrepancies 0</Text>
          )}
        </View>

        {/* Driver / Availability Dispatch Status */}
        <View style={styles.dispatchStateRow}>
          {order.current_status === 'ready_for_delivery' ? (
            <Text style={styles.dispatchStateTextReady}>
              Delivery dispatch: Waiting for available driver
            </Text>
          ) : order.current_status === 'in_transit_to_facility' ? (
            <Text style={styles.dispatchStateTextMuted}>In transit to facility</Text>
          ) : order.current_status === 'received_at_facility' ? (
            <Text style={styles.dispatchStateTextMuted}>Received at facility · Pending verification</Text>
          ) : order.current_status === 'verification' ? (
            <Text style={styles.dispatchStateTextMuted}>Intake verification underway</Text>
          ) : order.current_status === 'processing' ? (
            <Text style={styles.dispatchStateTextMuted}>Processing in progress</Text>
          ) : (
            <Text style={styles.dispatchStateTextMuted}>Updated {formatDate(order.updated_at)}</Text>
          )}
        </View>

        {/* Bottom Action Footer */}
        <View style={styles.orderCardFooter}>
          <Text style={styles.orderCardActionLink}>View processing history →</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.page}>
      {/* Top Header */}
      <View style={styles.headerBar}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Go back"
          accessibilityHint="Returns to previous screen"
          activeOpacity={0.7}
          style={styles.backButton}
          onPress={onBack}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>

        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {orderId
              ? 'Facility Order Audit'
              : facilityId
              ? 'Facility Workload'
              : 'Facility Oversight'}
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {orderId
              ? 'Garment processing & audit'
              : facilityId
              ? 'Operational order flow'
              : 'Monitor all laundry facilities'}
          </Text>
        </View>

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Refresh facility oversight"
          accessibilityHint="Reloads live facility data"
          activeOpacity={0.7}
          style={styles.refreshButton}
          onPress={() => load(true)}>
          <Text style={styles.refreshButtonText}>Refresh</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={['#2563EB']} />
        }>
        {/* Loading Indicator */}
        {loading && !refreshing && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#2563EB" accessibilityLabel="Loading Facility oversight" />
            <Text style={styles.loadingText}>Loading live facility data...</Text>
          </View>
        )}

        {/* Error Alert Box */}
        {error ? (
          <View style={styles.errorContainer} accessibilityRole="alert">
            <View style={styles.errorHeaderRow}>
              <AppIcon name="alert" size={18} color="#DC2626" />
              <Text style={styles.errorTitle}>Facility oversight couldn't be loaded.</Text>
            </View>
            <Text style={styles.errorMessage}>{error}</Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Retry oversight"
              accessibilityHint="Attempts to reload facility data"
              activeOpacity={0.8}
              style={styles.retryButton}
              onPress={() => load(false)}>
              <Text style={styles.retryButtonText}>Retry oversight</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* ============================================================ */}
        {/* SCREEN 1: ADMIN → FACILITY OVERSIGHT (Overview)              */}
        {/* ============================================================ */}
        {!facilityId && !orderId && overview && (
          <View style={styles.sectionContainer}>
            {/* Global Aggregated Metrics Grid */}
            <View style={styles.overviewGrid}>
              <View style={styles.overviewTile}>
                <Text style={styles.overviewTileCount}>{overviewTotals.activeFacilities}</Text>
                <Text style={styles.overviewTileLabel}>Active Facilities</Text>
              </View>
              <View style={styles.overviewTile}>
                <Text style={styles.overviewTileCount}>{overviewTotals.totalWorkload}</Text>
                <Text style={styles.overviewTileLabel}>Total Workload</Text>
              </View>
              <View style={styles.overviewTile}>
                <Text style={[styles.overviewTileCount, styles.textGreen]}>
                  {overviewTotals.totalReady}
                </Text>
                <Text style={styles.overviewTileLabel}>Ready for Delivery</Text>
              </View>
              <View style={styles.overviewTile}>
                <Text
                  style={[
                    styles.overviewTileCount,
                    overviewTotals.needAttention > 0 ? styles.textAmber : styles.textSlate,
                  ]}>
                  {overviewTotals.needAttention}
                </Text>
                <Text style={styles.overviewTileLabel}>Need Attention</Text>
              </View>
            </View>

            {/* Monitoring Notice Banner */}
            <View style={styles.monitoringNoticeBox}>
              <Text style={styles.monitoringNoticeText}>
                Monitoring indicators: warning after {overview.monitoring.ageWarningHours}h, stuck after{' '}
                {overview.monitoring.stuckHours}h since last order update. These are not contractual SLAs.
              </Text>
            </View>

            {/* Needs Attention Section (if any facility has issues) */}
            {overviewTotals.needAttention > 0 && (
              <View style={styles.attentionSection}>
                <Text style={styles.sectionTitle}>NEEDS ATTENTION</Text>
                <View style={styles.attentionCardList}>
                  {overviewTotals.totalStuck > 0 && (
                    <View style={styles.attentionAlertCardDanger}>
                      <Text style={styles.attentionAlertTitle}>
                        {overviewTotals.totalStuck} Stuck Orders
                      </Text>
                      <Text style={styles.attentionAlertDesc}>
                        Orders with no status change for {overview.monitoring.stuckHours}+ hours.
                      </Text>
                    </View>
                  )}
                  {overviewTotals.totalAgeWarnings > 0 && (
                    <View style={styles.attentionAlertCardWarning}>
                      <Text style={styles.attentionAlertTitle}>
                        {overviewTotals.totalAgeWarnings} Age Warnings
                      </Text>
                      <Text style={styles.attentionAlertDesc}>
                        Orders in facility exceeding {overview.monitoring.ageWarningHours}h without advancement.
                      </Text>
                    </View>
                  )}
                  {overviewTotals.totalDiscrepancies > 0 && (
                    <View style={styles.attentionAlertCardWarning}>
                      <Text style={styles.attentionAlertTitle}>
                        {overviewTotals.totalDiscrepancies} Open Discrepancies
                      </Text>
                      <Text style={styles.attentionAlertDesc}>
                        Intake quantity or garment discrepancies requiring resolution.
                      </Text>
                    </View>
                  )}
                  {overviewTotals.totalQcFailures > 0 && (
                    <View style={styles.attentionAlertCardDanger}>
                      <Text style={styles.attentionAlertTitle}>
                        {overviewTotals.totalQcFailures} QC Failures / Rewash Cycles
                      </Text>
                      <Text style={styles.attentionAlertDesc}>
                        Garments requiring quality re-cleaning and rework.
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* Facilities List Section */}
            <View style={styles.facilitiesSection}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>
                  FACILITIES ({overview.facilities.length})
                </Text>
              </View>

              {overview.facilities.length > 0 ? (
                overview.facilities.map(renderFacilityCard)
              ) : (
                <View style={styles.emptyCard}>
                  <AppIcon name="facility" size={32} color="#9CA3AF" />
                  <Text style={styles.emptyCardTitle}>No facilities found</Text>
                  <Text style={styles.emptyCardSubtitle}>
                    No registered facilities are currently configured.
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* ============================================================ */}
        {/* SCREEN 2: ADMIN → FACILITY WORKLOAD                          */}
        {/* ============================================================ */}
        {facilityId && !orderId && facility && (
          <View style={styles.sectionContainer}>
            {/* Facility Header Summary Card */}
            <View style={styles.facilityWorkloadHeaderCard}>
              <View style={styles.facilityWorkloadTitleRow}>
                <View style={styles.flex1}>
                  <Text style={styles.facilityWorkloadName}>{facility.summary.name}</Text>
                  <Text style={styles.facilityWorkloadAddress}>
                    {facility.summary.address || 'Address unavailable'}
                  </Text>
                </View>
                <View
                  style={[
                    styles.statusBadge,
                    facility.summary.isActive ? styles.statusBadgeActive : styles.statusBadgeInactive,
                  ]}>
                  <Text
                    style={[
                      styles.statusBadgeText,
                      facility.summary.isActive
                        ? styles.statusBadgeTextActive
                        : styles.statusBadgeTextInactive,
                    ]}>
                    {facility.summary.isActive ? 'ACTIVE' : 'INACTIVE'}
                  </Text>
                </View>
              </View>

              {/* Health Stats Grid */}
              <View style={styles.workloadStatsGrid}>
                <View style={styles.workloadStatTile}>
                  <Text style={styles.workloadStatNumber}>{facility.summary.workload}</Text>
                  <Text style={styles.workloadStatLabel}>Active Orders</Text>
                </View>
                <View style={styles.workloadStatTile}>
                  <Text style={styles.workloadStatNumber}>{facility.summary.received}</Text>
                  <Text style={styles.workloadStatLabel}>Received</Text>
                </View>
                <View style={styles.workloadStatTile}>
                  <Text style={styles.workloadStatNumber}>
                    {Object.values(facility.summary.stages || {}).reduce((a, b) => a + (b || 0), 0)}
                  </Text>
                  <Text style={styles.workloadStatLabel}>Processing</Text>
                </View>
                <View style={styles.workloadStatTile}>
                  <Text style={[styles.workloadStatNumber, styles.textGreen]}>
                    {facility.summary.ready}
                  </Text>
                  <Text style={styles.workloadStatLabel}>Ready</Text>
                </View>
              </View>

              {/* Warnings and Discrepancies Bar */}
              <View style={styles.workloadWarningsBar}>
                <View style={styles.workloadWarningItem}>
                  <Text
                    style={[
                      styles.workloadWarningText,
                      facility.summary.stuckOrders > 0 ? styles.textRed : styles.textSlate,
                    ]}>
                    {facility.summary.stuckOrders} Stuck
                  </Text>
                </View>
                <View style={styles.workloadWarningItem}>
                  <Text
                    style={[
                      styles.workloadWarningText,
                      facility.summary.ageWarnings > 0 ? styles.textAmber : styles.textSlate,
                    ]}>
                    {facility.summary.ageWarnings} Age Warnings
                  </Text>
                </View>
                <View style={styles.workloadWarningItem}>
                  <Text
                    style={[
                      styles.workloadWarningText,
                      facility.summary.openDiscrepancies > 0 ? styles.textAmber : styles.textSlate,
                    ]}>
                    {facility.summary.openDiscrepancies} Discrepancies
                  </Text>
                </View>
              </View>
            </View>

            {/* Stage Filter Chips */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterChipsRow}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Filter all orders"
                activeOpacity={0.7}
                style={[
                  styles.filterChip,
                  activeFilter === 'all' && styles.filterChipActive,
                ]}
                onPress={() => setActiveFilter('all')}>
                <Text
                  style={[
                    styles.filterChipText,
                    activeFilter === 'all' && styles.filterChipTextActive,
                  ]}>
                  All ({facility.orders.length})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Filter received orders"
                activeOpacity={0.7}
                style={[
                  styles.filterChip,
                  activeFilter === 'received' && styles.filterChipActive,
                ]}
                onPress={() => setActiveFilter('received')}>
                <Text
                  style={[
                    styles.filterChipText,
                    activeFilter === 'received' && styles.filterChipTextActive,
                  ]}>
                  Received ({facility.summary.received})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Filter verification orders"
                activeOpacity={0.7}
                style={[
                  styles.filterChip,
                  activeFilter === 'verification' && styles.filterChipActive,
                ]}
                onPress={() => setActiveFilter('verification')}>
                <Text
                  style={[
                    styles.filterChipText,
                    activeFilter === 'verification' && styles.filterChipTextActive,
                  ]}>
                  Verification ({facility.summary.verification})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Filter processing orders"
                activeOpacity={0.7}
                style={[
                  styles.filterChip,
                  activeFilter === 'processing' && styles.filterChipActive,
                ]}
                onPress={() => setActiveFilter('processing')}>
                <Text
                  style={[
                    styles.filterChipText,
                    activeFilter === 'processing' && styles.filterChipTextActive,
                  ]}>
                  Processing ({Object.values(facility.summary.stages || {}).reduce((a, b) => a + (b || 0), 0)})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Filter ready for delivery orders"
                activeOpacity={0.7}
                style={[
                  styles.filterChip,
                  activeFilter === 'ready' && styles.filterChipActive,
                ]}
                onPress={() => setActiveFilter('ready')}>
                <Text
                  style={[
                    styles.filterChipText,
                    activeFilter === 'ready' && styles.filterChipTextActive,
                  ]}>
                  Ready ({facility.summary.ready})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Filter orders needing attention"
                activeOpacity={0.7}
                style={[
                  styles.filterChip,
                  activeFilter === 'attention' && styles.filterChipActive,
                ]}
                onPress={() => setActiveFilter('attention')}>
                <Text
                  style={[
                    styles.filterChipText,
                    activeFilter === 'attention' && styles.filterChipTextActive,
                  ]}>
                  Attention ({facility.summary.stuckOrders + facility.summary.ageWarnings + facility.summary.openDiscrepancies})
                </Text>
              </TouchableOpacity>
            </ScrollView>

            {/* Orders Section Header */}
            <View style={styles.ordersSectionHeader}>
              <Text style={styles.sectionTitle}>
                ORDERS ({filteredOrders.length})
              </Text>
            </View>

            {/* Orders List */}
            {filteredOrders.length > 0 ? (
              filteredOrders.map(renderOrderCard)
            ) : (
              <View style={styles.emptyCard}>
                <AppIcon name="box" size={32} color="#9CA3AF" />
                <Text style={styles.emptyCardTitle}>No orders found</Text>
                <Text style={styles.emptyCardSubtitle}>
                  {activeFilter === 'all'
                    ? 'No orders are currently present at this facility.'
                    : 'No orders match the selected stage filter.'}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* ============================================================ */}
        {/* SCREEN 3: ADMIN → FACILITY ORDER AUDIT / PROCESSING HISTORY   */}
        {/* ============================================================ */}
        {orderId && audit && (
          <View style={styles.sectionContainer}>
            {/* Order Header Summary Card */}
            <View style={styles.orderAuditHeaderCard}>
              <View style={styles.orderAuditTitleRow}>
                <Text style={styles.orderAuditOrderNumber}>
                  {audit.order.order_number}
                </Text>
                <View
                  style={[
                    styles.orderStatusBadge,
                    {
                      backgroundColor: getStatusTheme(audit.order.current_status).bg,
                      borderColor: getStatusTheme(audit.order.current_status).border,
                    },
                  ]}>
                  <Text
                    style={[
                      styles.orderStatusBadgeText,
                      {color: getStatusTheme(audit.order.current_status).text},
                    ]}>
                    {formatStatusText(audit.order.current_status)}
                  </Text>
                </View>
              </View>
            </View>

            {/* Processing Operations History */}
            <View style={styles.auditCard}>
              <Text style={styles.auditCardTitle}>Processing history</Text>
              {audit.operations.length > 0 ? (
                audit.operations.map((item, idx) => (
                  <View key={item.id || idx} style={styles.auditTimelineItem}>
                    <View style={styles.timelineDot} />
                    <View style={styles.timelineContent}>
                      <Text style={styles.timelineTitle}>
                        {label(item.operation_type || 'receipt')} ·{' '}
                        {item.completed_at ? 'completed' : label(item.current_status || 'started')}
                        {item.rewash_cycle !== undefined ? ` · cycle ${item.rewash_cycle}` : ''}
                      </Text>
                      <Text style={styles.timelineDate}>
                        {formatDate(item.started_at || item.completed_at)}
                      </Text>
                    </View>
                  </View>
                ))
              ) : (
                <Text style={styles.auditEmptyText}>No processing records.</Text>
              )}
            </View>

            {/* Intake and Discrepancies */}
            <View style={styles.auditCard}>
              <Text style={styles.auditCardTitle}>Intake and discrepancies</Text>
              <Text style={styles.auditSubtitle}>
                {audit.inspections.length} garment verification records
              </Text>
              {audit.discrepancies.length > 0 ? (
                audit.discrepancies.map((item, idx) => (
                  <View key={item.id || idx} style={styles.discrepancyBox}>
                    <Text style={styles.discrepancyTitle}>
                      {label(item.kind)} · Status: {item.status}
                    </Text>
                    <Text style={styles.discrepancyNotes}>
                      {item.notes}
                      {item.resolution_notes ? ` · Resolution: ${item.resolution_notes}` : ''}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={styles.auditEmptyText}>No discrepancies.</Text>
              )}
            </View>

            {/* QC and Packing */}
            <View style={styles.auditCard}>
              <Text style={styles.auditCardTitle}>QC and packing</Text>
              {audit.qc.length > 0 ? (
                audit.qc.map((item, idx) => (
                  <View key={item.id || idx} style={styles.qcBox}>
                    <Text style={styles.qcTitle}>
                      Cycle {item.cycle_number} · {item.approved ? 'Passed' : `Failed: ${item.defect_code || ''} ${item.reason || ''}`}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={styles.auditEmptyText}>No QC decisions.</Text>
              )}

              {audit.packings.length > 0 ? (
                audit.packings.map((item, idx) => (
                  <View key={item.id || idx} style={styles.packingBox}>
                    <Text style={styles.packingTitle}>
                      Parcel {item.parcel_id} · Packed: {formatDate(item.packed_at)}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={styles.auditEmptyText}>No packing record.</Text>
              )}
            </View>

            {/* QR Intake Audit */}
            <View style={styles.auditCard}>
              <Text style={styles.auditCardTitle}>QR intake audit</Text>
              {audit.qr.flatMap(item => item.scans).length > 0 ? (
                audit.qr
                  .flatMap(item => item.scans)
                  .map((scan, idx) => (
                    <View key={scan.id || idx} style={styles.qrScanBox}>
                      <Text style={styles.qrScanAction}>
                        Action: {label(scan.scan_action)}
                      </Text>
                      <Text style={styles.qrScanDate}>
                        Scanned: {formatDate(scan.scanned_at)}
                      </Text>
                    </View>
                  ))
              ) : (
                <Text style={styles.auditEmptyText}>No QR scans.</Text>
              )}
            </View>

            {/* Order Timeline */}
            <View style={styles.auditCard}>
              <Text style={styles.auditCardTitle}>Order timeline</Text>
              {audit.history.length > 0 ? (
                audit.history.map((hist, idx) => (
                  <View key={hist.id || idx} style={styles.timelineRow}>
                    <Text style={styles.timelineTransition}>
                      {label(hist.from_status || 'start')} → {label(hist.to_status)}
                    </Text>
                    <Text style={styles.timelineTimestamp}>
                      {formatDate(hist.created_at)}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={styles.auditEmptyText}>No status history.</Text>
              )}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  content: {
    padding: 16,
    gap: 16,
    paddingBottom: 40,
  },
  flex1: {
    flex: 1,
  },

  /* Header Bar */
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  backButton: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
  },
  backButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2563EB',
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  headerSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748B',
    marginTop: 1,
  },
  refreshButton: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  refreshButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2563EB',
  },

  /* Loading State */
  loadingContainer: {
    paddingVertical: 32,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: '#64748B',
    fontWeight: '600',
  },

  /* Error Alert */
  errorContainer: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  errorHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorIcon: {
    fontSize: 18,
    color: '#DC2626',
  },
  errorTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#991B1B',
  },
  errorMessage: {
    fontSize: 13,
    color: '#B91C1C',
    lineHeight: 18,
  },
  retryButton: {
    backgroundColor: '#DC2626',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginTop: 4,
    minHeight: 44,
    justifyContent: 'center',
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },

  /* Section Containers */
  sectionContainer: {
    gap: 16,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 0.8,
  },

  /* Overview 2x2 Metric Grid */
  overviewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  overviewTile: {
    flexBasis: '48%',
    flexGrow: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 14,
    gap: 4,
  },
  overviewTileCount: {
    fontSize: 24,
    fontWeight: '900',
    color: '#0F172A',
  },
  overviewTileLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  textGreen: {
    color: '#059669',
  },
  textAmber: {
    color: '#D97706',
  },
  textRed: {
    color: '#DC2626',
  },
  textSlate: {
    color: '#64748B',
  },

  /* Monitoring Notice Box */
  monitoringNoticeBox: {
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 12,
  },
  monitoringNoticeText: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 17,
  },

  /* Needs Attention Alerts */
  attentionSection: {
    gap: 8,
  },
  attentionCardList: {
    gap: 8,
  },
  attentionAlertCardDanger: {
    backgroundColor: '#FEF2F2',
    borderLeftWidth: 4,
    borderLeftColor: '#DC2626',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 10,
    padding: 12,
    gap: 3,
  },
  attentionAlertCardWarning: {
    backgroundColor: '#FFFBEB',
    borderLeftWidth: 4,
    borderLeftColor: '#D97706',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 10,
    padding: 12,
    gap: 3,
  },
  attentionAlertTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  attentionAlertDesc: {
    fontSize: 12,
    color: '#475569',
  },

  /* Facilities Section & Facility Card */
  facilitiesSection: {
    gap: 12,
  },
  facilityCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 16,
    gap: 12,
    minHeight: 44,
  },
  facilityCardInactive: {
    opacity: 0.8,
    backgroundColor: '#F8FAFC',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  facilityIconBadge: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  facilityIcon: {
    fontSize: 18,
  },
  facilityHeaderTitles: {
    flex: 1,
  },
  facilityName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  facilityAddress: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  cardHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  statusBadgeActive: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  statusBadgeInactive: {
    backgroundColor: '#F1F5F9',
    borderColor: '#CBD5E1',
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  statusBadgeTextActive: {
    color: '#065F46',
  },
  statusBadgeTextInactive: {
    color: '#475569',
  },
  cardChevron: {
    fontSize: 16,
    fontWeight: '800',
    color: '#94A3B8',
  },

  /* Workload Banner */
  workloadBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  workloadTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  workloadCount: {
    fontSize: 13,
    fontWeight: '800',
    color: '#2563EB',
  },

  /* Micro Metric Tiles Grid */
  metricTilesGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
  },
  metricTile: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
  },
  metricTileValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  metricTileLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748B',
    marginTop: 2,
  },

  /* Stage Pills */
  stagesPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  stageMicroPill: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },

  /* Attention Row */
  cardAttentionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  attentionPillDanger: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  attentionPillDangerText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#DC2626',
  },
  attentionPillWarning: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  attentionPillWarningText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#D97706',
  },

  /* Footer & Action Link */
  cardFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#F1F5F9',
  },
  cardFooterText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  cardFooterMuted: {
    fontSize: 11,
    color: '#94A3B8',
  },
  cardActionRow: {
    alignItems: 'flex-end',
  },
  cardActionLink: {
    fontSize: 13,
    fontWeight: '700',
    color: '#2563EB',
  },

  /* ============================================================ */
  /* WORKLOAD SCREEN STYLES                                       */
  /* ============================================================ */
  facilityWorkloadHeaderCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 16,
    gap: 12,
  },
  facilityWorkloadTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  facilityWorkloadName: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  facilityWorkloadAddress: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  workloadStatsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
  },
  workloadStatTile: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 4,
    alignItems: 'center',
  },
  workloadStatNumber: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0F172A',
  },
  workloadStatLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748B',
    marginTop: 2,
    textAlign: 'center',
  },
  workloadWarningsBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#F1F5F9',
  },
  workloadWarningItem: {
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  workloadWarningText: {
    fontSize: 11,
    fontWeight: '700',
  },

  /* Filter Chips Row */
  filterChipsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 4,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterChipActive: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },

  /* Orders Section */
  ordersSectionHeader: {
    marginTop: 4,
  },
  orderCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 14,
    gap: 10,
    minHeight: 44,
  },
  orderCardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  orderNumberBox: {
    flex: 1,
  },
  orderNumberText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  orderStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  orderStatusBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  orderDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    padding: 10,
    borderRadius: 8,
  },
  orderStageBox: {
    flex: 1,
  },
  orderAgeBox: {
    alignItems: 'flex-end',
  },
  orderStageLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748B',
    textTransform: 'uppercase',
  },
  orderStageValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 1,
    textTransform: 'capitalize',
  },
  orderAgeValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 1,
  },
  orderOperationalRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  attentionTagDanger: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  attentionTagDangerText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#DC2626',
  },
  attentionTagWarning: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  attentionTagWarningText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#D97706',
  },
  onTrackTag: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  onTrackTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#065F46',
  },
  discrepancyClearText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
  },
  dispatchStateRow: {
    paddingTop: 4,
  },
  dispatchStateTextReady: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2563EB',
  },
  dispatchStateTextMuted: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  orderCardFooter: {
    alignItems: 'flex-end',
    paddingTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#F1F5F9',
  },
  orderCardActionLink: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2563EB',
  },

  /* Empty State */
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 32,
    alignItems: 'center',
    gap: 8,
  },
  emptyCardIcon: {
    fontSize: 32,
  },
  emptyCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  emptyCardSubtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
  },

  /* ============================================================ */
  /* AUDIT SCREEN STYLES                                          */
  /* ============================================================ */
  orderAuditHeaderCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 16,
  },
  orderAuditTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  orderAuditOrderNumber: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  auditCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  auditCardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  auditSubtitle: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
  },
  auditEmptyText: {
    fontSize: 13,
    color: '#94A3B8',
    fontStyle: 'italic',
  },
  auditTimelineItem: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    paddingVertical: 6,
  },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2563EB',
    marginTop: 6,
  },
  timelineContent: {
    flex: 1,
    gap: 2,
  },
  timelineTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  timelineDate: {
    fontSize: 11,
    color: '#64748B',
  },
  discrepancyBox: {
    backgroundColor: '#FFFBEB',
    borderLeftWidth: 3,
    borderLeftColor: '#D97706',
    padding: 10,
    borderRadius: 6,
    gap: 3,
  },
  discrepancyTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400E',
  },
  discrepancyNotes: {
    fontSize: 12,
    color: '#78350F',
  },
  qcBox: {
    backgroundColor: '#F8FAFC',
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  qcTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  packingBox: {
    backgroundColor: '#F0FDF4',
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  packingTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#166534',
  },
  qrScanBox: {
    backgroundColor: '#F8FAFC',
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 2,
  },
  qrScanAction: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  qrScanDate: {
    fontSize: 11,
    color: '#64748B',
  },
  timelineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F1F5F9',
  },
  timelineTransition: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  timelineTimestamp: {
    fontSize: 11,
    color: '#64748B',
  },
});
