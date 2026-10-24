import {useCallback, useEffect, useState} from 'react';
import {getNotifications} from './notificationsApi';
import {listAdminIssues} from './adminIssuesApi';
import {useAdminRealtime} from '../hooks/useRealtime';

export type AdminSection =
  | 'issues'
  | 'customers'
  | 'assignments'
  | 'facilities'
  | 'staff'
  | 'catalogue'
  | 'locations'
  | 'growth'
  | 'reports';

export type IndicatorState = Record<AdminSection, boolean>;

const initialIndicators: IndicatorState = {
  issues: false,
  customers: false,
  assignments: false,
  facilities: false,
  staff: false,
  catalogue: false,
  locations: false,
  growth: false,
  reports: false,
};

const STORAGE_PREFIX = 'bw_admin_ack_';

let memoryStore: Record<string, IndicatorState> = {};
let memoryAckTimes: Record<string, Record<AdminSection, number>> = {};
const stateListeners = new Set<(key: string, state: IndicatorState) => void>();

function getAdminKey(token?: string): string {
  if (!token) return 'default';
  try {
    const parts = token.split('.');
    if (parts.length >= 2) {
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const json =
        typeof atob === 'function'
          ? atob(base64)
          : typeof Buffer !== 'undefined'
          ? Buffer.from(base64, 'base64').toString('utf8')
          : null;
      if (json) {
        const payload = JSON.parse(json);
        return payload.sub || payload.user_id || payload.id || 'default';
      }
    }
  } catch {
    // fallback to default
  }
  return 'default';
}

function loadPersistedAckTimes(adminKey: string): Record<AdminSection, number> {
  if (memoryAckTimes[adminKey]) {
    return memoryAckTimes[adminKey];
  }
  const loaded: Record<AdminSection, number> = {
    issues: 0,
    customers: 0,
    assignments: 0,
    facilities: 0,
    staff: 0,
    catalogue: 0,
    locations: 0,
    growth: 0,
    reports: 0,
  };
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${adminKey}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        for (const k of Object.keys(loaded) as AdminSection[]) {
          if (typeof parsed[k] === 'number') {
            loaded[k] = parsed[k];
          }
        }
      }
    }
  } catch {
    // Ignore storage errors
  }
  memoryAckTimes[adminKey] = loaded;
  return loaded;
}

function savePersistedAckTimes(adminKey: string, times: Record<AdminSection, number>): void {
  memoryAckTimes[adminKey] = { ...times };
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(`${STORAGE_PREFIX}${adminKey}`, JSON.stringify(times));
    }
  } catch {
    // Ignore storage errors
  }
}

export function getIndicators(adminKey = 'default'): IndicatorState {
  if (!memoryStore[adminKey]) {
    memoryStore[adminKey] = { ...initialIndicators };
  }
  return { ...memoryStore[adminKey] };
}

export function getSectionAcknowledgedAt(section: AdminSection, adminKey = 'default'): number {
  const times = loadPersistedAckTimes(adminKey);
  return times[section] || 0;
}

export function setSectionAcknowledgedAt(
  section: AdminSection,
  timestamp: number,
  adminKey = 'default',
): void {
  const times = loadPersistedAckTimes(adminKey);
  times[section] = timestamp;
  savePersistedAckTimes(adminKey, times);
}

export function setSectionIndicator(
  section: AdminSection,
  active: boolean,
  adminKey = 'default',
): void {
  if (!memoryStore[adminKey]) {
    memoryStore[adminKey] = { ...initialIndicators };
  }
  if (memoryStore[adminKey][section] !== active) {
    memoryStore[adminKey] = {
      ...memoryStore[adminKey],
      [section]: active,
    };
    notifyListeners(adminKey);
  }
}

export function acknowledgeSection(section: AdminSection, adminKey = 'default'): void {
  setSectionAcknowledgedAt(section, Date.now(), adminKey);
  setSectionIndicator(section, false, adminKey);
}

export function clearAllIndicators(adminKey = 'default'): void {
  const now = Date.now();
  const times = loadPersistedAckTimes(adminKey);
  for (const s of Object.keys(initialIndicators) as AdminSection[]) {
    times[s] = now;
  }
  savePersistedAckTimes(adminKey, times);
  memoryStore[adminKey] = { ...initialIndicators };
  notifyListeners(adminKey);
}

