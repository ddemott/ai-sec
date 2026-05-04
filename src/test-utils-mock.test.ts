/**
 * Tests for the shared mock helpers in test-utils-mock.ts.
 * Happy + sad paths with 5W diagnostic context.
 *
 * Why a test file for a test helper: the module is shared by ~13 test files;
 * a regression here surfaces as a confusing failure in N unrelated suites.
 * Pinning the contract directly is cheaper than chasing it through callers.
 */
import { describe, it, expect } from 'vitest';
import type { PoolClient } from 'pg';
import {
  createMockClient,
  createMockPool,
  createMockWithTenantClient,
} from './test-utils-mock';

describe('createMockClient', () => {
  describe('Happy paths', () => {
    it('HAPPY: returns scripted responses in FIFO order', async () => {
      // WHO: route handler test that scripts a sequence of DB calls
      // WHAT: each query.shift()s one MockResponse off the queue
      // WHEN: code under test makes N queries with N pre-scripted responses
      // WHERE: createMockClient → query.fn → queryResponses.shift()
      // WHY: deterministic per-query responses are how the route tests pin
      //      both the query order AND the data flowing back into handler logic
      const { mockClient, queryResponses } = createMockClient();
      queryResponses.push({ rows: [{ id: 'first' }] });
      queryResponses.push({ rows: [{ id: 'second' }] });

      const r1 = await mockClient.query('SELECT 1', []);
      const r2 = await mockClient.query('SELECT 2', []);

      expect(r1).toEqual({ rows: [{ id: 'first' }] });
      expect(r2).toEqual({ rows: [{ id: 'second' }] });
    });

    it('HAPPY: records every query (text + params) into `queries`', async () => {
      // WHO: assertion that "the route ran query X with params Y"
      // WHAT: queries array captures every call, in order
      // WHY: the canonical way to verify SQL composition without a real DB
      const { mockClient, queries, queryResponses } = createMockClient();
      queryResponses.push({ rows: [] });
      queryResponses.push({ rows: [] });

      await mockClient.query('INSERT INTO appts ...', ['t1', 'a1']);
      await mockClient.query('UPDATE appts SET ...', ['t1', 'a1', 'rescheduled']);

      expect(queries).toHaveLength(2);
      expect(queries[0]).toEqual({ text: 'INSERT INTO appts ...', params: ['t1', 'a1'] });
      expect(queries[1].params).toEqual(['t1', 'a1', 'rescheduled']);
    });

    it('HAPPY: `SET LOCAL` queries bypass the response queue', async () => {
      // WHO: tests that go through `withSyncContext` (the 4 CRM sync test files)
      // WHAT: session-variable scaffolding queries do NOT consume queryResponses
      // WHEN: tokenManagement's withSyncContext emits SET LOCAL app.user_id=...
      // WHERE: createMockClient → query.fn → text.startsWith('SET LOCAL') branch
      // WHY: tests pre-script responses for DATA queries; making them also script
      //      SET LOCAL responses would require knowing how many session vars the
      //      orchestrator emits per call — brittle and irrelevant to the test
      const { mockClient, queryResponses } = createMockClient();
      queryResponses.push({ rows: [{ data: 'real' }] });

      const setLocal = await mockClient.query("SET LOCAL app.tenant_id = 't1'", []);
      const dataQuery = await mockClient.query('SELECT 1', []);

      expect(setLocal).toEqual({ rows: [], rowCount: 0 });
      expect(dataQuery).toEqual({ rows: [{ data: 'real' }] });
    });

    it('HAPPY: `RESET` queries also bypass the response queue', async () => {
      // WHO: same sync-context machinery on the cleanup side
      // WHAT: RESET ALL emitted at end of `withSyncContext` also bypasses
      // WHY: same reason as SET LOCAL — tests should not have to know the
      //      cleanup pattern emitted by the orchestrator
      const { mockClient, queryResponses } = createMockClient();
      queryResponses.push({ rows: [{ data: 'real' }] });

      const dataQuery = await mockClient.query('SELECT 1', []);
      const reset = await mockClient.query('RESET ALL', []);

      expect(dataQuery).toEqual({ rows: [{ data: 'real' }] });
      expect(reset).toEqual({ rows: [], rowCount: 0 });
    });

    it('HAPPY: `queries` records session-variable queries (caller can filter)', async () => {
      // WHO: a test that wants to assert ONLY data queries ran
      // WHAT: queries log captures everything; caller filters at assert time
      // WHY: filtering at log time would lose the ability to assert "SET LOCAL
      //      ran exactly once with this tenant id" — keep raw, filter at call site
      const { mockClient, queries, queryResponses } = createMockClient();
      queryResponses.push({ rows: [] });

      await mockClient.query("SET LOCAL app.tenant_id = 't1'", []);
      await mockClient.query('SELECT 1', []);
      await mockClient.query('RESET ALL', []);

      expect(queries).toHaveLength(3);
      const dataQueries = queries.filter(
        (q) => !q.text.startsWith('SET LOCAL') && !q.text.startsWith('RESET'),
      );
      expect(dataQueries).toHaveLength(1);
      expect(dataQueries[0].text).toBe('SELECT 1');
    });
  });

  describe('Sad paths', () => {
    it('SAD: empty queue returns `{ rows: [], rowCount: 0 }` instead of throwing', async () => {
      // WHO: code under test that issues more queries than the test scripted
      // WHAT: instead of returning undefined or throwing, an unscripted query
      //       returns an empty no-op response — keeps tests honest about what
      //       happened without crashing them mid-handler
      // WHEN: a refactor adds an extra query the test author didn't account for
      // WHY: the failure surface is "expect 1 row, got 0" inside the handler
      //      assertion, which is more diagnosable than a TypeError
      const { mockClient } = createMockClient();
      const r = await mockClient.query('SELECT * FROM nowhere', []);
      expect(r).toEqual({ rows: [], rowCount: 0 });
    });

    it('SAD: `release()` is a vi.fn that records calls (not implemented as a no-op)', async () => {
      // WHO: tests that assert "the pool client was released" after the handler
      // WHAT: release is a tracked mock so .toHaveBeenCalled() works
      // WHY: a silent no-op would hide pool-leak bugs in handler code
      const { mockClient } = createMockClient();
      mockClient.release();
      expect(mockClient.release).toHaveBeenCalledTimes(1);
    });

    it('SAD: undefined params arrive as empty array, not undefined', async () => {
      // WHO: production code paths that call client.query(text) without params
      // WHAT: queries[i].params is always an array, never undefined
      // WHY: assertion code can rely on `params.length` and indexing without
      //      defensive `?? []` checks at every call site
      const { mockClient, queries, queryResponses } = createMockClient();
      queryResponses.push({ rows: [] });
      await mockClient.query('SELECT 1');
      expect(queries[0].params).toEqual([]);
    });
  });
});

