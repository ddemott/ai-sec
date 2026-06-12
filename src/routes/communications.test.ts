/**
 * Route-handler tests for src/routes/communications.ts:
 *   - GET  /communications/history     — the tenant's sent-communication feed
 *   - POST /communications/twilio/status — Twilio's SMS delivery-status webhook
 *
 * 5W context for sad-path failures:
 *   WHO   — a dashboard/owner loading history; Twilio POSTing delivery receipts
 *   WHAT  — the history read returns the tenant's sent log; the webhook parses
 *           MessageSid + MessageStatus, verifies the signature, and upserts
 *   WHEN  — on every history load, and on every Twilio status callback
 *   WHERE — registerCommunicationRoutes handlers + recordTwilioDeliveryStatus()
 *   WHY   — the history stub silently returned [] forever (leak/hide risk); the
 *           webhook is the ingest point for sent-vs-delivered. Mock-pool unit
 *           tests pin the SQL contract, validation, signature gating, and the
 *           response envelope. (RLS/real-column-shape for history is covered in
 *           services/communications/communicationHistory.test.ts.)
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
import {
  buildRouteTestApp,
  type RouteTestAppHandle,
  createMockClient,
  createMockPool,
} from '../test-utils-mock';

const TENANT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
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
  handle.tenantIdOverride.current = null;
  handle.auth.current = {
    user_id: '00000000-0000-0000-0000-000000000001',
    tenant_id: TENANT_ID,
    email: 'owner@test.local',
    role: 'owner',
  };
  validateRequest.mockReset();
  process.env = { ...ORIGINAL_ENV };
});

describe('GET /communications/history', () => {
  it('HAPPY: returns real rows scoped to the caller tenant with the full total', async () => {
    // WHO: tenant owner loading the communications history feed
    // WHAT: SELECT ... FROM communications_history WHERE tenant_id = $1, paginated
    // WHEN: the history view mounts
    // WHERE: GET /communications/history handler
    // WHY: rows must be tenant-scoped and `total` must be the full filtered count
    handle.queryResponses.push({
      rows: [
        {
          communications_history_id: 2,
          tenant_id: TENANT_ID,
          channel: 'sms',
          direction: 'outbound',
          recipient: '+15551234567',
          subject: null,
          body: 'Reminder',
          status: 'sent',
          provider_message_id: 'SM2',
          error: null,
          created_at: '2026-06-12T10:00:00.000Z',
          total_count: '2',
        },
        {
          communications_history_id: 1,
          tenant_id: TENANT_ID,
          channel: 'email',
          direction: 'outbound',
          recipient: 'jane@example.com',
          subject: 'Hi',
          body: 'Body',
          status: 'sent',
          provider_message_id: 'msg1',
          error: null,
          created_at: '2026-06-12T09:00:00.000Z',
          total_count: '2',
        },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/communications/history' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.history).toHaveLength(2);
    expect(body.total).toBe(2);
    // The window-function helper column must not leak into the response.
    expect(body.history[0]).not.toHaveProperty('total_count');
    expect(body.history[0].channel).toBe('sms');

    const dataQueries = handle.queries.filter(
      (q) =>
        !q.text.startsWith('SET') && !q.text.startsWith('SELECT set') && !q.text.includes('RESET')
    );
    const historyQuery = dataQueries.find((q) => q.text.includes('communications_history'));
    expect(historyQuery).toBeDefined();
    expect(historyQuery!.text).toContain('WHERE tenant_id = $1');
    // type defaults to 'all', limit defaults to 50, offset defaults to 0
    expect(historyQuery!.params).toEqual([TENANT_ID, 'all', 50, 0]);
  });

  it('HAPPY: returns an empty list and total 0 when the tenant has no history', async () => {
    // WHO: a brand-new tenant that has not sent anything yet
    // WHAT: zero rows → history: [], total: 0 (NOT the old "not implemented" note)
    // WHEN: first load before any email/SMS is sent
    // WHERE: GET /communications/history handler
    // WHY: empty must be a real empty result, not a stubbed placeholder
    handle.queryResponses.push({ rows: [] });

    const res = await app.inject({ method: 'GET', url: '/communications/history' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.history).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.note).toBeUndefined();
  });

  it('HAPPY: passes the channel filter and pagination window through to SQL', async () => {
    // WHO: an owner filtering to SMS only, page 2
    // WHAT: ?type=sms&limit=10&offset=10 must reach the query params verbatim
    // WHEN: paginated/filtered browsing
    // WHERE: GET /communications/history handler
    // WHY: a dropped filter would show the wrong channel or wrong page
    handle.queryResponses.push({ rows: [] });

    const res = await app.inject({
      method: 'GET',
      url: '/communications/history?type=sms&limit=10&offset=10',
    });

    expect(res.statusCode).toBe(200);
    const historyQuery = handle.queries.find((q) => q.text.includes('communications_history'));
    expect(historyQuery!.params).toEqual([TENANT_ID, 'sms', 10, 10]);
  });

  it('SAD: rejects an out-of-range limit with 400', async () => {
    // WHO: a malformed client request (or a probe)
    // WHAT: limit=500 exceeds the max(100) → zod rejects → 400
    // WHEN: bad input arrives
    // WHERE: HistoryQuerySchema validation in the handler
    // WHY: clamping silently would mask client bugs; a 400 is the honest answer
    const res = await app.inject({
      method: 'GET',
      url: '/communications/history?limit=500',
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Invalid query parameters');
  });

  it('SAD: rejects an invalid type value with 400', async () => {
    // WHO: a client passing an unsupported channel
    // WHAT: type=carrier-pigeon is not in the enum → 400
    // WHEN: bad input arrives
    // WHERE: HistoryQuerySchema validation
    // WHY: the channel filter is an allowlist; unknown values must be refused
    const res = await app.inject({
      method: 'GET',
      url: '/communications/history?type=carrier-pigeon',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().success).toBe(false);
  });
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
