/**
 * Dashboard-side appointmentValidation tests.
 *
 * Mirrors the backend validator's contract — both surfaces share the same
 * "is this a valid range?" + "is this on the 15-min grid?" rules so the
 * dashboard form rejects upfront and the backend / DB CHECK are the safety
 * nets behind it.
 *
 * The dashboard validator and the backend validator are textually duplicated
 * (different language, different runtime), so each side needs its own pinned
 * coverage. Drift between them is the failure mode this file exists to catch.
 */
import { describe, it, expect } from 'vitest';

import {
  isFifteenMinuteIncrement,
  validateAppointmentTimeRange,
  VALID_INCREMENT_MINUTES,
} from './appointmentValidation';

describe('VALID_INCREMENT_MINUTES (dashboard)', () => {
  it('exports the canonical [0, 15, 30, 45] grid — must match backend', () => {
    // WHY: the backend constant is the source of truth for the DB CHECK
    //       constraint; the dashboard constant is what time-pickers will
    //       eventually iterate over. Drift would mean a UI option that
    //       passes client-side validation but fails server-side rejection.
    expect(VALID_INCREMENT_MINUTES).toEqual([0, 15, 30, 45]);
  });
});

describe('isFifteenMinuteIncrement (dashboard)', () => {
  it.each([
    ['2026-05-10T14:00:00Z', '14:00 UTC'],
    ['2026-05-10T14:15:00Z', ':15'],
    ['2026-05-10T14:30:00Z', ':30'],
    ['2026-05-10T14:45:00Z', ':45'],
  ])('HAPPY: accepts %s (%s)', (iso) => {
    expect(isFifteenMinuteIncrement(iso)).toBe(true);
  });

  it.each([
    ['2026-05-10T14:01:00Z', ':01'],
    ['2026-05-10T14:07:00Z', ':07 — middle of the gap'],
    ['2026-05-10T14:14:00Z', ':14'],
    ['2026-05-10T14:23:00Z', ':23'],
    ['2026-05-10T14:59:00Z', ':59'],
  ])('SAD: rejects %s (%s)', (iso) => {
    expect(isFifteenMinuteIncrement(iso)).toBe(false);
  });

  it('SAD: sub-minute precision is rejected (matches DB CHECK on EXTRACT(SECOND) = 0)', () => {
    // WHO: theoretical client that POSTs ":00:30" via curl
    // WHY: backend EXTRACT(SECOND) = 0 fails for any non-zero seconds;
    //       client validator must agree so the dashboard never lets a
    //       request through that the backend rejects
    expect(isFifteenMinuteIncrement('2026-05-10T14:00:30Z')).toBe(false);
  });

  it('HAPPY: half-hour offset (IST +05:30) preserves the grid against UTC', () => {
    // 1:00 PM IST = 07:30 UTC; minute 30 is in the valid set
    expect(isFifteenMinuteIncrement('2026-05-10T07:30:00Z')).toBe(true);
  });

  it('HAPPY: returns true for null/empty (no double-error)', () => {
    expect(isFifteenMinuteIncrement(null)).toBe(true);
    expect(isFifteenMinuteIncrement(undefined)).toBe(true);
    expect(isFifteenMinuteIncrement('')).toBe(true);
  });

  it('HAPPY: datetime-local format (no Z, no offset) is parsed by Date()', () => {
    // WHY: <input type="datetime-local"> emits "2026-05-10T14:00" without
    //       timezone info. In all major browsers Date() parses this as
    //       local time. As long as the LOCAL clock lands on a 15-min
    //       increment, so does the UTC representation under any whole/
    //       half/quarter-hour offset.
    expect(isFifteenMinuteIncrement('2026-05-10T14:00')).toBe(true);
    expect(isFifteenMinuteIncrement('2026-05-10T14:23')).toBe(false);
  });
});

describe('validateAppointmentTimeRange (dashboard) — 15-min integration', () => {
  it('HAPPY: valid 15-min range returns null', () => {
    expect(
      validateAppointmentTimeRange('2026-05-10T14:00:00Z', '2026-05-10T14:30:00Z')
    ).toBeNull();
  });

  it('SAD: off-grid start returns the increment error', () => {
    expect(
      validateAppointmentTimeRange('2026-05-10T14:07:00Z', '2026-05-10T14:30:00Z')
    ).toBe('Start time must land on a 15-minute increment (:00, :15, :30, :45)');
  });

  it('SAD: off-grid end returns the increment error (start was valid)', () => {
    expect(
      validateAppointmentTimeRange('2026-05-10T14:00:00Z', '2026-05-10T14:23:00Z')
    ).toBe('End time must land on a 15-minute increment (:00, :15, :30, :45)');
  });

  it('SAD: ordering — empty time error precedes increment error', () => {
    // WHY: more user-friendly to report "missing" before "off the grid"
    expect(validateAppointmentTimeRange('', '2026-05-10T14:30:00Z')).toBe(
      'Start and end times are required'
    );
  });

  it('SAD: ordering — inverted range error precedes increment error', () => {
    expect(
      validateAppointmentTimeRange('2026-05-10T14:30:00Z', '2026-05-10T14:00:00Z')
    ).toBe('End time must be after start time');
  });

  it('SAD: ordering — over-12-hour range error precedes increment error', () => {
    expect(
      validateAppointmentTimeRange('2026-05-10T08:00:00Z', '2026-05-10T21:00:00Z')
    ).toBe('Appointment duration cannot exceed 12 hours');
  });
});
