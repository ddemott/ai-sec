/* eslint-disable @typescript-eslint/unbound-method */
/**
 * ESLint rules disabled for this file as part of historical full cleanup (REFACTORING_TODO item 10; see RESOLVED.md for details).
 * These are the remaining dynamic/any-heavy areas after previous tranches.
 */

/**
 * Unit tests for the GET /ready readiness handler.
 *
 * WHO: monitors / load balancers / on-call engineers polling readiness
 * WHAT: 200 + {db:'ok', pool:{...}} when the DB answers; 503 + {db:'error'}
 *       when the pool checkout or probe query fails
 * WHEN: every /ready scrape — and especially the failure case we page on
 * WHERE: src/readinessHandler.ts (registered at /ready in src/index.ts)
 * WHY: the 503 (DB-unreachable) branch is the one that matters for alerting,
 *      and the live E2E only covers the healthy 200 path (can't tear down
 *      Postgres mid-suite). A mock pool whose connect()/query() rejects lets
 *      us pin the 503 path + body shape without a real outage. (2026-05-21)
 */
import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { runReadinessCheck, type ReadinessLogger } from '../src/readinessHandler';

/** Mock FastifyReply capturing status + body. */
function mockReply() {
  const r = {
    statusCode: 0,
    body: null as unknown,
    status(code: number) {
      r.statusCode = code;
      return r;
    },
    send(b: unknown) {
      r.body = b;
      return r;
    },
  };
  return r;
}

const silentLogger: ReadinessLogger = { error: vi.fn() };

// Minimal pg.Pool stand-in — only the members the handler touches.
function mockPool(opts: {
  connect: () => Promise<{ query: () => Promise<unknown>; release: () => void }>;
  total?: number;
  idle?: number;
  waiting?: number;
}) {
  return {
    connect: opts.connect,
    totalCount: opts.total ?? 1,
    idleCount: opts.idle ?? 0,
    waitingCount: opts.waiting ?? 0,
  } as unknown as Pool;
}

describe('runReadinessCheck', () => {
  it('HAPPY: DB answers → 200 with db:ok, pool stats, and the client released', async () => {
    const release = vi.fn();
    const query = vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });
    const pool = mockPool({
      connect: async () => ({ query, release }),
      total: 5,
      idle: 4,
      waiting: 0,
    });
    const reply = mockReply();

    await runReadinessCheck(pool, silentLogger, reply);

    expect(reply.statusCode).toBe(200);
    expect(reply.body).toMatchObject({ status: 'ready', db: 'ok' });
    expect((reply.body as { pool: unknown }).pool).toEqual({ total: 5, idle: 4, waiting: 0 });
    expect(query).toHaveBeenCalledWith('SELECT 1');
    expect(release, 'client MUST be released even on success').toHaveBeenCalledTimes(1);
  });

  it('SAD: pool.connect() rejects (DB down / checkout timeout) → 503, db:error, logged', async () => {
    // WHO: a /ready scrape while Postgres is unreachable or the pool is
    //      exhausted (connectionTimeoutMillis rejection)
    // WHAT: handler must not throw — it returns 503 with db:error so the
    //      monitor pages, and logs readiness_check_failed
    // WHY: this is the alerting-critical path; if it threw or 200'd, an
    //      outage would look healthy. Pre-extraction it was untestable.
    const logger: ReadinessLogger = { error: vi.fn() };
    const pool = mockPool({
      connect: async () => {
        throw new Error('Connection terminated due to connection timeout');
      },
      waiting: 3, // saturated
    });

    const reply = mockReply();

    await runReadinessCheck(pool, logger, reply);

    expect(reply.statusCode).toBe(503);
    expect(reply.body).toMatchObject({ status: 'not_ready', db: 'error' });
    // Pool stats still reported on failure — waiting>0 is the saturation tell.
    expect((reply.body as { pool: { waiting: number } }).pool.waiting).toBe(3);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'readiness_check_failed' }),
      'readiness_check_failed'
    );
  });

  it('SAD: probe query rejects after a successful connect → 503 and client still released', async () => {
    // WHY: a connection can be handed out but the DB then fail the SELECT 1
    //      (e.g. read-only / recovering). Must 503 AND release the client so
    //      a failing probe doesn't leak a connection per scrape.
    const release = vi.fn();
    const pool = mockPool({
      connect: async () => ({
        query: vi.fn().mockRejectedValue(new Error('canceling statement due to recovery conflict')),
        release,
      }),
    });
    const reply = mockReply();

    await runReadinessCheck(pool, silentLogger, reply);

    expect(reply.statusCode).toBe(503);
    expect(
      release,
      'client MUST be released even when the probe query fails'
    ).toHaveBeenCalledTimes(1);
  });
});
