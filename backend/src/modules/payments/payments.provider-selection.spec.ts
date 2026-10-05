import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsModule } from './payments.module';
import { PaymentsService } from './payments.service';
import { PAYMENT_PROVIDER, PaymentProvider } from './providers/payment.provider';
import { RazorpayPaymentProvider } from './providers/razorpay-payment.provider';
import { DevelopmentPaymentProvider } from './providers/development-payment.provider';
import { SupabaseService } from '../supabase/supabase.service';
import { LogisticsService } from '../logistics/logistics.service';

describe('PaymentsModule Provider Selection', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    delete process.env.NODE_ENV;
    process.env.GOOGLE_MAPS_SERVER_KEY = 'test-maps-key';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  describe('Development environment without credentials', () => {
    it('selects DevelopmentPaymentProvider when credentials are absent', async () => {
      process.env.NODE_ENV = 'development';

      const module: TestingModule = await Test.createTestingModule({
        imports: [PaymentsModule],
      })
        .overrideProvider(SupabaseService)
        .useValue({ admin: {} })
        .overrideProvider(LogisticsService)
        .useValue({})
        .compile();

      const provider = module.get<PaymentProvider>(PAYMENT_PROVIDER);
      expect(provider).toBeInstanceOf(DevelopmentPaymentProvider);
      expect(provider.mode).toBe('development');
      expect(provider.publicKeyId).toBeNull();
    });

    it('throws ServiceUnavailableException on createOrder in development without credentials', async () => {
      process.env.NODE_ENV = 'development';

      const mockDb = {
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: {
              id: 'order-dev-1',
              total_amount: 100,
              currency: 'INR',
              customer_id: 'cust-1',
              payment_method: 'razorpay',
              current_status: 'pending_payment',
            },
            error: null,
          }),
        }),
      };

      const module: TestingModule = await Test.createTestingModule({
        imports: [PaymentsModule],
      })
        .overrideProvider(SupabaseService)
        .useValue({ admin: mockDb })
        .overrideProvider(LogisticsService)
        .useValue({})
        .compile();

      const service = module.get<PaymentsService>(PaymentsService);
      const provider = module.get<PaymentProvider>(PAYMENT_PROVIDER);

      // Verify it is the development provider
      expect(provider).toBeInstanceOf(DevelopmentPaymentProvider);

      const spyCreateOrder = jest.spyOn(provider, 'createOrder');

      // Call createOrder
      await expect(
        service.createOrder('profile-1', 'order-dev-1'),
      ).rejects.toThrow('Online payment is temporarily unavailable. Please try again or choose Cash on Delivery.');

      // Provider's createOrder was never called (no Razorpay API contact)
      expect(spyCreateOrder).not.toHaveBeenCalled();
    });
  });

  describe('Development environment with credentials', () => {
    it('selects RazorpayPaymentProvider when credentials are provided in development', async () => {
      process.env.NODE_ENV = 'development';
      process.env.RAZORPAY_KEY_ID = 'rzp_test_dev123';
      process.env.RAZORPAY_KEY_SECRET = 'dev_secret_key_456';

      const module: TestingModule = await Test.createTestingModule({
        imports: [PaymentsModule],
      })
        .overrideProvider(SupabaseService)
        .useValue({ admin: {} })
        .overrideProvider(LogisticsService)
        .useValue({})
        .compile();

      const provider = module.get<PaymentProvider>(PAYMENT_PROVIDER);
      expect(provider).toBeInstanceOf(RazorpayPaymentProvider);
      expect(provider.mode).toBe('live');
      expect(provider.publicKeyId).toBe('rzp_test_dev123');
    });
  });

  describe('Production environment safeguards', () => {
    it('fails startup / throws error when Razorpay credentials are missing in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.GOOGLE_MAPS_SERVER_KEY = 'real-maps-key';
      delete process.env.RAZORPAY_KEY_ID;
      delete process.env.RAZORPAY_KEY_SECRET;
      delete process.env.RAZORPAY_WEBHOOK_SECRET;

      await expect(
        Test.createTestingModule({
          imports: [PaymentsModule],
        })
          .overrideProvider(SupabaseService)
          .useValue({ admin: {} })
          .overrideProvider(LogisticsService)
          .useValue({})
          .compile(),
      ).rejects.toThrow();
    });

    it('selects RazorpayPaymentProvider in production when all credentials are valid', async () => {
      process.env.NODE_ENV = 'production';
      process.env.GOOGLE_MAPS_SERVER_KEY = 'real-maps-key';
      process.env.RAZORPAY_KEY_ID = 'rzp_live_key123';
      process.env.RAZORPAY_KEY_SECRET = 'live_secret_key_456';
      process.env.RAZORPAY_WEBHOOK_SECRET = 'live_webhook_secret_789';

      const module: TestingModule = await Test.createTestingModule({
        imports: [PaymentsModule],
      })
        .overrideProvider(SupabaseService)
        .useValue({ admin: {} })
        .overrideProvider(LogisticsService)
        .useValue({})
        .compile();

      const provider = module.get<PaymentProvider>(PAYMENT_PROVIDER);
      expect(provider).toBeInstanceOf(RazorpayPaymentProvider);
      expect(provider.mode).toBe('live');
      expect(provider.publicKeyId).toBe('rzp_live_key123');
    });
  });
});
