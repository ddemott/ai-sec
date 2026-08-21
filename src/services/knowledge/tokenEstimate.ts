/**
 * The house token estimate, and the reason no module here carries a price.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT CONTAIN: a per-token price. Three modules
 * under services/knowledge each declared their own `EMBEDDING_USD_PER_TOKEN =
 * 0.02e-6` (or the gpt-4o-mini pair) beneath a comment reading "Mirrors aiCost
 * PRICING". That comment is a promise a future editor has to keep, and this
 * codebase has now watched that exact promise fail twice in one file — the RAG
 * threshold drifted 0.5 vs 0.30 under the same wording.
 *
 * It is also unnecessary. `recordAiCostEvent` already costs a row from the
 * authoritative PRICING table whenever `estimatedCostUsd` is omitted, so a call
 * site that passes a hand-multiplied number is not adding precision — it is
 * opting OUT of the one table that gets updated when a model's price changes,
 * and it looks more careful while doing it. The call sites now pass token counts
 * and let the ledger price them.
 */

/**
 * Tokens in a piece of text, by the house ~4-chars-per-token heuristic.
 *
 * An estimate, and knowingly so: the alternative is shipping a tokenizer to bill
 * a fraction of a cent. It runs uniformly across every embedding call site, so
 * the ledger is consistent with itself even where it is not exact.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
