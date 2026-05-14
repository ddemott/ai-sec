import type { Appointment, ReminderSchedule } from '../../types/index.js';
import type { ReminderRepository } from './reminderRepository.js';
import type { ReminderData } from './types.js';

export class ReminderScheduler {
  private scheduledReminders: Map<string, NodeJS.Timeout> = new Map();

  constructor(private repository: ReminderRepository) {}

  /**
   * Schedule reminders for a new appointment
   */
  async scheduleAppointmentReminders(appointment: Appointment): Promise<void> {
    const appointmentDateTime = new Date(appointment.date_time || appointment.start_time);
    const now = new Date();

    // Don't schedule reminders for past appointments
    if (appointmentDateTime <= now) {
      return;
    }

    const reminders = [
      { type: 'confirmation' as const, hoursBefore: 0 }, // Immediate confirmation
      { type: '72h' as const, hoursBefore: 72 },
      { type: '24h' as const, hoursBefore: 24 },
      { type: '2h' as const, hoursBefore: 2 },
    ];

    for (const reminder of reminders) {
      const scheduledFor =
        reminder.type === 'confirmation'
          ? new Date() // Immediate confirmation
          : new Date(appointmentDateTime.getTime() - reminder.hoursBefore * 60 * 60 * 1000);

      // Only schedule future reminders
      if (scheduledFor > now || reminder.type === 'confirmation') {
        await this.scheduleReminder({
          appointment_id: appointment.appointment_id,
          tenant_id: appointment.tenant_id,
          customer_email: appointment.customer_email || '',
          customer_phone: appointment.customer_phone,
          reminder_type: reminder.type,
          scheduled_for: scheduledFor.toISOString(),
        });
      }
    }
  }

  /**
   * Schedule a single reminder
   */
  private async scheduleReminder(reminderData: ReminderData): Promise<void> {
    const reminderId = await this.repository.saveReminder(reminderData);

    // Schedule the reminder to be processed at the specified time
    const scheduledFor = new Date(reminderData.scheduled_for);
    const now = new Date();
    const delay = scheduledFor.getTime() - now.getTime();

    if (delay > 0) {
      const timeout = setTimeout(async () => {
        // Import the processor here to avoid circular dependencies
        const { ReminderProcessor: _ReminderProcessor } = await import('./reminderProcessor.js');
        // Note: In a real implementation, we'd need to inject the processor
        // For now, this is a placeholder - the actual processing would be done by a job queue
        console.log(`Processing reminder ${reminderId}`);
        this.scheduledReminders.delete(reminderId);
      }, delay);

      this.scheduledReminders.set(reminderId, timeout);
    }
  }

  /**
   * Cancel all reminders for an appointment
   */
  async cancelAppointmentReminders(appointmentId: string, tenantId: string): Promise<void> {
    await this.repository.cancelAppointmentReminders(appointmentId, tenantId);

    // Clear any scheduled timeouts
    // Note: In a real implementation, we'd need to track which timeouts belong to which appointment
    // For now, we'll rely on the database status updates
  }

  /**
   * Reschedule reminders for an appointment
   */
  async rescheduleAppointmentReminders(
    appointmentId: string,
    tenantId: string,
    newDateTime: string,
  ): Promise<void> {
    await this.repository.rescheduleAppointmentReminders(appointmentId, tenantId, newDateTime);
    // Cancel existing and schedule new ones
    await this.cancelAppointmentReminders(appointmentId, tenantId);

    // Get the appointment and reschedule
    const appointment = await this.repository.getAppointmentDetails(appointmentId, tenantId);
    if (appointment) {
      // Update the appointment datetime
      const updatedAppointment = { ...appointment, date_time: newDateTime };
      await this.scheduleAppointmentReminders(updatedAppointment);
    }
  }

  /**
   * Get all scheduled reminders for a tenant
   */
  async getScheduledReminders(tenantId: string): Promise<ReminderSchedule[]> {
    return await this.repository.getScheduledReminders(tenantId);
  }

  /**
   * Clean up scheduled timeouts
   */
  cleanup(): void {
    for (const timeout of this.scheduledReminders.values()) {
      clearTimeout(timeout);
    }
    this.scheduledReminders.clear();
  }
}
