import {
  extractIndianLocalNumber,
  isValidIndianMobile,
  normalizeIndianMobile,
  toIndianE164,
  validateIndianMobile,
} from './indianMobile';

describe('Indian Mobile Normalization & Validation Utility', () => {
  it('normalizes various mobile number input formats to exactly 10 digits', () => {
    expect(normalizeIndianMobile('9876543210')).toBe('9876543210');
    expect(normalizeIndianMobile('+919876543210')).toBe('9876543210');
    expect(normalizeIndianMobile('919876543210')).toBe('9876543210');
    expect(normalizeIndianMobile('+91 98765 43210')).toBe('9876543210');
    expect(normalizeIndianMobile('98765-43210')).toBe('9876543210');
    expect(normalizeIndianMobile('98765abc43210')).toBe('9876543210');
    expect(normalizeIndianMobile('(98765) 43210')).toBe('9876543210');
  });

  it('caps input at 10 digits and ignores an 11th digit', () => {
    expect(normalizeIndianMobile('98765432101')).toBe('9876543210');
    expect(normalizeIndianMobile('9876543210999')).toBe('9876543210');
  });

  it('handles empty and null inputs safely', () => {
    expect(normalizeIndianMobile('')).toBe('');
    expect(normalizeIndianMobile(null)).toBe('');
    expect(normalizeIndianMobile(undefined)).toBe('');
  });

  it('converts local number to canonical E.164 format (+91XXXXXXXXXX)', () => {
    expect(toIndianE164('9876543210')).toBe('+919876543210');
    expect(toIndianE164('+919876543210')).toBe('+919876543210');
    expect(toIndianE164('')).toBe('');
  });

  it('extracts local 10 digits from existing backend E.164 strings', () => {
    expect(extractIndianLocalNumber('+919876543210')).toBe('9876543210');
    expect(extractIndianLocalNumber('+918123456789')).toBe('8123456789');
  });

  it('correctly validates valid Indian mobile numbers (starting with 6, 7, 8, 9)', () => {
    expect(isValidIndianMobile('9876543210')).toBe(true);
    expect(isValidIndianMobile('8123456789')).toBe(true);
    expect(isValidIndianMobile('7123456789')).toBe(true);
    expect(isValidIndianMobile('6123456789')).toBe(true);
  });

  it('correctly invalidates invalid Indian mobile numbers', () => {
    expect(isValidIndianMobile('5123456789')).toBe(false);
    expect(isValidIndianMobile('1234567890')).toBe(false);
    expect(isValidIndianMobile('987654321')).toBe(false); // only 9 digits
    expect(isValidIndianMobile('')).toBe(false);
    expect(isValidIndianMobile(null)).toBe(false);
  });

  it('returns appropriate validation messages from validateIndianMobile', () => {
    expect(validateIndianMobile('9876543210')).toEqual({ isValid: true });
    expect(validateIndianMobile('')).toEqual({
      isValid: false,
      error: 'Enter mobile number.',
    });
    expect(validateIndianMobile('98765')).toEqual({
      isValid: false,
      error: 'Enter all 10 digits.',
    });
    expect(validateIndianMobile('5123456789')).toEqual({
      isValid: false,
      error: 'Enter a valid 10-digit Indian mobile number.',
    });
  });
});
