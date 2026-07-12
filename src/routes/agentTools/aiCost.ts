/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method, @typescript-eslint/no-explicit-any */
/**
 * ESLint rules disabled for this file as part of historical full cleanup (REFACTORING_TODO item 10; see RESOLVED.md for details).
 * These are the remaining dynamic/any-heavy areas after previous tranches.
 */

/**
 * AI cost recording.
 *
 * Called by the agent worker at the end of every voice call with the
 * session's model usage (LLM tokens, STT audio, TTS characters).
 * Also callable from backend KB routes for ingestion/query costs.
 * Computes estimated_cost_usd using known published rates; TTS (historical xAI rows may exist)
 * pricing is not public so that row gets 0 (chars stored for later).
 */
import {
  COST_PER_INPUT_TOKEN,
  COST_PER_OUTPUT_TOKEN,
  DEEPGRAM_COST_PER_MS,
  RecordAiCostSchema,
} from './schemas';
import { ok, toolRoute, type AgentToolDeps } from './helpers';

export function registerAiCostRoutes({ app, withTenantClient }: AgentToolDeps): void {
  toolRoute(
    app,
    '/agent-tools/record-ai-cost',
    RecordAiCostSchema,
    async (args, reply) => {
      const rows = args.model_usage.filter((u) => u.type !== 'interruption_usage');
      if (rows.length === 0) return ok(reply, { recorded: 0 });

      const values: unknown[] = [];
      const placeholders: string[] = [];
      let idx = 1;

      for (const u of rows) {
        const inputCost = (COST_PER_INPUT_TOKEN[u.model] ?? 0) * u.inputTokens;
        const outputCost = (COST_PER_OUTPUT_TOKEN[u.model] ?? 0) * u.outputTokens;
        const audioCost = u.type === 'stt_usage' ? DEEPGRAM_COST_PER_MS * u.audioDurationMs : 0;
        const estimatedCost = inputCost + outputCost + audioCost;

        placeholders.push(
          `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`
        );
        values.push(
          args.tenant_id,
          args.call_id ?? null,
          args.source,
          u.provider,
          u.model,
          u.inputTokens,
          u.outputTokens,
          u.charactersCount,
          Math.round(u.audioDurationMs),
          estimatedCost.toFixed(8)
        );
      }

      await withTenantClient(args.tenant_id, (client) =>
        client.query(
          `INSERT INTO ai_cost_events
             (tenant_id, call_id, source, provider, model,
              input_tokens, output_tokens, characters_count, audio_duration_ms, estimated_cost_usd)
           VALUES ${placeholders.join(', ')}`,
          values
        )
      );

      return ok(reply, { recorded: rows.length });
    },
    'Failed to record AI cost'
  );
}
