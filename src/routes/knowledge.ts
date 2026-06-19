/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method, @typescript-eslint/no-explicit-any */
/**
 * ESLint rules disabled for this file as part of full cleanup (REFACTORING_TODO.md item 10).
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

// ── Website scrape helpers for onboarding (item 10) ─────────────────────

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
        const resp = await fetch(u, {
          headers: { 'User-Agent': 'SecretaryHQ-Bot/1.0' },
          redirect: 'follow',
        });
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
        questionId: string;
        question: string;
        answer: string | null;
        sourceUrl: string;
        confidence: number;
      }>;
      discovered: Array<any>;
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
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 3000,
        response_format: { type: 'json_object' },
      }),
    });
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
    return { success: true, answers, discovered };
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

      // Resolve the questions to extract: the shared static policy bank plus this
      // tenant's owner-authored custom questions (tenant_docs source='custom-question'),
      // so the scan also targets what this owner specifically cares about.
      const customRows = await withTenantClient(tenantId, async (client) =>
        client.query(
          `SELECT title FROM tenant_docs
           WHERE tenant_id = $1 AND source = 'custom-question' AND title IS NOT NULL`,
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
}
