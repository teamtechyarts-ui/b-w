import {apiRequest} from './api';

export type FacilitySummary = {id: string; name: string; address: string | null; isActive: boolean; workload: number;
  received: number; verification: number; openDiscrepancies: number; stages: Record<string, number>;
  qcFailures: number; rewashCycles: number; packed: number; ready: number; ageWarnings: number;
  stuckOrders: number; oldestActiveHours: number; activeStaff: number; activeMachines: number;
  installedMachineCapacityKg: number};
export type FacilityOrder = {id: string; order_number: string; current_status: string; updated_at: string;
  latestStage: string | null; processingAgeHours: number; ageWarning: boolean; stuck: boolean; openDiscrepancies: number};
export type FacilityOversight = {monitoring: {ageWarningHours: number; stuckHours: number; contractualSla: false}; facilities: FacilitySummary[]};
export type FacilityDetail = {summary: FacilitySummary; orders: FacilityOrder[]};
export type FacilityOrderAudit = {order: {id: string; order_number: string; current_status: string};
  operations: Array<{id: string; operation_type: string; current_status: string; started_at: string; completed_at: string | null; rewash_cycle?: number}>;
  inspections: Array<{id: string; counted_quantity: number; weight_kg: number | null; condition_notes: string | null}>;
  discrepancies: Array<{id: string; kind: string; status: string; notes: string; resolution_notes: string | null}>;
  qc: Array<{id: string; cycle_number: number; approved: boolean; defect_code: string | null; reason: string | null}>;
  packings: Array<{id: string; parcel_id: string; packed_at: string}>;
  history: Array<{id: string; from_status: string; to_status: string; created_at: string}>;
  qr: Array<{id: string; is_active: boolean; scans: Array<{id: string; scan_action: string; scanned_at: string}>}>};

export type AdminLocation = {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  serviceRadiusMeters: number;
  isActive: boolean;
  pincodes?: string[];
  createdAt: string;
  updatedAt: string;
};

export type CreateLocationInput = {
  name: string;
  address: string;
  latitude?: number | null;
  longitude?: number | null;
  serviceRadiusMeters?: number;
  isActive?: boolean;
};

export type UpdateLocationInput = Partial<CreateLocationInput>;

export type DeleteLocationResult = {
  success: boolean;
  deleted: boolean;
  archived: boolean;
  message: string;
};

export type PincodeMutationResult = {
  success: boolean;
  facilityId: string;
  pincode: string;
  message: string;
};

const base = '/admin/facilities';
export const listAdminFacilities = (token: string) => apiRequest<FacilityOversight>(base, {accessToken: token});
export const getAdminFacility = (token: string, id: string) =>
  apiRequest<FacilityDetail>(`${base}/${encodeURIComponent(id)}`, {accessToken: token});
export const getAdminFacilityOrder = (token: string, facilityId: string, orderId: string) =>
  apiRequest<FacilityOrderAudit>(`${base}/${encodeURIComponent(facilityId)}/orders/${encodeURIComponent(orderId)}`,
    {accessToken: token});

export const listAdminLocations = (token: string) =>
  apiRequest<AdminLocation[]>(`${base}/locations`, {accessToken: token});

export const createAdminLocation = (token: string, payload: CreateLocationInput) =>
  apiRequest<AdminLocation>(base, {
    method: 'POST',
    accessToken: token,
    body: payload,
  });

export const updateAdminLocation = (token: string, id: string, payload: UpdateLocationInput) =>
  apiRequest<AdminLocation>(`${base}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    accessToken: token,
    body: payload,
  });

export const deleteAdminLocation = (token: string, id: string) =>
  apiRequest<DeleteLocationResult>(`${base}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    accessToken: token,
  });

export const listAdminFacilityPincodes = (token: string, facilityId: string) =>
  apiRequest<string[]>(`${base}/${encodeURIComponent(facilityId)}/pincodes`, {
    accessToken: token,
  });

export const addAdminFacilityPincode = (token: string, facilityId: string, pincode: string) =>
  apiRequest<PincodeMutationResult>(`${base}/${encodeURIComponent(facilityId)}/pincodes`, {
    method: 'POST',
    accessToken: token,
    body: {pincode},
  });

export const removeAdminFacilityPincode = (token: string, facilityId: string, pincode: string) =>
  apiRequest<PincodeMutationResult>(`${base}/${encodeURIComponent(facilityId)}/pincodes/${encodeURIComponent(pincode)}`, {
    method: 'DELETE',
    accessToken: token,
  });

