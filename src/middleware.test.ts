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
import {
  withHandler,
  withPoolClient,
  requireTenantId,
  requireAuth,
  tenantMiddleware,
  logEvent,
  logWarning,
  logError,
  AppError,
} from "./middleware";

// ── Mock helpers ────────────────────────────────────────────────────────

function createMockReply() {
  const reply: any = {
    statusCode: 200,
    body: null,
    status(code: number) {
      reply.statusCode = code;
      return reply;
    },
    send(data: any) {
      reply.body = data;
      return reply;
    },
  };
  return reply;
}

function createMockRequest(overrides: Record<string, any> = {}) {
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
  } as any;
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
    const handler = vi.fn(async (_req: any, reply: any) => reply.send({ success: true }));
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
    const err: any = new Error('Tenant gone');
    err.code = 'TENANT_NOT_FOUND';
    const handler = vi.fn(async () => { throw err; });
    const wrapped = withHandler(handler, 'Fetch failed');

    const req = createMockRequest();
    const reply = createMockReply();

    await expect(wrapped(req, reply)).rejects.toThrow('Tenant gone');
  });

  it("uses statusCode from error if present (WHO: validation layer | WHAT: error.statusCode used as HTTP status | WHERE: withHandler catch | WHY: validation errors carry statusCode but aren't AppErrors)", async () => {
    const err: any = new Error('Bad input');
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
    const pool = { connect: vi.fn().mockResolvedValue(client) } as any;

    const result = await withPoolClient(pool, async (c) => {
      await c.query('SELECT 1');
      return 'done';
    });

    expect(result).toBe('done');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("releases client even when fn throws (WHO: any DB operation | WHAT: fn throws → client still released | WHERE: withPoolClient finally | WHY: prevents pool exhaustion on errors)", async () => {
    const client = { query: vi.fn(), release: vi.fn() };
    const pool = { connect: vi.fn().mockResolvedValue(client) } as any;

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
// tenantMiddleware
// ═══════════════════════════════════════════════════════════════════════

describe("tenantMiddleware", () => {
  function setupMiddleware() {
    let hookFn: any;
    const app = {
      addHook: vi.fn((_name: string, fn: any) => { hookFn = fn; }),
    } as any;
    tenantMiddleware(app);
    return hookFn;
  }

  it("extracts tenant_id from query params (WHO: dashboard API call | WHAT: query.tenant_id → req.tenantId | WHERE: tenantMiddleware preHandler | WHY: dashboard passes tenant_id as query param)", async () => {
    const hook = setupMiddleware();
    const req = createMockRequest({ query: { tenant_id: 'from-query' } });
    await hook(req, {});
    expect(req.tenantId).toBe('from-query');
  });

  it("extracts tenant_id from body (WHO: POST route | WHAT: body.tenant_id → req.tenantId | WHERE: tenantMiddleware preHandler | WHY: some mutations send tenant_id in body)", async () => {
    const hook = setupMiddleware();
    const req = createMockRequest({ body: { tenant_id: 'from-body' } });
    await hook(req, {});
    expect(req.tenantId).toBe('from-body');
  });

  it("extracts tenant_id from auth token (WHO: JWT-authenticated request | WHAT: auth.tenant_id → req.tenantId | WHERE: tenantMiddleware preHandler | WHY: fallback when not in query/body)", async () => {
    const hook = setupMiddleware();
    const req = createMockRequest({ auth: { tenant_id: 'from-jwt' } });
    await hook(req, {});
    expect(req.tenantId).toBe('from-jwt');
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
      query: { tenant_id: 'tid-123' },
      auth: { user_id: 'uid-456' },
    });
    await hook(req, {});
    expect(req.log.child).toHaveBeenCalledWith({
      tenantId: 'tid-123',
      userId: 'uid-456',
    });
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
    const err: any = new Error('duplicate key');
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
