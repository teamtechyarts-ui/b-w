import RazorpayCheckout, {
  type RazorpayFailure,
} from 'react-native-razorpay';

export class PaymentCheckoutCancelledError extends Error {
  constructor() {
    super('Payment was cancelled. Your order is still awaiting payment.');
    this.name = 'PaymentCheckoutCancelledError';
  }
}

function errorDescription(error: unknown) {
  if (typeof error !== 'object' || error === null) {
    return '';
  }

  const failure = error as RazorpayFailure;
  return [
    failure.code,
    failure.description,
    failure.error?.code,
    failure.error?.description,
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase()
    .replace(/[_-]+/g, ' ');
}

export function isRazorpayCancellation(error: unknown) {
  const description = errorDescription(error);
  return (
    description.includes('cancel') ||
    description.includes('dismiss') ||
    description.includes('back pressed')
  );
}

export async function openRazorpayCheckout(input: {
  keyId: string;
  orderId: string;
  amount: number;
  currency: string;
  orderNumber: string;
}) {
  if (!input.keyId || !input.orderId || input.amount <= 0) {
    throw new Error('Razorpay checkout details are incomplete.');
  }

  try {
    const result = await RazorpayCheckout.open({
      key: input.keyId,
      order_id: input.orderId,
      amount: input.amount,
      currency: input.currency,
      name: 'Bright & White',
      description: `Order ${input.orderNumber}`,
      theme: {
        color: '#111827',
      },
    });

    if (
      !result.razorpay_order_id ||
      !result.razorpay_payment_id ||
      !result.razorpay_signature
    ) {
      throw new Error('Razorpay did not return a complete payment result.');
    }

    return {
      razorpayOrderId: result.razorpay_order_id,
      razorpayPaymentId: result.razorpay_payment_id,
      razorpaySignature: result.razorpay_signature,
    };
  } catch (error: unknown) {
    if (isRazorpayCancellation(error)) {
      throw new PaymentCheckoutCancelledError();
    }

    throw error;
  }
}
