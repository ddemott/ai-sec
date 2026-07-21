import type { PoolClient } from 'pg';

/**
 * Records an AI usage/cost event to ai_cost_events.
 * Fire-and-forget friendly; callers should .catch(() => undefined) if optional.
 */
export interface RecordAiCostParams {
  tenantId: string;
  callId?: string | null;
  source: string; // 'kb_ingestion' | 'kb_query' | 'call_summary' | etc.
  provider: string; // 'openai' | 'xai' | 'deepgram'  ( 'xai' kept for legacy rows pre-2026-06-25 Grok TTS removal )
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  charactersCount?: number;
  audioDurationMs?: number;
  /** Caller-provided cost. When omitted, estimateCost() derives it from tokens/usage. */
  estimatedCostUsd?: number;
}

// Per-TOKEN USD rates. VERIFY against the current OpenAI pricing page when a
// model is added — these drift, and a stale rate lies quietly.
//
// gpt-4.1-mini was MISSING here until 2026-07-21, which meant estimateCost()
// fell through to {input:0, output:0} for the PRODUCTION VOICE LLM — so every
// call's dominant cost (77-83% of the total, all of it gpt-4.1-mini input
// tokens) recorded as $0.00. The ledger looked nearly free while the real bill
// was ~$0.06/call average. A cost table missing the thing that costs the most
// is worse than no table: it reports confidence in a number that is wrong.
const PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4.1-mini': { input: 0.4e-6, output: 1.6e-6 }, // current production voice LLM
  'gpt-4.1-nano': { input: 0.1e-6, output: 0.4e-6 }, // cheapest 4.1 (cost-down candidate)
  'gpt-4o-mini': { input: 0.15e-6, output: 0.6e-6 }, // summaries / classify / fallback
  'text-embedding-3-small': { input: 0.02e-6, output: 0 },
};

// Deepgram unit rates (not token-based).
const DEEPGRAM_STT_PER_MINUTE = 0.0043; // nova-3 streaming
const DEEPGRAM_AURA_PER_CHAR = 0.015 / 1000; // Aura TTS, ~$0.015 per 1k characters

function estimateCost(params: {
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  charactersCount?: number;
  audioDurationMs?: number;
}): number {
  const p = PRICING[params.model] || { input: 0, output: 0 };
  let cost = (params.inputTokens || 0) * p.input + (params.outputTokens || 0) * p.output;
  // Provider/model casing varies at the call site (recorded as "Deepgram" /
  // "deepgram"), so key the audio branches off the MODEL name, case-insensitively
  // — the previous `provider === 'deepgram'` check silently missed capitalized
  // rows, and TTS (Aura, char-priced) was never costed at all → $0.00.
  const model = params.model.toLowerCase();
  if (model.includes('nova') && params.audioDurationMs) {
    cost += (params.audioDurationMs / 1000 / 60) * DEEPGRAM_STT_PER_MINUTE;
  }
  if (model.includes('aura') && params.charactersCount) {
    cost += params.charactersCount * DEEPGRAM_AURA_PER_CHAR;
  }
  return cost;
}

export async function recordAiCostEvent(
  client: PoolClient,
  params: RecordAiCostParams
): Promise<void> {
  // Nullish (not ||) so an explicit 0 cost is stored as 0 rather than re-estimated.
  const cost = params.estimatedCostUsd ?? estimateCost(params);
  await client.query(
    `INSERT INTO ai_cost_events
       (tenant_id, call_id, source, provider, model,
        input_tokens, output_tokens, characters_count, audio_duration_ms, estimated_cost_usd)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      params.tenantId,
      params.callId ?? null,
      params.source,
      params.provider,
      params.model,
      params.inputTokens ?? 0,
      params.outputTokens ?? 0,
      params.charactersCount ?? 0,
      params.audioDurationMs ?? 0,
      cost,
    ]
  );
}

export { estimateCost };
