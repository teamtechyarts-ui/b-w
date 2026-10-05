import { apiRequest } from './api';

export type DriverJob = {
  id: string;
  orderId: string;
  orderNumber: string;
  type: 'pickup' | 'delivery';
  assignmentStatus: string;
  orderStatus: string;
  assignedAt: string;
  acceptedAt: string | null;
  completedAt: string | null;
  pickupScheduledAt: string | null;
  pickupSlotLabel: string | null;
  address: {
    label: string | null;
    address_line1: string;
    address_line2: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    latitude?: number | null;
    longitude?: number | null;
  } | null;
  facility: {
    name: string;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
  } | null;
};

export type DriverJobDetail = DriverJob & {
  customer: { name: string | null; phone: string | null } | null;
  items: {
    id: string;
    item_name: string;
    quantity: number;
    weight_kg: number | null;
    customer_notes: string | null;
  }[];
  facilityHandedOver?: boolean;
  facilityCollected?: boolean;
  facilityHandedOverAt?: string | null;
  facilityCollectedAt?: string | null;
};

export type DriverDashboard = {
  date: string;
  summary: {
    pickups: number;
    deliveries: number;
    availablePickups?: number;
    availableDeliveries?: number;
    pending: number;
    inProgress: number;
    completed: number;
  };
  availablePickups?: DriverJob[];
  availableDeliveries?: DriverJob[];
  pickups: DriverJob[];
  deliveries: DriverJob[];
};

export type DriverOrderLookup = {
  assignmentId: string;
  orderId: string;
  orderNumber: string;
  assignmentType: 'pickup' | 'delivery';
  assignmentStatus: string;
  orderStatus: string;
};

export function getDriverDashboard(accessToken: string) {
  return apiRequest<DriverDashboard>('/drivers/me/dashboard', { accessToken });
}

export function claimDriverJob(
  accessToken: string,
  orderId: string,
  jobType: 'pickup' | 'delivery',
) {
  return apiRequest<{
    success: boolean;
    assignment: any;
    orderStatus: string;
  }>(`/drivers/me/jobs/${encodeURIComponent(orderId)}/claim`, {
    accessToken,
    method: 'POST',
    body: { jobType },
  });
}

export function lookupDriverOrder(accessToken: string, code: string) {
  const normalized = code.trim();
  if (!normalized)
    return Promise.reject(
      new Error('Enter an order number or scan an order QR.'),
    );
  return apiRequest<DriverOrderLookup>('/drivers/me/orders/lookup', {
    accessToken,
    method: 'POST',
    body: { code: normalized },
  });
}

export function getDriverJob(accessToken: string, assignmentId: string) {
  return apiRequest<DriverJobDetail>(
    `/drivers/me/assignments/${encodeURIComponent(assignmentId)}`,
    { accessToken },
  );
}

export function acceptDriverJob(accessToken: string, assignmentId: string) {
  return apiRequest(
    `/driver-assignments/${encodeURIComponent(assignmentId)}/accept`,
    {
      accessToken,
      method: 'POST',
    },
  );
}

export function rejectDriverJob(
  accessToken: string,
  assignmentId: string,
  reason: string,
) {
  const trimmed = reason.trim();
  if (!trimmed)
    return Promise.reject(new Error('A rejection reason is required.'));
  return apiRequest(
    `/driver-assignments/${encodeURIComponent(assignmentId)}/reject`,
    {
      accessToken,
      method: 'POST',
      body: { reason: trimmed },
    },
  );
}

export function startDriverNavigation(
  accessToken: string,
  assignmentId: string,
) {
  return apiRequest(
    `/driver-assignments/${encodeURIComponent(assignmentId)}/navigation`,
    {
      accessToken,
      method: 'POST',
    },
  );
}

export function markDriverArrived(accessToken: string, assignmentId: string) {
  return apiRequest(
    `/driver-assignments/${encodeURIComponent(assignmentId)}/arrive`,
    {
      accessToken,
      method: 'POST',
    },
  );
}

export function beginFacilityTransit(
  accessToken: string,
  assignmentId: string,
) {
  return apiRequest(
    `/driver-assignments/${encodeURIComponent(assignmentId)}/facility-transit`,
    {
      accessToken,
      method: 'POST',
    },
  );
}

export function confirmDriverFacilityHandover(
  accessToken: string,
  assignmentId: string,
) {
  return apiRequest<{
    assignmentId: string;
    orderId: string;
    facilityCollected: boolean;
    confirmedAt: string;
  }>(
    `/driver-assignments/${encodeURIComponent(assignmentId)}/confirm-facility-handover`,
    {
      accessToken,
      method: 'POST',
    },
  );
}

export function getDriverHandoffQr(accessToken: string, assignmentId: string) {
  return apiRequest<{ orderId: string; payload: string }>(
    `/drivers/me/assignments/${encodeURIComponent(assignmentId)}/handoff-qr`,
    { accessToken },
  );
}

export function verifyDriverPickupOtp(
  accessToken: string,
  orderId: string,
  otp: string,
) {
  const code = otp.trim();
  if (!/^\d{6}$/.test(code))
    return Promise.reject(new Error('Enter the six-digit pickup OTP.'));
  return apiRequest<{ verified: boolean; orderStatus: string }>(
    `/orders/${encodeURIComponent(orderId)}/otp/verify`,
    {
      accessToken,
      method: 'POST',
      body: { otpType: 'pickup', otp: code },
    },
  );
}

export function publishDriverTripLocation(
  accessToken: string,
  assignmentId: string,
  latitude: number,
  longitude: number,
  accuracyM?: number,
) {
  return apiRequest<{ published: boolean; recordedAt: string }>(
    `/drivers/me/location`,
    {
      accessToken,
      method: 'POST',
      body: { assignmentId, latitude, longitude, accuracyM },
    },
  );
}

export function formatDriverAddress(address: DriverJob['address']) {
  if (!address) return 'Address unavailable';
  return [
    address.label,
    address.address_line1,
    address.address_line2,
    address.city,
    address.state,
    address.postal_code,
  ]
    .filter(Boolean)
    .join(', ');
}
