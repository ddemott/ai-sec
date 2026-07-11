/**
 * WHO:   GET /audit-log
 * WHAT:  owner-only, paginated, tenant-scoped read of the audit_log table
 * WHEN:  owner asks "who changed this booking, and when?"
 * WHERE: src/routes/auditLog.ts
 * WHY:   change history can expose old/new PII field values, so it must be
 *        owner-gated and tenant-scoped. These tests pin the gate, the scoping,
 *        the table_name filter validation, and the pagination wiring.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { registerAuditLogRoutes } from '../../src/routes/auditLog';
import { buildRouteTestApp, type RouteTestAppHandle } from '../mock';

const TENANT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

let handle: RouteTestAppHandle;
let app: FastifyInstance;

beforeAll(async () => {
  handle = buildRouteTestApp((a, pool, withTenantClient) => {
    registerAuditLogRoutes(a, pool, withTenantClient);
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
  vi.clearAllMocks();
});

const dataQueries = () =>
  handle.queries.filter((q) => !q.text.startsWith('SET LOCAL') && !q.text.startsWith('RESET'));

describe('GET /audit-log', () => {
  it('HAPPY: owner gets tenant-scoped entries, newest first, with pagination defaults', async () => {
    handle.queryResponses.push({
      rows: [
        {
          audit_log_id: 'a1',
          table_name: 'appointments',
          record_id: 'appt-1',
          action: 'UPDATE',
          created_at: '2026-06-20T10:00:00Z',
        },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/audit-log' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.entries).toHaveLength(1);
    expect(body.count).toBe(1);
    expect(body.limit).toBe(100); // default
    expect(body.offset).toBe(0);

    const q = dataQueries()[0];
    expect(q.params[0]).toBe(TENANT_ID); // tenant scoping
    expect(q.text).toContain('FROM audit_log');
    expect(q.text).toContain('ORDER BY created_at DESC');
  });

  it('HAPPY: a valid table_name filter is applied as a bound parameter', async () => {
    handle.queryResponses.push({ rows: [] });

    const res = await app.inject({
      method: 'GET',
      url: '/audit-log?table_name=customers&limit=25&offset=50',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.limit).toBe(25);
    expect(body.offset).toBe(50);

    const q = dataQueries()[0];
    expect(q.text).toContain('table_name =');
    // params: [tenant, 'customers', limit, offset]
    expect(q.params).toContain('customers');
    expect(q.params).toContain(25);
    expect(q.params).toContain(50);
  });

  it('SAD: an un-audited table_name is rejected 400 before any query', async () => {
    // WHY: only the audited tables are valid; anything else is a typo or a probe
    //       — reject it, do not run a query. `users` is not audited.
    const res = await app.inject({ method: 'GET', url: '/audit-log?table_name=users' });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Invalid table_name');
    expect(dataQueries().length).toBe(0);
  });

  it('HAPPY: services + employees are now accepted filters (audit trail extended)', async () => {
    // WHY: 2026-06-22 extended fn_audit_trigger to services + employees so owners
    //       get a change history for prices/staff — both must pass the filter.
    for (const table of ['services', 'employees']) {
      handle.queryResponses.push({ rows: [] });
      const res = await app.inject({ method: 'GET', url: `/audit-log?table_name=${table}` });
      expect(res.statusCode, `${table} should be an accepted filter`).toBe(200);
      const q = dataQueries().slice(-1)[0];
      expect(q.text).toContain('table_name =');
      expect(q.params).toContain(table);
    }
  });

  it('SAD: a front-desk user is rejected 403 (no PII change-history access)', async () => {
    handle.auth.current = {
      user_id: '00000000-0000-0000-0000-000000000002',
      tenant_id: TENANT_ID,
      email: 'frontdesk@test.local',
      role: 'front_desk',
    };

    const res = await app.inject({ method: 'GET', url: '/audit-log' });

    expect(res.statusCode).toBe(403);
    expect(res.json().success).toBe(false);
    expect(dataQueries().length).toBe(0);
  });

  it('SAD: an unauthenticated request is rejected', async () => {
    handle.auth.current = null;

    const res = await app.inject({ method: 'GET', url: '/audit-log' });

    expect(res.statusCode).toBe(401);
  });

  it('HAPPY: limit is clamped to the 500 max', async () => {
    // WHY: an owner can't ask for an unbounded dump that pins a pool slot.
    handle.queryResponses.push({ rows: [] });

    const res = await app.inject({ method: 'GET', url: '/audit-log?limit=99999' });

    expect(res.statusCode).toBe(200);
    expect(res.json().limit).toBe(500);
  });
});
