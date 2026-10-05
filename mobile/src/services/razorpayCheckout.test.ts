import RazorpayCheckout from 'react-native-razorpay';
import {
  isRazorpayCancellation,
  openRazorpayCheckout,
  PaymentCheckoutCancelledError,
} from './razorpayCheckout';

jest.mock('react-native-razorpay', () => ({
  open: jest.fn(),
}));

describe('Razorpay checkout safety', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    {description: 'Payment cancelled by user'},
    {error: {description: 'Checkout dismissed'}},
    {error: {code: 'BACK_PRESSED'}},
  ])('recognizes a checkout cancellation', (error) => {
    expect(isRazorpayCancellation(error)).toBe(true);
  });

  it('keeps a cancellation distinct from a failed payment', () => {
    expect(
      isRazorpayCancellation({description: 'Payment failed'}),
    ).toBe(false);
    expect(new PaymentCheckoutCancelledError().message).toContain(
      'awaiting payment',
    );
  });

  it('validates incomplete checkout details before opening', async () => {
    await expect(
      openRazorpayCheckout({
        keyId: '',
        orderId: 'order_test',
        amount: 100,
        currency: 'INR',
        orderNumber: 'BW-TEST',
      }),
    ).rejects.toThrow('Razorpay checkout details are incomplete.');

    await expect(
      openRazorpayCheckout({
        keyId: 'rzp_test_123',
        orderId: '',
        amount: 100,
        currency: 'INR',
        orderNumber: 'BW-TEST',
      }),
    ).rejects.toThrow('Razorpay checkout details are incomplete.');

    await expect(
      openRazorpayCheckout({
        keyId: 'rzp_test_123',
        orderId: 'order_test',
        amount: 0,
        currency: 'INR',
        orderNumber: 'BW-TEST',
      }),
    ).rejects.toThrow('Razorpay checkout details are incomplete.');
  });

  it('opens Razorpay Checkout and returns verified payment payload', async () => {
    (RazorpayCheckout.open as jest.Mock).mockResolvedValueOnce({
      razorpay_order_id: 'order_test_123',
      razorpay_payment_id: 'pay_test_456',
      razorpay_signature: 'sig_test_789',
    });

    const result = await openRazorpayCheckout({
      keyId: 'rzp_test_123',
      orderId: 'order_test_123',
      amount: 18880,
      currency: 'INR',
      orderNumber: 'BW-20261003-7CB85C51',
    });

    expect(RazorpayCheckout.open).toHaveBeenCalledWith({
      key: 'rzp_test_123',
      order_id: 'order_test_123',
      amount: 18880,
      currency: 'INR',
      name: 'Bright & White',
      description: 'Order BW-20261003-7CB85C51',
      theme: {
        color: '#111827',
      },
    });

    expect(result).toEqual({
      razorpayOrderId: 'order_test_123',
      razorpayPaymentId: 'pay_test_456',
      razorpaySignature: 'sig_test_789',
    });
  });

  it('maps checkout dismissal to PaymentCheckoutCancelledError', async () => {
    (RazorpayCheckout.open as jest.Mock).mockRejectedValueOnce({
      description: 'Payment cancelled by user',
    });

    await expect(
      openRazorpayCheckout({
        keyId: 'rzp_test_123',
        orderId: 'order_test_123',
        amount: 18880,
        currency: 'INR',
        orderNumber: 'BW-20261003-7CB85C51',
      }),
    ).rejects.toThrow(PaymentCheckoutCancelledError);
  });
});
