/**
 * Resolve the service a booking / availability call should use.
 *
 * Callers almost never say the exact service name — "a meeting", "consulting",
 * "talk to Dale" — none of which substring-match "Programming Consultation".
 * A strict name match therefore dead-ends the call ("couldn't find a service"
 * → the agent bails → no booking; this was THE reason bookings never worked).
 *
 * Resolution order (the tenant default is the guaranteed catch-all):
 *   1. spokenType matches a real service (shortest ILIKE match) → use it.
 *   2. else → the tenant's configured `default_service_id` — THE FALLTHROUGH.
 *      No matter what the caller says (or doesn't), an unmatched type lands
 *      here, on a real service that carries a duration + required_skills, so
 *      the booking RPC can assign a skilled employee instead of failing
 *      NO_SKILLED_EMPLOYEE or booking an employee-less bare slot.
 *   3. else (default unset — legacy tenant) → safety net: the bookable,
 *      non-deleted service whose duration is closest to a 30-minute meeting.
 *   4. else (tenant truly has no bookable service) → null; caller handles it.
 */

import type { PoolClient } from 'pg';

/** Injected (routes already carry it) so this module stays pure + unit-testable. */
export type GetEmbedding = (text: string) => Promise<number[]>;

export interface ResolvedService {
  service_id: string;
  name: string;
  duration_minutes: number;
  price: number | null;
  required_skills: string[];
}

// Shared projection so every branch returns the identical shape/types.
// Every column is qualified with the `s` (services) alias — branch 2 JOINs
// `tenants t`, which ALSO has a `name` column, so a bare `name` there is
// "column reference \"name\" is ambiguous" (a prod 500 in availability/booking
// once default_service_id was backfilled and the fallthrough started running).
// Every branch below aliases services as `s` so this projection is valid.
const COLS = `s.service_id,
              s.name,
              s.duration_minutes::int AS duration_minutes,
              CASE WHEN s.price IS NULL THEN NULL ELSE s.price::float8 END AS price,
              COALESCE(s.required_skills, '{}') AS required_skills`;

/**
 * How close is close enough? Below this we do NOT use the semantic match.
 *
 * A BAD semantic match is worse than no match at all: it books the caller into the
 * wrong thing, silently and confidently, and the default-service fallthrough at least
 * lands on something the owner deliberately chose. So the bar is deliberately high
 * enough that "I want to talk to him about a role" lands on a consultation, and
 * "my cat is stuck in a tree" lands on nothing and falls through.
 */
const INTENT_MATCH_THRESHOLD = 0.35;

/**
 * Ensure every service has an embedding, embedding any that don't.
 *
 * Lazy and self-healing rather than a one-off backfill: a service created through the
 * dashboard tomorrow gets embedded the first time someone asks for it, so the feature
 * cannot quietly rot the way a backfill script does the moment somebody adds a row.
 * Best-effort — if OpenAI is down or out of quota, we return having done nothing and
 * the resolver falls back to ILIKE + the default, exactly as before.
 */
async function ensureServiceEmbeddings(
  client: PoolClient,
  tenantId: string,
  getEmbedding: GetEmbedding
): Promise<void> {
  const missing = await client.query<{ service_id: string; text: string }>(
    `SELECT s.service_id,
            concat_ws('. ', s.name, NULLIF(s.subtitle, ''), NULLIF(s.description, '')) AS text
       FROM services s
      WHERE s.tenant_id = $1
        AND s.embedding IS NULL
        AND COALESCE(s.is_deleted, false) = false`,
    [tenantId]
  );
  for (const row of missing.rows) {
    const vec = await getEmbedding(row.text);
    await client.query(`UPDATE services SET embedding = $2::vector WHERE service_id = $1`, [
      row.service_id,
      JSON.stringify(vec),
    ]);
  }
}

