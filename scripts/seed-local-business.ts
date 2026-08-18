/**
 * Give a LOCAL tenant enough business shape to be bookable on a test call.
 *
 *   npx tsx scripts/seed-local-business.ts [--db "postgres://..."] [--tenant <uuid>]
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT IN seed.sql.
 *
 * The house rule is that `supabase/seed.sql` seeds ONLY what an empty business
 * needs to EXIST — tenants, owner users, templates — and every test creates and
 * deletes its own transactional data. That rule is right and this script does not
 * change it: nothing here runs automatically, and a rebuilt database is still
 * bare.
 *
 * But a VOICE CALL is not a test fixture. On 2026-08-15 a real test call reached
 * the booking step and the agent said "I'm not able to pull up our booking
 * options right now" — because `resolveServiceForBooking` found no service by
 * name, no service by meaning, and no `tenants.default_service_id`, so it
 * returned null and the route answered with a message-taking fallback. The
 * tenant had zero services, employees and shifts; the code was fine. Playwright's
 * globalSetup rebuilds this database, so that state returns after every e2e run,
 * and a caller-facing dead end is not a useful thing to re-create by hand each
 * time.
 *
 * THE CATALOG IS THE POINT, not just the row count. The agent no longer picks a
 * service by name — it passes the CALLER'S OWN WORDS to pgvector and the nearest
 * DESCRIPTION wins (migration 20260714150000). Seeding an automotive demo
 * catalog here would make "a meeting to talk about a contract role" book a Tire
 * Rotation: bookable, and wrong in a way that makes call testing misleading. So
 * the descriptions below are written the way this business's callers actually
 * speak.
 *
 * REFUSES ANYTHING BUT LOCALHOST. Same guard as rebuild-db.sh and the purge
 * script, for the same reason: this writes business configuration, and writing it
 * into a real tenant's calendar is not recoverable by re-running anything.
 */
import { Pool, type PoolClient } from 'pg';
import { pathToFileURL } from 'node:url';

import { withTenantContext } from '../src/database/index';
import { expandWeeklyToSchedule } from '../src/services/expandWeeklyToSchedule';

/** Thinking Hammer LLC — the tenant `sim-call.mjs` dials by default. */
const DEFAULT_TENANT = 'd5e3c6a1-7b9f-4e2a-bf30-8c11a5d8e9f0';
const DEFAULT_DB = 'postgres://postgres:postgres@localhost:5433/postgres';

/** Mon–Fri, 8am–5pm. `expandWeeklyToSchedule` fans this into employee_schedule. */
const WEEKLY_PATTERN = [1, 2, 3, 4, 5].map((day_of_week) => ({
  day_of_week,
  start_time: '08:00',
  end_time: '17:00',
}));

export function isLocalConnection(connectionString: string): boolean {
  return /@(localhost|127\.0\.0\.1|\[::1\]|db|postgres|secretary-hq-db)[:/]/.test(connectionString);
}

export interface SeedLocalBusinessResult {
  alreadySeeded: boolean;
  services: number;
  employees: number;
  shifts: number;
}

/**
 * Install the shape, inside the caller's transaction and the tenant's RLS
 * context. Idempotent at the tenant level: a tenant that already has a service
 * is left exactly as it is, because the alternative is duplicating a catalog an
 * owner may have edited.
 */
