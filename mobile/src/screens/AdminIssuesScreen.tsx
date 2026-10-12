import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {AdminIssueQueue, listAdminIssues} from '../services/adminIssuesApi';
import {useAdminRealtime} from '../hooks/useRealtime';

type Props = {accessToken: string; onBack: () => void; onOrder: (orderId: string) => void};

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

function label(value: string) {
  return value.replace(/_/g, ' ').toUpperCase();
}

export default function AdminIssuesScreen({accessToken, onBack, onOrder}: Props) {
  const [queue, setQueue] = useState<AdminIssueQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      setQueue(await listAdminIssues(accessToken));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to refresh customer issues. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [accessToken]);

  useAdminRealtime(
    useCallback(() => {
      load(true);
    }, [load]),
    accessToken,
    !!accessToken,
  );

  useEffect(() => {
    load();
  }, [load]);

  const claimsCount = queue?.claims.length ?? 0;
  const refundsCount = queue?.refunds.length ?? 0;
  const cancellationsCount = queue?.cancellations.length ?? 0;

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to Admin Dashboard">
          <Text style={styles.backLink}>← Admin Dashboard</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Customer Issues</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor="#1F5849" />}>
        
        <View style={styles.heroSection}>
          <Text style={styles.heroTitle}>Customer Issues Centre</Text>
          <Text style={styles.heroSubtitle}>Manage customer claims, refund requests, and cancellations.</Text>

          <View style={styles.metricsRow}>
            <View style={styles.metricCard}>
              <Text style={styles.metricNumber}>{claimsCount}</Text>
              <Text style={styles.metricLabel}>Claims</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricNumber}>{refundsCount}</Text>
              <Text style={styles.metricLabel}>Refunds</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricNumber}>{cancellationsCount}</Text>
              <Text style={styles.metricLabel}>Cancellations</Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.refreshButton}
            disabled={loading || refreshing}
            onPress={() => load(true)}
            accessibilityRole="button"
            accessibilityLabel="Refresh issues">
            <Text style={styles.refreshButtonText}>
              {loading || refreshing ? 'Refreshing...' : 'Refresh Issues'}
            </Text>
          </TouchableOpacity>

          {error ? (
            <View style={styles.inlineErrorBox}>
              <Text style={styles.inlineErrorText}>{error}</Text>
              <TouchableOpacity onPress={() => load(true)} accessibilityRole="button">
                <Text style={styles.retryActionText}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

        {loading && !queue ? (
          <ActivityIndicator style={styles.spinner} color="#1F5849" accessibilityLabel="Loading customer issues" />
        ) : null}

        {queue ? (
          <>
            {/* Claims Section */}
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionHeading}>OPEN CLAIMS</Text>
              <Text style={styles.sectionBadge}>{claimsCount}</Text>
            </View>

            {queue.claims.length > 0 ? (
              queue.claims.map(claim => (
                <TouchableOpacity
                  key={claim.id}
                  style={styles.card}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Claim ${claim.claim_type}, status ${claim.status}`}
                  onPress={() => onOrder(claim.order_id)}>
                  <View style={styles.cardTopRow}>
                    <Text style={styles.cardType}>{label(claim.claim_type)}</Text>
                    <View style={styles.statusBadge}>
                      <Text style={styles.statusBadgeText}>{claim.status.replace(/_/g, ' ')}</Text>
                    </View>
                  </View>

                  <Text style={styles.cardDesc} numberOfLines={2}>
                    {claim.description}
                  </Text>

                  <View style={styles.cardDivider} />

                  <View style={styles.cardFooter}>
                    <Text style={styles.cardMeta}>Submitted {formatShortDate(claim.created_at)}</Text>
                    <Text style={styles.viewAction}>View claim →</Text>
                  </View>
                </TouchableOpacity>
              ))
            ) : (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>No open claims</Text>
              </View>
            )}

            {/* Refunds Section */}
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionHeading}>REFUNDS</Text>
              <Text style={styles.sectionBadge}>{refundsCount}</Text>
            </View>

            {queue.refunds.length > 0 ? (
              queue.refunds.map(refund => (
                <TouchableOpacity
                  key={refund.id}
                  style={styles.card}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Refund ₹${Number(refund.amount).toFixed(2)}, status ${refund.status}`}
                  onPress={() => refund.payment_orders?.order_id && onOrder(refund.payment_orders.order_id)}>
                  <View style={styles.cardTopRow}>
                    <Text style={styles.cardAmount}>₹{Number(refund.amount).toFixed(2)}</Text>
                    <View style={styles.statusBadge}>
                      <Text style={styles.statusBadgeText}>{refund.status.replace(/_/g, ' ')}</Text>
                    </View>
                  </View>

                  <Text style={styles.cardDesc} numberOfLines={2}>
                    {refund.reason}
                  </Text>

                  <View style={styles.cardDivider} />

                  <View style={styles.cardFooter}>
                    <Text style={styles.cardMeta}>Requested {formatShortDate(refund.created_at)}</Text>
                    <Text style={styles.viewAction}>View refund →</Text>
                  </View>
                </TouchableOpacity>
              ))
            ) : (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>No refund requests</Text>
              </View>
            )}

            {/* Cancellations Section */}
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionHeading}>CANCELLATIONS</Text>
              <Text style={styles.sectionBadge}>{cancellationsCount}</Text>
            </View>

            {queue.cancellations.length > 0 ? (
              queue.cancellations.map(order => (
                <TouchableOpacity
                  key={order.id}
                  style={styles.card}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Order ${order.order_number} cancelled`}
                  onPress={() => onOrder(order.id)}>
                  <View style={styles.cardTopRow}>
                    <Text style={styles.cardType}>ORDER {order.order_number}</Text>
                    <View style={[styles.statusBadge, styles.statusBadgeCancelled]}>
                      <Text style={[styles.statusBadgeText, styles.statusBadgeTextCancelled]}>Cancelled</Text>
                    </View>
                  </View>

                  <View style={styles.cardDivider} />

                  <View style={styles.cardFooter}>
                    <Text style={styles.cardMeta}>Updated {formatShortDate(order.updated_at)}</Text>
                    <Text style={styles.viewAction}>View order →</Text>
                  </View>
                </TouchableOpacity>
              ))
            ) : (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>No cancellation requests</Text>
              </View>
            )}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#F8F9FA'},
  header: {
    height: 56,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#EBEBEB',
  },
  backLink: {fontSize: 14, fontWeight: '700', color: '#1F5849', minWidth: 60},
  headerTitle: {fontSize: 17, fontWeight: '800', color: '#1B1B18'},
  headerSpacer: {width: 60},
  content: {padding: 16, paddingBottom: 36},
  heroSection: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2DED6',
    padding: 16,
    marginBottom: 20,
  },
  heroTitle: {fontSize: 18, fontWeight: '800', color: '#1B1B18', marginBottom: 4},
  heroSubtitle: {fontSize: 13, color: '#656159', lineHeight: 18, marginBottom: 16},
  metricsRow: {flexDirection: 'row', gap: 10, marginBottom: 16},
  metricCard: {
    flex: 1,
    backgroundColor: '#F3EFE6',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2D8C6',
  },
  metricNumber: {fontSize: 20, fontWeight: '900', color: '#1B1B18'},
  metricLabel: {fontSize: 11, fontWeight: '700', color: '#656159', marginTop: 2},
  refreshButton: {
    backgroundColor: '#1F5849',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  refreshButtonText: {color: '#FFFFFF', fontSize: 13, fontWeight: '700'},
  inlineErrorBox: {marginTop: 12, padding: 10, backgroundColor: '#FDF2F2', borderRadius: 8, gap: 4},
  inlineErrorText: {color: '#9A241E', fontSize: 12, fontWeight: '600'},
  retryActionText: {color: '#1F5849', fontSize: 12, fontWeight: '700'},
  spinner: {marginVertical: 20},
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    marginBottom: 10,
  },
  sectionHeading: {fontSize: 12, fontWeight: '800', letterSpacing: 0.6, color: '#656159'},
  sectionBadge: {
    fontSize: 11,
    fontWeight: '800',
    backgroundColor: '#EBEBEB',
    color: '#4A463F',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2DED6',
    padding: 16,
    marginBottom: 12,
  },
  cardTopRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8},
  cardType: {fontSize: 14, fontWeight: '800', color: '#1B1B18'},
  cardAmount: {fontSize: 16, fontWeight: '800', color: '#1B1B18'},
  statusBadge: {
    backgroundColor: '#F3EFE6',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#E2D8C6',
  },
  statusBadgeText: {fontSize: 11, fontWeight: '700', color: '#1F5849', textTransform: 'capitalize'},
  statusBadgeCancelled: {backgroundColor: '#FDF2F2', borderColor: '#F8D7DA'},
  statusBadgeTextCancelled: {color: '#9A241E'},
  cardDesc: {fontSize: 13, color: '#4A463F', lineHeight: 18, marginBottom: 8},
  cardDivider: {height: 1, backgroundColor: '#F0EEEA', marginVertical: 8},
  cardFooter: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  cardMeta: {fontSize: 12, color: '#7A756D'},
  viewAction: {fontSize: 12, fontWeight: '700', color: '#1F5849'},
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EBEBEB',
    borderStyle: 'dashed',
    padding: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyText: {fontSize: 13, color: '#8A857C', fontWeight: '500'},
});