export async function resolveServiceForBooking(
  client: PoolClient,
  tenantId: string,
  spokenType: string | null | undefined,
  // Optional: when absent (older callers, unit tests) the semantic step is simply
  // skipped and resolution behaves exactly as it did before.
  getEmbedding?: GetEmbedding
): Promise<ResolvedService | null> {
  // 1. Name match — shortest ILIKE match wins (mirrors the analytics service
  //    mapping), so "consultation" prefers "Programming Consultation" over a
  //    longer incidental match.
  const trimmed = spokenType?.trim();
  if (trimmed) {
    const matched = await client.query<ResolvedService>(
      `SELECT ${COLS} FROM services s
        WHERE s.tenant_id = $1
          AND COALESCE(s.is_deleted, false) = false
          AND s.name ILIKE '%' || $2 || '%'
        ORDER BY length(s.name) ASC
        LIMIT 1`,
      [tenantId, trimmed]
    );
    if (matched.rows[0]) return matched.rows[0];

    // 1b. SEMANTIC MATCH — what did they MEAN?
    //
    // The ILIKE above can only fire if the string it is handed literally contains a
    // service's name, and a caller never says one. They say "a meeting", "talk to him
    // about a role", "look at my project". This file's own header has said so since it
    // was written — and the gap was papered over by making the LLM guess a catalog name
    // and passing THAT down, so the ILIKE always matched something. On 2026-07-14 a
    // caller asked for a meeting about a six-month contract, the model guessed "Personal
    // Callback" (a 15-minute call-me-back), and the resolver matched it perfectly. The
    // wrong answer came through a working mechanism.
    //
    // Choosing from a catalog is RETRIEVAL, not reasoning, and we already run pgvector
    // for the knowledge base. So the model stops choosing: it passes the caller's own
    // words, and the database finds the nearest service by MEANING. The description is
    // what makes it work — "Discuss a software project or role" is what pulls "I want
    // to talk to him about a position" onto Programming Consultation. No amount of
    // staring at the NAME would ever have got you there.
    //
    // Best-effort: an embedding failure (OpenAI down, no quota) must never break a
    // booking, so it falls through to the default exactly as before.
    try {
      if (!getEmbedding) throw new Error('no embedder — skip semantic step');
      await ensureServiceEmbeddings(client, tenantId, getEmbedding);
      const vec = await getEmbedding(trimmed);
      const semantic = await client.query<ResolvedService & { similarity: number }>(
        `SELECT * FROM match_service_by_intent($1, $2::vector)`,
        [tenantId, JSON.stringify(vec)]
      );
      const best = semantic.rows[0];
      if (best && best.similarity >= INTENT_MATCH_THRESHOLD) {
        const { similarity: _similarity, ...service } = best;
        return service;
      }
    } catch {
      /* fall through to the default — a booking must not die on an embedding */
    }
  }

  // 2. Tenant default — the fallthrough. Only if the referenced service still
  //    exists and isn't soft-deleted.
  const fallthrough = await client.query<ResolvedService>(
    `SELECT ${COLS} FROM services s
       JOIN tenants t ON t.default_service_id = s.service_id
      WHERE t.tenant_id = $1
        AND COALESCE(s.is_deleted, false) = false
      LIMIT 1`,
    [tenantId]
  );
  if (fallthrough.rows[0]) return fallthrough.rows[0];

  // 3. Safety net — a bookable service closest to a 30-minute meeting. Covers
  //    tenants provisioned before default_service_id existed / had it cleared.
  const safety = await client.query<ResolvedService>(
    `SELECT ${COLS} FROM services s
      WHERE s.tenant_id = $1
        AND COALESCE(s.is_deleted, false) = false
        AND EXISTS (SELECT 1 FROM service_employee se WHERE se.service_id = s.service_id)
      ORDER BY ABS(COALESCE(s.duration_minutes, 30) - 30) ASC, s.name ASC
      LIMIT 1`,
    [tenantId]
  );
  return safety.rows[0] ?? null;
}
