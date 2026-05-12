/**
 * E2E coverage for multi-tenant isolation at the live API surface.
 *
 * Why this exists: src/multi-tenant-isolation.test.ts (25 tests, shipped
 * 2026-05-06) is comprehensive at the unit level and pins the
 * tenantMiddleware + RLS gate against a real Postgres. But the unit
 * probe stubs the auth layer — it doesn't exercise the JWT cookie flow
 * or prove that a real running stack rejects URL-hacked requests.
 * If a future refactor breaks the gate at runtime (e.g. middleware
 * order in src/index.ts changes), the unit tests would still pass.
 *
 * These tests log in as a real tenant user, get a real JWT, then try
 * the two highest-risk leak shapes the May-6 probe found:
 *   1. ?tenant_id=<other> query override on a GET — must 403
 *   2. body.tenant_id=<other> on a POST — must 403
 *   3. GET /tenants as a non-super-admin — must 403
 *
 * Each test is fully self-contained per the test-isolation memory:
 * creates its own per-tenant data in setup, asserts, deletes in
 * teardown. Any test runs independently in any order.
 */
import { test, expect, Page } from '@playwright/test';
import { Pool } from 'pg';

const DYNATIRE_ID = 'f234e471-0e60-4163-86c9-93cfd9338e3a';
const SUPER_ADMIN_ID = '00000000-0000-0000-0000-000000000000';
// "Other tenant" ID is discovered at runtime — the seed creates Bella's
// Hair Studio with a randomly-generated UUID inside a DO $$ block, so the
// id varies per seed run (and with `ON CONFLICT DO NOTHING` on (id), two
// seed runs can leave two Bella's tenants in the DB). Dynamic lookup
// gives us a stable handle independent of seed history.
let OTHER_TENANT_ID: string;
const PG_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/postgres';
const BACKEND_URL = 'https://localhost:4001';

let pool: Pool;

function uniqueTag(): string {
  return `e2e-iso-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

/**
 * Get a JWT for a real tenant user via the /login route. Different from
 * other specs' getApiToken — this one returns the full response so the
 * test can assert on the auth payload's tenant_id (catches a regression
 * where login leaks the wrong tenant_id into the JWT).
 */
async function loginAs(page: Page, email: string, password: string): Promise<{
  token: string;
  tenant_id: string;
  role: string;
}> {
  const result = await page.evaluate(
    async ({ url, email, password }) => {
      const res = await fetch(`${url}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      return await res.json();
    },
    { url: BACKEND_URL, email, password }
  );
  if (!result?.token) throw new Error(`Login failed: ${JSON.stringify(result)}`);
  return result;
}

