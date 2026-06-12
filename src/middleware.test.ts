/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method, @typescript-eslint/no-explicit-any */
/**
 * ESLint rules disabled for this file as part of full cleanup (REFACTORING_TODO.md item 10).
 * These are the remaining dynamic/any-heavy areas after previous tranches.
 */

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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyReply, FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
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
} from './middleware';
import { errorsTotal } from './services/metrics';

/** Read the current errors_total value for a given event label (0 if unseen). */
function errorsTotalFor(event: string): number {
  return errorsTotal.snapshot().find((s) => s.labels.event === event)?.value ?? 0;
}

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

function createMockRequest(
  overrides: Partial<AppRequest> & Record<string, unknown> = {}
): AppRequest {
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

describe('AppError', () => {
  it('constructs with message, code, and statusCode (WHO: any service/route | WHAT: structured error creation | WHERE: AppError constructor | WHY: consistent error shape across all routes)', () => {
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

describe('withHandler — happy paths', () => {
  it('passes through successful handler result (WHO: any route | WHAT: handler runs without error → result returned | WHERE: withHandler wrapper | WHY: decorator should be transparent on success)', async () => {
    const handler = vi.fn(async (_req: AppRequest, reply: FastifyReply) =>
      reply.send({ success: true })
    );
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

describe('withHandler — sad paths', () => {
  it('returns AppError status and message (WHO: route handler | WHAT: AppError thrown → status+message from error | WHERE: withHandler catch | WHY: AppErrors carry their own status, not always 500)', async () => {
    const handler = vi.fn(async () => {
      throw new AppError('Forbidden', 'FORBIDDEN', 403);
    });
    const wrapped = withHandler(handler, 'Operation failed');

    const req = createMockRequest();
    const reply = createMockReply();
    await wrapped(req, reply);

    expect(reply.statusCode).toBe(403);
    expect(reply.body).toEqual({ success: false, error: 'Forbidden', code: 'FORBIDDEN' });
  });

  it('re-throws TENANT_NOT_FOUND for global handler (WHO: route handler | WHAT: TENANT_NOT_FOUND error propagated | WHERE: withHandler catch | WHY: global handler must catch this for auto-logout on deleted tenant)', async () => {
    const err = new Error('Tenant gone') as Error & { code?: string };
    err.code = 'TENANT_NOT_FOUND';
    const handler = vi.fn(async () => {
      throw err;
    });
    const wrapped = withHandler(handler, 'Fetch failed');

    const req = createMockRequest();
    const reply = createMockReply();

    await expect(wrapped(req, reply)).rejects.toThrow('Tenant gone');
  });

  it("uses statusCode from error if present (WHO: validation layer | WHAT: error.statusCode used as HTTP status | WHERE: withHandler catch | WHY: validation errors carry statusCode but aren't AppErrors)", async () => {
    const err = new Error('Bad input') as Error & { statusCode?: number };
    err.statusCode = 422;
    const handler = vi.fn(async () => {
      throw err;
    });
    const wrapped = withHandler(handler, 'Validation failed');

    const req = createMockRequest();
    const reply = createMockReply();
    await wrapped(req, reply);

    expect(reply.statusCode).toBe(422);
    expect(reply.body).toEqual({ success: false, error: 'Bad input' });
  });

  it('returns 500 with generic message for unknown errors (WHO: any route | WHAT: unexpected Error → 500 with contextual message | WHERE: withHandler catch | WHY: never leak internal details to client)', async () => {
    const handler = vi.fn(async () => {
      throw new Error('DB crashed');
    });
    const wrapped = withHandler(handler, 'Could not fetch data');

    const req = createMockRequest({ tenantId: 'tenant-123' });
    const reply = createMockReply();
    await wrapped(req, reply);

    expect(reply.statusCode).toBe(500);
    expect(reply.body).toEqual({ success: false, error: 'Could not fetch data' });
    // 2026-05-21: unknown errors now route through logError (not a raw
    // req.log.error), which stamps the structured shape AND increments
    // errors_total. The route-specific message rides along as `context`.
    expect(req.log.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'unhandled_route_error',
        error_message: 'DB crashed',
        route: '/test',
        method: 'GET',
        tenantId: 'tenant-123',
        context: 'Could not fetch data',
      }),
      expect.stringContaining('unhandled_route_error')
    );
  });

  it('increments errors_total{event="unhandled_route_error"} on an unhandled error (WHO: ops/alerting | WHAT: counter ticks so rate(errors_total) alerts fire | WHEN: any unhandled route error incl. pool-checkout timeout under load | WHERE: withHandler catch → logError | WHY: 2026-05-21 — pre-fix the raw req.log.error did NOT increment the counter, so pool exhaustion was invisible to alerting exactly when it mattered)', async () => {
    const before = errorsTotalFor('unhandled_route_error');

    // Simulates the connectionTimeoutMillis rejection shape — the "many
    // callers" saturation error we hardened the pool against.
    const wrapped = withHandler(async () => {
      throw new Error('Connection terminated due to connection timeout');
    }, 'Could not fetch data');
    await wrapped(createMockRequest(), createMockReply());

    expect(errorsTotalFor('unhandled_route_error')).toBe(before + 1);
  });

  it('maps a Postgres class-22 data error (22P02) to 400 and does NOT increment errors_total', async () => {
    // WHO: a client sending a malformed value — e.g. GET /records/.../not-a-uuid/...
    // WHAT: Postgres throws 22P02; withHandler must return 400 (bad request),
    //       not 500, and must NOT tick errors_total
    // WHEN: 2026-05-21 — confirmed live that bad-UUID :id params returned 500;
    //       worse, the logError change made them pollute rate(errors_total)
    // WHERE: withHandler PG_CLIENT_DATA_SQLSTATES branch
    // WHY: a bad input is a client error, not a server incident — misreporting
    //      it as 500 wrongs the status AND fires false 5xx/error-rate alerts
    const before = errorsTotalFor('unhandled_route_error');
    const pgErr = new Error('invalid input syntax for type uuid: "not-a-uuid"') as Error & {
      code?: string;
    };
    pgErr.code = '22P02';
    const wrapped = withHandler(async () => {
      throw pgErr;
    }, 'Failed to get record history');
    const req = createMockRequest();
    const reply = createMockReply();

    await wrapped(req, reply);

    expect(reply.statusCode).toBe(400);
    expect(reply.body).toEqual({ success: false, error: 'Invalid request parameter' });
    // Client error → counter MUST stay flat (no alert pollution).
    expect(errorsTotalFor('unhandled_route_error')).toBe(before);
    // Logged at warn for visibility, not error.
    expect(req.log.warn).toHaveBeenCalled();
  });

  it('does NOT map a non-class-22 pg error (e.g. 23505) to 400 — still 500 + errors_total', async () => {
    // WHY: guard against over-broadening. A unique-violation / constraint /
    //      connection error is NOT client-malformed-input; it must remain a
    //      500 that fires alerting. Only the data-exception class is a 400.
    const before = errorsTotalFor('unhandled_route_error');
    const pgErr = new Error('duplicate key value violates unique constraint') as Error & {
      code?: string;
    };
    pgErr.code = '23505';
    const wrapped = withHandler(async () => {
      throw pgErr;
    }, 'Could not save');
    const reply = createMockReply();

    await wrapped(createMockRequest(), reply);

    expect(reply.statusCode).toBe(500);
    expect(errorsTotalFor('unhandled_route_error')).toBe(before + 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// withPoolClient
// ═══════════════════════════════════════════════════════════════════════

describe('withPoolClient', () => {
  it('returns fn result and releases client (WHO: any DB operation | WHAT: pool.connect → fn → client.release | WHERE: withPoolClient | WHY: eliminates try/finally boilerplate in every route)', async () => {
    const client = { query: vi.fn(), release: vi.fn() };
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;

    const result = await withPoolClient(pool, async (c) => {
      await c.query('SELECT 1');
      return 'done';
    });

    expect(result).toBe('done');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('releases client even when fn throws (WHO: any DB operation | WHAT: fn throws → client still released | WHERE: withPoolClient finally | WHY: prevents pool exhaustion on errors)', async () => {
    const client = { query: vi.fn(), release: vi.fn() };
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;

    await expect(
      withPoolClient(pool, async () => {
        throw new Error('Query failed');
      })
    ).rejects.toThrow('Query failed');

    expect(client.release).toHaveBeenCalledOnce();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// requireTenantId
// ═══════════════════════════════════════════════════════════════════════

describe('requireTenantId', () => {
  it('returns tenantId from request (WHO: tenant-scoped route | WHAT: req.tenantId extracted | WHERE: requireTenantId | WHY: all tenant-scoped queries need this value)', () => {
    const req = createMockRequest({ tenantId: 'tid-123' });
    const reply = createMockReply();
    const result = requireTenantId(req, reply);
    expect(result).toBe('tid-123');
  });

  it('does NOT fall back to body.tenant_id (WHO: attacker/admin | WHAT: body tenant_id must be ignored | WHERE: requireTenantId | WHY: 2026-05-21 — reading body directly bypasses tenantMiddleware JWT validation, the anonymous-tenant hole vector)', () => {
    // auth present → isolates the "body ignored" behavior from the 401 branch.
    const req = createMockRequest({
      auth: { tenant_id: 'x', user_id: 'u', email: 'e' },
      body: { tenant_id: 'body-tid' },
    });
    const reply = createMockReply();
    const result = requireTenantId(req, reply);
    expect(result).toBeNull();
    expect(reply.statusCode).toBe(400);
  });

  it('returns null and sends 401 when missing AND unauthenticated (WHO: anonymous caller | WHAT: no auth, no tenant → 401 | WHERE: requireTenantId | WHY: 2026-05-21 — the real failure is authentication, not a missing field)', () => {
    const req = createMockRequest();
    const reply = createMockReply();
    const result = requireTenantId(req, reply);
    expect(result).toBeNull();
    expect(reply.statusCode).toBe(401);
    expect(reply.body.error).toContain('Authentication required');
  });

  it('returns null and sends 400 when authed but no tenant (WHO: authed misconfigured client | WHAT: genuine bad request | WHERE: requireTenantId | WHY: distinct from the unauthenticated 401)', () => {
    const req = createMockRequest({ auth: { tenant_id: 'x', user_id: 'u', email: 'e' } });
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

describe('requireAuth', () => {
  it('returns true when authenticated (WHO: admin route | WHAT: req.auth exists → true | WHERE: requireAuth | WHY: gates admin-only routes)', () => {
    const req = createMockRequest({ auth: { tenant_id: 'x', user_id: 'y', email: 'z' } });
    const reply = createMockReply();
    expect(requireAuth(req, reply)).toBe(true);
  });

  it('returns false and sends 401 when not authenticated (WHO: unauthenticated request | WHAT: req.auth missing → 401 | WHERE: requireAuth | WHY: prevents unauthorized access to admin routes)', () => {
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

describe('requireSuperAdmin', () => {
  it('returns true for super-admin JWT', () => {
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

  it('returns false and sends 401 when no auth context attached', () => {
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

  it('returns false and sends 403 when authenticated as a non-admin tenant', () => {
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
      auth: {
        tenant_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        user_id: 'u',
        email: 'u@x',
        role: 'owner',
      },
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

describe('tenantMiddleware', () => {
  type HookFn = (req: AppRequest, reply: FastifyReply) => Promise<void> | void;
  function setupMiddleware() {
    let hookFn: HookFn | undefined;
    const app = {
      addHook: vi.fn((_name: string, fn: HookFn) => {
        hookFn = fn;
      }),
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

  it('extracts tenant_id from query params (WHO: dashboard API call | WHAT: query.tenant_id → req.tenantId | WHERE: tenantMiddleware preHandler | WHY: dashboard passes tenant_id as query param)', async () => {
    // Super-admin auth so the distinct query tenant is a legal override (a
    // non-admin would 403 on query≠jwt) AND the 2026-05-21 auth gate passes.
    const hook = setupMiddleware();
    const req = createMockRequest({
      auth: { tenant_id: SUPER_ADMIN_TENANT_ID, user_id: 'u', email: 'e' },
      query: { tenant_id: FAKE_QUERY_TENANT },
    });
    await hook(req, createMockReply());
    expect(req.tenantId).toBe(FAKE_QUERY_TENANT);
  });

  it('extracts tenant_id from body (WHO: POST route | WHAT: body.tenant_id → req.tenantId | WHERE: tenantMiddleware preHandler | WHY: some mutations send tenant_id in body)', async () => {
    const hook = setupMiddleware();
    const req = createMockRequest({
      auth: { tenant_id: SUPER_ADMIN_TENANT_ID, user_id: 'u', email: 'e' },
      body: { tenant_id: FAKE_BODY_TENANT },
    });
    await hook(req, createMockReply());
    expect(req.tenantId).toBe(FAKE_BODY_TENANT);
  });

  it('extracts tenant_id from auth token (WHO: JWT-authenticated request | WHAT: auth.tenant_id → req.tenantId | WHERE: tenantMiddleware preHandler | WHY: fallback when not in query/body)', async () => {
    const hook = setupMiddleware();
    const req = createMockRequest({ auth: { tenant_id: FAKE_JWT_TENANT } });
    await hook(req, {});
    expect(req.tenantId).toBe(FAKE_JWT_TENANT);
  });

  it('skips exempt routes like /login (WHO: public endpoint | WHAT: /login skipped by middleware | WHERE: tenantMiddleware isTenantExempt | WHY: login happens before tenant context exists)', async () => {
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

  it('skips /tenants/* routes (WHO: admin | WHAT: /tenants/xyz skipped | WHERE: tenantMiddleware isTenantExempt | WHY: tenant management routes operate across tenants)', async () => {
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

  it('skips OAuth callback routes (WHO: external OAuth redirect | WHAT: /calendar/auth/google/callback skipped | WHERE: tenantMiddleware isTenantExempt | WHY: OAuth callbacks come from external providers without tenant context)', async () => {
    const hook = setupMiddleware();
    for (const path of [
      '/calendar/auth/google/callback',
      '/calendar/auth/outlook/callback',
      '/square/auth/callback',
    ]) {
      const req = createMockRequest({ url: path });
      await hook(req, {});
      expect(req.tenantId).toBeUndefined();
    }
  });

  it('skips webhook routes (WHO: external CRM | WHAT: webhook paths skipped | WHERE: tenantMiddleware isTenantExempt | WHY: webhooks use HMAC auth, not JWT)', async () => {
    const hook = setupMiddleware();
    for (const path of ['/square/webhook', '/billing/webhook']) {
      const req = createMockRequest({ url: path });
      await hook(req, {});
      expect(req.tenantId).toBeUndefined();
    }
  });

  it('enriches logger with tenant context (WHO: tenant-scoped request | WHAT: req.log gets tenantId+userId child | WHERE: tenantMiddleware preHandler | WHY: structured logging for log aggregation)', async () => {
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

  it('BLOCKS cross-tenant override via query: A token + ?tenant_id=B → 403', async () => {
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
      auth: {
        tenant_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        user_id: 'u',
        email: 'u@x',
        role: 'owner',
      },
    });
    await hook(req, reply);
    expect(reply.statusCode).toBe(403);
    expect(reply.body.error).toContain('does not match authenticated session');
    expect(req.tenantId).toBeUndefined(); // request short-circuited before tenantId set
  });

  it('BLOCKS cross-tenant override via body: A token + body.tenant_id=B → 403', async () => {
    const hook = setupMiddleware();
    const reply = createMockReply();
    const req = createMockRequest({
      body: { tenant_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
      auth: {
        tenant_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        user_id: 'u',
        email: 'u@x',
        role: 'owner',
      },
    });
    await hook(req, reply);
    expect(reply.statusCode).toBe(403);
    expect(req.tenantId).toBeUndefined();
  });

  it('ALLOWS super-admin to override tenant_id via query (legitimate cross-tenant scoping)', async () => {
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

  it('ALLOWS noisy noop: A token + ?tenant_id=A passes (matches JWT)', async () => {
    // WHO: dashboard sending ?tenant_id=<self> on a tenant user's request
    // WHAT: candidate equals JWT tenant — no mismatch, gate doesn't fire
    // WHY: the dashboard does this on every page load; the gate must
    //      not turn legitimate same-tenant scoping into a 403
    const hook = setupMiddleware();
    const reply = createMockReply();
    const req = createMockRequest({
      query: { tenant_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
      auth: {
        tenant_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        user_id: 'u',
        email: 'u@x',
        role: 'owner',
      },
    });
    await hook(req, reply);
    expect(reply.statusCode).toBe(200);
    expect(req.tenantId).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  });

  it('BLOCKS query-vs-body tenant_id mismatch with 400', async () => {
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

  it('REJECTS anonymous requests with no JWT on tenant-scoped routes (401)', async () => {
    // WHO: an unauthenticated request that hits a tenant-scoped route
    // WHAT: supplies ?tenant_id=<uuid> with NO Authorization header
    // WHEN: 2026-05-21 — found that the old behavior let this fall through:
    //       candidate||jwtTenant resolved the attacker-supplied tenant, the
    //       route returned its data (read/write/delete) with zero auth.
    // WHERE: src/middleware.ts tenantMiddleware auth gate
    // WHY: a user-supplied tenant_id is a selector within the session's
    //      permitted tenants, never a substitute for authentication. With no
    //      JWT there is nothing to validate it against — fail closed (401)
    //      before any tenant resolution can trust it. The route must NEVER
    //      see req.tenantId set from an unauthenticated request.
    const hook = setupMiddleware();
    const reply = createMockReply();
    const req = createMockRequest({ query: { tenant_id: FAKE_QUERY_TENANT } });
    await hook(req, reply);
    expect(reply.statusCode).toBe(401);
    expect(req.tenantId).toBeUndefined();
  });

  // Regression guard for the PUBLIC_ROUTES vs TENANT_EXEMPT_ROUTES divergence
  // that made the 2026-05-21 hole subtle: the two lists are NOT identical, and
  // a route can legitimately be in one but not the other. A future contributor
  // who adds a public route to only one list could re-open unauthenticated
  // access. These cases pin the intended divergence behaviorally so such a
  // change trips a test instead of shipping silently.
  it('public-but-NOT-tenant-exempt routes (e.g. /forgot-password) pass the auth gate without a JWT', async () => {
    // WHY: /forgot-password, /reset-password, /demo, /metrics are JWT-public
    //      but intentionally NOT tenant-exempt — they flow through
    //      tenantMiddleware and must not be 401'd by the auth gate. Removing
    //      one from PUBLIC_ROUTES would 401 it (broken password reset).
    const hook = setupMiddleware();
    const reply = createMockReply();
    const req = createMockRequest({ url: '/forgot-password', method: 'POST' });
    await hook(req, reply);
    expect(reply.statusCode).toBe(200); // gate did not fire
    expect(req.tenantId).toBeUndefined(); // no tenant resolved, none needed
  });

  it('tenant-exempt routes (e.g. /agent-tools/*) short-circuit before the auth gate', async () => {
    // WHY: /agent-tools/* authenticates via x-agent-secret, not JWT, and is
    //      tenant-exempt — it must return BEFORE the auth gate so the
    //      secret-authed LiveKit agent isn't 401'd. Pin that exempt wins.
    const hook = setupMiddleware();
    const reply = createMockReply();
    const req = createMockRequest({ url: '/agent-tools/book-appointment', method: 'POST' });
    await hook(req, reply);
    expect(reply.statusCode).toBe(200); // exempt → returned early, no 401
    expect(req.tenantId).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Logging helpers
// ═══════════════════════════════════════════════════════════════════════

describe('logEvent', () => {
  it('logs business event with structured data (WHO: route handler | WHAT: structured event log | WHERE: logEvent | WHY: enables filtering in Datadog/CloudWatch)', () => {
    const req = createMockRequest();
    logEvent(req, 'appointment_booked', { appointmentId: '123' });
    expect(req.log.info).toHaveBeenCalledWith(
      { event: 'appointment_booked', appointmentId: '123' },
      'appointment_booked'
    );
  });
});

describe('logWarning', () => {
  it('logs warning with structured data (WHO: route handler | WHAT: structured warning log | WHERE: logWarning | WHY: distinguishes warnings from errors in log aggregation)', () => {
    const req = createMockRequest();
    logWarning(req, 'shift_overlap', { employeeId: 'emp1' });
    expect(req.log.warn).toHaveBeenCalledWith(
      { event: 'shift_overlap', employeeId: 'emp1' },
      'shift_overlap'
    );
  });
});

describe('logError', () => {
  it('logs Error object with structured fields (WHO: route handler | WHAT: error with stack+code+message | WHERE: logError | WHY: structured error data for incident investigation)', () => {
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
      'db_query_failed: Connection timeout'
    );
  });

  it('handles non-Error values (WHO: catch block with unknown throw | WHAT: string/number coerced to Error | WHERE: logError | WHY: catch(err: unknown) may receive non-Error values)', () => {
    const req = createMockRequest();
    logError(req, 'weird_throw', 'string error');

    expect(req.log.error).toHaveBeenCalledWith(
      expect.objectContaining({
        error_message: 'string error',
      }),
      'weird_throw: string error'
    );
  });

  it("includes error code if present (WHO: Postgres error | WHAT: error.code captured | WHERE: logError | WHY: Postgres errors carry code like '23505' for unique violation)", () => {
    const req = createMockRequest();
    const err = new Error('duplicate key') as Error & { code?: string };
    err.code = '23505';
    logError(req, 'insert_failed', err);

    expect(req.log.error).toHaveBeenCalledWith(
      expect.objectContaining({ error_code: '23505' }),
      expect.any(String)
    );
  });

  it('truncates stack to 5 lines (WHO: any error | WHAT: error_stack limited to 5 lines | WHERE: logError | WHY: full stacks bloat structured logs, 5 lines gives enough context)', () => {
    const req = createMockRequest();
    const err = new Error('deep stack');
    logError(req, 'stack_test', err);

    const call = req.log.error.mock.calls[0][0];
    const stackLines = call.error_stack.split('\n');
    expect(stackLines.length).toBeLessThanOrEqual(5);
  });
});
