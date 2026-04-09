/**
 * Usage tracking types.
 * Stub module for migrated communications services.
 */

/**
 * Provider enum for tracking usage by provider
 */
export enum Provider {
  TWILIO = 'twilio',
  MOCK = 'mock',
  VAPI = 'vapi',
}

/**
 * Usage record type
 */
export interface UsageRecord {
  id?: string;
  tenantId: string | number;
  provider: Provider;
  type: 'sms' | 'call' | 'email';
  direction: 'inbound' | 'outbound';
  externalId?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}
