/**
 * This month's AI spend, grouped by source/provider/model.
 *
 * Extracted from src/routes/analytics.ts (2026-08-21). The route now does what
 * a route should — resolve the tenant, call this, send the result.
 *
 * TWO THINGS HERE ARE LOAD-BEARING AND EASY TO LOSE IN A TIDY-UP:
 *
 * 1. Postgres returns `SUM(...)::bigint` as a STRING. Every numeric field is
 *    coerced with Number() before it leaves this function. Drop that and the
 *    dashboard starts concatenating strings instead of adding them, which looks
 *    like an enormous bill rather than a bug.
 * 2. The total is summed in JS from the already-coerced values, not by SQL. It
 *    must equal the breakdown the caller was handed — computing it separately
 *    would let the two disagree.
 *
 * The window is the current calendar month (`date_trunc('month', now())`),
 * which is the billing question the dashboard is actually asking.
 */
import type { PoolClient } from 'pg';

export interface AiCostRow {
  source: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  characters_count: number;
  audio_duration_ms: number;
  estimated_cost_usd: number;
}

export interface AiCostBreakdown {
  breakdown: AiCostRow[];
  total_estimated_cost_usd: number;
  /**
   * Distinct CALLS that produced cost rows this month (T-011). Counted from
   * `call_id`, not from `voice_sessions` — this number is the denominator of
   * the average below, so it must count the calls the ledger actually saw. A
   * call whose cost POST failed is missing from both, which keeps the average
   * honest; blending in a session count would quietly divide real cost by
   * calls that contributed none and report a cheaper product than we run.
   */
  call_count: number;
  /**
   * Mean cost of a voice call this month, or null when no call has been costed
   * yet. NULL rather than 0: "we have not measured one" and "our calls are
   * free" are different claims, and the pricing decision this feeds cannot
   * afford to confuse them.
   *
   * Only `source = 'voice_call'` rows are in the numerator — knowledge-base
   * ingestion and dashboard queries are real spend but they are not per-call
   * spend, and folding them in makes the per-call number drift with something
   * a caller never touched.
   */
  avg_cost_per_call_usd: number | null;
  /** Month-to-date voice-call spend — the numerator of the average. */
  voice_call_cost_usd: number;
}

export async function getAiCostBreakdown(
  client: PoolClient,
  tenantId: string
): Promise<AiCostBreakdown> {
  const res = await client.query<Record<keyof AiCostRow, string>>(
    `SELECT
             source,
             provider,
             model,
             SUM(input_tokens)::bigint        AS input_tokens,
             SUM(output_tokens)::bigint       AS output_tokens,
             SUM(characters_count)::bigint    AS characters_count,
             SUM(audio_duration_ms)::bigint   AS audio_duration_ms,
             SUM(estimated_cost_usd)          AS estimated_cost_usd
           FROM ai_cost_events
           WHERE tenant_id = $1
             AND created_at >= date_trunc('month', now())
           GROUP BY source, provider, model
           ORDER BY SUM(estimated_cost_usd) DESC`,
    [tenantId]
  );

  const breakdown: AiCostRow[] = res.rows.map((r) => ({
    source: r.source,
    provider: r.provider,
    model: r.model,
    input_tokens: Number(r.input_tokens),
    output_tokens: Number(r.output_tokens),
    characters_count: Number(r.characters_count),
    audio_duration_ms: Number(r.audio_duration_ms),
    estimated_cost_usd: Number(r.estimated_cost_usd),
  }));

  const total_estimated_cost_usd = breakdown.reduce((sum, r) => sum + r.estimated_cost_usd, 0);

  // Per-call figures (T-011). Same month window as the breakdown above, and
  // deliberately a SEPARATE query: the breakdown groups by model, so a call
  // spanning four models appears in four rows and cannot be counted from it.
  const perCall = await client.query<{ call_count: string; voice_cost: string | null }>(
    `SELECT COUNT(DISTINCT call_id)::bigint AS call_count,
            SUM(estimated_cost_usd)         AS voice_cost
       FROM ai_cost_events
      WHERE tenant_id = $1
        AND created_at >= date_trunc('month', now())
        AND source = 'voice_call'
        AND call_id IS NOT NULL`,
    [tenantId]
  );

  const call_count = Number(perCall.rows[0]?.call_count ?? 0);
  const voice_call_cost_usd = Number(perCall.rows[0]?.voice_cost ?? 0);
  return {
    breakdown,
    total_estimated_cost_usd,
    call_count,
    voice_call_cost_usd,
    avg_cost_per_call_usd: call_count > 0 ? voice_call_cost_usd / call_count : null,
  };
}
