/**
 * Real-DB + real-middleware tests for the session-revocation routes
 * ("log out everywhere").
 *
 * Unlike users.realdb.test.ts (which fakes auth with a preHandler), this
 * suite registers the REAL registerJwtAuthHook + tenantMiddleware chain, so
 * the assertion that matters — "an old token stops working after the bump" —
 * exercises the exact password_changed_at comparison production runs
 * (middleware.ts: floor(changed_at, 1s) > token.iat). Tokens under test are
 * minted with a backdated iat (now - 60s) so the check is deterministic; a
 * token minted in the same second as the bump would survive (documented
 * same-second edge shared with /reset-password — deliberately replicated,
 * not fixed here).
 *
 * Strategy mirrors voice.realdb.test.ts / users.realdb.test.ts: real
 * pg.Pool on API_DB_URL (non-BYPASSRLS api_user, so the admin_bypass_users
 * policy path the route relies on is actually exercised), fixtures created
 * in beforeAll and deleted in afterAll, skip when DB down.
 *
 * 5W for sad-path failures:
 *   WHO  — a user hitting "Log out of all sessions", or an owner force-logging
 *          out a staff member (lost phone, fired employee)
 *   WHAT — POST /users/me/revoke-sessions, POST /users/:id/revoke-sessions
 *   WHEN — suspected credential theft / staff offboarding
 *   WHERE — users.ts UPDATE users.password_changed_at + middleware.ts iat check
 *   WHY  — a revoke that doesn't kill old tokens is a fake security control;
 *          a front_desk user or cross-tenant caller who can revoke others'
 *          sessions is a denial-of-service / harassment hole
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// middleware.ts captures JWT_SECRET at module load — hoist the assignment
// above imports (same pattern as token-refresh.test.ts).
vi.hoisted(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';
});

import Fastify, { type FastifyInstance } from 'fastify';
import { type Client, type PoolClient, Pool } from 'pg';
import jwt from 'jsonwebtoken';
import { API_DB_URL, getRootClient, createTenant, createUser, skipIfDbDown } from '../utils';
import { createWithTenantClient } from '../../src/database';
import { registerJwtAuthHook, tenantMiddleware } from '../../src/middleware';
import { registerUserRoutes } from '../../src/routes/users';

const JWT_SECRET = process.env.JWT_SECRET as string;

/**
 * Mint a token whose iat is 60s in the past so a password_changed_at bump
 * made "now" is strictly greater at second precision — deterministic, no
 * sleeps. exp is set explicitly because jsonwebtoken derives expiresIn from
 * the supplied iat.
 */
function backdatedToken(payload: {
  tenant_id: string;
  user_id: string;
  email: string;
  role: 'owner' | 'front_desk';
}): string {
  const nowSec = Math.floor(Date.now() / 1000);
  return jwt.sign({ ...payload, iat: nowSec - 60, exp: nowSec + 3600 }, JWT_SECRET);
}

let setup: Client;
let pool: Pool;
let app: FastifyInstance;
let dbAvailable = false;
let tenantA: string;
let tenantB: string;
let ownerAId: string;
let deskAId: string;
let userBId: string;
const tenantsToClean: string[] = [];

