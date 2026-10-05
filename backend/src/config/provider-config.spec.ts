import {
  credentialValue,
  getProviderConfiguration,
  validateProviderConfiguration,
} from './provider-config';

describe('provider configuration', () => {
  const liveMaps = {
    GOOGLE_MAPS_SERVER_KEY: 'unit-test-maps-key',
  };
  const liveRazorpay = {
    RAZORPAY_KEY_ID: 'unit-test-key-id',
    RAZORPAY_KEY_SECRET: 'unit-test-key-secret',
    RAZORPAY_WEBHOOK_SECRET: 'unit-test-webhook-secret',
  };

  it('identifies unconfigured state when credentials are empty in development', () => {
    expect(getProviderConfiguration({ NODE_ENV: 'development' })).toMatchObject({
      maps: { configured: false },
      payments: { configured: false },
    });
  });

  it('validates provider configuration successfully in development', () => {
    const env = { NODE_ENV: 'development' };
    expect(validateProviderConfiguration(env)).toEqual(env);
  });

  it('requires all provider variables in production', () => {
    expect(() => getProviderConfiguration({ NODE_ENV: 'production' })).toThrow(
      'Google Maps requires GOOGLE_MAPS_SERVER_KEY',
    );

    expect(() =>
      getProviderConfiguration({
        NODE_ENV: 'production',
        ...liveMaps,
      }),
    ).toThrow('Razorpay requires RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET');
  });

  it('accepts valid credentials in production', () => {
    expect(
      getProviderConfiguration({
        NODE_ENV: 'production',
        ...liveMaps,
        ...liveRazorpay,
      }),
    ).toMatchObject({
      nodeEnv: 'production',
      maps: { serverKey: 'unit-test-maps-key', configured: true },
      payments: {
        keyId: 'unit-test-key-id',
        keySecret: 'unit-test-key-secret',
        webhookSecret: 'unit-test-webhook-secret',
        configured: true,
      },
    });
  });

  it.each([
    'replace_me',
    'placeholder',
    'your_key_here',
    '<insert-key>',
  ])('detects %s as placeholder', (val) => {
    expect(credentialValue({ TEST_KEY: val }, 'TEST_KEY')).toBeUndefined();
  });
});
