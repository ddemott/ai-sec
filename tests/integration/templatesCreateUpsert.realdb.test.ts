/**
 * POST /templates/create against real Postgres — the upsert's preservation
 * contract for business_templates.example_services.
 *
 * WHY THIS IS A REAL-DB TEST AND NOT A MOCKED ONE
 * The defect lived in the gap between the JS argument and what Postgres saw.
 * The route passed `JSON.stringify(body.example_services ?? [])`, which is the
 * STRING '[]' — a perfectly good jsonb value, never SQL NULL. The ON CONFLICT
 * clause guards the column with
 *   example_services = COALESCE(EXCLUDED.example_services, business_templates.example_services)
 * so the guard could never fire, and every template edit that did not resend the
 * list wiped that vertical's starter services. A mocked pool asserts the
 * arguments a test author expected; only real Postgres evaluates the COALESCE.
 * That is the whole bug, so that is what has to run.
 *
 * WHO: a platform super-admin editing a business template.
 * WHAT: an upsert that omits example_services keeps what is stored; one that
 *       sends [] empties it on purpose; one that sends rows replaces them.
 * WHEN: every CI run.
 * WHERE: src/routes/tenants.ts, POST /templates/create.
 * WHY: T-015 filled example_services for all 31 live verticals precisely so the
 *      setup wizard stops asking a new owner to invent their own service list.
 *      An unrelated template edit silently emptying it restores exactly the
 *      blank-list state that work removed, and nothing would report it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { type Client, Pool } from 'pg';
import { API_DB_URL, getRootClient, skipIfDbDown } from '../utils';
import { createWithTenantClient } from '../../src/database';
import { registerTenantRoutes } from '../../src/routes/tenants';

const SUPER_ADMIN_TENANT = '00000000-0000-0000-0000-000000000000';
const TEST_BUSINESS_TYPE = 'realdb-upsert-probe-vertical';

type TenantRequest = FastifyRequest & {
  tenantId?: string;
  auth?: { tenant_id: string; user_id: string; email: string; role: 'owner' | 'front_desk' };
};

let setup: Client;
let pool: Pool;
let app: FastifyInstance;
let dbAvailable = false;

beforeAll(async () => {
  try {
    setup = await getRootClient();
    await setup.query('SELECT 1');
    pool = new Pool({ connectionString: API_DB_URL, max: 5 });

    app = Fastify({ logger: false });
    app.addHook('preHandler', async (request: TenantRequest) => {
      const tid = request.headers['x-tenant-id'] as string | undefined;
      if (tid) {
        request.tenantId = tid;
        request.auth = {
          tenant_id: tid,
          user_id: '55555555-5555-4555-8555-555555555555',
          email: 'realdb-templates@example.com',
          role: 'owner',
        };
      }
    });
    registerTenantRoutes(app, pool, createWithTenantClient(pool));
    await app.ready();
    dbAvailable = true;
  } catch (err) {
    console.warn('[templatesCreateUpsert.realdb.test] DB not available, skipping', err);
  }
});

afterAll(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
  if (setup) {
    // This test owns exactly one business_templates row; take it back out.
    await setup
      .query('DELETE FROM business_templates WHERE business_type = $1', [TEST_BUSINESS_TYPE])
      .catch(() => {});
    await setup.end();
  }
});

beforeEach(async (ctx) => {
  skipIfDbDown(ctx, () => dbAvailable);
  if (dbAvailable) {
    await setup.query('DELETE FROM business_templates WHERE business_type = $1', [
      TEST_BUSINESS_TYPE,
    ]);
  }
});

const hdr = { 'x-tenant-id': SUPER_ADMIN_TENANT };

function post(payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/templates/create', headers: hdr, payload });
}

async function storedServices(): Promise<Array<{ name: string }>> {
  const res = await setup.query(
    'SELECT example_services FROM business_templates WHERE business_type = $1',
    [TEST_BUSINESS_TYPE]
  );
  return res.rows[0]?.example_services ?? [];
}

const SEED = {
  business_type: TEST_BUSINESS_TYPE,
  display_name: 'Upsert Probe',
  category: 'Auto & Vehicle',
  example_services: [
    {
      name: 'Diagnostic visit',
      description: 'We find out why the light is on.',
      look_first: true,
      is_default: true,
    },
    { name: 'Oil change', description: 'Standard oil and filter service.' },
  ],
};

describe('POST /templates/create → example_services preservation', () => {
  it('HAPPY: the first write stores the starter services', async () => {
    const res = await post(SEED);
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect((await storedServices()).map((s) => s.name)).toEqual(['Diagnostic visit', 'Oil change']);
  });

  it('SAD (the shipped bug): an edit that omits example_services must NOT empty them', async () => {
    // WHO: an admin renaming a template, or changing its voice.
    // WHAT: a second upsert on the same business_type with no example_services key.
    // WHY: before the fix this stored [] — the starter list for that whole
    //      vertical, gone, with a 200 and no log line saying so.
    expect((await post(SEED)).statusCode).toBe(200);

    const res = await post({
      business_type: TEST_BUSINESS_TYPE,
      display_name: 'Upsert Probe Renamed',
      category: 'Auto & Vehicle',
    });
    expect(res.statusCode).toBe(200);

    const after = await storedServices();
    expect(
      after.map((s) => s.name),
      'omitting example_services erased the stored starter services — the COALESCE guard is unreachable again'
    ).toEqual(['Diagnostic visit', 'Oil change']);

    // The unrelated field the caller DID send must still have been applied,
    // otherwise "preserved" would just mean "the whole update was ignored".
    const row = await setup.query(
      'SELECT display_name FROM business_templates WHERE business_type = $1',
      [TEST_BUSINESS_TYPE]
    );
    expect(row.rows[0].display_name).toBe('Upsert Probe Renamed');
  });

  it('HAPPY: an explicit empty array still means "empty it"', async () => {
    // The fix must distinguish "omitted" from "deliberately cleared". Treating
    // both as preserve would leave no way to remove a bad starter list.
    expect((await post(SEED)).statusCode).toBe(200);
    expect((await post({ ...SEED, example_services: [] })).statusCode).toBe(200);
    expect(await storedServices()).toEqual([]);
  });

  it('HAPPY: sending a new list replaces the old one', async () => {
    expect((await post(SEED)).statusCode).toBe(200);
    const res = await post({
      ...SEED,
      example_services: [{ name: 'Tire rotation', description: 'Rotate all four tires.' }],
    });
    expect(res.statusCode).toBe(200);
    expect((await storedServices()).map((s) => s.name)).toEqual(['Tire rotation']);
  });

  it('SAD: an invalid starter list is rejected 400 and changes nothing', async () => {
    expect((await post(SEED)).statusCode).toBe(200);
    const res = await post({
      ...SEED,
      display_name: 'Should Not Land',
      example_services: [{ name: 'Diagnostic visit', look_first: true }], // no description
    });
    expect(res.statusCode).toBe(400);
    expect((await storedServices()).map((s) => s.name)).toEqual(['Diagnostic visit', 'Oil change']);
  });
});
