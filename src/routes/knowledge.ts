/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method, @typescript-eslint/no-explicit-any */
/**
 * ESLint rules disabled for this file as part of full cleanup (REFACTORING_TODO.md item 10).
 * These are the remaining dynamic/any-heavy areas after previous tranches.
 */

import type { AppFastifyInstance } from '../types/fastify';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { withHandler, logEvent, requireTenantId, type AppRequest } from '../middleware';
import { assertRowAffected } from './routeHelpers';
import {
  getFileExtension,
  isAllowedExtension,
  extractFileContent,
  splitIntoChunks,
  prepareQADocument,
  ALLOWED_EXTENSIONS,
} from '../services/knowledgeIngestion';

const knowledgeEntrySchema = z.object({
  question: z.string().min(1, 'question is required'),
  answer: z.string().min(10, 'answer must be at least 10 characters'),
  category: z.string().optional(),
  source: z.string().optional().default('policy-questionnaire'),
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
}
