import type { Appointment } from '../../types/index.js';
import { type CommunicationService } from '../communications/index.js';
import { type ConsentService } from '../consentService.js';
import { remindersSentTotal, remindersSkippedTotal } from '../metrics.js';

import type { ReminderRepository } from './reminderRepository.js';
import type { ReminderSchedule } from './types.js';

export class ReminderProcessor {
  constructor(
    private repository: ReminderRepository,
    private communicationService: CommunicationService,
    private consentService: ConsentService
  ) {}

  /**
   * Process a scheduled reminder
   */
  async processReminder(reminderId: string): Promise<void> {
    const reminder = await this.repository.getReminder(reminderId);
    if (!reminder) {
      console.warn(`Reminder ${reminderId} not found`);
      return;
    }

    if (reminder.status !== 'scheduled') {
      console.log(`Reminder ${reminderId} is not scheduled (status: ${reminder.status})`);
      return;
    }

    try {
      const appointment = await this.repository.getAppointmentDetails(
        reminder.appointment_id.toString(),
        reminder.tenant_id.toString()
      );
      if (!appointment) {
        remindersSkippedTotal.inc({ reason: 'appointment_not_found' });
        await this.repository.updateReminderStatus(reminderId, 'failed', 'Appointment not found');
        return;
      }

      // Check if reminder is still relevant (appointment not cancelled and time hasn't passed)
      const appointmentDateTime = new Date(appointment.date_time || appointment.start_time);
      const now = new Date();

      if (appointment.status === 'cancelled' || appointmentDateTime <= now) {
        remindersSkippedTotal.inc({ reason: 'appointment_cancelled' });
        await this.repository.updateReminderStatus(
          reminderId,
          'cancelled',
          'Appointment cancelled or time passed'
        );
        return;
      }

      // Check communication consent
      const hasConsent = await this.checkCommunicationConsent(reminder, appointment);
      if (!hasConsent) {
        remindersSkippedTotal.inc({ reason: 'no_consent' });
        await this.repository.updateReminderStatus(
          reminderId,
          'cancelled',
          'No communication consent'
        );
        return;
      }

      // Send the reminder
      const sent = await this.sendReminder(reminder, appointment);
      if (sent) {
        await this.repository.updateReminderStatus(reminderId, 'sent');
      } else {
        await this.repository.updateReminderStatus(reminderId, 'failed', 'Failed to send reminder');
      }
    } catch (error) {
      console.error(`Error processing reminder ${reminderId}:`, error);
      remindersSkippedTotal.inc({ reason: 'processing_error' });
      await this.repository.updateReminderStatus(
        reminderId,
        'failed',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Manually trigger a reminder
   */
  async triggerReminder(reminderId: string): Promise<boolean> {
    const reminder = await this.repository.getReminder(reminderId);
    if (!reminder) {
      return false;
    }

    if (reminder.status !== 'scheduled') {
      return false;
    }

    await this.processReminder(reminderId);

    // Check if it was sent successfully
    const updatedReminder = await this.repository.getReminder(reminderId);
    return updatedReminder?.status === 'sent';
  }

  /**
   * Check if customer has consented to receive communications
   */
  public async checkCommunicationConsent(
    reminder: ReminderSchedule,
    appointment: Appointment
  ): Promise<boolean> {
    try {
      // Check email consent if email is provided
      if (appointment.customer_email) {
        const emailConsent = await this.consentService.checkConsent(
          reminder.tenant_id.toString(),
          appointment.customer_email,
          undefined,
          'email'
        );
        if (!emailConsent) return false;
      }

      // Check SMS consent if phone is provided
      if (appointment.customer_phone) {
        const smsConsent = await this.consentService.checkConsent(
          reminder.tenant_id.toString(),
          undefined,
          appointment.customer_phone,
          'sms'
        );
        if (!smsConsent) return false;
      }

      // If no contact methods provided, can't send
      return !!(appointment.customer_email || appointment.customer_phone);
    } catch (error) {
      console.error('Error checking communication consent:', error);
      return false;
    }
  }

  /**
   * Send the actual reminder communication
   */
  public async sendReminder(
    reminder: ReminderSchedule,
    appointment: Appointment
  ): Promise<boolean> {
    try {
      const hoursUntil =
        reminder.reminder_type === 'confirmation'
          ? 0
          : reminder.reminder_type === '72h'
            ? 72
            : reminder.reminder_type === '24h'
              ? 24
              : 2;

      let emailSent = false;
      let smsSent = false;

      // Send email reminder if email is available and consented
      if (reminder.customer_email) {
        const emailConsent = await this.consentService.checkConsent(
          reminder.tenant_id.toString(),
          reminder.customer_email,
          undefined,
          'email'
        );
        if (emailConsent) {
          const appointmentData = {
            customerName: appointment.customer_name || 'Customer',
            serviceName: appointment.service_name || 'Service',
            staffName: appointment.staff_name || 'Staff',
            dateTime: appointment.date_time || appointment.start_time,
            duration: appointment.duration || 60,
            notes: appointment.notes,
          };

          if (reminder.reminder_type === 'confirmation') {
            const result = await this.communicationService.sendAppointmentConfirmation(
              reminder.tenant_id.toString(),
              reminder.customer_email,
              appointment.customer_phone,
              appointmentData
            );
            emailSent = result.email?.success || false;
          } else {
            const result = await this.communicationService.sendAppointmentReminder(
              reminder.tenant_id.toString(),
              reminder.customer_email,
              appointment.customer_phone,
              appointmentData,
              hoursUntil
            );
            emailSent = result.email?.success || false;
          }
          remindersSentTotal.inc({
            channel: 'email',
            outcome: emailSent ? 'success' : 'failure',
          });
        }
      }

      // Send SMS reminder if phone is available and consented
      if (reminder.customer_phone) {
        const smsConsent = await this.consentService.checkConsent(
          reminder.tenant_id.toString(),
          undefined,
          reminder.customer_phone,
          'sms'
        );
        if (smsConsent) {
          const smsData = {
            customerName: appointment.customer_name || 'Customer',
            serviceName: appointment.service_name || 'Service',
            staffName: appointment.staff_name || 'Staff',
            dateTime: new Date(appointment.date_time || appointment.start_time).toLocaleString(),
            duration: appointment.duration || 60,
            hoursUntil: hoursUntil,
          };

          if (reminder.reminder_type === 'confirmation') {
            const result = await this.communicationService.sendSMS(reminder.tenant_id.toString(), {
              to: reminder.customer_phone,
              template: 'appointment-confirmation',
              templateData: smsData,
            });
            smsSent = result.success;
          } else {
            const result = await this.communicationService.sendSMS(reminder.tenant_id.toString(), {
              to: reminder.customer_phone,
              template: 'appointment-reminder',
              templateData: smsData,
            });
            smsSent = result.success;
          }
          remindersSentTotal.inc({
            channel: 'sms',
            outcome: smsSent ? 'success' : 'failure',
          });
        }
      }

      // Return true if at least one communication method succeeded
      return emailSent || smsSent;
    } catch (error) {
      console.error('Error sending reminder:', error);
      return false;
    }
  }
}
