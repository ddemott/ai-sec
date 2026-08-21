/**
 * The RAG answer debugger behind POST /knowledge/explain.
 *
 * An owner cannot see the vector search, so when the agent says "I don't have
 * information on that" they have no way to tell a MISSING document from a
 * document that is present but scores too low to be retrieved. Those two have
 * opposite fixes — write new content, versus reword what is already there — and
 * guessing wrong wastes the owner's time and leaves the gap open.
 *
 * This runs the same retrieval the agent runs, then reports MORE than the agent
 * sees: a wider, lower-threshold candidate set annotated against the production
 * parameters, so near-misses are visible rather than silently dropped.
 *
 * ITS ONLY VALUE IS FIDELITY TO PRODUCTION. A debugger that scores questions
 * differently than the live path does not merely fail to help — it actively
 * misleads, and the owner trusts it precisely when they are least able to check
 * it.
 */
import type { PoolClient } from 'pg';

// Production retrieval params (kept in sync with /agent-tools/policy-answer).
const PROD_THRESHOLD = 0.5;
const PROD_MATCH_COUNT = 3;

/** Wider net + no floor: the point is to SHOW the near-misses production drops. */
const DEBUG_THRESHOLD = 0.0;
const DEBUG_MATCH_COUNT = 10;

export interface ExplainDeps {
  getEmbedding: (text: string) => Promise<number[]>;
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>;
  /**
   * The query-side transform production applies before embedding. Optional
   * because the route's own dependency is optional; when absent the raw
   * question is embedded, exactly as production falls back.
   */
  prepareQuery?: (text: string, options?: { context?: string }) => Promise<string>;
}

export interface ExplainedCandidate {
  rank: number;
  tenant_doc_id: string;
  similarity: number;
  above_threshold: boolean;
  used_in_production: boolean;
  content: string;
}

export interface ExplainedAnswer {
  production_threshold: number;
  production_match_count: number;
  candidates: ExplainedCandidate[];
  /** Did production have anything to answer with at all? */
  would_answer: boolean;
  /** The exact context string the agent would relay, or null if nothing qualifies. */
  composed_answer: string | null;
}

export async function explainAnswer(
  deps: ExplainDeps,
  tenantId: string,
  question: string
): Promise<ExplainedAnswer> {
  const { getEmbedding, withTenantClient, prepareQuery } = deps;

  // Embed the question EXACTLY as /agent-tools/policy-answer does — same
  // transform, same context string, same fall back to the raw question on
  // failure. Diverge here and every similarity score below is measuring a
  // question the caller never asked.
  let queryText = question;
  if (prepareQuery) {
    try {
      queryText = await prepareQuery(question, { context: 'customer phone inquiry' });
    } catch {
      // fall back to the raw question
    }
  }
  const embedding = await getEmbedding(queryText);

  const matches = await withTenantClient(tenantId, (client) =>
    client.query<{ tenant_doc_id: string; content: string; similarity: number }>(
      `SELECT tenant_doc_id, content, similarity
         FROM search_tenant_docs_normalized($1, $2::vector, $3, $4)`,
      [tenantId, JSON.stringify(embedding), DEBUG_THRESHOLD, DEBUG_MATCH_COUNT]
    )
  );

  // Rank order is by similarity DESC (the RPC returns it sorted). The chunks
  // actually used in production are the top PROD_MATCH_COUNT that also clear
  // PROD_THRESHOLD.
  let usedSoFar = 0;
  const candidates: ExplainedCandidate[] = matches.rows.map((row, i) => {
    const aboveThreshold = row.similarity >= PROD_THRESHOLD;
    const usedInProduction = aboveThreshold && usedSoFar < PROD_MATCH_COUNT;
    if (usedInProduction) usedSoFar += 1;
    return {
      rank: i + 1,
      tenant_doc_id: row.tenant_doc_id,
      similarity: row.similarity,
      above_threshold: aboveThreshold,
      used_in_production: usedInProduction,
      content: row.content,
    };
  });

  return {
    production_threshold: PROD_THRESHOLD,
    production_match_count: PROD_MATCH_COUNT,
    candidates,
    would_answer: usedSoFar > 0,
    composed_answer: await composeProductionAnswer(deps, tenantId, candidates),
  };
}

/**
 * Rebuild the EXACT context string /agent-tools/policy-answer would hand the
 * agent: the used chunks joined, each prefixed with its source-doc title. The
 * ranked list alone answers "what was retrieved"; this answers "what did the AI
 * actually read", which is the question an owner debugging a bad answer has.
 *
 * Null when nothing clears the threshold — production would have spoken its
 * fallback line, and there is no context to show.
 */
async function composeProductionAnswer(
  deps: ExplainDeps,
  tenantId: string,
  candidates: ExplainedCandidate[]
): Promise<string | null> {
  const used = candidates.filter((c) => c.used_in_production);
  if (used.length === 0) return null;

  const usedIds = used.map((d) => d.tenant_doc_id).filter(Boolean);
  let titleById = new Map<string, string>();
  try {
    const titlesRes = await deps.withTenantClient(tenantId, (client) =>
      client.query<{ tenant_doc_id: string; title: string | null }>(
        // ::uuid[] cast — without it Postgres compares uuid against text[]
        // and errors (same fix as the policy-answer citation lookup).
        'SELECT tenant_doc_id, title FROM tenant_docs WHERE tenant_id = $1 AND tenant_doc_id = ANY($2::uuid[])',
        [tenantId, usedIds]
      )
    );
    titleById = new Map(
      titlesRes.rows.filter((r) => r.title).map((r) => [r.tenant_doc_id, r.title as string])
    );
  } catch {
    // title lookup is non-critical — fall back to un-attributed content
  }

  return used
    .map((d) => {
      const title = titleById.get(d.tenant_doc_id);
      return title ? `[From "${title}"]\n${d.content}` : d.content;
    })
    .join('\n\n---\n\n');
}
