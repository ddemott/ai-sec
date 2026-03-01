import type { BookingStorage } from '../core/bookingStorage';
import type { NotificationProvider } from '../core/providers';
import type { Appointment, TimeWindow } from '../core/models';

export interface BookingRequest {
  tenantId: string;
  resourceId: string;
  customerPhone: string;
  customerName?: string;
  address: string;
  description?: string;
  window: TimeWindow;
}

export class BookingService {
  constructor(
    private readonly storage: BookingStorage,
    private readonly notifications: NotificationProvider,
  ) {}

  async bookSimpleAppointment(req: BookingRequest): Promise<Appointment> {
    const customer = await this.storage.findOrCreateCustomerByPhone(req.tenantId, req.customerPhone, {
      name: req.customerName,
      address: req.address,
    });

    const slot = await this.storage.getNextAvailableSlot(req.resourceId, req.window);
    if (!slot) {
      throw new Error('No available slots');
    }

    const appointment = await this.storage.createAppointment({
      tenantId: req.tenantId,
      resourceId: req.resourceId,
      customerId: customer.id,
      startTime: slot.start,
      endTime: slot.end,
      location: req.address,
      description: req.description,
    });

    await this.notifications.notifyOwnerOfAppointment(appointment);

    return appointment;
  }
}
