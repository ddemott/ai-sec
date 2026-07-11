/**
 * TelnyxSmsAdapter delivery-receipt wiring tests.
 *
 * WHO   : the SMS send path (SMSService → ProviderRegistry → TelnyxSmsAdapter)
 *         and the on-call engineer reading message_delivery_status later.
 * WHAT  : TelnyxSmsAdapter.sendSMS must attach a webhook_url (with tenant_id)
 *         WHEN a backend public base URL is configured, and OMIT it entirely
 *         when not.
 * WHEN  : every outbound SMS. BACKEND_PUBLIC_URL is read at send time so tests
 *         toggle it per case.
 * WHERE : src/services/communications/TelnyxSmsAdapter.ts sendSMS().
 * WHY   : without webhook_url, Telnyx silently succeeds but we never learn
 *         sent-vs-delivered; same gap that existed in the previous SMS provider before 2026-06-12.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.TELNYX_API_KEY = 'test-key-123';
  delete process.env.BACKEND_PUBLIC_URL;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

import { TelnyxSmsAdapter } from '../../../src/services/communications/TelnyxSmsAdapter.js';

describe('TelnyxSmsAdapter.sendSMS', () => {
  it('HAPPY: sends correct JSON body and returns messageSid', async () => {
    // WHAT: adapter hits /v2/messages with Bearer auth and mapped field names
    // WHY: Telnyx uses `text` not `body`; wrong field = silent delivery failure
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ data: { id: 'msg-abc-123' } }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new TelnyxSmsAdapter();
    const result = await adapter.sendSMS({
      to: '+15551234567',
      from: '+15550001000',
      body: 'Your appointment is tomorrow',
      tenantId: 'tenant-abc',
    });

    expect(result).toEqual({ messageSid: 'msg-abc-123' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.telnyx.com/v2/messages');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-key-123');
    const body = JSON.parse(init.body as string);
    expect(body.text).toBe('Your appointment is tomorrow');
    expect(body.to).toBe('+15551234567');
    expect(body.from).toBe('+15550001000');
  });

  it('INCLUDES webhook_url (with tenant_id) when BACKEND_PUBLIC_URL is set', async () => {
    // WHEN a backend base URL is configured, Telnyx must receive a per-message
    // webhook_url so delivery receipts flow to our endpoint.
    process.env.BACKEND_PUBLIC_URL = 'https://api.example.com';
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ data: { id: 'msg-xyz' } }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new TelnyxSmsAdapter();
    await adapter.sendSMS({
      to: '+15551234567',
      from: '+15550001000',
      body: 'hi',
      tenantId: 'tenant-xyz',
    });

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.webhook_url).toBe(
      'https://api.example.com/communications/telnyx/status?tenant_id=tenant-xyz'
    );
  });

  it('strips trailing slash on BACKEND_PUBLIC_URL', async () => {
    // WHERE the operator sets BACKEND_PUBLIC_URL with a trailing slash, the
    // webhook_url path must not have a double slash.
    process.env.BACKEND_PUBLIC_URL = 'https://api.example.com/';
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ data: { id: 'msg-trail' } }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new TelnyxSmsAdapter();
    await adapter.sendSMS({
      to: '+15551234567',
      from: '+15550001000',
      body: 'hi',
      tenantId: 'tenant-abc',
    });

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.webhook_url).toBe(
      'https://api.example.com/communications/telnyx/status?tenant_id=tenant-abc'
    );
  });

  it('OMITS webhook_url when BACKEND_PUBLIC_URL is unset', async () => {
    // WHEN no backend base URL is configured, the adapter must NOT attach a
    // webhook_url — pointing Telnyx at an unreachable URL is worse than no receipt.
    delete process.env.BACKEND_PUBLIC_URL;
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ data: { id: 'msg-no-hook' } }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new TelnyxSmsAdapter();
    await adapter.sendSMS({
      to: '+15551234567',
      from: '+15550001000',
      body: 'hi',
      tenantId: 'tenant-abc',
    });

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect('webhook_url' in body).toBe(false);
  });

  it('OMITS webhook_url when BACKEND_PUBLIC_URL is blank/whitespace', async () => {
    // WHY: empty-string env var must be treated as "not configured"
    process.env.BACKEND_PUBLIC_URL = '   ';
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ data: { id: 'msg-blank' } }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new TelnyxSmsAdapter();
    await adapter.sendSMS({
      to: '+15551234567',
      from: '+15550001000',
      body: 'hi',
      tenantId: 'tenant-abc',
    });

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect('webhook_url' in body).toBe(false);
  });

  it('SAD: throws when TELNYX_API_KEY is unset', async () => {
    delete process.env.TELNYX_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new TelnyxSmsAdapter();
    await expect(
      adapter.sendSMS({
        to: '+15551234567',
        from: '+15550001000',
        body: 'x',
        tenantId: 'tenant-abc',
      })
    ).rejects.toThrow('TELNYX_API_KEY not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('SAD: throws on non-ok HTTP response with status + body', async () => {
    // WHEN Telnyx rejects (bad number, throttled, unauthorized), the adapter
    // must surface status + body so the caller can log diagnostics.
    const fetchMock = vi.fn(
      async () => new Response('{"errors":[{"detail":"Invalid destination"}]}', { status: 422 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new TelnyxSmsAdapter();
    await expect(
      adapter.sendSMS({ to: 'bad', from: '+15550001000', body: 'x', tenantId: 'tenant-abc' })
    ).rejects.toThrow('422');
  });
});
