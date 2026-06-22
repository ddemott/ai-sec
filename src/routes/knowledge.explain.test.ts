/**
 * WHO:   POST /knowledge/explain — the "explain this answer" RAG debugger
 * WHAT:  runs the agent's KB retrieval for a question, returns ranked chunks +
 *        scores + which would be used in production (top-3 above the threshold)
 * WHEN:  an owner wants to see WHY the AI answered (or didn't) a given question
 * WHERE: src/routes/knowledge.ts
 * WHY:   owners can't see the vector search; this surfaces it. The tests pin the
 *        owner gate, the threshold/top-N annotation, and the would_answer signal.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { registerKnowledgeRoutes } from './knowledge';
import { buildRouteTestApp, type RouteTestAppHandle } from '../test-utils-mock';

const TENANT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const mockGetEmbedding = vi.fn().mockResolvedValue(Array(1536).fill(0.1));
const mockNormalize = vi.fn(async (text: string) => text);

let handle: RouteTestAppHandle;
let app: FastifyInstance;

beforeAll(async () => {
  handle = buildRouteTestApp((a, pool, withTenantClient) => {
    registerKnowledgeRoutes(a, pool, mockGetEmbedding, withTenantClient, mockNormalize);
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
});

describe('POST /knowledge/explain', () => {
  it('HAPPY: ranks candidates and marks which clear the prod threshold + top-N', async () => {
    // Five candidates, descending similarity. Threshold 0.5, top-3 used.
    // → ranks 1-3 are above 0.5, but only the first 3 above-threshold are "used".
    handle.queryResponses.push({
      rows: [
        { tenant_doc_id: 'd1', content: 'Mon-Fri 9-5', similarity: 0.92 },
        { tenant_doc_id: 'd2', content: 'We deliver locally', similarity: 0.71 },
        { tenant_doc_id: 'd3', content: 'Parking out back', similarity: 0.55 },
        { tenant_doc_id: 'd4', content: 'Founded in 2010', similarity: 0.41 },
        { tenant_doc_id: 'd5', content: 'Cat photos', similarity: 0.12 },
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
    // WHY: the debugger must mirror /agent-tools/policy-answer — normalize the
    //       question (same context) BEFORE embedding, else its scores wouldn't
    //       match the real retrieval. mockNormalize is identity, so the embedded
    //       text equals the question, but the normalize call itself is pinned.
    expect(mockNormalize).toHaveBeenCalledWith('What are your hours?', {
      context: 'customer phone inquiry',
    });
    expect(mockGetEmbedding).toHaveBeenCalledWith('What are your hours?');
    expect(body.production_threshold).toBe(0.5);
    expect(body.production_match_count).toBe(3);
    expect(body.candidates).toHaveLength(5);

    // d1-d3 above 0.5, d4-d5 below.
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

    // The query passed the embedding cast to ::vector + the debug params.
    const q = handle.queries.find((qq) => qq.text.includes('search_tenant_docs_normalized'));
    expect(q).toBeDefined();
    expect(q!.text).toContain('::vector');
    expect(q!.params[0]).toBe(TENANT_ID);
  });

  it('HAPPY: caps used_in_production at top-3 even when more clear the threshold', async () => {
    // Four candidates ALL above 0.5 → only the first 3 are "used".
    handle.queryResponses.push({
      rows: [
        { tenant_doc_id: 'd1', content: 'a', similarity: 0.9 },
        { tenant_doc_id: 'd2', content: 'b', similarity: 0.8 },
        { tenant_doc_id: 'd3', content: 'c', similarity: 0.7 },
        { tenant_doc_id: 'd4', content: 'd', similarity: 0.6 },
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
    expect(used).toHaveLength(3);
    expect(body.would_answer).toBe(true);
  });

  it('HAPPY: would_answer is false when nothing clears the threshold', async () => {
    // WHY: this is the "the AI says it doesn't know" diagnosis — the owner sees
    //       the KB had only weak near-misses, so they know to add content.
    handle.queryResponses.push({
      rows: [
        { tenant_doc_id: 'd1', content: 'weak', similarity: 0.34 },
        { tenant_doc_id: 'd2', content: 'weaker', similarity: 0.2 },
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
