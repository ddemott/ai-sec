/**
 * Tests for src/services/knowledgeIngestion.ts.
 *
 * Coverage:
 *   - isAllowedExtension — happy + rejected types
 *   - extractFileContent — non-PDF decoding, blank text rejection
 *   - splitIntoChunks — happy, too-many chunks, filters short chunks
 *   - prepareQADocument — combined format, normalization used, fallback on throw
 */
import { describe, it, expect, vi } from 'vitest';
import {
  getFileExtension,
  isAllowedExtension,
  extractFileContent,
  splitIntoChunks,
  prepareQADocument,
  MAX_CHUNKS,
} from './knowledgeIngestion';

// ── getFileExtension ──────────────────────────────────────────────────────────

describe('getFileExtension', () => {
  it('returns lowercase extension including the dot', () => {
    expect(getFileExtension('policy.PDF')).toBe('.pdf');
    expect(getFileExtension('notes.TXT')).toBe('.txt');
    expect(getFileExtension('data.csv')).toBe('.csv');
  });
});

// ── isAllowedExtension ────────────────────────────────────────────────────────

describe('isAllowedExtension', () => {
  it('HAPPY: accepts all allowed types', () => {
    for (const ext of ['.txt', '.md', '.csv', '.json', '.pdf']) {
      expect(isAllowedExtension(ext)).toBe(true);
    }
  });

  it('SAD: rejects unknown extensions', () => {
    // WHO: operator uploading a Word doc or image
    // WHAT: guard rejects unknown extensions before any parsing
    // WHEN: upload with .docx, .xlsx, .png
    // WHERE: isAllowedExtension check in /knowledge/ingest handler
    // WHY: parsing non-text formats without validation would either crash
    //      or silently produce garbage embeddings
    expect(isAllowedExtension('.docx')).toBe(false);
    expect(isAllowedExtension('.xlsx')).toBe(false);
    expect(isAllowedExtension('.png')).toBe(false);
    expect(isAllowedExtension('')).toBe(false);
  });
});

// ── extractFileContent ────────────────────────────────────────────────────────

describe('extractFileContent', () => {
  it('HAPPY: decodes UTF-8 text buffer for non-PDF files', async () => {
    // WHO: operator uploading a plain-text knowledge document
    // WHAT: buffer decoded to string; returned as { success: true, text }
    // WHEN: .txt / .md / .csv / .json upload
    // WHERE: extractFileContent → buffer.toString('utf8') branch
    // WHY: pins that text files are decoded correctly, not treated as PDFs
    const buf = Buffer.from('Hello world. This is a test document.', 'utf8');
    const result = await extractFileContent(buf, 'doc.txt');
    expect(result.success).toBe(true);
    if (result.success) expect(result.text).toContain('Hello world');
  });

  it('SAD: returns error when decoded text is blank or too short', async () => {
    // WHO: operator uploading an empty file or a file with only whitespace
    // WHAT: text.trim().length < MIN_TEXT_LENGTH → error result
    // WHEN: buffer decodes to fewer than 10 meaningful characters
    // WHERE: length guard in extractFileContent
    // WHY: embedding an empty string produces a meaningless vector and
    //      wastes a DB row; the guard surfaces the problem before the insert
    const buf = Buffer.from('   \n  ', 'utf8');
    const result = await extractFileContent(buf, 'empty.txt');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('No readable text');
  });
});

// ── splitIntoChunks ───────────────────────────────────────────────────────────

describe('splitIntoChunks', () => {
  it('HAPPY: splits on double-newlines and filters short segments', () => {
    // WHO: ingestion pipeline processing a structured document
    // WHAT: text split on \n\n; segments shorter than MIN_CHUNK_LENGTH dropped
    // WHEN: well-formed document with paragraphs separated by blank lines
    // WHERE: splitIntoChunks filter predicate
    // WHY: very short fragments (headings, page numbers) add noise without
    //      semantic signal; filtering them keeps the vector space cleaner
    const text = [
      'This is the first meaningful paragraph with enough content to pass.',
      'Short',
      'This is the second meaningful paragraph that also has enough characters.',
    ].join('\n\n');

    const result = splitIntoChunks(text);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.chunks).toHaveLength(2); // 'Short' filtered out
      expect(result.chunks[0]).toContain('first meaningful');
    }
  });

  it('SAD: returns error when chunk count exceeds MAX_CHUNKS', () => {
    // WHO: operator uploading a very large document (e.g. entire operations manual)
    // WHAT: chunk count > MAX_CHUNKS → error with count in message
    // WHEN: text produces more paragraphs than the cap allows
    // WHERE: splitIntoChunks overflow guard
    // WHY: uncapped ingestion would produce thousands of DB rows and
    //      OpenAI embedding calls, blowing quota and storage limits
    const bigText = Array.from(
      { length: MAX_CHUNKS + 1 },
      (_, i) => `Paragraph ${i + 1} with enough content to pass the minimum length filter.`
    ).join('\n\n');

    const result = splitIntoChunks(bigText);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('too large');
      expect(result.chunkCount).toBeGreaterThan(MAX_CHUNKS);
    }
  });
});

