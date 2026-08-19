/**
 * Real-DB companion for GET /export/tenant-data.
 *
 * Motivation (docs/TEST_DB_AUDIT.md): the export handler iterates a hardcoded
 * EXPORT_TABLES list and runs `SELECT * FROM ${table} WHERE tenant_id = $1`
 * with the **table name interpolated** — the same identifier-interpolation
 * class that shipped the versionHistory prod 500s. If any table in the list
 * is renamed/dropped, or lacks a tenant_id column, the owner's whole export
 * 500s — and a mocked pg client can't see it because the SQL never runs. This
 * suite drives the real route → real Postgres so every table name is exercised.
 *
 * Also verifies the two security-relevant contracts a mock can't: the `users`
 * rows come back column-restricted (NO password_hash) and front-desk callers
 * are refused (owner-only bulk PII export).
 *
 * Strategy mirrors voice.realdb.test.ts: real pg.Pool on API_DB_URL + a
 * preHandler that stands in for tenantMiddleware/JWT (sets req.tenantId +
 * req.auth with a role). Fixtures per-suite, cleaned in afterAll. Skips when
 * the DB is down; hard-fails under REQUIRE_DB_TESTS=1 (CI).
 *
 * 5W for sad-path failures:
 *   WHO  — an owner clicking "Download my data"
 *   WHAT — GET /export/tenant-data (24-table SELECT * dump)
 *   WHEN — any time; especially right after a schema migration renames a table
 *   WHERE — exportData.ts `SELECT * FROM ${table} WHERE tenant_id = $1`
 *   WHY  — a stale table name 500s the entire export; a leaked password_hash
 *          or a front-desk export is a PII breach
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { type Client, Pool } from 'pg';
import {
  API_DB_URL,
  getRootClient,
  createTenant,
  createCustomerFull,
  skipIfDbDown,
} from '../utils';
import { createWithTenantClient } from '../../src/database';
import { registerExportRoutes } from '../../src/routes/exportData';

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

function exportReq() {
  return app.inject({
    method: 'GET',
    url: '/export/tenant-data',
    headers: { 'x-tenant-id': tenantId },
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
          user_id: '77777777-7777-4777-8777-777777777777',
          email: 'realdb-export@example.com',
          role,
        };
      }
    });
    const withTenantClient = createWithTenantClient(pool);
    registerExportRoutes(
      app,
      pool,
      withTenantClient
    );
    await app.ready();

    tenantId = await createTenant(setup, 'Export Realdb Tenant', 'salon');
    tenantsToClean.push(tenantId);
    // One customer so at least one exported table has a row (proves scoping).
    await createCustomerFull(setup, tenantId, '+15558880001', 'Export Ed');

    dbAvailable = true;
  } catch (err) {
     
    console.warn('[exportData.realdb.test] DB not available, skipping', err);
  }
});

afterAll(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
  if (setup) {
    for (const id of tenantsToClean) {
      await setup.query('DELETE FROM tenants WHERE tenant_id = $1', [id]).catch(() => {});
    }
    await setup.end();
  }
});

beforeEach((ctx) => {
  skipIfDbDown(ctx, () => dbAvailable);
  role = 'owner';
});

describe('GET /export/tenant-data → real DB', () => {
  it('HAPPY: every EXPORT_TABLES table resolves without a 500 (interpolated-identifier guard)', async () => {
    // WHY: this is the whole point — a renamed/dropped table in the hardcoded
    // list, or one missing tenant_id, would 500 the entire export. Running it
    // against the real schema exercises all 24 interpolated names + the users
    // column-restricted query.
    const res = await exportReq();
    expect(res.statusCode, `export 500'd — a table name likely drifted: ${res.body}`).toBe(200);
    const body = res.json();
    // record_counts is present and includes the seeded customer.
    expect(body.record_counts).toBeTruthy();
    expect(body.tables.customers.length).toBeGreaterThanOrEqual(1);
    expect(body.record_counts.customers).toBe(body.tables.customers.length);
  });

  it('SECURITY: exported users rows carry NO password_hash', async () => {
    // WHY: users is the one table pulled with an explicit column list; a
    // regression to SELECT * would leak password hashes into a file the owner
    // downloads (and might forward).
    const res = await exportReq();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const users = body.tables.users as Array<Record<string, unknown>>;
    for (const u of users) {
      expect(Object.keys(u)).not.toContain('password_hash');
      expect(Object.keys(u)).not.toContain('password_reset_token');
    }
  });

  it('SECURITY: a front-desk caller is refused (403) — bulk PII export is owner-only', async () => {
    // WHO: a front_desk user | WHAT: GET /export/tenant-data | WHEN: casual or
    // malicious data grab | WHERE: the owner gate on the export route | WHY: a
    // full-tenant PII dump in non-owner hands is an exfiltration path — must 403.
    role = 'front_desk';
    const res = await exportReq();
    expect(res.statusCode).toBe(403);
    expect(res.json().success).toBe(false);
  });
});

describe('GET /export/*.csv → real DB', () => {
  it('HAPPY: all three CSV exports run their JOINed SQL against the real schema without a 500', async () => {
    // WHY: the CSV routes hardcode column names across 6 tables (customers,
    // appointments, services, employees, resources, voice_sessions). A renamed
    // column ships a prod 500 that a mocked pg client can never catch — same
    // interpolated-SQL class this realdb suite exists for.
    for (const kind of ['customers', 'appointments', 'calls'] as const) {
      const res = await app.inject({
        method: 'GET',
        url: `/export/${kind}.csv`,
        headers: { 'x-tenant-id': tenantId },
      });
      expect(res.statusCode, `${kind}.csv 500'd — a column likely drifted: ${res.body}`).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
    }
    // The seeded customer actually appears in the customers CSV.
    const customersCsv = await app.inject({
      method: 'GET',
      url: '/export/customers.csv',
      headers: { 'x-tenant-id': tenantId },
    });
    expect(customersCsv.body).toContain('Export Ed');
    // Phone starts with "+" → formula-guarded with a leading single quote.
    expect(customersCsv.body).toContain("'+15558880001");
  });
});
