/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method, @typescript-eslint/no-explicit-any */
/**
 * ESLint rules disabled for this file as part of historical full cleanup (REFACTORING_TODO item 10; see RESOLVED.md for details).
 * These are the remaining dynamic/any-heavy areas after previous tranches.
 */

import type { AppFastifyInstance } from '../types/fastify';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { withHandler, logEvent, requireTenantId, type AppRequest } from '../middleware';
import { assertRowAffected, requireValidUUID } from './routeHelpers';
import {
  getFileExtension,
  isAllowedExtension,
  extractFileContent,
  splitIntoChunks,
  prepareQADocument,
  ALLOWED_EXTENSIONS,
} from '../services/knowledgeIngestion';
import { resolveQuestions } from '../../shared/questionBank';
import { recordAiCostEvent } from '../services/aiCost';
import { scanRateLimiter } from '../services/scanRateLimit';
import { SUPER_ADMIN_TENANT_ID } from '../constants';

// ── Website scrape helpers for onboarding (item 10) ─────────────────────

// Bound every outbound call in the scan path so a slow/hung site page or a slow
// OpenAI response can't hold a request (and a pool slot) open indefinitely —
// same AbortController discipline the rest of the codebase uses on OpenAI calls.
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAndExtractSiteText(
  startUrl: string
): Promise<{ success: true; text: string } | { success: false; error: string }> {
  try {
    const origin = new URL(startUrl).origin;
    const visited = new Set<string>();
    const pages: string[] = [];
    const queue = [startUrl];
    const maxPages = 6;
    const maxLenPerPage = 8000;

    while (queue.length && pages.length < maxPages) {
      const u = queue.shift()!;
      if (visited.has(u)) continue;
      visited.add(u);
      try {
        const resp = await fetchWithTimeout(
          u,
          {
            headers: { 'User-Agent': 'SecretaryHQ-Bot/1.0' },
            redirect: 'follow',
          },
          8000
        );
        if (!resp.ok) continue;
        const html = await resp.text();
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, maxLenPerPage);
        if (text.length > 200) pages.push(text);
        const links = Array.from(html.matchAll(/href=["']([^"']+)["']/gi)).map((m) => m[1]);
        for (const l of links) {
          try {
            const abs = new URL(l, origin).toString();
            if (
              abs.startsWith(origin) &&
              !visited.has(abs) &&
              /about|faq|service|contact|polic|price|home|index/i.test(abs)
            ) {
              queue.push(abs);
            }
          } catch {
            // skip malformed href
          }
        }
      } catch {
        // skip unreachable page
      }
    }
    if (pages.length === 0)
      return {
        success: false,
        error: 'Could not extract readable text from the site (may be JS-heavy or protected).',
      };
    return { success: true, text: pages.join('\n\n---PAGE---\n\n') };
  } catch (e: any) {
    return { success: false, error: 'Invalid or unreachable URL: ' + (e.message || e) };
  }
}

async function extractAnswersWithLLM(
  siteText: string,
  questions: Array<{ id: string | null; question: string }>,
  baseUrl: string,
  apiKey: string
): Promise<
  | {
      success: true;
      answers: Array<{
        questionId: string | null;
        question: string;
        answer: string | null;
        sourceUrl: string;
        confidence: number;
      }>;
      discovered: Array<any>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    }
  | { success: false; error: string }
