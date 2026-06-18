/**
 * Tests for /analytics + /coverage routes (src/routes/analytics.ts).
 *
 * Strategy: mock withTenantClient and Fastify-inject HTTP requests.
 * Happy + sad paths with 5W diagnostics. The primary regression target
 * is the soft-delete filter on the /coverage/staffing service-employee
 * skill matrix — services flagged is_deleted = true must not appear in
 * the response.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';

import { registerAnalyticsRoutes } from './routes/analytics';

const TENANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

interface MockQuery {
  text: string;
  params: unknown[];
}

let app: FastifyInstance;
let mockClient: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
let queryResponses: Array<{ rows: unknown[]; rowCount?: number }>;
let queries: MockQuery[];

function buildApp() {
  queries = [];
  queryResponses = [];

  mockClient = {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      queries.push({ text, params: params || [] });
      return queryResponses.shift() || { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };

  const mockPool = {
    connect: vi.fn(async () => mockClient),
    query: vi.fn(async (text: string, params?: unknown[]) => mockClient.query(text, params)),
  } as unknown as Pool;

  const withTenantClient = async <T>(
    _tenantId: string,
    fn: (client: PoolClient) => Promise<T>
  ): Promise<T> => fn(mockClient as unknown as PoolClient);

  const fastify = Fastify({ logger: false });

  // Test-only request shape: the preHandler injects tenantId for the route to read.
  type TenantRequest = FastifyRequest & { tenantId?: string };
  fastify.addHook('preHandler', async (request: TenantRequest) => {
    const tenantId =
      (request.query as Record<string, string>)?.tenant_id ||
      (request.headers['x-tenant-id'] as string);
    if (tenantId) {
      request.tenantId = tenantId;
    }
  });

  registerAnalyticsRoutes(fastify, mockPool, withTenantClient);
  return fastify;
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  queries.length = 0;
  queryResponses.length = 0;
});

// =============================================
// HAPPY PATHS
// =============================================

// =============================================
// /analytics/stats (dashboard top-line counts)
// =============================================

describe('GET /analytics/stats', () => {
  it('HAPPY: returns AnalyticsStats shape with numeric counts', async () => {
    // WHO: dashboard Home/Analytics view loading top-line numbers for a tenant.
    // WHAT: route runs 4 queries (calls, appts, custs, activity) via Promise.all
    //       and assembles { calls, appointments, customers, recent_activity }.
    // WHEN: GET /analytics/stats?tenant_id=<uuid> on dashboard load.
    // WHERE: registerAnalyticsRoutes '/analytics/stats' handler in analytics.ts.
    // WHY: the SQL casts count(*)::int — the response must carry numbers (not
    //      Postgres bigint strings), or the dashboard would render "[object]"/NaN.
    //      The mock is FIFO (shift), so responses MUST be pushed in the exact
    //      Promise.all order: [calls, appts, custs, activity].
    queryResponses.push({ rows: [{ total: 5, today: 1, week: 3 }] }); // calls
    queryResponses.push({ rows: [{ total: 9, today: 2, week: 4, upcoming: 6 }] }); // appointments
    queryResponses.push({ rows: [{ total: 7, new_this_week: 2 }] }); // customers
    queryResponses.push({
      rows: [
        { type: 'appointment', description: 'Appointment booked: Oil Change', timestamp: 'x' },
      ],
    }); // recent_activity

    const res = await app.inject({
      method: 'GET',
      url: `/analytics/stats?tenant_id=${TENANT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.calls).toEqual({ total: 5, today: 1, week: 3 });
    expect(body.appointments).toEqual({ total: 9, today: 2, week: 4, upcoming: 6 });
    expect(body.customers).toEqual({ total: 7, new_this_week: 2 });
    expect(typeof body.calls.total).toBe('number');
    expect(Array.isArray(body.recent_activity)).toBe(true);
    expect(body.recent_activity).toHaveLength(1);
    // voice_sessions is the call source, soft-deleted rows excluded.
    expect(queries[0].text).toContain('voice_sessions');
    expect(queries[0].text).toContain('is_deleted = false');
    expect(queries[0].params).toEqual([TENANT_ID]);
  });

  it('SAD: returns zeroed shape when every aggregate query is empty', async () => {
    // WHO: a brand-new tenant with zero calls/appointments/customers.
    // WHAT: each query returns rows: [] — the route's `?? { total: 0, ... }`
    //       fallbacks must kick in rather than throwing on undefined rows[0].
    // WHEN: GET /analytics/stats for a freshly provisioned (empty) tenant.
    // WHERE: the `calls.rows[0] ?? {...}` fallbacks in the stats handler.
    // WHY: without the fallback the dashboard would crash on first load for a
    //      new business; an empty tenant must render zeros, not an error.
    queryResponses.push({ rows: [] }); // calls
    queryResponses.push({ rows: [] }); // appointments
    queryResponses.push({ rows: [] }); // customers
    queryResponses.push({ rows: [] }); // recent_activity

    const res = await app.inject({
      method: 'GET',
      url: `/analytics/stats?tenant_id=${TENANT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.calls).toEqual({ total: 0, today: 0, week: 0 });
    expect(body.appointments).toEqual({ total: 0, today: 0, week: 0, upcoming: 0 });
    expect(body.customers).toEqual({ total: 0, new_this_week: 0 });
    expect(body.recent_activity).toEqual([]);
  });
});

// =============================================
// /analytics/calls (call-level outcome + volume cut)
// =============================================

describe('GET /analytics/calls', () => {
  it('HAPPY: returns totals + by_outcome + by_day; booked keys on appointment_id', async () => {
    // WHO: Analytics view rendering Conversion / Abandonment / Why panels.
    // WHAT: route runs 3 queries (by_outcome, by_day, totals) via Promise.all.
    //       "booked" must be derived from appointment_id IS NOT NULL, NOT the
    //       freeform outcome string.
    // WHEN: GET /analytics/calls?tenant_id=<uuid> on Analytics view load.
    // WHERE: registerAnalyticsRoutes '/analytics/calls' handler in analytics.ts.
    // WHY: conversion/abandonment are business-critical numbers; keying booked
    //      on the advisory `outcome` text (which the agent writes freeform, e.g.
    //      'booked' vs 'appointment_booked') would undercount real bookings.
    //      FIFO mock: push in [by_outcome, by_day, totals] order.
    queryResponses.push({
      rows: [
        { outcome: 'booked', count: 4, booked: 4 },
        { outcome: 'no_outcome', count: 2, booked: 0 },
      ],
    }); // by_outcome
    queryResponses.push({
      rows: [{ day: '2026-06-11', total: 6, booked: 4 }],
    }); // by_day
    queryResponses.push({ rows: [{ total: 6, booked: 4, abandoned: 2 }] }); // totals

    const res = await app.inject({
      method: 'GET',
      url: `/analytics/calls?tenant_id=${TENANT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totals).toEqual({ total: 6, booked: 4, abandoned: 2 });
    expect(body.by_outcome).toHaveLength(2);
    expect(body.by_day).toEqual([{ day: '2026-06-11', total: 6, booked: 4 }]);
    expect(typeof body.totals.booked).toBe('number');
    // The hard booked signal is appointment_id, not the outcome string.
    expect(queries[0].text).toContain('appointment_id IS NOT NULL');
    expect(queries[0].text).toContain('voice_sessions');
    expect(queries[0].text).toContain('is_deleted = false');
  });

  it('SAD: returns zeroed totals and empty arrays for a tenant with no calls', async () => {
    // WHO: a new tenant whose phone has never rung.
    // WHAT: every query returns rows: [] — totals must fall back to the zero
    //       object and the arrays must be empty (rows passed straight through).
    // WHEN: GET /analytics/calls before any voice_session exists.
    // WHERE: `totals.rows[0] ?? { total: 0, booked: 0, abandoned: 0 }` fallback.
    // WHY: the Analytics view must render an honest "no calls yet" state, not
    //      crash on undefined when the tenant has no call history.
    queryResponses.push({ rows: [] }); // by_outcome
    queryResponses.push({ rows: [] }); // by_day
    queryResponses.push({ rows: [] }); // totals

    const res = await app.inject({
      method: 'GET',
      url: `/analytics/calls?tenant_id=${TENANT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totals).toEqual({ total: 0, booked: 0, abandoned: 0 });
    expect(body.by_outcome).toEqual([]);
    expect(body.by_day).toEqual([]);
  });
});

// =============================================
// /coverage (gap detection)
// =============================================
//
// /coverage/staffing was deleted with the employee_shifts rip-out
// (historical major refactor; see RESOLVED.md, originally tracked as NEEDS-REFACTORING #4 Phase 2). Its tests went with it. /coverage
// itself still works against employee_schedule via check_coverage_gaps.

describe('GET /coverage', () => {
  it('6. passes start_date and end_date through to check_coverage_gaps()', async () => {
    // WHO: Owner running coverage analysis for a date range.
    // WHAT: Route should call the check_coverage_gaps RPC with the
    //       parsed dates, not raw strings. Validates the SQL includes the
    //       function name and the params land in order.
    // WHY: A typo here would silently shift the analysis window without
    //      a visible error — the RPC accepts NULL end_date as "single day".
    queryResponses.push({
      rows: [
        {
          service_id: 'svc-1',
          service_name: 'Oil Change',
          check_date: '2026-05-01',
          gap_hours: 2,
          covered_hours: 6,
          total_open_hours: 8,
          coverage_pct: 75,
          status: 'partial',
          details: {},
        },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/coverage?tenant_id=${TENANT_ID}&start_date=2026-05-01&end_date=2026-05-07`,
    });

    expect(res.statusCode).toBe(200);
    expect(queries[0].text).toContain('check_coverage_gaps');
    expect(queries[0].params).toEqual([TENANT_ID, '2026-05-01', '2026-05-07']);
  });

  it('7. ignores malformed start_date and falls back to today', async () => {
    // WHAT: A bad start_date (regex mismatch) shouldn't reach the RPC.
    //       The route falls back to today's ISO date.
    // WHY: An exception here would cascade to the dashboard's coverage
    //      view and break the load — better to silently default than
    //      propagate the parse error.
    queryResponses.push({ rows: [] });

    const res = await app.inject({
      method: 'GET',
      url: `/coverage?tenant_id=${TENANT_ID}&start_date=not-a-date&end_date=2026-05-07`,
    });

    expect(res.statusCode).toBe(200);
    const startParam = queries[0].params[1] as string;
    expect(startParam).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(startParam).not.toBe('not-a-date');
  });
});

// =============================================
// /call-summaries
// =============================================

describe('GET /call-summaries', () => {
  it('SAD: returns 400 when customer_id is missing', async () => {
    // WHO: dashboard component that forgot to pass customer_id
    // WHAT: handler checks for customer_id before any DB query and returns 400
    // WHEN: GET /call-summaries with no query param
    // WHERE: analytics.ts early-exit guard `if (!customerId)`
    // WHY: without the guard, the query would run with undefined customer_id
    //      and potentially return all call summaries for the tenant
    const res = await app.inject({
      method: 'GET',
      url: `/call-summaries?tenant_id=${TENANT_ID}`,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ success: false, error: 'customer_id is required' });
    expect(queries).toHaveLength(0);
  });

  it('HAPPY: returns call summaries scoped to tenant and customer', async () => {
    // WHO: tenant user viewing call history for a specific customer
    // WHAT: SELECT from call_summaries + call_transcripts WHERE tenant_id = $1 AND customer_id = $2
    // WHEN: customer detail panel opens the Calls tab
    // WHERE: GET /call-summaries?customer_id=<uuid> handler
    // WHY: tenant_id scoping prevents one tenant reading another's call records;
    //      customer_id scoping returns only the relevant customer's history
    const customerId = 'cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa';
    queryResponses.push({
      rows: [
        {
          call_id: 'call-1',
          tenant_id: TENANT_ID,
          customer_id: customerId,
          summary: 'Caller booked an oil change.',
          has_transcript: true,
        },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/call-summaries?tenant_id=${TENANT_ID}&customer_id=${customerId}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(queries[0].text).toContain('tenant_id = $1');
    expect(queries[0].text).toContain('customer_id = $2');
    expect(queries[0].params).toEqual([TENANT_ID, customerId]);
  });
});

// =============================================
// /feedback GET — access branching
// =============================================

const SUPER_ADMIN_TENANT_ID = '00000000-0000-0000-0000-000000000000';

describe('GET /feedback', () => {
  it('HAPPY: normal tenant sees only own-tenant feedback (tenant-scoped query)', async () => {
    // WHO: a tenant owner viewing the feedback log for their business
    // WHAT: SELECT from user_feedback WHERE tenant_id = $1 — scoped to caller
    // WHEN: GET /feedback for a normal (non-super-admin) tenant
    // WHERE: the else branch of `if (isSuperAdmin)` in the handler
    // WHY: without the WHERE clause, every tenant would see every other tenant's
    //      internal feedback — a data isolation failure
    queryResponses.push({
      rows: [{ feedback_id: 1, tenant_id: TENANT_ID, page: 'customers', comment: 'Looks great' }],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/feedback?tenant_id=${TENANT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    const dataQuery = queries.find((q) => q.text.includes('user_feedback'));
    expect(dataQuery).toBeDefined();
    expect(dataQuery!.text).toContain('WHERE f.tenant_id = $1');
    expect(dataQuery!.params).toEqual([TENANT_ID]);
  });

  it('HAPPY: super-admin sees cross-tenant feedback (no WHERE tenant_id)', async () => {
    // WHO: platform super-admin auditing feedback across all tenants
    // WHAT: SELECT from user_feedback with no tenant filter — all rows visible
    // WHEN: GET /feedback from the super-admin dashboard tenant
    // WHERE: `if (isSuperAdmin)` branch; tenantId === SUPER_ADMIN_TENANT_ID
    // WHY: the super-admin view is the only legitimate cross-tenant read;
    //      any non-super-admin caller hitting this branch would be a privilege escalation
    queryResponses.push({
      rows: [
        { feedback_id: 1, tenant_id: TENANT_ID, page: 'home', comment: 'Smooth' },
        { feedback_id: 2, tenant_id: 'other-tenant', page: 'calls', comment: 'Good' },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/feedback?tenant_id=${SUPER_ADMIN_TENANT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    const dataQuery = queries.find((q) => q.text.includes('user_feedback'));
    expect(dataQuery).toBeDefined();
    // Super-admin query has no tenant_id WHERE clause
    expect(dataQuery!.text).not.toContain('WHERE f.tenant_id');
  });
});

describe('GET /analytics/ai-cost', () => {
  it('HAPPY: returns monthly breakdown and total_estimated_cost_usd', async () => {
    // WHO: Tenant owner checking AI usage in the Analytics tab
    // WHAT: Route queries ai_cost_events grouped by source+provider+model for current month
    // WHEN: Called with a valid tenant_id after voice calls have run
    // WHERE: src/routes/analytics.ts GET /analytics/ai-cost
    // WHY: Owner needs to understand AI spend without reading OpenAI/Deepgram dashboards
    queryResponses.push({
      rows: [
        {
          source: 'voice_call',
          provider: 'openai',
          model: 'gpt-4o-mini',
          input_tokens: '12500',
          output_tokens: '3100',
          characters_count: '0',
          audio_duration_ms: '0',
          estimated_cost_usd: '0.00373500',
        },
        {
          source: 'voice_call',
          provider: 'deepgram',
          model: 'nova-3',
          input_tokens: '0',
          output_tokens: '0',
          characters_count: '0',
          audio_duration_ms: '540000',
          estimated_cost_usd: '0.03870000',
        },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/analytics/ai-cost?tenant_id=${TENANT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ breakdown: unknown[]; total_estimated_cost_usd: number }>();
    expect(body.breakdown).toHaveLength(2);
    expect(body.breakdown[0]).toMatchObject({
      source: 'voice_call',
      provider: 'openai',
      model: 'gpt-4o-mini',
      input_tokens: 12500,
      output_tokens: 3100,
      estimated_cost_usd: expect.any(Number),
    });
    expect(body.total_estimated_cost_usd).toBeCloseTo(0.042435, 4);
  });

  it('HAPPY: returns empty breakdown when no events this month', async () => {
    // WHO: New tenant who hasn't had any calls yet
    // WHAT: ai_cost_events returns no rows → empty breakdown + $0 total
    // WHY: Must render cleanly with empty state rather than error
    queryResponses.push({ rows: [] });

    const res = await app.inject({
      method: 'GET',
      url: `/analytics/ai-cost?tenant_id=${TENANT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ breakdown: unknown[]; total_estimated_cost_usd: number }>();
    expect(body.breakdown).toHaveLength(0);
    expect(body.total_estimated_cost_usd).toBe(0);
  });
});
