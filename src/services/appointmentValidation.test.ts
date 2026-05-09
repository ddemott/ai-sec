/**
 * Tests for appointmentValidation — the shared input check called by both
 * /appointments/create (dashboard) and /agent-tools/book-appointment (voice
 * agent). Single source of truth for "is this a valid time range?" so
 * neither booking surface drifts from the other.
 *
 * Coverage focus:
 *   - validateAppointmentTimeRange: the existing range-shape rules.
 *   - isFifteenMinuteIncrement: the 15-min grid check added 2026-05-08.
 *     Pinned independently because both Zod refinements and the migration's
 *     CHECK constraint depend on the same notion of "valid increment."
 *
 * Why this file exists separately: pre-2026-05-08 the validator was only
 * exercised transitively via agentTools tests ("rejects absurd 23-hour
 * appointments"). Now that the helper carries the 15-min rule that the DB
 * CHECK and the dashboard form both depend on, it deserves its own focused
 * 5W-annotated coverage.
 */
import { describe, it, expect } from 'vitest';

import {
  isFifteenMinuteIncrement,
  validateAppointmentTimeRange,
  VALID_INCREMENT_MINUTES,
} from './appointmentValidation';

describe('VALID_INCREMENT_MINUTES', () => {
  it('exports the canonical [0, 15, 30, 45] grid', () => {
    // WHY: any consumer (UI dropdown, RPC docs, doc generation) reading this
    //       array gets exactly the same set the DB CHECK enforces. Drift
    //       between this constant and the migration's IN (...) clause would
    //       silently desync the layers — pin it here.
    expect(VALID_INCREMENT_MINUTES).toEqual([0, 15, 30, 45]);
  });
});

describe('isFifteenMinuteIncrement', () => {
  // WHO: backend Zod refinements + future dashboard time-picker validation
  // WHAT: returns true iff the ISO string lands on a 15-minute boundary at
  //        UTC with zero seconds and zero milliseconds
  // WHERE: src/services/appointmentValidation.ts
  // WHY: any real-world timezone preserves 15-min mod against UTC (verified
  //        for whole-hour, half-hour, and quarter-hour offsets), so checking
  //        UTC is equivalent to checking local — and timezone-independent

  it.each([
    ['2026-05-10T14:00:00Z', '14:00 UTC — :00 minute'],
    ['2026-05-10T14:15:00Z', ':15 minute'],
    ['2026-05-10T14:30:00Z', ':30 minute'],
    ['2026-05-10T14:45:00Z', ':45 minute'],
    ['2026-05-10T00:00:00Z', 'midnight'],
    ['2026-05-10T23:45:00Z', 'late-night :45'],
  ])('HAPPY: accepts %s (%s)', (iso) => {
    expect(isFifteenMinuteIncrement(iso)).toBe(true);
  });

  it.each([
    ['2026-05-10T14:01:00Z', ':01 — off by 1 minute'],
    ['2026-05-10T14:07:00Z', ':07 — middle of the gap'],
    ['2026-05-10T14:14:00Z', ':14 — one minute before :15'],
    ['2026-05-10T14:16:00Z', ':16 — one minute after :15'],
    ['2026-05-10T14:23:00Z', ':23'],
    ['2026-05-10T14:59:00Z', ':59 — boundary minus 1'],
  ])('SAD: rejects %s (%s)', (iso) => {
    expect(isFifteenMinuteIncrement(iso)).toBe(false);
  });

  it('SAD: rejects sub-minute precision — :00:30 (half-second past :00)', () => {
    // WHY: the DB CHECK also rejects EXTRACT(SECOND) <> 0; the validator must
    //       match so the DB doesn't reject a row the validator passed.
    expect(isFifteenMinuteIncrement('2026-05-10T14:00:30Z')).toBe(false);
  });

  it('SAD: rejects sub-second precision — :00:00.500 (half-millisecond past :00)', () => {
    // WHY: same as above — DB EXTRACT(SECOND) returns fractional seconds, so
    //       0.5 fails the = 0 check.
    expect(isFifteenMinuteIncrement('2026-05-10T14:00:00.500Z')).toBe(false);
  });

  it('HAPPY: half-hour offset timezone preserves the grid (IST)', () => {
    // WHO: a hypothetical IST tenant booking 1:00 PM IST (+05:30)
    // WHAT: 1:00 IST = 07:30 UTC; UTC minute = 30; passes the check
    // WHY: half-hour offsets shift UTC minutes by 30 — but 30 is itself in
    //       the {0,15,30,45} set, so the local-clock invariant survives
    expect(isFifteenMinuteIncrement('2026-05-10T07:30:00Z')).toBe(true);
  });

  it('HAPPY: quarter-hour offset timezone preserves the grid (Nepal)', () => {
    // WHO: hypothetical Nepal tenant (+05:45) booking 1:00 PM local
    // WHAT: 1:00 Nepal = 07:15 UTC; UTC minute = 15; passes
    // WHY: quarter-hour offsets shift UTC minutes by 45 — :00 local lands on
    //       :15 UTC, :15 → :30, :30 → :45, :45 → :00 next hour. All four
    //       targets stay within the valid set, so the constraint works
    //       without an AT TIME ZONE clause.
    expect(isFifteenMinuteIncrement('2026-05-10T07:15:00Z')).toBe(true);
  });

  it('HAPPY: returns true for null/undefined/empty (no double-error)', () => {
    // WHY: the caller layers this with z.string().min(1) which already
    //       reports "missing" — letting the increment check fire on null
    //       would produce two errors for one input gap and confuse the UI
    expect(isFifteenMinuteIncrement(null)).toBe(true);
    expect(isFifteenMinuteIncrement(undefined)).toBe(true);
    expect(isFifteenMinuteIncrement('')).toBe(true);
  });

  it('HAPPY: returns true for unparseable strings (lets downstream parser report)', () => {
    // WHY: same rationale as null/empty — parseDate() / Postgres will reject
    //       'not-a-date' with a clearer "invalid datetime" message; this
    //       validator's job is the increment check, not the parse check
    expect(isFifteenMinuteIncrement('not-a-date')).toBe(true);
  });
});