> {
  if (!apiKey) return { success: false, error: 'OPENAI_API_KEY not configured' };

  const qList = questions
    .map((q, i) => `${i + 1}. ${q.id ? `[${q.id}] ` : ''}${q.question}`)
    .join('\n');

  const prompt = `You are a precise business policy extractor. 
Given the cleaned text from a small business website below, answer ONLY the listed questions with direct or closely paraphrased info from the text. 
If a question is not addressed on the site, return null for answer.
Also extract any other policy-like topics not in the list as "discovered".
Output STRICT JSON only:
{
  "answers": [ { "questionId": "id or null for discovered", "question": "the question text", "answer": "string or null", "sourceUrl": "best matching page url or the input url", "confidence": 0.0-1.0 } ],
  "discovered": [ { "question": "new topic question", "answer": "...", "sourceUrl": "...", "confidence": 0.0-1.0 } ]
}
Site text (truncated if long):
${siteText.slice(0, 12000)}

Questions:
${qList}

Return only the JSON.`;

  try {
    const resp = await fetchWithTimeout(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 3000,
          response_format: { type: 'json_object' },
        }),
      },
      30000
    );
    // Surface OpenAI failures (401 bad key, 429 rate limit, 5xx) as an error
    // instead of silently parsing the error body to {} and returning an empty
    // "successful" extraction — which would look like "scanned, found nothing".
    if (!resp.ok) {
      return { success: false, error: `OpenAI extract failed: HTTP ${resp.status}` };
    }
    const data: any = await resp.json();
    const content = data.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(content);
    const answers = (parsed.answers || []).map((a: any) => ({
      questionId: a.questionId || null,
      question: a.question,
      answer: a.answer || null,
      sourceUrl: a.sourceUrl || baseUrl,
      confidence: typeof a.confidence === 'number' ? a.confidence : 0.5,
    }));
    const discovered = (parsed.discovered || []).map((d: any) => ({
      question: d.question,
      answer: d.answer,
      sourceUrl: d.sourceUrl || '',
      confidence: d.confidence || 0.5,
    }));
    return { success: true, answers, discovered, usage: data.usage };
  } catch (e: any) {
    return { success: false, error: 'LLM extract failed: ' + (e.message || e) };
  }
}

const knowledgeEntrySchema = z.object({
  question: z.string().min(1, 'question is required'),
  answer: z.string().min(10, 'answer must be at least 10 characters'),
  category: z.string().optional(),
  source: z.string().optional().default('policy-questionnaire'),
});

const websiteImportSchema = z.object({
  url: z.string().url('valid URL required'),
});

const explainSchema = z.object({
  question: z.string().min(1, 'question is required').max(1000),
});

