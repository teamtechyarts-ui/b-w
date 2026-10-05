import {apiRequest} from './api';

export type FacilityDashboardOrder = {
  id: string;
  order_number: string;
  current_status: string;
  created_at: string;
  updated_at: string;
  pickupDriverName?: string | null;
  pickupAssignment?: {
    id: string;
    driverId: string;
    driverName?: string | null;
    status: string;
  } | null;
  processingStage?: string | null;
  deliveryAssignment: {
    id: string;
    driverId: string;
    driverName?: string;
    status: string;
    rejectionReason: string | null;
    handedOver?: boolean;
    handedOverAt?: string | null;
    collected?: boolean;
    collectedAt?: string | null;
  } | null;
};

export type FacilityDashboard = {
  facility: {id: string; name: string; address: string | null};
  role: 'manager' | 'facility_employee';
  summary: {incoming: number; received: number; processing: number; ready: number};
  orders: FacilityDashboardOrder[];
};

export type AvailableDeliveryDriver = {id: string; name: string; activeJobs: number};

export function getFacilityDashboard(accessToken: string) {
  return apiRequest<FacilityDashboard>('/facility/me/dashboard', {accessToken});
}

export function getAvailableDeliveryDrivers(accessToken: string, orderId: string) {
  return apiRequest<{drivers: AvailableDeliveryDriver[]}>(
    `/facility/orders/${encodeURIComponent(orderId)}/available-delivery-drivers`,
    {accessToken},
  );
}

export function reassignFacilityDelivery(accessToken: string, orderId: string, driverId: string) {
  return apiRequest(
    `/facility/orders/${encodeURIComponent(orderId)}/reassign-delivery`,
    {accessToken, method: 'POST', body: {driverId}},
  );
}

export function handoverFacilityOrderToDriver(accessToken: string, orderId: string, driverId?: string) {
  return apiRequest<{orderId: string; handedOver: boolean; driverId: string; handedOverAt: string}>(
    `/facility/orders/${encodeURIComponent(orderId)}/handover-to-driver`,
    {accessToken, method: 'POST', body: driverId ? {driverId} : {}},
  );
}
