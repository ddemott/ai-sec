import type { TenantConfigService } from '../tenants/index.js';
import type { ConsentService } from '../consentService.js';
import type { SMSMessage, CommunicationResult } from './types.js';
import { UsageTrackingService } from '../usage/UsageTrackingService.js';
import { Provider } from '../../types/usage.js';
import { providerRegistry } from './ProviderRegistry.js';

export class SMSService {
  private static simulationNoticeLogged = false;

  constructor(
    private configService: TenantConfigService,
    private consentService?: ConsentService,
    private usageTracker?: UsageTrackingService,
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
      const tenantConfig = this.configService.getTenantConfig(tenantId);
      if (!tenantConfig) {
        throw new Error(`Tenant '${tenantId}' configuration not found`);
      }

      // Check consent before sending SMS
      if (this.consentService) {
        const consentCheck = await this.consentService.canReceiveCommunications(
          tenantId,
          undefined, // no email for SMS
          message.to, // phone number
        );

        if (!consentCheck.canReceiveSMS) {
          console.log(`⚠️ SMS not sent to ${message.to} - no consent for tenant ${tenantId}`);
          return {
            success: false,
            error: 'Customer has not consented to SMS communications',
          };
        }
      }

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
        `✅ SMS sent to ${message.to} for tenant ${tenantId} via ${provider.getName()} (SID: ${result.messageSid})`,
      );

      // Track SMS usage
      if (this.usageTracker) {
        try {
          // Map provider name to Usage Provider enum
          const usageProvider = provider.getName() === 'twilio' ? Provider.TWILIO : Provider.MOCK;
          await this.usageTracker.trackSMS(tenantId, 'outbound', result.messageSid, usageProvider);
        } catch (trackError) {
          console.error('Failed to track SMS usage:', trackError);
          // Don't fail the SMS send if tracking fails
        }
      }

      return {
        success: true,
        messageId: result.messageSid,
      };
    } catch (error: any) {
      console.error('❌ Error sending SMS:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Send SMS without consent checking (for system messages like opt-out confirmations)
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
        `✅ System SMS sent to ${message.to} for tenant ${tenantId} via ${provider.getName()} (SID: ${result.messageSid})`,
      );

      return {
        success: true,
        messageId: result.messageSid,
      };
    } catch (error: any) {
      console.error('❌ Error sending system SMS:', error);
      return {
        success: false,
        error: error.message,
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
    data: Record<string, any>,
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
  private applySMSTemplate(template: string, data: Record<string, any>): string {
    switch (template) {
      case 'appointment-confirmation':
        return `✅ Confirmed: ${data.serviceName} with ${data.staffName} on ${data.dateTime}. Reply STOP to opt out.`;

      case 'appointment-reminder':
        return `🔔 Reminder: ${data.serviceName} with ${data.staffName} in ${data.hoursUntil}h at ${data.dateTime}. Reply STOP to opt out.`;

      case 'appointment-cancellation':
        return `❌ Cancelled: ${data.serviceName} on ${data.dateTime} has been cancelled. Reply STOP to opt out.`;

      case 'waitlist-available':
        return `🎉 Great news! A spot opened up for ${data.serviceName}. Can you make ${data.availableTime}? Reply YES or call us.`;

      case 'opt-out-confirmation':
        return `You've been unsubscribed from SMS messages. Reply START to resubscribe.`;

      case 'consent-request':
        return `Hi! We'd like to send you appointment reminders via SMS. Reply YES to opt in, or STOP to opt out.`;

      default:
        return data.message || 'Message from AI Secretary';
    }
  }
}
