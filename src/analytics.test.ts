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
    const body = res.json() as unknown[];
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
    const body = res.json() as unknown[];
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
    const body = res.json() as unknown[];
    expect(body).toHaveLength(2);
    const dataQuery = queries.find((q) => q.text.includes('user_feedback'));
    expect(dataQuery).toBeDefined();
    // Super-admin query has no tenant_id WHERE clause
    expect(dataQuery!.text).not.toContain('WHERE f.tenant_id');
  });
});
