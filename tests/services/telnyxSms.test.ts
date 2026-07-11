/**
 * Tests for the Telnyx SMS wrapper and verification code generator.
 * Mocks global fetch so we never hit Telnyx for real during tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendSms, generateVerificationCode } from '../../src/services/telnyxSms';

beforeEach(() => {
  process.env.TELNYX_API_KEY = 'test-telnyx-key';
});

afterEach(() => {
  delete process.env.TELNYX_API_KEY;
  vi.restoreAllMocks();
});

describe('telnyxSms.sendSms', () => {
  it('HAPPY: calls Telnyx with auth + JSON body and returns ok', async () => {
    // WHO: Voice tool sending an SMS verification code
    // WHAT: Helper hits /v2/messages with Bearer auth + JSON body
    // WHY: Wire-level contract — if this drifts from what Telnyx expects
    //       the OTP flow breaks silently during a live call
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendSms({
      from: '+15550001000',
      to: '+15551234567',
      body: 'Your code: 123456',
    });

    expect(result).toEqual({ ok: true, status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.telnyx.com/v2/messages');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-telnyx-key');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      from: '+15550001000',
      to: '+15551234567',
      text: 'Your code: 123456',
    });
  });

  it('SAD: missing TELNYX_API_KEY returns structured error, does not fetch', async () => {
    // WHO: Misconfigured environment where the Telnyx key wasn't loaded
    // WHAT: Helper must return { ok: false, error } — never throw — so
    //        fire-and-forget callers don't crash and callers with error
    //        handling get a clear reason
    delete process.env.TELNYX_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendSms({ from: '+15550001000', to: '+15551234567', body: 'x' });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('TELNYX_API_KEY');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('SAD: Telnyx 4xx surfaces body + status so the route can log diagnostics', async () => {
    // WHO: Telnyx rejected the send (bad number, throttled, unauthorized)
    // WHAT: Helper returns { ok: false, status, error: <body> }; caller
    //        decides whether to retry or translate for the user
    const fetchMock = vi.fn(
      async () => new Response('{"error":"invalid destination"}', { status: 422 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendSms({ from: '+15550001000', to: 'notaphone', body: 'x' });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(422);
    expect(result.error).toContain('invalid destination');
  });

  it('SAD: network error is caught and surfaced', async () => {
    // WHAT: fetch rejection (DNS failure, connection refused, timeout) must
    //        not crash the caller — return { ok: false } with a message
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      })
    );

    const result = await sendSms({ from: '+15550001000', to: '+15551234567', body: 'x' });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('ECONNREFUSED');
  });
});

describe('telnyxSms.generateVerificationCode', () => {
  it('HAPPY: returns a zero-padded 6-digit string by default', async () => {
    // WHY: SMS OTP is decided at 6 digits. Code must always be 6 chars
    //       so the SMS template doesn't format weird ("Your code: 42")
    for (let i = 0; i < 50; i++) {
      const code = generateVerificationCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });

  it('HAPPY: respects explicit length parameter', async () => {
    // WHAT: If we ever want a shorter code (voice-only testing) the
    //        parameter path still produces correct-width output
    expect(generateVerificationCode(4)).toMatch(/^\d{4}$/);
    expect(generateVerificationCode(8)).toMatch(/^\d{8}$/);
  });

  it('HAPPY: codes use enough entropy to not repeat across 200 draws', async () => {
    // WHY: Sanity check against a naive Math.random-based implementation
    //       that could bias toward certain ranges. 200 6-digit codes should
    //       have very few collisions (birthday math says ~0.02 expected).
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(generateVerificationCode());
    }
    // Allow up to 2 collisions just for test stability; anything more
    // signals a real entropy problem.
    expect(seen.size).toBeGreaterThanOrEqual(198);
  });
});
