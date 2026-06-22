/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method, @typescript-eslint/no-explicit-any */
/**
 * ESLint rules disabled for this file as part of full cleanup (REFACTORING_TODO.md item 10).
 * These are the remaining dynamic/any-heavy areas after previous tranches.
 */

/**
 * Shared middleware, error handling, and logging patterns.
 *
 * Design Patterns Used:
 * - Decorator: withHandler wraps route handlers with consistent error handling
 * - Chain of Responsibility: tenant middleware runs before every route
 * - Strategy: error handler dispatches based on error type
 * - Facade: request context (req.tenantId, req.log) hides extraction complexity
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AppFastifyInstance } from './types/fastify';
import { errorsTotal } from './services/metrics';
import { captureException } from './services/sentry';

// ── Types ────────────────────────────────────────────────────────────

/** Roles a tenant user can hold. Super-admins are identified by tenant_id, not by this column. */
export type UserRole = 'owner' | 'front_desk';

/** Extended request with tenant context and structured logger */
export interface AppRequest extends FastifyRequest {
  tenantId?: string;
  auth?: { tenant_id: string; user_id: string; email: string; role: UserRole; iat?: number };
}

/** Known error codes the system can produce */
export type AppErrorCode = 'TENANT_NOT_FOUND' | 'VALIDATION' | 'NOT_FOUND' | 'FORBIDDEN';

/** Structured application error with code and status */
export class AppError extends Error {
  statusCode: number;
  code: AppErrorCode;

  constructor(message: string, code: AppErrorCode, statusCode: number) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

// ── Route Handler Wrapper (Decorator Pattern) ────────────────────────

type RouteHandler = (req: AppRequest, reply: FastifyReply) => Promise<unknown>;

/**
 * Wraps a route handler with:
 * - Structured error handling (no more try/catch in every route)
 * - Automatic TENANT_NOT_FOUND propagation to global handler
 * - Contextual logging (tenant + user + route)
 * - Consistent 500 error response format
 *
 * Usage:
 *   app.get('/customers', withHandler(async (req, reply) => {
 *     const data = await fetchCustomers(req.tenantId);
 *     return reply.send(data);
 *   }, 'Failed to fetch customers'));
 */
// Postgres SQLSTATE class-22 "data exception" codes that mean the CLIENT
// supplied a malformed value (→ 400), not a server fault (→ 500):
//   22P02 invalid_text_representation (bad uuid / enum / int text — the
//         common case: a non-UUID path param)
//   22003 numeric_value_out_of_range
//   22007 invalid_datetime_format
//   22008 datetime_field_overflow
const PG_CLIENT_DATA_SQLSTATES = new Set(['22P02', '22003', '22007', '22008']);

export function withHandler(handler: RouteHandler, errorMessage: string): RouteHandler {
  return async (req: AppRequest, reply: FastifyReply) => {
    try {
      return await handler(req, reply);
    } catch (err: unknown) {
      // TENANT_NOT_FOUND: propagate to global handler for 404 + auto-logout
      if (
        err instanceof Error &&
        (err as unknown as { code?: string }).code === 'TENANT_NOT_FOUND'
      ) {
        throw err;
      }

      // AppError: use its status code
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({
          success: false,
          error: err.message,
          code: err.code,
        });
      }

      // Known status code on error object (e.g., validation errors)
      if (err instanceof Error && (err as unknown as { statusCode?: number }).statusCode) {
        const status = (err as unknown as { statusCode: number }).statusCode;
        return reply.status(status).send({ success: false, error: err.message });
      }

      // Postgres data-exception (SQLSTATE class 22): the CLIENT sent a
      // malformed value — e.g. a non-UUID `:id` param hits a uuid column and
      // Postgres throws 22P02. That is a 400 (bad request), not a 500, and it
      // must NOT increment errors_total — otherwise client garbage (scanners,
      // buggy callers) pollutes the 5xx / rate(errors_total) alerting that
      // real incidents depend on. Logged at warn for visibility without the
      // error counter. Message is generic so no pg internals leak. (2026-05-21)
      const pgCode = (err as { code?: string }).code;
      if (typeof pgCode === 'string' && PG_CLIENT_DATA_SQLSTATES.has(pgCode)) {
        logWarning(req, 'invalid_request_parameter', {
          pg_code: pgCode,
          route: req.url,
          method: req.method,
        });
        return reply.status(400).send({ success: false, error: 'Invalid request parameter' });
      }

      // Unknown error: log and return 500. Route through logError (not a
      // raw req.log.error) so it increments errors_total{event=...} and
      // hits Sentry — otherwise unhandled route errors, including pool-
      // checkout timeouts under load, are invisible to rate(errors_total)
      // alerting, which is exactly when we need them. (2026-05-21)
      logError(req, 'unhandled_route_error', err, { context: errorMessage });

      return reply.status(500).send({ success: false, error: errorMessage });
    }
  };
}

