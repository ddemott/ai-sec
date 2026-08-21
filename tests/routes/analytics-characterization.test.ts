/**
 * CHARACTERIZATION tests for the seven /analytics + /coverage + /feedback
 * routes that had no coverage at all.
 *
 * WHY THIS FILE EXISTS, AND WHY IT LANDS BEFORE THE REFACTOR.
 * `src/routes/analytics.ts` is being split into services. The existing
 * `analytics.test.ts` exercises only 2 of the 9 route paths, so extracting the
 * other 7 would move code whose behaviour nothing describes — the exact
 * "green CI but broken in prod" seam this project keeps paying for.
 *
 * These tests are therefore written against the CURRENT implementation and must
 * pass BEFORE a line moves. They are not a specification of what these routes
 * ought to do; they are a record of what they DO. If the refactor changes an
 * answer, one of these fails, and that is the whole point. Where current
 * behaviour looks questionable it is pinned as-is and flagged in a comment
 * rather than quietly "fixed" — changing behaviour under cover of a refactor is
 * how a refactor becomes an outage.
 *
 * 5W:
 *   WHO  — the dashboard's analytics, coverage and feedback surfaces
 *   WHAT — HTTP contract: status, response shape, and the coercions applied
 *   WHEN — before and after the service extraction
 *   WHERE— src/routes/analytics.ts
 *   WHY  — a refactor is only safe if something fails when it is wrong
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';

import { registerAnalyticsRoutes } from '../../src/routes/analytics';

const TENANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

let app: FastifyInstance;
let queryResponses: Array<{ rows: unknown[]; rowCount?: number } | Error>;
let queries: { text: string; params: unknown[] }[];
/** Scripted answer for the check_coverage_gaps SELECT (dry-run tests). */
let coverageGapRows: unknown[] | null = null;
/** Make that same SELECT throw, to prove ROLLBACK still runs. */
let coverageGapsThrows = false;

