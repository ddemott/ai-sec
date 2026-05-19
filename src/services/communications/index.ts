import type { TenantConfigService } from '../tenants/index.js';
import type { ConsentService } from '../consentService.js';
import { EmailService } from './emailService.js';
import { SMSService } from './smsService.js';
import { AppointmentCommunicationService } from './appointmentService.js';
import type { EmailMessage, SMSMessage, CommunicationResult, AppointmentData } from './types.js';

/**
 * Main CommunicationService - Orchestrates all communication channels
 * Delegates to specialized services for different communication types
 */
export class CommunicationService {
  private emailService: EmailService;
  private smsService: SMSService;
  private appointmentService: AppointmentCommunicationService;

  constructor(
    private configService: TenantConfigService,
    private consentService?: ConsentService
  ) {
    this.emailService = new EmailService(configService, consentService);
    this.smsService = new SMSService(configService, consentService);
    this.appointmentService = new AppointmentCommunicationService(configService, consentService);
  }

  /**
   * Send an email message
   */
  async sendEmail(tenantId: string, message: EmailMessage): Promise<CommunicationResult> {
    return this.emailService.sendEmail(tenantId, message);
  }

  /**
   * Send an SMS message
   */
  async sendSMS(tenantId: string, message: SMSMessage): Promise<CommunicationResult> {
    return this.smsService.sendSMS(tenantId, message);
  }

  /**
   * Send appointment confirmation (multi-channel: email + SMS)
   */
  async sendAppointmentConfirmation(
    tenantId: string,
    customerEmail: string,
    customerPhone: string | undefined,
    appointmentDetails: AppointmentData
  ): Promise<{ email?: CommunicationResult; sms?: CommunicationResult }> {
    return this.appointmentService.sendAppointmentConfirmation(
      tenantId,
      customerEmail,
      customerPhone,
      appointmentDetails
    );
  }

  /**
   * Send appointment reminder (multi-channel: email + SMS)
   */
  async sendAppointmentReminder(
    tenantId: string,
    customerEmail: string,
    customerPhone: string | undefined,
    appointmentDetails: AppointmentData,
    hoursUntilAppointment: number
  ): Promise<{ email?: CommunicationResult; sms?: CommunicationResult }> {
    return this.appointmentService.sendAppointmentReminder(
      tenantId,
      customerEmail,
      customerPhone,
      appointmentDetails,
      hoursUntilAppointment
    );
  }

  /**
   * Send appointment cancellation (multi-channel: email + SMS)
   */
  async sendAppointmentCancellation(
    tenantId: string,
    customerEmail: string,
    customerPhone: string | undefined,
    appointmentDetails: AppointmentData & { reason?: string }
  ): Promise<{ email?: CommunicationResult; sms?: CommunicationResult }> {
    return this.appointmentService.sendAppointmentCancellation(
      tenantId,
      customerEmail,
      customerPhone,
      appointmentDetails
    );
  }

  /**
   * Legacy methods for backward compatibility
   */
  async sendAppointmentConfirmationEmail(
    tenantId: string,
    customerEmail: string,
    appointmentDetails: AppointmentData
  ): Promise<CommunicationResult> {
    return this.appointmentService.sendAppointmentConfirmationEmail(
      tenantId,
      customerEmail,
      appointmentDetails
    );
  }

  async sendAppointmentReminderEmail(
    tenantId: string,
    customerEmail: string,
    appointmentDetails: AppointmentData,
    hoursUntilAppointment: number
  ): Promise<CommunicationResult> {
    return this.appointmentService.sendAppointmentReminderEmail(
      tenantId,
      customerEmail,
      appointmentDetails,
      hoursUntilAppointment
    );
  }

  async sendAppointmentCancellationEmail(
    tenantId: string,
    customerEmail: string,
    customerPhone: string | undefined,
    appointmentDetails: AppointmentData & { reason?: string }
  ): Promise<CommunicationResult> {
    return this.appointmentService.sendAppointmentCancellationEmail(
      tenantId,
      customerEmail,
      appointmentDetails
    );
  }

  /**
   * Apply email template
   */
  applyTemplate(
    template: string,
    data: Record<string, unknown>
  ): Promise<{
    subject?: string;
    text?: string;
    html?: string;
  }> {
    return this.emailService.applyTemplate(template, data);
  }
}

// Re-export types for backward compatibility
export type { EmailMessage, SMSMessage, CommunicationResult };
