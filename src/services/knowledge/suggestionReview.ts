/**
 * Approving or rejecting an AI-extracted knowledge suggestion.
 *
 * Extracted from src/routes/knowledge.ts (2026-08-21).
 *
 * APPROVAL IS TRANSACTIONAL, AND THE REASON IS NOT ABSTRACT. Two writes have to
 * happen together: the Q&A goes into `tenant_docs`, and the suggestion flips to
 * 'confirmed'. Let those drift apart and you get one of two bad states — a
 * document ingested whose suggestion still reads 'suggested' (so the owner
 * approves it again and the agent now answers from two copies), or a suggestion
 * marked done whose content never landed (so the owner believes the agent knows
 * something it does not). The explicit BEGIN/COMMIT with ROLLBACK on the catch
 * is what stops both.
 *
 * THE `status = 'suggested'` PREDICATE ON THE UPDATE IS THE CONCURRENCY GUARD.
 * A double-click, a retry, or two people reviewing the same queue both reach
 * this code. Whoever loses affects zero rows, and zero rows means the row was
 * already reviewed — so the doc insert must be rolled back rather than left
 * behind as a duplicate. That is why this throws a 409 instead of returning:
 * `reply.send()` inside the transaction callback only exits the callback, and
 * the outer handler would carry on and send `{success:true}` on top of it —
 * double-sending, and telling the caller their approval worked twice.
 *
 * Cost telemetry stays fire-and-forget, deliberately outside the transaction: a
 * ledger write must never be able to roll back an owner's knowledge.
 */
import type { PoolClient } from 'pg';
import { recordAiCostEvent } from '../aiCost';
import { estimateTokens } from './tokenEstimate';

export interface PreparedQADocument {
  combined: string;
  normalizedText: string;
  embedding: number[];
}

/** Thrown when the suggestion was already reviewed by someone (or something) else. */
export class SuggestionAlreadyReviewedError extends Error {
  statusCode = 409;
  constructor() {
    super('Suggestion not found or already reviewed');
    this.name = 'SuggestionAlreadyReviewedError';
  }
}

/**
 * Insert the approved Q&A and flip the suggestion, atomically.
 */
export async function approveSuggestion(
  client: PoolClient,
  params: {
    tenantId: string;
    suggestionId: string;
    question: string;
    doc: PreparedQADocument;
  }
): Promise<void> {
  const { tenantId, suggestionId, question, doc } = params;
  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO tenant_docs (tenant_id, title, content, source, normalized_text, embedding)
               VALUES ($1, $2, $3, $4, $5, $6::vector)`,
      [
        tenantId,
        question,
        doc.combined,
        'website-scan',
        doc.normalizedText,
        JSON.stringify(doc.embedding),
      ]
    );
    const upd = await client.query(
      `UPDATE knowledge_suggestion SET status = 'confirmed', updated_at = now()
               WHERE id = $1 AND tenant_id = $2 AND status = 'suggested'`,
      [suggestionId, tenantId]
    );
    if ((upd.rowCount ?? 0) === 0) {
      throw new SuggestionAlreadyReviewedError();
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

/** Mark a suggestion rejected. No document is written, so no transaction needed. */
export async function rejectSuggestion(
  client: PoolClient,
  tenantId: string,
  suggestionId: string
): Promise<void> {
  await client.query(
    `UPDATE knowledge_suggestion SET status = 'rejected', updated_at = now()
             WHERE id = $1 AND tenant_id = $2 AND status = 'suggested'`,
    [suggestionId, tenantId]
  );
}

/**
 * Best-effort ledger write for an embedding. Never allowed to fail a review.
 *
 * `source` is always 'kb_ingestion' — deliberately, and this is now the ONLY
 * place embedding spend is filed. /knowledge/add and PUT /knowledge/:id used to
 * write `source: doc.source === 'website-scan' ? 'kb_ingestion' :
 * 'policy-questionnaire'`, which confused two different meanings of the word
 * "source": where a KB entry's CONTENT came from (a tenant_docs provenance
 * field the dashboard renders as a badge) and what CATEGORY of spend a ledger
 * row is. Embedding a KB entry is one activity with one cost; filing it under
 * two labels split it across two rows of the owner's spend breakdown depending
 * on which route created the entry, and 'policy-questionnaire' is in no reader's
 * vocabulary — not aiCost's documented set, not the ai-cost tool's z.enum, not
 * the migration's column comment. Nothing crashed because the column has no
 * CHECK constraint and the analytics query GROUPs BY source without filtering,
 * so the money was counted under a label nothing recognises.
 *
 * Rows already written under the old label keep it; this is not backfilled.
 */
export async function recordEmbeddingCost(
  client: PoolClient,
  tenantId: string,
  normalizedText: string
): Promise<void> {
  // No estimatedCostUsd: recordAiCostEvent prices the row from PRICING. See ./tokenEstimate.
  await recordAiCostEvent(client, {
    tenantId,
    source: 'kb_ingestion',
    provider: 'openai',
    model: 'text-embedding-3-small',
    inputTokens: estimateTokens(normalizedText),
  });
}
