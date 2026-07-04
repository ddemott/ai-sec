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

/**
 * WHO:   GET /export/{customers,appointments,calls}.csv
 * WHAT:  owner downloads a spreadsheet-shaped CSV of one entity
 * WHEN:  bulk operations / reporting (docs/GAPS.md §6, §16)
 * WHERE: src/routes/exportData.ts CSV_EXPORTS + src/services/csv.ts
 * WHY:   must be owner-gated like the JSON dump, tenant-scoped, exclude
 *        soft-deleted rows, and RFC-4180-escape + formula-guard every field
 *        (a caller-supplied name is attacker-controlled spreadsheet input).
 */
describe('GET /export/*.csv', () => {
  it('HAPPY: owner gets a text/csv attachment with escaped, formula-guarded fields', async () => {
    // WHAT: one customer row whose fields exercise comma, quote, newline and
    //       formula-injection escaping end to end through the route.
    handle.queryResponses.push({
      rows: [
        {
          name: 'Smith, Jane',
          first_name: '=SUM(A1)',
          last_name: 'says "hi"',
          phone: '+16305550001',
          email: null,
          address: null,
          city: null,
          state: null,
          postal_code: null,
          timezone: 'America/Chicago',
          notes: 'line1\nline2',
          created_at: new Date('2026-07-04T12:00:00Z'),
        },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/export/customers.csv' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain('customers-');
    const [headerLine] = res.body.split('\r\n');
    expect(headerLine).toBe(
      'name,first_name,last_name,phone,email,address,city,state,postal_code,timezone,notes,created_at'
    );
    // RFC-4180: comma field quoted; formula field neutralized; quotes doubled;
    // newline field quoted; phone (+ prefix) formula-guarded too.
    expect(res.body).toContain('"Smith, Jane"');
    expect(res.body).toContain("'=SUM(A1)");
    expect(res.body).toContain('"says ""hi"""');
    expect(res.body).toContain('"line1\nline2"');
    expect(res.body).toContain("'+16305550001");
    expect(res.body).toContain('2026-07-04T12:00:00.000Z');

    // WHY: tenant scoping — the one data query binds the caller's tenant.
    const dataQueries = handle.queries.filter(
      (q) => !q.text.startsWith('SET LOCAL') && !q.text.startsWith('RESET')
    );
    expect(dataQueries.length).toBe(1);
    expect(dataQueries[0].params[0]).toBe(TENANT_ID);
    // WHY: soft-deleted customers are hidden everywhere else — exports too.
    expect(dataQueries[0].text).toContain('is_deleted = false');
  });

  it('HAPPY: appointments + calls endpoints exist, filter soft-deleted, and return CSV', async () => {
    // WHAT: both remaining exports respond 200 text/csv with their headers
    //       even for an empty tenant (header line only).
    for (const [kind, deletedFilter] of [
      ['appointments', 'is_deleted = false'],
      ['calls', 'is_deleted IS NOT TRUE'],
    ] as const) {
      handle.queries.length = 0;
      handle.queryResponses.push({ rows: [] });

      const res = await app.inject({ method: 'GET', url: `/export/${kind}.csv` });

      expect(res.statusCode, `${kind} export failed: ${res.body}`).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.body.endsWith('\r\n')).toBe(true);
      const dataQueries = handle.queries.filter(
        (q) => !q.text.startsWith('SET LOCAL') && !q.text.startsWith('RESET')
      );
      expect(dataQueries[0].params[0]).toBe(TENANT_ID);
      expect(dataQueries[0].text).toContain(deletedFilter);
    }
    // Column sets are the human-usable contract — pin the headers.
    handle.queryResponses.push({ rows: [] });
    const appt = await app.inject({ method: 'GET', url: '/export/appointments.csv' });
    expect(appt.body.split('\r\n')[0]).toBe(
      'start_time,end_time,status,service,employee,resource,customer,customer_phone,location,created_at'
    );
    handle.queryResponses.push({ rows: [] });
    const calls = await app.inject({ method: 'GET', url: '/export/calls.csv' });
    expect(calls.body.split('\r\n')[0]).toBe(
      'started_at,ended_at,duration_seconds,caller_phone,customer,status,outcome,summary'
    );
  });

  it('SAD: a front-desk user is rejected 403 on every CSV export (JSON error shape)', async () => {
    // WHO: a non-owner login probing the CSV URLs directly.
    // WHY: same bulk-PII rule as the JSON dump — and the failure must come
    //      back as JSON { success:false }, not a half-built CSV.
    handle.auth.current = {
      user_id: '00000000-0000-0000-0000-000000000002',
      tenant_id: TENANT_ID,
      email: 'frontdesk@test.local',
      role: 'front_desk',
    };

    for (const kind of ['customers', 'appointments', 'calls']) {
      const res = await app.inject({ method: 'GET', url: `/export/${kind}.csv` });
      expect(res.statusCode, `${kind} not owner-gated`).toBe(403);
      expect(res.json().success).toBe(false);
    }
    // No data queries ran.
    const dataQueries = handle.queries.filter(
      (q) => !q.text.startsWith('SET LOCAL') && !q.text.startsWith('RESET')
    );
    expect(dataQueries.length).toBe(0);
  });

  it('SAD: an unauthenticated request is rejected 401 (no tenant context)', async () => {
    handle.auth.current = null;

    const res = await app.inject({ method: 'GET', url: '/export/customers.csv' });

    expect(res.statusCode).toBe(401);
  });
});
