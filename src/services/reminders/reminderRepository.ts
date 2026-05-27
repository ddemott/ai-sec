/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
/**
 * no-unsafe-* rules disabled: this repository uses the dynamic DatabaseService
 * layer (which itself has disables) and performs raw query result access.
 *
 * Part of ESLint debt reduction (REFACTORING_TODO.md item 10).
 */

import type { DatabaseService } from '../../database/index.js';
import type { Appointment } from '../../types/index.js';
import type { ReminderSchedule, ReminderData } from './types.js';

export class ReminderRepository {
  constructor(private db: DatabaseService) {}

  /**
   * Save a reminder schedule to the database
   */
  async saveReminder(reminderData: ReminderData): Promise<string> {
    const reminder: Omit<ReminderSchedule, 'reminder_schedule_id'> = {
      ...reminderData,
      status: 'scheduled',
    };

    const savedReminder = await this.db.createReminderSchedule(reminder);
    return savedReminder.reminder_schedule_id.toString();
  }

  /**
   * Get appointment details by ID and tenant
   */
  async getAppointmentDetails(
    appointmentId: string,
    _tenantId: string
  ): Promise<Appointment | null> {
    const appointment = await this.db.getAppointmentById(appointmentId);
    if (!appointment) return null;

    // Transform from camelCase (AppointmentForReminder) to snake_case (Appointment)
    return {
      appointment_id: appointment.appointmentId,
      tenant_id: appointment.tenantId,
      customer_id: appointment.customerId,
      customer_name: appointment.customerName,
      customer_email: appointment.customerEmail,
      customer_phone: appointment.customerPhone,
      service_id: appointment.serviceId,
      service_name: appointment.serviceName,
      employee_id: appointment.staffId,
      staff_name: appointment.staffName,
      start_time: appointment.dateTime,
      end_time: appointment.dateTime, // Not available from AppointmentForReminder
      date_time: appointment.dateTime,
      duration: appointment.duration,
      status: appointment.status,
      notes: appointment.notes,
      cancelled_at: appointment.cancelledAt,
      cancel_reason: appointment.cancelReason,
      created_at: appointment.createdAt,
      updated_at: appointment.updatedAt,
    };
  }

  /**
   * Update reminder status
   */
  async updateReminderStatus(
    reminderId: string,
    status: ReminderSchedule['status'],
    error?: string
  ): Promise<void> {
    const updateData: Partial<ReminderSchedule> = { status };
    if (error) {
      updateData.error = error;
    }
    if (status === 'sent') {
      updateData.sent_at = new Date().toISOString();
    }
    await this.db.updateReminderSchedule(reminderId, updateData);
  }

  /**
   * Get all scheduled reminders for a tenant
   */
  async getScheduledReminders(tenantId: string): Promise<ReminderSchedule[]> {
    return await this.db.getReminderSchedulesByTenant(tenantId, 'scheduled');
  }

  /**
   * Get a specific reminder by ID
   */
  async getReminder(reminderId: string): Promise<ReminderSchedule | null> {
    return await this.db.getReminderSchedule(reminderId);
  }

  /**
   * Cancel reminders for an appointment
   */
  async cancelAppointmentReminders(appointmentId: string, tenantId: string): Promise<void> {
    const reminders = await this.db.getReminderSchedulesByAppointment(appointmentId, tenantId);
    if (!reminders) return;

    for (const reminder of reminders) {
      if (reminder.status === 'scheduled') {
        await this.db.updateReminderSchedule(reminder.reminder_schedule_id.toString(), {
          status: 'cancelled',
        });
      }
    }
  }

  /**
   * Reschedule reminders for an appointment
   */
  async rescheduleAppointmentReminders(
    appointmentId: string,
    tenantId: string,
    _newDateTime: string
  ): Promise<void> {
    // This is a complex operation that would need to be implemented
    // For now, we'll cancel existing reminders and let the scheduler create new ones
    await this.cancelAppointmentReminders(appointmentId, tenantId);
  }
}
