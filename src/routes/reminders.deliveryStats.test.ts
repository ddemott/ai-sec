/**
 * WHO:   GET /reminders/delivery-stats
 * WHAT:  owner-facing reminder delivery aggregates (sent/failed/scheduled) from
 *        reminder_schedules, tenant-isolated
 * WHEN:  owner opens the Analytics view's reminder delivery monitoring panel
 * WHERE: src/routes/reminders.ts
 * WHY:   reminders fire silently; without this the owner has no visibility into
 *        whether confirmations/24h/2h reminders are actually being delivered.
 *        Must be tenant-scoped (one shop never sees another's delivery numbers).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { registerReminderRoutes } from './reminders';
import { buildRouteTestApp, type RouteTestAppHandle } from '../test-utils-mock';

const TENANT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

let handle: RouteTestAppHandle;
let app: FastifyInstance;

beforeAll(async () => {
  handle = buildRouteTestApp((a, pool, withTenantClient) => {
    registerReminderRoutes(a, pool, withTenantClient);
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
  // Stamp req.tenantId as this tenant (production derives it from JWT + validation).
  handle.tenantIdOverride.current = TENANT_ID;
});

const AUTH = { 'x-tenant-id': TENANT_ID, authorization: 'Bearer test-token' };

describe('GET /reminders/delivery-stats', () => {
  it('HAPPY: returns the tenant-scoped aggregate row', async () => {
    // WHO: owner reviewing whether reminders are landing
    // WHAT: the aggregate SELECT result is returned as-is
    // WHY: the panel renders sent/failed rates from these counts
    const row = {
      sent_total: 42,
      sent_7d: 9,
      sent_30d: 30,
      failed_total: 3,
      failed_7d: 1,
      scheduled: 5,
      cancelled: 2,
    };
    handle.queryResponses.push({ rows: [row], rowCount: 1 });

    const res = await app.inject({
      method: 'GET',
      url: `/reminders/delivery-stats?tenant_id=${TENANT_ID}`,
      headers: AUTH,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject(row);

    // Tenant isolation: the aggregate query is scoped by tenant_id.
    const statsQuery = handle.queries.find((q) => /FROM reminder_schedules/i.test(q.text));
    expect(statsQuery, 'delivery-stats must query reminder_schedules').toBeTruthy();
    expect(statsQuery!.text).toMatch(/WHERE\s+tenant_id\s*=\s*\$1/i);
    expect(statsQuery!.params[0]).toBe(TENANT_ID);
  });

  it('SAD: returns zeros when the tenant has no reminders', async () => {
    // WHAT: an empty result set yields a zeroed payload, not a 500
    // WHY: a brand-new tenant with no reminders must still render the panel cleanly
    handle.queryResponses.push({ rows: [], rowCount: 0 });

    const res = await app.inject({
      method: 'GET',
      url: `/reminders/delivery-stats?tenant_id=${TENANT_ID}`,
      headers: AUTH,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      sent_total: 0,
      failed_total: 0,
      scheduled: 0,
      cancelled: 0,
    });
  });
});
