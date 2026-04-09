/**
 * Usage Tracking Service.
 * Stub implementation for migrated communications services.
 *
 * TODO: Connect to actual database/billing system for production usage tracking.
 */

import { Provider, UsageRecord } from '../../types/usage.js';

export class UsageTrackingService {
  private records: UsageRecord[] = [];

  /**
   * Track an SMS message
   */
  async trackSMS(
    tenantId: string | number,
    direction: 'inbound' | 'outbound',
    messageSid: string,
    provider: Provider = Provider.TWILIO
  ): Promise<void> {
    const record: UsageRecord = {
      tenantId,
      provider,
      type: 'sms',
      direction,
      externalId: messageSid,
      timestamp: new Date().toISOString(),
    };
    this.records.push(record);
    console.log(`[UsageTracking] SMS tracked: ${direction} via ${provider} (${messageSid})`);
  }

  /**
   * Track a phone call
   */
  async trackCall(
    tenantId: string | number,
    direction: 'inbound' | 'outbound',
    callSid: string,
    provider: Provider = Provider.TWILIO,
    durationSeconds?: number
  ): Promise<void> {
    const record: UsageRecord = {
      tenantId,
      provider,
      type: 'call',
      direction,
      externalId: callSid,
      timestamp: new Date().toISOString(),
      metadata: durationSeconds ? { durationSeconds } : undefined,
    };
    this.records.push(record);
    console.log(`[UsageTracking] Call tracked: ${direction} via ${provider} (${callSid})`);
  }

  /**
   * Track an email
   */
  async trackEmail(
    tenantId: string | number,
    direction: 'inbound' | 'outbound',
    messageId: string
  ): Promise<void> {
    const record: UsageRecord = {
      tenantId,
      provider: Provider.MOCK, // Email doesn't use Twilio
      type: 'email',
      direction,
      externalId: messageId,
      timestamp: new Date().toISOString(),
    };
    this.records.push(record);
    console.log(`[UsageTracking] Email tracked: ${direction} (${messageId})`);
  }

  /**
   * Get usage records for a tenant
   */
  async getUsageByTenant(tenantId: string | number): Promise<UsageRecord[]> {
    return this.records.filter((r) => r.tenantId === tenantId);
  }

  /**
   * Get usage summary for a tenant
   */
  async getUsageSummary(
    tenantId: string | number
  ): Promise<{ sms: number; calls: number; emails: number }> {
    const tenantRecords = await this.getUsageByTenant(tenantId);
    return {
      sms: tenantRecords.filter((r) => r.type === 'sms').length,
      calls: tenantRecords.filter((r) => r.type === 'call').length,
      emails: tenantRecords.filter((r) => r.type === 'email').length,
    };
  }
}

// Export singleton instance
export const usageTracker = new UsageTrackingService();
