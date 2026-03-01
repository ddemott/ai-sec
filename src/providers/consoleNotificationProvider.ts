import type { Appointment } from '../core/models';
import type { NotificationProvider, TelephonyProvider } from '../core/providers';

export class ConsoleNotificationProvider implements NotificationProvider {
  constructor(private readonly telephony: TelephonyProvider, private readonly ownerPhone: string) {}

  async notifyOwnerOfAppointment(appointment: Appointment): Promise<void> {
    const text =
      `New appointment scheduled: ${appointment.startTime} - ${appointment.endTime} at ${appointment.location}.`;
    // For now, also log to console.
    // In real use, this sends an SMS via TelephonyProvider.
    // eslint-disable-next-line no-console
    console.log('[Notification] Owner SMS:', text);
    await this.telephony.sendSms(this.ownerPhone, text);
  }
}
