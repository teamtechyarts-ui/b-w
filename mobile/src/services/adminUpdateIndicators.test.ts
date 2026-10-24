import {
  acknowledgeSection,
  clearAllIndicators,
  getIndicators,
  getSectionAcknowledgedAt,
  handleRealtimeAdminEvent,
  mapEventToSection,
  resetIndicatorsForTest,
  setSectionIndicator,
  syncUnreadNotifications,
} from './adminUpdateIndicators';
import {getNotifications} from './notificationsApi';
import {listAdminIssues} from './adminIssuesApi';

jest.mock('./notificationsApi', () => ({
  getNotifications: jest.fn(),
}));

jest.mock('./adminIssuesApi', () => ({
  listAdminIssues: jest.fn().mockResolvedValue({claims: [], refunds: [], cancellations: []}),
}));

describe('adminUpdateIndicators service', () => {
  beforeEach(() => {
    resetIndicatorsForTest();
    jest.clearAllMocks();
  });

  describe('mapEventToSection', () => {
    test('maps claims and refund events to issues section', () => {
      expect(mapEventToSection({eventType: 'claim.submitted'})).toBe('issues');
      expect(mapEventToSection({eventType: 'CLAIM_SUBMITTED'})).toBe('issues');
      expect(mapEventToSection({eventType: 'REFUND_REQUESTED'})).toBe('issues');
      expect(mapEventToSection({eventType: 'REFUND_APPROVED'})).toBe('issues');
      expect(mapEventToSection({eventType: 'REFUND_COMPLETED'})).toBe('issues');
      expect(mapEventToSection({notification_type: 'claim.submitted'})).toBe('issues');
      // Test nested broadcast payload format from backend
      expect(
        mapEventToSection({
          eventType: 'NOTIFICATION_CREATED',
          notification: { notification_type: 'claim.submitted' },
          data: { claimId: 'claim-123' },
        }),
      ).toBe('issues');
      expect(
        mapEventToSection({
          eventType: 'NOTIFICATION_CREATED',
          notification: { notification_type: 'refund.requested' },
          data: { refundId: 'ref-123' },
        }),
      ).toBe('issues');
    });

    test('maps driver and dispatch events to assignments section', () => {
      expect(mapEventToSection({eventType: 'DRIVER_ASSIGNED'})).toBe('assignments');
      expect(mapEventToSection({eventType: 'JOB_CLAIMED'})).toBe('assignments');
      expect(mapEventToSection({status: 'ready_for_delivery'})).toBe('assignments');
      expect(mapEventToSection({status: 'out_for_pickup'})).toBe('assignments');
    });

    test('maps facility processing events to facilities section', () => {
      expect(mapEventToSection({eventType: 'FACILITY_COLLECTED'})).toBe('facilities');
      expect(mapEventToSection({eventType: 'STAGE_PROGRESSION'})).toBe('facilities');
      expect(mapEventToSection({status: 'washing'})).toBe('facilities');
      expect(mapEventToSection({status: 'facility_processing'})).toBe('facilities');
      expect(mapEventToSection({eventType: 'REWASH_ORDER'})).toBe('facilities');
    });

    test('maps order lifecycle events to customers section', () => {
      expect(mapEventToSection({eventType: 'ORDER_CREATED'})).toBe('customers');
      expect(mapEventToSection({eventType: 'ORDER_STATUS_CHANGED', status: 'confirmed'})).toBe('customers');
      expect(mapEventToSection({eventType: 'ORDER_CANCELLED'})).toBe('customers');
    });

    test('maps staff, catalogue, locations, and growth programs correctly', () => {
      expect(mapEventToSection({eventType: 'STAFF_REGISTERED'})).toBe('staff');
      expect(mapEventToSection({eventType: 'CATALOGUE_UPDATED'})).toBe('catalogue');
      expect(mapEventToSection({eventType: 'FACILITY_CREATED'})).toBe('locations');
      expect(mapEventToSection({eventType: 'COUPON_CREATED'})).toBe('growth');
      expect(mapEventToSection({eventType: 'PACKAGE_PURCHASED'})).toBe('growth');
    });

    test('returns null for unrecognized events', () => {
      expect(mapEventToSection({eventType: 'UNKNOWN_SYSTEM_PING'})).toBeNull();
    });
  });

  describe('realtime event handling and acknowledgment', () => {
    test('activates green indicator when a new claim or refund arrives', () => {
      expect(getIndicators().issues).toBe(false);

      handleRealtimeAdminEvent({
        eventType: 'CLAIM_SUBMITTED',
        timestamp: new Date().toISOString(),
      });

      expect(getIndicators().issues).toBe(true);
    });

    test('clearing/acknowledging a section turns off the green dot and records timestamp', () => {
      setSectionIndicator('issues', true);
      expect(getIndicators().issues).toBe(true);

      const before = Date.now();
      acknowledgeSection('issues');
      const after = Date.now();

      expect(getIndicators().issues).toBe(false);
      const ackTime = getSectionAcknowledgedAt('issues');
      expect(ackTime).toBeGreaterThanOrEqual(before);
      expect(ackTime).toBeLessThanOrEqual(after);
    });

    test('ignores historical events that occurred prior to last acknowledgment', () => {
      const pastTime = new Date('2026-01-01T00:00:00Z').getTime();
      const eventTime = new Date('2026-01-02T00:00:00Z').toISOString();

      acknowledgeSection('issues'); // sets ack time to now (2026-10-...)

      handleRealtimeAdminEvent({
        eventType: 'CLAIM_SUBMITTED',
        timestamp: eventTime, // in the past relative to now
      });

      // Indicator should NOT be activated for past event
      expect(getIndicators().issues).toBe(false);
    });

    test('clearAllIndicators resets all sections and updates timestamps', () => {
      setSectionIndicator('issues', true);
      setSectionIndicator('customers', true);
      setSectionIndicator('facilities', true);

      clearAllIndicators();

      const state = getIndicators();
      expect(state.issues).toBe(false);
      expect(state.customers).toBe(false);
      expect(state.facilities).toBe(false);
    });
  });

  describe('syncUnreadNotifications', () => {
    test('activates indicators for unread notifications', async () => {
      const now = new Date().toISOString();
      (getNotifications as jest.Mock).mockResolvedValueOnce([
        {
          id: 'n1',
          notification_type: 'claim.submitted',
          title: 'Claim Submitted',
          is_read: false,
          created_at: now,
        },
        {
          id: 'n2',
          notification_type: 'order.created',
          title: 'Order Created',
          is_read: true, // already read -> should not trigger
          created_at: now,
        },
      ]);

      await syncUnreadNotifications('test-admin-token');

      const state = getIndicators();
      expect(state.issues).toBe(true);
      expect(state.customers).toBe(false);
    });
  });
});
