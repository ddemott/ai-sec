/**
 * Agent tool routes — called by the LiveKit voice agent worker during a
 * live call. Replaces the Supabase Edge Function at
 * supabase/functions/vapi-tools/ (Phase 2 of the Vapi → LiveKit migration).
 *
 * Auth: shared secret in the `x-agent-secret` header (not JWT). The agent
 * passes `tenant_id` in each request body; these routes are exempt from
 * `tenantMiddleware` because the worker is not logged in as a tenant user.
 *
 * Response shape: `{ success: true, result: ... }` on success, `{ success:
 * false, error: string }` on failure — with a 200 status in both cases so
 * the LLM can relay the error conversationally rather than having the HTTP
 * client bubble an exception.
 *
 * This file owns only the auth gate and registration order; each tool lives
 * in a sibling module grouped by concern:
 *
 *   session.ts     — tenant-config + the voice_sessions lifecycle
 *   identity.ts    — who's calling: identify, look up, history, consent, OTP
 *   scheduling.ts  — catalog, availability, the booking RPCs, cancel/reschedule
 *   knowledge.ts   — RAG policy answers
 *   messaging.ts   — take-message, page-owner, job inquiry, self-service link
 *   aiCost.ts      — per-call model usage/cost recording
 *   _testRoutes.ts — SYNC_TEST_RECORDER readout (e2e only)
 */
import type { AppFastifyInstance } from '../../types/fastify';
import type { Pool } from 'pg';
import { timingSafeEqual } from 'crypto';
import type { AppRequest } from '../../middleware';
import type { AgentToolDeps, WithTenantClient } from './helpers';
import { registerSessionRoutes } from './session';
import { registerIdentityRoutes } from './identity';
import { registerSchedulingRoutes } from './scheduling';
import { registerKnowledgeRoutes } from './knowledge';
import { registerMessagingRoutes } from './messaging';
import { registerAiCostRoutes } from './aiCost';
import { registerTestRoutes } from './_testRoutes';

export function registerAgentToolRoutes(
  app: AppFastifyInstance,
  pool: Pool,
  withTenantClient: WithTenantClient,
  getEmbedding: (text: string) => Promise<number[]>,
  // Retained for signature stability (callers pass it positionally) but no
  // longer used on the policy-answer path — REDUCING a short caller query
  // collapsed its signal below the out-of-scope floor (see expandQueryForEmbedding).
  _normalizeForEmbedding?: (text: string, options?: { context?: string }) => Promise<string>,
  expandQueryForEmbedding?: (text: string, options?: { context?: string }) => Promise<string>
) {
  const AGENT_SECRET = process.env.AGENT_SECRET || '';
  // AGENT_SECRET_OLD is the rotation pivot: when rotating, set AGENT_SECRET
  // to the new value AND keep the previous value in AGENT_SECRET_OLD until
  // every agent worker has been redeployed with the new secret. Both values
  // are accepted during the rotation window. After all workers are on the
  // new secret, drop AGENT_SECRET_OLD.
  const AGENT_SECRET_OLD = process.env.AGENT_SECRET_OLD || '';
  if (!AGENT_SECRET) {
    app.log.warn('AGENT_SECRET not set — /agent-tools/* routes will reject all requests');
  }

  // Constant-time string comparison. Returns false if lengths differ
  // (length itself leaks but is negligible vs per-character timing) or
  // if the bytes don't match. Wrapped so callers don't need to remember
  // the Buffer.from + length-check + timingSafeEqual trio.
  function safeEquals(provided: string, expected: string): boolean {
    if (!expected) return false;
    const a = Buffer.from(provided, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length) return false;
    // timingSafeEqual throws if lengths differ — guarded above.
    return timingSafeEqual(a, b);
  }

  // Shared auth gate for every /agent-tools/ route. If AGENT_SECRET is
  // unset we still register the routes, but every request fails auth —
  // never "unlocked by default". Accepts AGENT_SECRET or (during rotation)
  // AGENT_SECRET_OLD.
  app.addHook('preHandler', async (req: AppRequest, reply) => {
    if (!req.url.startsWith('/agent-tools/')) return;
    const providedRaw = req.headers['x-agent-secret'];
    const provided = typeof providedRaw === 'string' ? providedRaw : '';
    if (!provided) {
      return reply.status(401).send({ success: false, error: 'Unauthorized' });
    }
    const matchesPrimary = safeEquals(provided, AGENT_SECRET);
    const matchesOld = AGENT_SECRET_OLD ? safeEquals(provided, AGENT_SECRET_OLD) : false;
    if (!matchesPrimary && !matchesOld) {
      return reply.status(401).send({ success: false, error: 'Unauthorized' });
    }
  });

  const deps: AgentToolDeps = {
    app,
    pool,
    withTenantClient,
    getEmbedding,
    expandQueryForEmbedding,
  };

  registerSessionRoutes(deps);
  registerIdentityRoutes(deps);
  registerSchedulingRoutes(deps);
  registerKnowledgeRoutes(deps);
  registerMessagingRoutes(deps);
  registerAiCostRoutes(deps);
  registerTestRoutes(deps);
}
