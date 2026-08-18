/**
 * Shared appointment time validation logic.
 *
 * Single source of truth for:
 * - 15-minute increment rules (mirrors DB CHECK constraints)
 * - Duration limits
 * - Time range validation
 *
 * Used by backend (routes + agent tools) and dashboard (forms).
 * The backend version exposes rich error codes; the dashboard version
 * can keep a thin string-returning wrapper if needed for existing callers.
 */

export const MAX_APPOINTMENT_DURATION_HOURS = 12;

/**
 * Valid minute values for the 15-minute booking grid.
 * Mirrors the DB CHECK constraint (appointments_start_time_15min /
 * appointments_end_time_15min) added 2026-05-08.
 */
export const VALID_INCREMENT_MINUTES: ReadonlyArray<number> = [0, 15, 30, 45];

/**
 * True if the ISO timestamp (or datetime-local value) lands on a 15-minute
 * clock boundary in UTC with zero seconds and zero milliseconds.
 * Returns true for unparseable input so the caller can let downstream
 * parsing produce its own error.
 *
 * Why UTC: any real-world timezone offset preserves the 15-min mod against UTC.
 */
export function isFifteenMinuteIncrement(value: string | null | undefined): boolean {
  if (!value) return true;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return true;
  return (
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0 &&
    VALID_INCREMENT_MINUTES.includes(d.getUTCMinutes())
  );
}

/**
 * Stable error codes so route handlers, forms, agent prompts, and metrics
 * can branch without string-matching messages.
 */
export type AppointmentValidationCode =
  'INVALID_PARAMS' | 'INVALID_RANGE' | 'INVALID_DURATION' | 'INVALID_INCREMENT';

export interface AppointmentValidationError {
  error: string;
  code: AppointmentValidationCode;
}

/**
 * Full validation used by backend routes and agent tools.
 * Returns structured error (with code) or null.
 */
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
