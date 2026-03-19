/**
 * RAG Normalization Layer.
 * Reduces conversational text to its semantic core before embedding,
 * so vector search matches across phrasings.
 *
 * Examples:
 *   "I think Suzy is great at oil changes" → "Customer prefers Suzy for oil changes"
 *   "Do you guys do brakes?" → "Inquiry about brake service availability"
 *   "Yeah so last time Bobby fixed my transmission and it was perfect" →
 *     "Bobby performed transmission repair. Customer satisfied."
 *
 * Used by both the Node backend (src/) and Deno Edge Functions (supabase/functions/).
 *
 * Usage:
 *   import { createNormalizer } from '../shared/normalizeForEmbedding';
 *   const normalize = createNormalizer(process.env.OPENAI_API_KEY);
 *   const normalized = await normalize("I think Suzy is great");
 */
export interface NormalizerOptions {
    /** Max tokens for the normalized output. Default: 200 */
    maxTokens?: number;
    /** Context hint for the LLM (e.g. "call summary", "knowledge base document"). Default: "business document" */
    context?: string;
}
export declare function createNormalizer(apiKey: string): (text: string, options?: NormalizerOptions) => Promise<string>;
