/**
 * Pool-exhaustion integration test — the REAL fail-fast + alerting path.
 *
 * Context: 2026-05-21 added `connectionTimeoutMillis` to the canonical pool so
 * a request that can't get a slot under load fails fast (→ 500 → errors_total)
 * instead of hanging forever, and routed withHandler's unknown-error branch
 * through logError so the counter actually ticks. middleware.test.ts already
 * proves the counter increments — but it does so by THROWING A SYNTHETIC string
 * ("Connection terminated due to connection timeout"). That proves the catch
 * branch, not that a genuinely saturated pool produces that error and travels
 * the whole path.
 *
 * This test closes that gap end-to-end against a real Postgres pool:
 *   1. Pool({ max: 1, connectionTimeoutMillis }) — one slot only.
 *   2. Check out (and HOLD) the single client — the pool is now saturated.
 *   3. Hit a withHandler + withPoolClient route → its pool.connect() can't get
 *      a slot, rejects after ~connectionTimeoutMillis (NOT forever), withHandler
 *      catches it as an unknown error → logError → errors_total ticks → 500.
 *   4. Release the held client → the same route succeeds (capacity restored).
 *
 * 5W for sad-path failures:
 *   WHO  — every request that arrives while the pool is fully checked out
 *          (the "many concurrent callers" saturation scenario)
 *   WHAT — pool.connect() rejects with a connection-timeout error
 *   WHEN — within connectionTimeoutMillis, not indefinitely
 *   WHERE— withPoolClient → pool.connect() → withHandler catch → logError
 *   WHY  — a hang would pile up requests + exhaust upstream; failing fast +
 *          ticking errors_total is what lets rate(errors_total) alert fire
 *          exactly when load is the problem
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { type Client, Pool, type PoolClient } from 'pg';
import { ROOT_DB_URL, getRootClient, skipIfDbDown } from './test-utils';
import { withHandler, withPoolClient, type AppRequest } from './middleware';
import { errorsTotal } from './services/metrics';

const CONNECTION_TIMEOUT_MS = 500;

/** Current errors_total value for an event label (0 if never seen). */
function errorsTotalFor(event: string): number {
  return errorsTotal.snapshot().find((s) => s.labels.event === event)?.value ?? 0;
}

let setup: Client;
let pool: Pool;
let app: FastifyInstance;
let dbAvailable = false;

beforeEach((ctx) => skipIfDbDown(ctx, () => dbAvailable));

beforeAll(async () => {
  try {
    setup = await getRootClient();
    await setup.query('SELECT 1');

    // A deliberately tiny pool so a single held client saturates it. Short
    // connectionTimeoutMillis keeps the test fast while still proving the
    // bounded-wait behavior (not an instant reject, not an infinite hang).
    pool = new Pool({
      connectionString: ROOT_DB_URL,
      max: 1,
      connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    });

    app = Fastify({ logger: false });
    // Route mirrors a real tenant-scoped handler: grab a client, do a trivial
    // query, release. Wrapped in withHandler so its error branch is exercised.
    app.get(
      '/exhaust-test',
      withHandler(async (_req: AppRequest, reply) => {
        const res = await withPoolClient(pool, (client: PoolClient) => client.query('SELECT 1'));
        return reply.send({ success: true, rows: res.rowCount });
      }, 'Could not fetch data')
    );
    await app.ready();

    dbAvailable = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[poolExhaustion.test] DB not available, skipping', err);
  }
});

afterAll(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
  if (setup) await setup.end();
});

describe('pool exhaustion → fail-fast 500 + errors_total (real pool)', () => {
  it('HAPPY (control): with a free slot the route returns 200', async () => {
    // Sanity: the route works when the pool has capacity. Without this, a
    // route that 500s for an unrelated reason would make the exhaustion
    // assertion below pass for the wrong reason.
    const res = await app.inject({ method: 'GET', url: '/exhaust-test' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, rows: 1 });
  });

  it('SAD: a saturated pool rejects fast (≤ timeout+margin) with 500 AND ticks errors_total', async () => {
    const before = errorsTotalFor('unhandled_route_error');

    // Hold the ONLY client — pool is now fully saturated.
    const held = await pool.connect();
    try {
      const start = Date.now();
      const res = await app.inject({ method: 'GET', url: '/exhaust-test' });
      const elapsed = Date.now() - start;

      // Fail-fast: 500, not a hang. The whole point of connectionTimeoutMillis.
      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ success: false, error: 'Could not fetch data' });

      // Bounded wait: it DID wait for the timeout (not an instant unrelated
      // error) but rejected near it, not indefinitely. Generous upper margin
      // for CI scheduling jitter; the contract is "fast, not forever".
      expect(elapsed).toBeGreaterThanOrEqual(CONNECTION_TIMEOUT_MS - 100);
      expect(elapsed).toBeLessThan(CONNECTION_TIMEOUT_MS + 3000);

      // Alerting path: the real timeout traveled withHandler → logError, so
      // rate(errors_total) can fire under load. This is the assertion the
      // synthetic middleware.test.ts version cannot make.
      expect(errorsTotalFor('unhandled_route_error')).toBe(before + 1);
    } finally {
      held.release();
    }
  });

  it('HAPPY: releasing the held client restores capacity (route 200 again)', async () => {
    // Proves the failure was saturation, not a wedged pool — the same route
    // recovers the moment a slot frees up.
    const res = await app.inject({ method: 'GET', url: '/exhaust-test' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, rows: 1 });
  });
});
