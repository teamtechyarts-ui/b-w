import {apiRequest} from './api';

export type CreatePaymentOrderResponse = {
  orderId?: string;
  paymentOrderId: string;
  razorpayOrderId: string;
  providerOrderId?: string;
  amount: number;
  currency: string;
  keyId: string;
  provider: string;
  paymentMethod?: string;
  reused?: boolean;
  [key: string]: unknown;
};

export type VerifyPaymentResponse = {
  verified: boolean;
  orderStatus?: string;
  provider?: string;

  [key: string]: unknown;
};

export type PaymentSummary = {
  orderId: string;
  payment: {
    paymentOrderId: string;
    status: string;
    amount: number; // Backend supplies paise.
    currency: string;
  } | null;
  refunds: Array<{
    refundRequestId: string;
    amount: number; // Backend supplies rupees.
    reason: string;
    status: string;
    cancellation: boolean;
  }>;
  refundEligibility: {eligible: boolean; remainingAmount: number};
};

export async function getPaymentSummary(accessToken: string, orderId: string) {
  return apiRequest<PaymentSummary>(`/payments/orders/${orderId}`, {accessToken});
}

export async function requestRefund(
  accessToken: string,
  paymentOrderId: string,
  amount: number,
  reason: string,
) {
  const trimmed = reason.trim();
  if (!Number.isFinite(amount) || amount < 0.01 || trimmed.length < 3 || trimmed.length > 500) {
    throw new Error('Enter a valid refund amount and reason.');
  }
  return apiRequest(`/payments/refunds/${paymentOrderId}/request`, {
    method: 'POST', accessToken, body: {amount, reason: trimmed},
  });
}

export async function createPaymentOrder(
  accessToken: string,
  orderId: string,
): Promise<CreatePaymentOrderResponse> {
  const response =
    await apiRequest<CreatePaymentOrderResponse>(
      `/payments/orders/${orderId}/create`,
      {
        method: 'POST',
        accessToken,
      },
    );

  const paymentOrderId =
    response.razorpayOrderId ||
    response.paymentOrderId ||
    (response as any).providerOrderId;

  if (!paymentOrderId) {
    throw new Error(
      typeof (response as any).message === 'string'
        ? (response as any).message
        : 'Online payment is temporarily unavailable. Please try again or choose Cash on Delivery.',
    );
  }

  return {
    ...response,
    paymentOrderId: response.paymentOrderId || paymentOrderId,
    razorpayOrderId: response.razorpayOrderId || (response as any).providerOrderId || paymentOrderId,
  };
}


export async function verifyPayment(
  accessToken: string,
  input: {
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
  },
): Promise<VerifyPaymentResponse> {
  const response =
    await apiRequest<VerifyPaymentResponse>(
      '/payments/verify',
      {
        method: 'POST',
        accessToken,
        body: input,
      },
    );

  if (
    response.verified !== true
  ) {
    throw new Error(
      'Payment was not verified.',
    );
  }

  return response;
}


