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

// ── Types ────────────────────────────────────────────────────────────

/** Extended request with tenant context and structured logger */
export interface AppRequest extends FastifyRequest {
  tenantId?: string;
  auth?: { tenant_id: string; user_id: string; email: string };
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
 * Priority: query param > body > JWT auth token
 */
export function tenantMiddleware(app: FastifyInstance) {
  app.addHook('preHandler', async (request: AppRequest, _reply) => {
    if (request.method === 'OPTIONS') return;
    if (isTenantExempt(request.url)) return;

    const tenantId =
      (request.query as Record<string, string>)?.tenant_id ||
      (request.body as Record<string, string>)?.tenant_id ||
      request.auth?.tenant_id;

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
}
