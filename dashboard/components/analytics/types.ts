/**
 * Local data shapes for the Analytics view — not in lib/types.ts because
 * they are computed client-side from the appointments API response rather
 * than returned directly by the backend.
 */

export interface AppointmentSummary {
  total: number;
  byDay: Record<string, number>;
  byHour: Record<number, number>;
  noShowsByDay: Record<string, number>;
  returnRate: Record<string, { first: number; returned: number }>;
}
