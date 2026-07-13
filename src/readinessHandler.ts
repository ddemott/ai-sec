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

    // IS ROW-LEVEL SECURITY ACTUALLY ENFORCED FOR THE ROLE WE CONNECT AS?
    //
    // Found 2026-07-13, and it is not a small thing: production connects as a
    // role with rolbypassrls = true. RLS is INERT. Every policy, every
    // `FORCE ROW LEVEL SECURITY`, and every claim of database-enforced tenant
    // isolation in CLAUDE.md and docs/SECURITY.md is decorative. Verified against
    // prod — with app.current_tenant_id set to a tenant that owns nothing, all
    // three tenants and their customers were still readable.
    //
    // FORCE does not override BYPASSRLS (FORCE only removes the table-OWNER
    // exemption). Local and CI connect as a superuser, which also bypasses. So no
    // test in this repo could ever have caught it, and none did.
    //
    // Tenant isolation therefore rests ENTIRELY on tenantMiddleware — the same
    // layer where an anonymous `?tenant_id=<uuid>` full read/write/delete hole was
    // found on 2026-05-21. There is no second layer. There never was.
    //
    // This reports the truth rather than fixing it, deliberately: moving the app
    // to a non-BYPASSRLS role is a staged project, not a patch, and it has a
    // landmine under it (the admin_bypass policies test
    // `current_setting(...) = ''`, but on a COLD pool connection that GUC is NULL,
    // and NULL = '' is NULL — not true — so getDueReminders() would return zero
    // rows and every reminder would silently stop). Make it visible first. A
    // security property nobody can observe is a security property nobody has.
    const rls = await client.query<{ bypasses_rls: boolean; role: string }>(
      `SELECT rolbypassrls OR rolsuper AS bypasses_rls, rolname AS role
         FROM pg_roles WHERE rolname = current_user`
    );
    const bypassesRls = rls.rows[0]?.bypasses_rls ?? null;

    return reply.status(200).send({
      status: 'ready',
      db: 'ok',
      latency_ms: Date.now() - startedAt,
      // waiting > 0 sustained = pool saturation (the "many callers" signal)
      pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount },
      // true = RLS policies are ENFORCED for this role.
      // false = they are decorative and tenantMiddleware is the only boundary.
      rls_enforced: bypassesRls === null ? null : !bypassesRls,
      db_role: rls.rows[0]?.role ?? null,
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
