/**
 * TwilioAdapter delivery-receipt wiring tests.
 *
 * WHO   : the SMS send path (SMSService → ProviderRegistry → TwilioAdapter)
 *         and the on-call engineer reading message_delivery_status later.
 * WHAT  : TwilioAdapter.sendSMS must attach a statusCallback URL to
 *         messages.create() WHEN a backend public base URL is configured,
 *         and OMIT it entirely when not — so Twilio only POSTs delivery
 *         receipts when we have a reachable webhook to receive them.
 * WHEN   : every outbound SMS. The env var is read at send time, so tests
 *         toggle BACKEND_PUBLIC_URL per case.
 * WHERE : src/services/communications/TwilioAdapter.ts sendSMS().
 * WHY   : the adapter previously sent with NO statusCallback, so the system
 *         never learned sent-vs-delivered (transient-flake audit, 2026-06-12).
 *         These are mocked unit tests — no live Twilio creds — which is the
 *         expected fidelity here: they pin the request SHAPE the SDK receives.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Capture the args messages.create() is called with. The twilio default
// export is a factory returning a client; we stub the client so the adapter
// constructor (which needs TWILIO_ACCOUNT_SID/AUTH_TOKEN present) builds it.
const messagesCreate = vi.fn().mockResolvedValue({ sid: 'SMmocksid123' });

vi.mock('twilio', () => {
  const factory = vi.fn(() => ({
    messages: { create: messagesCreate },
    calls: { create: vi.fn().mockResolvedValue({ sid: 'CAmock' }) },
  }));
  // twilio.twiml.VoiceResponse is referenced elsewhere in the adapter; the
  // sendSMS path doesn't touch it, but the import must resolve.
  return { default: Object.assign(factory, { twiml: { VoiceResponse: class {} } }) };
});

import { TwilioAdapter } from './TwilioAdapter.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  messagesCreate.mockClear();
  process.env.TWILIO_ACCOUNT_SID = 'ACtest';
  process.env.TWILIO_AUTH_TOKEN = 'authtest';
  delete process.env.BACKEND_PUBLIC_URL;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('TwilioAdapter.sendSMS statusCallback wiring', () => {
  it('INCLUDES statusCallback (with tenant_id) when BACKEND_PUBLIC_URL is set', async () => {
    // WHEN a backend base URL is configured, Twilio must be told where to
    // POST delivery receipts, and the tenant_id must ride on the URL so the
    // webhook can attribute the row.
    process.env.BACKEND_PUBLIC_URL = 'https://api.example.com';
    const adapter = new TwilioAdapter();

    const result = await adapter.sendSMS({
      to: '+15551230000',
      from: '+15559999999',
      body: 'hello',
      tenantId: 'tenant-abc',
    });

    expect(result).toEqual({ messageSid: 'SMmocksid123' });
    expect(messagesCreate).toHaveBeenCalledTimes(1);
    const arg = messagesCreate.mock.calls[0][0] as Record<string, string>;
    expect(arg.statusCallback).toBe(
      'https://api.example.com/communications/twilio/status?tenant_id=tenant-abc'
    );
    expect(arg.to).toBe('+15551230000');
    expect(arg.body).toBe('hello');
  });

  it('strips a trailing slash on BACKEND_PUBLIC_URL so the callback path is well-formed', async () => {
    // WHERE the operator sets BACKEND_PUBLIC_URL with a trailing slash, the
    // adapter must not produce a double-slash path (Twilio would 404 it).
    process.env.BACKEND_PUBLIC_URL = 'https://api.example.com/';
    const adapter = new TwilioAdapter();

    await adapter.sendSMS({
      to: '+15551230000',
      from: '+15559999999',
      body: 'hi',
      tenantId: 'tenant-xyz',
    });

    const arg = messagesCreate.mock.calls[0][0] as Record<string, string>;
    expect(arg.statusCallback).toBe(
      'https://api.example.com/communications/twilio/status?tenant_id=tenant-xyz'
    );
  });

  it('OMITS statusCallback when BACKEND_PUBLIC_URL is unset', async () => {
    // WHEN no backend base URL is configured (e.g. local dev with no public
    // tunnel), the adapter must NOT attach a callback — pointing Twilio at an
    // unreachable URL is worse than no receipt at all.
    delete process.env.BACKEND_PUBLIC_URL;
    const adapter = new TwilioAdapter();

    await adapter.sendSMS({
      to: '+15551230000',
      from: '+15559999999',
      body: 'hi',
      tenantId: 'tenant-abc',
    });

    const arg = messagesCreate.mock.calls[0][0] as Record<string, string>;
    expect('statusCallback' in arg).toBe(false);
  });

  it('OMITS statusCallback when BACKEND_PUBLIC_URL is blank/whitespace', async () => {
    // WHY an empty-string env var (common when a deploy var is declared but
    // not filled) must be treated as "not configured", not as base "".
    process.env.BACKEND_PUBLIC_URL = '   ';
    const adapter = new TwilioAdapter();

    await adapter.sendSMS({
      to: '+15551230000',
      from: '+15559999999',
      body: 'hi',
      tenantId: 'tenant-abc',
    });

    const arg = messagesCreate.mock.calls[0][0] as Record<string, string>;
    expect('statusCallback' in arg).toBe(false);
  });
});
