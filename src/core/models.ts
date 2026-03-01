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
