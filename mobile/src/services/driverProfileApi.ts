import {apiRequest} from './api';
import {validateName} from './profileApi';

export type DriverProfile = {
  id: string;
  is_active: boolean;
  is_available: boolean;
  max_concurrent_jobs: number;
  profiles: {id: string; full_name: string | null; phone: string | null; avatar_path: string | null};
};

export function accountRoleFromProfile(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as {accountRole?: unknown; profile?: {accountRole?: unknown}; roles?: Array<{roles?: {code?: string}}>};
  if (typeof record.accountRole === 'string') return record.accountRole;
  if (typeof record.profile?.accountRole === 'string') return record.profile.accountRole;
  return record.roles?.[0]?.roles?.code ?? null;
}

export function getDriverProfile(accessToken: string) {
  return apiRequest<DriverProfile>('/drivers/me/profile', {accessToken});
}

export function updateDriverName(accessToken: string, fullName: string) {
  const issue = validateName(fullName);
  if (issue) throw new Error(issue);
  return apiRequest<DriverProfile['profiles']>('/drivers/me/profile', {
    accessToken, method: 'PATCH', body: {fullName: fullName.trim()},
  });
}

export function setDriverAvailability(accessToken: string, isAvailable: boolean) {
  return apiRequest<{driverId: string; isAvailable: boolean}>('/drivers/me/availability', {
    accessToken,
    method: 'PATCH',
    body: {isAvailable},
  });
}


