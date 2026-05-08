export const MAX_APPOINTMENT_DURATION_HOURS = 12;

/**
 * Valid minute values for the 15-minute booking grid. Mirrors the
 * backend constant in src/services/appointmentValidation.ts and the DB
 * CHECK constraint (appointments_start_time_15min /
 * appointments_end_time_15min, migration 20260508000000).
 */
export const VALID_INCREMENT_MINUTES: ReadonlyArray<number> = [0, 15, 30, 45];

/**
 * True if the value (datetime-local string or ISO) lands on a 15-minute
 * boundary in UTC with zero seconds and zero milliseconds. Returns true
 * for unparseable input so the caller can let downstream parsing produce
 * its own error rather than double-reporting "invalid datetime".
 *
 * Why UTC: any real-world timezone offset (whole, half, or quarter-hour)
 * preserves 15-min mod against UTC — checking UTC is equivalent to
 * checking local, and timezone-independent.
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

export function validateAppointmentTimeRange(startTime: string, endTime: string): string | null {
  if (!startTime || !endTime) {
    return 'Start and end times are required';
  }

  const startDt = new Date(startTime);
  const endDt = new Date(endTime);
  if (Number.isNaN(startDt.getTime()) || Number.isNaN(endDt.getTime())) {
    return 'Invalid date/time';
  }

  if (endDt <= startDt) {
    return 'End time must be after start time';
  }

  const maxMs = MAX_APPOINTMENT_DURATION_HOURS * 60 * 60 * 1000;
  if (endDt.getTime() - startDt.getTime() > maxMs) {
    return `Appointment duration cannot exceed ${MAX_APPOINTMENT_DURATION_HOURS} hours`;
  }

  if (!isFifteenMinuteIncrement(startTime)) {
    return 'Start time must land on a 15-minute increment (:00, :15, :30, :45)';
  }
  if (!isFifteenMinuteIncrement(endTime)) {
    return 'End time must land on a 15-minute increment (:00, :15, :30, :45)';
  }

  return null;
}
