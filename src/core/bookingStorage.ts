import type { Appointment, Customer, Resource, TimeSlot, TimeWindow } from './models';

export interface NewAppointmentInput {
  tenantId: string;
  resourceId: string;
  customerId: string;
  startTime: Date;
  endTime: Date;
  location: string;
  description?: string;
}

export interface BookingStorage {
  findOrCreateCustomerByPhone(
    tenantId: string,
    phone: string,
    extra?: Partial<Omit<Customer, 'id' | 'tenantId' | 'phone'>>
  ): Promise<Customer>;

  getResourceById(resourceId: string): Promise<Resource | null>;

  getNextAvailableSlot(resourceId: string, window: TimeWindow): Promise<TimeSlot | null>;

  createAppointment(input: NewAppointmentInput): Promise<Appointment>;
}
