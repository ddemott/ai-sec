/**
 * Real-Postgres companion suite for GET /audit-log (per docs/TODO.md "Verification blind spots").
 *
 * The existing src/routes/auditLog.test.ts mocks pg, so it can only assert the
 * SQL *text* the route builds — a wrong dynamic parameter index ($n off by one
 * after a conditional push), a broken `$n::date` cast, a bad
 * `interval '1 day'` end-bound, or an ambiguous column would still ship green.
 * This suite executes the dynamically-built statements (auditLog.ts:51-89)
 * against the real test DB (localhost:5433/test_db) via the real
 * `createWithTenantClient`, so parameter binding, RLS scoping, casts, ordering,
 * and LIMIT/OFFSET indices are proven end-to-end.
 *
 * Fixture strategy: this suite owns exactly two tenants it creates itself and
 * deletes in afterAll (audit_log rows cascade with the tenant). It NEVER
 * truncates — other suites share this DB. Synthetic audit rows are inserted
 * with fixed UTC timestamps (test DB runs Etc/UTC) so date-range expectations
 * are deterministic; one test additionally drives the real fn_audit_trigger
 * (UPDATE on services) to prove trigger→route integration.
 *
 * 5W for sad-path failures (suite-wide):
 *   WHO  — a business owner on the dashboard's Setup → Audit Log view
 *   WHAT — GET /audit-log with optional table_name / start_date / end_date /
 *          limit / offset query params
 *   WHEN — investigating "who changed this booking / price / staff member?"
 *   WHERE — src/routes/auditLog.ts dynamic WHERE builder → audit_log table
 *   WHY  — a mis-indexed parameter silently returns wrong history (or another
 *          filter's value lands in LIMIT), destroying trust in the audit trail
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { type Client, Pool } from 'pg';
import {
  API_DB_URL,
  getRootClient,
  createTenant,
  createService,
  skipIfDbDown,
} from '../test-utils';
import { createWithTenantClient } from '../database';
import { registerAuditLogRoutes } from './auditLog';

interface TestAuth {
  user_id: string;
  tenant_id: string;
  email: string;
  role: string;
}

interface AuditEntry {
  audit_log_id: string;
  tenant_id: string;
  table_name: string;
  record_id: string;
  action: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  changed_by: string | null;
  created_at: string;
}

let setup: Client;
let pool: Pool;
let app: FastifyInstance;
let dbAvailable = false;
let tenantId: string; // "my" tenant — the one the injected owner belongs to
let otherTenantId: string; // foreign tenant — its rows must NEVER leak through
let serviceId: string; // real services row for the trigger→route test
const tenantsToClean: string[] = [];

// Mutable auth/tenant stamps, mirroring buildRouteTestApp (test-utils-mock.ts):
// the production preHandler chain (registerJwtAuthHook → tenantMiddleware) is
// pinned by src/middleware.test.ts + multi-tenant-isolation.test.ts; here we
// stamp req.auth/req.tenantId directly so the suite stays focused on the
// route's SQL against the real DB.
const auth: { current: TestAuth | null } = { current: null };
const stampedTenantId: { current: string | undefined } = { current: undefined };

function asOwner() {
  auth.current = {
    user_id: '00000000-0000-0000-0000-00000000aa01',
    tenant_id: tenantId,
    email: 'owner@auditlog-realdb.local',
    role: 'owner',
  };
  stampedTenantId.current = tenantId;
}

function get(url: string) {
  return app.inject({ method: 'GET', url });
}

/** record_ids of a response's entries, in returned (newest-first) order. */
function recordIds(res: { json: () => { entries: AuditEntry[] } }): string[] {
  return res.json().entries.map((e) => e.record_id);
}

/**
 * Synthetic fixture rows for "my" tenant, inserted with pinned UTC timestamps.
 * Newest-first (the route's ORDER BY created_at DESC) they are:
 *   svc-s1 (03-20) > cust-c2 (03-11) > cust-c1 (03-10)
 *     > appt-a3 (03-03) > appt-a2 (03-02 23:30 — late-evening on purpose,
 *       to pin the end-date-inclusive `< $n::date + interval '1 day'` bound)
 *     > appt-a1 (03-01)
 */
