/**
 * Real-DB companion for the skills routes.
 *
 * Motivation (docs/TEST_DB_AUDIT.md): GET/POST/DELETE /skills run static SQL
 * over tenant_skills, but the create path slugifies the name at INSERT time
 * and the delete matches on that normalized name — a mock can't prove the
 * round-trip (create with a spaced name, delete by the slug) or the
 * tenant-scoping. This suite drives the real routes → real Postgres.
 *
 * 5W for sad-path failures:
 *   WHO  — an owner managing the skills catalog
 *   WHAT — GET /skills, POST /skills/create, DELETE /skills/:name
 *   WHEN — configuring which skills a service requires
 *   WHERE — skills.ts INSERT/DELETE tenant_skills (name slugified)
 *   WHY  — a create/delete name mismatch strands a skill that can't be removed
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { type Client, type PoolClient, Pool } from 'pg';
import { API_DB_URL, getRootClient, createTenant, skipIfDbDown } from '../utils';
import { createWithTenantClient } from '../../src/database';
import { registerSkillRoutes } from '../../src/routes/skills';

type TenantRequest = FastifyRequest & {
  tenantId?: string;
  auth?: { tenant_id: string; user_id: string; email: string; role: 'owner' | 'front_desk' };
};

let setup: Client;
let pool: Pool;
let app: FastifyInstance;
let dbAvailable = false;
let tenantId: string;
const tenantsToClean: string[] = [];

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
          email: 'realdb-skills@example.com',
          role: 'owner',
        };
      }
    });
    const withTenantClient = createWithTenantClient(pool);
    registerSkillRoutes(
      app,
      pool,
      withTenantClient as <T>(id: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
    );
    await app.ready();

    tenantId = await createTenant(setup, 'Skills Realdb Tenant', 'salon');
    tenantsToClean.push(tenantId);
    dbAvailable = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[skills.realdb.test] DB not available, skipping', err);
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
});

function hdr() {
  return { 'x-tenant-id': tenantId };
}

describe('skills routes → real DB', () => {
  it('HAPPY: create slugifies the name, list returns it, delete-by-slug removes it', async () => {
    // WHY: create stores slugify("Hair Coloring") = "hair-coloring"; the delete
    // route matches on that normalized name. This proves the round-trip that a
    // create/delete name mismatch would break.
    const create = await app.inject({
      method: 'POST',
      url: '/skills/create',
      headers: hdr(),
      payload: { tenant_id: tenantId, name: 'Hair Coloring', description: 'color services' },
    });
    expect(create.statusCode).toBe(200);

    const stored = await setup.query(
      `SELECT name FROM tenant_skills WHERE tenant_id = $1 AND name = 'hair-coloring'`,
      [tenantId]
    );
    expect(stored.rows).toHaveLength(1);

    const list = await app.inject({ method: 'GET', url: '/skills', headers: hdr() });
    expect(list.statusCode).toBe(200);
    const names = list.json().map((s) => s.name);
    expect(names).toContain('hair-coloring');

    const del = await app.inject({
      method: 'DELETE',
      url: '/skills/hair-coloring',
      headers: hdr(),
    });
    expect(del.statusCode).toBe(200);
    const after = await setup.query(
      `SELECT 1 FROM tenant_skills WHERE tenant_id = $1 AND name = 'hair-coloring'`,
      [tenantId]
    );
    expect(after.rows).toHaveLength(0);
  });

  it('SAD: deleting an unknown skill → 404', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/skills/does-not-exist',
      headers: hdr(),
    });
    expect(res.statusCode).toBe(404);
  });
});