export async function seedLocalBusiness(
  client: PoolClient,
  tenantId: string
): Promise<SeedLocalBusinessResult> {
  const existing = await client.query('SELECT 1 FROM services WHERE tenant_id = $1 LIMIT 1', [
    tenantId,
  ]);
  if (existing.rows.length > 0) {
    return { alreadySeeded: true, services: 0, employees: 0, shifts: 0 };
  }

  await client.query(
    `INSERT INTO tenant_skills (tenant_id, name, description)
     VALUES ($1, 'Consulting', 'Software consulting, contract and hiring conversations')
     ON CONFLICT DO NOTHING`,
    [tenantId]
  );

  // Appointments require a resource (NOT NULL), even for a business whose only
  // real resource is the owner's own time.
  //
  // A tenant INSERT already creates one ("Main Office") — verified against the
  // live schema, not assumed. Adding a second would leave the business with two
  // rooms it does not have and split its availability across them, so reuse
  // whatever is there and only create when there is genuinely nothing.
  const existingResource = await client.query<{ resource_id: string; name: string }>(
    `SELECT resource_id, name FROM resources
      WHERE tenant_id = $1 AND is_active = true
      ORDER BY created_at LIMIT 1`,
    [tenantId]
  );
  const resource =
    existingResource.rows[0] ??
    (
      await client.query<{ resource_id: string; name: string }>(
        `INSERT INTO resources (tenant_id, name, description, is_active)
         VALUES ($1, 'Calendar', 'The owner''s calendar — this business books time, not equipment', true)
         RETURNING resource_id, name`,
        [tenantId]
      )
    ).rows[0];
  const resourceId = resource.resource_id;

  // The DESCRIPTIONS are what pgvector matches the caller's words against.
  // "a meeting to talk about a contract role" has to land on the first row here,
  // which is why that row names contracts, roles and hiring out loud.
  const serviceRes = await client.query<{ service_id: string; name: string }>(
    `INSERT INTO services (tenant_id, name, description, duration_minutes, price,
                           required_skills, required_resources)
     VALUES
       ($1, 'Intro Call',
        'A short call with the owner to talk about a job, a contract, a role, a rate, hiring him, or any work someone wants to bring him',
        30, 0.00, ARRAY['Consulting'], ARRAY[$2]),
       ($1, 'Consultation',
        'A working session about a software project — building an app, an AI assistant, a website, automation, or fixing something that is broken',
        60, 0.00, ARRAY['Consulting'], ARRAY[$2])
     RETURNING service_id, name`,
    [tenantId, resource.name]
  );
  const introId = serviceRes.rows.find((r) => r.name === 'Intro Call')!.service_id;

  const empRes = await client.query<{ employee_id: string }>(
    `INSERT INTO employees (tenant_id, name, email, phone, skills, is_active)
     VALUES ($1, 'Dale', 'owner@localhost.test', '555-0100', ARRAY['Consulting'], true)
     RETURNING employee_id`,
    [tenantId]
  );
  const employeeId = empRes.rows[0].employee_id;

  // The mapping tables are the AUTHORITATIVE gate in book_with_scheduling_atomic
  // when a service is supplied; without these rows the booking RPC has no
  // skilled employee to pick and rejects with NO_SKILLED_EMPLOYEE.
  for (const { service_id } of serviceRes.rows) {
    await client.query(
      `INSERT INTO service_employee (service_id, employee_id, tenant_id) VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [service_id, employeeId, tenantId]
    );
    await client.query(
      `INSERT INTO service_resource (service_id, resource_id, tenant_id) VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [service_id, resourceId, tenantId]
    );
  }

  const schedule = await expandWeeklyToSchedule(client, {
    tenantId,
    employeeId,
    pattern: WEEKLY_PATTERN,
    weeksAhead: 4,
  });

  // A default service is the resolver's last honest fallback before it gives up
  // and the call falls into message-taking.
  await client.query('UPDATE tenants SET default_service_id = $2 WHERE tenant_id = $1', [
    tenantId,
    introId,
  ]);

  return {
    alreadySeeded: false,
    services: serviceRes.rows.length,
    employees: 1,
    shifts: schedule.inserted,
  };
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  return value ?? fallback;
}

async function main(): Promise<void> {
  const connectionString = arg('--db', process.env.DATABASE_URL ?? DEFAULT_DB);
  const tenantId = arg('--tenant', DEFAULT_TENANT);

  if (!isLocalConnection(connectionString)) {
    console.error(
      'Refusing to run: this writes business configuration and the target is not local.\n' +
        'There is no --force. Configure a real business through the dashboard Setup Wizard.'
    );
    process.exit(1);
  }

  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await withTenantContext(client, tenantId, () =>
      seedLocalBusiness(client, tenantId)
    );
    await client.query('COMMIT');

    if (result.alreadySeeded) {
      console.log(`Tenant ${tenantId} already has services — left untouched.`);
    } else {
      console.log(
        `Seeded ${result.services} services, ${result.employees} employee, ${result.shifts} shifts for ${tenantId}.`
      );
      console.log('This tenant can now be booked on a call. Re-run after any DB rebuild.');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
