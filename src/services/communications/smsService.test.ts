/**
 * SMSService — from-number selection tests.
 *
 * Focused coverage for the provider-aware "from number" resolution in
 * SMSService.sendSMS / sendSystemSMS:
 *   tenantConfig.inboundPhone  →  provider-specific env  →  'AI_SECRETARY'
 * where the provider-specific env is TWILIO_PHONE_NUMBER for the twilio
 * provider and TELNYX_PHONE_NUMBER otherwise.
 *
 * 5W: WHO SMSService · WHAT outbound from-number selection · WHEN every
 * send · WHERE smsService.ts fromNumber block · WHY a tenant on the
 * twilio provider must send from the Twilio DID, not the Telnyx one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SMSService } from './smsService.js';
import { providerRegistry } from './ProviderRegistry.js';
import type { TenantConfigService, TenantConfig } from '../tenants/index.js';

// communications_history writes to the DB; this is a pure unit test, so
// stub it to a no-op (the real impl is best-effort and never throws).
vi.mock('./communicationHistory.js', () => ({
  recordCommunicationHistory: vi.fn().mockResolvedValue(undefined),
}));

const baseConfig: TenantConfig = {
  tenantId: 'tenant-sms-from',
  name: 'From Number Co',
  timezone: 'America/Chicago',
  settings: { smsEnabled: true, emailEnabled: true, reminderHours: [72, 24, 2] },
};

// Build a fake provider whose sendSMS records the `from` it was handed.
const makeProvider = (name: string, capture: { from?: string }) => ({
  getName: () => name,
  sendSMS: vi.fn().mockImplementation((msg: { from: string }) => {
    capture.from = msg.from;
    return Promise.resolve({ messageSid: 'SID_TEST' });
  }),
});

const makeConfigService = (config: TenantConfig | null): TenantConfigService =>
  ({
    getTenantConfig: vi.fn().mockResolvedValue(config),
    getTenantConfigs: vi.fn().mockResolvedValue(config ? [config] : []),
    updateTenantConfig: vi.fn().mockResolvedValue(config),
    getBusinessName: vi.fn().mockResolvedValue(config?.name ?? ''),
    getNotificationPreferences: vi.fn().mockResolvedValue({
      smsEnabled: true,
      emailEnabled: true,
      reminderHours: [72, 24, 2],
      contactInfo: {},
    }),
  }) as unknown as TenantConfigService;

const VALID_TO = '+15559876543';

describe('SMSService from-number selection', () => {
  const prevTelnyx = process.env.TELNYX_PHONE_NUMBER;
  const prevTwilio = process.env.TWILIO_PHONE_NUMBER;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.TELNYX_PHONE_NUMBER = '+15550001111';
    process.env.TWILIO_PHONE_NUMBER = '+15552223333';
  });

  afterEach(() => {
    process.env.TELNYX_PHONE_NUMBER = prevTelnyx;
    process.env.TWILIO_PHONE_NUMBER = prevTwilio;
  });

  // WHO telnyx-provider tenant · WHY default provider must use the Telnyx DID
  it('uses TELNYX_PHONE_NUMBER when the default provider is telnyx and no inboundPhone is set', async () => {
    const capture: { from?: string } = {};
    vi.spyOn(providerRegistry, 'getDefaultProvider').mockReturnValue(
      makeProvider('telnyx', capture) as never
    );
    const svc = new SMSService(makeConfigService(baseConfig)); // no consentService → consent skipped

    const result = await svc.sendSMS(baseConfig.tenantId, { to: VALID_TO, body: 'hi' });

    expect(result.success).toBe(true);
    expect(capture.from).toBe('+15550001111');
  });

  // WHO twilio-provider tenant · WHY twilio sends must originate from the Twilio DID, not Telnyx
  it('uses TWILIO_PHONE_NUMBER when the default provider is twilio and no inboundPhone is set', async () => {
    const capture: { from?: string } = {};
    vi.spyOn(providerRegistry, 'getDefaultProvider').mockReturnValue(
      makeProvider('twilio', capture) as never
    );
    const svc = new SMSService(makeConfigService(baseConfig));

    const result = await svc.sendSMS(baseConfig.tenantId, { to: VALID_TO, body: 'hi' });

    expect(result.success).toBe(true);
    expect(capture.from).toBe('+15552223333');
  });

  // WHO tenant with its own provisioned DID · WHY inboundPhone always wins over env defaults
  it('prefers tenantConfig.inboundPhone over the provider env number', async () => {
    const capture: { from?: string } = {};
    vi.spyOn(providerRegistry, 'getDefaultProvider').mockReturnValue(
      makeProvider('twilio', capture) as never
    );
    const svc = new SMSService(makeConfigService({ ...baseConfig, inboundPhone: '+15557778888' }));

    const result = await svc.sendSMS(baseConfig.tenantId, { to: VALID_TO, body: 'hi' });

    expect(result.success).toBe(true);
    expect(capture.from).toBe('+15557778888');
  });

  // WHO system SMS (opt-out confirmations) · WHY same provider-aware rule applies on the no-consent path
  it('applies provider-aware selection on sendSystemSMS too', async () => {
    const capture: { from?: string } = {};
    vi.spyOn(providerRegistry, 'getDefaultProvider').mockReturnValue(
      makeProvider('twilio', capture) as never
    );
    const svc = new SMSService(makeConfigService(baseConfig));

    const result = await svc.sendSystemSMS(baseConfig.tenantId, { to: VALID_TO, body: 'stop ok' });

    expect(result.success).toBe(true);
    expect(capture.from).toBe('+15552223333');
  });
});
