import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import NativeQrScannerButton from '../components/NativeQrScannerButton';
import AppIcon from '../components/AppIcon';
import {
  DriverDashboard,
  DriverJob,
  claimDriverJob,
  formatDriverAddress,
  getDriverDashboard,
  lookupDriverOrder,
} from '../services/driverAssignmentsApi';
import {
  DriverProfile,
  getDriverProfile,
  setDriverAvailability,
} from '../services/driverProfileApi';
import {useDriverRealtime} from '../hooks/useRealtime';
import {RealtimeEventPayload} from '../services/realtimeService';

type Props = {
  accessToken: string;
  onJob: (id: string) => void;
  onNotifications: () => void;
  onProfile: () => void;
  onLogout: () => Promise<void>;
};

const readable = (value: string) =>
  value.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());

const actionLabel = (job: DriverJob) =>
  job.assignmentStatus === 'assigned'
    ? 'Review assignment'
    : job.assignmentStatus === 'accepted'
    ? 'Start route'
    : job.assignmentStatus === 'en_route'
    ? 'Navigate'
    : 'Continue handoff';

function AvailableJobQueue({
  title,
  type,
  jobs,
  claimingId,
  onClaim,
}: {
  title: string;
  type: 'pickup' | 'delivery';
  jobs: DriverJob[];
  claimingId: string | null;
  onClaim: (orderId: string, type: 'pickup' | 'delivery') => void;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.heading}>{title}</Text>
        <View style={styles.countBadge}>
          <Text style={styles.countBadgeText}>{jobs.length}</Text>
        </View>
      </View>
      {jobs.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No available {type}s</Text>
          <Text style={styles.muted}>Open {type} jobs will appear here when ready.</Text>
        </View>
      ) : (
        jobs.map(job => {
          const isClaiming = claimingId === job.orderId;
          return (
            <View key={`avail-${job.id}`} style={[styles.card, styles.availableCard]}>
              <View style={styles.cardTop}>
                <View
                  style={[
                    styles.badge,
                    type === 'pickup' ? styles.pickupBadge : styles.deliveryBadge,
                  ]}
                >
                  <Text style={styles.badgeText}>
                    {type === 'pickup' ? 'AVAILABLE PICKUP' : 'AVAILABLE DELIVERY'}
                  </Text>
                </View>
                <Text style={styles.availableTag}>Open to Claim</Text>
              </View>
              <Text style={styles.orderId}>Order ID: {job.orderNumber}</Text>
              <Text style={styles.meta}>
                Facility: {job.facility?.name ?? 'Facility unavailable'}
              </Text>
              <Text style={styles.address}>{formatDriverAddress(job.address)}</Text>
              {type === 'pickup' && job.pickupScheduledAt ? (
                <Text style={styles.meta}>
                  Scheduled: {new Date(job.pickupScheduledAt).toLocaleString()}{' '}
                  {job.pickupSlotLabel ?? ''}
                </Text>
              ) : null}
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Accept ${type} for order ${job.orderNumber}`}
                disabled={isClaiming}
                style={[styles.claimButton, isClaiming && styles.claimButtonDisabled]}
                onPress={() => onClaim(job.orderId, type)}
              >
                {isClaiming ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.claimButtonText}>
                    Accept {type === 'pickup' ? 'Pickup' : 'Delivery'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          );
        })
      )}
    </View>
  );
}

function JobQueue({
  title,
  jobs,
  onJob,
}: {
  title: string;
  jobs: DriverJob[];
  onJob: (id: string) => void;
}) {
  const activeJobs = jobs.filter(job => job.assignmentStatus !== 'completed');
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>{title}</Text>
      {activeJobs.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>All clear</Text>
          <Text style={styles.muted}>No {title.toLowerCase()} assigned.</Text>
        </View>
      ) : (
        activeJobs.map(job => (
          <View key={job.id} style={styles.card}>
            <View style={styles.cardTop}>
              <View
                style={[
                  styles.badge,
                  job.type === 'pickup' ? styles.pickupBadge : styles.deliveryBadge,
                ]}
              >
                <Text style={styles.badgeText}>
                  {job.type === 'pickup' ? 'PICKUP' : 'DELIVERY'}
                </Text>
              </View>
              <Text style={styles.status}>{readable(job.assignmentStatus)}</Text>
            </View>
            <Text style={styles.orderId}>Order ID: {job.orderNumber}</Text>
            <Text style={styles.meta}>
              Facility: {job.facility?.name ?? 'Facility unavailable'}
            </Text>
            <Text style={styles.address}>{formatDriverAddress(job.address)}</Text>
            {job.type === 'pickup' && job.pickupScheduledAt ? (
              <Text style={styles.meta}>
                {new Date(job.pickupScheduledAt).toLocaleString()}{' '}
                {job.pickupSlotLabel ?? ''}
              </Text>
            ) : null}
            <Text style={styles.meta}>
              Assigned {new Date(job.assignedAt).toLocaleString()}
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              style={styles.primaryButton}
              onPress={() => onJob(job.id)}
            >
              <Text style={styles.primaryText}>{actionLabel(job)} →</Text>
            </TouchableOpacity>
          </View>
        ))
      )}
    </View>
  );
}

export default function DriverDashboardScreen({
  accessToken,
  onJob,
  onNotifications,
  onProfile,
  onLogout,
}: Props) {
  const [dashboard, setDashboard] = useState<DriverDashboard | null>(null);
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lookupCode, setLookupCode] = useState('');
  const [lookupError, setLookupError] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const [togglingAvailability, setTogglingAvailability] = useState(false);
  const [availabilityError, setAvailabilityError] = useState('');
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimError, setClaimError] = useState('');

  const load = useCallback(
    async (refresh = false) => {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError('');
      setAvailabilityError('');
      setClaimError('');
      try {
        const [nextDashboard, nextProfile] = await Promise.all([
          getDriverDashboard(accessToken),
          getDriverProfile(accessToken).catch(() => null),
        ]);
        setDashboard(nextDashboard);
        if (nextProfile) setProfile(nextProfile);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Assignments unavailable.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [accessToken],
  );

  useDriverRealtime(
    profile?.id,
    useCallback(
      (event: RealtimeEventPayload) => {
        if (event.eventType === 'JOB_CLAIMED' && event.orderId) {
          setDashboard(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              availablePickups: (prev.availablePickups || []).filter(j => j.orderId !== event.orderId),
              availableDeliveries: (prev.availableDeliveries || []).filter(j => j.orderId !== event.orderId),
            };

          });
        }
        load(true);
      },
      [load],
    ),
    accessToken,
    !!accessToken,
  );

  useEffect(() => {
    load();
  }, [load]);

  const handleClaimJob = async (orderId: string, jobType: 'pickup' | 'delivery') => {
    if (claimingId) return;
    setClaimingId(orderId);
    setClaimError('');
    try {
      const res = await claimDriverJob(accessToken, orderId, jobType);
      if (res?.assignment?.id) {
        onJob(res.assignment.id);
        return;
      }
      await load(true);
    } catch (cause) {
      await load(true);
      setClaimError(
        cause instanceof Error
          ? cause.message
          : 'This job is no longer available or was claimed by another driver.',
      );
    } finally {
      setClaimingId(null);
    }
  };

  const openLookup = async (code: string) => {
    if (lookingUp) return;
    setLookingUp(true);
    setLookupError('');
    try {
      const result = await lookupDriverOrder(accessToken, code);
      onJob(result.assignmentId);
    } catch (cause) {
      setLookupError(cause instanceof Error ? cause.message : 'Assigned order not found.');
    } finally {
      setLookingUp(false);
    }
  };

  const handleToggleAvailability = async () => {
    if (!profile || togglingAvailability) return;
    const targetState = !profile.is_available;
    setTogglingAvailability(true);
    setAvailabilityError('');
    try {
      await setDriverAvailability(accessToken, targetState);
      setProfile(current => (current ? {...current, is_available: targetState} : null));
      const nextDashboard = await getDriverDashboard(accessToken);
      setDashboard(nextDashboard);
    } catch {
      setAvailabilityError('Unable to update availability. Please try again.');
    } finally {
      setTogglingAvailability(false);
    }
  };

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              load(true);
            }}
          />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>DRIVER OPERATIONS</Text>
            <Text style={styles.title}>Today’s route</Text>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Driver notifications"
              style={styles.icon}
              onPress={onNotifications}
            >
              <AppIcon name="bell" size={18} color="#111827" />
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Driver profile"
              style={styles.icon}
              onPress={onProfile}
            >
              <AppIcon name="user" size={18} color="#111827" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Global Loading Spinner */}
        {loading && !dashboard ? (
          <ActivityIndicator accessibilityLabel="Loading assignments" size="large" color="#151515" />
        ) : null}

        {/* Error Alert */}
        {error ? (
          <View style={styles.alert}>
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => {
                load();
              }}
            >
              <Text style={styles.link}>Retry assignments</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {dashboard ? (
          <>
            <Text style={styles.date}>{dashboard.date}</Text>

            {/* ======================================================== */}
            {/* AVAILABILITY FOR JOBS CONTROL */}
            {/* ======================================================== */}
            <View style={styles.availabilityCard}>
              <View style={styles.availabilityInfo}>
                <Text style={styles.availabilityHeaderLabel}>Availability for Jobs</Text>
                {profile ? (
                  <>
                    <Text style={styles.availabilityStatusText}>
                      {profile.is_available ? 'Available' : 'Unavailable'}
                    </Text>
                    <Text style={styles.availabilitySubtitle}>
                      {profile.is_available
                        ? 'Ready to receive new jobs'
                        : "You won't receive new jobs"}
                    </Text>
                  </>
                ) : (
                  <Text style={styles.availabilitySubtitle}>Loading availability state…</Text>
                )}
              </View>

              <TouchableOpacity
                accessibilityRole="switch"
                accessibilityLabel="Toggle job availability"
                accessibilityState={{checked: profile?.is_available ?? false}}
                disabled={!profile || togglingAvailability}
                style={[
                  styles.toggleButton,
                  profile?.is_available ? styles.toggleOnButton : styles.toggleOffButton,
                  (!profile || togglingAvailability) && styles.toggleDisabled,
                ]}
                onPress={handleToggleAvailability}
              >
                {togglingAvailability ? (
                  <ActivityIndicator
                    color={profile?.is_available ? '#FFFFFF' : '#151515'}
                    size="small"
                  />
                ) : (
                  <Text
                    style={[
                      styles.toggleText,
                      profile?.is_available ? styles.toggleOnText : styles.toggleOffText,
                    ]}
                  >
                    {profile?.is_available ? 'ON' : 'OFF'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Availability Error Banner */}
            {availabilityError ? (
              <View style={styles.availabilityErrorBanner} accessibilityRole="alert">
                <Text style={styles.availabilityErrorText}>{availabilityError}</Text>
              </View>
            ) : null}

            {/* Summary Metrics */}
            <View style={styles.summary}>
              <View>
                <Text style={styles.metric}>
                  {(dashboard.availablePickups?.length ?? 0) +
                    (dashboard.availableDeliveries?.length ?? 0)}
                </Text>
                <Text style={styles.summaryLabel}>Available</Text>
              </View>
              <View>
                <Text style={styles.metric}>
                  {dashboard.pickups.length + dashboard.deliveries.length}
                </Text>
                <Text style={styles.summaryLabel}>My Active</Text>
              </View>
              <View>
                <Text style={styles.metric}>{dashboard.summary.completed}</Text>
                <Text style={styles.summaryLabel}>Completed</Text>
              </View>
            </View>

            {/* Claim Error Alert */}
            {claimError ? (
              <View style={styles.claimErrorBanner} accessibilityRole="alert">
                <Text style={styles.claimErrorText}>{claimError}</Text>
              </View>
            ) : null}

            {/* ======================================================== */}
            {/* AVAILABLE JOBS QUEUES */}
            {/* ======================================================== */}
            <Text style={styles.sectionSuperHeading}>AVAILABLE JOBS</Text>

            <AvailableJobQueue
              title="Available Pickups"
              type="pickup"
              jobs={dashboard.availablePickups ?? []}
              claimingId={claimingId}
              onClaim={handleClaimJob}
            />

            <AvailableJobQueue
              title="Available Deliveries"
              type="delivery"
              jobs={dashboard.availableDeliveries ?? []}
              claimingId={claimingId}
              onClaim={handleClaimJob}
            />

            {/* ======================================================== */}
            {/* MY ACTIVE JOBS */}
            {/* ======================================================== */}
            <Text style={styles.sectionSuperHeading}>MY ACTIVE JOBS</Text>

            {/* Search / Scan Order */}
            <View style={styles.lookupCard}>
              <NativeQrScannerButton label="Scan Order QR" onScanned={openLookup} />
              <Text style={styles.lookupLabel}>Search Order</Text>
              <View style={styles.lookupRow}>
                <TextInput
                  accessibilityLabel="Order number or QR payload"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  placeholder="BW-20260921-95FFAB54"
                  value={lookupCode}
                  onChangeText={setLookupCode}
                  style={styles.input}
                />
                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={lookingUp}
                  style={styles.searchButton}
                  onPress={() => openLookup(lookupCode)}
                >
                  <Text style={styles.primaryText}>{lookingUp ? 'Finding…' : 'Find'}</Text>
                </TouchableOpacity>
              </View>
              {lookupError ? (
                <Text accessibilityRole="alert" style={styles.error}>
                  {lookupError}
                </Text>
              ) : null}
            </View>

            {!dashboard.pickups.length && !dashboard.deliveries.length ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>No active jobs assigned</Text>
                <Text style={styles.muted}>
                  Accept an available pickup or delivery above to begin.
                </Text>
              </View>
            ) : null}

            <JobQueue title="My Pickup Queue" jobs={dashboard.pickups} onJob={onJob} />
            <JobQueue title="My Delivery Queue" jobs={dashboard.deliveries} onJob={onJob} />
          </>
        ) : !loading && !error ? (
          <Text>No assignment data available.</Text>
        ) : null}

        <TouchableOpacity
          accessibilityRole="button"
          style={styles.logout}
          onPress={() => {
            onLogout();
          }}
        >
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
    padding: 18,
    paddingBottom: 36,
    gap: 16,
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  eyebrow: {
    fontSize: 11,
    letterSpacing: 1.4,
    fontWeight: '800',
    color: '#67635B',
  },
  title: {
    fontSize: 30,
    fontWeight: '900',
    color: '#151515',
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E2DED6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  date: {
    fontWeight: '700',
    color: '#67635B',
  },

  /* Availability Card */
  availabilityCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E2DED6',
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  availabilityInfo: {
    flex: 1,
    gap: 3,
  },
  availabilityHeaderLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: '#6D685F',
    textTransform: 'uppercase',
  },
  availabilityStatusText: {
    fontSize: 18,
    fontWeight: '900',
    color: '#151515',
    marginTop: 2,
  },
  availabilitySubtitle: {
    fontSize: 12,
    color: '#6D685F',
    fontWeight: '600',
    marginTop: 1,
  },
  toggleButton: {
    minWidth: 70,
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleOnButton: {
    backgroundColor: '#151515',
  },
  toggleOffButton: {
    backgroundColor: '#EDEAE3',
    borderWidth: 1,
    borderColor: '#D4D0C8',
  },
  toggleDisabled: {
    opacity: 0.6,
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  toggleOnText: {
    color: '#FFFFFF',
  },
  toggleOffText: {
    color: '#6D685F',
  },
  availabilityErrorBanner: {
    backgroundColor: '#FFEBEE',
    borderWidth: 1,
    borderColor: '#FFCDD2',
    borderRadius: 12,
    padding: 12,
  },
  availabilityErrorText: {
    color: '#C62828',
    fontSize: 13,
    fontWeight: '700',
  },

  /* Claim Error Banner */
  claimErrorBanner: {
    backgroundColor: '#FFF3E0',
    borderWidth: 1,
    borderColor: '#FFE0B2',
    borderRadius: 12,
    padding: 12,
  },
  claimErrorText: {
    color: '#E65100',
    fontSize: 13,
    fontWeight: '700',
  },

  /* Summary Metrics */
  summary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#151515',
    borderRadius: 18,
    padding: 18,
  },
  metric: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '900',
  },
  summaryLabel: {
    color: '#D8D5CE',
  },
  muted: {
    color: '#6D685F',
  },
  sectionSuperHeading: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1.2,
    color: '#8A857B',
    marginTop: 8,
    textTransform: 'uppercase',
  },
  section: {
    gap: 10,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  heading: {
    fontSize: 20,
    fontWeight: '900',
    color: '#181715',
  },
  countBadge: {
    backgroundColor: '#151515',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  countBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  lookupCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E2DED6',
    padding: 14,
    gap: 10,
  },
  lookupLabel: {
    fontWeight: '900',
    fontSize: 16,
  },
  lookupRow: {
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderColor: '#CFCAC0',
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  searchButton: {
    minWidth: 72,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: '#151515',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E2DED6',
    padding: 16,
    gap: 9,
  },
  availableCard: {
    borderColor: '#C8E6C9',
    backgroundColor: '#FAFCFA',
    borderWidth: 1.5,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  badge: {
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  pickupBadge: {
    backgroundColor: '#E7F3EB',
  },
  deliveryBadge: {
    backgroundColor: '#E8EEF8',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '900',
  },
  status: {
    fontWeight: '800',
    color: '#5E5A53',
  },
  availableTag: {
    fontWeight: '900',
    fontSize: 12,
    color: '#2E7D32',
  },
  orderId: {
    fontWeight: '900',
    fontSize: 15,
  },
  address: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '800',
  },
  meta: {
    color: '#6D685F',
  },
  primaryButton: {
    minHeight: 46,
    backgroundColor: '#151515',
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  primaryText: {
    color: '#fff',
    fontWeight: '900',
  },
  claimButton: {
    minHeight: 48,
    backgroundColor: '#1B5E20',
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  claimButtonDisabled: {
    opacity: 0.6,
  },
  claimButtonText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 15,
  },
  empty: {
    backgroundColor: '#EDEAE3',
    borderRadius: 16,
    padding: 16,
  },
  emptyTitle: {
    fontWeight: '900',
    fontSize: 16,
  },
  alert: {
    backgroundColor: '#FFF0EE',
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  error: {
    color: '#9A241E',
  },
  link: {
    fontWeight: '900',
  },
  logout: {
    alignItems: 'center',
    padding: 14,
  },
  logoutText: {
    color: '#8C2D26',
    fontWeight: '800',
  },
});
