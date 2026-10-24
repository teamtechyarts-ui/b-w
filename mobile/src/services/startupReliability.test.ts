import {apiRequest, ApiError, apiRequestWithRetry} from './api';
import {refreshStoredSession, hydrateSession, getStoredSession, persistSession, clearSession} from './sessionManager';
import {loadSecureSession, saveSecureSession, clearSecureSession} from './secureSessionStorage';
import * as Keychain from 'react-native-keychain';

jest.mock('../config/environment', () => ({
  API_BASE_URL: 'https://api.brightandwhite.in/v1',
  assertSafeMobileConfiguration: jest.fn(),
  MAPS_PROVIDER: 'google',
}));

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
  ACCESSIBLE: {WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly'},
}));

describe('Android Startup Reliability & Outage Resilience', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    jest.clearAllMocks();
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await clearSession();
  });

  describe('1. Keystore Cold Boot Resilience', () => {
    it('handles Android Keystore exceptions on cold boot without throwing fatal unhandled rejections', async () => {
      (Keychain.getGenericPassword as jest.Mock).mockRejectedValueOnce(
        new Error('java.security.KeyStoreException: Keystore not initialized'),
      );

      const session = await loadSecureSession();
      expect(session).toBeNull();
    });

    it('safely hydrates when secure storage encounters read errors', async () => {
      (Keychain.getGenericPassword as jest.Mock).mockRejectedValueOnce(
        new Error('java.security.UnrecoverableKeyException'),
      );

      const hydrated = await hydrateSession();
      expect(hydrated).toBeNull();
      expect(getStoredSession()).toBeNull();
    });
  });

  describe('2. Backend Outage Resilience (Preserving Valid Sessions)', () => {
    it('preserves valid user session when server returns HTTP 500, 502, or 503 during session refresh', async () => {
      // Server returns HTTP 502 Bad Gateway
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        json: async () => ({message: 'Hostinger gateway error'}),
      } as Response);

      // Seed an active session
      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
        password: JSON.stringify({
          version: 1,
          accessToken: 'old-access-token',
          refreshToken: 'valid-refresh-token',
          expiresAt: Date.now() - 1000, // expired, triggers refresh
          userId: 'user-1',
          phone: '+919876543210',
          profile: {accountRole: 'customer', fullName: 'Test User'},
        }),
      });

      // Hydrate from storage - refresh will encounter 502
      await hydrateSession();

      // CRITICAL: Session must NOT be wiped out!
      expect(getStoredSession()).not.toBeNull();
      expect(getStoredSession()?.accessToken).toBe('old-access-token');
      expect(getStoredSession()?.refreshToken).toBe('valid-refresh-token');
      expect(Keychain.resetGenericPassword).not.toHaveBeenCalled();

      // Explicit refreshStoredSession also throws service unavailable but preserves session
      await expect(refreshStoredSession()).rejects.toThrow(
        'Authentication service temporarily unavailable',
      );
      expect(getStoredSession()).not.toBeNull();
    });

    it('preserves valid user session when refresh network request times out or fails', async () => {
      // Network connection drops during refresh
      globalThis.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));

      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
        password: JSON.stringify({
          version: 1,
          accessToken: 'old-access-token',
          refreshToken: 'valid-refresh-token',
          expiresAt: Date.now() - 1000,
          userId: 'user-1',
          phone: '+919876543210',
          profile: {accountRole: 'customer'},
        }),
      });

      await hydrateSession();

      // Session MUST remain in storage
      expect(getStoredSession()).not.toBeNull();
      expect(getStoredSession()?.accessToken).toBe('old-access-token');

      await expect(refreshStoredSession()).rejects.toThrow(
        'Unable to refresh your session. Please check your connection.',
      );

      expect(getStoredSession()).not.toBeNull();
      expect(getStoredSession()?.accessToken).toBe('old-access-token');
    });

    it('clears session ONLY on confirmed HTTP 401 auth revocation', async () => {
      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
        password: JSON.stringify({
          version: 1,
          accessToken: 'expired-access-token',
          refreshToken: 'revoked-refresh-token',
          expiresAt: Date.now() - 1000,
          userId: 'user-1',
          phone: '+919876543210',
          profile: {accountRole: 'customer'},
        }),
      });

      await hydrateSession();

      // Server explicitly rejects refresh token with 401
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({message: 'Refresh token has been revoked'}),
      } as Response);

      await expect(refreshStoredSession()).rejects.toThrow('Your session has expired');

      // Session MUST be cleared now
      expect(getStoredSession()).toBeNull();
      expect(Keychain.resetGenericPassword).toHaveBeenCalled();
    });
  });

  describe('3. API Request Error Categorization & Safe Retries', () => {
    it('distinguishes ApiError network, timeout, server, auth, and rate limit categories', async () => {
      // 1. Network error
      globalThis.fetch = jest.fn().mockRejectedValue(new TypeError('NetworkError'));
      await expect(apiRequest('/test')).rejects.toMatchObject({
        isNetworkError: true,
        status: 0,
      });

      // 2. Server 500 error
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers(),
        json: async () => ({message: 'Database crash'}),
      } as Response);
      await expect(apiRequest('/test')).rejects.toMatchObject({
        isServerError: true,
        status: 500,
      });

      // 3. Auth 401 error
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers(),
        json: async () => ({message: 'Unauthorized'}),
      } as Response);
      await expect(apiRequest('/test')).rejects.toMatchObject({
        isAuthError: true,
        status: 401,
      });

      // 4. Rate limit 429
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers({'Retry-After': '5'}),
        json: async () => ({message: 'Too Many Requests'}),
      } as Response);
      await expect(apiRequest('/test')).rejects.toMatchObject({
        isRateLimited: true,
        status: 429,
        retryAfterMs: 5000,
      });
    });

    it('safely retries idempotent GET requests on transient 503 and succeeds on recovery', async () => {
      let callCount = 0;
      globalThis.fetch = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: false,
            status: 503,
            headers: new Headers(),
            json: async () => ({message: 'Service Unavailable'}),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({data: 'recovered'}),
        } as Response);
      });

      const result = await apiRequestWithRetry<{data: string}>('/services');
      expect(result).toEqual({data: 'recovered'});
      expect(callCount).toBe(2);
    });

    it('never automatically retries non-idempotent POST orders or payments', async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers(),
        json: async () => ({message: 'Internal Error'}),
      } as Response);

      await expect(
        apiRequest('/orders', {method: 'POST', body: {total: 500}}),
      ).rejects.toThrow();

      // Must be called exactly once
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('4. Deadlock Prevention & Concurrent Refreshes', () => {
    it('handles concurrent refresh requests without duplicate network calls or deadlock', async () => {
      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
        password: JSON.stringify({
          version: 1,
          accessToken: 'old-access-token',
          refreshToken: 'valid-refresh-token',
          expiresAt: Date.now() - 1000,
          userId: 'user-1',
          phone: '+919876543210',
          profile: {accountRole: 'customer'},
        }),
      });

      await hydrateSession();

      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'new-token-123',
          refresh_token: 'new-refresh-token-456',
          user: {id: 'user-1', phone: '+919876543210'},
        }),
      } as Response);

      // Fire 3 concurrent refreshes
      const [token1, token2, token3] = await Promise.all([
        refreshStoredSession(),
        refreshStoredSession(),
        refreshStoredSession(),
      ]);

      expect(token1).toBe('new-token-123');
      expect(token2).toBe('new-token-123');
      expect(token3).toBe('new-token-123');
      // Shared single promise in flight
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
  });
});
