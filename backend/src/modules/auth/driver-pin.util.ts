import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'crypto';

const ITERATIONS = 100000;
const KEY_LENGTH = 64;
const DIGEST = 'sha512';

/**
 * Computes a secure PBKDF2-SHA512 hash of a 6-digit driver PIN with a cryptographically
 * random salt. The returned string format is `pbkdf2:<salt>:<hash>`.
 */
export function hashDriverPin(pin: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(pin, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString('hex');
  return `pbkdf2:${salt}:${hash}`;
}

/**
 * Constant-time verification of a raw 6-digit driver PIN against a stored PBKDF2 hash.
 * Protects against timing attacks.
 */
export function verifyDriverPin(pin: string, storedHash: string): boolean {
  if (!storedHash || !storedHash.startsWith('pbkdf2:')) {
    return false;
  }
  const parts = storedHash.split(':');
  if (parts.length !== 3) {
    return false;
  }
  const [, salt, originalHash] = parts;
  if (!salt || !originalHash) {
    return false;
  }
  const calculatedHash = pbkdf2Sync(pin, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString('hex');
  try {
    return timingSafeEqual(Buffer.from(calculatedHash, 'hex'), Buffer.from(originalHash, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Deterministic synthetic email for Supabase Auth identity matching.
 * Guarantees zero collision while allowing Supabase Auth password authentication
 * without SMS OTP dependency.
 */
export function getDriverInternalEmail(phone: string): string {
  const clean = phone.replace(/\D/g, '');
  return `driver.${clean}@brightwhite.internal`;
}

export function getFacilityEmployeeInternalEmail(phone: string): string {
  const clean = phone.replace(/\D/g, '');
  return `facility.${clean}@brightwhite.internal`;
}

export function getStaffInternalEmail(role: 'driver' | 'facility_employee', phone: string): string {
  return role === 'facility_employee'
    ? getFacilityEmployeeInternalEmail(phone)
    : getDriverInternalEmail(phone);
}
