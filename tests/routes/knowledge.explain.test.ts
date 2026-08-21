/**
 * WHO:   POST /knowledge/explain — the "explain this answer" RAG debugger
 * WHAT:  runs the agent's KB retrieval for a question, returns ranked chunks +
 *        scores + which would be used in production (top-3 above the threshold)
 * WHEN:  an owner wants to see WHY the AI answered (or didn't) a given question
 * WHERE: src/routes/knowledge.ts
 * WHY:   owners can't see the vector search; this surfaces it. The tests pin the
 *        owner gate, the threshold/top-N annotation, and the would_answer signal.
 *
 *        AND they pin FIDELITY TO THE LIVE PATH, which is the only property that
 *        makes the debugger worth having. It previously scored questions at
 *        threshold 0.5 while the agent answered at 0.30, and embedded the
 *        NORMALIZED question while the agent embeds the EXPANDED one — so it
 *        reported "your KB can't answer this" for questions the agent answers,
 *        and its similarity numbers were measured against text no caller ever
 *        produced. Both are asserted here now, against the shared constants
 *        rather than against literals, so a future drift fails rather than
 *        silently misinforming an owner.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { registerKnowledgeRoutes } from '../../src/routes/knowledge';
import { buildRouteTestApp, type RouteTestAppHandle } from '../mock';
import { PROD_MATCH_COUNT, PROD_THRESHOLD } from '../../src/services/knowledge/retrievalParams';

const TENANT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const mockGetEmbedding = vi.fn().mockResolvedValue(Array(1536).fill(0.1));
const mockNormalize = vi.fn(async (text: string) => text);
// The query-side expander: additive, and what production embeds. Returns a
// DIFFERENT string than it was given so a test can prove which transform the
// debugger actually used — an identity stub would make the two indistinguishable.
const mockExpand = vi.fn(async (text: string) => `${text} expanded`);

// Fixture similarities are expressed RELATIVE to the live threshold, never as
// literals. These tests are about the annotation logic — "which candidates would
// production have used" — not about one particular tuning, and the threshold is
// deliberately re-tuned against the RAG eval. Hard-coded scores would either
// break on every re-tune (noise) or, worse, drift to one side of the new value
// and leave a test that still passes while asserting nothing: a "nothing clears
// the threshold" case whose rows all clear it proves only that the code runs.
const clearlyAbove = Math.min(0.99, PROD_THRESHOLD + 0.4);
const above = Math.min(0.98, PROD_THRESHOLD + 0.3);
const barelyAbove = Math.min(0.97, PROD_THRESHOLD + 0.2);
const justAbove = Math.min(0.96, PROD_THRESHOLD + 0.02);
const justBelow = Math.max(0.02, PROD_THRESHOLD - 0.02);
const clearlyBelow = Math.max(0.01, PROD_THRESHOLD - 0.2);

let handle: RouteTestAppHandle;
let app: FastifyInstance;

beforeAll(async () => {
  handle = buildRouteTestApp((a, pool, withTenantClient) => {
    registerKnowledgeRoutes(a, pool, mockGetEmbedding, withTenantClient, mockNormalize, mockExpand);
  });
  app = handle.app;
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  handle.queries.length = 0;
  handle.queryResponses.length = 0;
  handle.tenantIdOverride.current = null;
  handle.auth.current = {
    user_id: '00000000-0000-0000-0000-000000000001',
    tenant_id: TENANT_ID,
    email: 'owner@test.local',
    role: 'owner',
  };
  mockGetEmbedding.mockClear();
  mockNormalize.mockClear();
  mockExpand.mockClear();
});

describe('POST /knowledge/explain', () => {
  it('HAPPY: ranks candidates and marks which clear the prod threshold + top-N', async () => {
    // Five candidates, descending similarity: three clear the live threshold,
    // two do not. → ranks 1-3 are above it, and since exactly three clear it,
    // all three are also the top-PROD_MATCH_COUNT that get used.
    // Valid UUIDs — the production composed_answer query casts the id array to
    // ::uuid[], so real Postgres would reject non-UUID ids; keep the mock data
    // shaped like the real column so the test mirrors production.
    const D1 = '11111111-1111-4111-8111-111111111111';
    const D2 = '22222222-2222-4222-8222-222222222222';
    const D3 = '33333333-3333-4333-8333-333333333333';
    const D4 = '44444444-4444-4444-8444-444444444444';
    const D5 = '55555555-5555-4555-8555-555555555555';
    handle.queryResponses.push({
      rows: [
        { tenant_doc_id: D1, content: 'Mon-Fri 9-5', similarity: clearlyAbove },
        { tenant_doc_id: D2, content: 'We deliver locally', similarity: above },
        { tenant_doc_id: D3, content: 'Parking out back', similarity: justAbove },
        { tenant_doc_id: D4, content: 'Founded in 2010', similarity: justBelow },
        { tenant_doc_id: D5, content: 'Cat photos', similarity: clearlyBelow },
      ],
    });
    // titles lookup for the used-in-production docs (composed_answer)
    handle.queryResponses.push({
      rows: [
        { tenant_doc_id: D1, title: 'Hours' },
        { tenant_doc_id: D2, title: 'Delivery' },
        { tenant_doc_id: D3, title: 'Parking' },
      ],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/knowledge/explain',
      headers: { 'x-tenant-id': TENANT_ID, authorization: 'Bearer t' },
      payload: { question: 'What are your hours?' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    // WHY: the debugger must mirror /agent-tools/policy-answer, which EXPANDS
    //       the caller's question (additive synonyms) before embedding. The
    //       reductive normalizer is the INGEST-side transform and belongs to the
    //       other routes in this file; using it here would score a string no
    //       caller ever produced, so it must NOT be called on this path.
    expect(mockExpand).toHaveBeenCalledWith('What are your hours?', {
      context: 'customer phone inquiry',
    });
    expect(mockNormalize).not.toHaveBeenCalled();
    // The EXPANDED text is what gets embedded — proving which transform ran.
    expect(mockGetEmbedding).toHaveBeenCalledWith('What are your hours? expanded');
    // Asserted against the shared constants, not literals: this test's job is
    // that the debugger reports the LIVE numbers, whatever they are tuned to.
    expect(body.production_threshold).toBe(PROD_THRESHOLD);
    expect(body.production_match_count).toBe(PROD_MATCH_COUNT);
    expect(body.candidates).toHaveLength(5);

    // d1-d3 clear the threshold, d4-d5 do not.
    expect(body.candidates.map((c: { above_threshold: boolean }) => c.above_threshold)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
    // Only the top-3 above-threshold are used in production.
    expect(
      body.candidates.map((c: { used_in_production: boolean }) => c.used_in_production)
    ).toEqual([true, true, true, false, false]);
    expect(body.would_answer).toBe(true);

    // composed_answer = the EXACT context the agent would relay: the 3 used
    // chunks, each prefixed with its source-doc title, joined; the un-used d4/d5
    // are excluded.
    expect(body.composed_answer).toContain('[From "Hours"]');
    expect(body.composed_answer).toContain('Mon-Fri 9-5');
    expect(body.composed_answer).toContain('[From "Parking"]');
    expect(body.composed_answer).not.toContain('Founded in 2010'); // d4 not used
    expect(body.composed_answer).not.toContain('Cat photos'); // d5 not used

    // The query passed the embedding cast to ::vector + the debug params.
    const q = handle.queries.find((qq) => qq.text.includes('search_tenant_docs_normalized'));
    expect(q).toBeDefined();
    expect(q!.text).toContain('::vector');
    expect(q!.params[0]).toBe(TENANT_ID);
    // composed_answer's title lookup casts to ::uuid[].
    const titleQ = handle.queries.find((qq) => qq.text.includes('FROM tenant_docs'));
    expect(titleQ).toBeDefined();
    expect(titleQ!.text).toContain('::uuid[]');
  });

  it('HAPPY: caps used_in_production at top-3 even when more clear the threshold', async () => {
    // Four candidates ALL clearing the threshold → only the first
    // PROD_MATCH_COUNT are "used".
    handle.queryResponses.push({
      rows: [
        { tenant_doc_id: 'd1', content: 'a', similarity: clearlyAbove },
        { tenant_doc_id: 'd2', content: 'b', similarity: above },
        { tenant_doc_id: 'd3', content: 'c', similarity: barelyAbove },
        { tenant_doc_id: 'd4', content: 'd', similarity: justAbove },
      ],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/knowledge/explain',
      headers: { 'x-tenant-id': TENANT_ID, authorization: 'Bearer t' },
      payload: { question: 'anything' },
    });

    const body = res.json();
    const used = body.candidates.filter(
      (c: { used_in_production: boolean }) => c.used_in_production
    );
    expect(used).toHaveLength(PROD_MATCH_COUNT);
    expect(body.would_answer).toBe(true);
  });

  it('HAPPY: would_answer is false when nothing clears the threshold', async () => {
    // WHY: this is the "the AI says it doesn't know" diagnosis — the owner sees
    //       the KB had only weak near-misses, so they know to add content.
    handle.queryResponses.push({
      rows: [
        { tenant_doc_id: 'd1', content: 'weak', similarity: justBelow },
        { tenant_doc_id: 'd2', content: 'weaker', similarity: clearlyBelow },
      ],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/knowledge/explain',
      headers: { 'x-tenant-id': TENANT_ID, authorization: 'Bearer t' },
      payload: { question: 'do you do taxes?' },
    });

    const body = res.json();
    expect(body.would_answer).toBe(false);
    expect(
      body.candidates.every((c: { used_in_production: boolean }) => !c.used_in_production)
    ).toBe(true);
    // Nothing used → no composed answer.
    expect(body.composed_answer).toBeNull();
  });

  it('SAD: a front-desk user is rejected 403', async () => {
    handle.auth.current = {
      user_id: '00000000-0000-0000-0000-000000000002',
      tenant_id: TENANT_ID,
      email: 'fd@test.local',
      role: 'front_desk',
    };

    const res = await app.inject({
      method: 'POST',
      url: '/knowledge/explain',
      headers: { 'x-tenant-id': TENANT_ID, authorization: 'Bearer t' },
      payload: { question: 'hours?' },
    });

    expect(res.statusCode).toBe(403);
    expect(mockGetEmbedding).not.toHaveBeenCalled();
  });

  it('SAD: an empty question is rejected 400 before embedding', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/knowledge/explain',
      headers: { 'x-tenant-id': TENANT_ID, authorization: 'Bearer t' },
      payload: { question: '' },
    });

    expect(res.statusCode).toBe(400);
    expect(mockGetEmbedding).not.toHaveBeenCalled();
  });
});
