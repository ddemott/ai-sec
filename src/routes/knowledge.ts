
import type { Pool, PoolClient } from 'pg';
import pdfParse from 'pdf-parse';
import { z } from 'zod';
import { withHandler, logEvent, requireTenantId, type AppRequest } from '../middleware';

const knowledgeEntrySchema = z.object({
  question: z.string().min(1, 'question is required'),
  answer: z.string().min(10, 'answer must be at least 10 characters'),
  category: z.string().optional(),
  source: z.string().optional().default('policy-questionnaire'),
});

export function registerKnowledgeRoutes(
  app: any,
  _pool: Pool,
  getEmbedding: (text: string) => Promise<number[]>,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>,
  normalizeForEmbedding?: (text: string, options?: { context?: string }) => Promise<string>
) {
  app.get('/knowledge', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const res = await withTenantClient(tenantId, async (client) => {
      return client.query(
        'SELECT id, title, content, source, created_at FROM tenant_docs WHERE tenant_id = $1 ORDER BY created_at DESC',
        [tenantId]
      );
    });
    return reply.send(res.rows);
  }, 'Failed to fetch knowledge base'));

  app.delete('/knowledge/:id', withHandler(async (req: AppRequest, reply) => {
    const { id } = req.params as { id: string };
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    await withTenantClient(tenantId, async (client) => {
      await client.query('DELETE FROM tenant_docs WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    });

    logEvent(req, 'knowledge_entry_deleted', { entryId: id });
    return reply.send({ success: true });
  }, 'Failed to delete entry'));

  app.post('/knowledge/ingest', withHandler(async (req: AppRequest, reply) => {
    const data = await req.file();
    if (!data) return reply.status(400).send({ success: false, error: 'No file uploaded' });

    const tenantId = (data.fields.tenant_id as any)?.value;
    if (!tenantId) return reply.status(400).send({ success: false, error: 'tenant_id is required' });

    const buffer = await data.toBuffer();
    const filename = data.filename;
    let text = '';

    if (filename.toLowerCase().endsWith('.pdf')) {
      const pdfData = await (pdfParse as any)(buffer);
      text = pdfData.text;
    } else {
      text = buffer.toString('utf8');
    }

    if (!text || text.trim().length < 10) {
      return reply.status(400).send({ success: false, error: 'No readable text found in file' });
    }

    const chunks = text.split('\n\n').filter(c => c.trim().length > 20);

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
  }, 'Failed to ingest knowledge'));

  app.post('/knowledge/add', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const parsed = knowledgeEntrySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Validation failed', details: parsed.error.issues });
    }

    const { question, answer, category, source } = parsed.data;
    const combined = `Q: ${question}\nA: ${answer}`;

    let normalizedText = combined;
    if (normalizeForEmbedding) {
      try {
        normalizedText = await normalizeForEmbedding(combined, { context: 'knowledge base Q&A' });
      } catch {
        normalizedText = combined;
      }
    }

    const embedding = await getEmbedding(normalizedText);

    const res = await withTenantClient(tenantId, async (client) => {
      return client.query(
        'INSERT INTO tenant_docs (tenant_id, title, section, content, source, normalized_text, embedding) VALUES ($1, $2, $3, $4, $5, $6, $7::vector) RETURNING id',
        [tenantId, question, category || null, combined, source, normalizedText, JSON.stringify(embedding)]
      );
    });

    logEvent(req, 'knowledge_entry_added', { id: res.rows[0].id, source });
    return reply.send({ success: true, id: res.rows[0].id });
  }, 'Failed to add knowledge entry'));

  app.put('/knowledge/:id', withHandler(async (req: AppRequest, reply) => {
    const { id } = req.params as { id: string };
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const parsed = knowledgeEntrySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Validation failed', details: parsed.error.issues });
    }

    const { question, answer, category, source } = parsed.data;
    const combined = `Q: ${question}\nA: ${answer}`;

    let normalizedText = combined;
    if (normalizeForEmbedding) {
      try {
        normalizedText = await normalizeForEmbedding(combined, { context: 'knowledge base Q&A' });
      } catch {
        normalizedText = combined;
      }
    }

    const embedding = await getEmbedding(normalizedText);

    await withTenantClient(tenantId, async (client) => {
      await client.query(
        'UPDATE tenant_docs SET title = $1, section = $2, content = $3, source = $4, normalized_text = $5, embedding = $6::vector WHERE id = $7 AND tenant_id = $8',
        [question, category || null, combined, source, normalizedText, JSON.stringify(embedding), id, tenantId]
      );
    });

    logEvent(req, 'knowledge_entry_updated', { id, source });
    return reply.send({ success: true });
  }, 'Failed to update knowledge entry'));
}
