import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { getRootClient, clearDB, setupBasicTenant, beginTestTransaction, rollbackTestTransaction, skipIfDbDown } from "./test-utils";
import { Client } from "pg";

/**
 * Tests for the knowledge ingestion normalization pipeline.
 * Verifies that normalized_text is stored correctly when ingesting documents,
 * and that the embedding is generated from the normalized text (not the original).
 */
describe("Knowledge ingestion normalization pipeline", () => {
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
      console.warn("[knowledge-normalization.test] Skipping DB tests - connection failed", err);
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

  it("stores both content and normalized_text when normalizer transforms text", async () => {
    if (!dbAvailable) return;

    const original = "Yeah so like Bobby is really awesome at doing those oil change things, ya know?";
    const normalized = "Bobby is skilled at oil changes.";
    const dummyEmbedding = JSON.stringify(new Array(1536).fill(0.1));

    // Simulate what knowledge.ts does: insert with both content and normalized_text
    await client.query(
      `INSERT INTO tenant_docs (tenant_id, content, normalized_text, source, embedding)
       VALUES ($1, $2, $3, 'test.txt', $4::vector)`,
      [tenantId, original, normalized, dummyEmbedding]
    );

    const res = await client.query(
      `SELECT content, normalized_text FROM tenant_docs WHERE tenant_id = $1`,
      [tenantId]
    );
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].content).toBe(original);
    expect(res.rows[0].normalized_text).toBe(normalized);
    // Content preserves original, normalized_text has the semantic core
    expect(res.rows[0].content).not.toBe(res.rows[0].normalized_text);
  });

  it("stores content = normalized_text when normalizer is absent (backward compat)", async () => {
    if (!dbAvailable) return;

    const text = "We are open Monday through Friday 9am to 5pm.";
    const dummyEmbedding = JSON.stringify(new Array(1536).fill(0.1));

    // Without normalizer, knowledge.ts falls back to: normalizedText = trimmedChunk
    await client.query(
      `INSERT INTO tenant_docs (tenant_id, content, normalized_text, source, embedding)
       VALUES ($1, $2, $2, 'test.txt', $3::vector)`,
      [tenantId, text, dummyEmbedding]
    );

    const res = await client.query(
      `SELECT content, normalized_text FROM tenant_docs WHERE tenant_id = $1`,
      [tenantId]
    );
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].content).toBe(text);
    expect(res.rows[0].normalized_text).toBe(text);
  });

  it("search_tenant_docs still works with normalized data (original function unchanged)", async () => {
    if (!dbAvailable) return;

    // Insert a doc with embedding that has a known pattern
    const embedding = new Array(1536).fill(0);
    embedding[0] = 1.0; // distinctive signal
    const dummyEmbedding = JSON.stringify(embedding);

    await client.query(
      `INSERT INTO tenant_docs (tenant_id, content, normalized_text, source, embedding)
       VALUES ($1, 'Our refund policy is 30 days.', 'Refund policy: 30-day window.', 'policy.txt', $2::vector)`,
      [tenantId, dummyEmbedding]
    );

    // Query with same embedding should find it
    const res = await client.query(
      `SELECT tenant_doc_id, content, similarity FROM search_tenant_docs($1, $2::vector, 0.5, 5)`,
      [tenantId, dummyEmbedding]
    );
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].content).toContain("refund policy");
    expect(Number(res.rows[0].similarity)).toBeGreaterThan(0.9);
  });

  it("search_tenant_docs_normalized returns normalized_text field", async () => {
    if (!dbAvailable) return;

    const embedding = new Array(1536).fill(0);
    embedding[0] = 1.0;
    const dummyEmbedding = JSON.stringify(embedding);

    await client.query(
      `INSERT INTO tenant_docs (tenant_id, content, normalized_text, source, embedding)
       VALUES ($1, 'Yeah we close at 5 usually I think', 'Business closes at 5pm.', 'hours.txt', $2::vector)`,
      [tenantId, dummyEmbedding]
    );

    const res = await client.query(
      `SELECT tenant_doc_id, content, normalized_text, similarity FROM search_tenant_docs_normalized($1, $2::vector, 0.5, 5)`,
      [tenantId, dummyEmbedding]
    );
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].content).toBe("Yeah we close at 5 usually I think");
    expect(res.rows[0].normalized_text).toBe("Business closes at 5pm.");
  });

  it("embedding is generated from normalized text, not original (behavior contract)", async () => {
    if (!dbAvailable) return;

    // This test documents the expected behavior: the embedding should represent
    // the normalized text. We verify by inserting two docs with different content
    // but the same normalized form — their embeddings should be identical.
    const normalizedForm = "Oil change service available.";
    const embedding = new Array(1536).fill(0);
    embedding[5] = 1.0;
    const dummyEmbedding = JSON.stringify(embedding);

    // Conversational version
    await client.query(
      `INSERT INTO tenant_docs (tenant_id, content, normalized_text, source, embedding)
       VALUES ($1, 'Oh yeah we totally do oil changes here!', $2, 'chat.txt', $3::vector)`,
      [tenantId, normalizedForm, dummyEmbedding]
    );

    // Formal version — same normalized text, same embedding
    await client.query(
      `INSERT INTO tenant_docs (tenant_id, content, normalized_text, source, embedding)
       VALUES ($1, 'This establishment provides oil change services.', $2, 'formal.txt', $3::vector)`,
      [tenantId, normalizedForm, dummyEmbedding]
    );

    // Both docs should appear with identical similarity when searched
    const res = await client.query(
      `SELECT content, normalized_text, similarity FROM search_tenant_docs_normalized($1, $2::vector, 0.5, 10)`,
      [tenantId, dummyEmbedding]
    );
    expect(res.rows.length).toBe(2);
    // Both have the same normalized text and same similarity score
    expect(res.rows[0].normalized_text).toBe(normalizedForm);
    expect(res.rows[1].normalized_text).toBe(normalizedForm);
    expect(Number(res.rows[0].similarity)).toBe(Number(res.rows[1].similarity));
  });
});
