/**
 * Shared mock helpers for unit tests that exercise route handlers and
 * services against a fake `pg` client (no real DB).
 *
 * Before this module landed, ~13 test files duplicated near-identical copies
 * of `createMockClient` / `createMockPool` / `mockWithTenantClient` —
 * ~25 lines each, ~350 lines of overhead. This module is the one source of
 * truth.
 *
 * For real-DB integration tests, use `src/test-utils.ts` instead — that file
 * speaks to a real Postgres on port 5433 and handles savepoints / TRUNCATE.
 *
 * Origin: historical major refactor (see RESOLVED.md; originally tracked under NEEDS-REFACTORING #1 and #11).
 */

import { vi, type Mock } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import type { UserRole } from './middleware';

/** One captured query: SQL text + bound parameters in the order received. */
export interface MockQuery {
  text: string;
  params: unknown[];
}

/** A scripted response to return from a query. Push these into `queryResponses` in order. */
export interface MockResponse {
  rows: unknown[];
  rowCount?: number;
}

/** The minimal shape of the pg `PoolClient` API the tests touch. */
export interface MockClient {
  query: Mock;
  release: Mock;
}

/** Container returned by `createMockClient()` — the mock client + the test-side script + log. */
export interface MockClientHandle {
  /** Pass this where a `PoolClient` is expected (e.g. into `withTenantClient` closures). */
  mockClient: MockClient;
  /** Every query the code under test issued, in order. Includes session-variable queries. */
  queries: MockQuery[];
  /** FIFO queue. Push the responses you want returned in order, then run code under test. */
  queryResponses: MockResponse[];
}

/**
 * Build a mock pg client that records queries and returns scripted responses.
 *
 * Usage:
 *   const { mockClient, queries, queryResponses } = createMockClient();
 *   queryResponses.push({ rows: [{ id: 'X' }] });
 *   await codeUnderTest(mockClient);
 *   expect(queries[0].text).toContain('SELECT ...');
 *
 * Calls beyond the scripted queue length receive `{ rows: [], rowCount: 0 }`.
 *
 * `SET LOCAL` and `RESET` queries (session-variable scaffolding emitted by
 * `withSyncContext` in tokenManagement) do NOT consume from the queue —
 * they always return `{ rows: [], rowCount: 0 }` so a test that doesn't
 * pre-script those queries works correctly. Tests that don't use sync
 * context never see those queries; tests that do get the right behavior
 * automatically.
 *
 * To assert against data queries only (excluding session-variable noise):
 *   const dataQueries = queries.filter(q =>
 *     !q.text.startsWith('SET LOCAL') && !q.text.startsWith('RESET'));
 */
