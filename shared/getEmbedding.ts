/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method, @typescript-eslint/no-explicit-any */
/**
 * ESLint rules disabled for this file as part of historical full cleanup (REFACTORING_TODO item 10; see RESOLVED.md for details).
 * These are the remaining dynamic/any-heavy areas after previous tranches.
 */

/**
 * Shared OpenAI embedding utility.
 * Used by both the Node backend (src/) and Deno Edge Functions (supabase/functions/).
 *
 * Usage:
 *   import { createGetEmbedding } from '../shared/getEmbedding';
 *   const getEmbedding = createGetEmbedding(process.env.OPENAI_API_KEY);
 */

const FETCH_TIMEOUT_MS = 10_000;

// Dimension of text-embedding-3-small
const EMBEDDING_DIM = 1536;

export function createGetEmbedding(apiKey: string) {
  return async function getEmbedding(text: string): Promise<number[]> {
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not configured in environment');
    }

    // CI / unit-test guard: sk-dummy signals "no real key available".
    // Return a zero vector so DB inserts succeed and CRUD tests pass;
    // RAG accuracy tests (simulate.sh rag) use a real key and run on-demand.
    if (apiKey === 'sk-dummy' || apiKey.startsWith('sk-dummy-')) {
      return new Array(EMBEDDING_DIM).fill(0) as number[];
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          input: text.replace(/\n/g, ' '),
          model: 'text-embedding-3-small',
        }),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`OpenAI Embedding request timed out after ${FETCH_TIMEOUT_MS}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`OpenAI Embedding Error: ${JSON.stringify(error)}`);
    }

    const result = (await response.json()) as { data: Array<{ embedding: number[] }> };
    return result.data[0].embedding;
  };
}
