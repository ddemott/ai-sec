/**
 * Route-handler tests for GET /communications/history in src/routes/communications.ts.
 *
 * The endpoint was previously a hardcoded empty stub ("not yet implemented").
 * It now reads the communications_history table, tenant-scoped, paginated, with
 * an optional channel filter (?type=email|sms|all). These tests pin the SQL
 * contract, pagination/validation behaviour, and the response envelope using the
 * mock-pool route harness (the RLS + real-column-shape path is covered against
 * the live test_db in services/communications/communicationHistory.test.ts).
 *
 * 5W context for sad-path failures:
 *   WHO   — a dashboard/owner loading the communications history feed
 *   WHAT  — GET /communications/history returning the tenant's sent log
 *   WHEN  — every load of the (future) communications history surface
 *   WHERE — registerCommunicationRoutes GET /communications/history handler
 *   WHY   — a stale stub silently returned [] forever; a broken query or a
 *           dropped tenant filter would either leak or hide real send history
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { registerCommunicationRoutes } from './communications';
import { buildRouteTestApp, type RouteTestAppHandle } from '../test-utils-mock';

const TENANT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

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
