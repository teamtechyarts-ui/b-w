import { ProductionService } from './production.service';

describe('ProductionService provider diagnostics', () => {
  const originalEnvironment = {
    NODE_ENV: process.env.NODE_ENV,
    GOOGLE_MAPS_SERVER_KEY: process.env.GOOGLE_MAPS_SERVER_KEY,
    RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET,
  };

  afterEach(() => {
    for (const [name, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  it('returns only safe provider state', () => {
    process.env.NODE_ENV = 'development';
    process.env.GOOGLE_MAPS_SERVER_KEY = 'real-key';
    process.env.RAZORPAY_KEY_ID = 'rzp_id';
    process.env.RAZORPAY_KEY_SECRET = 'rzp_sec';
    process.env.RAZORPAY_WEBHOOK_SECRET = 'rzp_wh';
    const service = new ProductionService({} as any);

    const diagnostics = service.providerDiagnostics();

    expect(diagnostics).toEqual({
      nodeEnv: 'development',
      maps: { configured: true },
      payments: { configured: true },
    });
    expect(JSON.stringify(diagnostics)).not.toMatch(
      /key|secret|credential/i,
    );
  });
});
