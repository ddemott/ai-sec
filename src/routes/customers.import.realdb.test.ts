/**
 * Real-DB companion for POST /customers/import.
 *
 * The mocked suite (customers.import.test.ts) pins parsing/validation/dedupe
 * logic; this suite proves the INSERT actually lands in real Postgres —
 * multi-row VALUES tuples, jsonb metadata encoding, RLS-scoped client, and
 * the existing-customer dedupe against genuinely stored rows. The 2026-05-11
 * ID-convention lesson applies: a shape mismatch (e.g. metadata passed as a
 * string) only surfaces against a real DB.
 *
 * Test isolation: this suite creates its own tenant in beforeAll and deletes
 * it (cascading its customers) in afterAll — DB starts and ends bare-bones.
 * Skips when the DB is down; hard-fails under REQUIRE_DB_TESTS=1 (CI).
 *
 * 5W for sad-path failures:
 *   WHO  — an owner bulk-importing their customer list during onboarding
 *   WHAT — POST /customers/import (JSON { csv })
 *   WHEN — first-day setup, or a re-import over live data
 *   WHERE — customers.ts import handler → multi-row INSERT INTO customers
 *   WHY  — a failed/partial import silently loses the owner's customer book
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { type Client, type PoolClient, Pool } from 'pg';
import {
  API_DB_URL,
  getRootClient,
  createTenant,
  createCustomerFull,
  skipIfDbDown,
} from '../test-utils';
import { createWithTenantClient } from '../database';
import { registerCustomerRoutes } from './customers';

type TenantRequest = FastifyRequest & {
  tenantId?: string;
  auth?: { tenant_id: string; user_id: string; email: string; role: 'owner' | 'front_desk' };
};

let setup: Client;
let pool: Pool;
let app: FastifyInstance;
let dbAvailable = false;
let tenantId: string;
let role: 'owner' | 'front_desk' = 'owner';
const tenantsToClean: string[] = [];

function importReq(csv: string) {
  return app.inject({
    method: 'POST',
    url: '/customers/import',
    headers: { 'x-tenant-id': tenantId },
    payload: { csv },
  });
}

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
          user_id: '88888888-8888-4888-8888-888888888888',
          email: 'realdb-import@example.com',
          role,
        };
      }
    });
    const withTenantClient = createWithTenantClient(pool);
    registerCustomerRoutes(
      app,
      pool,
      withTenantClient as <T>(id: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
    );
    await app.ready();

    tenantId = await createTenant(setup, 'Import Realdb Tenant', 'salon');
    tenantsToClean.push(tenantId);
    // A pre-existing customer so the existing-phone dedupe has real data.
    await createCustomerFull(setup, tenantId, '+16305557000', 'Existing Eve');

    dbAvailable = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[customers.import.realdb.test] DB not available, skipping', err);
  }
});

afterAll(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
  if (setup) {
    for (const id of tenantsToClean) {
      // Tenant delete cascades to its customers — bare-bones at exit.
      await setup.query('DELETE FROM tenants WHERE tenant_id = $1', [id]).catch(() => {});
    }
    await setup.end();
  }
});

beforeEach((ctx) => {
  skipIfDbDown(ctx, () => dbAvailable);
  role = 'owner';
});

describe('POST /customers/import → real DB', () => {
  it('HAPPY: mixed CSV — inserts new rows, dedupes existing + in-file, reports invalid', async () => {
    // 5 data rows: 2 new, 1 dup of Existing Eve (different formatting),
    // 1 in-file dup of row 2, 1 invalid phone.
    const csv =
      'Name,Phone,Email,Notes\n' +
      'New Nancy,630-555-7001,nancy@example.com,"prefers Tuesdays, mornings"\n' +
      'New Ned,(630) 555-7002,,\n' +
      'Existing Eve,6305557000,,\n' +
      'Ned Copy,+1 630 555 7002,,\n' +
      'Bad Bart,12,,\n';

    const res = await importReq(csv);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.imported).toBe(2);
    expect(body.skipped_duplicates).toBe(2);
    expect(body.errors).toEqual([{ row: 6, reason: 'invalid phone "12"' }]);
    expect(body.total_rows).toBe(5);

    // The rows genuinely landed, phone normalized, metadata is real jsonb.
    const rows = await setup.query(
      `SELECT name, first_name, last_name, phone, email, metadata->>'notes' AS notes
         FROM customers WHERE tenant_id = $1 AND is_deleted = false ORDER BY name`,
      [tenantId]
    );
    expect(rows.rows.map((r) => r.name)).toEqual(['Existing Eve', 'New Nancy', 'New Ned']);
    const nancy = rows.rows.find((r) => r.name === 'New Nancy');
    expect(nancy).toMatchObject({
      first_name: 'New',
      last_name: 'Nancy',
      phone: '+16305557001',
      email: 'nancy@example.com',
      notes: 'prefers Tuesdays, mornings',
    });
  });

  it('HAPPY: re-importing the same file is idempotent (everything dedupes, nothing doubles)', async () => {
    // WHO: an owner clicking Import twice on the same file.
    // WHY: the phone dedupe must make re-imports safe — no duplicate book.
    const csv = 'name,phone\nRepeat Rita,630-555-7003\n';
    const first = await importReq(csv);
    expect(first.json().imported).toBe(1);

    const second = await importReq(csv);
    expect(second.statusCode).toBe(200);
    expect(second.json().imported).toBe(0);
    expect(second.json().skipped_duplicates).toBe(1);

    const count = await setup.query(
      'SELECT COUNT(*)::int AS n FROM customers WHERE tenant_id = $1 AND phone = $2',
      [tenantId, '+16305557003']
    );
    expect(count.rows[0].n).toBe(1);
  });

  it('SECURITY: a front-desk caller is refused 403 and nothing is written', async () => {
    // WHO: a front_desk user | WHAT: POST /customers/import | WHEN: unauthorized
    // bulk write attempt | WHERE: the owner gate on the import route | WHY: bulk
    // insert is an owner op — a 403 must also leave zero rows written (no partial
    // side effect before the gate).
    role = 'front_desk';
    const res = await importReq('name,phone\nSneaky Sam,630-555-7004\n');
    expect(res.statusCode).toBe(403);

    const count = await setup.query(
      'SELECT COUNT(*)::int AS n FROM customers WHERE tenant_id = $1 AND phone = $2',
      [tenantId, '+16305557004']
    );
    expect(count.rows[0].n).toBe(0);
  });
});
