/**
 * SMS send-failure observability.
 *
 * Before 2026-07-09 a failed SMS send was a raw `console.error` plus (for
 * sendSMS) a `status='failed'` row. No metric, no `errors_total`, nothing that
 * reached a sink. `reminders_sent_total` covers only the reminder worker, so
 * the agent's booking-confirmation SMS, `POST /communications/sms`, and every
 * `sendSystemSMS` opt-out confirmation were completely uninstrumented.
 *
 * That is how a dead `TELNYX_PHONE_NUMBER` (+16308661960, order deleted) sent
 * every fallback-tenant confirmation into a provider rejection for weeks with
 * nobody noticing: the only evidence was a DB drill-down no one ran.
 *
 * These tests pin the floor the Build Principles demand — "instrument every sad
 * path with a metric (survives log truncation) + a 5W log naming the cause."
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { SMSService, redactPhoneNumbers } from '../../../src/services/communications/smsService.js';
import { providerRegistry } from '../../../src/services/communications/ProviderRegistry.js';
import { registry, smsSendsTotal } from '../../../src/services/metrics.js';
import { RateLimitedError, smsRateLimiter } from '../../../src/services/communications/smsRateLimit.js';

const TENANT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

// The history recorder hits Postgres; this suite is about metrics, not persistence.
vi.mock('../../../src/services/communications/communicationHistory.js', () => ({
  recordCommunicationHistory: vi.fn().mockResolvedValue(undefined),
}));

/** Minimal tenant-config stub: no inbound_phone → the env `from` fallback path. */
const configService = {
  getTenantConfig: vi.fn().mockResolvedValue({ inboundPhone: null }),
} as unknown as ConstructorParameters<typeof SMSService>[0];

/** Consent always granted — consent gating is covered elsewhere. */
const consentService = {
  canReceiveCommunications: vi
    .fn()
    .mockResolvedValue({ canReceiveEmail: false, canReceiveSMS: true, hasConsent: true }),
} as unknown as ConstructorParameters<typeof SMSService>[1];

/** Read one counter series value out of the Prometheus exposition text. */
function counterValue(outcome: string, provider = 'mock'): number {
  const line = smsSendsTotal
    .expose()
    .split('\n')
    .find((l) => l.includes(`outcome="${outcome}"`) && l.includes(`provider="${provider}"`));
  return line ? Number(line.trim().split(/\s+/).pop()) : 0;
}

function mockProvider(impl: { sendSMS: () => Promise<{ messageSid: string }> }) {
  // No cast needed since 2026-08-20: TelephonyProvider collapsed to
  // { getName, sendSMS } once the four TwiML methods came out, so this literal
  // now satisfies the interface outright. The cast used to paper over the four
  // dead members it did not implement.
  vi.spyOn(providerRegistry, 'getDefaultProvider').mockReturnValue({
    getName: () => 'mock',
    ...impl,
  });
}

