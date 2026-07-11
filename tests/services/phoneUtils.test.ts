/**
 * Tests for phoneUtils — phone normalization shared between backend and
 * LiveKit agent. Ported behavior from supabase/functions/vapi-tools/
 * core/dispatcher.ts. Happy + sad paths with 5W diagnostics.
 */
import { describe, it, expect } from 'vitest';
import { normalizePhone, isValidPhone } from '../../src/services/phoneUtils';

describe('phoneUtils', () => {
  describe('normalizePhone', () => {
    it('HAPPY: 10-digit US number gets +1 prefix', () => {
      // WHO: Caller from a 10-digit formatted number ("5551234567")
      // WHAT: Should prepend +1 to produce E.164 ("+15551234567")
      // WHY: Customer records store +1-prefixed phones; tool calls must match
      expect(normalizePhone('5551234567')).toBe('+15551234567');
    });

    it('HAPPY: 11-digit number starting with 1 gets + prefix', () => {
      // WHO: Caller with leading 1 but no + ("15551234567")
      // WHAT: Produce "+15551234567"
      expect(normalizePhone('15551234567')).toBe('+15551234567');
    });

    it('HAPPY: already-normalized +1 number passes through', () => {
      // WHO: Telnyx handing off a pre-formatted number
      // WHAT: Input already E.164; return unchanged
      expect(normalizePhone('+15551234567')).toBe('+15551234567');
    });

    it('HAPPY: strips non-digit characters from a formatted US number', () => {
      // WHO: User-entered number with parens, dashes, spaces
      // WHAT: "(555) 123-4567" → "+15551234567"
      // WHY: Dashboard forms accept pretty-printed phones
      expect(normalizePhone('(555) 123-4567')).toBe('+15551234567');
    });

    it('SAD: rejects "+1" alone (regression guard for 2026-04-01 BUG-060)', () => {
      // WHO: Dispatcher with partial caller-ID only
      // WHAT: Must return null, not treat as valid phone
      // WHY: Prior bug stored "+1" as a phone because < 10 digits wasn't checked
      expect(normalizePhone('+1')).toBeNull();
    });

    it('SAD: rejects number with fewer than 10 digits', () => {
      // WHO: Garbage caller-ID from a misrouted call ("12345")
      // WHAT: Null — cannot be a real phone
      expect(normalizePhone('12345')).toBeNull();
    });

    it('SAD: null input returns null', () => {
      // WHO: Tool call with missing phone parameter
      // WHAT: Should not throw; null signals "no usable phone"
      expect(normalizePhone(null)).toBeNull();
    });

    it('SAD: empty string returns null', () => {
      // WHO: Tool call where caller-ID was blocked/withheld
      // WHAT: Same as null — no usable phone
      expect(normalizePhone('')).toBeNull();
    });
  });

  describe('isValidPhone', () => {
    it('HAPPY: valid 10-digit number is accepted', () => {
      // WHO: Availability check with caller's phone
      // WHAT: Predicate wrapper returns true for normalizable input
      expect(isValidPhone('5551234567')).toBe(true);
    });

    it('SAD: short number is rejected', () => {
      // WHAT: False for anything normalizePhone would reject
      expect(isValidPhone('123')).toBe(false);
    });
  });
});
