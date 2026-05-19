import type { TenantConfigService } from '../tenants/index.js';
import type { ConsentService } from '../consentService.js';
import type { SMSMessage, CommunicationResult } from './types.js';
import { providerRegistry } from './ProviderRegistry.js';
import { smsRateLimiter, RateLimitedError } from './smsRateLimit.js';

export class SMSService {
  private static simulationNoticeLogged = false;

  constructor(
    private configService: TenantConfigService,
    private consentService?: ConsentService
  ) {
    if (this.isSimulationMode() && !SMSService.simulationNoticeLogged) {
      console.warn('🔕 SMS Service running in simulation mode.');
      SMSService.simulationNoticeLogged = true;
    }
  }

  private isSimulationMode(): boolean {
    return providerRegistry.getDefaultProvider().getName() === 'mock';
  }

  /**
   * Send an SMS message with consent checking
   */
  async sendSMS(tenantId: string, message: SMSMessage): Promise<CommunicationResult> {
    try {
      const tenantConfig = await this.configService.getTenantConfig(tenantId);
      if (!tenantConfig) {
        throw new Error(`Tenant '${tenantId}' configuration not found`);
      }

      // Check consent before sending SMS
      if (this.consentService) {
        const consentCheck = await this.consentService.canReceiveCommunications(
          tenantId,
          undefined, // no email for SMS
          message.to // phone number
        );

        if (!consentCheck.canReceiveSMS) {
          console.log(`⚠️ SMS not sent to ${message.to} - no consent for tenant ${tenantId}`);
          return {
            success: false,
            error: 'Customer has not consented to SMS communications',
          };
        }
      }

      // Per-tenant token-bucket rate limit (1 SMS/sec sustained, 60-token
      // burst by default). Throws RateLimitedError with `status: 429` when
      // the bucket is dry; the worker's retry policy treats 429 as
      // retryable and the bucket refills before the retry fires.
      // See src/services/communications/smsRateLimit.ts for the policy.
      smsRateLimiter.acquire(tenantId);

      // Use tenant's provider if configured, otherwise use default
      const provider = providerRegistry.getDefaultProvider();

      const fromNumber = process.env.TWILIO_PHONE_NUMBER || 'AI_SECRETARY';

      // Validate phone number format (basic validation)
      if (provider.getName() !== 'mock' && !this.isValidPhoneNumber(message.to)) {
        throw new Error('Invalid phone number format');
      }

      // Apply template if specified
      let body = message.body || '';
      if (message.template) {
        body = this.applySMSTemplate(message.template, message.templateData || {});
      }

      if (!body) {
        throw new Error('SMS body is required');
      }

      const result = await provider.sendSMS({
        to: message.to,
        from: fromNumber,
        body: body,
        tenantId: tenantId,
      });

      console.log(
        `✅ SMS sent to ${message.to} for tenant ${tenantId} via ${provider.getName()} (SID: ${result.messageSid})`
      );

      return {
        success: true,
        messageId: result.messageSid,
      };
    } catch (error) {
      // RateLimitedError carries `status: 429` so the worker's retry
      // policy can pick it up as retryable without inspecting the
      // message string. Re-throw so the worker sees the structured
      // error; the catch in the worker converts to the per-row
      // status='scheduled' + retry_count++ disposition.
      if (error instanceof RateLimitedError) {
        throw error;
      }
      console.error('❌ Error sending SMS:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Send SMS without consent checking (for system messages like opt-out confirmations).
   * Bypasses the per-tenant rate limit: opt-out confirmations are bounded
   * by inbound STOP/UNSUBSCRIBE volume (which is itself rate-limited by
   * the carrier), and dropping one would leave a customer wondering
   * whether their opt-out took effect.
   */
  async sendSystemSMS(tenantId: string, message: SMSMessage): Promise<CommunicationResult> {
    try {
      const provider = providerRegistry.getDefaultProvider();
      const fromNumber = process.env.TWILIO_PHONE_NUMBER || 'AI_SECRETARY';

      const body = message.body || '';
      if (!body) {
        throw new Error('SMS body is required');
      }

      const result = await provider.sendSMS({
        to: message.to,
        from: fromNumber,
        body: body,
        tenantId: tenantId,
      });

      console.log(
        `✅ System SMS sent to ${message.to} for tenant ${tenantId} via ${provider.getName()} (SID: ${result.messageSid})`
      );

      return {
        success: true,
        messageId: result.messageSid,
      };
    } catch (error) {
      console.error('❌ Error sending system SMS:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Check if a phone number is valid (basic validation)
   */
  private isValidPhoneNumber(phoneNumber: string): boolean {
    // Remove all non-digit characters
    const digitsOnly = phoneNumber.replace(/\D/g, '');

    // Check if it's a valid length (10-15 digits for international numbers)
    return digitsOnly.length >= 10 && digitsOnly.length <= 15;
  }

  /**
   * Send SMS with template support
   */
  async sendSMSTemplate(
    tenantId: string,
    to: string,
    template: string,
    data: Record<string, unknown>
  ): Promise<CommunicationResult> {
    const templateResult = this.applySMSTemplate(template, data);
    return this.sendSMS(tenantId, {
      to,
      body: templateResult,
    });
  }

  /**
   * Apply SMS template (optimized for SMS length limits)
   */
  private applySMSTemplate(template: string, data: Record<string, unknown>): string {
    // Narrow the permissive input bag into the fields SMS templates actually read.
    const d = data as {
      serviceName?: string;
      staffName?: string;
      dateTime?: string;
      hoursUntil?: number;
      availableTime?: string;
      message?: string;
    };
    switch (template) {
      case 'appointment-confirmation':
        return `✅ Confirmed: ${d.serviceName} with ${d.staffName} on ${d.dateTime}. Reply STOP to opt out.`;

      case 'appointment-reminder':
        return `🔔 Reminder: ${d.serviceName} with ${d.staffName} in ${d.hoursUntil}h at ${d.dateTime}. Reply STOP to opt out.`;

      case 'appointment-cancellation':
        return `❌ Cancelled: ${d.serviceName} on ${d.dateTime} has been cancelled. Reply STOP to opt out.`;

      case 'waitlist-available':
        return `🎉 Great news! A spot opened up for ${d.serviceName}. Can you make ${d.availableTime}? Reply YES or call us.`;

      case 'opt-out-confirmation':
        return `You've been unsubscribed from SMS messages. Reply START to resubscribe.`;

      case 'consent-request':
        return `Hi! We'd like to send you appointment reminders via SMS. Reply YES to opt in, or STOP to opt out.`;

      default:
        return d.message || 'Message from AI Secretary';
    }
  }
}