beforeAll(async () => {
  try {
    setup = await getRootClient();
    await setup.query('SELECT 1');
    pool = new Pool({ connectionString: API_DB_URL, max: 5 });
    await pool.query('SELECT 1');

    tenantA = await createTenant(setup, 'Revoke Realdb Tenant A', 'salon');
    tenantsToClean.push(tenantA);
    tenantB = await createTenant(setup, 'Revoke Realdb Tenant B', 'salon');
    tenantsToClean.push(tenantB);
    ownerAId = await createUser(setup, tenantA, 'owner@revoke-realdb.test', 'pw', 'Owner Ava');
    deskAId = await createUser(setup, tenantA, 'desk@revoke-realdb.test', 'pw', 'Desk Dana');
    userBId = await createUser(setup, tenantB, 'owner@revoke-realdb-b.test', 'pw', 'Owner Bea');

    app = Fastify({ logger: false });
    // REAL production middleware chain: JWT verification (incl. the
    // password_changed_at revocation check) then tenant resolution.
    registerJwtAuthHook(app, pool);
    tenantMiddleware(app as Parameters<typeof tenantMiddleware>[0]);
    const withTenantClient = createWithTenantClient(pool);
    registerUserRoutes(
      app as Parameters<typeof registerUserRoutes>[0],
      pool,
      withTenantClient as <T>(id: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
    );
    await app.ready();

    dbAvailable = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[users.revokeSessions.realdb.test] DB not available, skipping', err);
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

beforeEach(async (ctx) => {
  skipIfDbDown(ctx, () => dbAvailable);
  // Each test starts from "no revocation has happened" so ordering can't
  // make a stale bump reject a token some other test minted. password_changed_at
  // is NOT NULL, so the "unrevoked" baseline is epoch (to_timestamp(0)) — an
  // instant far before any backdated token's iat (now-60s), so those tokens
  // stay valid until a revoke bumps the column to NOW().
  if (dbAvailable) {
    await setup.query(
      'UPDATE users SET password_changed_at = to_timestamp(0) WHERE user_id = ANY($1::uuid[])',
      [[ownerAId, deskAId, userBId]]
    );
  }
});

function ownerToken() {
  return backdatedToken({
    tenant_id: tenantA,
    user_id: ownerAId,
    email: 'owner@revoke-realdb.test',
    role: 'owner',
  });
}

function deskToken() {
  return backdatedToken({
    tenant_id: tenantA,
    user_id: deskAId,
    email: 'desk@revoke-realdb.test',
    role: 'front_desk',
  });
}

describe('POST /users/me/revoke-sessions → real DB + real JWT hook', () => {
  it('HAPPY: self-revoke succeeds and the SAME (old) token is rejected on the next request', async () => {
    // WHO: a user tapping "Log out of all sessions" | WHAT: self-revoke bumps
    // password_changed_at then re-uses the SAME token | WHEN: suspected phone
    // theft | WHERE: users.ts UPDATE + middleware iat check | WHY: if the old
    // token still worked, the control would be cosmetic, not real.
    const token = deskToken(); // front_desk on purpose — any role may self-revoke

    const first = await app.inject({
      method: 'POST',
      url: '/users/me/revoke-sessions',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().success).toBe(true);

    // The bump landed in the DB… (bumped to NOW(), i.e. far past the epoch
    // baseline — assert it is recent rather than merely non-null, since the
    // column is NOT NULL and always carries the epoch baseline otherwise).
    const row = await setup.query('SELECT password_changed_at FROM users WHERE user_id = $1', [
      deskAId,
    ]);
    expect(new Date(row.rows[0].password_changed_at).getTime()).toBeGreaterThan(Date.now() - 30000);

    // …and the real middleware now rejects the token that just made the call.
    const second = await app.inject({
      method: 'POST',
      url: '/users/me/revoke-sessions',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(second.statusCode).toBe(401);
  });

  it('SAD: anonymous request → 401, nothing bumped', async () => {
    // WHO: an unauthenticated caller | WHAT: POST /users/me/revoke-sessions with
    // no token | WHEN: a probe / CSRF attempt | WHERE: JWT auth hook before the
    // route | WHY: an anon revoke would be a free DoS (log anyone out), so it
    // must 401 AND leave every row's password_changed_at untouched.
    const res = await app.inject({ method: 'POST', url: '/users/me/revoke-sessions' });
    expect(res.statusCode).toBe(401);
    const row = await setup.query(
      "SELECT COUNT(*)::int AS bumped FROM users WHERE user_id = ANY($1::uuid[]) AND password_changed_at > now() - interval '30 seconds'",
      [[ownerAId, deskAId]]
    );
    expect(row.rows[0].bumped).toBe(0);
  });
});

describe('POST /users/:id/revoke-sessions → real DB + real JWT hook', () => {
  it("HAPPY: owner revokes a staff member's sessions — staff's old token dies, owner's survives", async () => {
    // WHO: an owner offboarding a staff member | WHAT: POST /users/:id/revoke-
    // sessions on the staff row only | WHEN: firing / lost device | WHERE:
    // tenant-pinned UPDATE | WHY: the target's token must die while the owner's
    // own (untouched) token keeps working — revoke is surgical, not a logout-all.
    const staffToken = deskToken(); // minted (backdated) BEFORE the revoke
    const bossToken = ownerToken();

    const res = await app.inject({
      method: 'POST',
      url: `/users/${deskAId}/revoke-sessions`,
      headers: { Authorization: `Bearer ${bossToken}` },
    });
    expect(res.statusCode).toBe(200);

    // Staff's pre-revoke token is now rejected by the real middleware…
    const staffAfter = await app.inject({
      method: 'POST',
      url: '/users/me/revoke-sessions',
      headers: { Authorization: `Bearer ${staffToken}` },
    });
    expect(staffAfter.statusCode).toBe(401);

    // …while the owner (whose row was not touched) keeps working.
    const bossAfter = await app.inject({
      method: 'GET',
      url: '/users',
      headers: { Authorization: `Bearer ${bossToken}` },
    });
    expect(bossAfter.statusCode).toBe(200);
  });

  it('SAD: a front_desk user cannot revoke anyone → 403, target untouched', async () => {
    // WHO: a front_desk user aiming at the owner | WHAT: POST /users/:id/revoke-
    // sessions | WHEN: privilege-escalation / harassment attempt | WHERE:
    // requireOwner gate | WHY: letting non-owners revoke others is a DoS hole —
    // must 403 and leave the target's password_changed_at at baseline.
    const res = await app.inject({
      method: 'POST',
      url: `/users/${ownerAId}/revoke-sessions`,
      headers: { Authorization: `Bearer ${deskToken()}` },
    });
    expect(res.statusCode).toBe(403);
    const row = await setup.query('SELECT password_changed_at FROM users WHERE user_id = $1', [
      ownerAId,
    ]);
    // Untouched → still the epoch baseline (no bump to NOW()).
    expect(new Date(row.rows[0].password_changed_at).getTime()).toBeLessThan(Date.now() - 30000);
  });

  it("SAD: cross-tenant target → 404 without leaking the user's existence, row untouched", async () => {
    // WHO: owner of tenant A targeting a real user in tenant B | WHAT: POST
    // /users/:id/revoke-sessions | WHEN: cross-tenant enumeration attempt |
    // WHERE: the tenant-pinned UPDATE (WHERE tenant_id = caller's) | WHY: it
    // must 404 exactly like a made-up id so an attacker can't probe which
    // user_ids exist on other tenants; the target row stays at baseline.
    const res = await app.inject({
      method: 'POST',
      url: `/users/${userBId}/revoke-sessions`,
      headers: { Authorization: `Bearer ${ownerToken()}` },
    });
    expect(res.statusCode).toBe(404);
    const row = await setup.query('SELECT password_changed_at FROM users WHERE user_id = $1', [
      userBId,
    ]);
    // Pinned UPDATE matched zero rows → target still at the epoch baseline.
    expect(new Date(row.rows[0].password_changed_at).getTime()).toBeLessThan(Date.now() - 30000);
  });

  it('SAD: unknown user id → 404', async () => {
    // WHO: an owner | WHAT: revoke a well-formed but nonexistent user_id | WHEN:
    // stale UI / typo | WHERE: assertRowAffected on the zero-row UPDATE | WHY:
    // must 404 (never a silent 200), matching the cross-tenant case so the two
    // are indistinguishable to a probe.
    const res = await app.inject({
      method: 'POST',
      url: '/users/00000000-0000-4000-8000-000000000000/revoke-sessions',
      headers: { Authorization: `Bearer ${ownerToken()}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('SAD: anonymous request → 401 before any tenant resolution', async () => {
    // WHO: an unauthenticated caller | WHAT: POST /users/:id/revoke-sessions with
    // no token | WHEN: a probe | WHERE: the JWT auth hook, which runs before any
    // tenant/owner check | WHY: auth must be enforced ahead of tenant resolution
    // so an anon caller can't reach the owner-gated handler at all.
    const res = await app.inject({
      method: 'POST',
      url: `/users/${deskAId}/revoke-sessions`,
    });
    expect(res.statusCode).toBe(401);
  });
});
