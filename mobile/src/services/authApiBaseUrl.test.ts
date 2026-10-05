import {
  signInCustomer,
  signUpCustomer,
  requestPasswordReset,
  resetPassword,
  getMyProfile,
} from './authApi';
import {API_BASE_URL} from '../config/environment';

jest.mock('./sessionManager', () => ({
  getStoredSession: jest.fn(() => null),
  refreshStoredSession: jest.fn(),
}));

describe('Auth API Base URL Verification', () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchSpy: jest.Mock;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchSpy = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        user: {id: 'usr_1', phone: '+919876543210'},
        session: {access_token: 'acc_token', refresh_token: 'ref_token'},
      }),
    });
    globalThis.fetch = fetchSpy;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('API_BASE_URL is not localhost:5173 or relative /v1', () => {
    expect(API_BASE_URL).not.toContain('5173');
    expect(API_BASE_URL).not.toBe('/v1');
    expect(API_BASE_URL).toMatch(/^http:\/\/127\.0\.0\.1:3000\/v1|^http:\/\/10\.0\.2\.2:3000\/v1/);
  });

  it('signInCustomer targets NestJS backend port 3000 and not 5173', async () => {
    await signInCustomer({email: 'test@example.com', password: 'password123'});

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = fetchSpy.mock.calls[0][0];
    expect(calledUrl).toBe(`${API_BASE_URL}/auth/signin`);
    expect(calledUrl).not.toContain('5173');
    expect(calledUrl).toContain(':3000/v1/auth/signin');
  });

  it('signUpCustomer targets NestJS backend port 3000 and not 5173', async () => {
    await signUpCustomer({
      email: 'test@example.com',
      password: 'password123',
      fullName: 'Test User',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = fetchSpy.mock.calls[0][0];
    expect(calledUrl).toBe(`${API_BASE_URL}/auth/signup`);
    expect(calledUrl).not.toContain('5173');
    expect(calledUrl).toContain(':3000/v1/auth/signup');
  });

  it('requestPasswordReset targets NestJS backend port 3000', async () => {
    await requestPasswordReset('test@example.com');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = fetchSpy.mock.calls[0][0];
    expect(calledUrl).toBe(`${API_BASE_URL}/auth/forgot-password`);
    expect(calledUrl).toContain(':3000/v1/auth/forgot-password');
  });

  it('resetPassword targets NestJS backend port 3000', async () => {
    await resetPassword('newpass123', 'test_token');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = fetchSpy.mock.calls[0][0];
    expect(calledUrl).toBe(`${API_BASE_URL}/auth/reset-password`);
    expect(calledUrl).toContain(':3000/v1/auth/reset-password');
  });

  it('getMyProfile targets NestJS backend port 3000', async () => {
    await getMyProfile('test_token');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = fetchSpy.mock.calls[0][0];
    expect(calledUrl).toBe(`${API_BASE_URL}/auth/me`);
    expect(calledUrl).toContain(':3000/v1/auth/me');
  });
});
