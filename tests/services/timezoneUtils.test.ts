/**
 * Tests for timezoneUtils — apply tenant IANA zone to naive datetime
 * strings for voice-agent tool calls. Happy + sad paths with 5W
 * diagnostics.
 */
import { describe, it, expect } from 'vitest';
import { hasTimezone, applyTimezone, toLocalWallClock } from '../../src/services/timezoneUtils';

describe('timezoneUtils', () => {
  describe('toLocalWallClock (UTC → tenant-local, for agent read-back)', () => {
    it('HAPPY: renders a UTC instant as the tenant-local wall-clock', () => {
      // WHO: the agent confirming a booking ("booked for 3:30 PM").
      // WHAT: the RPC returns booked_start as UTC (20:30Z = 3:30 PM CDT); the
      //       agent must speak LOCAL, so we convert back to 15:30 wall-clock.
      // WHY: without this the agent confirms the UTC instant (8:30 PM) — the
      //       same tz mismatch on read-back that applyTimezone fixes on write.
      expect(toLocalWallClock('2026-07-02T20:30:00Z', 'America/Chicago')).toBe(
        '2026-07-02T15:30:00'
      );
    });

    it('HAPPY: round-trips applyTimezone — local → UTC → local is identity', () => {
      // WHERE: the write path (applyTimezone) and the read path (toLocalWallClock)
      //        must be inverses so a 3:30 PM booking reads back as 3:30 PM.
      const local = '2026-07-02T15:30:00';
      const utc = applyTimezone(local, 'America/Chicago'); // -> ...-05:00
      expect(toLocalWallClock(utc, 'America/Chicago')).toBe(local);
    });

    it('SAD: an unparseable value is returned unchanged (never throws mid-call)', () => {
      expect(toLocalWallClock('not-a-date', 'America/Chicago')).toBe('not-a-date');
    });
  });

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
      expect(applyTimezone('2026-05-01T14:00:00', 'UTC')).toBe('2026-05-01T14:00:00+00:00');
    });

    it('HAPPY: datetime with existing Z passes through unchanged', () => {
      // WHO: Caller already gave a zone-aware string
      // WHAT: Must not double-apply an offset
      // WHY: Applying an offset to "14:00:00Z-05:00" would be malformed
      expect(applyTimezone('2026-05-01T14:00:00Z', 'America/Chicago')).toBe('2026-05-01T14:00:00Z');
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

    // ── DST transition pinning (added 2026-05-05) ───────────────────
    //
    // Origin: timezone audit found the previous one-shot offset lookup
    // returned the pre-transition offset for ~6 hours after the local
    // clock had already changed (and symmetrically after fall-back).
    // Net effect: every voice booking made during that window landed at
    // the wrong UTC instant, off by exactly 1 hour. These tests pin the
    // fixed-point algorithm so that regression can't reappear silently.

    it('DST spring-forward: 1:30am Chicago on transition day is still CST', () => {
      // WHO: caller booking pre-transition on the morning DST starts
      // WHAT: at 1:30am local on 2026-03-08, clocks haven't sprung yet
      // WHY: returning CDT here would push the booking 1h earlier than
      //      the user said
      expect(applyTimezone('2026-03-08T01:30:00', 'America/Chicago')).toBe(
        '2026-03-08T01:30:00-06:00'
      );
    });

    it('DST spring-forward: 3:30am Chicago on transition day is CDT', () => {
      // WHO: caller booking right after the spring-forward jump
      // WHAT: 2am→3am skip means 3:30am is the first valid post-transition slot
      // WHY: pre-fix, this returned CST and recorded the appointment 1h
      //      ahead of where the user meant
      expect(applyTimezone('2026-03-08T03:30:00', 'America/Chicago')).toBe(
        '2026-03-08T03:30:00-05:00'
      );
    });

    it('DST spring-forward: 5:30am Chicago on transition day is CDT (the original BUG-059-class regression)', () => {
      // WHO: caller picking a normal-looking morning slot on the DST day
      // WHAT: 5:30am local on 2026-03-08 is post-transition (CDT)
      // WHY: this is the exact case that surfaced the audit — the old
      //      code looked up the offset at the naive-as-UTC instant,
      //      which was still pre-transition in Chicago, so it returned
      //      CST. The booking went into Postgres as 11:30am UTC instead
      //      of the 10:30am UTC the caller intended.
      expect(applyTimezone('2026-03-08T05:30:00', 'America/Chicago')).toBe(
        '2026-03-08T05:30:00-05:00'
      );
    });

    it('DST fall-back: 0:30am Chicago on transition day is still CDT', () => {
      // WHO: late-night booking pre-fall-back
      // WHAT: 0:30am local on 2026-11-01 is before DST ends at 2am
      // WHY: symmetric guard for the autumn transition
      expect(applyTimezone('2026-11-01T00:30:00', 'America/Chicago')).toBe(
        '2026-11-01T00:30:00-05:00'
      );
    });

    it('DST fall-back: 3:00am Chicago on transition day is CST', () => {
      // WHO: caller booking the morning after fall-back
      // WHAT: 3am local on 2026-11-01 is post-transition (CST)
      // WHY: pre-fix, this returned CDT and recorded the appointment 1h
      //      behind where the user meant
      expect(applyTimezone('2026-11-01T03:00:00', 'America/Chicago')).toBe(
        '2026-11-01T03:00:00-06:00'
      );
    });

    it('DST fall-back ambiguous 1:30am: takes the first occurrence (CDT) — IANA convention', () => {
      // WHO: caller picking a 1:30am slot on the day clocks fall back
      // WHAT: 1:30am exists twice on 2026-11-01 (once CDT, then CST).
      //       The fixed-point iteration converges on the CDT side —
      //       the IANA "first occurrence" convention used by most date
      //       libraries.
      // WHY: pinning so that future refactors don't silently change
      //      behavior on the ambiguous case. Real-world impact is low
      //      (calls during the duplicate hour are rare) but the test
      //      documents the intended semantics so a regression here
      //      can't be mistaken for a routine code change.
      expect(applyTimezone('2026-11-01T01:30:00', 'America/Chicago')).toBe(
        '2026-11-01T01:30:00-05:00'
      );
    });

    it('DST: non-Chicago zones also resolve correctly through the fixed-point step', () => {
      // WHO: tenant in a different DST-observing zone (Eastern Time)
      // WHAT: same algorithm should produce -04:00 EDT on a post-spring
      //       morning, not -05:00 EST
      // WHY: pin the algorithm against zone-specific assumptions — the
      //      math is generic, not Chicago-only
      expect(applyTimezone('2026-03-08T05:30:00', 'America/New_York')).toBe(
        '2026-03-08T05:30:00-04:00'
      );
    });
  });
});
