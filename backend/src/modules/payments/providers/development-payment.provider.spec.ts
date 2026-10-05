import { ServiceUnavailableException } from '@nestjs/common';
import { DevelopmentPaymentProvider } from './development-payment.provider';
import { PaymentProvider } from './payment.provider';

describe('DevelopmentPaymentProvider', () => {
  let provider: PaymentProvider;

  beforeEach(() => {
    provider = new DevelopmentPaymentProvider();
  });

  it('exposes development mode and null publicKeyId', () => {
    expect(provider.mode).toBe('development');
    expect(provider.publicKeyId).toBeNull();
  });

  it('fails createOrder with explicit development ServiceUnavailableException', async () => {
    await expect(
      provider.createOrder({
        amount: 5000,
        currency: 'INR',
        receipt: 'BW-dev-receipt',
      }),
    ).rejects.toThrow(
      new ServiceUnavailableException(
        'Razorpay credentials are not configured for this environment.',
      ),
    );
  });

  it('rejects signature verification in development', () => {
    expect(
      provider.verifyCheckoutSignature({
        providerOrderId: 'order_123',
        providerPaymentId: 'pay_123',
        signature: 'a'.repeat(64),
      }),
    ).toBe(false);
  });

  it('fails fetchPayment with ServiceUnavailableException', async () => {
    await expect(provider.fetchPayment('pay_123')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('fails refundPayment with ServiceUnavailableException', async () => {
    await expect(
      provider.refundPayment({
        providerPaymentId: 'pay_123',
        amount: 1000,
        currency: 'INR',
        reference: 'ref_123',
      }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('fails fetchRefund with ServiceUnavailableException', async () => {
    await expect(provider.fetchRefund('rfnd_123')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('fails findRefundByReference with ServiceUnavailableException', async () => {
    await expect(
      provider.findRefundByReference({
        providerPaymentId: 'pay_123',
        reference: 'ref_123',
      }),
    ).rejects.toThrow(ServiceUnavailableException);
  });
});
