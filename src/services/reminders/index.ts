import type { DatabaseService } from '../../database/index.js';
import { CommunicationService } from '../communications/index.js';
import { ConsentService } from '../consentService.js';
import type { TenantConfigService } from '../tenants/index.js';

import type { ReminderSchedule } from './types.js';

export type { ReminderSchedule } from './types.js';

export class ReminderService {
  // Use injected mocks directly for all testable methods
  public db: DatabaseService;
  public configService: TenantConfigService;
  public consentService: ConsentService;
  public communicationService: CommunicationService;
  public scheduledReminders: Map<string, NodeJS.Timeout> = new Map();

  constructor(db: DatabaseService, configService: TenantConfigService) {
    this.db = db;
    this.configService = configService;
    this.consentService = new ConsentService(db);
    this.communicationService = new CommunicationService(configService, this.consentService);
  }

  /**
   * Schedule reminders for a new appointment
   */
  async scheduleAppointmentReminders(appointment: any): Promise<void> {
    // Normalize appointment fields and ensure IDs are integers, camelCase for all fields
    // Handle both camelCase (from services) and snake_case (from database) input
    const normalizedAppointment = {
      ...appointment,
      id: typeof appointment.id === 'string' ? parseInt(appointment.id, 10) : appointment.id,
      tenantId:
        typeof (appointment.tenantId || appointment.tenant_id) === 'string'
          ? parseInt(appointment.tenantId || appointment.tenant_id, 10)
          : appointment.tenantId || appointment.tenant_id,
      serviceId:
        typeof (appointment.serviceId || appointment.service_id) === 'string'
          ? parseInt(appointment.serviceId || appointment.service_id, 10)
          : appointment.serviceId || appointment.service_id,
      staffId:
        typeof (appointment.staffId || appointment.staff_id) === 'string'
          ? parseInt(appointment.staffId || appointment.staff_id, 10)
          : appointment.staffId || appointment.staff_id,
      customerEmail: appointment.customerEmail || appointment.customer_email,
      customerPhone: appointment.customerPhone || appointment.customer_phone,
      customerName: appointment.customerName || appointment.customer_name,
      serviceName: appointment.serviceName || appointment.service_name,
      staffName: appointment.staffName || appointment.staff_name,
      dateTime: appointment.dateTime || appointment.date_time,
      duration: appointment.duration,
      status: appointment.status,
      createdAt: appointment.createdAt || appointment.created_at,
      updatedAt: appointment.updatedAt || appointment.updated_at,
    };

    // Validate that we have a valid dateTime
    if (!normalizedAppointment.dateTime) {
      console.error(
        '❌ Cannot schedule reminders: appointment dateTime is missing or invalid',
        normalizedAppointment,
      );
      return;
    }

    const appointmentDateTime = new Date(normalizedAppointment.dateTime);
    if (isNaN(appointmentDateTime.getTime())) {
      console.error(
        '❌ Cannot schedule reminders: appointment dateTime is invalid',
        normalizedAppointment.dateTime,
      );
      return;
    }

    const now = new Date();
    // Only schedule reminders for future appointments
    if (appointmentDateTime <= now) {
      // Do not schedule any reminders for past appointments
      return;
    }

    // Always schedule all 4 reminders for future appointments
    const reminders = [
      { type: 'confirmation', hoursBefore: 0 },
      { type: '72h', hoursBefore: 72 },
      { type: '24h', hoursBefore: 24 },
      { type: '2h', hoursBefore: 2 },
    ];
    for (const reminder of reminders) {
      let scheduledFor;
      if (reminder.type === 'confirmation') {
        scheduledFor = now;
      } else {
        scheduledFor = new Date(
          appointmentDateTime.getTime() - reminder.hoursBefore * 60 * 60 * 1000,
        );
      }

      // Validate that scheduledFor is a valid date
      if (isNaN(scheduledFor.getTime())) {
        console.error(`❌ Cannot schedule ${reminder.type} reminder: invalid scheduled time`, {
          appointmentDateTime: appointmentDateTime.toISOString(),
          hoursBefore: reminder.hoursBefore,
          calculatedTime: scheduledFor,
        });
        continue; // Skip this reminder
      }

      await this.db.createReminderSchedule({
        appointment_id: parseInt(normalizedAppointment.id, 10),
        tenant_id: normalizedAppointment.tenantId,
        customer_email: normalizedAppointment.customerEmail,
        customer_phone: normalizedAppointment.customerPhone,
        reminder_type: reminder.type as 'confirmation' | '72h' | '24h' | '2h',
        scheduled_for: scheduledFor.toISOString(),
        status: 'scheduled',
      });
    }
    return;
  }

