/**
 * Multi-tenant isolation probe.
 *
 * Goal: exercise every cross-tenant attack shape against the real Fastify
 * route stack + real Postgres (test_db) + real RLS, and assert that no
 * row from tenant B reaches a caller authenticated as tenant A.
 *
 * Why this exists: TODO.md "Pre-launch validation → Multi-tenant isolation
 * verification in production-like environment" — the RLS contract is pinned
 * at the DB level by `src/rls.test.ts` (direct SQL, api_user role), but
 * leaks at the *application* layer (a route that takes tenant_id from a
 * query string instead of the JWT, an RPC that bypasses RLS, an existence
 * check the caller can probe) would not be caught there. This file is the
 * route-layer probe.
 *
 * Shape: build a Fastify app that mirrors the production wiring
 * (`registerJwtAuthHook` + `tenantMiddleware` + the route modules) against
 * a Pool that connects as `api_user` to test_db so RLS actually applies.
 * Seed two tenants with sensitive data, mint a JWT for each tenant's
 * owner, then drive every cross-tenant probe via `app.inject()`.
 *
 * 5W context for sad-path failures:
 *   WHO   — caller authenticated as tenant A
 *   WHAT  — attempting to read / mutate / FK-inject tenant B's data
 *   WHEN  — every authenticated request — this is the load-bearing case
 *   WHERE — route handler + tenantMiddleware + withTenantClient seam
 *   WHY   — a cross-tenant leak at any of these layers would be a
 *           catastrophic data breach in beta; pinning the contract here
 *           catches regressions before they reach production
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { Client, Pool } from 'pg';
import {
  API_DB_URL,
  getRootClient,
  clearDB,
  createTenant,
  createCustomer,
  createEmployee,
  createService,
  createResource,
  createAppointment,
  createUser,
} from './test-utils';
import { registerJwtAuthHook, tenantMiddleware, generateToken } from './middleware';
import { createWithTenantClient } from './database';
import { registerCustomerRoutes } from './routes/customers';
import { registerEmployeeRoutes } from './routes/employees';
import { registerServiceRoutes } from './routes/services';
import { registerResourceRoutes } from './routes/resources';
import { registerAppointmentRoutes } from './routes/appointments';
import { registerSkillRoutes } from './routes/skills';
import { registerKnowledgeRoutes } from './routes/knowledge';
import { registerUserRoutes } from './routes/users';
import { registerShiftRoutes } from './routes/shifts';
import { registerTenantRoutes } from './routes/tenants';
import { SUPER_ADMIN_TENANT_ID } from './constants';

interface TenantFixture {
  id: string;
  userId: string;
  token: string;
  customerId: string;
  employeeId: string;
  serviceId: string;
  resourceId: string;
  appointmentId: string;
  skillId: string;
  knowledgeDocId: string;
}

let setup: Client;
let pool: Pool;
let app: FastifyInstance;
let A: TenantFixture;
let B: TenantFixture;
let superAdminToken: string;
let dbAvailable = false;

// Stub embedding + normalizer for knowledge routes — knowledge writes call
// these but the probe never asserts on embeddings, so a fixed-vector stub
// keeps tests offline + deterministic.
const stubEmbedding = async (_text: string): Promise<number[]> => new Array(1536).fill(0);
const stubNormalizer = async (text: string): Promise<string> => text;

async function seedTenant(client: Client, label: string, businessType: string): Promise<TenantFixture> {
  const tenantId = await createTenant(client, `${label}-Co`, businessType);
  const userId = await createUser(client, tenantId, `owner-${label.toLowerCase()}@probe.test`, 'pw', `${label} Owner`);
  const token = generateToken({
    tenant_id: tenantId,
    user_id: userId,
    email: `owner-${label.toLowerCase()}@probe.test`,
    role: 'owner',
  });

  const customerId = await createCustomer(client, tenantId, `${label}-Secret-Customer`, `+1555${label.charCodeAt(0)}001234`);
  const employeeId = await createEmployee(client, tenantId, `${label}-Tech`, ['repair']);
  const serviceId = await createService(client, tenantId, `${label}-Service`, 60);
  const resourceId = await createResource(client, tenantId, `${label}-Bay-1`);

  // Appointment uses a far-future date so business-hours / past-time
  // RPC checks never block the seed.
  const aptStart = '2030-06-15T15:00:00Z';
  const aptEnd = '2030-06-15T16:00:00Z';
  const appointmentId = await createAppointment(
    client, tenantId, resourceId, customerId, aptStart, aptEnd,
    `${label}-Appointment`, 'scheduled', employeeId
  );

  const skillRes = await client.query(
    `INSERT INTO tenant_skills (tenant_id, name) VALUES ($1, $2) RETURNING tenant_skill_id`,
    [tenantId, `${label}-special-skill`]
  );
  const skillId = skillRes.rows[0].tenant_skill_id;

  // Knowledge doc — search_tenant_docs RPC uses pgvector cosine similarity.
  // We seed with a zero-vector embedding stub so the RPC has something to
  // return for cross-tenant probes.
  const docRes = await client.query(
    `INSERT INTO tenant_docs (tenant_id, title, content, embedding)
     VALUES ($1, $2, $3, $4::vector) RETURNING tenant_doc_id`,
    [
      tenantId,
      `${label}-Secret-Policy`,
      `${label} confidential refund policy text`,
      `[${new Array(1536).fill(0).join(',')}]`,
    ]
  );
  const knowledgeDocId = docRes.rows[0].tenant_doc_id;

  return {
    id: tenantId,
    userId,
    token,
    customerId,
    employeeId,
    serviceId,
    resourceId,
    appointmentId,
    skillId,
    knowledgeDocId,
  };
}

beforeAll(async () => {
  try {
    setup = await getRootClient();
    // Sanity check: the tables we need must exist. If the DB is fresh
    // without migrations applied, skip the suite cleanly rather than
    // surface confusing INSERT errors.
    const probe = await setup.query(
      "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'customers')"
    );
    if (!probe.rows[0].exists) {
      console.warn('[multi-tenant-isolation] migrations not applied, skipping');
      return;
    }
    await clearDB(setup);

    A = await seedTenant(setup, 'A', 'mobile-tire');
    B = await seedTenant(setup, 'B', 'salon');
    superAdminToken = generateToken({
      tenant_id: SUPER_ADMIN_TENANT_ID,
      user_id: '00000000-0000-0000-0000-000000000001',
      email: 'admin@probe.test',
      role: 'owner',
    });

    // Real Pool against test_db. api_user role so RLS is fully enforced.
    pool = new Pool({ connectionString: API_DB_URL, max: 10 });

    app = Fastify({ logger: false });
    registerJwtAuthHook(app, pool);
    tenantMiddleware(app);
    const withTenantClient = createWithTenantClient(pool);
    registerCustomerRoutes(app, pool, withTenantClient);
    registerEmployeeRoutes(app, pool, withTenantClient);
    registerServiceRoutes(app, pool, withTenantClient);
    registerResourceRoutes(app, pool, withTenantClient);
    registerAppointmentRoutes(app, pool, withTenantClient);
    registerSkillRoutes(app, pool, withTenantClient);
    registerKnowledgeRoutes(app, pool, stubEmbedding, withTenantClient, stubNormalizer);
    registerUserRoutes(app, pool, withTenantClient);
    registerShiftRoutes(app, pool, withTenantClient);
    registerTenantRoutes(app, pool);
    await app.ready();

    dbAvailable = true;
  } catch (err) {
    console.warn('[multi-tenant-isolation] DB not available:', err);
  }
});

afterAll(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
  if (setup) await setup.end();
});

// ─────────────────────────────────────────────────────────────────────────
// Probe 1: tenant_id query-param override
//
// The `tenantMiddleware` precedence is `query > body > JWT`. If the route
// layer doesn't re-verify that req.auth.tenant_id matches req.tenantId,
// then any authenticated user can read another tenant's data simply by
// passing `?tenant_id=<victim>`.
// ─────────────────────────────────────────────────────────────────────────

describe('Probe 1: tenant_id query-param override under non-admin JWT', () => {
  it('SAD: GET /customers?tenant_id=<B> under A JWT must not return B-Secret-Customer', async () => {
    // WHO: caller authenticated as tenant A (non-admin owner)
    // WHAT: appends ?tenant_id=<B-uuid> to the URL, hoping the server
    //       trusts the query string over the JWT
    // WHEN: any GET request — the middleware override is request-time
    // WHERE: src/middleware.ts tenantMiddleware (query > body > JWT) +
    //        src/routes/customers.ts GET /customers
    // WHY: this is the highest-impact leak shape — a non-admin user
    //      should NEVER be able to read another tenant's customers.
    //      The dashboard uses ?tenant_id=<self> for legitimate calls,
    //      but the server must reject ?tenant_id=<other> unless the
    //      caller is super-admin.
    if (!dbAvailable) return;

    const res = await app.inject({
      method: 'GET',
      url: `/customers?tenant_id=${B.id}`,
      headers: { authorization: `Bearer ${A.token}` },
    });

    // Acceptable outcomes (any one):
    //   (a) 403 Forbidden — explicit cross-tenant rejection
    //   (b) 200 with empty / A-only rows — the override silently scoped to A
    //   (c) 400 — middleware rejected the override
    // UNACCEPTABLE: 200 with B-Secret-Customer in the response.
    expect(res.statusCode).not.toBe(500);
    if (res.statusCode === 200) {
      const body = res.json() as Array<{ name: string; tenant_id: string }>;
      const leaked = body.filter(r => r.tenant_id === B.id || r.name === 'B-Secret-Customer');
      expect(leaked).toEqual([]);
    } else {
      expect([400, 403]).toContain(res.statusCode);
    }
  });

  it('SAD: GET /employees?tenant_id=<B> under A JWT must not return B-Tech', async () => {
    if (!dbAvailable) return;
    const res = await app.inject({
      method: 'GET',
      url: `/employees?tenant_id=${B.id}`,
      headers: { authorization: `Bearer ${A.token}` },
    });
    expect(res.statusCode).not.toBe(500);
    if (res.statusCode === 200) {
      const body = res.json() as Array<{ name: string }>;
      const leaked = body.filter(r => r.name === 'B-Tech');
      expect(leaked).toEqual([]);
    } else {
      expect([400, 403]).toContain(res.statusCode);
    }
  });

  it('SAD: GET /services?tenant_id=<B> under A JWT must not return B-Service', async () => {
    if (!dbAvailable) return;
    const res = await app.inject({
      method: 'GET',
      url: `/services?tenant_id=${B.id}`,
      headers: { authorization: `Bearer ${A.token}` },
    });
    expect(res.statusCode).not.toBe(500);
    if (res.statusCode === 200) {
      const body = res.json() as Array<{ name: string }>;
      expect(body.filter(r => r.name === 'B-Service')).toEqual([]);
    } else {
      expect([400, 403]).toContain(res.statusCode);
    }
  });

  it('SAD: GET /resources?tenant_id=<B> under A JWT must not return B-Bay-1', async () => {
    if (!dbAvailable) return;
    const res = await app.inject({
      method: 'GET',
      url: `/resources?tenant_id=${B.id}`,
      headers: { authorization: `Bearer ${A.token}` },
    });
    expect(res.statusCode).not.toBe(500);
    if (res.statusCode === 200) {
      const body = res.json() as Array<{ name: string }>;
      expect(body.filter(r => r.name === 'B-Bay-1')).toEqual([]);
    } else {
      expect([400, 403]).toContain(res.statusCode);
    }
  });

  it('SAD: GET /appointments?tenant_id=<B> under A JWT must not return B-Appointment', async () => {
    if (!dbAvailable) return;
    const res = await app.inject({
      method: 'GET',
      url: `/appointments?tenant_id=${B.id}`,
      headers: { authorization: `Bearer ${A.token}` },
    });
    expect(res.statusCode).not.toBe(500);
    if (res.statusCode === 200) {
      const body = res.json();
      const rows = Array.isArray(body) ? body : (body.appointments || body.rows || []);
      expect((rows as Array<{ description?: string }>).filter(r => r.description === 'B-Appointment')).toEqual([]);
    } else {
      expect([400, 403]).toContain(res.statusCode);
    }
  });

  it('SAD: GET /skills?tenant_id=<B> under A JWT must not return B-special-skill', async () => {
    if (!dbAvailable) return;
    const res = await app.inject({
      method: 'GET',
      url: `/skills?tenant_id=${B.id}`,
      headers: { authorization: `Bearer ${A.token}` },
    });
    expect(res.statusCode).not.toBe(500);
    if (res.statusCode === 200) {
      const body = res.json() as Array<{ name: string }>;
      expect(body.filter(r => r.name === 'B-special-skill')).toEqual([]);
    } else {
      expect([400, 403]).toContain(res.statusCode);
    }
  });

  it('SAD: GET /knowledge?tenant_id=<B> under A JWT must not return B-Secret-Policy', async () => {
    if (!dbAvailable) return;
    const res = await app.inject({
      method: 'GET',
      url: `/knowledge?tenant_id=${B.id}`,
      headers: { authorization: `Bearer ${A.token}` },
    });
    expect(res.statusCode).not.toBe(500);
    if (res.statusCode === 200) {
      const body = res.json();
      const rows = Array.isArray(body) ? body : (body.docs || body.rows || []);
      expect((rows as Array<{ title?: string }>).filter(r => r.title === 'B-Secret-Policy')).toEqual([]);
    } else {
      expect([400, 403]).toContain(res.statusCode);
    }
  });

  it('SAD: GET /users?tenant_id=<B> under A JWT must not return B owner', async () => {
    if (!dbAvailable) return;
    const res = await app.inject({
      method: 'GET',
      url: `/users?tenant_id=${B.id}`,
      headers: { authorization: `Bearer ${A.token}` },
    });
    expect(res.statusCode).not.toBe(500);
    if (res.statusCode === 200) {
      const body = res.json();
      const rows = Array.isArray(body) ? body : (body.users || []);
      expect((rows as Array<{ email?: string }>).filter(r => r.email === 'owner-b@probe.test')).toEqual([]);
    } else {
      expect([400, 403]).toContain(res.statusCode);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Probe 2: cross-tenant ID under JWT-only (no override)
//
// Even without the query-param override, RLS should hide B's rows from
// A. A GET / DELETE / PATCH on a B-owned id should 404 — never 200, never
// silent success.
// ─────────────────────────────────────────────────────────────────────────

describe('Probe 2: cross-tenant id under A JWT (no override)', () => {
  it('SAD: DELETE /employees/:b-id/delete under A JWT must 404 and leave B row intact', async () => {
    // WHO: tenant A user passes tenant B's employee id to DELETE
    // WHAT: route's UPDATE-with-tenant_id-filter sees rowCount=0 → 404
    // WHEN: any cross-tenant id-guess attempt
    // WHERE: src/routes/employees.ts DELETE /employees/:id/delete +
    //        RLS policy on employees
    // WHY: route uses `WHERE id = $1 AND tenant_id = $2` so even without
    //      RLS the filter rejects; RLS is defense-in-depth. Either way
    //      the response must be 404 and B's row must remain.
    if (!dbAvailable) return;

    const res = await app.inject({
      method: 'DELETE',
      url: `/employees/${B.employeeId}/delete`,
      headers: { authorization: `Bearer ${A.token}` },
    });
    expect(res.statusCode).toBe(404);

    // Verify B's employee is intact via root client
    const check = await setup.query('SELECT is_deleted FROM employees WHERE employee_id = $1', [B.employeeId]);
    expect(check.rows[0].is_deleted).toBe(false);
  });

  it('SAD: DELETE /resources/:b-id/delete under A JWT must 404 and leave B row intact', async () => {
    if (!dbAvailable) return;
    const res = await app.inject({
      method: 'DELETE',
      url: `/resources/${B.resourceId}/delete`,
      headers: { authorization: `Bearer ${A.token}` },
    });
    expect(res.statusCode).toBe(404);
    const check = await setup.query('SELECT is_deleted FROM resources WHERE resource_id = $1', [B.resourceId]);
    expect(check.rows[0].is_deleted).toBe(false);
  });

  it('SAD: DELETE /services/:b-id/delete under A JWT must 404 and leave B row intact', async () => {
    if (!dbAvailable) return;
    const res = await app.inject({
      method: 'DELETE',
      url: `/services/${B.serviceId}/delete`,
      headers: { authorization: `Bearer ${A.token}` },
    });
    expect(res.statusCode).toBe(404);
    const check = await setup.query('SELECT is_deleted FROM services WHERE service_id = $1', [B.serviceId]);
    expect(check.rows[0].is_deleted).toBe(false);
  });

  it('SAD: DELETE /skills/:b-id under A JWT must 404 and leave B row intact', async () => {
    if (!dbAvailable) return;
    const res = await app.inject({
      method: 'DELETE',
      url: `/skills/${B.skillId}`,
      headers: { authorization: `Bearer ${A.token}` },
    });
    expect(res.statusCode).toBe(404);
    const check = await setup.query('SELECT name FROM tenant_skills WHERE tenant_skill_id = $1', [B.skillId]);
    expect(check.rows[0]?.name).toBe('B-special-skill');
  });

  it('SAD: DELETE /knowledge/:b-id under A JWT must 404 and leave B doc intact', async () => {
    if (!dbAvailable) return;
    const res = await app.inject({
      method: 'DELETE',
      url: `/knowledge/${B.knowledgeDocId}`,
      headers: { authorization: `Bearer ${A.token}` },
    });
    expect(res.statusCode).toBe(404);
    const check = await setup.query('SELECT title FROM tenant_docs WHERE tenant_doc_id = $1', [B.knowledgeDocId]);
    expect(check.rows[0]?.title).toBe('B-Secret-Policy');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Probe 3: cross-tenant FK injection on POST
//
// A cleverer attack: POST /customers/create with body.tenant_id = <B>.
// The customers route does `withTenantClient(body.tenant_id, ...)` — if
// nothing checks that body.tenant_id matches the JWT's tenant_id, an
// attacker can create rows under another tenant.
// ─────────────────────────────────────────────────────────────────────────

describe('Probe 3: cross-tenant FK injection via POST body', () => {
  it('SAD: POST /customers/create with body.tenant_id=<B> under A JWT must not insert into B', async () => {
    // WHO: tenant A user posts a customer with body.tenant_id = B
    // WHAT: route reads body.tenant_id directly into withTenantClient,
    //       inserts under B if no auth check exists
    // WHEN: any cross-tenant write probe — easy to script
    // WHERE: src/routes/customers.ts POST /customers/create line ~72
    // WHY: a write under another tenant is even worse than a read leak —
    //      attacker can plant fake customers, ride on B's voice agent,
    //      pollute B's CRM sync. RLS WITH CHECK is the last line of
    //      defense; the route should also reject.
    if (!dbAvailable) return;

    const beforeCount = await setup.query(
      'SELECT COUNT(*) FROM customers WHERE tenant_id = $1',
      [B.id]
    );

    const res = await app.inject({
      method: 'POST',
      url: '/customers/create',
      headers: { authorization: `Bearer ${A.token}`, 'content-type': 'application/json' },
      payload: {
        tenant_id: B.id,
        name: 'Injected-Hostile-Customer',
        phone: '+15559999999',
      },
    });

    // Must reject. Acceptable: 400 / 403. Unacceptable: 200 with insert.
    expect([400, 403]).toContain(res.statusCode);

    const afterCount = await setup.query(
      'SELECT COUNT(*) FROM customers WHERE tenant_id = $1',
      [B.id]
    );
    expect(afterCount.rows[0].count).toBe(beforeCount.rows[0].count);

    const check = await setup.query(
      "SELECT customer_id FROM customers WHERE name = 'Injected-Hostile-Customer'"
    );
    expect(check.rows).toHaveLength(0);
  });

  it('SAD: POST /employees/create with body.tenant_id=<B> under A JWT must not insert into B', async () => {
    if (!dbAvailable) return;
    const beforeCount = await setup.query(
      'SELECT COUNT(*) FROM employees WHERE tenant_id = $1',
      [B.id]
    );

    const res = await app.inject({
      method: 'POST',
      url: '/employees/create',
      headers: { authorization: `Bearer ${A.token}`, 'content-type': 'application/json' },
      payload: { tenant_id: B.id, first_name: 'Injected', last_name: 'Hostile' },
    });

    expect([400, 403]).toContain(res.statusCode);

    const afterCount = await setup.query(
      'SELECT COUNT(*) FROM employees WHERE tenant_id = $1',
      [B.id]
    );
    expect(afterCount.rows[0].count).toBe(beforeCount.rows[0].count);
  });

  it('SAD: POST /services/create with body.tenant_id=<B> under A JWT must not insert into B', async () => {
    if (!dbAvailable) return;
    const beforeCount = await setup.query(
      'SELECT COUNT(*) FROM services WHERE tenant_id = $1',
      [B.id]
    );

    const res = await app.inject({
      method: 'POST',
      url: '/services/create',
      headers: { authorization: `Bearer ${A.token}`, 'content-type': 'application/json' },
      payload: { tenant_id: B.id, name: 'Injected-Service', duration_minutes: 30 },
    });

    expect([400, 403]).toContain(res.statusCode);

    const afterCount = await setup.query(
      'SELECT COUNT(*) FROM services WHERE tenant_id = $1',
      [B.id]
    );
    expect(afterCount.rows[0].count).toBe(beforeCount.rows[0].count);
  });

  it('SAD: POST /resources/create with body.tenant_id=<B> under A JWT must not insert into B', async () => {
    if (!dbAvailable) return;
    const beforeCount = await setup.query(
      'SELECT COUNT(*) FROM resources WHERE tenant_id = $1',
      [B.id]
    );

    const res = await app.inject({
      method: 'POST',
      url: '/resources/create',
      headers: { authorization: `Bearer ${A.token}`, 'content-type': 'application/json' },
      payload: { tenant_id: B.id, name: 'Injected-Bay' },
    });

    expect([400, 403]).toContain(res.statusCode);

    const afterCount = await setup.query(
      'SELECT COUNT(*) FROM resources WHERE tenant_id = $1',
      [B.id]
    );
    expect(afterCount.rows[0].count).toBe(beforeCount.rows[0].count);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Probe 4: positive controls — confirm the legitimate paths still work
//
// Every probe above asserts a *negative* — leaks must not happen. This
// section pins the *positive* contracts so a fix that just blanket-rejects
// every override would fail this section instead of the leak section.
// ─────────────────────────────────────────────────────────────────────────

describe('Probe 4: positive controls (legitimate paths must still work)', () => {
  it('HAPPY: A token + ?tenant_id=<A> on GET /customers returns A-Secret-Customer', async () => {
    if (!dbAvailable) return;
    const res = await app.inject({
      method: 'GET',
      url: `/customers?tenant_id=${A.id}`,
      headers: { authorization: `Bearer ${A.token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ name: string }>;
    expect(body.find(r => r.name === 'A-Secret-Customer')).toBeTruthy();
  });

  it('HAPPY: A token (no override) on GET /customers returns A-Secret-Customer only', async () => {
    if (!dbAvailable) return;
    const res = await app.inject({
      method: 'GET',
      url: `/customers`,
      headers: { authorization: `Bearer ${A.token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ name: string }>;
    expect(body.find(r => r.name === 'A-Secret-Customer')).toBeTruthy();
    expect(body.find(r => r.name === 'B-Secret-Customer')).toBeUndefined();
  });

  it('HAPPY: super-admin token + ?tenant_id=<A> on GET /customers returns A-Secret-Customer', async () => {
    // WHO: super-admin acting on behalf of tenant A
    // WHAT: ?tenant_id=<A> override is the legitimate dashboard pattern
    //       for cross-tenant admin views
    // WHEN: any super-admin operation on a tenant they don't directly own
    // WHERE: src/middleware.ts tenantMiddleware + super-admin JWT
    // WHY: any fix to Probe 1 must NOT break this case — super-admin
    //      tooling depends on the override to scope cross-tenant queries.
    if (!dbAvailable) return;
    const res = await app.inject({
      method: 'GET',
      url: `/customers?tenant_id=${A.id}`,
      headers: { authorization: `Bearer ${superAdminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ name: string }>;
    expect(body.find(r => r.name === 'A-Secret-Customer')).toBeTruthy();
  });

  it('HAPPY: super-admin token + ?tenant_id=<B> on GET /customers returns B-Secret-Customer', async () => {
    if (!dbAvailable) return;
    const res = await app.inject({
      method: 'GET',
      url: `/customers?tenant_id=${B.id}`,
      headers: { authorization: `Bearer ${superAdminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ name: string }>;
    expect(body.find(r => r.name === 'B-Secret-Customer')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Probe 5: admin-only routes (/tenants/*) — super-admin gating
//
// /tenants/* is exempt from tenantMiddleware and gated only by
// requireAuth(), which checks "is authenticated" — not "is super-admin".
// So a regular tenant user with a valid JWT could potentially list every
// tenant or DELETE another tenant entirely. These probes confirm whether
// the gate is missing.
// ─────────────────────────────────────────────────────────────────────────

describe('Probe 5: admin-only /tenants/* routes must reject non-admins', () => {
  it('SAD: GET /tenants under A JWT must not list every tenant', async () => {
    // WHO: tenant A user with a valid JWT (not super-admin)
    // WHAT: GET /tenants returns the full tenant table
    // WHEN: any authenticated request, regardless of tenant ownership
    // WHERE: src/routes/tenants.ts GET /tenants — only requireAuth gate
    // WHY: a non-admin must NOT be able to enumerate every tenant in the
    //      system; that's a competitive-intelligence leak (every customer
    //      name + business type + voice config) on top of any data
    //      sensitivity. Super-admin only.
    if (!dbAvailable) return;
    const res = await app.inject({
      method: 'GET',
      url: '/tenants',
      headers: { authorization: `Bearer ${A.token}` },
    });
    expect([401, 403]).toContain(res.statusCode);
  });

  it('SAD: DELETE /tenants/<B> under A JWT must not delete tenant B', async () => {
    if (!dbAvailable) return;
    const beforeRow = await setup.query('SELECT tenant_id FROM tenants WHERE tenant_id = $1', [B.id]);
    expect(beforeRow.rows).toHaveLength(1);

    const res = await app.inject({
      method: 'DELETE',
      url: `/tenants/${B.id}`,
      headers: { authorization: `Bearer ${A.token}` },
    });
    expect([401, 403]).toContain(res.statusCode);

    const afterRow = await setup.query('SELECT tenant_id FROM tenants WHERE tenant_id = $1', [B.id]);
    expect(afterRow.rows).toHaveLength(1);
  });

  it('SAD: POST /tenants/reorder under A JWT must reject', async () => {
    if (!dbAvailable) return;
    const res = await app.inject({
      method: 'POST',
      url: '/tenants/reorder',
      headers: { authorization: `Bearer ${A.token}`, 'content-type': 'application/json' },
      payload: { order: [B.id, A.id] },
    });
    expect([401, 403]).toContain(res.statusCode);
  });

  it('HAPPY: GET /tenants under super-admin JWT returns all tenants', async () => {
    if (!dbAvailable) return;
    const res = await app.inject({
      method: 'GET',
      url: '/tenants',
      headers: { authorization: `Bearer ${superAdminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ tenant_id: string }>;
    expect(body.find(r => r.tenant_id === A.id)).toBeTruthy();
    expect(body.find(r => r.tenant_id === B.id)).toBeTruthy();
  });
});

// ────────────────────────────────────────────────────────────────────────
// Probe 6: RLS configuration verified for tables fixed 2026-05-09
//
// Production runs against Supabase-managed Postgres where the `postgres`
// role is non-superuser + non-BYPASSRLS, so FORCE RLS applies and the
// per-tenant policies enforce isolation. The local test Postgres uses a
// SUPERUSER+BYPASSRLS `postgres` role which always bypasses RLS — making
// behavioral cross-tenant tests under that role meaningless locally.
//
// What we CAN test locally is the RLS configuration — the metadata flags
// in pg_class and pg_policies — which proves the migrations applied and
// would catch a future migration that drops them. Behavioral verification
// against managed Postgres has to happen post-deploy via the api_user-
// flavored probes that already exist (Probes 1-5).
// ────────────────────────────────────────────────────────────────────────

describe('Probe 6: RLS configuration on tables fixed 2026-05-09', () => {
  it('voice_sessions has ENABLE + FORCE row-level security applied', async () => {
    // WHO: future migration author who might accidentally drop FORCE while
    //        renaming or restructuring voice_sessions
    // WHAT: pin the metadata flags so a missing FORCE on this table
    //        regresses the test loudly instead of silently exposing
    //        cross-tenant call data on managed Postgres
    // WHEN: every test run after the migrations are applied
    // WHERE: 20260509000001_force_rls_voice_sessions_record_versions.sql
    // WHY: the policy on voice_sessions has existed since 2026-04-09, but
    //        FORCE was only added 2026-05-09 — a regression that drops
    //        FORCE wouldn't break anything observable in api_user-mediated
    //        tests but would re-open the leak on managed Postgres.
    if (!dbAvailable) return;
    const res = await setup.query(
      `SELECT relrowsecurity, relforcerowsecurity
         FROM pg_class WHERE relname = $1`,
      ['voice_sessions']
    );
    expect(res.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it('record_versions has ENABLE + FORCE row-level security applied', async () => {
    // Same shape as voice_sessions — closes the same FORCE-not-applied
    // gap from migration 20260409100000 via the 2026-05-09 fix.
    if (!dbAvailable) return;
    const res = await setup.query(
      `SELECT relrowsecurity, relforcerowsecurity
         FROM pg_class WHERE relname = $1`,
      ['record_versions']
    );
    expect(res.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it('password_resets has ENABLE + FORCE + unauthenticated-only policy', async () => {
    // WHO: any future caller that tries to read password_resets from a
    //        tenant-context-set connection
    // WHAT: pin (a) RLS is enabled, (b) FORCE is on, (c) at least one
    //        policy exists with the exact name the migration created
    // WHEN: every test run after the migrations are applied
    // WHERE: 20260509000000_password_resets_rls.sql
    // WHY: pre-fix the table had ZERO RLS — any connection could read
    //        all reset tokens. The fix added ENABLE + FORCE + a policy
    //        that allows access only when app.current_tenant_id is empty.
    //        A regression that drops any of those three facets re-opens
    //        the leak; pinning the metadata catches it.
    if (!dbAvailable) return;
    const flagRes = await setup.query(
      `SELECT relrowsecurity, relforcerowsecurity
         FROM pg_class WHERE relname = $1`,
      ['password_resets']
    );
    expect(flagRes.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });

    const policyRes = await setup.query(
      `SELECT policyname FROM pg_policies WHERE tablename = $1`,
      ['password_resets']
    );
    const names = (policyRes.rows as Array<{ policyname: string }>).map((r) => r.policyname);
    expect(names).toContain('password_resets_unauthenticated_only');
  });

  it('positive control: forgot-password flow still works (INSERT + SELECT under empty context)', async () => {
    // WHY: the policy added 2026-05-09 must NOT break the legitimate
    //        unauthenticated /forgot-password and /reset-password flows.
    //        Both run via withPoolClient (no setTenantContext call), so
    //        app.current_tenant_id stays at its session default. With
    //        the BYPASSRLS local postgres this would always pass; the
    //        real value of this test is documenting the contract — if
    //        someone ever switches the test role to api_user, this
    //        test continues to gate against an over-strict policy.
    if (!dbAvailable) return;

    // Use api_user via pool so the test is meaningful under non-BYPASSRLS.
    const client = await pool.connect();
    try {
      await client.query(`SELECT set_config('app.current_tenant_id', '', false)`);
      await client.query(
        `INSERT INTO password_resets (user_id, token_hash, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
        [A.userId, 'probe6-positive-token']
      );
      const res = await client.query(
        `SELECT user_id FROM password_resets WHERE token_hash = $1`,
        ['probe6-positive-token']
      );
      expect(res.rows, 'unauthenticated flow MUST be able to read password_resets').toHaveLength(1);
      expect(res.rows[0].user_id).toBe(A.userId);
      await client.query(`DELETE FROM password_resets WHERE token_hash = $1`, [
        'probe6-positive-token',
      ]);
    } finally {
      client.release();
    }
  });
});
