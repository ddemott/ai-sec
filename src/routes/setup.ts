import type { AppFastifyInstance } from '../types/fastify';
import type { Pool, PoolClient } from 'pg';
import { withHandler, logEvent, requireTenantId, type AppRequest } from '../middleware';
import {
  DraftGraphSchema,
  findDuplicateTmpIds,
  findMissingTmpIdReferences,
  insertDraftGraph,
} from '../services/setupGraph';

/**
 * POST /setup/commit — the wizard's Phase B commit-on-enter-step-9 endpoint.
 * Twin of POST /coverage/dry-run (src/routes/analytics.ts): same draft graph,
 * same insertDraftGraph body, but COMMITs instead of ROLLBACK. See
 * src/services/setupGraph.ts for why the two share one schema/insert path,
 * and docs/superpowers/specs/2026-07-05-wizard-phase-b-design.md for the
 * full design (Option B rationale, the lossy-insert fix, the idempotency
 * guard, and why the entity-graph commit fires on ENTERING step 9, not on
 * the wizard's final Done click).
 */
export function registerSetupRoutes(
  app: AppFastifyInstance,
  _pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  app.post(
    '/setup/commit',
    withHandler(async (req: AppRequest, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      const parsed = DraftGraphSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ success: false, error: 'Validation failed', details: parsed.error.issues });
      }
      const draft = parsed.data;

      const duplicates = findDuplicateTmpIds(draft);
      if (duplicates.length > 0) {
        return reply.status(400).send({
          success: false,
          error: 'Draft contains duplicate tmp_ids',
          details: duplicates,
        });
      }

      const missing = findMissingTmpIdReferences(draft);
      if (missing.length > 0) {
        return reply.status(400).send({
          success: false,
          error: 'Draft references unknown tmp_ids',
          details: missing,
        });
      }

      const counts = await withTenantClient(tenantId, async (client) => {
        await client.query('BEGIN');
        try {
          // Per-tenant advisory lock, held for the rest of this transaction:
          // closes the TOCTOU race where two concurrent /setup/commit requests
          // both see "no services" before either commits, and both proceed to
          // insert — doubling the catalog. hashtext(uuid) collapses the tenant
          // id to a lock key; xact_lock auto-releases on COMMIT/ROLLBACK, so a
          // second waiting request only proceeds past this line once the first
          // has fully committed (or rolled back) and its rows are visible.
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [tenantId]);

          // Soft-delete-aware idempotency guard: a tenant that legitimately
          // wiped its catalog (soft-deleted) and re-runs setup should not be
          // falsely blocked, but a tenant with ANY real services already
          // committed has finished setup once — commit is INSERT-only and
          // would duplicate the whole graph on a second run (e.g. the wizard
          // reopened on an already onboarded tenant, or a lost-response retry).
          const existing = await client.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM services WHERE tenant_id = $1 AND is_deleted = false`,
            [tenantId]
          );
          if (Number(existing.rows[0].count) > 0) {
            // Plain Error + statusCode (not AppError): withHandler only echoes
            // a `code` field for AppError, and AppErrorCode is a closed union
            // with no CONFLICT variant — a dead `code` property here would be
            // misleading, so this intentionally carries status + message only.
            const err = new Error('Setup already completed — edit in My Business') as Error & {
              statusCode: number;
            };
            err.statusCode = 409;
            throw err;
          }

          const result = await insertDraftGraph(client, tenantId, draft, {
            // 4-week default horizon — matches the wizard's forward-schedule
            // expansion (and the dry-run endpoint's default when no explicit
            // window is given); commit has no coverage date-range concept.
            weeksAhead: 4,
            startDate: new Date(),
          });
          await client.query('COMMIT');
          return result.counts;
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      });

      logEvent(req, 'setup_committed', { tenantId, ...counts });
      return reply.send({ success: true, counts });
    }, 'Failed to complete setup')
  );
}
