/**
 * Embed a document's chunks and store them as tenant knowledge.
 *
 * Extracted from src/routes/knowledge.ts (2026-08-21). Chunking, normalizing,
 * embedding, costing and inserting are all things a route should call rather
 * than contain.
 *
 * TWO PROPERTIES HERE ARE DELIBERATE AND WOULD BE EASY TO "TIDY" AWAY:
 *
 * 1. COST TELEMETRY IS BEST-EFFORT, AND ONLY THE TELEMETRY. The recordAiCostEvent
 *    call is wrapped in its own try/catch that swallows. A missing ai_cost_events
 *    table in a dev database, or one transient write error, must never abort a
 *    document the owner is importing — losing their knowledge base to a
 *    bookkeeping failure would be absurd. Note how narrow the swallow is: it
 *    covers the ledger write ONLY. The embedding call and the tenant_docs INSERT
 *    are deliberately outside it, because those failing means the chunk did not
 *    land and the caller must hear about it.
 *
 * 2. BOTH FORMS OF THE TEXT ARE STORED. `content` is the chunk as written;
 *    `normalized_text` is the semantic core that was actually embedded. Keeping
 *    both is what lets a human read back what they uploaded while the vector
 *    search matches on meaning — store only the normalized form and the owner's
 *    own words are gone.
 *
 * The token estimate is the house ~4-chars-per-token heuristic and the price
 * mirrors aiCost's PRICING table; embeddings bill on input tokens only, which is
 * why there is no output side.
 */
import type { PoolClient } from 'pg';
import { recordAiCostEvent } from '../aiCost';

/** Price per input token for text-embedding-3-small. Mirrors aiCost PRICING. */
const EMBEDDING_USD_PER_TOKEN = 0.02e-6;

export interface IngestChunksDeps {
  getEmbedding: (text: string) => Promise<number[]>;
  normalizeForEmbedding?: (text: string, opts: { context: string }) => Promise<string>;
}

/**
 * Insert one row per chunk. Returns how many were stored, which is what the
 * route reports back to the owner.
 */
export async function ingestChunks(
  client: PoolClient,
  tenantId: string,
  chunks: string[],
  source: string,
  deps: IngestChunksDeps
): Promise<number> {
  for (const chunk of chunks) {
    const trimmedChunk = chunk.trim();
    // Normalize text to its semantic core before embedding (Phase 12E).
    const normalizedText = deps.normalizeForEmbedding
      ? await deps.normalizeForEmbedding(trimmedChunk, { context: 'knowledge base document' })
      : trimmedChunk;
    const embedding = await deps.getEmbedding(normalizedText);

    const embTokens = Math.ceil(normalizedText.length / 4);
    const embCost = embTokens * EMBEDDING_USD_PER_TOKEN;
    try {
      await recordAiCostEvent(client, {
        tenantId,
        source: 'kb_ingestion',
        provider: 'openai',
        model: 'text-embedding-3-small',
        inputTokens: embTokens,
        estimatedCostUsd: embCost,
      });
    } catch {
      /* swallow — a ledger failure must not cost the owner their document */
    }

    await client.query(
      'INSERT INTO tenant_docs (tenant_id, content, normalized_text, source, embedding) VALUES ($1, $2, $3, $4, $5::vector)',
      [tenantId, trimmedChunk, normalizedText, source, JSON.stringify(embedding)]
    );
  }
  return chunks.length;
}
