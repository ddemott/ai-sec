/**
 * The local call rig's business shape.
 *
 * WHO: a developer about to make a test call | WHAT: services + employee +
 * mappings + shifts installed onto a local tenant | WHEN: after any DB rebuild
 * (Playwright's globalSetup does one every e2e run) | WHERE:
 * scripts/seed-local-business.ts | WHY: on 2026-08-15 a real test call reached
 * the booking step and heard "I'm not able to pull up our booking options right
 * now" — the tenant had zero services, so `resolveServiceForBooking` returned
 * null and the call fell into message-taking. The code was fine; the shape was
 * missing.
 *
 * House rule honoured: this test creates its own tenant and deletes it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

import { seedLocalBusiness, isLocalConnection } from '../scripts/seed-local-business';

const CONNECTION =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/test_db';
const pool = new Pool({ connectionString: CONNECTION });
const createdTenantIds: string[] = [];

async function createTenant(): Promise<string> {
  const tenantId = randomUUID();
  await pool.query(
    `INSERT INTO tenants (tenant_id, name, business_type, timezone)
     VALUES ($1, $2, 'answering-service', 'America/Chicago')`,
    [tenantId, `LocalBiz Test ${tenantId.slice(0, 8)}`]
  );
  createdTenantIds.push(tenantId);
  return tenantId;
}

async function seed(tenantId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await seedLocalBusiness(client, tenantId);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

describe('isLocalConnection', () => {
  it('SAD: refuses anything that is not a local host — there is no --force', () => {
    // WHY: this writes business configuration into a tenant's calendar. A
    //      mistake against a real deployment is not undone by re-running
    //      anything, so the guard has no escape hatch, unlike the seeders that
    //      only rewrite generated template rows.
    expect(isLocalConnection('postgres://u:p@localhost:5433/postgres')).toBe(true);
    expect(isLocalConnection('postgres://u:p@127.0.0.1:5433/test_db')).toBe(true);
    expect(isLocalConnection('postgres://u:p@db:5432/postgres')).toBe(true);
    expect(isLocalConnection('postgres://u:p@aws-0-us-east-1.pooler.supabase.com:5432/postgres')).toBe(
      false
    );
    expect(isLocalConnection('postgres://u:p@some-host.railway.app:5432/railway')).toBe(false);
  });
});

describe('seedLocalBusiness', () => {
  beforeAll(async () => {
    // Fail loudly rather than silently skipping: a rig that quietly does not
    // run is how the booking gap survived a whole session unnoticed.
    await pool.query('SELECT 1');
  });

  afterAll(async () => {
    for (const tenantId of createdTenantIds) {
      await pool.query('DELETE FROM tenants WHERE tenant_id = $1', [tenantId]);
    }
    await pool.end();
  });

  it('HAPPY: installs everything the booking RPC needs to say yes', async () => {
    const tenantId = await createTenant();

    const result = await seed(tenantId);

    expect(result.alreadySeeded).toBe(false);
    expect(result.services).toBe(2);
    expect(result.shifts).toBeGreaterThan(0);

    const counts = await pool.query<{ table_name: string; n: string }>(
      `SELECT 'services' AS table_name, count(*)::text AS n FROM services WHERE tenant_id = $1
       UNION ALL SELECT 'employees', count(*)::text FROM employees WHERE tenant_id = $1
       UNION ALL SELECT 'resources', count(*)::text FROM resources WHERE tenant_id = $1
       UNION ALL SELECT 'service_employee', count(*)::text FROM service_employee WHERE tenant_id = $1
       UNION ALL SELECT 'service_resource', count(*)::text FROM service_resource WHERE tenant_id = $1
       UNION ALL SELECT 'employee_schedule', count(*)::text FROM employee_schedule WHERE tenant_id = $1`,
      [tenantId]
    );
    const byTable = Object.fromEntries(counts.rows.map((r) => [r.table_name, Number(r.n)]));

    expect(byTable.services).toBe(2);
    expect(byTable.employees).toBe(1);
    expect(byTable.resources).toBe(1);
    // The mapping tables are the AUTHORITATIVE skill/resource gate in
    // book_with_scheduling_atomic when a service is supplied — without them the
    // RPC has no skilled employee to pick and rejects NO_SKILLED_EMPLOYEE.
    expect(byTable.service_employee).toBe(2);
    expect(byTable.service_resource).toBe(2);
    expect(byTable.employee_schedule).toBeGreaterThan(0);
  });

  it('sets a default service — the resolver’s last stop before message-taking', async () => {
    // WHY: `resolveServiceForBooking` tries name match, then pgvector meaning,
    //      then tenants.default_service_id. Null at all three is exactly the
    //      "I'm not able to pull up our booking options" dead end.
    const tenantId = await createTenant();
    await seed(tenantId);

    const res = await pool.query<{ name: string }>(
      `SELECT s.name FROM tenants t JOIN services s ON s.service_id = t.default_service_id
        WHERE t.tenant_id = $1`,
      [tenantId]
    );

    expect(res.rows[0]?.name).toBe('Intro Call');
  });

  it('SAD: a tenant that already has a catalog is left alone', async () => {
    // WHY: re-running after a rebuild must be safe, and an owner who edited
    //      their catalog must never find it duplicated by a dev convenience.
    const tenantId = await createTenant();
    await seed(tenantId);

    const second = await seed(tenantId);

    expect(second.alreadySeeded).toBe(true);
    const services = await pool.query('SELECT 1 FROM services WHERE tenant_id = $1', [tenantId]);
    expect(services.rowCount).toBe(2);
  });
});