// ── Pool Client Helper ───────────────────────────────────────────────

import type { Pool, PoolClient } from 'pg';

/**
 * Wraps a pool.connect() / release() lifecycle.
 * Eliminates the repeated try/finally/release pattern in route handlers.
 *
 * Usage:
 *   const result = await withPoolClient(pool, async (client) => {
 *     return client.query('SELECT * FROM tenants');
 *   });
 */
export async function withPoolClient<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

// ── Tenant Validation Helper ─────────────────────────────────────────

/**
 * Extracts and validates tenant_id from request. Returns the tenant_id
 * or sends a 400 response and returns null.
 *
 * Usage:
 *   const tenantId = requireTenantId(req, reply);
 *   if (!tenantId) return;
 */
export function requireTenantId(req: AppRequest, reply: FastifyReply): string | null {
  // Only trust req.tenantId — it is set by tenantMiddleware, which validates a
  // user-supplied tenant_id against the JWT (matches or super-admin). Reading
  // req.body.tenant_id directly here would bypass that validation, the same
  // class of bug as the 2026-05-21 anonymous-tenant hole (see tenantMiddleware).
  const tenantId = req.tenantId;
  if (!tenantId) {
    // No authenticated session → the real failure is authentication, not a
    // missing field; say so (401) instead of the misleading 400.
    if (!req.auth) {
      void reply.status(401).send({ success: false, error: 'Authentication required' });
    } else {
      void reply.status(400).send({ success: false, error: 'tenant_id is required' });
    }
    return null;
  }
  return tenantId;
}

/**
 * Guards admin-only routes: returns true if the user is authenticated,
 * or sends a 401 and returns false.
 */
export function requireAuth(req: AppRequest, reply: FastifyReply): boolean {
  if (!req.auth) {
    void reply.status(401).send({ success: false, error: 'Authentication required' });
    return false;
  }
  return true;
}

/**
 * Guards super-admin-only routes: returns true if the caller is the
 * super-admin tenant, sends 401 (no auth) or 403 (auth but not admin)
 * and returns false otherwise.
 *
 * Super-admin is identified by the JWT tenant_id matching the well-known
 * super-admin UUID. Added 2026-05-06 after the multi-tenant-isolation
 * probe found that /tenants/* routes were reachable by any authenticated
 * user — letting a regular tenant user list every customer in the system
 * or DELETE another tenant entirely. requireAuth() alone is not enough
 * for these routes.
 */
export function requireSuperAdmin(req: AppRequest, reply: FastifyReply): boolean {
  if (!req.auth) {
    void reply.status(401).send({ success: false, error: 'Authentication required' });
    return false;
  }
  if (req.auth.tenant_id !== '00000000-0000-0000-0000-000000000000') {
    void reply.status(403).send({ success: false, error: 'Forbidden: super-admin only' });
    return false;
  }
  return true;
}

// ── Tenant ID Middleware (Chain of Responsibility) ────────────────────

/** Routes that don't require a tenant_id */
const TENANT_EXEMPT_ROUTES = [
  '/health',
  '/ready',
  '/login',
  '/register',
  '/',
  '/demo/start',
  '/billing/webhook',
  // OAuth callbacks (redirects from external providers)
  '/calendar/auth/google/callback',
  '/calendar/auth/outlook/callback',
  '/square/auth/callback',
  // CRM webhooks (authenticated via HMAC/signature, not JWT)
  '/square/webhook',
  // SMS delivery-status callbacks (verified via provider signature, not JWT;
  // tenant_id rides on the query string, not the body)
  '/communications/telnyx/status',
  '/tenants',
  '/templates',
  '/templates/full',
  '/templates/create',
];

