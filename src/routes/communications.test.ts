/**
 * Route-handler tests for POST /communications/twilio/status — Twilio's SMS
 * delivery-status webhook.
 *
 * WHO   : Twilio's status-callback POSTs (and the on-call engineer who later
 *         reads message_delivery_status to see what actually got delivered).
 * WHAT  : the webhook parses form-encoded MessageSid + MessageStatus, verifies
 *         the request is genuinely from Twilio (X-Twilio-Signature), and
 *         upserts the delivery status keyed on MessageSid.
 * WHEN  : on every Twilio status callback (queued → sent → delivered, or
 *         → undelivered/failed).
 * WHERE : src/routes/communications.ts — the webhook handler +
 *         recordTwilioDeliveryStatus().
 * WHY   : the adapter now sets statusCallback so we learn sent-vs-delivered;
 *         the webhook is the ingest point. These are mocked unit tests (no
 *         live Twilio): they pin parsing, signature gating, and the persisted
 *         SQL shape. The form-urlencoded parser is registered on the test app
 *         to mirror production (src/index.ts) so the parser contract is
 *         genuinely exercised, not bypassed.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import querystring from 'node:querystring';

// Drive the twilio.validateRequest gate from tests without real creds.
const validateRequest = vi.fn();
vi.mock('twilio', () => ({
  default: { validateRequest: (...args: unknown[]) => validateRequest(...args) },
}));

import { registerCommunicationRoutes, recordTwilioDeliveryStatus } from './communications';
import { buildRouteTestApp, type RouteTestAppHandle } from '../test-utils-mock';
import { createMockClient, createMockPool } from '../test-utils-mock';

const ORIGINAL_ENV = { ...process.env };

let handle: RouteTestAppHandle;
let app: FastifyInstance;

beforeAll(async () => {
  handle = buildRouteTestApp((app, pool, withTenantClient) => {
    // Mirror production: Twilio POSTs application/x-www-form-urlencoded. The
    // shared test-app helper only registers the JSON parser, so add the form
    // parser here BEFORE registering routes (parsers must precede routes).
    app.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string' },
      (_req, body, done) => {
        try {
          done(null, querystring.parse(body as string));
        } catch (err) {
          done(err as Error, undefined);
        }
      }
    );
    registerCommunicationRoutes(app, pool, withTenantClient);
  });
  app = handle.app;
  await app.ready();
});

afterAll(async () => {
  await app.close();
  process.env = { ...ORIGINAL_ENV };
});

beforeEach(() => {
  handle.queries.length = 0;
  handle.queryResponses.length = 0;
  validateRequest.mockReset();
  process.env = { ...ORIGINAL_ENV };
});

function postStatus(form: Record<string, string>, headers: Record<string, string> = {}) {
  return app.inject({
    method: 'POST',
    url: '/communications/twilio/status?tenant_id=tenant-77',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    payload: querystring.stringify(form),
  });
}

describe('POST /communications/twilio/status', () => {
  it('HAPPY: parses MessageStatus and upserts the delivery row (no auth token → accept+log)', async () => {
    // WHO: Twilio delivering a "delivered" callback in a deployment with no
    //      TWILIO_AUTH_TOKEN configured (local/dev).
    // WHAT: handler records the status and replies 200.
    // WHERE: helper-unavailable branch — accept without signature check.
    // WHY: dev environments without an auth token must still ingest receipts.
    delete process.env.TWILIO_AUTH_TOKEN;
    handle.queryResponses.push({ rows: [], rowCount: 1 }); // the upsert

    const res = await postStatus({ MessageSid: 'SMabc', MessageStatus: 'delivered' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
    // The INSERT … ON CONFLICT upsert fired with the parsed fields + tenant_id
    // from the query string.
    const upsert = handle.queries.find((q) => q.text.includes('message_delivery_status'));
    expect(upsert).toBeDefined();
    expect(upsert!.text).toContain('ON CONFLICT');
    expect(upsert!.params).toEqual(['SMabc', 'delivered', null, 'tenant-77']);
    // validateRequest must NOT have been consulted (no auth token).
    expect(validateRequest).not.toHaveBeenCalled();
  });

  it('HAPPY: passes ErrorCode through when present (undelivered)', async () => {
    // WHY: undelivered/failed callbacks carry an ErrorCode (e.g. 30008) the
    //      engineer needs to diagnose the carrier rejection.
    delete process.env.TWILIO_AUTH_TOKEN;
    handle.queryResponses.push({ rows: [], rowCount: 1 });

    const res = await postStatus({
      MessageSid: 'SMfail',
      MessageStatus: 'undelivered',
      ErrorCode: '30008',
    });

    expect(res.statusCode).toBe(200);
    const upsert = handle.queries.find((q) => q.text.includes('message_delivery_status'));
    expect(upsert!.params).toEqual(['SMfail', 'undelivered', '30008', 'tenant-77']);
  });

  it('HAPPY: verifies signature when TWILIO_AUTH_TOKEN is set and signature is valid', async () => {
    // WHO: Twilio in production with a signed callback.
    // WHAT: handler validates X-Twilio-Signature, then records.
    process.env.TWILIO_AUTH_TOKEN = 'secret-token';
    validateRequest.mockReturnValue(true);
    handle.queryResponses.push({ rows: [], rowCount: 1 });

    const res = await postStatus(
      { MessageSid: 'SMsigned', MessageStatus: 'sent' },
      { 'x-twilio-signature': 'abc123' }
    );

    expect(res.statusCode).toBe(200);
    expect(validateRequest).toHaveBeenCalledTimes(1);
    // Auth token + signature header are passed to the validator.
    expect(validateRequest.mock.calls[0][0]).toBe('secret-token');
    expect(validateRequest.mock.calls[0][1]).toBe('abc123');
    const upsert = handle.queries.find((q) => q.text.includes('message_delivery_status'));
    expect(upsert).toBeDefined();
  });

  it('SAD: rejects 403 and records NOTHING when the signature is invalid', async () => {
    // WHO: a spoofed/forged callback (or a misconfigured proxy mangling the URL).
    // WHAT: validateRequest → false ⇒ 403, no DB write.
    // WHY: an unverified caller must not be able to write delivery rows.
    process.env.TWILIO_AUTH_TOKEN = 'secret-token';
    validateRequest.mockReturnValue(false);

    const res = await postStatus(
      { MessageSid: 'SMspoof', MessageStatus: 'delivered' },
      { 'x-twilio-signature': 'WRONG' }
    );

    expect(res.statusCode).toBe(403);
    expect(res.json().success).toBe(false);
    const upsert = handle.queries.find((q) => q.text.includes('message_delivery_status'));
    expect(upsert).toBeUndefined();
  });

  it('SAD: rejects 400 on a malformed callback missing MessageSid', async () => {
    // WHO: a malformed/partial POST (truncated body, non-Twilio probe).
    // WHAT: missing MessageSid ⇒ 400, no DB write, before signature check.
    // WHY: never persist a junk row with a null SID — the SID is the key.
    process.env.TWILIO_AUTH_TOKEN = 'secret-token';
    validateRequest.mockReturnValue(true);

    const res = await postStatus({ MessageStatus: 'delivered' });

    expect(res.statusCode).toBe(400);
    expect(res.json().success).toBe(false);
    const upsert = handle.queries.find((q) => q.text.includes('message_delivery_status'));
    expect(upsert).toBeUndefined();
  });

  it('SAD: rejects 400 when MessageStatus is missing', async () => {
    // WHY: a row with a SID but no status carries no delivery signal.
    process.env.TWILIO_AUTH_TOKEN = 'secret-token';
    validateRequest.mockReturnValue(true);

    const res = await postStatus({ MessageSid: 'SMnostatus' });

    expect(res.statusCode).toBe(400);
    const upsert = handle.queries.find((q) => q.text.includes('message_delivery_status'));
    expect(upsert).toBeUndefined();
  });
});

describe('recordTwilioDeliveryStatus', () => {
  it('upserts via INSERT … ON CONFLICT(message_sid) DO UPDATE with latest-wins fields', async () => {
    // WHO: the persistence helper called by the webhook.
    // WHAT: a single parameterized upsert; tenant_id COALESCE preserves an
    //       earlier non-null tenant if a later callback lacks it.
    // WHY: Twilio fires multiple callbacks per message — latest status wins,
    //      one row per SID.
    const mock = createMockClient();
    const pool = createMockPool(mock.mockClient);
    mock.queryResponses.push({ rows: [], rowCount: 1 });

    await recordTwilioDeliveryStatus(pool, {
      messageSid: 'SMxyz',
      messageStatus: 'delivered',
      errorCode: null,
      tenantId: 'tenant-9',
    });

    expect(mock.queries).toHaveLength(1);
    expect(mock.queries[0].text).toContain('INSERT INTO message_delivery_status');
    expect(mock.queries[0].text).toContain('ON CONFLICT (message_sid)');
    expect(mock.queries[0].text).toContain('COALESCE(EXCLUDED.tenant_id');
    expect(mock.queries[0].params).toEqual(['SMxyz', 'delivered', null, 'tenant-9']);
  });
});
