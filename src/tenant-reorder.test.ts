import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { getRootClient, clearDB, beginTestTransaction, rollbackTestTransaction } from "./test-utils";
import { Client } from "pg";

describe("Tenant reorder (drag-and-drop)", () => {
  let client: Client;
  let dbAvailable = true;

  beforeAll(async () => {
    try {
      client = await getRootClient();
      await clearDB(client);
    } catch (err) {
      dbAvailable = false;
      console.warn("[tenant-reorder.test] Skipping DB tests - connection failed", err);
    }
  });

  afterAll(async () => {
    if (dbAvailable && client) {
      await client.end();
    }
  });

  beforeEach(async () => {
    if (!dbAvailable) return;
    await beginTestTransaction(client);
  });

  afterEach(async () => {
    if (!dbAvailable) return;
    await rollbackTestTransaction(client);
  });

  it("tenants table has sort_order column defaulting to 0", async () => {
    // WHO: maintainer adding new tenants without specifying sort_order
    // WHAT: information_schema confirms the column exists AND its DEFAULT
    //       is 0 (literal "0" appears in column_default)
    // WHEN: every tenant insert that doesn't pass sort_order
    // WHERE: tenants table schema (added in the drag-reorder migration)
    // WHY: a regression that drops the DEFAULT would leave NULLs in
    //      sort_order, which would silently scramble the admin tenant
    //      picker (NULLS LAST/FIRST behavior depends on the ORDER BY
    //      clause). Pinning the column + default at the schema level
    //      catches this before it ships
    if (!dbAvailable) return;

    const res = await client.query(
      `SELECT column_name, column_default FROM information_schema.columns
       WHERE table_name = 'tenants' AND column_name = 'sort_order'`
    );
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].column_default).toContain('0');
  });

  it("new tenants get sort_order = 0 by default", async () => {
    // WHO: any flow inserting a tenant without explicit sort_order
    //      (POST /tenants/create, register flow, manual admin entry)
    // WHAT: the inserted row has sort_order = 0 (the documented default)
    // WHEN: every tenant creation that doesn't choose a position
    // WHERE: tenants table column default (runtime check, complementing
    //        the schema-introspection check above)
    // WHY: belt-and-suspenders with the previous test — that one verifies
    //      the schema declares the default; this one verifies the default
    //      actually applies on INSERT. A schema-only check could pass
    //      while a triggered ON INSERT side-effect overrode the default
    if (!dbAvailable) return;

    await client.query("INSERT INTO tenants (name, business_type) VALUES ('Biz A', 'test')");
    const res = await client.query("SELECT sort_order FROM tenants WHERE name = 'Biz A'");
    expect(res.rows[0].sort_order).toBe(0);
  });

  it("can update sort_order for multiple tenants", async () => {
    // WHO: super-admin saving a new tenant ordering after drag-reorder
    // WHAT: 3 sequential UPDATEs assigning sort_order = 0, 1, 2 to specific
    //       tenant ids; subsequent SELECT ORDER BY sort_order returns the
    //       rows in the assigned sequence
    // WHEN: every save-order action — the route handler at
    //       src/routes/tenants.ts:156 issues exactly this sequence
    // WHERE: UPDATE tenants SET sort_order = $1 WHERE tenant_id = $2
    // WHY: this is the DB-level half of the contract that the route-level
    //      test (tenant-routes.test.ts) verifies. If sort_order updates
    //      didn't actually persist (column dropped, trigger interfering),
    //      the admin would save a new order and see the old one come back
    if (!dbAvailable) return;

    const r1 = await client.query("INSERT INTO tenants (name, business_type) VALUES ('Biz A', 'test') RETURNING tenant_id AS id");
    const r2 = await client.query("INSERT INTO tenants (name, business_type) VALUES ('Biz B', 'test') RETURNING tenant_id AS id");
    const r3 = await client.query("INSERT INTO tenants (name, business_type) VALUES ('Biz C', 'test') RETURNING tenant_id AS id");

    const idA = r1.rows[0].id;
    const idB = r2.rows[0].id;
    const idC = r3.rows[0].id;

    // Reorder: C, A, B
    await client.query("UPDATE tenants SET sort_order = 0 WHERE tenant_id = $1", [idC]);
    await client.query("UPDATE tenants SET sort_order = 1 WHERE tenant_id = $1", [idA]);
    await client.query("UPDATE tenants SET sort_order = 2 WHERE tenant_id = $1", [idB]);

    const res = await client.query("SELECT name FROM tenants ORDER BY sort_order ASC");
    expect(res.rows.map((r: { name: string }) => r.name)).toEqual(['Biz C', 'Biz A', 'Biz B']);
  });

  it("ORDER BY sort_order ASC, created_at DESC matches tenant listing query", async () => {
    // WHO: GET /tenants — the dashboard's tenant picker query
    // WHAT: the canonical listing ORDER BY clause produces the right
    //       sequence when sort_order values are distinct
    // WHEN: every dashboard load that lists tenants
    // WHERE: tenants listing route + the dashboard tenant picker
    // WHY: the production route uses this exact ORDER BY shape. If a
    //      reviewer changes the route to use a different ordering, the
    //      drag-reorder feature visibly breaks (the saved order isn't
    //      what the admin sees). Pinning the ORDER BY at the schema test
    //      level keeps the route + DB contract aligned
    if (!dbAvailable) return;

    await client.query("INSERT INTO tenants (name, business_type, sort_order) VALUES ('First', 'test', 2)");
    await client.query("INSERT INTO tenants (name, business_type, sort_order) VALUES ('Second', 'test', 0)");
    await client.query("INSERT INTO tenants (name, business_type, sort_order) VALUES ('Third', 'test', 1)");

    const res = await client.query("SELECT name FROM tenants ORDER BY sort_order ASC, created_at DESC");
    expect(res.rows.map((r: { name: string }) => r.name)).toEqual(['Second', 'Third', 'First']);
  });

  it("tenants with same sort_order fall back to created_at DESC", async () => {
    // WHO: dashboard listing tenants where the admin hasn't yet manually
    //      reordered (so all sort_order values are still 0)
    // WHAT: the secondary ORDER BY (created_at DESC) takes over and
    //       produces newest-first ordering
    // WHEN: a freshly-onboarded environment, or any time the admin hasn't
    //       run reorder yet
    // WHERE: same listing ORDER BY as above
    // WHY: without the secondary ORDER BY, equal sort_order values would
    //      produce nondeterministic ordering — the dashboard picker would
    //      shuffle on every page load. Pinning the fallback to created_at
    //      DESC preserves a stable + intuitive default (newest tenant
    //      surfaces first)
    if (!dbAvailable) return;

    // All default sort_order = 0, so order by created_at DESC
    // Use explicit timestamps since NOW() is stable within a transaction
    await client.query("INSERT INTO tenants (name, business_type, created_at) VALUES ('Oldest', 'test', '2026-01-01T00:00:00Z')");
    await client.query("INSERT INTO tenants (name, business_type, created_at) VALUES ('Newest', 'test', '2026-01-02T00:00:00Z')");

    const res = await client.query("SELECT name FROM tenants ORDER BY sort_order ASC, created_at DESC");
    expect(res.rows[0].name).toBe('Newest');
    expect(res.rows[1].name).toBe('Oldest');
  });
});