describe('createMockPool', () => {
  it('HAPPY: pool.query() delegates to the mock client', async () => {
    // WHO: route handlers that call `pool.query(text, params)` directly
    //      (without checking out a client) — production pg Pool supports this
    // WHAT: pool.query routes through the same mock client, so the test's
    //       single scripted queue covers both pool.query and client.query calls
    // WHY: a route that mixes pool.query (e.g. for a quick lookup) with
    //      withTenantClient (for the main work) must see one consistent
    //      scripted timeline — splitting them would force per-test choreography
    const { mockClient, queries, queryResponses } = createMockClient();
    queryResponses.push({ rows: [{ via: 'pool.query' }] });
    const pool = createMockPool(mockClient);

    const result = await (pool as unknown as { query: (t: string, p?: unknown[]) => Promise<{ rows: unknown[] }> }).query(
      'SELECT now()',
      [],
    );

    expect(result.rows[0]).toEqual({ via: 'pool.query' });
    expect(queries).toHaveLength(1);
    expect(queries[0].text).toBe('SELECT now()');
  });

  it('HAPPY: connect() returns the same mock client every time', async () => {
    // WHO: code that calls pool.connect() inside a request handler
    // WHAT: pool.connect() returns the mock client, so handler code
    //       transparently runs against the same scripted query log
    // WHY: a single mock client across all .connect() calls keeps the test
    //      script readable — the test scripts queries in the order the
    //      handler will issue them, regardless of how many times it checks
    //      out a client
    const { mockClient } = createMockClient();
    const pool = createMockPool(mockClient);
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    expect(c1).toBe(mockClient);
    expect(c2).toBe(mockClient);
  });
});

describe('createMockWithTenantClient', () => {
  it('HAPPY: invokes the callback with the mock client and returns its result', async () => {
    // WHO: route tests that exercise a handler using `withTenantClient(tid, fn)`
    // WHAT: the mock factory just calls `fn(mockClient)` — no RLS scaffolding
    // WHEN: handler under test does `await withTenantClient('t1', async (c) => ...)`
    // WHY: route logic uses the closure for query orchestration; the mock
    //      cuts out the real-DB tenancy machinery without changing handler shape
    const { mockClient, queries, queryResponses } = createMockClient();
    queryResponses.push({ rows: [{ scoped: true }] });
    const withTenantClient = createMockWithTenantClient(mockClient);

    const result = await withTenantClient('tenant-x', async (c: PoolClient) => {
      const r = await c.query('SELECT 1', []);
      return r.rows[0];
    });

    expect(result).toEqual({ scoped: true });
    expect(withTenantClient).toHaveBeenCalledTimes(1);
    expect(queries).toHaveLength(1);
  });

  it('SAD: errors thrown inside the closure propagate to the caller', async () => {
    // WHO: a handler whose closure throws (DB error, validation failure, etc.)
    // WHAT: the mock factory does not swallow errors — they bubble up
    // WHY: production behavior is the same; the mock must not mask error paths
    //      or sad-path tests would silently never run their assertion logic
    const { mockClient } = createMockClient();
    const withTenantClient = createMockWithTenantClient(mockClient);

    await expect(
      withTenantClient('t1', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
});
