"use strict";
/**
 * Shared OpenAI embedding utility.
 * Used by both the Node backend (src/) and Deno Edge Functions (supabase/functions/).
 *
 * Usage:
 *   import { createGetEmbedding } from '../shared/getEmbedding';
 *   const getEmbedding = createGetEmbedding(process.env.OPENAI_API_KEY);
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createGetEmbedding = createGetEmbedding;
function createGetEmbedding(apiKey) {
    return async function getEmbedding(text) {
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY is not configured in environment');
        }
        const response = await fetch('https://api.openai.com/v1/embeddings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                input: text.replace(/\n/g, ' '),
                model: 'text-embedding-3-small',
            }),
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(`OpenAI Embedding Error: ${JSON.stringify(error)}`);
        }
        const result = (await response.json());
        return result.data[0].embedding;
    };
}
