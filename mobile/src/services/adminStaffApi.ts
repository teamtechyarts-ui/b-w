import {apiRequest} from './api';

export type StaffRole = 'driver' | 'manager' | 'facility_employee';
export type StaffRecord = {
  id: string; profile_id: string; role: StaffRole; is_active: boolean;
  is_available?: boolean; facility_id: string | null;
  profiles: {id: string; full_name: string | null; phone: string | null; is_active: boolean; created_at: string};
  facilities: {id: string; name: string} | null;
};
export type StaffDetail = {
  staff: StaffRecord;
  audit: Array<{id: string; action: string; detail: Record<string, string | null>; created_at: string; actor_profile_id: string}>;
  workload: Array<{id: string; order_id: string; status?: string; current_status?: string; assignment_type?: string; assigned_at?: string; completed_at?: string}>;
};
export type FacilityChoice = {id: string; name: string; is_active: boolean};
export type ProvisionStaffInput = {phone: string; fullName: string; role: StaffRole; facilityId?: string; pin?: string};

export function listAdminStaff(token: string, filters: {search?: string; role?: string; status?: string} = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) query.append(key, value);
  return apiRequest<StaffRecord[]>(`/admin/staff${query.toString() ? `?${query.toString()}` : ''}`, {accessToken: token});
}
export function getAdminStaff(token: string, profileId: string) {
  return apiRequest<StaffDetail>(`/admin/staff/${profileId}`, {accessToken: token});
}
export function listAdminFacilities(token: string) {
  return apiRequest<FacilityChoice[]>('/admin/staff/facilities', {accessToken: token});
}
export function provisionAdminStaff(token: string, input: ProvisionStaffInput) {
  const phone = input.phone.trim();
  const fullName = input.fullName.trim();
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error('Enter a valid phone number with country code.');
  if (!fullName || fullName.length > 100) throw new Error('Enter a staff name.');
  if (!input.pin || !/^\d{6}$/.test(input.pin)) {
    throw new Error(input.role === 'driver' ? 'Driver PIN must be exactly 6 digits.' : 'Facility Employee PIN must be exactly 6 digits.');
  }
  if (input.role === 'facility_employee' && !input.facilityId) {
    throw new Error('Choose a facility.');
  }
  return apiRequest<{profileId: string}>('/admin/staff', {
    method: 'POST',
    accessToken: token,
    body: {
      phone,
      fullName,
      role: input.role,
      ...(input.role === 'facility_employee' ? {facilityId: input.facilityId} : {}),
      pin: input.pin,
    },
  });
}
export function updateStaffPin(token: string, profileId: string, pin: string) {
  if (!pin || !/^\d{6}$/.test(pin)) throw new Error('Staff PIN must be exactly 6 digits.');
  return apiRequest<{success: boolean; message: string}>(`/admin/staff/${profileId}/pin`, {
    method: 'PATCH',
    accessToken: token,
    body: {newPin: pin, pin},
  });
}
export function updateDriverPin(token: string, profileId: string, pin: string) {
  return updateStaffPin(token, profileId, pin);
}
export function deactivateAdminStaff(token: string, profileId: string) {
  return apiRequest(`/admin/staff/${profileId}/deactivate`, {method: 'PATCH', accessToken: token});
}
export function activateAdminStaff(token: string, profileId: string) {
  return apiRequest(`/admin/staff/${profileId}/activate`, {method: 'PATCH', accessToken: token});
}
export function revokeAdminStaffAccess(token: string, profileId: string) {
  return apiRequest(`/admin/staff/${profileId}/revoke-access`, {method: 'PATCH', accessToken: token});
}
export function reassignAdminStaffFacility(token: string, profileId: string, facilityId: string) {
  if (!facilityId) throw new Error('Choose a facility.');
  return apiRequest(`/admin/staff/${profileId}/facility`, {method: 'PATCH', accessToken: token, body: {facilityId}});
}
export function updateDriverAvailability(token: string, profileId: string, isAvailable: boolean) {
  return apiRequest(`/admin/staff/${profileId}/availability`, {method: 'PATCH', accessToken: token, body: {isAvailable}});
}


