/**
 * Tests for timezoneUtils — apply tenant IANA zone to naive datetime
 * strings for voice-agent tool calls. Happy + sad paths with 5W
 * diagnostics.
 */
import { describe, it, expect } from 'vitest';
import { hasTimezone, applyTimezone } from './timezoneUtils';

describe('timezoneUtils', () => {
  describe('hasTimezone', () => {
    it('HAPPY: detects trailing Z', () => {
      // WHAT: UTC "Zulu" suffix should count as tz info
      expect(hasTimezone('2026-05-01T14:00:00Z')).toBe(true);
    });

    it('HAPPY: detects explicit offset like -05:00', () => {
      // WHAT: Standard RFC3339 offset counts
      expect(hasTimezone('2026-05-01T14:00:00-05:00')).toBe(true);
    });

    it('HAPPY: detects compact offset like +0530', () => {
      // WHAT: Offset without colon (RFC 822-style) also counts
      expect(hasTimezone('2026-05-01T14:00:00+0530')).toBe(true);
    });

    it('SAD: naive datetime returns false', () => {
      // WHO: Voice AI passing "2026-05-01 14:00" with no zone
      // WHAT: Must report false so applyTimezone adds an offset
      expect(hasTimezone('2026-05-01T14:00:00')).toBe(false);
    });
  });

  describe('applyTimezone', () => {
    it('HAPPY: attaches America/Chicago offset to naive summer datetime', () => {
      // WHO: DynaTire tenant (default CDT/CST), caller asks for May 1st 2pm
      // WHAT: Should produce -05:00 (CDT) in May
      // WHY: Postgres needs a zone-aware timestamptz to reason about overlaps
      expect(applyTimezone('2026-05-01T14:00:00', 'America/Chicago')).toBe(
        '2026-05-01T14:00:00-05:00'
      );
    });

    it('HAPPY: attaches America/Chicago offset to naive winter datetime', () => {
      // WHO: Tenant in Central Time, booking for January
      // WHAT: Should produce -06:00 (CST) in January, not -05:00
      // WHY: DST handling — wrong offset would shift the booking by an hour
      expect(applyTimezone('2026-01-15T09:00:00', 'America/Chicago')).toBe(
        '2026-01-15T09:00:00-06:00'
      );
    });

    it('HAPPY: UTC zone gets +00:00', () => {
      // WHO: Tenant configured with UTC timezone
      // WHAT: Offset is +00:00 year-round
      expect(applyTimezone('2026-05-01T14:00:00', 'UTC')).toBe(
        '2026-05-01T14:00:00+00:00'
      );
    });

    it('HAPPY: datetime with existing Z passes through unchanged', () => {
      // WHO: Caller already gave a zone-aware string
      // WHAT: Must not double-apply an offset
      // WHY: Applying an offset to "14:00:00Z-05:00" would be malformed
      expect(applyTimezone('2026-05-01T14:00:00Z', 'America/Chicago')).toBe(
        '2026-05-01T14:00:00Z'
      );
    });

    it('HAPPY: datetime with existing -05:00 passes through unchanged', () => {
      // WHAT: Same protection as Z — don't append a second offset
      expect(applyTimezone('2026-05-01T14:00:00-05:00', 'America/Chicago')).toBe(
        '2026-05-01T14:00:00-05:00'
      );
    });

    it('SAD: unknown IANA zone falls back to month-based CDT/CST', () => {
      // WHO: Tenant with a typo'd timezone ("Foo/Bar")
      // WHAT: Don't throw; fall back to America/Chicago heuristic
      // WHY: Voice AI must not crash mid-call on a config error
      const result = applyTimezone('2026-05-01T14:00:00', 'Foo/Bar');
      expect(result).toBe('2026-05-01T14:00:00-05:00');
    });

    it('SAD: invalid datetime string passes through unchanged', () => {
      // WHO: Malformed input from the LLM
      // WHAT: Return as-is; caller's validation layer will reject it
      expect(applyTimezone('not-a-date', 'America/Chicago')).toBe('not-a-date');
    });

    it('SAD: empty string passes through unchanged', () => {
      // WHAT: Guard clause — nothing to apply an offset to
      expect(applyTimezone('', 'America/Chicago')).toBe('');
    });
  });
});
