import { FcmProvider } from './fcm.provider';

function fixture(environment: Record<string, string | undefined> = {}) {
  const send = jest.fn().mockResolvedValue('provider-message-id');
  const messaging = { send };
  const app = { name: '[DEFAULT]' };
  const credential = { test: true };
  const firebase = {
    applicationDefault: jest.fn(() => credential),
    cert: jest.fn(() => credential),
    getApps: jest.fn(() => []),
    initializeApp: jest.fn(() => app),
    getMessaging: jest.fn(() => messaging),
  };

  const provider = new FcmProvider({ environment, firebase } as any);
  return { provider, firebase, messaging, send, app, credential };
}

describe('FcmProvider', () => {
  it('fails safely without attempting Firebase initialization when unconfigured', async () => {
    const f = fixture();

    expect(f.provider.configured).toBe(false);
    await expect(
      f.provider.send({
        token: 'device-token',
        title: 'Order update',
        body: 'Your order was updated.',
      }),
    ).resolves.toEqual({ ok: false, reason: 'unconfigured' });
    expect(f.firebase.initializeApp).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });

  it('initializes from complete environment service-account credentials', async () => {
    const f = fixture({
      FIREBASE_PROJECT_ID: 'test-project',
      FIREBASE_CLIENT_EMAIL: 'test@example.invalid',
      FIREBASE_PRIVATE_KEY: 'line-one\\nline-two',
    });

    expect(f.provider.configured).toBe(true);
    expect(f.firebase.cert).toHaveBeenCalledWith({
      projectId: 'test-project',
      clientEmail: 'test@example.invalid',
      privateKey: 'line-one\nline-two',
    });

    await expect(
      f.provider.send({
        token: 'device-token',
        title: 'Order update',
        body: 'Your order was updated.',
        data: { orderId: 'order-id' },
      }),
    ).resolves.toEqual({
      ok: true,
      providerMessageId: 'provider-message-id',
    });
    expect(f.send).toHaveBeenCalledWith({
      token: 'device-token',
      notification: {
        title: 'Order update',
        body: 'Your order was updated.',
      },
      data: { orderId: 'order-id' },
      android: {
        priority: 'high',
        notification: {
          channelId: 'bright_white_notifications',
          sound: 'default',
          priority: 'high',
          defaultSound: true,
          defaultVibrateTimings: true,
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
          },
        },
      },
    });
  });

  it('uses application-default credentials when configured for ADC', () => {
    const f = fixture({ FIREBASE_PROJECT_ID: 'test-project' });

    expect(f.provider.configured).toBe(true);
    expect(f.firebase.applicationDefault).toHaveBeenCalledTimes(1);
    expect(f.firebase.cert).not.toHaveBeenCalled();
  });

  it('uses application-default credentials when GOOGLE_APPLICATION_CREDENTIALS is set even if placeholder service account keys exist in environment', () => {
    const f = fixture({
      GOOGLE_APPLICATION_CREDENTIALS: '/path/to/service-account.json',
      FIREBASE_PROJECT_ID: 'dev-bright-white',
      FIREBASE_CLIENT_EMAIL: 'dev-firebase@bright-white.local',
      FIREBASE_PRIVATE_KEY:
        '-----BEGIN PRIVATE KEY-----\\ndev-placeholder-private-key\\n-----END PRIVATE KEY-----\\n',
    });

    expect(f.provider.configured).toBe(true);
    expect(f.firebase.applicationDefault).toHaveBeenCalledTimes(1);
    expect(f.firebase.cert).not.toHaveBeenCalled();
  });

  it.each([
    'messaging/invalid-registration-token',
    'messaging/registration-token-not-registered',
  ])('classifies %s as an invalid device token', async errorCode => {
    const f = fixture({ FIREBASE_PROJECT_ID: 'test-project' });
    f.send.mockRejectedValue({ code: errorCode, message: 'provider detail' });

    await expect(
      f.provider.send({
        token: 'device-token',
        title: 'Order update',
        body: 'Your order was updated.',
      }),
    ).resolves.toEqual({
      ok: false,
      reason: 'invalid_token',
      errorCode,
    });
  });

  it('maps transient failures without returning provider error messages', async () => {
    const f = fixture({ FIREBASE_PROJECT_ID: 'test-project' });
    f.send.mockRejectedValue({
      code: 'messaging/server-unavailable',
      message: 'sensitive provider detail',
    });

    await expect(
      f.provider.send({
        token: 'device-token',
        title: 'Order update',
        body: 'Your order was updated.',
      }),
    ).resolves.toEqual({
      ok: false,
      reason: 'transient',
      errorCode: 'messaging/server-unavailable',
    });
  });

  it('fails safely if Firebase initialization rejects the environment credentials', async () => {
    const f = fixture({ FIREBASE_PROJECT_ID: 'test-project' });
    f.firebase.getMessaging.mockImplementation(() => {
      throw new Error('credential failure');
    });
    const provider = new FcmProvider({
      environment: { FIREBASE_PROJECT_ID: 'test-project' },
      firebase: f.firebase,
    } as any);

    expect(provider.configured).toBe(false);
    await expect(
      provider.send({
        token: 'device-token',
        title: 'Order update',
        body: 'Your order was updated.',
      }),
    ).resolves.toEqual({ ok: false, reason: 'unconfigured' });
  });
});
