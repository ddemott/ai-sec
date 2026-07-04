import type { TenantConfigService } from '../tenants/index.js';
import type { ConsentService } from '../consentService.js';
import type { CommunicationResult, AppointmentData } from './types.js';
import { EmailService } from './emailService.js';
import { SMSService } from './smsService.js';
import { generateSelfServiceToken } from '../selfServiceToken.js';

// Links point at the dashboard's /self/cancel and /self/reschedule pages so
// customers see a branded UI rather than raw JSON. Falls back to BACKEND_PUBLIC_URL
// for environments that set only the backend URL (e.g. early staging).
function selfServiceBaseUrl(): string {
  return (process.env.DASHBOARD_URL ?? process.env.BACKEND_PUBLIC_URL ?? '')
    .trim()
    .replace(/\/+$/, '');
}

/** Build a one-tap cancel link for SMS. Returns null when appointmentId is missing
 *  or no public URL is configured. Exported so the agent-tools
 *  send-self-service-link route reuses THIS exact generation path (same token
 *  machinery, same URL shape) instead of duplicating token logic. */
export function buildCancelLink(
  appointmentId: string | undefined,
  tenantId: string
): string | null {
  if (!appointmentId) return null;
  const baseUrl = selfServiceBaseUrl();
  if (!baseUrl) return null;
  const token = generateSelfServiceToken(appointmentId, tenantId, 'cancel');
  if (!token) return null;
  return `${baseUrl}/self/cancel?token=${encodeURIComponent(token)}`;
}

/** Build a one-tap reschedule request link for SMS/email. Returns null when
 *  appointmentId is missing or no public URL is configured. Exported for the
 *  agent-tools send-self-service-link route (see buildCancelLink note). */
export function buildRescheduleLink(
  appointmentId: string | undefined,
  tenantId: string
): string | null {
  if (!appointmentId) return null;
  const baseUrl = selfServiceBaseUrl();
  if (!baseUrl) return null;
  const token = generateSelfServiceToken(appointmentId, tenantId, 'reschedule');
  if (!token) return null;
  return `${baseUrl}/self/reschedule?token=${encodeURIComponent(token)}`;
}

export class AppointmentCommunicationService {
  private emailService: EmailService;
  private smsService: SMSService;

  constructor(
    private configService: TenantConfigService,
    private consentService?: ConsentService
  ) {
    this.emailService = new EmailService(configService, consentService);
    this.smsService = new SMSService(configService, consentService);
  }

  /**
   * Send appointment confirmation via preferred channels
   */
  async sendAppointmentConfirmation(
    tenantId: string,
    customerEmail: string,
    customerPhone: string | undefined,
    appointmentDetails: AppointmentData
  ): Promise<{ email?: CommunicationResult; sms?: CommunicationResult }> {
    const results: { email?: CommunicationResult; sms?: CommunicationResult } = {};

    // Always send email confirmation
    results.email = await this.sendAppointmentConfirmationEmail(
      tenantId,
      customerEmail,
      appointmentDetails
    );

    // Send SMS confirmation if phone provided and consented
    if (customerPhone) {
      results.sms = await this.sendAppointmentConfirmationSMS(
        tenantId,
        customerPhone,
        appointmentDetails
      );
    }

    return results;
  }

  /**
   * Send appointment reminder via preferred channels
   */
  async sendAppointmentReminder(
    tenantId: string,
    customerEmail: string,
    customerPhone: string | undefined,
    appointmentDetails: AppointmentData,
    hoursUntilAppointment: number
  ): Promise<{ email?: CommunicationResult; sms?: CommunicationResult }> {
    const results: { email?: CommunicationResult; sms?: CommunicationResult } = {};

    // Send email reminder
    results.email = await this.sendAppointmentReminderEmail(
      tenantId,
      customerEmail,
      appointmentDetails,
      hoursUntilAppointment
    );

    // Send SMS reminder if phone provided and consented
    if (customerPhone) {
      results.sms = await this.sendAppointmentReminderSMS(
        tenantId,
        customerPhone,
        appointmentDetails,
        hoursUntilAppointment
      );
    }

    return results;
  }

  /**
   * Send appointment cancellation via preferred channels
   */
  async sendAppointmentCancellation(
    tenantId: string,
    customerEmail: string,
    customerPhone: string | undefined,
    appointmentDetails: AppointmentData & { reason?: string }
  ): Promise<{ email?: CommunicationResult; sms?: CommunicationResult }> {
    const results: { email?: CommunicationResult; sms?: CommunicationResult } = {};

    // Send email cancellation
    results.email = await this.sendAppointmentCancellationEmail(
      tenantId,
      customerEmail,
      appointmentDetails
    );

    // Send SMS cancellation if phone provided and consented
    if (customerPhone) {
      results.sms = await this.sendAppointmentCancellationSMS(
        tenantId,
        customerPhone,
        appointmentDetails
      );
    }

    return results;
  }

