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

  it('HAPPY: valid signature (secret set) passes verification and records', async () => {
    // WHO: a genuine Telnyx call with a correct HMAC signature
    // WHAT: v1 == HMAC-SHA256(secret, `${t}|${rawBody}`) → 200 + upsert
    // WHEN: TELNYX_WEBHOOK_SECRET is configured and the signature is honest
    // WHERE: the signature-verification branch (happy side)
    // WHY: real signed receipts must be accepted, not just rejected
    process.env.TELNYX_WEBHOOK_SECRET = 'whsec_test';
    const timestamp = '1700000000';
    // rawBody must equal JSON.stringify(req.body) as the route recomputes it.
    const rawBody = JSON.stringify(validPayload);
    const sig = createHmac('sha256', 'whsec_test').update(`${timestamp}|${rawBody}`).digest('hex');
    const res = await app.inject({
      method: 'POST',
      url: `/communications/telnyx/status?tenant_id=${TENANT_ID}`,
      headers: { 'telnyx-signature': `t=${timestamp},v1=${sig}` },
      payload: validPayload,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(handle.queries.find((q) => q.text.includes('message_delivery_status'))).toBeTruthy();
  });
});
