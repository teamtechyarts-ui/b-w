import {apiRequest} from './api';

export type IssueClaim = {id: string; order_id: string; claim_type: string; description: string; status: string; created_at: string;
  resolution_notes?: string | null; customer_claim_photos?: Array<{id: string; storage_path: string; signedUrl: string}>};
export type IssueRefund = {id: string; payment_order_id: string; amount: number | string; reason: string; status: string;
  is_cancellation_refund: boolean; decision_notes?: string | null; created_at: string; payment_orders?: {order_id: string} | null};
export type IssuePayment = {id: string; order_id: string; provider: string; amount: number | string; status: string;
  refundableAmount: number; refund_requests: IssueRefund[]};
export type AdminIssueQueue = {claims: IssueClaim[]; refunds: IssueRefund[];
  cancellations: Array<{id: string; order_number: string; current_status: string; updated_at: string}>};
export type AdminIssueDetail = {order: {id: string; order_number: string; current_status: string; total_amount: number | string; payment_method: string};
  claims: IssueClaim[]; payments: IssuePayment[];
  cancellationHistory: Array<{id: string; reason: string | null; changed_by: string | null; created_at: string}>;
  audit: Array<{id: string; action: string; notes: string; before_status: string | null; after_status: string; created_at: string}>};

const base = '/admin/issues';
export const listAdminIssues = (token: string) => apiRequest<AdminIssueQueue>(base, {accessToken: token});
export const getAdminIssueOrder = (token: string, orderId: string) =>
  apiRequest<AdminIssueDetail>(`${base}/orders/${encodeURIComponent(orderId)}`, {accessToken: token});
function validNotes(notes: string) {
  const trimmed = notes.trim();
  if (trimmed.length < 3 || trimmed.length > 1000) throw new Error('Enter decision notes between 3 and 1000 characters.');
  return trimmed;
}
export const decideAdminClaim = (token: string, orderId: string, claimId: string,
  status: 'under_review' | 'approved' | 'rejected' | 'resolved', notes: string) =>
  apiRequest(`${base}/orders/${encodeURIComponent(orderId)}/claims/${encodeURIComponent(claimId)}/decision`,
    {accessToken: token, method: 'POST', body: {status, notes: validNotes(notes)}});
export function requestAdminRefund(token: string, orderId: string, paymentId: string, amount: number, reason: string) {
  if (!Number.isFinite(amount) || amount <= 0 || Math.abs(Math.round(amount * 100) - amount * 100) > 0.000001)
    throw new Error('Enter a positive refund amount in rupees.');
  return apiRequest(`${base}/orders/${encodeURIComponent(orderId)}/payments/${encodeURIComponent(paymentId)}/refunds`,
    {accessToken: token, method: 'POST', body: {amount, reason: validNotes(reason)}});
}
export const approveAdminRefund = (token: string, orderId: string, refundId: string, notes: string) =>
  apiRequest(`${base}/orders/${encodeURIComponent(orderId)}/refunds/${encodeURIComponent(refundId)}/approve`,
    {accessToken: token, method: 'POST', body: {notes: validNotes(notes)}});
export const rejectAdminRefund = (token: string, orderId: string, refundId: string, notes: string) =>
  apiRequest(`${base}/orders/${encodeURIComponent(orderId)}/refunds/${encodeURIComponent(refundId)}/reject`,
    {accessToken: token, method: 'POST', body: {notes: validNotes(notes)}});
export async function executeAdminClaimRefund(token: string, orderId: string, paymentId: string, amount: number, notes: string) {
  const refundReq: any = await requestAdminRefund(token, orderId, paymentId, amount, notes);
  const refundId = refundReq?.id || refundReq?.refundId;
  if (!refundId) {
    throw new Error('Refund request was created but refund ID was not returned.');
  }
  return approveAdminRefund(token, orderId, refundId, notes);
}