export function createMockClient(): MockClientHandle {
  const queries: MockQuery[] = [];
  const queryResponses: MockResponse[] = [];
  const mockClient: MockClient = {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      queries.push({ text, params: params || [] });
      if (
        text.startsWith('SET LOCAL') ||
        text.startsWith('RESET') ||
        text === 'BEGIN' ||
        text === 'COMMIT' ||
        text === 'ROLLBACK'
      ) {
        return { rows: [], rowCount: 0 };
      }
      return queryResponses.shift() || { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  return { mockClient, queries, queryResponses };
}

/**
 * Build a mock pg `Pool` whose `connect()` returns the given mock client.
 * Also exposes `pool.query()` that delegates to the same mock client, so
 * routes that call `pool.query()` directly (without checking out a client)
 * share the same scripted query log.
 *
 * Pass the result wherever production code expects a `Pool`.
 */
export function createMockPool(mockClient: MockClient): Pool {
  return {
    connect: vi.fn(async () => mockClient),
    query: vi.fn(async (text: string, params?: unknown[]) => mockClient.query(text, params)),
  } as unknown as Pool;
}

/**
 * Build a mock `withTenantClient` factory that runs the caller's closure
 * against the mock client directly — no RLS setup, no real pool checkout.
 * Suitable for route-handler tests that only need to verify SQL text +
 * scripted responses, not RLS enforcement.
 *
 * The returned `vi.fn` is callable as `withTenantClient(tenantId, fn)`,
 * matching the production signature in `src/database/index.ts`.
 */
export function createMockWithTenantClient(mockClient: MockClient): Mock {
  return vi.fn(async <T>(_tenantId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> => {
    return fn(mockClient as unknown as PoolClient);
  });
}

/**
 * Auth + tenant context the test injects into each request before the route
 * handler runs. Mutate the returned object between `app.inject()` calls to
 * simulate different callers (super-admin, owner, front_desk, unauthenticated).
 */
export interface RouteTestAuth {
  user_id: string;
  tenant_id: string;
  email: string;
  role: UserRole;
}

/**
 * Container returned by `buildRouteTestApp()` — the Fastify instance plus
 * the live mock-DB script handles plus the mutable auth/tenant stubs.
 */
export interface RouteTestAppHandle {
  /** Fastify app, ready to accept `app.inject()` calls. Call `app.close()` in `afterAll`. */
  app: FastifyInstance;
  /** Mock pool wired into the registrar — same client backs `withTenantClient`. */
  mockPool: Pool;
  /** Mock client; assert against `queries` and push to `queryResponses`. */
  mockClient: MockClient;
  /** Mock `withTenantClient` — pass into route registrars that take it. */
  withTenantClient: ReturnType<typeof createMockWithTenantClient>;
  /** Captured queries (FIFO, in order received). */
  queries: MockQuery[];
  /** Scripted query responses (FIFO; push BEFORE the inject call). */
  queryResponses: MockResponse[];
  /**
   * Mutable auth context. Set to `null` to simulate an unauthenticated request.
   * Default: super-admin owner. Overwrite the whole object or any field per test.
   */
  auth: { current: RouteTestAuth | null };
  /**
   * Mutable tenant_id stamped on `req.tenantId`. tenantMiddleware in production
   * derives this from the JWT auth + query/body validation; here we set it
   * directly since the cross-tenant-override gate lives in middleware.ts and
   * is covered separately by `multi-tenant-isolation.test.ts`.
   * Default: tracks `auth.current.tenant_id`.
   */
  tenantIdOverride: { current: string | null };
}

/**
 * Build a Fastify app wired to a mock Postgres pool, ready for one-route-module
 * coverage tests via `app.inject()`. Caller passes a `register` callback that
 * registers only the routes under test (matching the production wiring in
 * `src/index.ts` for that module).
 *
 * Why not just call `Fastify()` + register-the-route inline?
 *   1. Every route-handler test needs the same auth + tenant stubbing scaffold.
 *      Without the helper, ~30 lines duplicate per file.
 *   2. The `request.auth` and `request.tenantId` shapes are load-bearing
 *      contracts (snake_case `tenant_id`, `UserRole` enum). Centralizing the
 *      stub means a future contract change touches one place.
 *   3. Registers a default error handler so `withHandler()`'s thrown AppErrors
 *      surface as the right HTTP status codes (matching `src/index.ts:162`).
 *
 * Usage:
 *   const handle = buildRouteTestApp((app, pool, withTenantClient) => {
 *     registerMappingRoutes(app, pool, withTenantClient);
 *   });
 *   await handle.app.ready();
 *
 *   handle.queryResponses.push({ rows: [{ id: 'svc-1' }] });
 *   const res = await handle.app.inject({ method: 'GET', url: '/mappings/service-resource' });
 *   expect(res.statusCode).toBe(200);
 *
 *   // Drop auth for an unauthenticated probe:
 *   handle.auth.current = null;
 *   const res2 = await handle.app.inject({ method: 'POST', url: '/...' });
 *
 *   // afterAll:
 *   await handle.app.close();
 */
export function buildRouteTestApp(
  register: (
    app: FastifyInstance,
    pool: Pool,
    withTenantClient: ReturnType<typeof createMockWithTenantClient>
  ) => void
): RouteTestAppHandle {
  const handle = createMockClient();
  const mockPool = createMockPool(handle.mockClient);
  const withTenantClient = createMockWithTenantClient(handle.mockClient);

  const auth = {
    current: {
      user_id: '00000000-0000-0000-0000-000000000001',
      tenant_id: '00000000-0000-0000-0000-000000000000',
      email: 'admin@test.local',
      role: 'owner',
    } satisfies RouteTestAuth as RouteTestAuth | null,
  };
  const tenantIdOverride: { current: string | null } = { current: null };

  const app = Fastify({ logger: false });

  // Mirror the production content-type parser in src/index.ts:136 — preserves
  // req.rawBody for webhook signature verification while still parsing JSON
  // for handlers. Without this, route-handler tests exercising any
  // /*/webhook route always see req.rawBody as undefined and return 400.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    async (req: unknown, rawBody: Buffer) => {
      (req as { rawBody?: Buffer }).rawBody = rawBody;
      try {
        return JSON.parse(rawBody.toString('utf8'));
      } catch {
        throw new Error('Invalid JSON');
      }
    }
  );

  // Inject auth + tenantId before each handler runs. The production middleware
  // chain (registerJwtAuthHook → tenantMiddleware) is exercised separately by
  // `src/multi-tenant-isolation.test.ts` and `src/middleware.test.ts`; here we
  // bypass it so route-handler tests stay focused on handler behavior.
  app.addHook('preHandler', async (request) => {
    type Stamped = { auth: RouteTestAuth | null; tenantId: string | undefined };
    const stamped = request as unknown as Stamped;
    stamped.auth = auth.current;
    stamped.tenantId = tenantIdOverride.current ?? auth.current?.tenant_id;
  });

  // Match `src/index.ts:162` — AppError-based handlers depend on this shape.
  app.setErrorHandler(
    async (error: Error & { statusCode?: number; code?: string }, _request, reply) => {
      const statusCode = error.statusCode || 500;
      return reply
        .status(statusCode)
        .send({ success: false, error: error.message || 'Internal server error' });
    }
  );

  register(app, mockPool, withTenantClient);

  return {
    app,
    mockPool,
    mockClient: handle.mockClient,
    withTenantClient,
    queries: handle.queries,
    queryResponses: handle.queryResponses,
    auth,
    tenantIdOverride,
  };
}
