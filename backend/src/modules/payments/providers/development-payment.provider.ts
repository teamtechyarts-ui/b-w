import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  PaymentProvider,
  ProviderPayment,
  ProviderPaymentOrder,
  ProviderRefund,
} from './payment.provider';

@Injectable()
export class DevelopmentPaymentProvider implements PaymentProvider {
  readonly mode = 'development' as const;
  readonly publicKeyId: string | null = null;

  async createOrder(_input: {
    amount: number;
    currency: string;
    receipt: string;
  }): Promise<ProviderPaymentOrder> {
    throw new ServiceUnavailableException(
      'Razorpay credentials are not configured for this environment.',
    );
  }

  verifyCheckoutSignature(_input: {
    providerOrderId: string;
    providerPaymentId: string;
    signature: string;
  }): boolean {
    return false;
  }

  async fetchPayment(_providerPaymentId: string): Promise<ProviderPayment> {
    throw new ServiceUnavailableException(
      'Razorpay credentials are not configured for this environment.',
    );
  }

  async refundPayment(_input: {
    providerPaymentId: string;
    amount: number;
    currency: string;
    reference: string;
  }): Promise<ProviderRefund> {
    throw new ServiceUnavailableException(
      'Razorpay credentials are not configured for this environment.',
    );
  }

  async fetchRefund(_providerRefundId: string): Promise<ProviderRefund> {
    throw new ServiceUnavailableException(
      'Razorpay credentials are not configured for this environment.',
    );
  }

  async findRefundByReference(_input: {
    providerPaymentId: string;
    reference: string;
  }): Promise<ProviderRefund | null> {
    throw new ServiceUnavailableException(
      'Razorpay credentials are not configured for this environment.',
    );
  }
}