function isTenantExempt(url: string): boolean {
  const path = url.split('?')[0];
  return (
    TENANT_EXEMPT_ROUTES.some((r) => path === r || path.startsWith('/tenants/')) ||
    path.startsWith('/agent-tools/')
  ); // LiveKit agent tool calls; tenant_id supplied in body
}

/**
 * Extracts tenant_id from query params, request body, or JWT auth context.
 * Attaches as req.tenantId for consistent access in route handlers.
 * Creates a child logger with tenant context for structured logging.
 *
 * Priority: query param > body > JWT auth token.
 *
 * Authorization gate (added 2026-05-06 after multi-tenant-isolation probe
 * found cross-tenant data leak via ?tenant_id= override):
 *   If a query/body tenant_id is supplied AND differs from the JWT's
 *   tenant_id AND the caller is not super-admin, return 403. The dashboard
 *   uses ?tenant_id=<self> for legitimate calls (which still passes the
 *   gate trivially), and super-admin tooling uses ?tenant_id=<other> as
 *   the cross-tenant scoping mechanism (also allowed). What the gate
 *   blocks is a non-admin user passing another tenant's id — previously
 *   that silently scoped the request to the victim tenant.
 *
 *   Anonymous (auth-less) requests still pass through here so downstream
 *   handlers can reject via requireAuth(); the gate only fires once a
 *   JWT is present.
 */
export function tenantMiddleware(app: AppFastifyInstance) {
  app.addHook('preHandler', async (request: AppRequest, reply) => {
    if (request.method === 'OPTIONS') return;
    if (isTenantExempt(request.url)) return;

    // Tenant-scoped routes require an authenticated session. A user-supplied
    // tenant_id (query or body) is only ever a *selector* within the tenants
    // the JWT permits — never a substitute for authentication. Without a JWT
    // there is nothing to validate the supplied tenant_id against, so the
    // request must be rejected here, before any tenant resolution trusts it.
    //
    // Origin: 2026-05-21 — an anonymous request with `?tenant_id=<uuid>` (no
    // Authorization header) resolved that tenant below and returned its data
    // (read + write + delete) with zero auth. RLS faithfully scoped to the
    // attacker-chosen tenant; RLS was never authentication. The 2026-05-06
    // cross-tenant override guard only fired when a jwtTenant already existed,
    // so it missed the unauthenticated case entirely. Public routes that
    // legitimately need no tenant (login, password reset, demo, metrics,
    // OAuth callbacks, HMAC-signed webhooks) are allowed through; everything
    // else fails closed.
    const urlPath = request.url.split('?')[0];
    const isPublic = PUBLIC_ROUTES.includes(urlPath);
    if (!isPublic && !request.auth) {
      request.log.warn(
        { event: 'unauthenticated_tenant_route', url: request.url, ip: request.ip },
        'unauthenticated_tenant_route'
      );
      return reply.status(401).send({ success: false, error: 'Authentication required' });
    }

    const SUPER_ADMIN = '00000000-0000-0000-0000-000000000000';
    const queryTenant = (request.query as Record<string, string>)?.tenant_id;
    const bodyTenant = (request.body as Record<string, string>)?.tenant_id;

    // Reject the literal strings "undefined"/"null"/anything-not-a-UUID
    // that a stale dashboard build or an unresolved React hook can send
    // before the active-tenant context has materialised. Without this
    // guard the value falls through to withTenantClient() which hands it
    // to Postgres's UUID parser and gets `invalid input syntax for type
    // uuid: "undefined"` (Postgres error 22P02) — surfaced as a 500 to
    // the caller and as a React error boundary in the dashboard. Catch
    // it at the door instead. Empty string is treated as "not provided"
    // and falls through to the JWT tenant_id below.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const malformed = [queryTenant, bodyTenant].find(
      (t) => t !== undefined && t !== null && t !== '' && !UUID_RE.test(t)
    );
    if (malformed !== undefined) {
      request.log.warn(
        {
          event: 'malformed_tenant_id',
          value: malformed,
          url: request.url,
        },
        'malformed_tenant_id'
      );
      return reply.status(400).send({
        success: false,
        error: `tenant_id must be a valid UUID (received: ${JSON.stringify(malformed)})`,
      });
    }

    const candidate = queryTenant || bodyTenant;
    const jwtTenant = request.auth?.tenant_id;
    const isSuperAdmin = jwtTenant === SUPER_ADMIN;

    if (candidate && jwtTenant && candidate !== jwtTenant && !isSuperAdmin) {
      request.log.warn(
        {
          event: 'cross_tenant_override_blocked',
          jwtTenant,
          attemptedTenant: candidate,
          source: queryTenant ? 'query' : 'body',
          url: request.url,
          userId: request.auth?.user_id,
        },
        'cross_tenant_override_blocked'
      );
      return reply.status(403).send({
        success: false,
        error: 'Forbidden: tenant_id does not match authenticated session',
      });
    }

    // Also block divergent query+body tenants in the same request — even
    // if both equal the JWT (super-admin edge case where one is wrong),
    // a mismatched pair is ambiguous and rejected.
    if (queryTenant && bodyTenant && queryTenant !== bodyTenant) {
      request.log.warn(
        {
          event: 'tenant_id_mismatch_query_vs_body',
          queryTenant,
          bodyTenant,
          url: request.url,
        },
        'tenant_id_mismatch_query_vs_body'
      );
      return reply.status(400).send({
        success: false,
        error: 'tenant_id mismatch between query and body',
      });
    }

    const tenantId = candidate || jwtTenant;
    if (tenantId) {
      request.tenantId = tenantId;

      // Enrich the request logger with tenant + user context
      // Every log from this request now includes tenantId and userId
      request.log = request.log.child({
        tenantId,
        userId: request.auth?.user_id,
      });
    }
  });
}

