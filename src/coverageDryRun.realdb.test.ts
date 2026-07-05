/**
 * Real-DB coverage for POST /coverage/dry-run (setup-wizard Phase B).
 *
 * The endpoint previews coverage for a DRAFT graph (services/employees/shifts/
 * mappings that aren't in the DB yet) by inserting them inside a transaction,
 * running the REAL check_coverage_gaps RPC, and ALWAYS rolling back. The two
 * load-bearing properties this suite pins:
 *   (1) coverage is actually computed over the draft (shifts → open hours), and
 *   (2) NOTHING is persisted — the rollback is the whole point (a preview that
 *       silently created rows would corrupt onboarding).
 *
 * Fixtures: one empty tenant created in beforeAll, removed in afterAll. Each
 * dry-run leaves the tenant empty (that's the property under test), so cleanup
 * is a plain tenant delete.
 *
 * WHO: an owner mid-wizard on the coverage step | WHAT: preview gaps pre-commit
 * WHEN: Phase B draft-commit flow | WHERE: src/routes/analytics.ts /coverage/dry-run
 * WHY: single source of truth (real RPC) without persisting a half-built setup.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Pool, type Client } from 'pg';
import { API_DB_URL, getRootClient, createTenant, skipIfDbDown } from './test-utils';
import { createWithTenantClient } from './database';
import { registerAnalyticsRoutes } from './routes/analytics';

let setup: Client;
let pool: Pool;
let app: FastifyInstance;
let dbAvailable = false;
let tenantId: string;
const tenantsToClean: string[] = [];

function post(url: string, body: unknown, tenant: string | false = tenantId) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (tenant) headers['x-tenant-id'] = tenant;
  return app.inject({ method: 'POST', url, headers, payload: body as object });
}

async function tenantCounts(t: string) {
  const { rows } = await setup.query(
    `SELECT
       (SELECT count(*) FROM services WHERE tenant_id = $1)          AS services,
       (SELECT count(*) FROM employees WHERE tenant_id = $1)         AS employees,
       (SELECT count(*) FROM resources WHERE tenant_id = $1)         AS resources,
       (SELECT count(*) FROM employee_schedule WHERE tenant_id = $1) AS schedule,
       (SELECT count(*) FROM service_employee WHERE tenant_id = $1)  AS service_employee,
       (SELECT count(*) FROM service_resource WHERE tenant_id = $1)  AS service_resource`,
    [t]
  );
  const r = rows[0] as Record<string, string>;
  return {
    services: Number(r.services),
    employees: Number(r.employees),
    resources: Number(r.resources),
    schedule: Number(r.schedule),
    service_employee: Number(r.service_employee),
    service_resource: Number(r.service_resource),
  };
}

const EVERY_WEEKDAY = [0, 1, 2, 3, 4, 5, 6];

beforeAll(async () => {
  try {
    setup = await getRootClient();
    await setup.query('SELECT 1');
    dbAvailable = true;
  } catch {
    return; // DB down → beforeEach skips every test
  }
  pool = new Pool({ connectionString: API_DB_URL, max: 5 });
  app = Fastify({ logger: false });
  type TenantRequest = FastifyRequest & { tenantId?: string; auth?: { user_id: string } };
  app.addHook('preHandler', async (request: TenantRequest) => {
    const h = request.headers['x-tenant-id'];
    if (typeof h === 'string' && h) {
      request.tenantId = h;
      request.auth = { user_id: '00000000-0000-0000-0000-000000000001' };
    }
  });
  registerAnalyticsRoutes(app, pool, createWithTenantClient(pool));
  await app.ready();

  tenantId = await createTenant(setup, 'Coverage DryRun Tenant', 'salon', 'Etc/UTC');
  tenantsToClean.push(tenantId);
});

afterAll(async () => {
  if (!dbAvailable) return;
  for (const t of tenantsToClean) {
    await setup.query('DELETE FROM tenants WHERE tenant_id = $1', [t]).catch(() => undefined);
  }
  await app?.close();
  await pool?.end();
  await setup?.end();
});

beforeEach((ctx) => {
  skipIfDbDown(ctx, () => dbAvailable);
});

describe('POST /coverage/dry-run', () => {
  it('SAD: rejects a malformed draft (missing services) with 400 and writes nothing', async () => {
    const before = await tenantCounts(tenantId);
    const res = await post('/coverage/dry-run', { resources: [] });
    expect(res.statusCode).toBe(400);
    expect(res.json().success).toBe(false);
    expect(await tenantCounts(tenantId)).toEqual(before);
  });

  it('SAD: no tenant header → 401 (never runs the RPC anonymously) and writes nothing', async () => {
    const before = await tenantCounts(tenantId);
    const res = await post('/coverage/dry-run', { services: [] }, false);
    expect(res.statusCode).toBe(401);
    expect(await tenantCounts(tenantId)).toEqual(before);
  });

  it('SAD: a shift referencing an unknown employee tmp_id → 400', async () => {
    const res = await post('/coverage/dry-run', {
      services: [{ tmp_id: 's1', name: 'X', duration_minutes: 30 }],
      employees: [],
      shifts: [
        { employee_tmp_id: 'ghost', day_of_week: 1, start_time: '09:00', end_time: '17:00' },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/unknown tmp_ids/i);
  });

  it('HAPPY: computes coverage over the draft (shifts → open hours) AND persists nothing', async () => {
    // Delta-based: whatever the tenant has now, a dry-run must not change it.
    const before = await tenantCounts(tenantId);

    const draft = {
      services: [{ tmp_id: 's1', name: 'Signature Cut', duration_minutes: 30 }],
      resources: [{ tmp_id: 'r1', name: 'Chair 1' }],
      employees: [{ tmp_id: 'e1', name: 'Tess Stylist' }],
      // Staff every weekday 09:00–17:00 so the service is covered every day in
      // the default 4-week window.
      shifts: EVERY_WEEKDAY.map((d) => ({
        employee_tmp_id: 'e1',
        day_of_week: d,
        start_time: '09:00',
        end_time: '17:00',
      })),
      service_employee: [{ service_tmp_id: 's1', employee_tmp_id: 'e1' }],
      service_resource: [{ service_tmp_id: 's1', resource_tmp_id: 'r1' }],
    };

    const res = await post('/coverage/dry-run', draft);
    expect(res.statusCode).toBe(200);
    const rows = res.json<Array<{ service_name: string; total_open_hours?: number }>>();
    expect(Array.isArray(rows)).toBe(true);
    const covered = rows.filter((r) => r.service_name === 'Signature Cut');
    expect(covered.length).toBeGreaterThan(0);
    // The shifts were seen: at least one day reports open (staffed) hours.
    expect(covered.some((r) => Number(r.total_open_hours ?? 0) > 0)).toBe(true);

    // The whole point: the draft was rolled back — the tenant is still empty.
    const after = await tenantCounts(tenantId);
    expect(after).toEqual(before);
  });

  it('reflects a gap: a service whose only employee has no shifts has no open hours', async () => {
    const draft = {
      services: [{ tmp_id: 's1', name: 'Uncovered Service', duration_minutes: 30 }],
      employees: [{ tmp_id: 'e1', name: 'Idle Emp' }],
      shifts: [], // nobody scheduled
      service_employee: [{ service_tmp_id: 's1', employee_tmp_id: 'e1' }],
    };
    const before = await tenantCounts(tenantId);
    const res = await post('/coverage/dry-run', draft);
    expect(res.statusCode).toBe(200);
    const rows = res.json<Array<{ service_name: string; total_open_hours?: number }>>();
    const svc = rows.filter((r) => r.service_name === 'Uncovered Service');
    // No scheduled hours → no open coverage on any returned row.
    expect(svc.every((r) => Number(r.total_open_hours ?? 0) === 0)).toBe(true);

    // Still nothing persisted (delta zero).
    expect(await tenantCounts(tenantId)).toEqual(before);
  });
});
