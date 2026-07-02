/**
 * Real-DB companion for the user-management routes.
 *
 * Motivation (docs/TEST_DB_AUDIT.md): these are the auth-adjacent CRUD routes
 * (list team, invite, change role) — a security surface where the SQL matters:
 * the list must never leak password_hash, the invite INSERT relies on a real
 * (tenant_id, email) UNIQUE for its 409, and the role UPDATE must be
 * tenant-scoped. A mocked pg client can't prove any of that. This suite drives
 * the real routes → real Postgres and reads the stored rows.
 *
 * Strategy mirrors voice.realdb.test.ts: real pg.Pool on API_DB_URL + a
 * preHandler standing in for tenantMiddleware/JWT (sets req.tenantId +
 * req.auth). The requester is a REAL seeded owner user so is_self and the
 * can't-change-own-role guard exercise real ids. Fixtures per-suite, cleaned
 * in afterAll. Skips when DB down; hard-fails under REQUIRE_DB_TESTS=1 (CI).
 *
 * 5W for sad-path failures:
 *   WHO  — an owner managing team access
 *   WHAT — GET /users, POST /users/invite, PATCH /users/:id/role
 *   WHEN — onboarding staff / promoting a front-desk user
 *   WHERE — users.ts SELECT/INSERT/UPDATE users (+ password_resets on invite)
 *   WHY  — a leaked password_hash is a breach; a cross-tenant role change is a
 *          privilege-escalation hole; a missing 409 lets duplicate logins land
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { type Client, type PoolClient, Pool } from 'pg';
import { API_DB_URL, getRootClient, createTenant, createUser, skipIfDbDown } from '../test-utils';
import { createWithTenantClient } from '../database';
import { registerUserRoutes } from './users';

type TenantRequest = FastifyRequest & {
  tenantId?: string;
  auth?: { tenant_id: string; user_id: string; email: string; role: 'owner' | 'front_desk' };
};

let setup: Client;
let pool: Pool;
let app: FastifyInstance;
let dbAvailable = false;
let tenantId: string;
let ownerUserId: string;
let role: 'owner' | 'front_desk' = 'owner';
const tenantsToClean: string[] = [];

beforeAll(async () => {
  try {
    setup = await getRootClient();
    await setup.query('SELECT 1');
    pool = new Pool({ connectionString: API_DB_URL, max: 5 });

    tenantId = await createTenant(setup, 'Users Realdb Tenant', 'salon');
    tenantsToClean.push(tenantId);
    ownerUserId = await createUser(setup, tenantId, 'owner@users-realdb.test', 'pw', 'Owner Ollie');

    app = Fastify({ logger: false });
    app.addHook('preHandler', async (request: TenantRequest) => {
      const tid = request.headers['x-tenant-id'] as string | undefined;
      if (tid) {
        request.tenantId = tid;
        request.auth = {
          tenant_id: tid,
          user_id: ownerUserId,
          email: 'owner@users-realdb.test',
          role,
        };
      }
    });
    const withTenantClient = createWithTenantClient(pool);
    registerUserRoutes(
      app,
      pool,
      withTenantClient as <T>(id: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
    );
    await app.ready();

    dbAvailable = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[users.realdb.test] DB not available, skipping', err);
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

function listUsers() {
  return app.inject({ method: 'GET', url: '/users', headers: { 'x-tenant-id': tenantId } });
}

describe('GET /users → real DB', () => {
  it('SECURITY: lists tenant users with NO password_hash and marks the requester is_self', async () => {
    const res = await listUsers();
    expect(res.statusCode).toBe(200);
    const users = res.json().users as Array<Record<string, unknown>>;
    expect(users.length).toBeGreaterThanOrEqual(1);
    for (const u of users) {
      expect(Object.keys(u)).not.toContain('password_hash');
    }
    const self = users.find((u) => u.user_id === ownerUserId);
    expect(self?.is_self).toBe(true);
  });

  it('SECURITY: a front-desk caller is refused (owner-only)', async () => {
    role = 'front_desk';
    const res = await listUsers();
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /users/invite → real DB', () => {
  // NOTE: the invite HAPPY path can't be exercised through this harness. The
  // handler INSERTs into password_resets INSIDE withTenantClient (tenant
  // context set), but the password_resets RLS policy is `unauthenticated_only`
  // (permits writes ONLY when app.current_tenant_id IS NULL). Under the
  // non-BYPASSRLS `api_user` the test uses, that INSERT is RLS-blocked (42501).
  // In prod it works only because the managed DB role bypasses RLS. This
  // latent conflict (app policy would reject the app's own write under a
  // locked-down role) is flagged in docs/TODO_BLINDSPOT.md — a security-model
  // decision, not fixed here. So we test the 409 path (which fires at the
  // users INSERT, BEFORE password_resets) by pre-seeding the duplicate.

  it('SAD: inviting a duplicate email for the same tenant → 409 (the UNIQUE guard, fires before password_resets)', async () => {
    // Pre-seed the colliding user directly (root client bypasses RLS) so the
    // invite's users INSERT hits the (tenant_id, email) UNIQUE → 23505 → 409
    // without ever reaching the RLS-gated password_resets write.
    await createUser(setup, tenantId, 'dup@users-realdb.test', 'pw', 'Dup Dan');
    const res = await app.inject({
      method: 'POST',
      url: '/users/invite',
      headers: { 'x-tenant-id': tenantId },
      payload: {
        tenant_id: tenantId,
        email: 'dup@users-realdb.test',
        full_name: 'Dup Dan Again',
        role: 'front_desk',
      },
    });
    expect(res.statusCode).toBe(409);
    // Exactly one row for that email survives (the pre-seeded one).
    const rows = await setup.query(
      `SELECT 1 FROM users WHERE tenant_id = $1 AND email = 'dup@users-realdb.test'`,
      [tenantId]
    );
    expect(rows.rows).toHaveLength(1);
  });
});

describe('PATCH /users/:id/role → real DB', () => {
  it('HAPPY: promotes a front-desk user to owner', async () => {
    const staffId = await createUser(setup, tenantId, 'staff@users-realdb.test', 'pw', 'Staff Sid');
    const res = await app.inject({
      method: 'PATCH',
      url: `/users/${staffId}/role`,
      headers: { 'x-tenant-id': tenantId },
      payload: { tenant_id: tenantId, role: 'owner' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe('owner');
    const row = await setup.query(`SELECT role FROM users WHERE user_id = $1`, [staffId]);
    expect(row.rows[0].role).toBe('owner');
  });

  it('SAD: an owner cannot change their OWN role (self-lockout guard)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/users/${ownerUserId}/role`,
      headers: { 'x-tenant-id': tenantId },
      payload: { tenant_id: tenantId, role: 'front_desk' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('SAD: changing an unknown user → 404, nothing updated', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/users/00000000-0000-4000-8000-000000000000/role`,
      headers: { 'x-tenant-id': tenantId },
      payload: { tenant_id: tenantId, role: 'owner' },
    });
    expect(res.statusCode).toBe(404);
  });
});
