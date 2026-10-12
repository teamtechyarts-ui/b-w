import type {PaymentMethod} from './payment';

export type OrderStatus =
  | 'draft'
  | 'pending_payment'
  | 'confirmed'
  | 'pickup_assigned'
  | 'pickup_accepted'
  | 'picked_up'
  | 'received_at_facility'
  | 'processing'
  | 'ready_for_delivery'
  | 'delivery_assigned'
  | 'out_for_delivery'
  | 'delivered'
  | 'claim_period_active'
  | 'completed'
  | 'cancelled'
  | string;

export type OrderItem = {
  id: string;
  order_id: string;
  service_id: string;
  item_name: string;
  quantity: number;
  weight_kg: number | null;
  unit_price: number | string;
  line_total: number | string;
  customer_notes: string | null;
  created_at?: string;
  updated_at?: string;
  order_item_photos?: unknown[];
};

export type OrderStatusHistoryItem = {
  id: string;
  order_id: string;
  old_status?: string | null;
  new_status?: string | null;
  from_status?: string | null;
  to_status?: string | null;
  status?: string | null;
  reason?: string | null;
  created_at: string;
};

export type CustomerOrder = {
  id: string;
  order_number: string;
  customer_id: string;
  facility_id: string | null;
  current_status: OrderStatus;

  pickup_address_id: string;
  delivery_address_id: string;

  pickup_scheduled_at: string | null;
  pickup_slot_label: string | null;
  delivery_scheduled_at?: string | null;
  delivery_slot_label?: string | null;

  subtotal: number | string;
  discount_amount: number | string;
    pickup_delivery_charge:
    number | string;

  taxable_amount:
    number | string;

  gst_rate:
    number | string;

  gst_amount:
    number | string;

  terms_accepted:
    boolean;

  terms_accepted_at:
    string | null;
  total_amount: number | string;

  currency?: string;
  payment_method: PaymentMethod | null;

  claim_deadline_at?: string | null;
  delivered_at?: string | null;

  created_at: string;
  updated_at: string;

  order_items?: OrderItem[];
  order_qr_codes?: unknown[];
  order_status_history?: OrderStatusHistoryItem[];
};

export type CreateOrderItemInput = {
  serviceId: string;
  itemName: string;
  quantity: number;
  weightKg?: number;
  customerNotes?: string;
};

export type CreateOrderInput = {
  idempotencyKey?: string;
  packageSubscriptionId?: string;
  couponCode?: string;
  loyaltyPointsToRedeem?: number;
  pickupAddressId: string;
  deliveryAddressId: string;
  facilityId?: string;
  pickupScheduledAt: string;
  pickupSlotLabel: string;
  paymentMethod: PaymentMethod;
  items: CreateOrderItemInput[];
  termsAccepted: true;
};

export type SuccessfulOrder = {
  id: string;
  orderNumber?: string;
  status: string;
  paymentMethod: PaymentMethod;

  subtotal: number;
  pickupDeliveryCharge: number;
  taxableAmount: number;
  gstRate: number;
  gstAmount: number;
  totalAmount: number;

  pickupDateLabel: string;
  pickupSlotLabel: string;
};

export const ACTIVE_ORDER_STATUSES = new Set<string>([
  'draft',
  'pending_payment',
  'confirmed',
  'pickup_assigned',
  'pickup_accepted',
  'en_route_pickup',
  'pickup_otp_pending',
  'picked_up',
  'in_transit_to_facility',
  'received_at_facility',
  'verification',
  'processing',
  'quality_check',
  'ready_for_delivery',
  'delivery_assigned',
  'delivery_accepted',
  'en_route_delivery',
  'delivery_otp_pending',
]);

export const PAST_ORDER_STATUSES = new Set<string>([
  'delivered',
  'claim_period_active',
  'completed',
  'cancelled',
]);

export function isPastOrder(
  status: string,
) {
  return PAST_ORDER_STATUSES.has(
    status,
  );
}

export function isActiveOrder(
  status: string,
) {
  return !isPastOrder(status);
}

export function orderStatusLabel(
  status: string,
) {
  const labels: Record<
    string,
    string
  > = {
    draft: 'Draft',
    pending_payment:
      'Payment Pending',
    confirmed:
      'Order Confirmed',
    pickup_assigned:
      'Pickup Driver Assigned',
    pickup_accepted:
      'Pickup Accepted',
    en_route_pickup:
      'Driver En Route to Pickup',
    pickup_otp_pending:
      'Pickup OTP Pending',
    picked_up:
      'Laundry Picked Up',
    in_transit_to_facility:
      'In Transit to Facility',
    received_at_facility:
      'Received at Facility',
    verification:
      'Intake Verification',
    processing:
      'Cleaning in Progress',
    quality_check:
      'Quality Check',
    ready_for_delivery:
      'Ready for Delivery',
    delivery_assigned:
      'Delivery Driver Assigned',
    delivery_accepted:
      'Delivery Accepted',
    en_route_delivery:
      'Out for Delivery',
    delivery_otp_pending:
      'Delivery OTP Pending',
    delivered:
      'Completed',
    claim_period_active:
      'Completed',
    completed:
      'Completed',
    cancelled:
      'Cancelled',
  };

  return (
    labels[status] ??
    status
      .split('_')
      .map(
        word =>
          word
            .charAt(0)
            .toUpperCase() +
          word.slice(1),
      )
      .join(' ')
  );
}
