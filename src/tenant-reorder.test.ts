import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getRootClient, clearDB } from "./test-utils";
import { Client } from "pg";

describe("Tenant reorder (drag-and-drop)", () => {
  let client: Client;
  let dbAvailable = true;

  beforeAll(async () => {
    try {
      client = await getRootClient();
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
    await clearDB(client);
  });

  it("tenants table has sort_order column defaulting to 0", async () => {
    if (!dbAvailable) return;

    const res = await client.query(
      `SELECT column_name, column_default FROM information_schema.columns
       WHERE table_name = 'tenants' AND column_name = 'sort_order'`
    );
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].column_default).toContain('0');
  });

  it("new tenants get sort_order = 0 by default", async () => {
    if (!dbAvailable) return;

    await client.query("INSERT INTO tenants (name, business_type) VALUES ('Biz A', 'test')");
    const res = await client.query("SELECT sort_order FROM tenants WHERE name = 'Biz A'");
    expect(res.rows[0].sort_order).toBe(0);
  });

  it("can update sort_order for multiple tenants", async () => {
    if (!dbAvailable) return;

    const r1 = await client.query("INSERT INTO tenants (name, business_type) VALUES ('Biz A', 'test') RETURNING id");
    const r2 = await client.query("INSERT INTO tenants (name, business_type) VALUES ('Biz B', 'test') RETURNING id");
    const r3 = await client.query("INSERT INTO tenants (name, business_type) VALUES ('Biz C', 'test') RETURNING id");

    const idA = r1.rows[0].id;
    const idB = r2.rows[0].id;
    const idC = r3.rows[0].id;

    // Reorder: C, A, B
    await client.query("UPDATE tenants SET sort_order = 0 WHERE id = $1", [idC]);
    await client.query("UPDATE tenants SET sort_order = 1 WHERE id = $1", [idA]);
    await client.query("UPDATE tenants SET sort_order = 2 WHERE id = $1", [idB]);

    const res = await client.query("SELECT name FROM tenants ORDER BY sort_order ASC");
    expect(res.rows.map((r: any) => r.name)).toEqual(['Biz C', 'Biz A', 'Biz B']);
  });

  it("ORDER BY sort_order ASC, created_at DESC matches tenant listing query", async () => {
    if (!dbAvailable) return;

    await client.query("INSERT INTO tenants (name, business_type, sort_order) VALUES ('First', 'test', 2)");
    await client.query("INSERT INTO tenants (name, business_type, sort_order) VALUES ('Second', 'test', 0)");
    await client.query("INSERT INTO tenants (name, business_type, sort_order) VALUES ('Third', 'test', 1)");

    const res = await client.query("SELECT name FROM tenants ORDER BY sort_order ASC, created_at DESC");
    expect(res.rows.map((r: any) => r.name)).toEqual(['Second', 'Third', 'First']);
  });

  it("tenants with same sort_order fall back to created_at DESC", async () => {
    if (!dbAvailable) return;

    // All default sort_order = 0, so order by created_at DESC
    await client.query("INSERT INTO tenants (name, business_type) VALUES ('Oldest', 'test')");
    // Small delay to ensure different timestamps
    await client.query("SELECT pg_sleep(0.01)");
    await client.query("INSERT INTO tenants (name, business_type) VALUES ('Newest', 'test')");

    const res = await client.query("SELECT name FROM tenants ORDER BY sort_order ASC, created_at DESC");
    expect(res.rows[0].name).toBe('Newest');
    expect(res.rows[1].name).toBe('Oldest');
  });
});