// ── Structured Event Logging Helpers ─────────────────────────────────

/**
 * Log a business event with structured data.
 * Use these instead of raw req.log.info() for consistency.
 *
 * Example:
 *   logEvent(req, 'appointment_booked', { appointmentId, customerId });
 *   logEvent(req, 'shift_created', { employeeId, dayOfWeek });
 */
export function logEvent(req: AppRequest, event: string, data?: Record<string, unknown>) {
  req.log.info({ event, ...data }, event);
}

export function logWarning(req: AppRequest, event: string, data?: Record<string, unknown>) {
  req.log.warn({ event, ...data }, event);
}

/**
 * Log an error with standardized structured fields for easy parsing.
 * Every error log will have: event, error_message, error_code, route, method, tenantId.
 *
 * Output is JSON (Pino) so log aggregators (Datadog, CloudWatch, Railway logs)
 * can filter/search by any field.
 *
 * Usage:
 *   logError(req, 'provisioning_failed', err, { tenant_id, assistantId });
 *   logError(req, 'booking_rpc_failed', err, { customerId, resourceId });
 */
export function logError(
  req: AppRequest,
  event: string,
  err: unknown,
  data?: Record<string, unknown>
) {
  const error = err instanceof Error ? err : new Error(String(err));
  req.log.error(
    {
      event,
      error_message: error.message,
      // Errors from various sources carry their own non-standard
      // diagnostic fields: pg errors have `code`, fetch/HTTP errors
      // have `statusCode`. The Error base type doesn't declare either —
      // the intersection types name exactly the optional shapes we read.
      error_code:
        (error as Error & { code?: string }).code ||
        (error as Error & { statusCode?: number }).statusCode ||
        null,
      error_stack: error.stack?.split('\n').slice(0, 5).join('\n'),
      route: req.url,
      method: req.method,
      tenantId: req.tenantId,
      userId: req.auth?.user_id,
      timestamp: new Date().toISOString(),
      ...data,
    },
    `${event}: ${error.message}`
  );
  // Counter sibling so dashboards can alert on rate(errors_total[5m])
  // by event name — much higher signal than scraping log lines.
  errorsTotal.inc({ event });
  // Sentry capture — no-op when SENTRY_DSN is unset. Pino is the
  // source of truth for log content; Sentry handles error grouping,
  // stack-trace dedup, and alert-on-spike.
  captureException(error, {
    event,
    route: req.url,
    method: req.method,
    tenant_id: req.tenantId,
    user_id: req.auth?.user_id,
    ...data,
  });
}

