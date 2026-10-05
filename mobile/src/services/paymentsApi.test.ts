import {createPaymentOrder, getPaymentSummary, requestRefund, verifyPayment} from './paymentsApi';
import {apiRequest} from './api';

jest.mock('./api', () => ({
  apiRequest: jest.fn(),
}));

const mockApi = apiRequest as jest.Mock;

describe('paymentsApi client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createPaymentOrder', () => {
    it('returns canonical payment order payload with razorpayOrderId and paymentOrderId', async () => {
      mockApi.mockResolvedValueOnce({
        orderId: 'bw-order-1',
        paymentOrderId: 'local-pay-123',
        razorpayOrderId: 'order_test_999',
        amount: 15340,
        currency: 'INR',
        keyId: 'rzp_test_public_key',
        provider: 'razorpay',
      });

      const response = await createPaymentOrder('token-123', 'bw-order-1');

      expect(mockApi).toHaveBeenCalledWith('/payments/orders/bw-order-1/create', {
        method: 'POST',
        accessToken: 'token-123',
      });
      expect(response).toEqual({
        orderId: 'bw-order-1',
        paymentOrderId: 'local-pay-123',
        razorpayOrderId: 'order_test_999',
        amount: 15340,
        currency: 'INR',
        keyId: 'rzp_test_public_key',
        provider: 'razorpay',
      });
    });

    it('maps providerOrderId if razorpayOrderId is absent', async () => {
      mockApi.mockResolvedValueOnce({
        orderId: 'bw-order-2',
        paymentOrderId: 'local-pay-456',
        providerOrderId: 'order_test_888',
        amount: 15340,
        currency: 'INR',
        keyId: 'rzp_test_public_key',
        provider: 'razorpay',
      });

      const response = await createPaymentOrder('token-123', 'bw-order-2');
      expect(response.razorpayOrderId).toBe('order_test_888');
      expect(response.paymentOrderId).toBe('local-pay-456');
    });

    it('throws a clean error when backend returns missing order ID payload', async () => {
      mockApi.mockResolvedValueOnce({
        mode: 'development',
        status: 'not_configured',
        message: 'Razorpay credentials are not configured for this environment.',
      });

      await expect(createPaymentOrder('token-123', 'bw-order-3')).rejects.toThrow(
        'Razorpay credentials are not configured for this environment.',
      );
    });
  });

  describe('verifyPayment', () => {
    it('verifies signature and returns success', async () => {
      mockApi.mockResolvedValueOnce({
        verified: true,
        orderStatus: 'confirmed',
        provider: 'razorpay',
      });

      const response = await verifyPayment('token-123', {
        razorpayOrderId: 'order_test_999',
        razorpayPaymentId: 'pay_test_111',
        razorpaySignature: 'a'.repeat(64),
      });

      expect(mockApi).toHaveBeenCalledWith('/payments/verify', {
        method: 'POST',
        accessToken: 'token-123',
        body: {
          razorpayOrderId: 'order_test_999',
          razorpayPaymentId: 'pay_test_111',
          razorpaySignature: 'a'.repeat(64),
        },
      });
      expect(response.verified).toBe(true);
      expect(response.orderStatus).toBe('confirmed');
    });

    it('throws error when verified is not true', async () => {
      mockApi.mockResolvedValueOnce({
        verified: false,
      });

      await expect(
        verifyPayment('token-123', {
          razorpayOrderId: 'order_test_999',
          razorpayPaymentId: 'pay_test_111',
          razorpaySignature: 'invalid',
        }),
      ).rejects.toThrow('Payment was not verified.');
    });
  });

  describe('getPaymentSummary & requestRefund', () => {
    it('fetches summary from backend', async () => {
      mockApi.mockResolvedValueOnce({
        orderId: 'bw-order-1',
        payment: {
          paymentOrderId: 'p-1',
          status: 'paid',
          amount: 15340,
          currency: 'INR',
        },
        refunds: [],
        refundEligibility: {eligible: true, remainingAmount: 153.4},
      });

      const summary = await getPaymentSummary('token-123', 'bw-order-1');
      expect(summary.payment?.status).toBe('paid');
    });

    it('validates refund request amount and reason before sending', async () => {
      await expect(requestRefund('token-123', 'p-1', -5, 'reason')).rejects.toThrow(
        'Enter a valid refund amount and reason.',
      );
      await expect(requestRefund('token-123', 'p-1', 50, ' ')).rejects.toThrow(
        'Enter a valid refund amount and reason.',
      );
    });
  });
});
