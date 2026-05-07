export const MAX_APPOINTMENT_DURATION_HOURS = 12;

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

  return null;
}
