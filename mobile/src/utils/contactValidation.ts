import { toIndianE164, validateIndianMobile } from './indianMobile';

export function normalizePhone(value: string): string {
  const trimmed = value.trim().replace(/[\s()-]/g, '');
  const digits = trimmed.replace(/\D/g, '');

  if (digits.length === 10 || (digits.startsWith('91') && digits.length === 12)) {
    const validation = validateIndianMobile(digits);
    if (!validation.isValid) {
      throw new Error(validation.error || 'Enter a valid 10-digit Indian mobile number.');
    }
    return toIndianE164(digits);
  }

  const normalized = trimmed.startsWith('+') ? trimmed : `+${trimmed}`;
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    throw new Error('Enter a valid phone number with country code.');
  }
  return normalized;
}

export * from './indianMobile';