function buildApp() {
  queries = [];
  queryResponses = [];

  const mockClient = {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      queries.push({ text, params: params || [] });
      if (/check_coverage_gaps/i.test(text)) {
        if (coverageGapsThrows) throw new Error('check_coverage_gaps exploded');
        if (coverageGapRows) return { rows: coverageGapRows, rowCount: coverageGapRows.length };
      }
      const next = queryResponses.shift();
      if (next instanceof Error) throw next;
      if (next) return next;
      // Draft-graph inserts read ids straight off `RETURNING`, so an empty
      // default makes insertDraftGraph throw on `rows[0].<x>_id` and the route
      // 500s for a reason that has nothing to do with what is under test.
      // Hand back a plausible id row for any RETURNING statement.
      if (/RETURNING/i.test(text)) {
        return {
          rows: [
            {
              service_id: '11111111-1111-4111-8111-111111111111',
              resource_id: '22222222-2222-4222-8222-222222222222',
              employee_id: '33333333-3333-4333-8333-333333333333',
              customer_id: '44444444-4444-4444-8444-444444444444',
              appointment_id: '55555555-5555-4555-8555-555555555555',
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };

  const mockPool = {
    connect: vi.fn(async () => mockClient),
    query: vi.fn(async (t: string, p?: unknown[]) => mockClient.query(t, p)),
  } as unknown as Pool;

  const withTenantClient = async <T>(
    _tenantId: string,
    fn: (client: PoolClient) => Promise<T>
  ): Promise<T> => fn(mockClient as unknown as PoolClient);

  const fastify = Fastify({ logger: false });
  type TenantRequest = FastifyRequest & { tenantId?: string };
  fastify.addHook('preHandler', async (request: TenantRequest) => {
    const tenantId =
      (request.query as Record<string, string>)?.tenant_id ||
      (request.headers['x-tenant-id'] as string);
    if (tenantId) request.tenantId = tenantId;
  });

  registerAnalyticsRoutes(fastify, mockPool, withTenantClient);
  return fastify;
}

const hdr = { 'x-tenant-id': TENANT_ID };

beforeEach(() => {
  vi.clearAllMocks();
  coverageGapRows = null;
  coverageGapsThrows = false;
  app = buildApp();
});

describe('GET /analytics/ai-cost — characterization', () => {
  it('HAPPY: totals the estimated cost across the breakdown rows', async () => {
    queryResponses.push({
      rows: [
        {
          source: 'voice_llm',
          provider: 'openai',
          model: 'gpt-4.1-mini',
          input_tokens: '137971',
          output_tokens: '2100',
          characters_count: '0',
          audio_duration_ms: '0',
          estimated_cost_usd: '0.0612',
        },
        {
          source: 'tts',
          provider: 'deepgram',
          model: 'aura-asteria-en',
          input_tokens: '0',
          output_tokens: '0',
          characters_count: '4210',
          audio_duration_ms: '96000',
          estimated_cost_usd: '0.0068',
        },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/analytics/ai-cost', headers: hdr });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Every numeric field is a NUMBER, not the string pg handed back.
    expect(body.breakdown[0].input_tokens).toBe(137971);
    expect(typeof body.breakdown[0].input_tokens).toBe('number');
    expect(body.breakdown[1].audio_duration_ms).toBe(96000);

    // The total is computed in JS from the coerced values, not by SQL.
    expect(body.total_estimated_cost_usd).toBeCloseTo(0.068, 6);
    expect(body.breakdown).toHaveLength(2);
  });

  it('HAPPY: no rows → empty breakdown and a zero total (not null, not undefined)', async () => {
    // WHY: the dashboard renders `total.toFixed(...)`; a null here is a crash.
    queryResponses.push({ rows: [] });
    const res = await app.inject({ method: 'GET', url: '/analytics/ai-cost', headers: hdr });
    expect(res.json()).toEqual({ breakdown: [], total_estimated_cost_usd: 0 });
  });

  it('HAPPY: scopes to the current calendar month and to the tenant', async () => {
    // WHY: the month window is in SQL (`date_trunc('month', now())`). Pinning it
    //      means an extraction cannot quietly widen the billing window.
    queryResponses.push({ rows: [] });
    await app.inject({ method: 'GET', url: '/analytics/ai-cost', headers: hdr });
    expect(queries[0].text).toContain("date_trunc('month', now())");
    expect(queries[0].params).toEqual([TENANT_ID]);
  });

  it('SAD: no tenant context → does not reach the database', async () => {
    const res = await app.inject({ method: 'GET', url: '/analytics/ai-cost' });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(queries).toHaveLength(0);
  });
});

describe('POST /feedback — characterization', () => {
  it('SAD: missing page or comment → 400 with the documented error shape', async () => {
    // WHY: the dashboard branches on `success === false`; the shape is contract.
    const res = await app.inject({
      method: 'POST',
      url: '/feedback',
      headers: hdr,
      payload: { page: 'analytics' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ success: false, error: 'page and comment are required' });
    expect(queries).toHaveLength(0);
  });

  it('HAPPY: a complete submission returns { success: true }', async () => {
    queryResponses.push({ rows: [], rowCount: 1 });
    const res = await app.inject({
      method: 'POST',
      url: '/feedback',
      headers: hdr,
      payload: { page: 'analytics', comment: 'the utilization grid is unreadable on mobile' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
  });
});

describe('GET /call-summaries — characterization', () => {
  it('SAD: customer_id is required → 400, no query', async () => {
    const res = await app.inject({ method: 'GET', url: '/call-summaries', headers: hdr });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ success: false, error: 'customer_id is required' });
    expect(queries).toHaveLength(0);
  });

  it('HAPPY: returns the rows verbatim — an ARRAY, not an envelope', async () => {
    // WHY: this route sends `res.rows` directly while its siblings send objects.
    //      That inconsistency is real and is pinned rather than tidied: changing
    //      it here would break the dashboard under cover of a refactor.
    const rows = [{ summary: 'Booked a haircut', started_at: '2026-08-20T10:00:00Z' }];
    queryResponses.push({ rows });
    const res = await app.inject({
      method: 'GET',
      url: `/call-summaries?customer_id=${TENANT_ID}`,
      headers: hdr,
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
    expect(res.json()).toEqual(rows);
  });
});

describe('GET /coverage — characterization', () => {
  it('HAPPY: returns rows verbatim as an array', async () => {
    const rows = [{ shift_date: '2026-08-21', covered_minutes: 480 }];
    queryResponses.push({ rows });
    const res = await app.inject({ method: 'GET', url: '/coverage', headers: hdr });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(rows);
  });

  it('SAD: no tenant context → no query runs', async () => {
    const res = await app.inject({ method: 'GET', url: '/coverage' });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(queries).toHaveLength(0);
  });
});

describe('GET /analytics/utilization — characterization', () => {
  it('HAPPY: responds with a { cells } envelope', async () => {
    // WHY: unlike /coverage and /call-summaries this one wraps its payload.
    //      The asymmetry is the thing most likely to be "cleaned up" by accident.
    queryResponses.push({ rows: [{ tz: 'America/Chicago' }] });
    queryResponses.push({ rows: [] });
    queryResponses.push({ rows: [] });
    queryResponses.push({ rows: [] });
    const res = await app.inject({ method: 'GET', url: '/analytics/utilization', headers: hdr });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('cells');
  });

  it('SAD: no tenant context → no query runs', async () => {
    const res = await app.inject({ method: 'GET', url: '/analytics/utilization' });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(queries).toHaveLength(0);
  });
});

describe('GET /analytics/cohorts — characterization', () => {
  it('SAD: no tenant context → no query runs', async () => {
    const res = await app.inject({ method: 'GET', url: '/analytics/cohorts' });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(queries).toHaveLength(0);
  });

  it('HAPPY: normalizes caller phones to the last 10 digits in SQL', async () => {
    // WHY: cohorting joins calls to people by phone. The normalization lives in
    //      SQL (`right(regexp_replace(...), 10)`), so an extraction that
    //      reformats the query could silently split one caller into two cohorts.
    queryResponses.push({ rows: [] });
    queryResponses.push({ rows: [] });
    queryResponses.push({ rows: [] });
    await app.inject({ method: 'GET', url: '/analytics/cohorts', headers: hdr });
    expect(queries[0].text).toContain('regexp_replace');
    expect(queries[0].text).toContain('10');
  });
});

/**
 * POST /coverage/dry-run had ZERO coverage — lines 638-720, the single largest
 * uncovered block in the file and the only route here that opens a transaction.
 *
 * It matters more than its neighbours because it WRITES. It inserts a whole
 * draft graph to ask "what would coverage look like?", then rolls back. The
 * property worth defending is that the rollback is unconditional: a preview
 * that ever persisted would silently create real services, employees and shifts
 * from a form the owner had not submitted.
 */
describe('POST /coverage/dry-run — characterization', () => {
  /** Smallest draft the schema accepts. */
  const draft = () => ({
    services: [{ tmp_id: 's1', name: 'Haircut', duration_minutes: 30 }],
    resources: [{ tmp_id: 'r1', name: 'Chair 1' }],
    employees: [{ tmp_id: 'e1', name: 'Tess' }],
    shifts: [{ employee_tmp_id: 'e1', day_of_week: 1, start_time: '09:00', end_time: '17:00' }],
    service_employee: [{ service_tmp_id: 's1', employee_tmp_id: 'e1' }],
    service_resource: [{ service_tmp_id: 's1', resource_tmp_id: 'r1' }],
  });

  const post = (payload: unknown) =>
    app.inject({ method: 'POST', url: '/coverage/dry-run', headers: hdr, payload });

  it('SAD: no tenant context → never opens a transaction', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/coverage/dry-run',
      payload: draft(),
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(queries).toHaveLength(0);
  });

  it('SAD: a malformed draft is rejected by Zod with details, before any SQL', async () => {
    const res = await post({ services: [{ tmp_id: '', name: '', duration_minutes: -5 }] });
    expect(res.statusCode).toBe(400);
    expect(res.json().success).toBe(false);
    expect(res.json().error).toBe('Validation failed');
    expect(Array.isArray(res.json().details)).toBe(true);
    expect(queries).toHaveLength(0);
  });

  it('SAD: a calendar-invalid date is rejected here, never at the ::date cast', async () => {
    // WHY: "2026-02-30" is correctly SHAPED and not a real date. Letting it
    //      reach `$n::date` turns a user typo into a 500.
    const res = await post({ ...draft(), start_date: '2026-02-30' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Validation failed');
    expect(queries).toHaveLength(0);
  });

  it('SAD: end before start → 400 rather than a misleading "no gaps"', async () => {
    // WHY: generate_series(start, end) with end < start returns NO ROWS, which
    //      reads as perfect coverage. Refusing is the honest answer.
    const res = await post({ ...draft(), start_date: '2026-09-10', end_date: '2026-09-01' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      success: false,
      error: 'end_date must be on or after start_date',
    });
    expect(queries).toHaveLength(0);
  });

  it('SAD: duplicate tmp_ids → 400 naming them, before any SQL', async () => {
    const d = draft();
    d.services.push({ tmp_id: 's1', name: 'Colour', duration_minutes: 60 });
    const res = await post(d);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Draft contains duplicate tmp_ids');
    expect(res.json().details.length).toBeGreaterThan(0);
    expect(queries).toHaveLength(0);
  });

  it('SAD: a mapping referencing an unknown tmp_id → 400 rather than a silent drop', async () => {
    // WHY: dropping the dangling reference would render a coverage preview that
    //      does not describe the draft the owner is looking at.
    const d = draft();
    d.service_employee.push({ service_tmp_id: 's-nope', employee_tmp_id: 'e1' });
    const res = await post(d);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Draft references unknown tmp_ids');
    expect(res.json().details.length).toBeGreaterThan(0);
    expect(queries).toHaveLength(0);
  });

  it('HAPPY: returns coverage rows and ALWAYS rolls back', async () => {
    // THE property of this route. It inserts a full draft graph to compute the
    // preview; if the ROLLBACK were ever skipped, a preview would create real
    // services, employees and shifts the owner never submitted.
    const gapRows = [
      {
        service_id: null,
        service_name: 'Haircut',
        check_date: '2026-09-01',
        gap_hours: 2,
        covered_hours: 6,
        total_open_hours: 8,
        coverage_pct: 75,
        status: 'partial',
        details: null,
      },
    ];
    // insertDraftGraph's statements fall through to the mock's defaults (see
    // buildApp); only the coverage SELECT needs a scripted answer, so match on
    // the call that asks for it rather than counting statements.
    coverageGapRows = gapRows;

    const res = await post({ ...draft(), start_date: '2026-09-01', end_date: '2026-09-07' });
    expect(res.statusCode).toBe(200);

    const texts = queries.map((q) => q.text);
    expect(texts).toContain('BEGIN');
    expect(texts).toContain('ROLLBACK');
    // Never COMMIT — a preview that commits is not a preview.
    expect(texts.some((t) => /^\s*COMMIT/i.test(t))).toBe(false);
  });

  it('HAPPY: rolls back even when the coverage query itself throws', async () => {
    // WHY: the ROLLBACK sits in a `finally`. If it were in the success path
    //      only, a failing preview would LEAK the inserted draft into the
    //      tenant's real data — the worst possible outcome for this route.
    coverageGapsThrows = true;

    const res = await post({ ...draft(), start_date: '2026-09-01', end_date: '2026-09-07' });
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(queries.map((q) => q.text)).toContain('ROLLBACK');
  });
});
