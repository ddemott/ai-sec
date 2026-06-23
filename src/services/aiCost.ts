import type { PoolClient } from 'pg';

/**
 * Records an AI usage/cost event to ai_cost_events.
 * Fire-and-forget friendly; callers should .catch(() => undefined) if optional.
 */
export interface RecordAiCostParams {
  tenantId: string;
  callId?: string | null;
  source: string; // 'kb_ingestion' | 'kb_query' | 'call_summary' | etc.
  provider: string; // 'openai' | 'xai' | 'deepgram'
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  charactersCount?: number;
  audioDurationMs?: number;
  /** Caller-provided cost. When omitted, estimateCost() derives it from tokens/usage. */
  estimatedCostUsd?: number;
}

const PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 0.15e-6, output: 0.6e-6 },
  'text-embedding-3-small': { input: 0.02e-6, output: 0 },
};

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
  if (params.provider === 'deepgram' && params.audioDurationMs) {
    cost += (params.audioDurationMs / 1000 / 60) * 0.0043; // per the constant in agentTools
  }
  // xAI TTS: pricing not public in the code comments; leave as caller-provided or 0
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
