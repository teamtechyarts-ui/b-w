import {apiRequest} from './api';

export type CustomerProfile = {id: string; full_name: string | null; phone: string | null; email?: string | null};
export type CustomerRecord = {id: string; profile_id: string; profiles: CustomerProfile};

export function customerNameFromProfile(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as {full_name?: unknown; profile?: {full_name?: unknown}};
  const name = typeof record.full_name === 'string' ? record.full_name : record.profile?.full_name;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

export function validateName(value: string): string | null {
  const name = value.trim();
  if (name.length < 2 || name.length > 150) return 'Name must be between 2 and 150 characters.';
  if (!/^[\p{L}\p{M} .'’-]+$/u.test(name)) return 'Name contains unsupported characters.';
  return null;
}

export const getCustomerProfile = (accessToken: string) => apiRequest<CustomerRecord>('/customers/me', {accessToken});
export async function updateCustomerName(accessToken: string, fullName: string): Promise<CustomerProfile> {
  const issue = validateName(fullName);
  if (issue) throw new Error(issue);
  return apiRequest<CustomerProfile>('/customers/me', {method: 'PATCH', accessToken, body: {fullName: fullName.trim()}});
}
export const deleteCustomerAccount = (accessToken: string) =>
  apiRequest<{deleted: boolean; message: string}>('/customers/me', {
    method: 'DELETE',
    accessToken,
  });

