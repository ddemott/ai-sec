
import type { Pool, PoolClient } from 'pg';
import pdfParse from 'pdf-parse';

export function registerKnowledgeRoutes(
  app: any,
  pool: Pool,
  getEmbedding: (text: string) => Promise<number[]>,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  app.get('/knowledge', async (req, reply) => {
    const tenantId = (req.query as any).tenant_id;
    if (!tenantId) return reply.status(400).send({ error: 'tenant_id is required' });

    try {
      const res = await withTenantClient(tenantId, async (client) => {
        return client.query(
          'SELECT id, title, content, source, created_at FROM tenant_docs WHERE tenant_id = $1 ORDER BY created_at DESC',
          [tenantId]
        );
      });
      return reply.send(res.rows);
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to fetch knowledge base' });
    }
  });

  app.delete('/knowledge/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const tenantId = (req.query as any).tenant_id;
    if (!tenantId) return reply.status(400).send({ error: 'tenant_id is required' });

    try {
      await withTenantClient(tenantId, async (client) => {
        await client.query('DELETE FROM tenant_docs WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
      });
      return reply.send({ success: true });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to delete entry' });
    }
  });

  app.post('/knowledge/ingest', async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.status(400).send({ error: 'No file uploaded' });

    const tenantId = (data.fields.tenant_id as any)?.value;
    if (!tenantId) return reply.status(400).send({ error: 'tenant_id is required' });

    const buffer = await data.toBuffer();
    const filename = data.filename;
    let text = '';

    try {
      if (filename.toLowerCase().endsWith('.pdf')) {
        const pdfData = await (pdfParse as any)(buffer);
        text = pdfData.text;
      } else {
        text = buffer.toString('utf8');
      }

      if (!text || text.trim().length < 10) {
        return reply.status(400).send({ error: 'No readable text found in file' });
      }

      const chunks = text.split('\n\n').filter(c => c.trim().length > 20);

      await withTenantClient(tenantId, async (client) => {
        for (const chunk of chunks) {
          const trimmedChunk = chunk.trim();
          const embedding = await getEmbedding(trimmedChunk);
          await client.query(
            'INSERT INTO tenant_docs (tenant_id, content, source, embedding) VALUES ($1, $2, $3, $4::vector)',
            [tenantId, trimmedChunk, filename, JSON.stringify(embedding)]
          );
        }
      });
      return reply.send({ success: true, chunksIngested: chunks.length });
    } catch (err: any) {
      app.log.error(err);
      return reply.status(500).send({ error: `Ingestion failed: ${err.message}` });
    }
  });
}
