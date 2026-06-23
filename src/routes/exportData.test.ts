/**
 * WHO:   GET /export/tenant-data
 * WHAT:  owner downloads a JSON dump of all their tenant's data (portability)
 * WHEN:  GDPR Art. 20 / CCPA access request, or owner self-service export
 * WHERE: src/routes/exportData.ts
 * WHY:   the export must (a) be owner-gated — front-desk can't bulk-export PII,
 *        (b) scope every query to the caller's tenant, and (c) never leak the
 *        users.password_hash column. These tests pin all three.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { registerExportRoutes } from './exportData';
import { buildRouteTestApp, type RouteTestAppHandle } from '../test-utils-mock';

const TENANT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

let handle: RouteTestAppHandle;
let app: FastifyInstance;

beforeAll(async () => {
  handle = buildRouteTestApp((a, pool, withTenantClient) => {
    registerExportRoutes(a, pool, withTenantClient);
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

describe('GET /export/tenant-data', () => {
  it('HAPPY: owner gets a tenant-scoped JSON export with per-table counts', async () => {
    // WHAT: every table query is answered; the response groups rows by table
    //        and reports record_counts + total_records
    // The handler runs one users query then one per EXPORT_TABLE; give every
    // query a stable answer (one row) so we can assert the envelope shape.
    handle.queryResponses.push({ rows: [{ user_id: 'u1', email: 'o@x.com', role: 'owner' }] }); // users
    // Remaining table queries each return a single row.
    for (let i = 0; i < 30; i++) {
      handle.queryResponses.push({ rows: [{ tenant_id: TENANT_ID }] });
    }

    const res = await app.inject({ method: 'GET', url: '/export/tenant-data' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.tenant_id).toBe(TENANT_ID);
    expect(typeof body.generated_at).toBe('string');
    // Core tables present in the export.
    expect(body.tables.customers).toBeDefined();
    expect(body.tables.appointments).toBeDefined();
    expect(body.tables.users).toBeDefined();
    expect(body.record_counts.customers).toBe(1);
    expect(body.total_records).toBeGreaterThan(0);
    // WHY: download affordance — the route sets a JSON attachment header.
    expect(res.headers['content-disposition']).toContain('attachment');

    // WHY: every data query must be tenant-scoped — the first param is the
    //       tenant id on each non-transaction query.
    const dataQueries = handle.queries.filter(
      (q) => !q.text.startsWith('SET LOCAL') && !q.text.startsWith('RESET')
    );
    expect(dataQueries.length).toBeGreaterThan(0);
    for (const q of dataQueries) {
      expect(q.params[0]).toBe(TENANT_ID);
    }
  });

  it('SECURITY: the users export selects safe columns only — never password_hash', async () => {
    // WHY: a portability dump must not hand the owner every staff member's
    //       bcrypt hash. The users query is column-restricted by construction.
    handle.queryResponses.push({ rows: [{ user_id: 'u1', email: 'o@x.com', role: 'owner' }] });
    for (let i = 0; i < 30; i++) {
      handle.queryResponses.push({ rows: [] });
    }

    await app.inject({ method: 'GET', url: '/export/tenant-data' });

    const usersQuery = handle.queries.find((q) => /FROM users/i.test(q.text));
    expect(usersQuery).toBeDefined();
    expect(usersQuery!.text).not.toMatch(/password_hash/i);
    expect(usersQuery!.text).not.toMatch(/SELECT \*/i);
  });

  it('SAD: a front-desk user is rejected 403 (no bulk PII export)', async () => {
    // WHO: a non-owner login hitting the export URL directly
    // WHAT: 403 before any data query runs
    handle.auth.current = {
      user_id: '00000000-0000-0000-0000-000000000002',
      tenant_id: TENANT_ID,
      email: 'frontdesk@test.local',
      role: 'front_desk',
    };

    const res = await app.inject({ method: 'GET', url: '/export/tenant-data' });

    expect(res.statusCode).toBe(403);
    expect(res.json().success).toBe(false);
    // No data queries should have run.
    const dataQueries = handle.queries.filter(
      (q) => !q.text.startsWith('SET LOCAL') && !q.text.startsWith('RESET')
    );
    expect(dataQueries.length).toBe(0);
  });

  it('SAD: an unauthenticated request is rejected (no tenant context)', async () => {
    // WHAT: requireTenantId short-circuits with 401 when there's no auth
    handle.auth.current = null;

    const res = await app.inject({ method: 'GET', url: '/export/tenant-data' });

    expect(res.statusCode).toBe(401);
  });
});
