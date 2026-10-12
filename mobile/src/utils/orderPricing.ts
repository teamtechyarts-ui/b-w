export const FREE_PICKUP_DELIVERY_THRESHOLD =
  500;

export const PICKUP_DELIVERY_CHARGE =
  50;

export const GST_RATE_PERCENT =
  5;
export type CheckoutPricingPolicy = {pickupDeliveryFee: number; freeDeliveryThreshold: number; gstRatePercent: number; minimumOrderAmount: number};
export const DEFAULT_CHECKOUT_PRICING_POLICY: CheckoutPricingPolicy = {
  pickupDeliveryFee: PICKUP_DELIVERY_CHARGE,
  freeDeliveryThreshold: FREE_PICKUP_DELIVERY_THRESHOLD,
  gstRatePercent: GST_RATE_PERCENT,
  minimumOrderAmount: 0,
};

function roundMoney(
  value: number,
) {
  return (
    Math.round(
      (value +
        Number.EPSILON) *
        100,
    ) / 100
  );
}

export type CheckoutPricing = {
  subtotal: number;
  discountAmount: number;
  pickupDeliveryCharge: number;
  taxableAmount: number;
  gstRate: number;
  gstAmount: number;
  grandTotal: number;
  amountUntilFreeDelivery: number;
  hasFreeDelivery: boolean;
};

export function calculateCheckoutPricing(
  subtotalInput: number,
  discountInput = 0,
  policy: CheckoutPricingPolicy = DEFAULT_CHECKOUT_PRICING_POLICY,
): CheckoutPricing {
  const subtotal =
    roundMoney(
      subtotalInput,
    );
  const discountAmount = roundMoney(Math.min(Math.max(discountInput, 0), subtotal));

  const pickupDeliveryCharge =
    subtotal <
    policy.freeDeliveryThreshold
      ? policy.pickupDeliveryFee
      : 0;

  const taxableAmount =
    roundMoney(
      subtotal - discountAmount +
        pickupDeliveryCharge,
    );

  const gstAmount =
    roundMoney(
      taxableAmount *
        (policy.gstRatePercent /
          100),
    );

  const grandTotal =
    roundMoney(
      taxableAmount +
        gstAmount,
    );

  const amountUntilFreeDelivery =
    roundMoney(
      Math.max(
        policy.freeDeliveryThreshold -
          subtotal,
        0,
      ),
    );

  return {
    subtotal,
    discountAmount,
    pickupDeliveryCharge,
    taxableAmount,
    gstRate:
      policy.gstRatePercent,
    gstAmount,
    grandTotal,
    amountUntilFreeDelivery,
    hasFreeDelivery:
      pickupDeliveryCharge ===
      0,
  };
}

export function formatMoney(
  value: number | string | null | undefined,
) {
  const amount = Number(value ?? 0);
  if (Number.isNaN(amount)) return '0.00';
  return amount.toFixed(2);
}

