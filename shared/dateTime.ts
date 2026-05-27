/**
 * Pure date/time formatting helpers.
 *
 * Moved here from dashboard/lib/utils.ts to eliminate duplication and provide
 * consistent behavior between backend and dashboard.
 *
 * These are safe to import from both runtimes (no Node/Next specific deps).
 */

/**
 * Converts a date to a local ISO string (YYYY-MM-DDTHH:mm) for datetime-local inputs.
 */
export function toLocalISO(date: string | Date): string {
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const tzOffset = d.getTimezoneOffset() * 60000;
  const localISO = new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
  return localISO;
}

/**
 * Ensures a date string is in full ISO format with timezone offset.
 */
export function toISOStringWithOffset(value: string): string {
  if (!value) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString();
}

/**
 * Converts a 24-hour time string (e.g. "14:30" or "14:30:00") to 12-hour AM/PM format (e.g. "2:30 PM").
 */
export function formatTime24to12(time: string): string {
  const [hStr, mStr] = time.split(':');
  const h = parseInt(hStr, 10);
  const m = mStr || '00';
  if (h === 0) return `12:${m} AM`;
  if (h === 12) return `12:${m} PM`;
  if (h < 12) return `${h}:${m} AM`;
  return `${h - 12}:${m} PM`;
}

/**
 * Formats an hour number (0-24) to short AM/PM label (e.g. 0 -> "12am", 13 -> "1pm").
 */
export function formatHour(h: number): string {
  if (h === 0 || h === 24) return '12am';
  if (h === 12) return '12pm';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

/**
 * Formats an hour number to spaced AM/PM label (e.g. 0 -> "12 AM", 13 -> "1 PM").
 */
export function formatHourLabel(h: number): string {
  if (h === 0 || h === 24) return '12 AM';
  if (h === 12) return '12 PM';
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

/**
 * Parses a time string (e.g. "08:30:00" or "08:30") to fractional hours (e.g. 8.5).
 */
export function shiftTimeToHour(timeStr: string): number {
  const parts = timeStr.split(':');
  return parseInt(parts[0], 10) + parseInt(parts[1] || '0', 10) / 60;
}

/**
 * Formats a shift time string to short hour label (e.g. "08:30:00" -> "8am").
 */
export function formatShiftTime(timeStr: string): string {
  const h = Math.floor(shiftTimeToHour(timeStr));
  return formatHour(h);
}

/**
 * Formats an ISO datetime string to 12-hour time (e.g. "2026-04-03T14:30:00Z" -> "2:30 PM").
 */
export function formatTimeFromISO(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}
