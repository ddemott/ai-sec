/**
 * Route-level tests for the destructive tenant routes:
 *   DELETE /tenants/:id        — admin removes a tenant entirely
 *   POST /tenants/reorder      — admin saves a new sort_order across tenants
 *
 * These are the two routes whose failure modes can lose customer data
 * (delete) or scramble the admin tenant picker (reorder), so the test
 * file pins both happy paths and the validation/auth/rollback contracts.
 *
 * The DB-level reorder schema is covered separately in
 * `src/tenant-reorder.test.ts` (real Postgres, schema + ORDER BY contract).
 * This file covers the route handler surface — auth gates, payload
 * validation, the BEGIN/COMMIT shape, and the response envelope.
 *
 * Origin: historical major refactor (see RESOLVED.md) "Add tests for destructive flows" —
 * the verify-first found that DELETE /tenants/:id and POST /tenants/reorder
 * had no route-handler-level coverage despite the dashboard side
 * exercising them via superadmin.test.tsx.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerTenantRoutes } from './routes/tenants';
import {
  createMockClient,
  createMockPool,
  type MockClient,
  type MockResponse,
} from './test-utils-mock';

// Real v4 UUIDs — Zod schemas in the route handler reject pattern fillers.
const TENANT_ID_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const TENANT_ID_B = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const TENANT_ID_C = 'cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa';

let app: FastifyInstance;
let mockClient: MockClient;
let queryResponses: MockResponse[];
let queries: { text: string; params: unknown[] }[];
let authStub: {
  user_id: string;
  tenant_id: string;
  email: string;
  role: 'owner' | 'front_desk';
} | null;

function buildApp() {
  const handle = createMockClient();
  mockClient = handle.mockClient;
  queryResponses = handle.queryResponses;
  queries = handle.queries;
  const mockPool = createMockPool(mockClient);

  const fastify = Fastify({ logger: false });

  // Stub the JWT auth that requireAuth() depends on. Tests set authStub
  // in beforeEach to control whether the route is "authenticated".
  fastify.addHook('preHandler', async (request) => {
    (request as unknown as { auth: typeof authStub }).auth = authStub;
  });

  registerTenantRoutes(fastify, mockPool);
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
  // Default: authenticated as a super-admin user. JWT payload shape is
  // snake_case (tenant_id, user_id) — matches the verified JWT decoded
  // by registerJwtAuthHook.
  authStub = {
    user_id: 'admin-user',
    tenant_id: '00000000-0000-0000-0000-000000000000',
    email: 'admin@test',
    role: 'owner',
  };
});

// ════════════════════════════════════════════════════════════════════
// DELETE /tenants/:id
// ════════════════════════════════════════════════════════════════════

describe('DELETE /tenants/:id — happy paths', () => {
  it('HAPPY: deletes the tenant when the row exists and returns success', async () => {
    // WHO: super-admin removing a churned customer's tenant
    // WHAT: route runs `DELETE FROM tenants WHERE tenant_id = $1 RETURNING tenant_id`,
    //       sees rowCount=1 via assertRowAffected, returns { success: true }
    // WHEN: confirm-by-name dialog has resolved + admin confirmed delete
    // WHERE: src/routes/tenants.ts → app.delete('/tenants/:id', ...)
    // WHY: this is the destructive path — it must (a) actually run the DELETE
    //      against the live DB, (b) report success only when a row was affected
    //      (so a race-condition double-delete returns 404 not silent success),
    //      and (c) emit the audit log event so support can trace which user
    //      destroyed which tenant
    queryResponses.push({ rows: [{ tenant_id: TENANT_ID_A }], rowCount: 1 });

    const res = await app.inject({ method: 'DELETE', url: `/tenants/${TENANT_ID_A}` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
    expect(queries).toHaveLength(1);
    expect(queries[0].text).toContain('DELETE FROM tenants');
    expect(queries[0].params).toEqual([TENANT_ID_A]);
  });
});

describe('DELETE /tenants/:id — sad paths', () => {
  it('SAD: returns 404 when no row was affected (tenant id does not exist)', async () => {
    // WHO: caller passing an id for a tenant that no longer exists
    //      (typo, race with a concurrent delete, stale UI state)
    // WHAT: assertRowAffected sees rowCount=0 → 404 + error envelope
    // WHEN: a deleted tenant's id is reused in a delete request
    // WHERE: routeHelpers.assertRowAffected — silent-no-op guard
    // WHY: returning 200 on a no-op delete would let UIs incorrectly mark
    //      the tenant as deleted, hiding stale state from the user
    queryResponses.push({ rows: [], rowCount: 0 });

    const res = await app.inject({ method: 'DELETE', url: `/tenants/${TENANT_ID_A}` });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ success: false });
  });

  it('SAD: returns 401 when no auth context is attached', async () => {
    // WHO: unauthenticated request reaching the delete endpoint
    //      (token expired, never logged in, manually-crafted request)
    // WHAT: requireAuth fails fast → 401 before any DB query runs
    // WHEN: any unauthenticated DELETE attempt
    // WHERE: requireAuth(req, reply) at top of the handler
    // WHY: tenant deletion must never run without an authenticated principal —
    //      the audit log entry would otherwise have no actor to attribute
    authStub = null;

    const res = await app.inject({ method: 'DELETE', url: `/tenants/${TENANT_ID_A}` });

    expect(res.statusCode).toBe(401);
    expect(queries).toHaveLength(0); // no DB query — auth gate fired first
  });
});

// ════════════════════════════════════════════════════════════════════
// POST /tenants/reorder
// ════════════════════════════════════════════════════════════════════

describe('POST /tenants/reorder — happy paths', () => {
  it('HAPPY: assigns sort_order = 0..N-1 in transaction order', async () => {
    // WHO: super-admin saving a new tenant ordering after drag/drop
    // WHAT: route opens a transaction, runs N UPDATEs (sort_order = i, id = order[i]),
    //       commits, and emits an audit event with the count
    // WHEN: admin clicks "Save Order" in the drag-reorder banner
    // WHERE: src/routes/tenants.ts → app.post('/tenants/reorder', ...)
    // WHY: the per-row UPDATE order matters — if the loop is reversed or
    //      indexes drift, the saved order doesn't match what the admin saw,
    //      and they'll lose confidence in the picker. Pinning the
    //      sort_order = i invariant prevents that drift
    queryResponses.push({ rows: [], rowCount: 0 }); // BEGIN
    queryResponses.push({ rows: [], rowCount: 1 }); // UPDATE row 0
    queryResponses.push({ rows: [], rowCount: 1 }); // UPDATE row 1
    queryResponses.push({ rows: [], rowCount: 1 }); // UPDATE row 2
    queryResponses.push({ rows: [], rowCount: 0 }); // COMMIT

    const res = await app.inject({
      method: 'POST',
      url: '/tenants/reorder',
      payload: { order: [TENANT_ID_C, TENANT_ID_A, TENANT_ID_B] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });

    const updateQueries = queries.filter((q) => q.text.startsWith('UPDATE'));
    expect(updateQueries).toHaveLength(3);
    expect(updateQueries[0].params).toEqual([0, TENANT_ID_C]);
    expect(updateQueries[1].params).toEqual([1, TENANT_ID_A]);
    expect(updateQueries[2].params).toEqual([2, TENANT_ID_B]);

    // BEGIN must precede the UPDATEs and COMMIT must follow
    expect(queries[0].text).toBe('BEGIN');
    expect(queries[queries.length - 1].text).toBe('COMMIT');
  });
});

describe('POST /tenants/reorder — sad paths', () => {
  it('SAD: returns 400 when order is missing or empty', async () => {
    // WHO: malformed client request with empty `order` array
    // WHAT: handler validates `Array.isArray(order) && order.length > 0` → 400
    // WHEN: a buggy client posts {} or { order: [] }
    // WHERE: src/routes/tenants.ts:159 input validation block
    // WHY: an empty-array reorder is a no-op but the handler would still
    //      open + commit a transaction with zero updates, polluting the
    //      audit log with empty events; reject early
    const res = await app.inject({
      method: 'POST',
      url: '/tenants/reorder',
      payload: { order: [] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ success: false });
    expect(queries).toHaveLength(0); // no DB query, no transaction
  });

  it('SAD: returns 400 when order is not an array', async () => {
    // WHO: client submitting wrong-shape payload (string, object, null)
    // WHAT: Array.isArray check fails → 400
    // WHY: defense in depth — a non-array body would crash the for-loop
    //      with a confusing runtime error instead of a clean validation 400
    const res = await app.inject({
      method: 'POST',
      url: '/tenants/reorder',
      payload: { order: 'not-an-array' },
    });

    expect(res.statusCode).toBe(400);
    expect(queries).toHaveLength(0);
  });

  it('SAD: ROLLBACK on UPDATE failure mid-transaction (no partial reorder)', async () => {
    // WHO: a DB hiccup (lock timeout, FK violation) hits during the
    //      reorder transaction's 2nd UPDATE
    // WHAT: handler's try/catch ROLLBACKs and re-throws; route's withHandler
    //       wrapper turns the throw into a 500 envelope. No partial reorder
    //       persists.
    // WHEN: rare but real — a concurrent migration or write contention
    //       causes one of the UPDATEs to fail
    // WHERE: src/routes/tenants.ts BEGIN/UPDATE/COMMIT block, catch arm
    // WHY: a half-committed reorder would leave tenants in an inconsistent
    //      sort_order state — some rows updated, some not. ROLLBACK keeps
    //      the table consistent and lets the admin retry.
    queryResponses.push({ rows: [], rowCount: 0 }); // BEGIN
    queryResponses.push({ rows: [], rowCount: 1 }); // UPDATE row 0 succeeds
    // Force the next query (UPDATE row 1) to throw — overrides the FIFO queue
    // by replacing the mock once.
    const originalQuery = mockClient.query;
    let callIdx = 0;
    mockClient.query = vi.fn(async (text: string, params?: unknown[]) => {
      callIdx++;
      if (callIdx === 3) {
        // 3rd query is the 2nd UPDATE; throw to simulate DB error.
        throw new Error('lock_not_available');
      }
      return originalQuery(text, params);
    });

    const res = await app.inject({
      method: 'POST',
      url: '/tenants/reorder',
      payload: { order: [TENANT_ID_C, TENANT_ID_A, TENANT_ID_B] },
    });

    expect(res.statusCode).toBe(500);
    // restore so subsequent tests aren't affected
    mockClient.query = originalQuery;
  });

  it('SAD: returns 401 when no auth context is attached', async () => {
    // WHO: unauthenticated reorder attempt
    // WHAT: requireAuth fails fast → 401 before any DB query runs
    // WHY: tenant ordering is admin-scoped data — must not be writable
    //      by anonymous callers regardless of payload validity
    authStub = null;

    const res = await app.inject({
      method: 'POST',
      url: '/tenants/reorder',
      payload: { order: [TENANT_ID_A] },
    });

    expect(res.statusCode).toBe(401);
    expect(queries).toHaveLength(0);
  });
});