function notifyListeners(adminKey: string): void {
  const state = getIndicators(adminKey);
  stateListeners.forEach(listener => {
    try {
      listener(adminKey, state);
    } catch (err) {
      console.warn('[adminUpdateIndicators] listener error:', err);
    }
  });
}

export function subscribeToIndicators(
  listener: (adminKey: string, state: IndicatorState) => void,
): () => void {
  stateListeners.add(listener);
  return () => {
    stateListeners.delete(listener);
  };
}

/**
 * Maps raw real-time events or notifications to the corresponding dashboard section.
 */
export function mapEventToSection(event: {
  eventType?: string | null;
  notification_type?: string | null;
  type?: string | null;
  action?: string | null;
  status?: string | null;
  data?: any;
  notification?: any;
  title?: string | null;
  body?: string | null;
}): AdminSection | null {
  const candidateParts = [
    event.notification?.notification_type,
    event.notification?.event_type,
    event.notification_type,
    event.eventType,
    event.type,
    event.action,
    event.data?.eventType,
    event.data?.type,
    event.data?.action,
    event.data?.notificationType,
    event.data?.claimId ? 'claim' : '',
    event.data?.refundId ? 'refund' : '',
    event.data?.orderId ? 'order' : '',
    event.title || event.notification?.title || '',
    event.body || event.notification?.body || '',
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const rawType = candidateParts;

  const status = (
    event.status ||
    event.data?.status ||
    ''
  ).toLowerCase();

  // 1. Driver Dispatch (check job_claimed and driver first so job_claimed doesn't match claim)
  if (
    candidateParts.includes('driver') ||
    candidateParts.includes('dispatch') ||
    candidateParts.includes('job_claimed') ||
    [
      'ready_for_pickup',
      'out_for_pickup',
      'ready_for_delivery',
      'out_for_delivery',
      'pickup_arrived',
      'delivery_arrived',
    ].includes(status)
  ) {
    return 'assignments';
  }

  // 2. Claims & Refunds
  if (
    candidateParts.includes('claim') ||
    candidateParts.includes('refund') ||
    candidateParts.includes('issue')
  ) {
    return 'issues';
  }

  // 3. Laundry Locations (facilities management/zones)
  if (
    rawType.includes('location') ||
    rawType.includes('geofence') ||
    rawType === 'facility_created' ||
    rawType === 'facility_updated'
  ) {
    return 'locations';
  }

  // 4. Facility Operations (daily intake, washing, drying, QC)
  if (
    rawType.includes('facility') ||
    rawType.includes('stage') ||
    rawType.includes('rewash') ||
    rawType.includes('qc') ||
    [
      'facility_received',
      'facility_processing',
      'washing',
      'drying',
      'ironing',
      'qc_pending',
      'packed',
    ].includes(status)
  ) {
    return 'facilities';
  }

  // 4. Staff Management
  if (
    rawType.includes('staff') ||
    rawType.includes('employee') ||
    rawType === 'driver_registered' ||
    rawType === 'driver_status_changed'
  ) {
    return 'staff';
  }

  // 5. Services & Pricing (Catalogue)
  if (
    rawType.includes('catalogue') ||
    rawType.includes('service') ||
    rawType.includes('price') ||
    rawType.includes('garment')
  ) {
    return 'catalogue';
  }

  // 6. Laundry Locations
  if (
    rawType.includes('location') ||
    rawType.includes('geofence') ||
    rawType === 'facility_created' ||
    rawType === 'facility_updated'
  ) {
    return 'locations';
  }

  // 7. Growth Programs
  if (
    rawType.includes('coupon') ||
    rawType.includes('growth') ||
    rawType.includes('loyalty') ||
    rawType.includes('package') ||
    rawType.includes('promo')
  ) {
    return 'growth';
  }

  // 8. Orders & Customers
  if (
    rawType.includes('order') ||
    rawType.includes('customer') ||
    ['draft', 'pending_payment', 'confirmed', 'cancelled', 'completed'].includes(status)
  ) {
    return 'customers';
  }

  // 9. Analytics & Reports
  if (rawType.includes('report') || rawType.includes('audit')) {
    return 'reports';
  }

  return null;
}

/**
 * Evaluates an incoming real-time admin broadcast and updates the relevant section indicator
 * if the event is new (i.e. occurred at or after the last acknowledgment timestamp).
 */
export function handleRealtimeAdminEvent(
  event: any,
  adminKey = 'default',
): AdminSection | null {
  const section = mapEventToSection(event);
  if (!section) return null;

  const eventTime = event.timestamp
    ? new Date(event.timestamp).getTime()
    : Date.now();
  const lastAck = getSectionAcknowledgedAt(section, adminKey);

  // Distinguish new updates from old records:
  // Only trigger if event occurred after the admin's last acknowledgment
  if (eventTime >= lastAck) {
    setSectionIndicator(section, true, adminKey);
    return section;
  }
  return null;
}

/**
 * Synchronizes unread notifications scoped to the current admin into section indicators.
 * Respects lastAcknowledgedAt so historical unread items acknowledged previously don't trigger indicators.
 */
export async function syncUnreadNotifications(
  accessToken: string,
  adminKey = 'default',
): Promise<void> {
  if (!accessToken) return;
  try {
    const list = await getNotifications(accessToken);
    const unread = list.filter(item => !item.is_read);
    for (const item of unread) {
      const sec = mapEventToSection(item);
      if (sec) {
        const itemTime = new Date(item.created_at).getTime();
        const lastAck = getSectionAcknowledgedAt(sec, adminKey);
        if (itemTime > lastAck) {
          setSectionIndicator(sec, true, adminKey);
        }
      }
    }
  } catch {
    // Gracefully handle offline or network error without throwing
  }

  // Also synchronize actionable issues (claims & refunds) from listAdminIssues
  try {
    const issues = await listAdminIssues(accessToken);
    const lastAck = getSectionAcknowledgedAt('issues', adminKey);
    const hasNewClaim = (issues?.claims || []).some(
      c =>
        ['submitted', 'pending', 'under_review'].includes(c.status?.toLowerCase() || '') &&
        new Date(c.created_at).getTime() > lastAck,
    );
    const hasNewRefund = (issues?.refunds || []).some(
      r =>
        ['pending', 'requested'].includes(r.status?.toLowerCase() || '') &&
        new Date(r.created_at).getTime() > lastAck,
    );
    if (hasNewClaim || hasNewRefund) {
      setSectionIndicator('issues', true, adminKey);
    }
  } catch {
    // Gracefully handle offline or network error without throwing
  }
}

/**
 * React hook providing reactive green dot update indicators for the admin dashboard.
 * - Subscribes to Supabase Realtime 'admin:operations' events.
 * - Synchronizes with existing notification unread states.
 * - Provides acknowledgeSection() to clear the indicator when the admin navigates to the section.
 */
export function useAdminUpdateIndicators(
  accessToken?: string,
  enabled: boolean = true,
) {
  const adminKey = getAdminKey(accessToken);
  const [indicators, setIndicators] = useState<IndicatorState>(() => getIndicators(adminKey));

  useEffect(() => {
    setIndicators(getIndicators(adminKey));
    const unsubscribe = subscribeToIndicators((key, nextState) => {
      if (key === adminKey) {
        setIndicators(nextState);
      }
    });
    return unsubscribe;
  }, [adminKey]);

  useEffect(() => {
    if (enabled && accessToken) {
      syncUnreadNotifications(accessToken, adminKey);
    }
  }, [accessToken, adminKey, enabled]);

  const onRealtimeEvent = useCallback(
    (event: any) => {
      handleRealtimeAdminEvent(event, adminKey);
    },
    [adminKey],
  );

  useAdminRealtime(onRealtimeEvent, accessToken, enabled && !!accessToken);

  const acknowledge = useCallback(
    (section: AdminSection) => {
      acknowledgeSection(section, adminKey);
    },
    [adminKey],
  );

  const clearAll = useCallback(() => {
    clearAllIndicators(adminKey);
  }, [adminKey]);

  return {
    indicators,
    acknowledgeSection: acknowledge,
    clearAllIndicators: clearAll,
  };
}

export function resetIndicatorsForTest(): void {
  memoryStore = {};
  memoryAckTimes = {};
  stateListeners.clear();
}