// ── JWT Auth Hook ────────────────────────────────────────────────────

import jwt from 'jsonwebtoken';

const JWT_SECRET =
  process.env.JWT_SECRET ||
  (process.env.NODE_ENV === 'production' ? '' : 'dev-jwt-secret-change-in-production');
const JWT_EXPIRY = process.env.JWT_EXPIRY || '8h';

type JwtPayload = {
  tenant_id: string;
  user_id: string;
  email: string;
  role: UserRole;
  iat?: number;
};

/**
 * Sign a session token. Exported so the auth route can mint tokens on
 * login/register; nothing else should need to call this.
 *
 * Tokens issued before the role column landed (no `role` claim) are
 * treated as 'owner' on read so existing sessions don't get downgraded
 * mid-flight. New tokens always carry an explicit role.
 */
export function generateToken(payload: {
  tenant_id: string;
  user_id: string;
  email: string;
  role: UserRole;
}): string {
  // jsonwebtoken's `expiresIn` is typed as `string | number` in older
  // versions but the runtime accepts ms-format strings like "8h".
  // SignOptions['expiresIn'] is the exact slot we're filling — narrower
  // than bare `any` while still accepting the env-derived string.
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY as jwt.SignOptions['expiresIn'] });
}

function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

/** Routes that bypass JWT verification entirely (no Bearer token expected). */
const PUBLIC_ROUTES = [
  '/health',
  '/ready',
  '/login',
  '/forgot-password',
  '/reset-password',
  '/',
  '/demo',
  '/demo/start',
  '/billing/webhook',
  // Prometheus scrape endpoint — auth is via METRICS_TOKEN bearer header
  // checked inside the route handler (not JWT). When the env var is unset
  // the route returns 404, so adding it here doesn't expose anything.
  '/metrics',
  // OAuth callbacks (redirects from external providers — no JWT available)
  '/calendar/auth/google/callback',
  '/calendar/auth/outlook/callback',
  '/square/auth/callback',
  // CRM webhooks (authenticated via HMAC/signature, not JWT)
  '/square/webhook',
  // SMS delivery-status callbacks (verified via provider signature, not JWT)
  '/communications/telnyx/status',
  // Self-service appointment actions — token-gated, no session JWT
  '/self/cancel',
  '/self/reschedule',
];

/**
 * Register the onRequest JWT verification hook.
 *
 * Behavior:
 *  - OPTIONS and public routes bypass.
 *  - No Authorization header → request proceeds anonymously (downstream
 *    handlers can still gate via requireAuth()).
 *  - Invalid/expired token → 401.
 *  - Token issued before the user's password_changed_at → 401 (so password
 *    rotation invalidates outstanding sessions).
 *  - Valid token → decoded payload attached as `request.auth`.
 *
 * The pool parameter is needed for the password_changed_at lookup.
 */
export function registerJwtAuthHook(app: AppFastifyInstance, pool: Pool) {
  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'OPTIONS') return;
    const urlPath = request.url.split('?')[0];
    if (PUBLIC_ROUTES.includes(urlPath)) return;

    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return;
    }

    const token = authHeader.slice(7);
    const decoded = verifyToken(token);
    if (!decoded) {
      request.log.warn(
        { url: request.url, ip: request.ip },
        'JWT verification failed — invalid or expired token'
      );
      return reply.status(401).send({ success: false, error: 'Invalid or expired token' });
    }

    if (decoded.iat) {
      const client = await pool.connect();
      try {
        const r = await client.query('SELECT password_changed_at FROM users WHERE user_id = $1', [
          decoded.user_id,
        ]);
        const changedAt = r.rows[0]?.password_changed_at as Date | undefined;
        if (changedAt && Math.floor(changedAt.getTime() / 1000) > decoded.iat) {
          return reply
            .status(401)
            .send({ success: false, error: 'Session expired — please log in again' });
        }
      } finally {
        client.release();
      }
    }

    (request as AppRequest).auth = { ...decoded, role: decoded.role ?? 'owner' };
  });
}