async function apiGet(
  page: Page,
  token: string,
  path: string
): Promise<{ status: number; body: Record<string, unknown> | unknown[] }> {
  return await page.evaluate(
    async ({ url, token, path }) => {
      const res = await fetch(`${url}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      return { status: res.status, body };
    },
    { url: BACKEND_URL, token, path }
  );
}

async function apiPost(
  page: Page,
  token: string,
  path: string,
  body: Record<string, unknown>
): Promise<{ status: number; body: Record<string, unknown> }> {
  return await page.evaluate(
    async ({ url, token, path, body }) => {
      const res = await fetch(`${url}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const responseBody = await res.json().catch(() => ({}));
      return { status: res.status, body: responseBody };
    },
    { url: BACKEND_URL, token, path, body }
  );
}

test.beforeAll(async () => {
  pool = new Pool({ connectionString: PG_URL });
  // Discover a non-DynaTire, non-super-admin tenant for the cross-tenant
  // probe. Picks the first match by created_at to be deterministic across
  // re-runs. Fails the spec early if there's only one tenant in the DB.
  const r = await pool.query(
    `SELECT tenant_id AS id FROM tenants
      WHERE tenant_id != $1 AND tenant_id != $2
      ORDER BY created_at ASC LIMIT 1`,
    [DYNATIRE_ID, SUPER_ADMIN_ID]
  );
  if (r.rowCount === 0) {
    throw new Error(
      'No second tenant exists for cross-tenant isolation probe — re-run seed-db.sh'
    );
  }
  OTHER_TENANT_ID = r.rows[0].id;
});
test.afterAll(async () => {
  await pool.end();
});

// ────────────────────────────────────────────────────────────────────────────
// 1. Query-string ?tenant_id=<other> override is rejected
// ────────────────────────────────────────────────────────────────────────────
test('isolation: ?tenant_id=<other tenant> on GET is rejected with 403', async ({ page }) => {
  // WHO: malicious or curious DynaTire user trying to peek at Bella's
  //        customer list by URL-hacking the tenant_id query param
  // WHAT: the tenantMiddleware gate (src/middleware.ts, added 2026-05-06)
  //        must 403 any cross-tenant override unless the caller is super-admin
  // WHEN: any GET /customers, /employees, /resources, /appointments, etc.
  //        with ?tenant_id=<not-my-tenant>
  // WHERE: tenantMiddleware precedence: query > body > JWT, gated by role
  // WHY: the May-6 unit probe found 8 read-leak shapes before this gate
  //        existed. This test pins the runtime behavior — if a refactor
  //        re-orders middleware or drops the role check, this fails fast.
  const tag = uniqueTag();
  let bellaCustomerId: string | null = null;

  try {
    // Setup: insert a customer in Bella's tenant that we'll try to leak.
    const ins = await pool.query(
      `INSERT INTO customers (tenant_id, name, phone)
       VALUES ($1, $2, $3) RETURNING customer_id AS id`,
      [OTHER_TENANT_ID, `${tag}-other-secret`, '+15551112222']
    );
    bellaCustomerId = ins.rows[0].id;

    // Login as DynaTire user — gets JWT scoped to DynaTire.
    const auth = await loginAs(page, 'admin@dynatire.com', 'password');
    expect(auth.tenant_id).toBe(DYNATIRE_ID);

    // Sanity: same call WITHOUT the override returns DynaTire's customers.
    const ownTenant = await apiGet(page, auth.token, '/customers');
    expect(ownTenant.status).toBe(200);
    expect(Array.isArray(ownTenant.body)).toBe(true);
    const dynatireNames = (ownTenant.body as Array<{ name?: string }>).map((c) => c.name);
    expect(dynatireNames, 'DynaTire user must NOT see Bella\'s customer in their own list').not.toContain(`${tag}-other-secret`);

    // Attack: same user tries ?tenant_id=<Bella> override.
    const cross = await apiGet(page, auth.token, `/customers?tenant_id=${OTHER_TENANT_ID}`);
    expect(cross.status, 'cross-tenant override must be 403').toBe(403);

    // Even if the body somehow returned, it must NOT contain Bella's data.
    if (Array.isArray(cross.body)) {
      const names = (cross.body as Array<{ name?: string }>).map((c) => c.name);
      expect(names).not.toContain(`${tag}-other-secret`);
    }
  } finally {
    if (bellaCustomerId) {
      await pool.query('DELETE FROM customers WHERE customer_id = $1', [bellaCustomerId]);
    }
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 2. body.tenant_id=<other> on POST is rejected (write-injection)
// ────────────────────────────────────────────────────────────────────────────
test('isolation: body.tenant_id=<other tenant> on POST /customers/create is rejected', async ({ page }) => {
  // WHO: malicious DynaTire user trying to inject a customer row under
  //        Bella's tenant_id (ghost-write attack)
  // WHAT: the same tenantMiddleware gate must 403 a cross-tenant body
  //        override; mismatched query-vs-body returns 400
  // WHEN: any mutation route that takes tenant_id in the body
  // WHERE: tenantMiddleware body-tenant_id branch
  // WHY: the May-6 probe found 4 write-injection shapes before this gate.
  //        Customer-write to another tenant would: (a) populate that
  //        tenant's CRM with fake leads, (b) seed the booking flow with
  //        an attacker-controlled phone the agent could call back to.
  //        Both of those are tracked and pinned here.
  const tag = uniqueTag();

  // Snapshot Bella's customer count before — must be unchanged after attack.
  const beforeRes = await pool.query(
    `SELECT count(*)::int AS n FROM customers WHERE tenant_id = $1`,
    [OTHER_TENANT_ID]
  );
  const beforeCount = beforeRes.rows[0].n;

  const auth = await loginAs(page, 'admin@dynatire.com', 'password');
  expect(auth.tenant_id).toBe(DYNATIRE_ID);

  // Attack: try to inject a customer into Bella's tenant.
  const inject = await apiPost(page, auth.token, '/customers/create', {
    tenant_id: OTHER_TENANT_ID,
    name: `${tag}-injected`,
    phone: '+15551112222',
  });
  expect(inject.status, 'cross-tenant write must be 403').toBe(403);

  // Bella's count is unchanged — no row got injected.
  const afterRes = await pool.query(
    `SELECT count(*)::int AS n FROM customers WHERE tenant_id = $1`,
    [OTHER_TENANT_ID]
  );
  expect(afterRes.rows[0].n).toBe(beforeCount);

  // Defense-in-depth: even if a row was somehow created, it would not
  // have the injected tag. Verify by name.
  const byName = await pool.query(
    `SELECT count(*)::int AS n FROM customers WHERE name = $1`,
    [`${tag}-injected`]
  );
  expect(byName.rows[0].n, 'injected row must not exist anywhere').toBe(0);
});

// ────────────────────────────────────────────────────────────────────────────
// 3. Non-super-admin GET /tenants is rejected
// ────────────────────────────────────────────────────────────────────────────
test('isolation: non-super-admin GET /tenants is rejected (no enumeration)', async ({ page }) => {
  // WHO: any tenant user (DynaTire owner) trying to enumerate every
  //        tenant on the platform
  // WHAT: GET /tenants must 403 unless the caller is super-admin
  // WHEN: requireSuperAdmin gate (added 2026-05-06) is applied to /tenants
  //        and other cross-tenant admin routes
  // WHERE: src/middleware.ts requireSuperAdmin + src/routes/tenants.ts
  // WHY: pre-fix, ANY authenticated user could enumerate every tenant
  //        on the platform — full customer list, voice config, billing
  //        tier visible to anyone with a JWT. Critical breach in a paying-
  //        tenant SaaS. This test pins the gate at runtime.
  const auth = await loginAs(page, 'admin@dynatire.com', 'password');
  expect(auth.tenant_id).toBe(DYNATIRE_ID);

  const res = await apiGet(page, auth.token, '/tenants');
  expect(res.status, 'tenant enumeration must be 403 for non-super-admin').toBe(403);
});

// ────────────────────────────────────────────────────────────────────────────
// 4. Positive control — super-admin CAN cross tenants by design
// ────────────────────────────────────────────────────────────────────────────
test('isolation: super-admin CAN read across tenants (positive control)', async ({ page }) => {
  // WHO: super-admin (admin@secretaryhq.com), tenant_id 0000-0000-...
  // WHAT: same query that 403s for a tenant user must succeed for super-admin
  // WHEN: any cross-tenant operation — super-admin manages all tenants
  // WHERE: tenantMiddleware role-check + requireSuperAdmin gate
  // WHY: a too-tight gate that 403s super-admin would break the management
  //        UI. This positive control catches over-correction. Without it,
  //        a refactor that hardens the gate could lock the admin out and
  //        we'd only find out at the next browser session.
  const auth = await loginAs(page, 'admin@secretaryhq.com', 'password');
  expect(auth.tenant_id).toBe(SUPER_ADMIN_ID);

  // GET /tenants must succeed for super-admin.
  const tenants = await apiGet(page, auth.token, '/tenants');
  expect(tenants.status).toBe(200);
  expect(Array.isArray(tenants.body), 'super-admin gets a tenant list').toBe(true);
  const ids = (tenants.body as Array<{ id: string }>).map((t) => t.id);
  expect(ids, 'super-admin sees DynaTire').toContain(DYNATIRE_ID);
  expect(ids, 'super-admin sees other tenant').toContain(OTHER_TENANT_ID);

  // Cross-tenant query override is allowed for super-admin.
  const cross = await apiGet(page, auth.token, `/customers?tenant_id=${OTHER_TENANT_ID}`);
  expect(cross.status, 'super-admin cross-tenant query is permitted').toBe(200);
});
