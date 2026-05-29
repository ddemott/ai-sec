// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
import { dateFnsLocalizer } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { enUS } from 'date-fns/locale/en-US';
import type { Appointment } from '../types';

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales: { 'en-US': enUS },
});

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  resource_id: string;
  employee_id?: string | null;
  customers?: Appointment['customers'];
  resources?: Appointment['resources'];
  status: string;
  location?: string;
}

// Zoom: step in minutes per slot (smaller = more zoomed in)
export const ZOOM_LEVELS = [60, 30, 15, 10, 5];
export const CALENDAR_TIMESLOTS = 1;

// 24-hour day boundaries — fixed date keeps react-big-calendar's scroll stable
export const CALENDAR_MIN = new Date(2000, 0, 1, 0, 0, 0);
export const CALENDAR_MAX = new Date(2000, 0, 1, 23, 59, 59);
export const CALENDAR_SCROLL_TO = new Date(2000, 0, 1, 7, 0, 0);

export function toCalendarEvent(a: Appointment, bookingLabel: string): CalendarEvent {
  return {
    id: a.appointment_id,
    title: a.description || a.customers?.name || bookingLabel,
    start: new Date(a.start_time),
    end: new Date(a.end_time),
    resource_id: a.resource_id,
    employee_id: a.employee_id,
    customers: a.customers,
    resources: a.resources,
    status: a.status,
    location: a.location,
  };
}