const FIXTURES: Array<{ record_id: string; table_name: string; action: string; at: string }> = [
  {
    record_id: 'appt-a1',
    table_name: 'appointments',
    action: 'INSERT',
    at: '2026-03-01T12:00:00Z',
  },
  {
    record_id: 'appt-a2',
    table_name: 'appointments',
    action: 'UPDATE',
    at: '2026-03-02T23:30:00Z',
  },
  {
    record_id: 'appt-a3',
    table_name: 'appointments',
    action: 'DELETE',
    at: '2026-03-03T12:00:00Z',
  },
  { record_id: 'cust-c1', table_name: 'customers', action: 'INSERT', at: '2026-03-10T12:00:00Z' },
  { record_id: 'cust-c2', table_name: 'customers', action: 'UPDATE', at: '2026-03-11T12:00:00Z' },
  { record_id: 'svc-s1', table_name: 'services', action: 'UPDATE', at: '2026-03-20T12:00:00Z' },
];
const ALL_DESC = ['svc-s1', 'cust-c2', 'cust-c1', 'appt-a3', 'appt-a2', 'appt-a1'];

beforeAll(async () => {
  try {
    setup = await getRootClient();
    await setup.query('SELECT 1');
    pool = new Pool({ connectionString: API_DB_URL, max: 5 });

    app = Fastify({ logger: false });
    app.addHook('preHandler', async (request) => {
      const stamped = request as unknown as { auth: TestAuth | null; tenantId?: string };
      stamped.auth = auth.current;
      stamped.tenantId = stampedTenantId.current;
    });
    // Match src/index.ts error-handler shape (AppError / TENANT_NOT_FOUND paths).
    app.setErrorHandler(async (error: Error & { statusCode?: number }, _request, reply) =>
      reply
        .status(error.statusCode || 500)
        .send({ success: false, error: error.message || 'Internal server error' })
    );
    const withTenantClient = createWithTenantClient(pool);
    registerAuditLogRoutes(app, pool, withTenantClient);
    await app.ready();

    tenantId = await createTenant(setup, 'AuditLog RealDB Tenant', 'salon');
    tenantsToClean.push(tenantId);
    otherTenantId = await createTenant(setup, 'AuditLog RealDB OTHER Tenant', 'salon');
    tenantsToClean.push(otherTenantId);

    // Real services row for the trigger→route test. Creating it fires
    // trg_audit_services (INSERT), so wipe MY tenant's audit rows afterwards
    // to start from a known-empty slate before seeding the synthetic set.
    serviceId = await createService(setup, tenantId, 'Audit Trail Haircut', 30, 45);
    await setup.query('DELETE FROM audit_log WHERE tenant_id = $1', [tenantId]);

    for (const f of FIXTURES) {
      await setup.query(
        `INSERT INTO audit_log (tenant_id, table_name, record_id, action, old_data, new_data, created_at)
         VALUES ($1, $2, $3, $4, '{"seed": "old"}', '{"seed": "new"}', $5::timestamptz)`,
        [tenantId, f.table_name, f.record_id, f.action, f.at]
      );
    }
    // Foreign tenant's row sits inside my date range and table filter — the
    // only thing keeping it out of my responses is tenant scoping (RLS + $1).
    await setup.query(
      `INSERT INTO audit_log (tenant_id, table_name, record_id, action, created_at)
       VALUES ($1, 'appointments', 'appt-FOREIGN', 'INSERT', '2026-03-02T12:00:00Z'::timestamptz)`,
      [otherTenantId]
    );

    dbAvailable = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[auditLog.realdb.test] DB not available, skipping', err);
  }
});

afterAll(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
  if (setup) {
    // Own tenants only — audit_log rows cascade via the tenant FK. Never TRUNCATE.
    for (const id of tenantsToClean) {
      await setup.query('DELETE FROM tenants WHERE tenant_id = $1', [id]).catch(() => {});
    }
    await setup.end();
  }
});

