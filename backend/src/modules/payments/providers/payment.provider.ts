export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export type ProviderPaymentOrder = {
  id: string;
  amount: number;
  currency: string;
};

export type ProviderPayment = {
  id: string;
  orderId: string;
  amount: number;
  currency: string;
  status: 'captured' | 'failed' | string;
};

export type ProviderRefund = {
  id: string;
  paymentId: string;
  amount: number;
  currency: string;
  status: 'processed' | 'pending' | 'failed' | string;
  reference: string | null;
};

export interface PaymentProvider {
  readonly mode: 'live' | 'development';
  readonly publicKeyId: string | null;

  createOrder(input: {
    amount: number;
    currency: string;
    receipt: string;
  }): Promise<ProviderPaymentOrder>;

  verifyCheckoutSignature(input: {
    providerOrderId: string;
    providerPaymentId: string;
    signature: string;
  }): boolean;

  fetchPayment(providerPaymentId: string): Promise<ProviderPayment>;

  refundPayment(input: {
    providerPaymentId: string;
    amount: number;
    currency: string;
    reference: string;
  }): Promise<ProviderRefund>;

  fetchRefund(providerRefundId: string): Promise<ProviderRefund>;

  findRefundByReference(input: {
    providerPaymentId: string;
    reference: string;
  }): Promise<ProviderRefund | null>;
}
