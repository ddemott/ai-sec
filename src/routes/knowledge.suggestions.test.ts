/**
 * WHO:   GET/PATCH /knowledge/suggestions
 * WHAT:  staging table review — list pending AI-extracted Q&A, approve or reject
 * WHEN:  owner scans website during setup wizard; reviews discovered topics
 * WHERE: src/routes/knowledge.ts
 * WHY:   approval ingests to live KB (same path as knowledge.add);
 *        rejection marks discarded; 404 on missing or already-reviewed suggestion
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { registerKnowledgeRoutes } from './knowledge';
import { buildRouteTestApp, type RouteTestAppHandle } from '../test-utils-mock';

const TENANT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SUGGESTION_ID = '11111111-2222-4333-8444-555555555555';

// Lightweight stubs — suggestions routes only call getEmbedding on approve
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

describe('GET /knowledge/suggestions', () => {
  it('returns pending suggestions for tenant', async () => {
    // WHO: owner reviewing AI-extracted Q&A after a website scan
    // WHAT: returns only status=suggested rows
    // WHY:  confirmed/rejected rows are not actionable and should not clutter the review UI
    const row = {
      id: SUGGESTION_ID,
      question: 'Do you accept walk-ins?',
      answer: 'Yes',
      source_url: 'https://example.com',
      confidence: 0.9,
      status: 'suggested',
      created_at: '2026-06-16T00:00:00Z',
    };
    handle.queryResponses.push({ rows: [row], rowCount: 1 });

    const res = await app.inject({ method: 'GET', url: '/knowledge/suggestions', headers: AUTH });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { success: boolean; suggestions: (typeof row)[] };
    expect(body.success).toBe(true);
    expect(body.suggestions).toHaveLength(1);
    expect(body.suggestions[0].question).toBe('Do you accept walk-ins?');
  });

  it('returns empty list when no pending suggestions', async () => {
    handle.queryResponses.push({ rows: [], rowCount: 0 });
    const res = await app.inject({ method: 'GET', url: '/knowledge/suggestions', headers: AUTH });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { success: boolean; suggestions: unknown[] };
    expect(body.suggestions).toHaveLength(0);
  });
});

describe('PATCH /knowledge/suggestions/:id', () => {
  describe('Approve (confirmed)', () => {
    it('ingests to KB and marks suggestion confirmed', async () => {
      // WHO: owner approving a discovered topic
      // WHAT: fetch → BEGIN → INSERT tenant_docs → UPDATE suggestion (status guard) → COMMIT
      // WHY:  explicit transaction keeps KB and staging table consistent under failures/retries
      handle.queryResponses.push({
        rows: [{ question: 'Walk-ins?', answer: 'Yes, welcome.' }],
        rowCount: 1,
      });
      handle.queryResponses.push({ rows: [], rowCount: 0 }); // BEGIN
      handle.queryResponses.push({ rows: [], rowCount: 1 }); // INSERT tenant_docs
      handle.queryResponses.push({ rows: [], rowCount: 1 }); // UPDATE knowledge_suggestion
      handle.queryResponses.push({ rows: [], rowCount: 0 }); // COMMIT

      const res = await app.inject({
        method: 'PATCH',
        url: `/knowledge/suggestions/${SUGGESTION_ID}`,
        headers: { ...AUTH, 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'confirmed' }),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { success: boolean };
      expect(body.success).toBe(true);
      expect(mockGetEmbedding).toHaveBeenCalledOnce();
    });
  });

  describe('Reject (rejected)', () => {
    it('marks suggestion rejected without ingesting', async () => {
      // WHO: owner discarding a low-quality or irrelevant extracted topic
      // WHAT: only updates status — no KB write, no embedding call
      // WHY:  rejected items must not pollute the live KB
      handle.queryResponses.push({
        rows: [{ question: 'Irrelevant?', answer: 'Yes.' }],
        rowCount: 1,
      });
      handle.queryResponses.push({ rows: [], rowCount: 1 });

      const res = await app.inject({
        method: 'PATCH',
        url: `/knowledge/suggestions/${SUGGESTION_ID}`,
        headers: { ...AUTH, 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'rejected' }),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { success: boolean };
      expect(body.success).toBe(true);
      expect(mockGetEmbedding).not.toHaveBeenCalled();
    });
  });

  describe('Sad Paths', () => {
    it('returns 404 when suggestion not found or already reviewed', async () => {
      // WHO: owner retapping approve on an already-confirmed suggestion
      // WHAT: fetch returns 0 rows (status != suggested) → 404
      handle.queryResponses.push({ rows: [], rowCount: 0 });

      const res = await app.inject({
        method: 'PATCH',
        url: '/knowledge/suggestions/99999999-9999-4999-8999-999999999999',
        headers: { ...AUTH, 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'confirmed' }),
      });
      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body) as { success: boolean; error: string };
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/not found or already reviewed/i);
    });

    it('returns 400 for invalid status value', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/knowledge/suggestions/${SUGGESTION_ID}`,
        headers: { ...AUTH, 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'invalid' }),
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as { success: boolean };
      expect(body.success).toBe(false);
    });
  });
});
