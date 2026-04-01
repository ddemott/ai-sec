"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNormalizer = createNormalizer;
const SYSTEM_PROMPT = `You are a text normalizer for a semantic search system used by service businesses (tire shops, salons, auto shops, etc.).

Your job: reduce the input text to its semantic core — factual, searchable statements. Remove filler words, conversational noise, opinions (unless they express a preference), and redundancy.

Rules:
- Output ONLY the normalized text, nothing else
- Use third person and declarative statements
- Preserve names, services, dates, times, phone numbers, and specific details
- Convert preferences and opinions to factual preference statements
- Convert questions to topic statements
- Keep it concise — shorter is better as long as no facts are lost
- If the input is already concise and factual, return it unchanged
- Do NOT add information that isn't in the input`;
const FETCH_TIMEOUT_MS = 15000;
function createNormalizer(apiKey) {
    return async function normalizeForEmbedding(text, options) {
        const trimmed = text.trim();
        if (!trimmed || trimmed.length < 20) {
            // Too short to benefit from normalization
            return trimmed;
        }
        if (!apiKey) {
            // Fallback: return trimmed text if no API key (e.g., in tests)
            return trimmed;
        }
        const contextHint = options?.context || 'business document';
        const maxTokens = options?.maxTokens || 200;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        let response;
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
                            content: `Context: ${contextHint}\n\nNormalize this text:\n${trimmed}`,
                        },
                    ],
                    max_tokens: maxTokens,
                    temperature: 0,
                }),
                signal: controller.signal,
            });
        }
        catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
                throw new Error(`Normalization request timed out after ${FETCH_TIMEOUT_MS}ms`);
            }
            throw err;
        }
        finally {
            clearTimeout(timeout);
        }
        if (!response.ok) {
            const error = await response.json();
            throw new Error(`Normalization LLM Error: ${JSON.stringify(error)}`);
        }
        const result = (await response.json());
        const normalized = result.choices[0]?.message?.content?.trim();
        if (!normalized) {
            // Fallback to original if LLM returns empty
            return trimmed;
        }
        return normalized;
    };
}