beforeEach(() => {
  registry.clearAll();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('sms_sends_total', () => {
  it('HAPPY: a successful send increments outcome="sent"', async () => {
    // WHO: the agent sending a booking confirmation
    // WHAT: provider accepts → sms_sends_total{outcome="sent"} == 1
    // WHEN: every normal send
    // WHERE: SMSService.sendSMS success path
    // WHY: without a `sent` baseline the failure ratio has no denominator —
    //      `rate(failed)/rate(total)` is the alert, not the raw failure count.
    mockProvider({ sendSMS: () => Promise.resolve({ messageSid: 'SM_ok' }) });
    const svc = new SMSService(configService, consentService);

    const res = await svc.sendSMS(TENANT, { to: '+16305551234', body: 'hi' });

    expect(res.success).toBe(true);
    expect(counterValue('sent')).toBe(1);
    expect(counterValue('failed')).toBe(0);
  });

  it('SAD: a provider rejection increments outcome="failed" AND errors_total', async () => {
    // WHO: any tenant whose `from` number is dead (the +16308661960 incident)
    // WHAT: provider throws → failed counter + errors_total{event="sms_send_failed"}
    // WHEN: bad from-number, revoked key, provider outage
    // WHERE: SMSService.sendSMS catch
    // WHY: THE regression test. This exact condition ran silently in prod for
    //      weeks. errors_total is what the ALERTS.md rules already watch.
    mockProvider({ sendSMS: () => Promise.reject(new Error('from number not owned')) });
    const svc = new SMSService(configService, consentService);

    const res = await svc.sendSMS(TENANT, { to: '+16305551234', body: 'hi' });

    expect(res.success).toBe(false);
    expect(counterValue('failed')).toBe(1);
    expect(counterValue('sent')).toBe(0);
    // errors_total{event="sms_send_failed"} must be present for the alert rules.
    expect(registry.expose()).toContain('errors_total{event="sms_send_failed"} 1');
  });

  it('SAD: a rate-limited send counts as rate_limited, NOT failed', async () => {
    // WHO: a tenant blasting past the 1/sec token bucket
    // WHAT: RateLimitedError rethrown for the worker's retry policy; counted
    //       under its own outcome
    // WHEN: burst traffic
    // WHERE: SMSService.sendSMS RateLimitedError branch
    // WHY: a throttled tenant must not inflate the failure ratio — that ratio
    //      is the alert signal, and 429s are expected + retried, not incidents.
    vi.spyOn(smsRateLimiter, 'acquire').mockImplementation(() => {
      throw new RateLimitedError('slow down');
    });
    mockProvider({ sendSMS: () => Promise.resolve({ messageSid: 'unused' }) });
    const svc = new SMSService(configService, consentService);

    await expect(svc.sendSMS(TENANT, { to: '+16305551234', body: 'hi' })).rejects.toBeInstanceOf(
      RateLimitedError
    );

    expect(counterValue('rate_limited')).toBe(1);
    expect(counterValue('failed')).toBe(0);
    expect(registry.expose()).not.toContain('errors_total{event="sms_send_failed"}');
  });
});

describe('redactPhoneNumbers — keep PII out of the log sink', () => {
  it('SAD: strips the to/from numbers a Telnyx error body echoes back', async () => {
    // WHO: a log sink (Better Stack) receiving an sms_send_failed event
    // WHAT: the raw provider error carries full E.164 numbers; they must not ship
    // WHEN: TelnyxSmsAdapter throws `Telnyx SMS failed <status>: <body>` (line 56)
    // WHERE: redactPhoneNumbers, applied to error_message on both failure paths
    // WHY: the rest of this file logs only recipient_last4. Interpolating the raw
    //      provider body would leak the very numbers that care was protecting.
    //      Flagged by Copilot on PR #231 — a real hole, not a style nit.
    const raw =
      'Telnyx SMS failed 422: {"errors":[{"detail":"to +16305551234 from +16308229086 invalid"}]}';
    const safe = redactPhoneNumbers(raw);

    expect(safe).not.toContain('16305551234');
    expect(safe).not.toContain('16308229086');
    expect(safe).toContain('[redacted-phone]');
    // The HTTP status is 3 digits and must survive — it is the diagnostic.
    expect(safe).toContain('422');
  });

  it('HAPPY: leaves a phone-free error message untouched', async () => {
    // WHO: the ordinary provider error
    // WHAT: no digits runs → string is unchanged
    // WHEN: 'from number not owned', 'TELNYX_API_KEY not configured', etc.
    // WHERE: redactPhoneNumbers
    // WHY: a redactor that mangles every message destroys the diagnostic value
    //      the log exists for. Prove it only touches phone-shaped runs.
    expect(redactPhoneNumbers('from number not owned')).toBe('from number not owned');
    expect(redactPhoneNumbers('TELNYX_API_KEY not configured')).toBe(
      'TELNYX_API_KEY not configured'
    );
  });
});

describe('sendSystemSMS — the compliance-sensitive path', () => {
  it('SAD: a failed opt-out confirmation is no longer swallowed', async () => {
    // WHO: a customer who texted STOP and never got the confirmation
    // WHAT: failure increments sms_sends_total{outcome="failed"} and
    //       errors_total{event="system_sms_send_failed"}
    // WHEN: bad from-number / provider outage
    // WHERE: SMSService.sendSystemSMS catch
    // WHY: this was the darkest path in the service — it writes NO
    //      communications_history row at all, so before this change a failed
    //      opt-out confirmation left no trace anywhere. TCPA exposure with no
    //      evidence trail. The metric is the floor; persistence is a follow-up.
    mockProvider({ sendSMS: () => Promise.reject(new Error('from number not owned')) });
    const svc = new SMSService(configService, consentService);

    const res = await svc.sendSystemSMS(TENANT, { to: '+16305551234', body: 'You opted out.' });

    expect(res.success).toBe(false);
    expect(counterValue('failed')).toBe(1);
    expect(registry.expose()).toContain('errors_total{event="system_sms_send_failed"} 1');
  });

  it('HAPPY: a successful system SMS increments outcome="sent"', async () => {
    // WHO: the opt-out handler on the happy path
    // WHAT: sent counter increments, no errors_total
    // WHEN: normal STOP confirmation
    // WHERE: SMSService.sendSystemSMS success path
    // WHY: proves the failure counter isn't just always-on — the two SAD tests
    //      above would pass against a service that counted every send as failed.
    mockProvider({ sendSMS: () => Promise.resolve({ messageSid: 'SM_sys' }) });
    const svc = new SMSService(configService, consentService);

    const res = await svc.sendSystemSMS(TENANT, { to: '+16305551234', body: 'You opted out.' });

    expect(res.success).toBe(true);
    expect(counterValue('sent')).toBe(1);
    expect(registry.expose()).not.toContain('errors_total{event="system_sms_send_failed"}');
  });
});
