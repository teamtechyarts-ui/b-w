import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppThrottlerGuard } from './app-throttler.guard';

describe('AppThrottlerGuard', () => {
  let guard: AppThrottlerGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new AppThrottlerGuard(
      { throttlers: [{ name: 'default', ttl: 60000, limit: 100 }] },
      {} as any,
      reflector,
    );
  });

  describe('getTracker', () => {
    it('uses authenticated user id when user is present on req', async () => {
      const req = {
        user: { id: 'user-uuid-123' },
        ip: '127.0.0.1',
      };
      const tracker = await (guard as any).getTracker(req);
      expect(tracker).toBe('usr_user-uuid-123');
    });

    it('incorporates facility id when user has facility_id', async () => {
      const req = {
        user: { id: 'user-uuid-123', facility_id: 'facility-uuid-456' },
        ip: '127.0.0.1',
      };
      const tracker = await (guard as any).getTracker(req);
      expect(tracker).toBe('fac_facility-uuid-456:usr_user-uuid-123');
    });

    it('falls back to client ip for unauthenticated requests', async () => {
      const req = {
        ip: '203.0.113.195',
        socket: { remoteAddress: '203.0.113.195' },
      };
      const tracker = await (guard as any).getTracker(req);
      expect(tracker).toBe('ip_203.0.113.195');
    });

    it('does not trust spoofed client headers for user identity', async () => {
      const req = {
        headers: {
          'x-user-id': 'spoofed-admin-id',
          'x-forwarded-user': 'another-spoofed-user',
        },
        ip: '198.51.100.5',
      };
      const tracker = await (guard as any).getTracker(req);
      expect(tracker).toBe('ip_198.51.100.5');
      expect(tracker).not.toContain('spoofed');
    });

    it('isolates two distinct users sharing the same local or proxy IP', async () => {
      const reqUser1 = {
        user: { id: 'facility-staff-1', facility_id: 'facility-main' },
        ip: '127.0.0.1',
      };
      const reqUser2 = {
        user: { id: 'facility-staff-2', facility_id: 'facility-main' },
        ip: '127.0.0.1',
      };

      const tracker1 = await (guard as any).getTracker(reqUser1);
      const tracker2 = await (guard as any).getTracker(reqUser2);

      expect(tracker1).toBe('fac_facility-main:usr_facility-staff-1');
      expect(tracker2).toBe('fac_facility-main:usr_facility-staff-2');
      expect(tracker1).not.toBe(tracker2);
    });
  });

  describe('generateKey', () => {
    it('unifies handlers in the same controller to prevent route-hopping abuse', () => {
      const context1 = {
        getClass: () => ({ name: 'FacilityController' }),
        getHandler: () => ({ name: 'intake' }),
      } as unknown as ExecutionContext;

      const context2 = {
        getClass: () => ({ name: 'FacilityController' }),
        getHandler: () => ({ name: 'verifyIntake' }),
      } as unknown as ExecutionContext;

      const key1 = (guard as any).generateKey(context1, 'usr_1', 'default');
      const key2 = (guard as any).generateKey(context2, 'usr_1', 'default');

      // Handlers in same controller share the 120 req/min bucket for that user
      expect(key1).toBeDefined();
      expect(key2).toBeDefined();
      expect(key1).toBe(key2);
    });

    it('creates distinct hash keys for different controllers and users', () => {
      const facilityContext = {
        getClass: () => ({ name: 'FacilityController' }),
      } as unknown as ExecutionContext;

      const customerContext = {
        getClass: () => ({ name: 'CustomersController' }),
      } as unknown as ExecutionContext;

      const facilityKeyUser1 = (guard as any).generateKey(facilityContext, 'usr_1', 'default');
      const customerKeyUser1 = (guard as any).generateKey(customerContext, 'usr_1', 'default');
      const facilityKeyUser2 = (guard as any).generateKey(facilityContext, 'usr_2', 'default');

      expect(facilityKeyUser1).not.toBe(customerKeyUser1);
      expect(facilityKeyUser1).not.toBe(facilityKeyUser2);
    });
  });
});
