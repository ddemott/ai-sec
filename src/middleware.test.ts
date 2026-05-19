/**
 * Tests for shared middleware: withHandler, withPoolClient, requireTenantId,
 * requireAuth, tenantMiddleware, logEvent, logWarning, logError.
 *
 * WHO: All route handlers via middleware.ts
 * WHAT: Error wrapping, tenant extraction, logging, pool lifecycle
 * WHERE: src/middleware.ts
 * WHY: Middleware at 54% coverage — withHandler error dispatch, tenantMiddleware,
 *       and logging helpers all need tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FastifyReply, FastifyInstance } from "fastify";
import type { Pool } from "pg";
import {
  withHandler,
  withPoolClient,
  requireTenantId,
  requireAuth,
  requireSuperAdmin,
  tenantMiddleware,
  logEvent,
  logWarning,
  logError,
  AppError,
  type AppRequest,
} from "./middleware";

const SUPER_ADMIN_TENANT_ID = '00000000-0000-0000-0000-000000000000';

// ── Mock helpers ────────────────────────────────────────────────────────

/** Mock FastifyReply with the slice of methods middleware actually touches. */
interface MockReply {
  statusCode: number;
  body: unknown;
  status(code: number): MockReply;
  send(data: unknown): MockReply;
}

function createMockReply(): FastifyReply {
  const reply = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      reply.statusCode = code;
      return reply;
    },
    send(data: unknown) {
      reply.body = data;
      return reply;
    },
  } satisfies MockReply;
  return reply as unknown as FastifyReply;
}

function createMockRequest(overrides: Partial<AppRequest> & Record<string, unknown> = {}): AppRequest {
  return {
    tenantId: undefined,
    auth: undefined,
    body: {},
    query: {},
    url: '/test',
    method: 'GET',
    log: {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      child: vi.fn().mockReturnThis(),
    },
    ...overrides,
  } as unknown as AppRequest;
}

beforeEach(() => vi.clearAllMocks());

// ═══════════════════════════════════════════════════════════════════════
// AppError
// ═══════════════════════════════════════════════════════════════════════

