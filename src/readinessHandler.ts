/**
 * Deep readiness probe logic (GET /ready), extracted from index.ts so the
 * 503 (DB-unreachable) branch is unit-testable with a mock pool — the route
 * lives in the non-modular entry file and could otherwise only be exercised
 * against a live DB, and the failure path is the one that matters most for
 * alerting. See the /ready comment in index.ts for the endpoint's role
 * (monitoring signal, not a traffic gate). (2026-05-21)
 *
 * Takes a STRUCTURAL reply (status().send()) rather than FastifyReply so it
 * is decoupled from the app's server-type generics (the app runs HTTP/2 over
 * TLS in dev, so its FastifyReply differs from the default) — index.ts wraps
 * it in a thin inline handler that keeps Fastify's real types.
 */
import type { Pool, PoolClient } from 'pg';

/** Minimal logger surface the check needs — lets tests pass a stub. */
export interface ReadinessLogger {
  error(obj: Record<string, unknown>, msg: string): void;
}

/** Minimal reply surface: reply.status(code).send(body). */
export interface ReadinessReply {
  status(code: number): { send(body: unknown): unknown };
}

/**
 * Run the readiness check and write the response.
 * 200 + {db:'ok', pool:{...}} when the DB answers; 503 + {db:'error'} when
 * the checkout or probe query fails (DB down, or pool checkout timed out).
 */
export async function runReadinessCheck(
  pool: Pool,
  logger: ReadinessLogger,
  reply: ReadinessReply
): Promise<unknown> {
  const startedAt = Date.now();
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query('SELECT 1');
    return reply.status(200).send({
      status: 'ready',
      db: 'ok',
      latency_ms: Date.now() - startedAt,
      // waiting > 0 sustained = pool saturation (the "many callers" signal)
      pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount },
    });
  } catch (err) {
    logger.error(
      { event: 'readiness_check_failed', error_message: (err as Error).message },
      'readiness_check_failed'
    );
    return reply.status(503).send({
      status: 'not_ready',
      db: 'error',
      latency_ms: Date.now() - startedAt,
      pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount },
    });
  } finally {
    client?.release();
  }
}
