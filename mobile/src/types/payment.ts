export type PaymentMethod =
  | 'cash_on_delivery'
  | 'razorpay';

export type PaymentOrderResponse = {
  paymentOrderId: string;
  razorpayOrderId: string;
  providerOrderId: string;
  amount: number;
  currency: string;
  keyId: string | null;
  provider: string;
  reused?: boolean;
};


export type PaymentVerificationResponse = {
  verified: boolean;
  duplicate: boolean;
  orderId: string;
  orderStatus: string;
  provider: string;
};