beforeEach((ctx) => {
  skipIfDbDown(ctx, () => dbAvailable);
  if (!dbAvailable) return;
  asOwner();
});

describe('GET /audit-log — dynamic WHERE against real Postgres', () => {
  it('HAPPY: no filters → all of MY rows, newest first, none from the other tenant', async () => {
    // WHO: an owner opening the Audit Log view with no filters set.
    // WHAT: bare GET /audit-log — the minimal params array [tenant, limit, offset].
    // WHEN: first page load, pagination defaults (limit 100, offset 0).
    // WHERE: auditLog.ts:51 `conditions = ['tenant_id = $1']` + LIMIT $2 OFFSET $3.
    // WHY: with no optional filters pushed, limit MUST bind at $2 — a mocked
    //      test can't prove Postgres accepts these indices; this one does. And
    //      the foreign tenant's row leaking here would be a cross-tenant breach.
    const res = await get('/audit-log');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.limit).toBe(100);
    expect(body.offset).toBe(0);
    expect(body.count).toBe(6);
    expect(recordIds(res)).toEqual(ALL_DESC); // ORDER BY created_at DESC, exactly
    expect(recordIds(res)).not.toContain('appt-FOREIGN');
    // Row shape: every SELECTed column round-trips.
    const entry = body.entries[0] as AuditEntry;
    expect(entry.tenant_id).toBe(tenantId);
    expect(entry.table_name).toBe('services');
    expect(entry.old_data).toEqual({ seed: 'old' });
    expect(entry.new_data).toEqual({ seed: 'new' });
    expect(entry.audit_log_id).toBeTruthy();
  });

  it('HAPPY: table_name filter alone binds at $2 and returns only that table', async () => {
    // WHO: an owner asking "what changed on my customers?".
    // WHAT: ?table_name=customers → params [tenant, 'customers', limit, offset].
    // WHEN: filter set, no dates — table_name is $2, limit shifts to $3.
    // WHERE: auditLog.ts:62-63 conditions.push(`table_name = $${params.length}`).
    // WHY: if the index were computed wrong, Postgres would either error or
    //      compare table_name against the tenant UUID and return zero rows.
    const res = await get('/audit-log?table_name=customers');
    expect(res.statusCode).toBe(200);
    expect(recordIds(res)).toEqual(['cust-c2', 'cust-c1']);
  });

  it('HAPPY: start_date alone applies the `>= $2::date` cast', async () => {
    // WHO: an owner narrowing history to "since March 10".
    // WHAT: ?start_date=2026-03-10 → created_at >= $2::date, real cast executed.
    // WHEN: date filter without table filter — start_date lands at $2.
    // WHERE: auditLog.ts:70-71.
    // WHY: `$2::date` compared against timestamptz is exactly the kind of
    //      cast a pg mock can't validate; a bad cast is a runtime SQL error.
    const res = await get('/audit-log?start_date=2026-03-10');
    expect(res.statusCode).toBe(200);
    expect(recordIds(res)).toEqual(['svc-s1', 'cust-c2', 'cust-c1']);
  });

  it("HAPPY: end_date is day-INCLUSIVE via `< $n::date + interval '1 day'`", async () => {
    // WHO: an owner selecting the range Mar 1 – Mar 2.
    // WHAT: ?start_date=2026-03-01&end_date=2026-03-02.
    // WHEN: appt-a2 happened at 23:30 UTC ON the end day — the deliberately
    //       hostile case for an exclusive `< end_date` bound.
    // WHERE: auditLog.ts:72-76 next-midnight comparison.
    // WHY: if the interval-'1 day' arithmetic regressed to `< $n::date`,
    //      late-evening events on the chosen end day would silently vanish
    //      from the owner's investigation window.
    const res = await get('/audit-log?start_date=2026-03-01&end_date=2026-03-02');
    expect(res.statusCode).toBe(200);
    expect(recordIds(res)).toEqual(['appt-a2', 'appt-a1']); // 23:30 on end day included
  });

  it('HAPPY: all filters combined — max param count, indices $2..$6 all correct', async () => {
    // WHO: an owner drilling into appointment changes over a specific window.
    // WHAT: table_name + start_date + end_date + limit + offset simultaneously
    //       → params [tenant $1, table $2, start $3, end $4, limit $5, offset $6].
    // WHEN: every conditional push has fired — the longest dynamic params array.
    // WHERE: auditLog.ts:62-82 (conditions.join(' AND ') with all branches taken).
    // WHY: THE param-index stress test. Any off-by-one (e.g. limit bound where
    //      end_date belongs) either errors or returns garbage; only a real DB
    //      run can tell the difference.
    const res = await get(
      '/audit-log?table_name=appointments&start_date=2026-03-02&end_date=2026-03-20&limit=10&offset=0'
    );
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(0);
    // appt-a1 excluded by start_date; customers/services rows excluded by table.
    expect(recordIds(res)).toEqual(['appt-a3', 'appt-a2']);
  });

  it('HAPPY: pagination — page 2 returns the NEXT rows, disjoint from page 1', async () => {
    // WHO: an owner clicking "next page" on a long history.
    // WHAT: limit=2&offset=0 then limit=2&offset=2 over the same 6-row set.
    // WHEN: no filters → limit/offset are $2/$3; both pages must slice the
    //       same DESC ordering without overlap or gaps.
    // WHERE: auditLog.ts:79-82 dynamic limitIdx/offsetIdx.
    // WHY: if offset bound into LIMIT's slot (classic index swap), page 2
    //      would repeat page 1 (offset ignored) or return 2 extra rows —
    //      the mocked suite literally cannot detect either.
    const page1 = await get('/audit-log?limit=2&offset=0');
    const page2 = await get('/audit-log?limit=2&offset=2');
    expect(page1.statusCode).toBe(200);
    expect(page2.statusCode).toBe(200);
    expect(recordIds(page1)).toEqual(['svc-s1', 'cust-c2']);
    expect(recordIds(page2)).toEqual(['cust-c1', 'appt-a3']);
    expect(recordIds(page2)).not.toEqual(expect.arrayContaining(recordIds(page1)));
  });

  it('HAPPY: pagination indices still line up AFTER a filter shifts them ($3/$4)', async () => {
    // WHO: an owner paging through appointment-only history.
    // WHAT: ?table_name=appointments&limit=1&offset=1 → params
    //       [tenant $1, table $2, limit $3, offset $4].
    // WHEN: one conditional filter pushed — limit/offset indices have shifted
    //       by exactly one relative to the unfiltered query.
    // WHERE: auditLog.ts:79-82 — limitIdx/offsetIdx computed from params.length.
    // WHY: hard-coded `LIMIT $2` style indices pass the no-filter test and
    //      break only here; the middle appointment (appt-a2) is the proof.
    const res = await get('/audit-log?table_name=appointments&limit=1&offset=1');
    expect(res.statusCode).toBe(200);
    expect(recordIds(res)).toEqual(['appt-a2']); // 2nd-newest appointments row
  });

  it('HAPPY: a real fn_audit_trigger UPDATE on services surfaces through the route', async () => {
    // WHO: an owner who just changed a service price/name on the dashboard.
    // WHAT: real UPDATE on services fires trg_audit_services (SECURITY DEFINER)
    //       → audit_log row → visible via GET /audit-log?table_name=services.
    // WHEN: immediately after the edit (created_at = now(), so filter from today).
    // WHERE: fn_audit_trigger (migration 20260622000000) → auditLog.ts SELECT.
    // WHY: proves the trigger's column shape (record_id = service_id as text,
    //      action UPDATE, old/new jsonb) matches what the route SELECTs —
    //      producer/consumer drift here is invisible to both mocked suites.
    await setup.query(`UPDATE services SET name = 'Audit Trail Haircut v2' WHERE service_id = $1`, [
      serviceId,
    ]);
    const today = new Date().toISOString().split('T')[0];
    try {
      const res = await get(`/audit-log?table_name=services&start_date=${today}`);
      expect(res.statusCode).toBe(200);
      const entries = res.json().entries as AuditEntry[];
      const triggered = entries.find((e) => e.record_id === serviceId);
      expect(triggered).toBeDefined();
      expect(triggered?.action).toBe('UPDATE');
      expect(triggered?.old_data?.name).toBe('Audit Trail Haircut');
      expect(triggered?.new_data?.name).toBe('Audit Trail Haircut v2');
    } finally {
      // Remove the trigger-generated row so the synthetic 6-row fixture
      // invariant holds for any test that runs after this one.
      await setup.query('DELETE FROM audit_log WHERE tenant_id = $1 AND record_id = $2', [
        tenantId,
        serviceId,
      ]);
    }
  });

  it('SAD: un-audited table_name is rejected 400 by the allowlist, no SQL run', async () => {
    // WHO: a typo ("user" vs "users") or a probing client.
    // WHAT: ?table_name=users — not in AUDITED_TABLES.
    // WHEN: before any params are pushed beyond tenant_id.
    // WHERE: auditLog.ts:56-61 allowlist check.
    // WHY: the filter value is interpolated as a bound param (safe), but the
    //      allowlist is still the contract — reject loudly, don't return [].
    const res = await get('/audit-log?table_name=users');
    expect(res.statusCode).toBe(400);
    expect(res.json().success).toBe(false);
    expect(res.json().error).toContain('Invalid table_name');
  });

  it('SAD: malformed start_date degrades gracefully (defaults to today, 200 + empty)', async () => {
    // WHO: a hand-edited URL or a client sending US-format dates.
    // WHAT: ?start_date=03/02/2026 fails routeHelpers' DATE_RE → parseDateRange
    //       substitutes today's date; the query still executes with a VALID
    //       `$2::date` bind (an unguarded raw value would be a 22007 SQL error).
    // WHEN: today (2026-07) is far past all March fixtures → zero rows.
    // WHERE: routeHelpers.parseDateRange → auditLog.ts:68-71.
    // WHY: garbage input must never 500 or crash the ::date cast mid-query.
    const res = await get('/audit-log?start_date=03/02/2026');
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(res.json().entries).toEqual([]);
  });

  it('SAD: garbage limit/offset fall back to defaults instead of breaking the SQL', async () => {
    // WHO: a fuzzer or broken pagination widget.
    // WHAT: ?limit=abc&offset=-5 — parsePagination coerces to 100 / 0, so the
    //       LIMIT/OFFSET binds stay integers (raw 'abc' would be a bind error).
    // WHEN: any request with non-numeric paging params.
    // WHERE: routeHelpers.parsePagination → auditLog.ts:48,79-82.
    // WHY: paging garbage must degrade to page 1, never to a 500.
    const res = await get('/audit-log?limit=abc&offset=-5');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.limit).toBe(100);
    expect(body.offset).toBe(0);
    expect(body.count).toBe(6);
  });

  it('SAD: unauthenticated request is 401 before any query', async () => {
    // WHO: an anonymous caller with no JWT.
    // WHAT: no auth + no middleware-derived tenantId → requireTenantId 401s.
    // WHEN: expired/absent session.
    // WHERE: middleware.requireTenantId via auditLog.ts:36-37.
    // WHY: audit history is PII-bearing; the gate must hold on the real wiring.
    auth.current = null;
    stampedTenantId.current = undefined;
    const res = await get('/audit-log');
    expect(res.statusCode).toBe(401);
    expect(res.json().success).toBe(false);
  });

  it('SAD: front-desk role is 403 — change history is owner-only', async () => {
    // WHO: a front-desk login on the same tenant.
    // WHAT: authenticated but role !== 'owner' (and not the super-admin tenant).
    // WHEN: a stale bookmark or manual URL to the audit view.
    // WHERE: auditLog.ts:41-45 owner gate.
    // WHY: old_data/new_data can expose customer PII field values.
    auth.current = {
      user_id: '00000000-0000-0000-0000-00000000aa02',
      tenant_id: tenantId,
      email: 'frontdesk@auditlog-realdb.local',
      role: 'front_desk',
    };
    const res = await get('/audit-log');
    expect(res.statusCode).toBe(403);
    expect(res.json().success).toBe(false);
  });
});
