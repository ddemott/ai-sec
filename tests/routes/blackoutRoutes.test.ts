/**
 * T-106 — the blackout CRUD an owner drives from the Schedule tab.
 *
 * WHO: a business owner declaring "we are closed on the 25th".
 * WHAT: list within a window, upsert, and delete-with-404-on-miss.
 * WHEN: CI.
 * WHERE: src/routes/shifts.ts, /shifts/blackouts.
 * WHY: the enforcement is proven against real Postgres in
 *      tests/integration/blackoutDates.realdb.test.ts. This file covers the
 *      HTTP contract around it — validation, the tenant predicate, and the
 *      zero-row delete. That last one matters most: a delete that reports
 *      success without removing anything tells an owner the business is open
 *      when it is still closed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';

import { registerShiftRoutes } from '../../src/routes/shifts';

const TENANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

interface MockQuery {
  text: string;
  params: unknown[];
}

let app: FastifyInstance;
let queries: MockQuery[];
let responses: Array<{ rows: unknown[]; rowCount?: number }>;

function buildApp() {
  queries = [];
  responses = [];
  const mockClient = {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      queries.push({ text, params: params ?? [] });
      return responses.shift() ?? { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  const withTenantClient = async <T>(
    _tenantId: string,
    fn: (client: PoolClient) => Promise<T>
  ): Promise<T> => fn(mockClient as unknown as PoolClient);

  const fastify = Fastify({ logger: false });
  type TenantRequest = FastifyRequest & { tenantId?: string; auth?: { user_id: string } };
  fastify.addHook('preHandler', async (request: TenantRequest) => {
    const header = request.headers['x-tenant-id'];
    if (typeof header === 'string' && header) {
      request.tenantId = header;
      request.auth = { user_id: '00000000-0000-0000-0000-000000000001' };
    }
  });
  registerShiftRoutes(fastify, {} as unknown as Pool, withTenantClient);
  return fastify;
}

const hdr = { 'x-tenant-id': TENANT_ID };

beforeEach(() => {
  app = buildApp();
});

describe('GET /shifts/blackouts', () => {
  it('HAPPY: returns the rows and scopes them to the caller tenant', async () => {
    responses.push({ rows: [{ blackout_date: '2026-12-25', reason: 'Christmas' }] });

    const res = await app.inject({ method: 'GET', url: '/shifts/blackouts', headers: hdr });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ blackout_date: '2026-12-25', reason: 'Christmas' }]);
    expect(queries[0].params[0]).toBe(TENANT_ID);
  });

  it('HAPPY: an optional window is passed through as NULL when absent', async () => {
    // The SQL uses `$2::date IS NULL OR ...`, so an absent window must arrive as
    // NULL rather than as the string "undefined" — which would cast-error and
    // 500 the Schedule tab.
    responses.push({ rows: [] });
    await app.inject({ method: 'GET', url: '/shifts/blackouts', headers: hdr });
    expect(queries[0].params.slice(1)).toEqual([null, null]);
  });

  it('HAPPY: a supplied window reaches the query', async () => {
    responses.push({ rows: [] });
    await app.inject({
      method: 'GET',
      url: '/shifts/blackouts?start_date=2026-12-01&end_date=2026-12-31',
      headers: hdr,
    });
    expect(queries[0].params.slice(1)).toEqual(['2026-12-01', '2026-12-31']);
  });
});

describe('POST /shifts/blackouts', () => {
  it('HAPPY: upserts and returns the saved row', async () => {
    responses.push({ rows: [{ blackout_date: '2026-12-25', reason: 'Christmas' }], rowCount: 1 });

    const res = await app.inject({
      method: 'POST',
      url: '/shifts/blackouts',
      headers: hdr,
      payload: { blackout_date: '2026-12-25', reason: 'Christmas' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ success: boolean }>().success).toBe(true);
    expect(queries[0].text).toContain('ON CONFLICT (tenant_id, blackout_date)');
  });

  it('HAPPY: a closure needs no reason — it is for the owner, not the caller', async () => {
    responses.push({ rows: [{ blackout_date: '2026-12-25', reason: null }], rowCount: 1 });
    const res = await app.inject({
      method: 'POST',
      url: '/shifts/blackouts',
      headers: hdr,
      payload: { blackout_date: '2026-12-25' },
    });
    expect(res.statusCode).toBe(200);
    expect(queries[0].params[2]).toBeNull();
  });

  it.each([
    ['a timestamp', '2026-12-25T00:00:00Z'],
    ['US-style', '12/25/2026'],
    ['a bare year', '2026'],
    ['empty', ''],
  ])('SAD: %s is rejected before any DB call', async (_label, blackout_date) => {
    // A closure is a CALENDAR DAY. Accepting a timestamp here invites a
    // timezone bug into the one concept that is definitionally local-date.
    const res = await app.inject({
      method: 'POST',
      url: '/shifts/blackouts',
      headers: hdr,
      payload: { blackout_date },
    });
    expect(res.statusCode).toBe(400);
    expect(queries).toHaveLength(0);
  });
});

describe('DELETE /shifts/blackouts/:date', () => {
  it('HAPPY: removes the row', async () => {
    responses.push({ rows: [], rowCount: 1 });
    const res = await app.inject({
      method: 'DELETE',
      url: '/shifts/blackouts/2026-12-25',
      headers: hdr,
    });
    expect(res.statusCode).toBe(200);
    expect(queries[0].params).toEqual([TENANT_ID, '2026-12-25']);
  });

  it('SAD: deleting a closure that is not there is a 404, never a silent success', async () => {
    // THE case that matters. A cheerful `{success:true}` on a zero-row delete
    // tells an owner the business is open on a day it is still closed — and
    // they find out from a customer standing outside.
    responses.push({ rows: [], rowCount: 0 });
    const res = await app.inject({
      method: 'DELETE',
      url: '/shifts/blackouts/2026-12-25',
      headers: hdr,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ success: boolean }>().success).toBe(false);
  });

  it('SAD: a malformed date is rejected without touching the DB', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/shifts/blackouts/not-a-date',
      headers: hdr,
    });
    expect(res.statusCode).toBe(400);
    expect(queries).toHaveLength(0);
  });
});
