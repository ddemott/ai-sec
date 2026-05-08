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

export function validateAppointmentTimeRange(startTime?: string | null, endTime?: string | null): string | null {
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
