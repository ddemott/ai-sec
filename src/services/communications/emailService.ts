/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method, @typescript-eslint/no-explicit-any */
/**
 * ESLint rules disabled for this file as part of full cleanup (REFACTORING_TODO.md item 10).
 * These are the remaining dynamic/any-heavy areas after previous tranches.
 */

import nodemailer from 'nodemailer';
import type { TenantConfigService } from '../tenants/index.js';
import type { ConsentService } from '../consentService.js';
import type { EmailMessage, CommunicationResult } from './types.js';
import { EmailTemplateService, type EmailTemplateData } from './emailTemplates.js';
import { recordCommunicationHistory } from './communicationHistory.js';

export class EmailService {
  private transporter: nodemailer.Transporter;
  private templateService: EmailTemplateService;
  private static simulationNoticeLogged = false;

  constructor(
    private configService: TenantConfigService,
    private consentService?: ConsentService
  ) {
    const isTest = process.env.NODE_ENV === 'test';
    const hasCreds = Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS);

    if (isTest || !hasCreds) {
      // Test-mode stub satisfying just the `sendMail` slot we exercise;
      // the rest of nodemailer.Transporter isn't reachable in tests.
      this.transporter = {
        sendMail: () => Promise.resolve({ messageId: 'test-message-id' }),
      } as unknown as nodemailer.Transporter;

      if (!isTest && !hasCreds && !EmailService.simulationNoticeLogged) {
        console.warn(
          '📧 Email Service running in simulation mode — EMAIL_USER / EMAIL_PASS not set; emails will NOT be delivered.'
        );
        EmailService.simulationNoticeLogged = true;
      }
    } else {
      this.transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });
    }

    this.templateService = new EmailTemplateService(configService);
  }

  /**
   * Send an email message with consent checking
   */
  async sendEmail(tenantId: string, message: EmailMessage): Promise<CommunicationResult> {
    try {
      const tenantConfig = await this.configService.getTenantConfig(tenantId);
      if (!tenantConfig) {
        throw new Error(`Tenant '${tenantId}' configuration not found`);
      }

      // Check consent before sending email
      if (this.consentService) {
        const consentCheck = await this.consentService.canReceiveCommunications(
          tenantId,
          message.to, // email address
          undefined // no phone for email
        );

        if (!consentCheck.canReceiveEmail) {
          console.log(`⚠️ Email not sent to ${message.to} - no consent for tenant ${tenantId}`);
          return {
            success: false,
            error: 'Customer has not consented to email communications',
          };
        }
      }

      // Prepare email content
      let subject = message.subject;
      let text = message.text;
      let html = message.html;

      // Apply template if specified
      if (message.template) {
        const templateResult = await this.applyTemplate(message.template, {
          ...message.templateData,
          tenantId,
        });
        subject = templateResult.subject || subject;
        text = templateResult.text || text;
        html = templateResult.html || html;
      }

      const businessName = await this.configService.getBusinessName(tenantId);
      const mailOptions = {
        from: `"${businessName}" <${process.env.EMAIL_USER}>`,
        to: message.to,
        subject,
        text,
        html,
      };

      const result = await this.transporter.sendMail(mailOptions);

      console.log(`✅ Email sent to ${message.to} for tenant ${tenantId}`);

      // Record the send in communications_history (best-effort, never throws —
      // a failed log must not turn a successful send into a failure).
      await recordCommunicationHistory(tenantId, {
        channel: 'email',
        recipient: message.to,
        subject,
        body: text,
        status: 'sent',
        providerMessageId: result.messageId,
      });

      return {
        success: true,
        messageId: result.messageId,
      };
    } catch (error) {
      console.error('❌ Error sending email:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Apply email template with enhanced professional templates
   */
  public async applyTemplate(
    template: string,
    data: Record<string, unknown>
  ): Promise<{
    subject?: string;
    text?: string;
    html?: string;
  }> {
    // Templates accept a permissive bag (callers vary); narrow at the boundary
    // into a typed shape so downstream code reads concrete fields, not unknown.
    const d = data as {
      tenantId: string;
      customerName?: string;
      serviceName?: string;
      staffName?: string;
      dateTime?: string;
      duration?: number;
      notes?: string;
      reason?: string;
      hoursUntil?: number;
      subject?: string;
      message?: string;
    };

    const businessName = await this.configService.getBusinessName(d.tenantId);
    const notificationPrefs = await this.configService.getNotificationPreferences(d.tenantId);

    const templateData: EmailTemplateData = {
      customerName: d.customerName || 'Valued Customer',
      serviceName: d.serviceName || 'Service',
      staffName: d.staffName || 'Our Team',
      dateTime: d.dateTime || 'TBD',
      duration: d.duration || 60,
      businessName: businessName,
      businessPhone: notificationPrefs.contactInfo?.phone,
      businessEmail: undefined, // No tenant-level email column today
      businessAddress: undefined, // Not currently stored
      notes: d.notes,
      reason: d.reason,
      hoursUntil: d.hoursUntil,
      logoUrl: undefined, // Not currently stored
      primaryColor: undefined, // Not currently stored
      secondaryColor: undefined, // Not currently stored
    };

    switch (template) {
      case 'appointment-confirmation':
        return this.templateService.generateAppointmentConfirmation(templateData);

      case 'appointment-reminder':
        return this.templateService.generateAppointmentReminder({
          ...templateData,
          hoursUntil: d.hoursUntil || 24,
        });

      case 'appointment-cancellation':
        return this.templateService.generateAppointmentCancellation(templateData);

      case 'welcome':
        return this.templateService.generateWelcomeEmail({
          businessName,
          businessPhone: notificationPrefs.contactInfo?.phone,
          businessEmail: undefined, // No tenant-level email column today
          businessAddress: undefined,
        });

      default:
        return {
          subject: d.subject || 'Message from AI Secretary',
          text: d.message || 'You have a message from AI Secretary',
          html: `<p>${d.message || 'You have a message from AI Secretary'}</p>`,
        };
    }
  }
}