  /**
   * Process a scheduled reminder
   */
  async processReminder(reminderId: string): Promise<void> {
    try {
      const reminder = await this.db.getReminderSchedule(reminderId);
      if (!reminder) {
        await this.db.updateReminderSchedule(reminderId, {
          status: 'failed',
          error: 'Reminder not found',
        });
        return;
      }

      if (reminder.status !== 'scheduled') {
        return;
      }

      // Normalize reminder fields to camelCase
      const normalizedReminder = {
        ...reminder,
        reminderType: reminder.reminder_type,
        tenantId: reminder.tenant_id,
        appointmentId: reminder.appointment_id,
        customerEmail: reminder.customer_email,
        customerPhone: reminder.customer_phone,
        scheduledFor: reminder.scheduled_for,
      };

      // Use integer IDs for appointment lookup
      const appointmentId =
        typeof normalizedReminder.appointmentId === 'string'
          ? parseInt(normalizedReminder.appointmentId, 10)
          : normalizedReminder.appointmentId;
      const appointment = await this.db.getAppointmentById(appointmentId.toString());
      if (!appointment) {
        await this.updateReminderStatus(reminderId, 'failed', 'Appointment not found');
        return;
      }

      // Check if reminder is still relevant (appointment not cancelled and time hasn't passed)
      const appointmentDateTime = new Date(appointment.dateTime);
      const now = new Date();

      if (appointment.status === 'cancelled') {
        await this.updateReminderStatus(reminderId, 'cancelled', 'Appointment cancelled');
        return;
      }

      if (appointmentDateTime <= now) {
        await this.updateReminderStatus(
          reminderId,
          'cancelled',
          'Appointment cancelled or time passed',
        );
        return;
      }

      // Check communication consent
      const hasConsent = await this.checkCommunicationConsent(normalizedReminder, appointment);
      if (!hasConsent) {
        await this.updateReminderStatus(reminderId, 'cancelled', 'No consent for communication');
        return;
      }

      // Send the reminder
      const sent = await this.sendReminder(normalizedReminder, appointment);
      if (sent) {
        await this.updateReminderStatus(reminderId, 'sent');
      } else {
        await this.updateReminderStatus(reminderId, 'failed', 'Communication failed');
      }
    } catch (error) {
      await this.updateReminderStatus(reminderId, 'failed', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Manually trigger a reminder
   */
  async triggerReminder(reminderId: string): Promise<boolean> {
    const reminder = await this.db.getReminderSchedule(reminderId);
    if (!reminder) {
      return false;
    }
    if (reminder.status !== 'scheduled') {
      return false;
    }
    try {
      await this.processReminder(reminderId);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Cancel all reminders for an appointment
   */
  async cancelAppointmentReminders(appointmentId: string, tenantId: string): Promise<void> {
    // Use db mock for cancellation and update status for each reminder
    const intTenantId = typeof tenantId === 'string' ? parseInt(tenantId, 10) : tenantId;
    const reminders = await this.db.getReminderSchedulesByAppointment(appointmentId, intTenantId);
    if (reminders && reminders.length) {
      for (const reminder of reminders) {
        await this.db.updateReminderSchedule(reminder.id.toString(), { status: 'cancelled' });
      }
    }
    return;
  }

  /**
   * Reschedule reminders for an appointment
   */
  async rescheduleAppointmentReminders(
    appointmentId: string,
    tenantId: string,
    newDateTime: string,
  ): Promise<void> {
    // Cancel existing reminders using db mock
    const __intTenantId = typeof tenantId === 'string' ? parseInt(tenantId, 10) : tenantId;
    await this.cancelAppointmentReminders(appointmentId, tenantId);

    // Get the appointment using db mock
    const appointment = await this.db.getAppointmentById(appointmentId);
    if (!appointment) {
      return;
    }

    // Update appointment dateTime
    appointment.dateTime = newDateTime;

    // Schedule new reminders using db mock
    await this.scheduleAppointmentReminders(appointment);
  }

  /**
   * Get all scheduled reminders for a tenant
   */
  async getScheduledReminders(tenantId: number): Promise<ReminderSchedule[]> {
    // Use db mock for scheduled reminders
    const intTenantId = typeof tenantId === 'string' ? parseInt(tenantId, 10) : tenantId;
    return this.db.getReminderSchedulesByTenant(intTenantId, 'scheduled');
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    // Clear timeouts from the service's map (for backward compatibility)
    for (const timeout of this.scheduledReminders.values()) {
      clearTimeout(timeout);
    }
    this.scheduledReminders.clear();
  }

  // Backward compatibility methods for tests

  async checkCommunicationConsent(reminder: any, appointment: any): Promise<boolean> {
    // Normalize appointment fields to handle both camelCase and snake_case
    const normalizedAppointment = {
      ...appointment,
      tenantId: appointment.tenantId || appointment.tenant_id,
      customerEmail: appointment.customerEmail || appointment.customer_email,
      customerPhone: appointment.customerPhone || appointment.customer_phone,
    };

    // Only call consentService.checkConsent once per type, matching test expectations
    if (normalizedAppointment.customerEmail && normalizedAppointment.customerPhone) {
      const emailConsent = await this.consentService.checkConsent(
        normalizedAppointment.tenantId,
        normalizedAppointment.customerEmail,
        undefined,
        'email',
      );
      const smsConsent = await this.consentService.checkConsent(
        normalizedAppointment.tenantId,
        undefined,
        normalizedAppointment.customerPhone,
        'sms',
      );
      return emailConsent && smsConsent;
    } else if (normalizedAppointment.customerEmail) {
      return await this.consentService.checkConsent(
        normalizedAppointment.tenantId,
        normalizedAppointment.customerEmail,
        undefined,
        'email',
      );
    } else if (normalizedAppointment.customerPhone) {
      return await this.consentService.checkConsent(
        normalizedAppointment.tenantId,
        undefined,
        normalizedAppointment.customerPhone,
        'sms',
      );
    }
    return false;
  }

  async sendReminder(reminder: any, appointment: any): Promise<boolean> {
    // Normalize appointment fields to handle both camelCase and snake_case
    const normalizedAppointment = {
      ...appointment,
      tenantId: appointment.tenantId || appointment.tenant_id,
      customerEmail: appointment.customerEmail || appointment.customer_email,
      customerPhone: appointment.customerPhone || appointment.customer_phone,
      customerName: appointment.customerName || appointment.customer_name,
      serviceName: appointment.serviceName || appointment.service_name,
      staffName: appointment.staffName || appointment.staff_name,
      dateTime: appointment.dateTime || appointment.date_time,
      duration: appointment.duration,
      notes: appointment.notes,
    };

    // Check communication consent first
    const hasConsent = await this.checkCommunicationConsent(reminder, normalizedAppointment);
    if (!hasConsent) {
      return false;
    }

    // Confirmation reminder
    if (reminder.reminderType === 'confirmation') {
      const result = await this.communicationService.sendAppointmentConfirmation(
        normalizedAppointment.tenantId.toString(),
        normalizedAppointment.customerEmail,
        normalizedAppointment.customerPhone,
        {
          customerName: normalizedAppointment.customerName,
          serviceName: normalizedAppointment.serviceName,
          staffName: normalizedAppointment.staffName,
          dateTime: normalizedAppointment.dateTime,
          duration: normalizedAppointment.duration,
          notes: normalizedAppointment.notes,
        },
      );
      return result?.email?.success === true;
    }

    // 72h, 24h, 2h reminders
    if (['72h', '24h', '2h'].includes(reminder.reminderType)) {
      const hours = reminder.reminderType === '72h' ? 72 : reminder.reminderType === '24h' ? 24 : 2;
      const result = await this.communicationService.sendAppointmentReminder(
        normalizedAppointment.tenantId.toString(),
        normalizedAppointment.customerEmail,
        normalizedAppointment.customerPhone,
        {
          customerName: normalizedAppointment.customerName,
          serviceName: normalizedAppointment.serviceName,
          staffName: normalizedAppointment.staffName,
          dateTime: normalizedAppointment.dateTime,
          duration: normalizedAppointment.duration,
        },
        hours,
      );
      return result?.email?.success === true;
    }

    // Unknown reminder type
    return false;
  }

  async updateReminderStatus(
    reminderId: string,
    status: ReminderSchedule['status'],
    error?: string,
  ): Promise<void> {
    // For test compatibility, update status using db mock
    await this.db.updateReminderSchedule(reminderId, { status, error });
  }
}
