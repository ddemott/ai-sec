import { describe, it, expect } from 'vitest';
import { formatPhone, normalizePhone } from './phone';

describe('formatPhone', () => {
  it('returns empty string for null/undefined', () => {
    expect(formatPhone(null)).toBe('');
    expect(formatPhone(undefined)).toBe('');
    expect(formatPhone('')).toBe('');
  });

  it('formats a 10-digit US number', () => {
    expect(formatPhone('5551234567')).toBe('+1 (555) 123-4567');
  });

  it('formats an 11-digit US number starting with 1', () => {
    expect(formatPhone('15551234567')).toBe('+1 (555) 123-4567');
  });

  it('strips non-digit characters before formatting', () => {
    expect(formatPhone('(555) 123-4567')).toBe('+1 (555) 123-4567');
    expect(formatPhone('555-123-4567')).toBe('+1 (555) 123-4567');
    expect(formatPhone('+1 555 123 4567')).toBe('+1 (555) 123-4567');
  });

  it('returns +digits for 11-digit non-US numbers', () => {
    expect(formatPhone('44123456789')).toBe('+44123456789');
  });

  it('returns raw with + prefix for non-standard lengths', () => {
    expect(formatPhone('12345')).toBe('+12345');
  });

  it('preserves + prefix on already-prefixed international numbers', () => {
    expect(formatPhone('+442071234567')).toBe('+442071234567');
  });

  it('returns raw input when no digits found', () => {
    expect(formatPhone('no-digits-here!')).toBe('no-digits-here!');
  });
});

describe('normalizePhone', () => {
  it('returns null for null/undefined/empty (strict mode)', () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });

  it('returns null when no digits present', () => {
    expect(normalizePhone('abc')).toBeNull();
  });

  it('normalizes a 10-digit US number to E.164', () => {
    expect(normalizePhone('5551234567')).toBe('+15551234567');
  });

  it('normalizes an 11-digit US number starting with 1', () => {
    expect(normalizePhone('15551234567')).toBe('+15551234567');
  });

  it('strips formatting before normalizing', () => {
    expect(normalizePhone('(555) 123-4567')).toBe('+15551234567');
    expect(normalizePhone('+1 (555) 123-4567')).toBe('+15551234567');
    expect(normalizePhone('555.123.4567')).toBe('+15551234567');
  });

  it('handles international numbers by prefixing +', () => {
    expect(normalizePhone('442071234567')).toBe('+442071234567');
  });

  it('returns null for too-short numbers (< 10 digits)', () => {
    expect(normalizePhone('12345')).toBeNull();
  });
});
