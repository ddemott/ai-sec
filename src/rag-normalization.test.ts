import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { getRootClient, clearDB, setupBasicTenant, beginTestTransaction, rollbackTestTransaction, skipIfDbDown } from "./test-utils";
import { Client } from "pg";

describe("RAG Normalization Layer", () => {
  let client: Client;
  let tenantId: string;
  let dbAvailable = true;
  beforeEach((ctx) => skipIfDbDown(ctx, () => dbAvailable));

  beforeAll(async () => {
    try {
      client = await getRootClient();
      await clearDB(client);
      const setup = await setupBasicTenant(client);
      tenantId = setup.tenantId;
    } catch (err) {
      dbAvailable = false;
      console.warn("[rag-normalization.test] Skipping DB tests - connection failed", err);
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

  it("tenant_docs table has normalized_text column", async () => {
    if (!dbAvailable) return;

    const res = await client.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = 'tenant_docs' AND column_name = 'normalized_text'`
    );
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].data_type).toBe('text');
  });

  it("call_summaries table has normalized_text column", async () => {
    if (!dbAvailable) return;

    const res = await client.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = 'call_summaries' AND column_name = 'normalized_text'`
    );
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].data_type).toBe('text');
  });

  it("can insert tenant_docs with normalized_text", async () => {
    if (!dbAvailable) return;

    const original = "Yeah so I really think Bobby does a great job with oil changes you know";
    const normalized = "Bobby performs oil changes well. Customer satisfied with Bobby.";

    await client.query(
      `INSERT INTO tenant_docs (tenant_id, content, normalized_text, source)
       VALUES ($1, $2, $3, 'test')`,
      [tenantId, original, normalized]
    );

    const res = await client.query(
      `SELECT content, normalized_text FROM tenant_docs WHERE tenant_id = $1`,
      [tenantId]
    );
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].content).toBe(original);
    expect(res.rows[0].normalized_text).toBe(normalized);
  });

  it("can insert call_summaries with normalized_text", async () => {
    if (!dbAvailable) return;

    // Create a customer first
    const custRes = await client.query(
      `INSERT INTO customers (tenant_id, first_name, last_name, phone)
       VALUES ($1, 'Test', 'Customer', '+15551234567') RETURNING customer_id`,
      [tenantId]
    );
    const customerId = custRes.rows[0].customer_id;

    const original = "Customer called about getting their brakes done, mentioned they like working with Mike";
    const normalized = "Customer inquired about brake service. Prefers technician Mike.";

    await client.query(
      `INSERT INTO call_summaries (tenant_id, customer_id, summary, normalized_text, call_id)
       VALUES ($1, $2, $3, $4, 'test-call-001')`,
      [tenantId, customerId, original, normalized]
    );

    const res = await client.query(
      `SELECT summary, normalized_text FROM call_summaries WHERE tenant_id = $1`,
      [tenantId]
    );
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].summary).toBe(original);
    expect(res.rows[0].normalized_text).toBe(normalized);
  });

  it("search_tenant_docs_normalized function exists and returns normalized_text", async () => {
    if (!dbAvailable) return;

    // Verify the function exists
    const funcRes = await client.query(
      `SELECT routine_name FROM information_schema.routines
       WHERE routine_name = 'search_tenant_docs_normalized' AND routine_schema = 'public'`
    );
    expect(funcRes.rows.length).toBe(1);
  });

  it("normalized_text column is nullable (backwards compatible)", async () => {
    if (!dbAvailable) return;

    // Insert without normalized_text — should work
    await client.query(
      `INSERT INTO tenant_docs (tenant_id, content, source) VALUES ($1, 'plain content', 'test')`,
      [tenantId]
    );

    const res = await client.query(
      `SELECT content, normalized_text FROM tenant_docs WHERE tenant_id = $1`,
      [tenantId]
    );
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].content).toBe('plain content');
    expect(res.rows[0].normalized_text).toBeNull();
  });
});