describe("AppError", () => {
  it("constructs with message, code, and statusCode (WHO: any service/route | WHAT: structured error creation | WHERE: AppError constructor | WHY: consistent error shape across all routes)", () => {
    const err = new AppError('Not found', 'NOT_FOUND', 404);
    expect(err.message).toBe('Not found');
    expect(err.code).toBe('NOT_FOUND');
    expect(err.statusCode).toBe(404);
    expect(err.name).toBe('AppError');
    expect(err).toBeInstanceOf(Error);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// withHandler — HAPPY PATHS
// ═══════════════════════════════════════════════════════════════════════

describe("withHandler — happy paths", () => {
  it("passes through successful handler result (WHO: any route | WHAT: handler runs without error → result returned | WHERE: withHandler wrapper | WHY: decorator should be transparent on success)", async () => {
    const handler = vi.fn(async (_req: AppRequest, reply: FastifyReply) => reply.send({ success: true }));
    const wrapped = withHandler(handler, 'Test failed');

    const req = createMockRequest();
    const reply = createMockReply();
    await wrapped(req, reply);

    expect(handler).toHaveBeenCalledOnce();
    expect(reply.body).toEqual({ success: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// withHandler — SAD PATHS
// ═══════════════════════════════════════════════════════════════════════

describe("withHandler — sad paths", () => {
  it("returns AppError status and message (WHO: route handler | WHAT: AppError thrown → status+message from error | WHERE: withHandler catch | WHY: AppErrors carry their own status, not always 500)", async () => {
    const handler = vi.fn(async () => { throw new AppError('Forbidden', 'FORBIDDEN', 403); });
    const wrapped = withHandler(handler, 'Operation failed');

    const req = createMockRequest();
    const reply = createMockReply();
    await wrapped(req, reply);

    expect(reply.statusCode).toBe(403);
    expect(reply.body).toEqual({ success: false, error: 'Forbidden', code: 'FORBIDDEN' });
  });

  it("re-throws TENANT_NOT_FOUND for global handler (WHO: route handler | WHAT: TENANT_NOT_FOUND error propagated | WHERE: withHandler catch | WHY: global handler must catch this for auto-logout on deleted tenant)", async () => {
    const err = new Error('Tenant gone') as Error & { code?: string };
    err.code = 'TENANT_NOT_FOUND';
    const handler = vi.fn(async () => { throw err; });
    const wrapped = withHandler(handler, 'Fetch failed');

    const req = createMockRequest();
    const reply = createMockReply();

    await expect(wrapped(req, reply)).rejects.toThrow('Tenant gone');
  });

  it("uses statusCode from error if present (WHO: validation layer | WHAT: error.statusCode used as HTTP status | WHERE: withHandler catch | WHY: validation errors carry statusCode but aren't AppErrors)", async () => {
    const err = new Error('Bad input') as Error & { statusCode?: number };
    err.statusCode = 422;
    const handler = vi.fn(async () => { throw err; });
    const wrapped = withHandler(handler, 'Validation failed');

    const req = createMockRequest();
    const reply = createMockReply();
    await wrapped(req, reply);

    expect(reply.statusCode).toBe(422);
    expect(reply.body).toEqual({ success: false, error: 'Bad input' });
  });

  it("returns 500 with generic message for unknown errors (WHO: any route | WHAT: unexpected Error → 500 with contextual message | WHERE: withHandler catch | WHY: never leak internal details to client)", async () => {
    const handler = vi.fn(async () => { throw new Error('DB crashed'); });
    const wrapped = withHandler(handler, 'Could not fetch data');

    const req = createMockRequest({ tenantId: 'tenant-123' });
    const reply = createMockReply();
    await wrapped(req, reply);

    expect(reply.statusCode).toBe(500);
    expect(reply.body).toEqual({ success: false, error: 'Could not fetch data' });
    expect(req.log.error).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-123', route: '/test', method: 'GET' }),
      'Could not fetch data',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════
// withPoolClient
// ═══════════════════════════════════════════════════════════════════════

describe("withPoolClient", () => {
  it("returns fn result and releases client (WHO: any DB operation | WHAT: pool.connect → fn → client.release | WHERE: withPoolClient | WHY: eliminates try/finally boilerplate in every route)", async () => {
    const client = { query: vi.fn(), release: vi.fn() };
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;

    const result = await withPoolClient(pool, async (c) => {
      await c.query('SELECT 1');
      return 'done';
    });

    expect(result).toBe('done');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("releases client even when fn throws (WHO: any DB operation | WHAT: fn throws → client still released | WHERE: withPoolClient finally | WHY: prevents pool exhaustion on errors)", async () => {
    const client = { query: vi.fn(), release: vi.fn() };
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;

    await expect(
      withPoolClient(pool, async () => { throw new Error('Query failed'); })
    ).rejects.toThrow('Query failed');

    expect(client.release).toHaveBeenCalledOnce();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// requireTenantId
// ═══════════════════════════════════════════════════════════════════════

describe("requireTenantId", () => {
  it("returns tenantId from request (WHO: tenant-scoped route | WHAT: req.tenantId extracted | WHERE: requireTenantId | WHY: all tenant-scoped queries need this value)", () => {
    const req = createMockRequest({ tenantId: 'tid-123' });
    const reply = createMockReply();
    const result = requireTenantId(req, reply);
    expect(result).toBe('tid-123');
  });

  it("falls back to body.tenant_id (WHO: cross-tenant admin | WHAT: tenant_id from request body | WHERE: requireTenantId fallback | WHY: admin routes pass tenant_id in body, not middleware)", () => {
    const req = createMockRequest({ body: { tenant_id: 'body-tid' } });
    const reply = createMockReply();
    const result = requireTenantId(req, reply);
    expect(result).toBe('body-tid');
  });

  it("returns null and sends 400 when missing (WHO: misconfigured client | WHAT: no tenant_id anywhere → 400 error | WHERE: requireTenantId | WHY: prevents null tenant queries that bypass RLS)", () => {
    const req = createMockRequest();
    const reply = createMockReply();
    const result = requireTenantId(req, reply);
    expect(result).toBeNull();
    expect(reply.statusCode).toBe(400);
    expect(reply.body.error).toContain('tenant_id is required');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// requireAuth
// ═══════════════════════════════════════════════════════════════════════

describe("requireAuth", () => {
  it("returns true when authenticated (WHO: admin route | WHAT: req.auth exists → true | WHERE: requireAuth | WHY: gates admin-only routes)", () => {
    const req = createMockRequest({ auth: { tenant_id: 'x', user_id: 'y', email: 'z' } });
    const reply = createMockReply();
    expect(requireAuth(req, reply)).toBe(true);
  });

  it("returns false and sends 401 when not authenticated (WHO: unauthenticated request | WHAT: req.auth missing → 401 | WHERE: requireAuth | WHY: prevents unauthorized access to admin routes)", () => {
    const req = createMockRequest();
    const reply = createMockReply();
    expect(requireAuth(req, reply)).toBe(false);
    expect(reply.statusCode).toBe(401);
    expect(reply.body.error).toBe('Authentication required');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// requireSuperAdmin
// ═══════════════════════════════════════════════════════════════════════

describe("requireSuperAdmin", () => {
  it("returns true for super-admin JWT", () => {
    // WHO: super-admin user (tenant_id === SUPER_ADMIN_TENANT_ID)
    // WHAT: gate passes, returns true
    // WHEN: any /tenants/* admin operation
    // WHERE: src/middleware.ts requireSuperAdmin
    // WHY: super-admins legitimately need cross-tenant ops (list every
    //      tenant, delete a churned customer's tenant, edit any tenant
    //      config); this is the green-light path
    const req = createMockRequest({
      auth: { tenant_id: SUPER_ADMIN_TENANT_ID, user_id: 'admin', email: 'admin@x', role: 'owner' },
    });
    const reply = createMockReply();
    expect(requireSuperAdmin(req, reply)).toBe(true);
    expect(reply.statusCode).toBe(200);
  });

  it("returns false and sends 401 when no auth context attached", () => {
    // WHO: unauthenticated request reaching an admin route
    // WHAT: req.auth missing → 401 + 'Authentication required'
    // WHEN: token expired, never logged in, manually-crafted request
    // WHERE: requireSuperAdmin gate
    // WHY: anonymous calls must never reach admin operations regardless
    //      of payload; the 401 (not 403) tells the client to re-auth
    const req = createMockRequest();
    const reply = createMockReply();
    expect(requireSuperAdmin(req, reply)).toBe(false);
    expect(reply.statusCode).toBe(401);
    expect(reply.body.error).toBe('Authentication required');
  });

  it("returns false and sends 403 when authenticated as a non-admin tenant", () => {
    // WHO: regular tenant owner (valid JWT, tenant_id !== super-admin)
    // WHAT: gate rejects with 403 + 'Forbidden: super-admin only'
    // WHEN: any tenant user attempting GET /tenants, DELETE /tenants/:id,
    //       POST /tenants/reorder, POST /templates/create, etc.
    // WHERE: requireSuperAdmin gate after the auth check
    // WHY: this is the load-bearing isolation boundary that the
    //      multi-tenant-isolation probe (Probe 5) found missing on
    //      2026-05-06 — without this gate every tenant's user could
    //      enumerate the entire customer list and DELETE another tenant.
    const req = createMockRequest({
      auth: { tenant_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', user_id: 'u', email: 'u@x', role: 'owner' },
    });
    const reply = createMockReply();
    expect(requireSuperAdmin(req, reply)).toBe(false);
    expect(reply.statusCode).toBe(403);
    expect(reply.body.error).toBe('Forbidden: super-admin only');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// tenantMiddleware
// ═══════════════════════════════════════════════════════════════════════

describe("tenantMiddleware", () => {
  type HookFn = (req: AppRequest, reply: FastifyReply) => Promise<void> | void;
  function setupMiddleware() {
    let hookFn: HookFn | undefined;
    const app = {
      addHook: vi.fn((_name: string, fn: HookFn) => { hookFn = fn; }),
    } as unknown as FastifyInstance;
    tenantMiddleware(app);
    if (!hookFn) throw new Error('tenantMiddleware did not register a preHandler hook');
    return hookFn;
  }

  // Real UUIDs (not synthetic strings) — the malformed-tenant_id gate
  // added 2026-05-13 rejects anything that doesn't match the UUID regex,
  // including the old 'from-query' / 'from-body' / 'tid-123' fixtures.
  // Switching every fixture to a valid v4 UUID makes the tests exercise
  // the actual production code path; the synthetic strings always were
  // a defect — real Postgres would have rejected them at any FK check.
  const FAKE_QUERY_TENANT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const FAKE_BODY_TENANT = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const FAKE_JWT_TENANT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

  it("extracts tenant_id from query params (WHO: dashboard API call | WHAT: query.tenant_id → req.tenantId | WHERE: tenantMiddleware preHandler | WHY: dashboard passes tenant_id as query param)", async () => {
    const hook = setupMiddleware();
    const req = createMockRequest({ query: { tenant_id: FAKE_QUERY_TENANT } });
    await hook(req, {});
    expect(req.tenantId).toBe(FAKE_QUERY_TENANT);
  });

  it("extracts tenant_id from body (WHO: POST route | WHAT: body.tenant_id → req.tenantId | WHERE: tenantMiddleware preHandler | WHY: some mutations send tenant_id in body)", async () => {
    const hook = setupMiddleware();
    const req = createMockRequest({ body: { tenant_id: FAKE_BODY_TENANT } });
    await hook(req, {});
    expect(req.tenantId).toBe(FAKE_BODY_TENANT);
  });

  it("extracts tenant_id from auth token (WHO: JWT-authenticated request | WHAT: auth.tenant_id → req.tenantId | WHERE: tenantMiddleware preHandler | WHY: fallback when not in query/body)", async () => {
    const hook = setupMiddleware();
    const req = createMockRequest({ auth: { tenant_id: FAKE_JWT_TENANT } });
    await hook(req, {});
    expect(req.tenantId).toBe(FAKE_JWT_TENANT);
  });

  it("skips exempt routes like /login (WHO: public endpoint | WHAT: /login skipped by middleware | WHERE: tenantMiddleware isTenantExempt | WHY: login happens before tenant context exists)", async () => {
    const hook = setupMiddleware();
    const req = createMockRequest({ url: '/login' });
    await hook(req, {});
    expect(req.tenantId).toBeUndefined();
  });

  it("skips exempt routes like /health (WHO: monitoring | WHAT: /health skipped | WHERE: tenantMiddleware isTenantExempt | WHY: health checks don't need tenant context)", async () => {
    const hook = setupMiddleware();
    const req = createMockRequest({ url: '/health' });
    await hook(req, {});
    expect(req.tenantId).toBeUndefined();
  });

  it("skips /tenants/* routes (WHO: admin | WHAT: /tenants/xyz skipped | WHERE: tenantMiddleware isTenantExempt | WHY: tenant management routes operate across tenants)", async () => {
    const hook = setupMiddleware();
    const req = createMockRequest({ url: '/tenants/abc-123' });
    await hook(req, {});
    expect(req.tenantId).toBeUndefined();
  });

  it("skips OPTIONS requests (WHO: CORS preflight | WHAT: OPTIONS method skipped | WHERE: tenantMiddleware preHandler | WHY: preflight requests don't carry auth headers)", async () => {
    const hook = setupMiddleware();
    const req = createMockRequest({ method: 'OPTIONS', url: '/customers' });
    await hook(req, {});
    expect(req.tenantId).toBeUndefined();
  });

  it("skips OAuth callback routes (WHO: external OAuth redirect | WHAT: /calendar/auth/google/callback skipped | WHERE: tenantMiddleware isTenantExempt | WHY: OAuth callbacks come from external providers without tenant context)", async () => {
    const hook = setupMiddleware();
    for (const path of [
      '/calendar/auth/google/callback',
      '/calendar/auth/outlook/callback',
      '/hubspot/auth/callback',
      '/jobber/auth/callback',
      '/square/auth/callback',
      '/servicetitan/auth/callback',
    ]) {
      const req = createMockRequest({ url: path });
      await hook(req, {});
      expect(req.tenantId).toBeUndefined();
    }
  });

  it("skips webhook routes (WHO: external CRM | WHAT: webhook paths skipped | WHERE: tenantMiddleware isTenantExempt | WHY: webhooks use HMAC auth, not JWT)", async () => {
    const hook = setupMiddleware();
    for (const path of ['/hubspot/webhook', '/square/webhook', '/servicetitan/webhook', '/billing/webhook']) {
      const req = createMockRequest({ url: path });
      await hook(req, {});
      expect(req.tenantId).toBeUndefined();
    }
  });

  it("skips Jobber webhook with tenant ID in path (WHO: Jobber webhook | WHAT: /jobber/webhook/xxx skipped | WHERE: tenantMiddleware isTenantExempt | WHY: Jobber uses tenant ID in URL path)", async () => {
    const hook = setupMiddleware();
    const req = createMockRequest({ url: '/jobber/webhook/abc-123' });
    await hook(req, {});
    expect(req.tenantId).toBeUndefined();
  });

  it("enriches logger with tenant context (WHO: tenant-scoped request | WHAT: req.log gets tenantId+userId child | WHERE: tenantMiddleware preHandler | WHY: structured logging for log aggregation)", async () => {
    const hook = setupMiddleware();
    const req = createMockRequest({
      query: { tenant_id: FAKE_QUERY_TENANT },
      auth: { user_id: 'uid-456' },
    });
    await hook(req, {});
    expect(req.log.child).toHaveBeenCalledWith({
      tenantId: FAKE_QUERY_TENANT,
      userId: 'uid-456',
    });
  });

  // ── Cross-tenant override gate (added 2026-05-06 after the
  //    multi-tenant-isolation probe found a cross-tenant data leak) ─────

  it("BLOCKS cross-tenant override via query: A token + ?tenant_id=B → 403", async () => {
    // WHO: tenant A user appending ?tenant_id=<B> to a request URL
    // WHAT: gate detects candidate (B) ≠ JWT (A) AND not super-admin → 403
    // WHEN: every authenticated request — load-bearing case for isolation
    // WHERE: tenantMiddleware preHandler, after candidate extraction
    // WHY: pre-fix, query-string tenant_id silently overrode the JWT,
    //      letting any authenticated user read another tenant's rows.
    //      This unit test pins the gate at the middleware layer; the
    //      integration probe in src/multi-tenant-isolation.test.ts pins
    //      the contract end-to-end through a real Fastify app + DB.
    const hook = setupMiddleware();
    const reply = createMockReply();
    const req = createMockRequest({
      query: { tenant_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
      auth: { tenant_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', user_id: 'u', email: 'u@x', role: 'owner' },
    });
    await hook(req, reply);
    expect(reply.statusCode).toBe(403);
    expect(reply.body.error).toContain('does not match authenticated session');
    expect(req.tenantId).toBeUndefined(); // request short-circuited before tenantId set
  });

  it("BLOCKS cross-tenant override via body: A token + body.tenant_id=B → 403", async () => {
    const hook = setupMiddleware();
    const reply = createMockReply();
    const req = createMockRequest({
      body: { tenant_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
      auth: { tenant_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', user_id: 'u', email: 'u@x', role: 'owner' },
    });
    await hook(req, reply);
    expect(reply.statusCode).toBe(403);
    expect(req.tenantId).toBeUndefined();
  });

  it("ALLOWS super-admin to override tenant_id via query (legitimate cross-tenant scoping)", async () => {
    // WHO: super-admin scoping a request to tenant A from the admin UI
    // WHAT: candidate (A) ≠ JWT (super-admin), but isSuperAdmin=true → pass
    // WHY: the dashboard's admin tooling depends on the override to scope
    //      cross-tenant queries; the gate must not break this path
    const hook = setupMiddleware();
    const reply = createMockReply();
    const req = createMockRequest({
      query: { tenant_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
      auth: { tenant_id: SUPER_ADMIN_TENANT_ID, user_id: 'admin', email: 'admin@x', role: 'owner' },
    });
    await hook(req, reply);
    expect(reply.statusCode).toBe(200);
    expect(req.tenantId).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  });

  it("ALLOWS noisy noop: A token + ?tenant_id=A passes (matches JWT)", async () => {
    // WHO: dashboard sending ?tenant_id=<self> on a tenant user's request
    // WHAT: candidate equals JWT tenant — no mismatch, gate doesn't fire
    // WHY: the dashboard does this on every page load; the gate must
    //      not turn legitimate same-tenant scoping into a 403
    const hook = setupMiddleware();
    const reply = createMockReply();
    const req = createMockRequest({
      query: { tenant_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
      auth: { tenant_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', user_id: 'u', email: 'u@x', role: 'owner' },
    });
    await hook(req, reply);
    expect(reply.statusCode).toBe(200);
    expect(req.tenantId).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  });

  it("BLOCKS query-vs-body tenant_id mismatch with 400", async () => {
    // WHO: a buggy or hostile client sending different tenant_ids in
    //      the query string and the body of the same request
    // WHAT: gate refuses to guess which one was intended → 400
    // WHY: even for super-admin, an ambiguous pair shouldn't silently
    //      pick one — fail noisily so the misuse is fixed at the source
    const hook = setupMiddleware();
    const reply = createMockReply();
    const req = createMockRequest({
      query: { tenant_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
      body: { tenant_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
      auth: { tenant_id: SUPER_ADMIN_TENANT_ID, user_id: 'admin', email: 'admin@x', role: 'owner' },
    });
    await hook(req, reply);
    expect(reply.statusCode).toBe(400);
    expect(reply.body.error).toContain('tenant_id mismatch');
  });

  it("permits anonymous requests with no JWT to fall through (downstream requireAuth handles)", async () => {
    // WHO: an unauthenticated request that hits a tenant-scoped route
    // WHAT: no JWT means no JWT-vs-candidate comparison; gate doesn't
    //       fire; the downstream requireAuth() / route guard takes over
    // WHY: the JWT auth hook may have skipped (no Bearer header). The
    //      tenant gate should not 403 anonymous traffic — instead let the
    //      route's own auth check produce the appropriate error
    const hook = setupMiddleware();
    const reply = createMockReply();
    const req = createMockRequest({ query: { tenant_id: FAKE_QUERY_TENANT } });
    await hook(req, reply);
    expect(reply.statusCode).toBe(200); // gate didn't fire
    expect(req.tenantId).toBe(FAKE_QUERY_TENANT);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Logging helpers
// ═══════════════════════════════════════════════════════════════════════

describe("logEvent", () => {
  it("logs business event with structured data (WHO: route handler | WHAT: structured event log | WHERE: logEvent | WHY: enables filtering in Datadog/CloudWatch)", () => {
    const req = createMockRequest();
    logEvent(req, 'appointment_booked', { appointmentId: '123' });
    expect(req.log.info).toHaveBeenCalledWith(
      { event: 'appointment_booked', appointmentId: '123' },
      'appointment_booked',
    );
  });
});

describe("logWarning", () => {
  it("logs warning with structured data (WHO: route handler | WHAT: structured warning log | WHERE: logWarning | WHY: distinguishes warnings from errors in log aggregation)", () => {
    const req = createMockRequest();
    logWarning(req, 'shift_overlap', { employeeId: 'emp1' });
    expect(req.log.warn).toHaveBeenCalledWith(
      { event: 'shift_overlap', employeeId: 'emp1' },
      'shift_overlap',
    );
  });
});

describe("logError", () => {
  it("logs Error object with structured fields (WHO: route handler | WHAT: error with stack+code+message | WHERE: logError | WHY: structured error data for incident investigation)", () => {
    const req = createMockRequest({ tenantId: 'tid-1', auth: { user_id: 'uid-1' } });
    const err = new Error('Connection timeout');
    logError(req, 'db_query_failed', err, { table: 'appointments' });

    expect(req.log.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'db_query_failed',
        error_message: 'Connection timeout',
        tenantId: 'tid-1',
        userId: 'uid-1',
        table: 'appointments',
      }),
      'db_query_failed: Connection timeout',
    );
  });

  it("handles non-Error values (WHO: catch block with unknown throw | WHAT: string/number coerced to Error | WHERE: logError | WHY: catch(err: unknown) may receive non-Error values)", () => {
    const req = createMockRequest();
    logError(req, 'weird_throw', 'string error');

    expect(req.log.error).toHaveBeenCalledWith(
      expect.objectContaining({
        error_message: 'string error',
      }),
      'weird_throw: string error',
    );
  });

  it("includes error code if present (WHO: Postgres error | WHAT: error.code captured | WHERE: logError | WHY: Postgres errors carry code like '23505' for unique violation)", () => {
    const req = createMockRequest();
    const err = new Error('duplicate key') as Error & { code?: string };
    err.code = '23505';
    logError(req, 'insert_failed', err);

    expect(req.log.error).toHaveBeenCalledWith(
      expect.objectContaining({ error_code: '23505' }),
      expect.any(String),
    );
  });

  it("truncates stack to 5 lines (WHO: any error | WHAT: error_stack limited to 5 lines | WHERE: logError | WHY: full stacks bloat structured logs, 5 lines gives enough context)", () => {
    const req = createMockRequest();
    const err = new Error('deep stack');
    logError(req, 'stack_test', err);

    const call = req.log.error.mock.calls[0][0];
    const stackLines = call.error_stack.split('\n');
    expect(stackLines.length).toBeLessThanOrEqual(5);
  });
});
