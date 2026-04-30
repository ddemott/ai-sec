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
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';

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
  } as any;

  const withTenantClient = async <T>(_tenantId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> =>
    fn(mockClient as unknown as PoolClient);

  const fastify = Fastify({ logger: false });

  fastify.addHook('preHandler', async (request: any) => {
    const tenantId =
      (request.query as Record<string, string>)?.tenant_id ||
      (request.headers['x-tenant-id'] as string);
    if (tenantId) {
      request.tenantId = tenantId;
    }
  });

  registerAnalyticsRoutes(fastify, mockPool, withTenantClient as any);
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

describe('GET /coverage/staffing — Happy Paths', () => {
  it('1. groups employees under each service and returns shift windows', async () => {
    // WHO: Owner viewing the service-employee staffing map for a Wednesday.
    // WHAT: Each row from the SQL is one (service, employee, shift) tuple;
    //       route should fold them into one entry per service with a nested
    //       employees array.
    // WHERE: GET /coverage/staffing?day_of_week=3.
    // WHEN: Whenever the staffing map view loads.
    // WHY: Surfaces gaps where a service has no skilled employee on shift.
    queryResponses.push({
      rows: [
        {
          service_id: 'svc-1',
          service_name: 'Oil Change',
          duration_minutes: 30,
          employee_id: 'emp-1',
          employee_name: 'Alice',
          shift_start: '08:00:00',
          shift_end: '17:00:00',
        },
        {
          service_id: 'svc-1',
          service_name: 'Oil Change',
          duration_minutes: 30,
          employee_id: 'emp-2',
          employee_name: 'Bob',
          shift_start: '12:00:00',
          shift_end: '20:00:00',
        },
        {
          service_id: 'svc-2',
          service_name: 'Tire Rotation',
          duration_minutes: 45,
          employee_id: null,
          employee_name: null,
          shift_start: null,
          shift_end: null,
        },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/coverage/staffing?tenant_id=${TENANT_ID}&day_of_week=3`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ service_id: string; employees: unknown[] }>;
    expect(body).toHaveLength(2);
    expect(body[0].service_id).toBe('svc-1');
    expect(body[0].employees).toHaveLength(2);
    expect(body[1].service_id).toBe('svc-2');
    expect(body[1].employees).toHaveLength(0);
  });

  it('2. filters soft-deleted services and employees in the SQL', async () => {
    // WHO: Owner whose dashboard recently soft-deleted a service or
    //      offboarded an employee.
    // WHAT: Both is_deleted filters must be present — services on the
    //      `s.is_deleted` predicate, employees on the JOIN's
    //      `e.is_deleted = false` clause.
    // WHERE: src/routes/analytics.ts:55-60 (service-employee skill matrix).
    // WHEN: Every GET /coverage/staffing request.
    // WHY: BUG-038 partial — soft-deletable tables must filter is_deleted
    //      in SELECT. A removed service appearing in the staffing map
    //      would mislead owners about active offerings.
    queryResponses.push({ rows: [] });

    await app.inject({
      method: 'GET',
      url: `/coverage/staffing?tenant_id=${TENANT_ID}&day_of_week=1`,
    });

    expect(queries).toHaveLength(1);
    const sql = queries[0].text;
    expect(sql).toMatch(/s\.is_deleted IS NULL OR s\.is_deleted = false/);
    expect(sql).toMatch(/e\.is_deleted = false/);
    expect(queries[0].params).toEqual([TENANT_ID, 1]);
  });

  it('3. defaults day_of_week to today when query param is missing', async () => {
    // WHAT: When ?day_of_week is omitted, route should fall back to
    //       new Date().getDay() (0-6, Sun=0). Mocking the Date globally
    //       isn't worth the setup; we assert the second SQL param is a
    //       valid 0-6 integer.
    // WHY: Caller can call /coverage/staffing without args and still
    //      get something useful (today's staffing).
    queryResponses.push({ rows: [] });

    const res = await app.inject({
      method: 'GET',
      url: `/coverage/staffing?tenant_id=${TENANT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const dow = queries[0].params[1] as number;
    expect(dow).toBeGreaterThanOrEqual(0);
    expect(dow).toBeLessThanOrEqual(6);
  });
});

// =============================================
// SAD PATHS
// =============================================

describe('GET /coverage/staffing — Sad Paths', () => {
  it('4. clamps invalid day_of_week to today (no error thrown)', async () => {
    // WHO: Caller hitting the route with a garbage day_of_week (e.g. an
    //      old client cached from a refactor).
    // WHAT: Route should not throw — it falls back to new Date().getDay()
    //      rather than letting a NaN propagate into the SQL.
    // WHY: Defensive default keeps the dashboard usable when query
    //      params get corrupted; the alternative is a 500 that masks
    //      the real client bug.
    queryResponses.push({ rows: [] });

    const res = await app.inject({
      method: 'GET',
      url: `/coverage/staffing?tenant_id=${TENANT_ID}&day_of_week=99`,
    });

    expect(res.statusCode).toBe(200);
    const dow = queries[0].params[1] as number;
    expect(dow).toBeGreaterThanOrEqual(0);
    expect(dow).toBeLessThanOrEqual(6);
  });

  it('5. clamps non-numeric day_of_week to today', async () => {
    // WHAT: parseInt('abc', 10) === NaN — the route should clamp to today.
    // WHY: Same defensive default; we never want NaN reaching Postgres.
    queryResponses.push({ rows: [] });

    const res = await app.inject({
      method: 'GET',
      url: `/coverage/staffing?tenant_id=${TENANT_ID}&day_of_week=abc`,
    });

    expect(res.statusCode).toBe(200);
    const dow = queries[0].params[1] as number;
    expect(dow).toBeGreaterThanOrEqual(0);
    expect(dow).toBeLessThanOrEqual(6);
  });
});

// =============================================
// /coverage (gap detection)
// =============================================

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
