import type { TenantConfigService } from '../tenants/index.js';
import type { ConsentService } from '../consentService.js';
import type { SMSMessage, CommunicationResult } from './types.js';
import { providerRegistry } from './ProviderRegistry.js';
import { smsRateLimiter, RateLimitedError } from './smsRateLimit.js';
import { recordCommunicationHistory } from './communicationHistory.js';
import { smsSendsTotal, errorsTotal } from '../metrics.js';
import { buildLogger } from '../logger.js';

/**
 * Pino logger for the SMS service, built lazily on first use.
 *
 * Lazy because `buildLogger` spins up a Better Stack transport (a worker
 * thread) when BETTER_STACK_TOKEN is set. Building it at module scope would
 * create a second shipper alongside the one in index.ts for every process that
 * merely imports this file — including the unit-test runner.
 */
let smsLogger: ReturnType<typeof buildLogger> | null = null;
function log() {
  smsLogger ??= buildLogger({ service: 'sms' });
  return smsLogger;
}

/** Provider name for metric labels; bounded enum ('telnyx' | 'mock'), safe cardinality. */
function providerName(): string {
  try {
    return providerRegistry.getDefaultProvider().getName();
  } catch {
    return 'unknown';
  }
}

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
    // Hoisted so the send-failure catch can record the same body the success
    // path would have logged (templated when a template is used).
    let body = message.body || '';
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

      const fromNumber =
        tenantConfig.inboundPhone || process.env.TELNYX_PHONE_NUMBER || 'AI_SECRETARY';

      // Validate phone number format (basic validation)
      if (provider.getName() !== 'mock' && !this.isValidPhoneNumber(message.to)) {
        throw new Error('Invalid phone number format');
      }

      // Apply template if specified
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

      smsSendsTotal.inc({ provider: provider.getName(), outcome: 'sent' });
      console.log(
        `✅ SMS sent to ${message.to} for tenant ${tenantId} via ${provider.getName()} (SID: ${result.messageSid})`
      );

      // Record the send in communications_history (best-effort, never throws —
      // a failed log must not turn a successful send into a failure).
      await recordCommunicationHistory(tenantId, {
        channel: 'sms',
        recipient: message.to,
        body,
        status: 'sent',
        providerMessageId: result.messageSid,
      });

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
        // Not a failure: the worker retries after the bucket refills. Counted
        // separately so a throttled tenant can't inflate the failure ratio.
        smsSendsTotal.inc({ provider: providerName(), outcome: 'rate_limited' });
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // WHO: any caller of sendSMS (agent booking confirmation, POST
      //      /communications/sms, reminder worker)
      // WHAT: the provider rejected the send, or validation threw before it
      // WHEN: bad `from` number, revoked API key, invalid recipient, provider outage
      // WHERE: SMSService.sendSMS provider.sendSMS() call
      // WHY: pre-2026-07-09 this was a raw console.error — no metric, no sink.
      //      A dead TELNYX_PHONE_NUMBER failed every fallback-tenant send for
      //      weeks and the only trace was a status='failed' row nobody queried.
      smsSendsTotal.inc({ provider: providerName(), outcome: 'failed' });
      errorsTotal.inc({ event: 'sms_send_failed' });
      log().error(
        {
          event: 'sms_send_failed',
          tenant_id: tenantId,
          provider: providerName(),
          recipient_last4: message.to.slice(-4),
          error_message: errorMessage,
        },
        'SMS send failed'
      );

      // Record the FAILED delivery so the dashboard failed-delivery drill-down
      // (?status=failed) has real rows. Best-effort — the recorder never throws,
      // but we still guard so a history-write hiccup can't mask the send error.
      await recordCommunicationHistory(tenantId, {
        channel: 'sms',
        recipient: message.to,
        body,
        status: 'failed',
        error: errorMessage,
      }).catch(() => {});
      return {
        success: false,
        error: errorMessage,
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
      const tenantConfig = await this.configService.getTenantConfig(tenantId);
      const fromNumber =
        tenantConfig?.inboundPhone || process.env.TELNYX_PHONE_NUMBER || 'AI_SECRETARY';

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

      smsSendsTotal.inc({ provider: provider.getName(), outcome: 'sent' });
      console.log(
        `✅ System SMS sent to ${message.to} for tenant ${tenantId} via ${provider.getName()} (SID: ${result.messageSid})`
      );

      return {
        success: true,
        messageId: result.messageSid,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // WHO: the opt-out handler confirming a customer's STOP/UNSUBSCRIBE
      // WHAT: the confirmation SMS never left; the caller only sees success:false
      // WHEN: bad `from` number, revoked key, provider outage
      // WHERE: SMSService.sendSystemSMS
      // WHY: this path is COMPLIANCE-sensitive and was the darkest of the two —
      //      it wrote no communications_history row at all (success or failure)
      //      and swallowed the error into a console.error. A customer whose
      //      opt-out confirmation silently failed has no record anywhere.
      //      The metric + log are the floor; persisting these sends is a
      //      follow-up (a behavior change, deliberately not bundled here).
      smsSendsTotal.inc({ provider: providerName(), outcome: 'failed' });
      errorsTotal.inc({ event: 'system_sms_send_failed' });
      log().error(
        {
          event: 'system_sms_send_failed',
          tenant_id: tenantId,
          provider: providerName(),
          recipient_last4: message.to.slice(-4),
          error_message: errorMessage,
        },
        'System SMS send failed (opt-out confirmation may not have been delivered)'
      );

      return {
        success: false,
        error: errorMessage,
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
      cancelLink?: string | null;
      rescheduleLink?: string | null;
    };
    switch (template) {
      case 'appointment-confirmation':
        return (
          `✅ Confirmed: ${d.serviceName} with ${d.staffName} on ${d.dateTime}.` +
          (d.cancelLink ? ` Cancel: ${d.cancelLink}` : '') +
          (d.rescheduleLink ? ` Reschedule: ${d.rescheduleLink}` : '') +
          ' Reply STOP to opt out.'
        );

      case 'appointment-reminder':
        return (
          `🔔 Reminder: ${d.serviceName} with ${d.staffName} in ${d.hoursUntil}h at ${d.dateTime}.` +
          (d.cancelLink ? ` Cancel: ${d.cancelLink}` : '') +
          (d.rescheduleLink ? ` Reschedule: ${d.rescheduleLink}` : '') +
          ' Reply STOP to opt out.'
        );

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