  /**
   * Send appointment confirmation email (legacy method for backward compatibility)
   */
  async sendAppointmentConfirmationEmail(
    tenantId: string,
    customerEmail: string,
    appointmentDetails: AppointmentData
  ): Promise<CommunicationResult> {
    const templateData = {
      customerName: appointmentDetails.customerName,
      serviceName: appointmentDetails.serviceName,
      staffName: appointmentDetails.staffName,
      dateTime: new Date(appointmentDetails.dateTime).toLocaleString(),
      duration: appointmentDetails.duration,
      notes: appointmentDetails.notes || '',
      cancelLink: buildCancelLink(appointmentDetails.appointmentId, tenantId),
      rescheduleLink: buildRescheduleLink(appointmentDetails.appointmentId, tenantId),
    };

    return this.emailService.sendEmail(tenantId, {
      to: customerEmail,
      template: 'appointment-confirmation',
      templateData,
    });
  }

  /**
   * Send appointment confirmation SMS
   */
  async sendAppointmentConfirmationSMS(
    tenantId: string,
    customerPhone: string,
    appointmentDetails: AppointmentData
  ): Promise<CommunicationResult> {
    const dateTime = new Date(appointmentDetails.dateTime);
    const cancelLink = buildCancelLink(appointmentDetails.appointmentId, tenantId);
    const rescheduleLink = buildRescheduleLink(appointmentDetails.appointmentId, tenantId);
    const templateData = {
      serviceName: appointmentDetails.serviceName,
      staffName: appointmentDetails.staffName,
      dateTime:
        dateTime.toLocaleDateString() +
        ' at ' +
        dateTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      cancelLink,
      rescheduleLink,
    };

    return this.smsService.sendSMSTemplate(
      tenantId,
      customerPhone,
      'appointment-confirmation',
      templateData
    );
  }

  /**
   * Send appointment reminder email (legacy method for backward compatibility)
   */
  async sendAppointmentReminderEmail(
    tenantId: string,
    customerEmail: string,
    appointmentDetails: AppointmentData,
    hoursUntilAppointment: number
  ): Promise<CommunicationResult> {
    const templateData = {
      customerName: appointmentDetails.customerName,
      serviceName: appointmentDetails.serviceName,
      staffName: appointmentDetails.staffName,
      dateTime: new Date(appointmentDetails.dateTime).toLocaleString(),
      duration: appointmentDetails.duration,
      hoursUntil: hoursUntilAppointment,
      cancelLink: buildCancelLink(appointmentDetails.appointmentId, tenantId),
      rescheduleLink: buildRescheduleLink(appointmentDetails.appointmentId, tenantId),
    };

    return this.emailService.sendEmail(tenantId, {
      to: customerEmail,
      template: 'appointment-reminder',
      templateData,
    });
  }

  /**
   * Send appointment reminder SMS
   */
  async sendAppointmentReminderSMS(
    tenantId: string,
    customerPhone: string,
    appointmentDetails: AppointmentData,
    hoursUntilAppointment: number
  ): Promise<CommunicationResult> {
    const dateTime = new Date(appointmentDetails.dateTime);
    const cancelLink = buildCancelLink(appointmentDetails.appointmentId, tenantId);
    const rescheduleLink = buildRescheduleLink(appointmentDetails.appointmentId, tenantId);
    const templateData = {
      serviceName: appointmentDetails.serviceName,
      staffName: appointmentDetails.staffName,
      hoursUntil: hoursUntilAppointment,
      dateTime:
        dateTime.toLocaleDateString() +
        ' at ' +
        dateTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      cancelLink,
      rescheduleLink,
    };

    return this.smsService.sendSMSTemplate(
      tenantId,
      customerPhone,
      'appointment-reminder',
      templateData
    );
  }

  /**
   * Send appointment cancellation email (legacy method for backward compatibility)
   */
  async sendAppointmentCancellationEmail(
    tenantId: string,
    customerEmail: string,
    appointmentDetails: AppointmentData & { reason?: string }
  ): Promise<CommunicationResult> {
    const templateData = {
      customerName: appointmentDetails.customerName,
      serviceName: appointmentDetails.serviceName,
      staffName: appointmentDetails.staffName,
      dateTime: new Date(appointmentDetails.dateTime).toLocaleString(),
      reason: appointmentDetails.reason || 'No reason provided',
    };

    return this.emailService.sendEmail(tenantId, {
      to: customerEmail,
      template: 'appointment-cancellation',
      templateData,
    });
  }

  /**
   * Send appointment cancellation SMS
   */
  async sendAppointmentCancellationSMS(
    tenantId: string,
    customerPhone: string,
    appointmentDetails: AppointmentData & { reason?: string }
  ): Promise<CommunicationResult> {
    const dateTime = new Date(appointmentDetails.dateTime);
    const templateData = {
      serviceName: appointmentDetails.serviceName,
      dateTime:
        dateTime.toLocaleDateString() +
        ' at ' +
        dateTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    return this.smsService.sendSMSTemplate(
      tenantId,
      customerPhone,
      'appointment-cancellation',
      templateData
    );
  }
}
