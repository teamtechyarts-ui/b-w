import { hashDriverPin, verifyDriverPin, getDriverInternalEmail } from './driver-pin.util';

describe('driver-pin.util', () => {
  it('hashes and successfully verifies a 6-digit PIN', () => {
    const pin = '482731';
    const hash = hashDriverPin(pin);
    expect(hash).toMatch(/^pbkdf2:[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(verifyDriverPin(pin, hash)).toBe(true);
  });

  it('rejects an incorrect PIN', () => {
    const pin = '482731';
    const hash = hashDriverPin(pin);
    expect(verifyDriverPin('123456', hash)).toBe(false);
    expect(verifyDriverPin('482730', hash)).toBe(false);
  });

  it('generates deterministic internal email for phone', () => {
    expect(getDriverInternalEmail('+919876543210')).toBe('driver.919876543210@brightwhite.internal');
    expect(getDriverInternalEmail('+1 (650) 555-0820')).toBe('driver.16505550820@brightwhite.internal');
  });

  it('handles malformed hashes safely', () => {
    expect(verifyDriverPin('123456', '')).toBe(false);
    expect(verifyDriverPin('123456', 'plain_text')).toBe(false);
    expect(verifyDriverPin('123456', 'pbkdf2:invalid')).toBe(false);
  });
});
