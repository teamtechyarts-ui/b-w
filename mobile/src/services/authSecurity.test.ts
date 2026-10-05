import * as authApi from './authApi';
import * as apiModule from './api';

jest.mock('./api', () => ({
  apiRequest: jest.fn(),
}));

describe('Auth Security and No-Logging Verification', () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let infoSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it('never logs passwords or tokens during signUpCustomer', async () => {
    (apiModule.apiRequest as jest.Mock).mockResolvedValueOnce({
      session: { access_token: 'secret-token-xyz', refresh_token: 'secret-refresh-xyz' },
      user: { id: 'u1', email: 'test@example.com' },
    });

    const sensitivePassword = 'SuperSecretPassword123!';
    await authApi.signUpCustomer({
      fullName: 'Security Test',
      email: 'security@example.com',
      password: sensitivePassword,
      phone: '9876543210',
    });

    // Check all console calls
    [logSpy, warnSpy, errorSpy, infoSpy].forEach(spy => {
      spy.mock.calls.forEach(call => {
        const text = JSON.stringify(call);
        expect(text).not.toContain(sensitivePassword);
        expect(text).not.toContain('secret-token-xyz');
        expect(text).not.toContain('secret-refresh-xyz');
      });
    });

    // Ensure password is not passed in the URL path
    const callArgs = (apiModule.apiRequest as jest.Mock).mock.calls[0];
    const path = callArgs[0];
    expect(path).toBe('/auth/signup');
    expect(path).not.toContain(sensitivePassword);
  });

  it('never logs passwords or tokens during signInCustomer', async () => {
    (apiModule.apiRequest as jest.Mock).mockResolvedValueOnce({
      session: { access_token: 'secret-token-abc', refresh_token: 'secret-refresh-abc' },
      user: { id: 'u2', email: 'test2@example.com' },
    });

    const sensitivePassword = 'AnotherSecretPassword999!';
    await authApi.signInCustomer({
      email: 'test2@example.com',
      password: sensitivePassword,
    });

    [logSpy, warnSpy, errorSpy, infoSpy].forEach(spy => {
      spy.mock.calls.forEach(call => {
        const text = JSON.stringify(call);
        expect(text).not.toContain(sensitivePassword);
        expect(text).not.toContain('secret-token-abc');
        expect(text).not.toContain('secret-refresh-abc');
      });
    });

    const callArgs = (apiModule.apiRequest as jest.Mock).mock.calls[0];
    const path = callArgs[0];
    expect(path).toBe('/auth/signin');
    expect(path).not.toContain(sensitivePassword);
  });

  it('never puts reset password in URL parameters or logs', async () => {
    (apiModule.apiRequest as jest.Mock).mockResolvedValueOnce({ success: true });

    const newPassword = 'NewSecretPassword777!';
    const accessToken = 'recovery-bearer-token';
    await authApi.resetPassword(newPassword, accessToken);

    [logSpy, warnSpy, errorSpy, infoSpy].forEach(spy => {
      spy.mock.calls.forEach(call => {
        const text = JSON.stringify(call);
        expect(text).not.toContain(newPassword);
        expect(text).not.toContain(accessToken);
      });
    });

    const callArgs = (apiModule.apiRequest as jest.Mock).mock.calls[0];
    const path = callArgs[0];
    expect(path).toBe('/auth/reset-password');
    expect(path).not.toContain(newPassword);
  });
});
