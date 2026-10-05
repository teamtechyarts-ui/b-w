/**
 * Indian Mobile Number Utilities for Bright & White
 * Bright & White operates strictly in India (+91).
 */

const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;

/**
 * Strips all non-digit characters and standardizes to 10 local digits.
 * Handles inputs such as:
 * - "+919876543210" -> "9876543210"
 * - "919876543210"  -> "9876543210"
 * - "+91 98765 43210" -> "9876543210"
 * - "98765-43210"   -> "9876543210"
 * - "98765abc43210" -> "9876543210"
 */
export function normalizeIndianMobile(input: string | null | undefined): string {
  if (!input) return '';
  const digitsOnly = String(input).replace(/\D/g, '');
  
  // If user pasted or entered with leading 91 and total length > 10 digits
  if (digitsOnly.startsWith('91') && digitsOnly.length > 10) {
    return digitsOnly.slice(2, 12);
  }
  
  // Return at most 10 digits
  return digitsOnly.slice(0, 10);
}

/**
 * Extracts 10-digit local number from any formatted string (including E.164).
 */
export function extractIndianLocalNumber(value: string | null | undefined): string {
  return normalizeIndianMobile(value);
}

/**
 * Converts a 10-digit Indian local mobile number to canonical E.164 (+91XXXXXXXXXX).
 */
export function toIndianE164(local10Digits: string | null | undefined): string {
  const normalized = normalizeIndianMobile(local10Digits);
  return normalized ? `+91${normalized}` : '';
}

/**
 * Validates whether the given string is a valid 10-digit Indian mobile number
 * starting with 6, 7, 8, or 9.
 */
export function isValidIndianMobile(local10Digits: string | null | undefined): boolean {
  if (!local10Digits) return false;
  const normalized = normalizeIndianMobile(local10Digits);
  return INDIAN_MOBILE_REGEX.test(normalized);
}

/**
 * Validates and returns a user-friendly error message if invalid.
 */
export function validateIndianMobile(local10Digits: string | null | undefined): {
  isValid: boolean;
  error?: string;
} {
  const normalized = normalizeIndianMobile(local10Digits);
  if (!normalized) {
    return { isValid: false, error: 'Enter mobile number.' };
  }
  if (normalized.length < 10) {
    return { isValid: false, error: 'Enter all 10 digits.' };
  }
  if (!INDIAN_MOBILE_REGEX.test(normalized)) {
    return {
      isValid: false,
      error: 'Enter a valid 10-digit Indian mobile number.',
    };
  }
  return { isValid: true };
}
