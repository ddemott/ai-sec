/**
 * CHARACTERIZATION tests for the knowledge routes that had no coverage:
 * GET /knowledge, DELETE /knowledge/:id, GET+PATCH /knowledge/unanswered.
 *
 * WHY THIS LANDS BEFORE THE REFACTOR.
 * `src/routes/knowledge.ts` (1,092 lines) is being split into services. Five
 * suites already cover import/explain/suggestions/policy-answer, but the plain
 * CRUD surface — list, delete, and the unanswered-question queue — is untested.
 * Extracting untested code is how a refactor becomes an outage nobody notices
 * until a customer does.
 *
 * These are written against the CURRENT implementation and pass before a line
 * moves. They record what the routes DO, not what they should do; if the
 * extraction changes an answer, one of these fails.
 *
 * 5W:
 *   WHO  — an owner managing their AI's knowledge base
 *   WHAT — HTTP contract: status, response shape, tenant scoping
 *   WHEN — before and after the service extraction
 *   WHERE— src/routes/knowledge.ts
 *   WHY  — the knowledge base is what the agent answers callers from; a
 *          silently broken delete or a cross-tenant list is a data-exposure
 *          bug, not a cosmetic one
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { registerKnowledgeRoutes } from '../../src/routes/knowledge';
import { buildRouteTestApp, type RouteTestAppHandle } from '../mock';

// The shared harness stamps req.tenantId itself (tests/mock.ts) rather than
// reading the header, mirroring how tenantMiddleware works in production. So
// the tenant these routes actually see is the harness's, and asserting on
// query params means asserting against THAT id — using a different one here
// would test the harness, not the route.
const TENANT_ID = '00000000-0000-0000-0000-000000000000';
const DOC_ID = '11111111-2222-4333-8444-555555555555';

const mockGetEmbedding = vi.fn().mockResolvedValue(Array(1536).fill(0));
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
  mockGetEmbedding.mockClear();
});

const AUTH = { 'x-tenant-id': TENANT_ID, authorization: 'Bearer test-token' };

describe('GET /knowledge — characterization', () => {
  it('HAPPY: returns the rows as a bare ARRAY, newest first', async () => {
    // WHY: this route sends `res.rows` directly, with no { success } envelope,
    //      unlike /knowledge/unanswered right below it. The asymmetry is real
    //      and the dashboard depends on it — pinned rather than tidied.
    const rows = [
      {
        tenant_doc_id: DOC_ID,
        title: 'Refund policy',
        content: 'Full refund within 14 days.',
        source: 'manual',
        created_at: '2026-08-20T10:00:00Z',
      },
    ];
    handle.queryResponses.push({ rows });

    const res = await app.inject({ method: 'GET', url: '/knowledge', headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
    expect(res.json()).toEqual(rows);
    // Ordering is in SQL; losing it would shuffle the owner's list silently.
    expect(handle.queries[0].text).toContain('ORDER BY created_at DESC');
  });

  it('SECURITY: scopes the list to the caller tenant', async () => {
    // WHY: the knowledge base is what the agent reads answers from. A list that
    //      forgot its tenant filter would show one business another's policies.
    handle.queryResponses.push({ rows: [] });
    await app.inject({ method: 'GET', url: '/knowledge', headers: AUTH });
    expect(handle.queries[0].text).toContain('WHERE tenant_id = $1');
    expect(handle.queries[0].params).toEqual([TENANT_ID]);
  });
});

describe('DELETE /knowledge/:id — characterization', () => {
  it('HAPPY: deletes and returns { success: true }', async () => {
    handle.queryResponses.push({ rows: [{ tenant_doc_id: DOC_ID }], rowCount: 1 });
    const res = await app.inject({
      method: 'DELETE',
      url: `/knowledge/${DOC_ID}`,
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
  });

  it('SECURITY: the DELETE is tenant-scoped, not id-only', async () => {
    // WHY: `DELETE ... WHERE tenant_doc_id = $1` alone would let any owner
    //      delete any other tenant's knowledge by guessing a UUID. The tenant
    //      predicate is the whole defence, so pin it.
    handle.queryResponses.push({ rows: [{ tenant_doc_id: DOC_ID }], rowCount: 1 });
    await app.inject({ method: 'DELETE', url: `/knowledge/${DOC_ID}`, headers: AUTH });
    expect(handle.queries[0].text).toContain('AND tenant_id = $2');
    expect(handle.queries[0].params).toEqual([DOC_ID, TENANT_ID]);
  });

  it('SAD: deleting something that is not there → 404, never a silent success', async () => {
    // WHY: assertRowAffected exists because a zero-row DELETE returning 200
    //      tells the owner their change worked when nothing happened — the
    //      house rule is that a zero-row mutation is a 404.
    handle.queryResponses.push({ rows: [], rowCount: 0 });
    const res = await app.inject({
      method: 'DELETE',
      url: `/knowledge/${DOC_ID}`,
      headers: AUTH,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().success).toBe(false);
  });
});

describe('GET /knowledge/unanswered — characterization', () => {
  it('HAPPY: returns a { success, questions } ENVELOPE — not a bare array', async () => {
    // WHY: the opposite shape to GET /knowledge, in the same file. Both are
    //      consumed by the dashboard as-is; "making them consistent" during an
    //      extraction would break one of the two callers.
    const questions = [
      {
        unanswered_question_id: DOC_ID,
        question: 'Do you do walk-ins?',
        caller_phone: '+16308229086',
        call_id: 'SCL_abc',
        caller_message: null,
        owner_notified: false,
        resolved: false,
        created_at: '2026-08-20T10:00:00Z',
      },
    ];
    handle.queryResponses.push({ rows: questions });

    const res = await app.inject({ method: 'GET', url: '/knowledge/unanswered', headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, questions });
  });

  it('HAPPY: no rows → an empty questions array, still enveloped', async () => {
    handle.queryResponses.push({ rows: [] });
    const res = await app.inject({ method: 'GET', url: '/knowledge/unanswered', headers: AUTH });
    expect(res.json()).toEqual({ success: true, questions: [] });
  });
});
