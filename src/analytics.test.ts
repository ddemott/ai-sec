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

// =============================================
// /coverage (gap detection)
// =============================================
//
// /coverage/staffing was deleted with the employee_shifts rip-out
// (NEEDS-REFACTORING #4 Phase 2). Its tests went with it. /coverage
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
