export interface Tenant {
  id: string;
  name: string;
}

export interface WorkingHours {
  // Simple representation: day-of-week to [start,end] strings in local time
  [day: string]: Array<{ start: string; end: string }>;
}

export interface Resource {
  id: string;
  tenantId: string;
  name: string;
  timezone: string;
  defaultSlotDurationMinutes: number;
  workingHours: WorkingHours;
}

export interface Customer {
  id: string;
  tenantId: string;
  phone: string;
  name?: string;
  address?: string;
  vehicleInfo?: string;
  notes?: string;
}

export type AppointmentStatus = 'scheduled' | 'completed' | 'canceled';

export interface Appointment {
  id: string;
  tenantId: string;
  resourceId: string;
  customerId: string;
  startTime: string; // ISO string
  endTime: string;   // ISO string
  location: string;
  description?: string;
  status: AppointmentStatus;
}

export interface TimeWindow {
  from: Date;
  to: Date;
}

export interface TimeSlot {
  start: Date;
  end: Date;
}

/**
 * BUG-029: Mapping between string day keys (WorkingHours) and numeric day_of_week (employee_shifts).
 * Numeric values match PostgreSQL's EXTRACT(DOW ...) where 0 = Sunday.
 */
const DAY_STRING_TO_NUM: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

const DAY_NUM_TO_STRING: Record<number, string> = {
  0: 'sun', 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat',
};

export function dayStringToNum(day: string): number {
  const num = DAY_STRING_TO_NUM[day.toLowerCase()];
  if (num === undefined) throw new Error(`Unknown day string: ${day}`);
  return num;
}

export function dayNumToString(dow: number): string {
  const str = DAY_NUM_TO_STRING[dow];
  if (!str) throw new Error(`Unknown day number: ${dow}`);
  return str;
}

export function workingHoursToShifts(wh: WorkingHours): Array<{ day_of_week: number; start_time: string; end_time: string }> {
  const shifts: Array<{ day_of_week: number; start_time: string; end_time: string }> = [];
  for (const [day, windows] of Object.entries(wh)) {
    const dow = dayStringToNum(day);
    for (const w of windows) {
      shifts.push({ day_of_week: dow, start_time: w.start, end_time: w.end });
    }
  }
  return shifts;
}

export function shiftsToWorkingHours(shifts: Array<{ day_of_week: number; start_time: string; end_time: string }>): WorkingHours {
  const wh: WorkingHours = {};
  for (const s of shifts) {
    const day = dayNumToString(s.day_of_week);
    if (!wh[day]) wh[day] = [];
    wh[day].push({ start: s.start_time, end: s.end_time });
  }
  return wh;
}