export function registerKnowledgeRoutes(
  app: AppFastifyInstance,
  _pool: Pool,
  getEmbedding: (text: string) => Promise<number[]>,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>,
  normalizeForEmbedding?: (text: string, options?: { context?: string }) => Promise<string>
) {
  app.get(
    '/knowledge',
    withHandler(async (req: AppRequest, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      const res = await withTenantClient(tenantId, async (client) => {
        return client.query(
          'SELECT tenant_doc_id, title, content, source, created_at FROM tenant_docs WHERE tenant_id = $1 ORDER BY created_at DESC',
          [tenantId]
        );
      });
      return reply.send(res.rows);
    }, 'Failed to fetch knowledge base')
  );

  app.delete(
    '/knowledge/:id',
    withHandler(async (req: AppRequest, reply) => {
      const { id } = req.params as { id: string };
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      const res = await withTenantClient(tenantId, async (client) => {
        return client.query(
          'DELETE FROM tenant_docs WHERE tenant_doc_id = $1 AND tenant_id = $2 RETURNING tenant_doc_id',
          [id, tenantId]
        );
      });
      if (!assertRowAffected(res, reply, 'Knowledge entry')) return;

      logEvent(req, 'knowledge_entry_deleted', { entryId: id });
      return reply.send({ success: true });
    }, 'Failed to delete entry')
  );

  app.post(
    '/knowledge/ingest',
    withHandler(async (req: AppRequest, reply) => {
      const data = await req.file();
      if (!data) return reply.status(400).send({ success: false, error: 'No file uploaded' });

      // Fastify multipart: text fields arrive on `data.fields[key]` shaped
      // as `{ value: string, type: 'field' }` (file fields have `type: 'file'`).
      // Naming the optional `value` slot is narrower than bare `any` while
      // still accepting the union shape the parser produces.
      const tenantId = (data.fields.tenant_id as { value?: string } | undefined)?.value;
      if (!tenantId)
        return reply.status(400).send({ success: false, error: 'tenant_id is required' });

      const filename = data.filename;
      const ext = getFileExtension(filename);
      if (!isAllowedExtension(ext)) {
        return reply.status(400).send({
          success: false,
          error: `Unsupported file type "${ext}". Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`,
        });
      }

      const buffer = await data.toBuffer();
      const extracted = await extractFileContent(buffer, filename);
      if (!extracted.success) {
        return reply.status(400).send({ success: false, error: extracted.error });
      }

      const chunked = splitIntoChunks(extracted.text);
      if (!chunked.success) {
        return reply.status(400).send({ success: false, error: chunked.error });
      }
      const chunks = chunked.chunks;

      await withTenantClient(tenantId, async (client) => {
        for (const chunk of chunks) {
          const trimmedChunk = chunk.trim();
          // Normalize text to semantic core before embedding (Phase 12E)
          const normalizedText = normalizeForEmbedding
            ? await normalizeForEmbedding(trimmedChunk, { context: 'knowledge base document' })
            : trimmedChunk;
          const embedding = await getEmbedding(normalizedText);
          // ~4 chars/token heuristic; embedding billed per input token (price mirrors aiCost PRICING).
          const embTokens = Math.ceil(normalizedText.length / 4);
          const embCost = embTokens * 0.02e-6;
          // Cost telemetry is best-effort: a ledger write failure (missing table
          // in dev/test, transient DB error) must NOT abort document ingestion.
          try {
            await recordAiCostEvent(client, {
              tenantId,
              source: 'kb_ingestion',
              provider: 'openai',
              model: 'text-embedding-3-small',
              inputTokens: embTokens,
              estimatedCostUsd: embCost,
            });
          } catch {
            /* swallow — ingestion continues */
          }
          await client.query(
            'INSERT INTO tenant_docs (tenant_id, content, normalized_text, source, embedding) VALUES ($1, $2, $3, $4, $5::vector)',
            [tenantId, trimmedChunk, normalizedText, filename, JSON.stringify(embedding)]
          );
        }
      });

      logEvent(req, 'knowledge_ingested', { filename, chunksIngested: chunks.length });
      return reply.send({ success: true, chunksIngested: chunks.length });
    }, 'Failed to ingest knowledge')
  );

  app.post(
    '/knowledge/add',
    withHandler(async (req: AppRequest, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      const parsed = knowledgeEntrySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ success: false, error: 'Validation failed', details: parsed.error.issues });
      }

      const { question, answer, category, source } = parsed.data;
      const { combined, normalizedText, embedding } = await prepareQADocument(
        question,
        answer,
        getEmbedding,
        normalizeForEmbedding
      );

      // ~4 chars/token heuristic; embedding billed per input token (price mirrors aiCost PRICING).
      const embTokens = Math.ceil(normalizedText.length / 4);
      const embCost = embTokens * 0.02e-6;
      withTenantClient(tenantId, (client) =>
        recordAiCostEvent(client, {
          tenantId,
          source: source === 'website-scan' ? 'kb_ingestion' : 'policy-questionnaire',
          provider: 'openai',
          model: 'text-embedding-3-small',
          inputTokens: embTokens,
          estimatedCostUsd: embCost,
        })
      ).catch(() => undefined);

      const res = await withTenantClient(tenantId, async (client) => {
        return client.query(
          'INSERT INTO tenant_docs (tenant_id, title, section, content, source, normalized_text, embedding) VALUES ($1, $2, $3, $4, $5, $6, $7::vector) RETURNING tenant_doc_id',
          [
            tenantId,
            question,
            category || null,
            combined,
            source,
            normalizedText,
            JSON.stringify(embedding),
          ]
        );
      });

      logEvent(req, 'knowledge_entry_added', { tenant_doc_id: res.rows[0].tenant_doc_id, source });
      return reply.send({ success: true, tenant_doc_id: res.rows[0].tenant_doc_id });
    }, 'Failed to add knowledge entry')
  );

  app.put(
    '/knowledge/:id',
    withHandler(async (req: AppRequest, reply) => {
      const { id } = req.params as { id: string };
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      const parsed = knowledgeEntrySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ success: false, error: 'Validation failed', details: parsed.error.issues });
      }

      const { question, answer, category, source } = parsed.data;
      const { combined, normalizedText, embedding } = await prepareQADocument(
        question,
        answer,
        getEmbedding,
        normalizeForEmbedding
      );

      // ~4 chars/token heuristic; embedding billed per input token (price mirrors aiCost PRICING).
      const embTokens = Math.ceil(normalizedText.length / 4);
      const embCost = embTokens * 0.02e-6;
      withTenantClient(tenantId, (client) =>
        recordAiCostEvent(client, {
          tenantId,
          source: source === 'website-scan' ? 'kb_ingestion' : 'policy-questionnaire',
          provider: 'openai',
          model: 'text-embedding-3-small',
          inputTokens: embTokens,
          estimatedCostUsd: embCost,
        })
      ).catch(() => undefined);

      const res = await withTenantClient(tenantId, async (client) => {
        return client.query(
          'UPDATE tenant_docs SET title = $1, section = $2, content = $3, source = $4, normalized_text = $5, embedding = $6::vector WHERE tenant_doc_id = $7 AND tenant_id = $8 RETURNING tenant_doc_id',
          [
            question,
            category || null,
            combined,
            source,
            normalizedText,
            JSON.stringify(embedding),
            id,
            tenantId,
          ]
        );
      });
      if (!assertRowAffected(res, reply, 'Knowledge entry')) return;

      logEvent(req, 'knowledge_entry_updated', { id, source });
      return reply.send({ success: true });
    }, 'Failed to update knowledge entry')
  );

  // -----------------------------------------------------------------------
  // Unanswered Questions (KB gap tracking)
  // -----------------------------------------------------------------------

  /** GET /knowledge/unanswered — list unanswered questions for the tenant */
  app.get(
    '/knowledge/unanswered',
    withHandler(async (req: AppRequest, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      const res = await withTenantClient(tenantId, async (client) => {
        return client.query(
          `SELECT unanswered_question_id, question, caller_phone, call_id, caller_message, owner_notified, resolved, created_at
         FROM unanswered_questions
         WHERE tenant_id = $1 AND resolved = false
         ORDER BY created_at DESC
         LIMIT 100`,
          [tenantId]
        );
      });

      return reply.send({ success: true, questions: res.rows });
    }, 'Failed to fetch unanswered questions')
  );

  /** PATCH /knowledge/unanswered/:id/resolve — mark a question as resolved */
  app.patch(
    '/knowledge/unanswered/:id/resolve',
    withHandler(async (req: AppRequest, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;
      const { id } = req.params as { id: string };

      const res = await withTenantClient(tenantId, async (client) => {
        return client.query(
          `UPDATE unanswered_questions SET resolved = true WHERE unanswered_question_id = $1 AND tenant_id = $2 RETURNING unanswered_question_id`,
          [id, tenantId]
        );
      });
      if (!assertRowAffected(res, reply, 'Unanswered question')) return;

      logEvent(req, 'unanswered_question_resolved', { questionId: id });
      return reply.send({ success: true });
    }, 'Failed to resolve unanswered question')
  );

  // POST /knowledge/import-website — website scan + LLM extract (item 10)
  app.post(
    '/knowledge/import-website',
    withHandler(async (req: AppRequest, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      const parsed = websiteImportSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ success: false, error: 'Invalid URL', details: parsed.error.issues });
      }
      const { url } = parsed.data;

      // Per-tenant guardrail on the expensive scan (external multi-page fetch +
      // OpenAI extraction). Rejects with 429 once the tenant's bucket is dry so
      // one tenant can't burn OpenAI budget or hammer external sites through us.
      // Skipped in the E2E stub path (deterministic, zero external cost).
      if (process.env.KNOWLEDGE_IMPORT_E2E_STUB !== '1' && !scanRateLimiter.tryAcquire(tenantId)) {
        logEvent(req, 'website_scan_rate_limited', { tenantId });
        return reply.status(429).send({
          success: false,
          error: 'Website scan limit reached. Please wait a bit before scanning again.',
        });
      }

      // Resolve the questions to extract: the shared static policy bank plus this
      // tenant's owner-authored custom questions (tenant_docs source='custom-question'),
      // so the scan also targets what this owner specifically cares about.
      // Bounded: cap how many custom questions feed the extract prompt so a tenant
      // with a huge custom-question list can't blow up prompt size / OpenAI cost.
      const customRows = await withTenantClient(tenantId, async (client) =>
        client.query(
          `SELECT title FROM tenant_docs
           WHERE tenant_id = $1 AND source = 'custom-question' AND title IS NOT NULL
           ORDER BY created_at DESC
           LIMIT 50`,
          [tenantId]
        )
      );
      const customs = customRows.rows.map((r: any) => r.title as string);
      const questions = resolveQuestions({ customs });

      // KNOWLEDGE_IMPORT_E2E_STUB: strict opt-in (literal "1") that swaps the real
      // site fetch + OpenAI extraction for deterministic canned output, so E2E can
      // exercise the REAL resolver → staging-INSERT path against a real DB without
      // a live OpenAI key or external network (CI runs with OPENAI_API_KEY=sk-dummy).
      // Same env-gated test-hook discipline as SYNC_TEST_RECORDER. Off by default.
      let extract: { answers: any[]; discovered: any[] };
      if (process.env.KNOWLEDGE_IMPORT_E2E_STUB === '1') {
        // Confirm every resolved custom question (id null) + the first two bank
        // questions, plus one discovered topic — lets a test assert customs flow
        // through the resolver into staging.
        const picks = [
          ...questions.filter((q) => q.id === null),
          ...questions.filter((q) => q.id !== null).slice(0, 2),
        ];
        extract = {
          answers: picks.map((q) => ({
            questionId: q.id,
            question: q.question,
            answer: `Stubbed answer for: ${q.question}`,
            sourceUrl: url,
            confidence: 0.9,
          })),
          discovered: [
            {
              question: 'Stubbed discovered topic?',
              answer: 'Stubbed discovered answer.',
              sourceUrl: url,
              confidence: 0.5,
            },
          ],
        };
      } else {
        const siteText = await fetchAndExtractSiteText(url);
        if (!siteText.success) {
          return reply.status(400).send({ success: false, error: siteText.error });
        }
        const llm = await extractAnswersWithLLM(
          siteText.text,
          questions,
          url,
          process.env.OPENAI_API_KEY || ''
        );
        if (!llm.success) {
          return reply.status(500).send({ success: false, error: llm.error });
        }
        extract = { answers: llm.answers, discovered: llm.discovered };
        if (llm.usage && tenantId) {
          const input = llm.usage.prompt_tokens || 0;
          const output = llm.usage.completion_tokens || 0;
          const cost = input * 0.15e-6 + output * 0.6e-6;
          withTenantClient(tenantId, (client) =>
            recordAiCostEvent(client, {
              tenantId,
              source: 'kb_ingestion',
              provider: 'openai',
              model: 'gpt-4o-mini',
              inputTokens: input,
              outputTokens: output,
              estimatedCostUsd: cost,
            })
          ).catch(() => undefined);
        }
      }

      // Persist extracted (matched) + discovered items to knowledge_suggestion for review.
      // extractAnswersWithLLM returns camelCase (questionId, sourceUrl) — map to snake_case here.
      // Skip matched items with null answers — they carry no KB value and inflate the count.
      // Matched items (questionId set) are pre-confirmed; discovered items start as 'suggested'.
      const confirmedItems = extract.answers
        .filter((a: any) => a.answer != null && (a.answer as string).trim().length > 0)
        .map((a: any) => ({
          question_id: a.questionId || null,
          question: a.question || '',
          answer: a.answer as string,
          source_url: a.sourceUrl || url,
          confidence: a.confidence ?? null,
          status: 'confirmed' as const,
        }));
      const suggestedItems = (extract.discovered || []).map((d: any) => ({
        question_id: null,
        question: d.question || '',
        answer: d.answer || '',
        source_url: d.sourceUrl || url,
        confidence: d.confidence ?? null,
        status: 'suggested' as const,
      }));
      const allItems = [...confirmedItems, ...suggestedItems];

      if (allItems.length > 0) {
        await withTenantClient(tenantId, async (client) => {
          for (const item of allItems) {
            await client.query(
              `INSERT INTO knowledge_suggestion
                 (tenant_id, question_id, question, answer, source_url, confidence, status)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                tenantId,
                item.question_id,
                item.question,
                item.answer,
                item.source_url,
                item.confidence,
                item.status,
              ]
            );
          }
        });
      }

      const confirmed = confirmedItems.length;
      const suggestions = suggestedItems.length;

      logEvent(req, 'website_knowledge_import', { url, confirmed, suggestions, tenantId });
      return reply.send({
        success: true,
        extracted: extract.answers,
        discovered: extract.discovered,
        confirmed,
        suggestions,
      });
    }, 'Failed to import from website')
  );

  // ── Knowledge Suggestions (website-scan staging) ──────────────────────

  /** GET /knowledge/suggestions — list pending suggestions for review */
  app.get(
    '/knowledge/suggestions',
    withHandler(async (req: AppRequest, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      const res = await withTenantClient(tenantId, async (client) => {
        return client.query(
          `SELECT id, question_id, question, answer, source_url, confidence, status, created_at
           FROM knowledge_suggestion
           WHERE tenant_id = $1 AND status = 'suggested'
           ORDER BY created_at DESC
           LIMIT 100`,
          [tenantId]
        );
      });

      return reply.send({ success: true, suggestions: res.rows });
    }, 'Failed to fetch knowledge suggestions')
  );

  /** PATCH /knowledge/suggestions/:id — approve (→ ingest) or reject */
  app.patch(
    '/knowledge/suggestions/:id',
    withHandler(async (req: AppRequest, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;
      const { id } = req.params as { id: string };
      if (!requireValidUUID(id, reply, 'Suggestion ID')) return;

      const parsed = z.object({ status: z.enum(['confirmed', 'rejected']) }).safeParse(req.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ success: false, error: 'status must be confirmed or rejected' });
      }
      const { status } = parsed.data;

      // Fetch the suggestion first (RLS-scoped, status guard prevents double-review)
      const fetchRes = await withTenantClient(tenantId, async (client) => {
        return client.query(
          `SELECT question, answer FROM knowledge_suggestion
           WHERE id = $1 AND tenant_id = $2 AND status = 'suggested'`,
          [id, tenantId]
        );
      });
      if (fetchRes.rows.length === 0) {
        return reply
          .status(404)
          .send({ success: false, error: 'Suggestion not found or already reviewed' });
      }

      const { question, answer } = fetchRes.rows[0] as { question: string; answer: string };

      if (status === 'confirmed') {
        // Ingest into live KB (same path as knowledge.add).
        // Both writes are in one withTenantClient call with an explicit transaction so
        // a partial failure can't leave a doc ingested but the suggestion still 'suggested'.
        const { combined, normalizedText, embedding } = await prepareQADocument(
          question,
          answer,
          getEmbedding,
          normalizeForEmbedding
        );

        // ~4 chars/token heuristic; embedding billed per input token (price mirrors aiCost PRICING).
        const embTokens = Math.ceil(normalizedText.length / 4);
        const embCost = embTokens * 0.02e-6;
        withTenantClient(tenantId, (client) =>
          recordAiCostEvent(client, {
            tenantId,
            source: 'kb_ingestion',
            provider: 'openai',
            model: 'text-embedding-3-small',
            inputTokens: embTokens,
            estimatedCostUsd: embCost,
          })
        ).catch(() => undefined);

        await withTenantClient(tenantId, async (client) => {
          await client.query('BEGIN');
          await client.query(
            `INSERT INTO tenant_docs (tenant_id, title, content, source, normalized_text, embedding)
             VALUES ($1, $2, $3, $4, $5, $6::vector)`,
            [
              tenantId,
              question,
              combined,
              'website-scan',
              normalizedText,
              JSON.stringify(embedding),
            ]
          );
          // Guard status='suggested' so a concurrent or retried approve can't re-confirm
          await client.query(
            `UPDATE knowledge_suggestion SET status = 'confirmed', updated_at = now()
             WHERE id = $1 AND tenant_id = $2 AND status = 'suggested'`,
            [id, tenantId]
          );
          await client.query('COMMIT');
        });
        logEvent(req, 'knowledge_suggestion_approved', { suggestionId: id, tenantId });
      } else {
        await withTenantClient(tenantId, async (client) => {
          await client.query(
            `UPDATE knowledge_suggestion SET status = 'rejected', updated_at = now()
             WHERE id = $1 AND tenant_id = $2 AND status = 'suggested'`,
            [id, tenantId]
          );
        });
        logEvent(req, 'knowledge_suggestion_rejected', { suggestionId: id, tenantId });
      }

      return reply.send({ success: true });
    }, 'Failed to update knowledge suggestion')
  );

  // POST /knowledge/explain — "explain this answer" RAG debugger.
  // Runs the SAME retrieval the voice agent uses (search_tenant_docs_normalized
  // over this tenant's KB embeddings) for a given question, and returns the
  // ranked chunks + similarity scores so an owner can SEE why the AI answered a
  // certain way: which chunks matched, how strongly, and which would have been
  // fed to the model in production (top-N above the threshold).
  app.post(
    '/knowledge/explain',
    withHandler(async (req: AppRequest, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      // Owner-only: this is an admin/debug surface over the whole KB.
      if (req.auth && req.auth.tenant_id !== SUPER_ADMIN_TENANT_ID && req.auth.role !== 'owner') {
        return reply
          .status(403)
          .send({ success: false, error: 'Only owners can use the answer debugger' });
      }

      const parsed = explainSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ success: false, error: 'Validation failed', details: parsed.error.issues });
      }
      const { question } = parsed.data;

      // Production retrieval params (kept in sync with /agent-tools/policy-answer).
      const PROD_THRESHOLD = 0.5;
      const PROD_MATCH_COUNT = 3;
      // Debug retrieval: pull a wider, lower-threshold candidate set so the
      // owner can see near-misses too, then annotate each against prod params.
      const DEBUG_THRESHOLD = 0.0;
      const DEBUG_MATCH_COUNT = 10;

      // Embed the question EXACTLY as /agent-tools/policy-answer does — normalize
      // first (same context string), fall back to the raw question on failure —
      // otherwise the debug similarity scores wouldn't match the ones that drove
      // the real answer, and the debugger would mislead.
      let queryText = question;
      if (normalizeForEmbedding) {
        try {
          queryText = await normalizeForEmbedding(question, { context: 'customer phone inquiry' });
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
      const ranked = matches.rows.map((row, i) => {
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

      // Compose the EXACT context the agent would receive from
      // /agent-tools/policy-answer (the used chunks joined, each prefixed with
      // its source-doc title) so the owner sees the real answer the AI gets —
      // not just the ranked chunks. Null when nothing clears the threshold.
      const usedDocs = ranked.filter((r) => r.used_in_production);
      let composedAnswer: string | null = null;
      if (usedDocs.length > 0) {
        const usedIds = usedDocs.map((d) => d.tenant_doc_id).filter(Boolean);
        let titleById = new Map<string, string>();
        try {
          const titlesRes = await withTenantClient(tenantId, (client) =>
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
        composedAnswer = usedDocs
          .map((d) => {
            const title = titleById.get(d.tenant_doc_id);
            return title ? `[From "${title}"]\n${d.content}` : d.content;
          })
          .join('\n\n---\n\n');
      }

      logEvent(req, 'knowledge_answer_explained', {
        tenantId,
        candidates: ranked.length,
        usedInProduction: usedSoFar,
      });

      return reply.send({
        success: true,
        question,
        production_threshold: PROD_THRESHOLD,
        production_match_count: PROD_MATCH_COUNT,
        candidates: ranked,
        // A quick read: did production have anything to answer with at all?
        would_answer: usedSoFar > 0,
        // The exact context string the agent would relay for this question.
        composed_answer: composedAnswer,
      });
    }, 'Failed to explain answer')
  );
}
