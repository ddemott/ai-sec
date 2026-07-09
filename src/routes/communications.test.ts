/**
 * Route-handler tests for src/routes/communications.ts:
 *   - GET  /communications/history     — the tenant's sent-communication feed
 *   - POST /communications/sms         — send SMS (via Telnyx by default)
 *
 * 5W context for sad-path failures:
 *   WHO   — a dashboard/owner loading history
 *   WHAT  — the history read returns the tenant's sent log
 *   WHEN  — on every history load
 *   WHERE — registerCommunicationRoutes handlers
 *   WHY   — the history stub silently returned [] forever (leak/hide risk).
 *           (RLS/real-column-shape for history is covered in
 *           services/communications/communicationHistory.test.ts.)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
import type { FastifyInstance } from 'fastify';

import { registerCommunicationRoutes } from './communications';
import { jsonContentTypeParser } from '../jsonContentTypeParser';
import { buildRouteTestApp, type RouteTestAppHandle } from '../test-utils-mock';

const TENANT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ORIGINAL_ENV = { ...process.env };

let handle: RouteTestAppHandle;
let app: FastifyInstance;

beforeAll(async () => {
  handle = buildRouteTestApp((app, pool, withTenantClient) => {
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
    // type + status default to 'all', limit defaults to 50, offset defaults to 0
    expect(historyQuery!.params).toEqual([TENANT_ID, 'all', 'all', 50, 0]);
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
    expect(historyQuery!.params).toEqual([TENANT_ID, 'sms', 'all', 10, 10]);
  });

  it('HAPPY: passes the delivery-status filter through to SQL (failed-only drill-down)', async () => {
    // WHO: an owner drilling into failed deliveries from the dashboard
    // WHAT: ?status=failed must reach the query as $3 so only failed rows return
    // WHEN: the "Failed only" toggle is active on the comms history view
    // WHERE: GET /communications/history handler, HistoryQuerySchema.status
    // WHY: a dropped status filter would silently show ALL rows under a
    //      "Failed only" label — the owner would misread delivery health
    handle.queryResponses.push({ rows: [] });

    const res = await app.inject({
      method: 'GET',
      url: '/communications/history?status=failed',
    });

    expect(res.statusCode).toBe(200);
    const historyQuery = handle.queries.find((q) => q.text.includes('communications_history'));
    expect(historyQuery!.text).toContain("($3 = 'all' OR status = $3)");
    expect(historyQuery!.params).toEqual([TENANT_ID, 'all', 'failed', 50, 0]);
  });

  it('SAD: rejects an unknown status value with 400', async () => {
    // WHO: a client passing a status outside the CHECK-constraint vocabulary
    // WHAT: status=bounced is not in the enum (sent|failed|queued|all) → 400
    // WHEN: bad input arrives (typo, stale client)
    // WHERE: HistoryQuerySchema validation
    // WHY: the status filter is an allowlist mirroring the DB CHECK; silently
    //      coercing unknown values would return misleading "all" results
    const res = await app.inject({
      method: 'GET',
      url: '/communications/history?status=bounced',
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Invalid query parameters');
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

describe('POST /communications/telnyx/status (delivery-status webhook)', () => {
  // A well-formed Telnyx v2 delivery-status payload (message delivered, no errors).
  const validPayload = {
    data: {
      event_type: 'message.finalized',
      payload: {
        id: 'msg_abc123',
        to: [{ status: 'delivered' }],
        errors: [],
      },
    },
  };

  it('HAPPY: unverified (no secret) records the status and returns success', async () => {
    // WHO: Telnyx POSTing a delivery receipt for a sent SMS
    // WHAT: route parses id+status, upserts message_delivery_status via recordDeliveryStatus
    // WHEN: TELNYX_WEBHOOK_SECRET is unset (dev/staging) → accept without signature
    // WHERE: POST /communications/telnyx/status handler
    // WHY: delivery receipts must persist so reminder/delivery stats are real
    delete process.env.TELNYX_WEBHOOK_SECRET;
    const res = await app.inject({
      method: 'POST',
      url: `/communications/telnyx/status?tenant_id=${TENANT_ID}`,
      payload: validPayload,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    // The upsert hit the delivery-status table with the parsed sid + status + tenant.
    const upsert = handle.queries.find((q) => q.text.includes('message_delivery_status'));
    expect(upsert, 'expected an upsert into message_delivery_status').toBeTruthy();
    expect(upsert!.params).toContain('msg_abc123');
    expect(upsert!.params).toContain('delivered');
    expect(upsert!.params).toContain(TENANT_ID);
  });

  it('SAD: malformed payload (missing id/status) returns 400 and writes nothing', async () => {
    // WHO: a bad/garbage POST to the public webhook
    // WHAT: payload lacks data.payload.id and status → no DB write
    // WHEN: Telnyx (or an attacker) sends an unexpected shape
    // WHERE: the malformed-guard before any DB call
    // WHY: never upsert a row with a null SID; fail loud with 400
    delete process.env.TELNYX_WEBHOOK_SECRET;
    const res = await app.inject({
      method: 'POST',
      url: '/communications/telnyx/status',
      payload: { data: { event_type: 'message.finalized', payload: {} } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().success).toBe(false);
    expect(handle.queries.find((q) => q.text.includes('message_delivery_status'))).toBeUndefined();
  });

  it('SAD: wrong signature (secret set) returns 403 and writes nothing', async () => {
    // WHO: a forged webhook call when signature verification is enabled
    // WHAT: telnyx-signature v1 does not match HMAC(secret, t|body) → 403
    // WHEN: TELNYX_WEBHOOK_SECRET is configured (prod)
    // WHERE: the signature-verification branch
    // WHY: a public DB-writing endpoint must reject unsigned/forged callers
    process.env.TELNYX_WEBHOOK_SECRET = 'whsec_test';
    const res = await app.inject({
      method: 'POST',
      url: `/communications/telnyx/status?tenant_id=${TENANT_ID}`,
      headers: { 'telnyx-signature': 't=123,v1=deadbeef' },
      payload: validPayload,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().success).toBe(false);
    expect(handle.queries.find((q) => q.text.includes('message_delivery_status'))).toBeUndefined();
  });

  it('SAD: an unsigned `{}` body dies at the signature check, not the id/status guard', async () => {
    // WHO: any caller POSTing a payload-less `{}` to the Telnyx status webhook
    // WHAT: 403 "Invalid Telnyx signature" — verification runs before parsing
    // WHEN: TELNYX_WEBHOOK_SECRET is configured (prod)
    // WHERE: the signature-verification branch, which now reads req.rawBody
    // WHY: pins the ORDERING. Before 2026-07-09 an unsigned caller reached the
    //      parse path and was only stopped by the id/status guard; that made
    //      the guard load-bearing for security. Now nothing unsigned gets past
    //      the HMAC. NB: `payload: {}` sends the two bytes `{}` — NOT an empty
    //      body. The genuinely-empty case needs the production content-type
    //      parser and is covered in the describe block below.
    process.env.TELNYX_WEBHOOK_SECRET = 'whsec_test';
    const res = await app.inject({
      method: 'POST',
      url: `/communications/telnyx/status?tenant_id=${TENANT_ID}`,
      headers: { 'telnyx-signature': 't=123,v1=deadbeef', 'content-type': 'application/json' },
      payload: {},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/invalid telnyx signature/i);
    expect(handle.queries.find((q) => q.text.includes('message_delivery_status'))).toBeUndefined();
  });

  it('SAD: malformed payload 400s only after a valid signature', async () => {
    // WHO: Telnyx (or a key holder) sending a correctly-signed but empty shape
    // WHAT: signature passes, then the id/status guard 400s with no DB write
    // WHEN: signature verification is enabled
    // WHERE: the malformed-guard, which now sits after verification
    // WHY: reordering verification ahead of parsing must not lose the 400 —
    //      a signed-but-garbage payload is still garbage.
    process.env.TELNYX_WEBHOOK_SECRET = 'whsec_test';
    const timestamp = '1700000000';
    const rawBody = '{"data":{"event_type":"message.finalized","payload":{}}}';
    const sig = createHmac('sha256', 'whsec_test').update(`${timestamp}|${rawBody}`).digest('hex');
    const res = await app.inject({
      method: 'POST',
      url: `/communications/telnyx/status?tenant_id=${TENANT_ID}`,
      headers: {
        'telnyx-signature': `t=${timestamp},v1=${sig}`,
        'content-type': 'application/json',
      },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/missing message id or status/i);
    expect(handle.queries.find((q) => q.text.includes('message_delivery_status'))).toBeUndefined();
  });

  it('HAPPY: valid signature (secret set) passes verification and records', async () => {
    // WHO: a genuine Telnyx call with a correct HMAC signature
    // WHAT: v1 == HMAC-SHA256(secret, `${t}|${rawBody}`) → 200 + upsert
    // WHEN: TELNYX_WEBHOOK_SECRET is configured and the signature is honest
    // WHERE: the signature-verification branch (happy side)
    // WHY: real signed receipts must be accepted, not just rejected
    process.env.TELNYX_WEBHOOK_SECRET = 'whsec_test';
    const timestamp = '1700000000';
    const rawBody = JSON.stringify(validPayload);
    const sig = createHmac('sha256', 'whsec_test').update(`${timestamp}|${rawBody}`).digest('hex');
    const res = await app.inject({
      method: 'POST',
      url: `/communications/telnyx/status?tenant_id=${TENANT_ID}`,
      headers: {
        'telnyx-signature': `t=${timestamp},v1=${sig}`,
        'content-type': 'application/json',
      },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(handle.queries.find((q) => q.text.includes('message_delivery_status'))).toBeTruthy();
  });

  it('HAPPY: signature over raw bytes that JSON.stringify would not reproduce', async () => {
    // WHO: real Telnyx, whose wire bytes carry their own whitespace + key order
    // WHAT: a body signed as-sent verifies, though JSON.stringify(parsed body)
    //       yields different bytes (re-ordered keys, no padding) and a different HMAC
    // WHEN: any production delivery receipt — Telnyx does not promise that its
    //       serialization matches Node's
    // WHERE: the signature-verification branch reading req.rawBody
    // WHY: THE regression test for the 2026-07-09 fix. The route used to sign
    //      JSON.stringify(req.body ?? {}), so every payload whose bytes differed
    //      from Node's serialization 403'd in prod while the suite stayed green.
    //      Asserting the two byte strings differ is what gives this test teeth.
    process.env.TELNYX_WEBHOOK_SECRET = 'whsec_test';
    const timestamp = '1700000000';
    // Same JSON value as validPayload, different bytes: padded + keys reversed.
    const rawBody =
      '{ "data" : { "payload" : { "errors" : [],  "to" : [ { "status" : "delivered" } ],  "id" : "msg_abc123" },  "event_type" : "message.finalized" } }';
    expect(rawBody).not.toBe(JSON.stringify(JSON.parse(rawBody)));
    expect(JSON.parse(rawBody)).toEqual(validPayload);

    const sig = createHmac('sha256', 'whsec_test').update(`${timestamp}|${rawBody}`).digest('hex');
    const res = await app.inject({
      method: 'POST',
      url: `/communications/telnyx/status?tenant_id=${TENANT_ID}`,
      headers: {
        'telnyx-signature': `t=${timestamp},v1=${sig}`,
        'content-type': 'application/json',
      },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    const upsert = handle.queries.find((q) => q.text.includes('message_delivery_status'));
    expect(upsert, 'expected an upsert into message_delivery_status').toBeTruthy();
    expect(upsert!.params).toContain('msg_abc123');
  });
});

/**
 * The route tests above run on the shared mock harness, whose content-type
 * parser rejects an empty body (`JSON.parse('')` throws). Production's
 * `jsonContentTypeParser` does the opposite: it synthesizes `{}` as the parsed
 * body while leaving `rawBody` as the untouched empty buffer.
 *
 * That divergence is precisely where the 2026-07-08 "Try live demo" 400 hid
 * (see docs/LESSONS_LEARNED.md — "Two mocks facing each other test nothing").
 * So this block registers the REAL parser and pins the contract that matters
 * for a webhook: an empty body must be HMAC'd as empty bytes, never as the
 * synthesized `{}` that req.body reports.
 */
