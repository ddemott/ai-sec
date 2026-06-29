/**
 * Knowledge document ingestion — content processing layer.
 *
 * Extracted from src/routes/knowledge.ts so file extraction, chunk
 * splitting, and Q&A normalization are testable without HTTP overhead.
 *
 * The route layer keeps: multipart field parsing, tenant resolution,
 * withTenantClient DB loop, logEvent calls.
 */

import pdfParse from 'pdf-parse';

// ── Constants ─────────────────────────────────────────────────────────────────

export const ALLOWED_EXTENSIONS = ['.txt', '.md', '.csv', '.json', '.pdf'] as const;
export const MAX_CHUNKS = 500;
export const MIN_TEXT_LENGTH = 10;
export const MIN_CHUNK_LENGTH = 20;

// ── File type validation ──────────────────────────────────────────────────────

export function getFileExtension(filename: string): string {
  return filename.toLowerCase().slice(filename.lastIndexOf('.'));
}

export function isAllowedExtension(ext: string): boolean {
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(ext);
}

// ── File content extraction ───────────────────────────────────────────────────

export type ExtractResult = { success: true; text: string } | { success: false; error: string };

/**
 * Extract plain text from an uploaded file buffer.
 * PDF files are parsed via pdf-parse; all other types are decoded as UTF-8.
 */
export async function extractFileContent(buffer: Buffer, filename: string): Promise<ExtractResult> {
  let text = '';

  if (filename.toLowerCase().endsWith('.pdf')) {
    // pdf-parse's installed types declare the import as a namespace but
    // at runtime the default-imported value is callable.
    const pdfFn = pdfParse as unknown as (buf: Buffer) => Promise<{ text: string }>;
    const pdfData = await pdfFn(buffer);
    text = pdfData.text;
  } else {
    text = buffer.toString('utf8');
  }

  if (!text || text.trim().length < MIN_TEXT_LENGTH) {
    return { success: false, error: 'No readable text found in file' };
  }

  return { success: true, text };
}

// ── Chunk splitting ───────────────────────────────────────────────────────────

export type ChunkResult =
  | { success: true; chunks: string[] }
  | { success: false; error: string; chunkCount: number };

/**
 * Split document text into chunks on double-newlines, filtering blanks.
 * Returns an error result when the chunk count exceeds maxChunks.
 */
export function splitIntoChunks(text: string, maxChunks: number = MAX_CHUNKS): ChunkResult {
  const chunks = text.split('\n\n').filter((c) => c.trim().length > MIN_CHUNK_LENGTH);
  if (chunks.length > maxChunks) {
    return {
      success: false,
      error: `File too large — produced ${chunks.length} chunks (max ${maxChunks}). Please split into smaller files.`,
      chunkCount: chunks.length,
    };
  }
  return { success: true, chunks };
}

// ── Q&A document preparation ──────────────────────────────────────────────────

export interface QADocument {
  combined: string;
  normalizedText: string;
  embedding: number[];
}

/**
 * Combine a Q&A pair, optionally normalize it, and generate an embedding.
 * On a normalization throw the body falls back to the raw combined text (the
 * raw question is still prepended either way — see below).
 *
 * The embedded text is the RAW question prepended to the normalized body. The
 * reductive `normalizeForEmbedding` was collapsing a Q/A pair like
 * "Q: Where are you located? A: We are located at 123 Main St" down to a
 * declarative "Located at 123 Main Street downtown." — dropping the
 * interrogative form ("Where"), which is exactly the retrieval signal a caller
 * asking "what's your address" needs to bridge the address↔located vocabulary
 * gap. Keeping the verbatim question in the embedded vector keeps the doc
 * reachable across paraphrases. (See docs/TODO.md "RAG address gap".)
 * `normalizedText` is set to the embedded text so /knowledge/explain reflects
 * what was actually vectorized.
 */
export async function prepareQADocument(
  question: string,
  answer: string,
  getEmbedding: (text: string) => Promise<number[]>,
  normalizeForEmbedding?: (text: string, options?: { context?: string }) => Promise<string>
): Promise<QADocument> {
  const combined = `Q: ${question}\nA: ${answer}`;

  let normalizedBody = combined;
  if (normalizeForEmbedding) {
    try {
      normalizedBody = await normalizeForEmbedding(combined, { context: 'knowledge base Q&A' });
    } catch {
      normalizedBody = combined;
    }
  }

  // Prepend the raw question so its interrogative form survives normalization.
  const normalizedText = `${question}\n${normalizedBody}`;
  const embedding = await getEmbedding(normalizedText);
  return { combined, normalizedText, embedding };
}
