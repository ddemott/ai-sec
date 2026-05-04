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
 * Origin: NEEDS-REFACTORING #1 of the 2026-05-04 cleanup pass (surfaced by
 * the verify-first on the deferred part of NEEDS-REFACTORING #11).
 */

import { vi, type Mock } from 'vitest';
import type { Pool, PoolClient } from 'pg';

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
      if (text.startsWith('SET LOCAL') || text.startsWith('RESET')) {
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
  return vi.fn(
    async <T>(_tenantId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> => {
      return fn(mockClient as unknown as PoolClient);
    },
  );
}