// ── prepareQADocument ─────────────────────────────────────────────────────────

describe('prepareQADocument', () => {
  it('HAPPY: combines Q&A, normalizes, and embeds the raw question + normalized body', async () => {
    // WHO: operator adding a Q&A pair via the knowledge base form
    // WHAT: combined = "Q: {q}\nA: {a}"; normalizeForEmbedding called on it;
    //       getEmbedding called with "{rawQuestion}\n{normalizedBody}"
    // WHEN: /knowledge/add or PUT /knowledge/:id with valid body
    // WHERE: prepareQADocument in knowledgeIngestion.ts
    // WHY: pins the combined format AND that the raw question is prepended to
    //      the embedded text — the reductive normalize was dropping the
    //      interrogative form (the address↔located retrieval signal).
    const getEmbedding = vi.fn(async () => [0.1, 0.2, 0.3]);
    const normalize = vi.fn(async (text: string) => `normalized:${text}`);

    const result = await prepareQADocument(
      'What are your hours?',
      'Mon-Fri 8-6',
      getEmbedding,
      normalize
    );

    expect(result.combined).toBe('Q: What are your hours?\nA: Mon-Fri 8-6');
    expect(normalize).toHaveBeenCalledWith(result.combined, { context: 'knowledge base Q&A' });
    expect(result.normalizedText).toBe(`What are your hours?\nnormalized:${result.combined}`);
    expect(getEmbedding).toHaveBeenCalledWith(
      `What are your hours?\nnormalized:${result.combined}`
    );
    expect(result.embedding).toEqual([0.1, 0.2, 0.3]);
  });

  it('REGRESSION: raw question survives even when the normalizer would drop it', async () => {
    // WHO: a caller asking "what's your address" against a "Where are you
    //      located?" KB doc (the 2026-06-23 address vocabulary gap)
    // WHAT: even when normalize reduces the Q/A to a declarative answer that
    //       loses "Where", the embedded text still begins with the verbatim
    //       question — so the doc vector carries the interrogative signal
    // WHEN: a location Q/A is ingested
    // WHERE: prepareQADocument prepend step
    // WHY: dropping the question form starved the address case to cosine
    //      ~0.302 (knife-edge of the 0.30 threshold, run-to-run flaky)
    const getEmbedding = vi.fn(async () => [0.9]);
    // Simulate the real reductive normalizer dropping the interrogative form.
    const normalize = vi.fn(async () => 'We are located at 123 Main Street downtown.');

    const result = await prepareQADocument(
      'Where are you located?',
      'We are located at 123 Main Street in downtown.',
      getEmbedding,
      normalize
    );

    expect(result.normalizedText.startsWith('Where are you located?')).toBe(true);
    expect(result.normalizedText).toContain('123 Main Street');
    expect(getEmbedding).toHaveBeenCalledWith(result.normalizedText);
  });

  it('HAPPY: works without normalizeForEmbedding (embeds question + raw combined)', async () => {
    // WHO: deployment where normalization is not configured
    // WHAT: normalizedBody = combined; embedded text = question + combined
    // WHEN: normalizeForEmbedding is undefined
    // WHERE: prepareQADocument optional-normalization branch
    // WHY: the function must degrade gracefully — normalization is an
    //      enhancement, not a hard requirement — and still preserve the question
    const getEmbedding = vi.fn(async () => [0.5]);
    const result = await prepareQADocument(
      'Do you offer mobile service?',
      'Yes, we do.',
      getEmbedding
    );

    expect(result.normalizedText).toBe(`Do you offer mobile service?\n${result.combined}`);
    expect(getEmbedding).toHaveBeenCalledWith(result.normalizedText);
  });

  it('SAD: falls back to combined text when normalization throws (question still kept)', async () => {
    // WHO: operator adding an entry when the normalization service is down
    // WHAT: normalization throws → catch sets normalizedBody = combined →
    //       embedded text = question + combined; no error propagated
    // WHEN: normalizeForEmbedding raises an exception
    // WHERE: try/catch in prepareQADocument
    // WHY: a normalization outage must not block KB edits — degraded
    //      quality (unnormalized embedding) is better than a 500
    const getEmbedding = vi.fn(async () => [0.7]);
    const normalize = vi.fn(async () => {
      throw new Error('normalization service unavailable');
    });

    const result = await prepareQADocument(
      'Test question',
      'Test answer long enough.',
      getEmbedding,
      normalize
    );

    expect(result.normalizedText).toBe(`Test question\n${result.combined}`);
    expect(getEmbedding).toHaveBeenCalledWith(result.normalizedText);
  });
});
