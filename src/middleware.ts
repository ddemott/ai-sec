/**
 * Shared middleware, error handling, and logging patterns.
 *
 * Design Patterns Used:
 * - Decorator: withHandler wraps route handlers with consistent error handling
 * - Chain of Responsibility: tenant middleware runs before every route
 * - Strategy: error handler dispatches based on error type
 * - Facade: request context (req.tenantId, req.log) hides extraction complexity
 */

import type { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import { errorsTotal } from './services/metrics';

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
export function withHandler(handler: RouteHandler, errorMessage: string): RouteHandler {
  return async (req: AppRequest, reply: FastifyReply) => {
    try {
      return await handler(req, reply);
    } catch (err: unknown) {
      // TENANT_NOT_FOUND: propagate to global handler for 404 + auto-logout
      if (err instanceof Error && (err as unknown as { code?: string }).code === 'TENANT_NOT_FOUND') {
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

      // Unknown error: log and return 500
      req.log.error({
        err,
        tenantId: req.tenantId,
        route: req.url,
        method: req.method,
      }, errorMessage);

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
export async function withPoolClient<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
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
  const tenantId = req.tenantId || (req.body as Record<string, string>)?.tenant_id;
  if (!tenantId) {
    reply.status(400).send({ error: 'tenant_id is required' });
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
    reply.status(401).send({ success: false, error: 'Authentication required' });
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
    reply.status(401).send({ success: false, error: 'Authentication required' });
    return false;
  }
  if (req.auth.tenant_id !== '00000000-0000-0000-0000-000000000000') {
    reply.status(403).send({ success: false, error: 'Forbidden: super-admin only' });
    return false;
  }
  return true;
}

// ── Tenant ID Middleware (Chain of Responsibility) ────────────────────

/** Routes that don't require a tenant_id */
const TENANT_EXEMPT_ROUTES = [
  '/health', '/login', '/register', '/',
  '/billing/webhook',
  // OAuth callbacks (redirects from external providers)
  '/calendar/auth/google/callback',
  '/calendar/auth/outlook/callback',
  '/hubspot/auth/callback',
  '/jobber/auth/callback',
  '/square/auth/callback',
  '/servicetitan/auth/callback',
  // CRM webhooks (authenticated via HMAC/signature, not JWT)
  '/hubspot/webhook',
  '/square/webhook',
  '/servicetitan/webhook',
  '/tenants', '/templates', '/templates/full', '/templates/create',
];

function isTenantExempt(url: string): boolean {
  const path = url.split('?')[0];
  return TENANT_EXEMPT_ROUTES.some(r => path === r || path.startsWith('/tenants/'))
    || path.startsWith('/jobber/webhook/') // Jobber webhook uses tenantId in URL path
    || path.startsWith('/agent-tools/'); // LiveKit agent tool calls; tenant_id supplied in body
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
export function tenantMiddleware(app: FastifyInstance) {
  app.addHook('preHandler', async (request: AppRequest, reply) => {
    if (request.method === 'OPTIONS') return;
    if (isTenantExempt(request.url)) return;

    const SUPER_ADMIN = '00000000-0000-0000-0000-000000000000';
    const queryTenant = (request.query as Record<string, string>)?.tenant_id;
    const bodyTenant = (request.body as Record<string, string>)?.tenant_id;
    const candidate = queryTenant || bodyTenant;
    const jwtTenant = request.auth?.tenant_id;
    const isSuperAdmin = jwtTenant === SUPER_ADMIN;

    if (candidate && jwtTenant && candidate !== jwtTenant && !isSuperAdmin) {
      request.log.warn({
        event: 'cross_tenant_override_blocked',
        jwtTenant,
        attemptedTenant: candidate,
        source: queryTenant ? 'query' : 'body',
        url: request.url,
        userId: request.auth?.user_id,
      }, 'cross_tenant_override_blocked');
      reply.status(403).send({
        success: false,
        error: 'Forbidden: tenant_id does not match authenticated session',
      });
      return reply;
    }

    // Also block divergent query+body tenants in the same request — even
    // if both equal the JWT (super-admin edge case where one is wrong),
    // a mismatched pair is ambiguous and rejected.
    if (queryTenant && bodyTenant && queryTenant !== bodyTenant) {
      request.log.warn({
        event: 'tenant_id_mismatch_query_vs_body',
        queryTenant,
        bodyTenant,
        url: request.url,
      }, 'tenant_id_mismatch_query_vs_body');
      reply.status(400).send({
        success: false,
        error: 'tenant_id mismatch between query and body',
      });
      return reply;
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
  req.log.error({
    event,
    error_message: error.message,
    error_code: (error as any).code || (error as any).statusCode || null,
    error_stack: error.stack?.split('\n').slice(0, 5).join('\n'),
    route: req.url,
    method: req.method,
    tenantId: req.tenantId,
    userId: req.auth?.user_id,
    timestamp: new Date().toISOString(),
    ...data,
  }, `${event}: ${error.message}`);
  // Counter sibling so dashboards can alert on rate(errors_total[5m])
  // by event name — much higher signal than scraping log lines.
  errorsTotal.inc({ event });
}

// ── JWT Auth Hook ────────────────────────────────────────────────────

import jwt from 'jsonwebtoken';

const JWT_SECRET =
  process.env.JWT_SECRET ||
  (process.env.NODE_ENV === 'production' ? '' : 'dev-jwt-secret-change-in-production');
const JWT_EXPIRY = process.env.JWT_EXPIRY || '8h';

type JwtPayload = { tenant_id: string; user_id: string; email: string; role: UserRole; iat?: number };

/**
 * Sign a session token. Exported so the auth route can mint tokens on
 * login/register; nothing else should need to call this.
 *
 * Tokens issued before the role column landed (no `role` claim) are
 * treated as 'owner' on read so existing sessions don't get downgraded
 * mid-flight. New tokens always carry an explicit role.
 */
export function generateToken(payload: { tenant_id: string; user_id: string; email: string; role: UserRole }): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY as any });
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
  '/health', '/login', '/forgot-password', '/reset-password', '/', '/demo',
  '/billing/webhook',
  // Prometheus scrape endpoint — auth is via METRICS_TOKEN bearer header
  // checked inside the route handler (not JWT). When the env var is unset
  // the route returns 404, so adding it here doesn't expose anything.
  '/metrics',
  // OAuth callbacks (redirects from external providers — no JWT available)
  '/calendar/auth/google/callback',
  '/calendar/auth/outlook/callback',
  '/hubspot/auth/callback',
  '/jobber/auth/callback',
  '/square/auth/callback',
  '/servicetitan/auth/callback',
  // CRM webhooks (authenticated via HMAC/signature, not JWT)
  '/hubspot/webhook',
  '/square/webhook',
  '/servicetitan/webhook',
];

/**
 * Register the onRequest JWT verification hook.
 *
 * Behavior:
 *  - OPTIONS, public routes, and Jobber webhook subpaths bypass.
 *  - No Authorization header → request proceeds anonymously (downstream
 *    handlers can still gate via requireAuth()).
 *  - Invalid/expired token → 401.
 *  - Token issued before the user's password_changed_at → 401 (so password
 *    rotation invalidates outstanding sessions).
 *  - Valid token → decoded payload attached as `request.auth`.
 *
 * The pool parameter is needed for the password_changed_at lookup.
 */
export function registerJwtAuthHook(app: FastifyInstance, pool: Pool) {
  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'OPTIONS') return;
    const urlPath = request.url.split('?')[0];
    if (PUBLIC_ROUTES.includes(urlPath) || urlPath.startsWith('/jobber/webhook/')) return;

    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return;
    }

    const token = authHeader.slice(7);
    const decoded = verifyToken(token);
    if (!decoded) {
      request.log.warn({ url: request.url, ip: request.ip }, 'JWT verification failed — invalid or expired token');
      return reply.status(401).send({ success: false, error: 'Invalid or expired token' });
    }

    if (decoded.iat) {
      const client = await pool.connect();
      try {
        const r = await client.query('SELECT password_changed_at FROM users WHERE id = $1', [decoded.user_id]);
        const changedAt = r.rows[0]?.password_changed_at as Date | undefined;
        if (changedAt && Math.floor(changedAt.getTime() / 1000) > decoded.iat) {
          return reply.status(401).send({ success: false, error: 'Session expired — please log in again' });
        }
      } finally {
        client.release();
      }
    }

    (request as AppRequest).auth = { ...decoded, role: decoded.role ?? 'owner' };
  });
}