describe('validateAppointmentTimeRange — 15-min increment integration', () => {
  // WHO: route handlers calling the helper as the single validation entry
  // WHAT: confirm the 15-min check is reached AFTER the existing range
  //        checks, so a missing-time / inverted-range / over-long error
  //        takes precedence (more user-friendly)
  // WHERE: src/services/appointmentValidation.ts validateAppointmentTimeRange
  // WHY: ordering matters — if the increment check fired first on an
  //        inverted range, the operator would get "increment" when the
  //        real problem is "end < start". Pin the order.

  it('HAPPY: valid 15-min range returns null', () => {
    expect(
      validateAppointmentTimeRange('2026-05-10T14:00:00Z', '2026-05-10T14:30:00Z')
    ).toBeNull();
  });

  it('SAD: off-grid start returns INVALID_INCREMENT', () => {
    expect(
      validateAppointmentTimeRange('2026-05-10T14:07:00Z', '2026-05-10T14:30:00Z')
    ).toEqual({
      error: 'Start time must land on a 15-minute increment (:00, :15, :30, :45)',
      code: 'INVALID_INCREMENT',
    });
  });

  it('SAD: off-grid end returns INVALID_INCREMENT (start was valid)', () => {
    expect(
      validateAppointmentTimeRange('2026-05-10T14:00:00Z', '2026-05-10T14:23:00Z')
    ).toEqual({
      error: 'End time must land on a 15-minute increment (:00, :15, :30, :45)',
      code: 'INVALID_INCREMENT',
    });
  });

  it('SAD: missing time returns INVALID_PARAMS, not INVALID_INCREMENT', () => {
    // WHY: 'Start and end times are required' is more actionable than the
    //       increment message when the field is empty. Pin the precedence
    //       so the route can branch on code (re-ask both fields, not snap-to-grid).
    expect(validateAppointmentTimeRange('', '2026-05-10T14:30:00Z')).toEqual({
      error: 'Start and end times are required',
      code: 'INVALID_PARAMS',
    });
  });

  it('SAD: inverted range returns INVALID_RANGE, not INVALID_INCREMENT', () => {
    expect(
      validateAppointmentTimeRange('2026-05-10T14:30:00Z', '2026-05-10T14:00:00Z')
    ).toEqual({
      error: 'End time must be after start time',
      code: 'INVALID_RANGE',
    });
  });

  it('SAD: 13-hour range returns INVALID_DURATION', () => {
    expect(
      validateAppointmentTimeRange('2026-05-10T08:00:00Z', '2026-05-10T21:00:00Z')
    ).toEqual({
      error: 'Appointment duration cannot exceed 12 hours',
      code: 'INVALID_DURATION',
    });
  });

  it('SAD: unparseable date returns INVALID_PARAMS', () => {
    // WHY: Date constructor on garbage gives NaN; the helper must catch
    //       that BEFORE the increment check (which short-circuits true on
    //       NaN to avoid double-reporting).
    expect(
      validateAppointmentTimeRange('not-a-date', '2026-05-10T14:30:00Z')
    ).toEqual({
      error: 'Invalid date/time',
      code: 'INVALID_PARAMS',
    });
  });
});
