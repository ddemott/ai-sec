export const MAX_APPOINTMENT_DURATION_HOURS = 12;

/**
 * Valid minute values for the 15-minute booking grid.
 * Mirrors the DB CHECK constraint (appointments_start_time_15min /
 * appointments_end_time_15min) added 2026-05-08.
 */
export const VALID_INCREMENT_MINUTES: ReadonlyArray<number> = [0, 15, 30, 45];

/**
 * True if the ISO timestamp lands on a 15-minute clock boundary in UTC
 * with zero seconds and zero milliseconds. Returns true for unparseable
 * strings so the caller can let downstream parsing produce its own error
 * (we don't want this validator double-reporting "invalid datetime").
 *
 * Why UTC: any real-world timezone offset (whole, half, or quarter-hour)
 * preserves the 15-min mod against UTC. A local-clock :00/:15/:30/:45 in
 * IST (+05:30), Nepal (+05:45), Newfoundland (-03:30), or any whole-hour
 * zone always maps to a UTC :00/:15/:30/:45 — so checking UTC is the same
 * as checking local. Simpler and timezone-independent.
 */
export function isFifteenMinuteIncrement(iso: string | null | undefined): boolean {
  if (!iso) return true;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return true;
  return (
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0 &&
    VALID_INCREMENT_MINUTES.includes(d.getUTCMinutes())
  );
}

/**
 * Stable error codes returned alongside the human-readable message so route
 * handlers can branch on the failure mode without string-matching the
 * message. Add new codes here when adding new validation rules; consumers
 * (dashboard form, agent prompt, metrics) read the code, not the message.
 */
export type AppointmentValidationCode =
  | 'INVALID_PARAMS'
  | 'INVALID_RANGE'
  | 'INVALID_DURATION'
  | 'INVALID_INCREMENT';

export interface AppointmentValidationError {
  error: string;
  code: AppointmentValidationCode;
}

export function validateAppointmentTimeRange(
  startTime?: string | null,
  endTime?: string | null
): AppointmentValidationError | null {
  if (!startTime || !endTime) {
    return { error: 'Start and end times are required', code: 'INVALID_PARAMS' };
  }

  const startDt = new Date(startTime);
  const endDt = new Date(endTime);
  if (Number.isNaN(startDt.getTime()) || Number.isNaN(endDt.getTime())) {
    return { error: 'Invalid date/time', code: 'INVALID_PARAMS' };
  }

  if (endDt <= startDt) {
    return { error: 'End time must be after start time', code: 'INVALID_RANGE' };
  }

  const maxMs = MAX_APPOINTMENT_DURATION_HOURS * 60 * 60 * 1000;
  if (endDt.getTime() - startDt.getTime() > maxMs) {
    return {
      error: `Appointment duration cannot exceed ${MAX_APPOINTMENT_DURATION_HOURS} hours`,
      code: 'INVALID_DURATION',
    };
  }

  if (!isFifteenMinuteIncrement(startTime)) {
    return {
      error: 'Start time must land on a 15-minute increment (:00, :15, :30, :45)',
      code: 'INVALID_INCREMENT',
    };
  }
  if (!isFifteenMinuteIncrement(endTime)) {
    return {
      error: 'End time must land on a 15-minute increment (:00, :15, :30, :45)',
      code: 'INVALID_INCREMENT',
    };
  }

  return null;
}
