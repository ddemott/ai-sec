import { randomUUID } from 'node:crypto';
import type { Appointment, Customer, Resource, TimeSlot, TimeWindow } from '../core/models';
import type { BookingStorage, NewAppointmentInput } from '../core/bookingStorage';

interface State {
  tenants: string[];
  resources: Resource[];
  customers: Customer[];
  appointments: Appointment[];
}

const state: State = {
  tenants: ['dynatire-tenant'],
  resources: [
    {
      id: 'dynatire-resource',
      tenantId: 'dynatire-tenant',
      name: 'DynaTire Truck',
      timezone: 'America/New_York',
      defaultSlotDurationMinutes: 60,
      workingHours: {
        mon: [{ start: '09:00', end: '17:00' }],
        tue: [{ start: '09:00', end: '17:00' }],
        wed: [{ start: '09:00', end: '17:00' }],
        thu: [{ start: '09:00', end: '17:00' }],
        fri: [{ start: '09:00', end: '17:00' }],
      },
    },
  ],
  customers: [],
  appointments: [],
};

export class InMemoryBookingStorage implements BookingStorage {
  async findOrCreateCustomerByPhone(
    tenantId: string,
    phone: string,
    extra?: Partial<Omit<Customer, 'id' | 'tenantId' | 'phone'>>
  ): Promise<Customer> {
    let customer = state.customers.find((c) => c.tenantId === tenantId && c.phone === phone);
    if (!customer) {
      customer = {
        id: randomUUID(),
        tenantId,
        phone,
        ...extra,
      };
      state.customers.push(customer);
    } else if (extra) {
      customer = Object.assign(customer, extra);
    }
    return customer;
  }

  async getResourceById(resourceId: string): Promise<Resource | null> {
    return state.resources.find((r) => r.id === resourceId) ?? null;
  }

  async getNextAvailableSlot(resourceId: string, window: TimeWindow): Promise<TimeSlot | null> {
    const durationMinutes = 60;
    const start = new Date(window.from);
    const end = new Date(start.getTime() + durationMinutes * 60 * 1000);

    // Check for overlaps with existing appointments on this resource
    const hasOverlap = state.appointments.some(
      (a) =>
        a.resourceId === resourceId &&
        a.status === 'scheduled' &&
        new Date(a.startTime) < end &&
        new Date(a.endTime) > start
    );

    if (hasOverlap) {
      return null;
    }

    return { start, end };
  }

  async createAppointment(input: NewAppointmentInput): Promise<Appointment> {
    // Check for resource overlap before inserting
    const hasOverlap = state.appointments.some(
      (a) =>
        a.resourceId === input.resourceId &&
        a.status === 'scheduled' &&
        new Date(a.startTime) < input.endTime &&
        new Date(a.endTime) > input.startTime
    );

    if (hasOverlap) {
      throw new Error('Resource slot already booked');
    }

    const appointment: Appointment = {
      id: randomUUID(),
      tenantId: input.tenantId,
      resourceId: input.resourceId,
      customerId: input.customerId,
      startTime: input.startTime.toISOString(),
      endTime: input.endTime.toISOString(),
      location: input.location,
      description: input.description,
      status: 'scheduled',
    };
    state.appointments.push(appointment);
    return appointment;
  }
}
