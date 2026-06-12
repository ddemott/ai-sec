/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method, @typescript-eslint/no-explicit-any */
/**
 * ESLint rules disabled for this file to match the sibling RAG module
 * (normalizeForEmbedding.ts) — same dynamic/fetch-heavy shape.
 */

/**
 * RAG Query-Expansion Layer (the inverse of normalizeForEmbedding).
 *
 * normalizeForEmbedding REDUCES text to its semantic core — correct when
 * EMBEDDING A DOCUMENT (drop noise, keep facts). But applying the same
 * reduction to a short CALLER QUERY is actively harmful: it collapses
 * "what's your address" → "Address inquiry", which embeds at cosine ~0.21
 * against the KB doc "Located at 123 Main Street" — below any usable
 * threshold. Measured 2026-06-12 with text-embedding-3-small: under the
 * full normalize-query × normalize-doc pipeline the address case scored
 * LOWER (0.215) than a true out-of-scope question (hamburgers, 0.238), i.e.
 * unseparable by any threshold.
 *
 * EXPANSION does the opposite: it ADDS synonyms and related terms so a terse
 * query bridges a vocabulary gap to the document that answers it ("address"
 * → "address location where located directions situated"). Measured lift:
 *   "what's your address"            0.312 → 0.410
 *   "could you tell me your address?" 0.236 → 0.377
 * while true out-of-scope questions stay low (≤0.248) — a clean 0.128 gap.
 *
 * Used ONLY on the policy-answer query path (one LLM call, replacing the
 * reductive normalize call that previously sat there). The DOCUMENT side
 * (knowledge ingest) keeps normalizeForEmbedding — reduction is correct for
 * docs, and changing ingest would strand every already-embedded doc on a
 * stale vector. No re-embed required.
 *
 * Usage:
 *   import { createQueryExpander } from '../shared/expandQueryForEmbedding';
 *   const expandQuery = createQueryExpander(process.env.OPENAI_API_KEY);
 *   const expanded = await expandQuery("what's your address");
 */

export interface QueryExpanderOptions {
  /** Context hint for the LLM. Default: "customer phone inquiry". */
  context?: string;
}

const SYSTEM_PROMPT = `You expand a customer's phone question into a search query for a service business knowledge base (tire shops, salons, auto shops, trades, fitness, food & beverage).

Output the core topic plus 4-8 synonyms and closely related terms a business document might use to answer it. The goal is to bridge vocabulary gaps — e.g. a caller asking for an "address" should reach a document that says "located".

Rules:
- Output ONLY a single line of space-separated terms — no punctuation, no numbering, no explanation
- Preserve the original key words from the question
- Add only synonyms / closely related terms — do NOT invent specific facts, names, prices, or hours
- Keep it to a short phrase, not a sentence`;

const FETCH_TIMEOUT_MS = 15_000;

export function createQueryExpander(apiKey: string) {
  return async function expandQueryForEmbedding(
    text: string,
    options?: QueryExpanderOptions
  ): Promise<string> {
    const trimmed = text.trim();
    // Unlike normalization, there is no length floor: expansion helps SHORT
    // queries the most (they carry the least signal). Only an empty string or
    // a missing key short-circuits to the raw text.
    if (!trimmed || !apiKey) {
      return trimmed;
    }

    const contextHint = options?.context || 'customer phone inquiry';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: `Context: ${contextHint}\n\nExpand this question:\n${trimmed}`,
            },
          ],
          max_tokens: 120,
          temperature: 0,
        }),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      // Network error / timeout: fall back to the raw query rather than fail
      // the call. The raw query still retrieves most topics; only the hardest
      // vocabulary-gap case (address) degrades.
      clearTimeout(timeout);
      if (err instanceof Error && err.name === 'AbortError') {
        return trimmed;
      }
      return trimmed;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      // LLM error: fall back to raw query (don't throw — this is a live call).
      return trimmed;
    }

    let expanded: string | undefined;
    try {
      const result = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      expanded = result.choices[0]?.message?.content?.trim();
    } catch {
      // Malformed body (HTML error page, truncated JSON) on a 200 response —
      // still fall back to the raw query rather than throw on the live path.
      return trimmed;
    }
    if (!expanded) {
      return trimmed;
    }

    // Return the expansion verbatim — the prompt already preserves the
    // original key words, so the expanded line carries the query's signal
    // PLUS the synonym bridge. Re-prepending the full raw conversational
    // query was measured to HURT: it re-injects filler ("could you tell me")
    // that dilutes the topical signal — "what's your address" fell 0.410 →
    // 0.328, "could you tell me your address?" 0.377 → 0.287. Expansion-alone
    // keeps the clean 0.128 hit/out-of-scope gap.
    return expanded;
  };
}
