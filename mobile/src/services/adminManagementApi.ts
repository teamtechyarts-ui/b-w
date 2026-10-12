import {apiRequest} from './api';
import {canCancelOrder} from './ordersApi';

export type AdminCustomer = {
  id: string;
  profile_id: string;
  created_at: string;
  profiles: {id: string; full_name: string | null; phone: string | null; is_active: boolean} | null;
  customer_addresses?: Array<{id: string; label: string | null; address_line1: string; address_line2: string | null; city: string | null; state: string | null; postal_code: string | null; is_default: boolean}>;
};

export type AdminOrderSummary = {
  id: string; order_number: string; current_status: string; created_at: string;
  subtotal: number | string; discount_amount: number | string; total_amount: number | string;
  payment_method: string;
};

export type AdminOrderDetail = {
  order: AdminOrderSummary & {
    pickup_delivery_charge: number | string; taxable_amount: number | string;
    gst_rate: number | string; gst_amount: number | string;
    pickup_scheduled_at?: string | null; pickup_slot_label?: string | null;
    order_items: Array<{id: string; item_name: string; quantity: number; weight_kg: number | null; unit_price: number | string; line_total: number | string; customer_notes?: string | null}>;
    order_status_history: Array<{id: string; from_status: string | null; to_status: string; reason: string | null; created_at: string}>;
    order_qr_codes: {id: string; secure_token: string; is_active: boolean} | null;
    customers: {id: string; profile_id: string; profiles: {full_name: string | null; phone: string | null}};
    facilities?: {id: string; name: string; address: string | null} | null;
    facility_id?: string | null;

    pickup_address?: {id?: string; label?: string | null; address_line1: string; address_line2?: string | null; city: string | null; state: string | null; postal_code: string | null} | null;
    delivery_address?: {id?: string; label?: string | null; address_line1: string; address_line2?: string | null; city: string | null; state: string | null; postal_code: string | null} | null;
    driver_assignments?: Array<{id: string; status: string; assignment_type: string; assigned_at: string; accepted_at: string | null; drivers?: {id: string; profiles?: {full_name: string | null; phone: string | null} | null} | null}>;
  };
  payments: Array<{id: string; provider: string; amount: number | string; currency: string; status: string; paid_at: string | null; refund_requests: Array<{id: string; amount: number | string; reason: string; status: string; is_cancellation_refund: boolean; created_at: string}>}>;
  claims: Array<{id: string; claim_type: string; description: string; status: string; created_at: string; customer_claim_photos: Array<{id: string; storage_path: string}>}>;
};

export function getAdminCustomers(token: string, search = '') {
  return apiRequest<AdminCustomer[]>(`/admin/customers?search=${encodeURIComponent(search)}`, {accessToken: token});
}
export function getAdminCustomer(token: string, customerId: string) {
  return apiRequest<AdminCustomer>(`/admin/customers/${customerId}`, {accessToken: token});
}
export function getAdminCustomerOrders(token: string, customerId: string) {
  return apiRequest<AdminOrderSummary[]>(`/admin/customers/${customerId}/orders`, {accessToken: token});
}
export function getAdminOrder(token: string, orderId: string) {
  return apiRequest<AdminOrderDetail>(`/admin/orders/${orderId}`, {accessToken: token});
}
export async function lookupAdminQr(token: string, payload: string) {
  const value = payload.trim();
  const match = /^(?:BW1:)?([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(value);
  if (match) {
    return apiRequest<{orderId: string; currentStatus: string}>('/qr/scan', {
      method: 'POST', accessToken: token, body: {token: match[1], action: 'lookup'},
    });
  }
  if (value.toUpperCase().startsWith('BW-') || value.length >= 3) {
    const detail = await getAdminOrder(token, value);
    if (detail?.order?.id) {
      return {orderId: detail.order.id, currentStatus: detail.order.current_status};
    }
  }
  throw new Error('Enter a valid BW1 handoff code or order number.');
}
export function canAdminCancelOrder(status: string) { return canCancelOrder(status); }
export function cancelAdminOrder(token: string, orderId: string, reason: string) {
  const trimmed = reason.trim();
  if (trimmed.length < 3 || trimmed.length > 500) throw new Error('Enter a cancellation reason between 3 and 500 characters.');
  return apiRequest(`/admin/orders/${orderId}/cancel`, {method: 'POST', accessToken: token, body: {reason: trimmed}});
}