describe('POST /communications/telnyx/status — with the PRODUCTION content-type parser', () => {
  let prodHandle: RouteTestAppHandle;
  let prodApp: FastifyInstance;

  beforeAll(async () => {
    prodHandle = buildRouteTestApp((app, pool, withTenantClient) => {
      registerCommunicationRoutes(app, pool, withTenantClient);
    });
    prodApp = prodHandle.app;
    // Swap the harness's parser for the one prod actually runs.
    prodApp.removeContentTypeParser('application/json');
    prodApp.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      jsonContentTypeParser as never
    );
    await prodApp.ready();
  });

  afterAll(async () => {
    await prodApp.close();
  });

  it('SAD: a truly empty body is HMAC-checked as empty bytes and 403s', async () => {
    // WHO: an unsigned caller (or a probe) POSTing zero bytes with a JSON content-type
    // WHAT: 403 — the route signs `t|` + "" and gets a mismatch
    // WHEN: TELNYX_WEBHOOK_SECRET is set
    // WHERE: the signature branch reading req.rawBody (empty buffer, not `{}`)
    // WHY: the parser hands req.body = {} for an empty body. A route that
    //      HMAC'd JSON.stringify(req.body) would therefore sign the literal
    //      "{}" — bytes the client never sent. Pin that rawBody stays empty so
    //      the signature check fails honestly instead of validating a forgery
    //      the parser invented. Copilot flagged (PR #224) that the sibling test
    //      above sends `{}` and never reaches this branch; this one does.
    process.env.TELNYX_WEBHOOK_SECRET = 'whsec_test';
    const res = await prodApp.inject({
      method: 'POST',
      url: `/communications/telnyx/status?tenant_id=${TENANT_ID}`,
      headers: { 'telnyx-signature': 't=123,v1=deadbeef', 'content-type': 'application/json' },
      payload: '',
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/invalid telnyx signature/i);
    expect(
      prodHandle.queries.find((q) => q.text.includes('message_delivery_status'))
    ).toBeUndefined();
  });

  it('SAD: an empty body signed as the synthesized `{}` is REJECTED', async () => {
    // WHO: an attacker who knows the parser turns an empty body into `{}`
    // WHAT: a signature computed over the string "{}" must NOT validate an
    //       empty request, because the bytes on the wire were empty
    // WHEN: TELNYX_WEBHOOK_SECRET is set
    // WHERE: the signature branch — rawBody ("") vs req.body ({})
    // WHY: this is the actual exploit shape of the old bug, inverted. Under
    //      JSON.stringify(req.body ?? {}) this request would have VERIFIED.
    //      It must not. (Signing here only proves the check reads raw bytes;
    //      a real attacker still needs the secret.)
    process.env.TELNYX_WEBHOOK_SECRET = 'whsec_test';
    const timestamp = '1700000000';
    const sigOverSynthesized = createHmac('sha256', 'whsec_test')
      .update(`${timestamp}|{}`)
      .digest('hex');
    const res = await prodApp.inject({
      method: 'POST',
      url: `/communications/telnyx/status?tenant_id=${TENANT_ID}`,
      headers: {
        'telnyx-signature': `t=${timestamp},v1=${sigOverSynthesized}`,
        'content-type': 'application/json',
      },
      payload: '',
    });

    expect(res.statusCode).toBe(403);
    expect(
      prodHandle.queries.find((q) => q.text.includes('message_delivery_status'))
    ).toBeUndefined();
  });

  it('HAPPY: a correctly-signed real payload still verifies under the prod parser', async () => {
    // WHO: genuine Telnyx
    // WHAT: HMAC over the exact wire bytes → 200 + upsert
    // WHEN: normal delivery receipt
    // WHERE: signature branch → recordDeliveryStatus
    // WHY: the two SAD tests above would both pass if the route rejected
    //      everything. Prove the prod parser preserves rawBody well enough for
    //      a real receipt to verify end-to-end.
    process.env.TELNYX_WEBHOOK_SECRET = 'whsec_test';
    const timestamp = '1700000000';
    const rawBody =
      '{"data":{"event_type":"message.finalized","payload":{"id":"msg_prod1","to":[{"status":"delivered"}]}}}';
    const sig = createHmac('sha256', 'whsec_test').update(`${timestamp}|${rawBody}`).digest('hex');
    const res = await prodApp.inject({
      method: 'POST',
      url: `/communications/telnyx/status?tenant_id=${TENANT_ID}`,
      headers: {
        'telnyx-signature': `t=${timestamp},v1=${sig}`,
        'content-type': 'application/json',
      },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(200);
    const upsert = prodHandle.queries.find((q) => q.text.includes('message_delivery_status'));
    expect(upsert, 'expected an upsert into message_delivery_status').toBeTruthy();
    expect(upsert!.params).toContain('msg_prod1');
  });
});
