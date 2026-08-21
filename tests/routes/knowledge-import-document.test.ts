/**
 * POST /knowledge/import-document — upload a PDF/txt/md info sheet.
 *
 * WHO: an owner in Solo setup uploading their FAQ / info sheet.
 * WHAT: the endpoint parses deterministic **Q:/**A: custom questions, stages them
 *       (+ standard answers) to knowledge_suggestion, reports malformed markers,
 *       rejects unsupported files, and refuses a cross-tenant multipart tenant_id.
 * WHEN: 2026-07-01 document-upload feature (mirrors the website-scan flow).
 * WHERE: /knowledge/import-document (src/routes/knowledge.ts), real Fastify app
 *        (multipart + JWT + RLS pool) against test_db.
 * WHY: gives owners a file path to prefill knowledge; the marker path must be
 *      deterministic (no OpenAI), so the suite runs with KNOWLEDGE_IMPORT_E2E_STUB=1.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { type Client, Pool } from 'pg';
import { API_DB_URL, getRootClient, createTenant, createUser, skipIfDbDown } from '../utils';
import {
  registerJwtAuthHook,
  tenantMiddleware,
  generateToken,
} from '../../src/middleware/fastify-middleware';
import { createWithTenantClient } from '../../src/database';
import { registerKnowledgeRoutes } from '../../src/routes/knowledge';

const stubEmbedding = (): Promise<number[]> => Promise.resolve(new Array(1536).fill(0));
const stubNormalizer = async (text: string): Promise<string> => text;

let setup: Client;
let pool: Pool;
let app: FastifyInstance;
let tenantId: string;
let ownerToken: string;
let dbAvailable = false;
const tenantsToClean: string[] = [];

beforeEach((ctx) => skipIfDbDown(ctx, () => dbAvailable));

beforeAll(async () => {
  process.env.KNOWLEDGE_IMPORT_E2E_STUB = '1';
  try {
    setup = await getRootClient();
    await setup.query('SELECT 1');
    pool = new Pool({ connectionString: API_DB_URL, max: 5 });

    app = Fastify({ logger: false });
    await app.register(multipart);
    registerJwtAuthHook(app, pool);
    tenantMiddleware(app);
    const withTenantClient = createWithTenantClient(pool);
    registerKnowledgeRoutes(app, pool, stubEmbedding, withTenantClient, stubNormalizer);
    await app.ready();

    tenantId = await createTenant(setup, 'DocImportTest', 'automotive');
    tenantsToClean.push(tenantId);
    const userId = await createUser(setup, tenantId, 'doc-owner@test.example', 'pw', 'Doc Owner');
    ownerToken = generateToken({
      tenant_id: tenantId,
      user_id: userId,
      email: 'doc-owner@test.example',
      role: 'owner',
    });

    dbAvailable = true;
  } catch (err) {
    console.warn('[knowledge-import-document.test] DB not available, skipping', err);
  }
});

afterAll(async () => {
  delete process.env.KNOWLEDGE_IMPORT_E2E_STUB;
  if (app) await app.close();
  if (pool) await pool.end();
  if (setup) {
    for (const id of tenantsToClean) {
      await setup.query('DELETE FROM tenants WHERE tenant_id = $1', [id]).catch(() => {});
    }
    await setup.end();
  }
});

beforeEach(async () => {
  if (!dbAvailable) return;
  await setup.query('DELETE FROM knowledge_suggestion WHERE tenant_id = $1', [tenantId]);
});

// Build a multipart/form-data body by hand — no `form-data` package dependency
// (it's only a transitive dep and doesn't resolve under a clean CI install).
function buildMultipart(
  fileBody: string,
  filename: string,
  fieldTenant: string
): { body: Buffer; contentType: string } {
  const boundary = '----vitestFormBoundaryDocImport';
  const parts =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="tenant_id"\r\n\r\n` +
    `${fieldTenant}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: text/markdown\r\n\r\n` +
    `${fileBody}\r\n` +
    `--${boundary}--\r\n`;
  return {
    body: Buffer.from(parts, 'utf8'),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function upload(fileBody: string, filename = 'faq.md', fieldTenant = tenantId) {
  const { body, contentType } = buildMultipart(fileBody, filename, fieldTenant);
  return app.inject({
    method: 'POST',
    url: '/knowledge/import-document',
    headers: { 'content-type': contentType, authorization: `Bearer ${ownerToken}` },
    payload: body,
  });
}

describe('POST /knowledge/import-document (real DB, stubbed AI)', () => {
  it('HAPPY: parses custom **Q:/**A: blocks and stages them (deterministic, no AI)', async () => {
    if (!dbAvailable) return;
    const res = await upload(
      'We are open Mon-Fri.\n\n**Q: Do you sell gift cards?\n**A: Yes, any amount.\n'
    );
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.custom_questions).toEqual([
      { question: 'Do you sell gift cards?', answer: 'Yes, any amount.' },
    ]);
    const staged = await setup.query(
      `SELECT question, source_url FROM knowledge_suggestion
       WHERE tenant_id = $1 AND source_url LIKE 'document:%'`,
      [tenantId]
    );
    expect(staged.rows.some((r: any) => r.question === 'Do you sell gift cards?')).toBe(true);
  });

  it('SAD: reports a **Q: with no **A: as malformed', async () => {
    if (!dbAvailable) return;
    const res = await upload('**Q: Orphan?\n\nsome prose', 'x.md');
    expect(res.statusCode).toBe(200);
    expect(res.json().malformed).toEqual(['Orphan?']);
  });

  it('SAD: rejects an unsupported file type', async () => {
    if (!dbAvailable) return;
    const res = await upload('irrelevant', 'malware.exe');
    expect(res.statusCode).toBe(400);
    expect(res.json().success).toBe(false);
  });

  it('SECURITY: rejects a multipart tenant_id that differs from the JWT tenant', async () => {
    // A caller with tenant A's JWT sets tenant_id=B in the (middleware-uninspected)
    // multipart body — must be blocked, not staged into B.
    if (!dbAvailable) return;
    const res = await upload('**Q: x?\n**A: y', 'faq.md', '00000000-0000-0000-0000-0000000000ff');
    expect(res.statusCode).toBe(403);
    expect(res.json().success).toBe(false);
  });
});

/**
 * The AI-cost recording branch on the LLM path (knowledge.ts ~751-778).
 *
 * WHY THIS IS WORTH ITS OWN SETUP. Every other case in this file runs with
 * KNOWLEDGE_IMPORT_E2E_STUB=1, which takes the deterministic branch and never
 * touches the cost ledger — so the code that writes `ai_cost_events` for a
 * knowledge import had no coverage at all.
 *
 * That ledger has been wrong before, and expensively: on 2026-08-13 the AI-cost
 * route was costing every call with a copy that knew only gpt-4o-mini, so the
 * production voice LLM and all TTS recorded $0.00 and the ledger reported
 * 2.8-4.3% of the real bill. A cost path with no test is a number nobody can
 * trust, and the failure is silent by construction — nothing errors, the total
 * is simply too small.
 */
describe('POST /knowledge/import-document — AI cost recording on the real LLM path', () => {
  const savedStub = process.env.KNOWLEDGE_IMPORT_E2E_STUB;
  const savedKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    // Leave the stub branch so extractAnswersWithLLM actually runs.
    delete process.env.KNOWLEDGE_IMPORT_E2E_STUB;
    process.env.OPENAI_API_KEY = 'test-key';
  });

  afterEach(() => {
    if (savedStub === undefined) delete process.env.KNOWLEDGE_IMPORT_E2E_STUB;
    else process.env.KNOWLEDGE_IMPORT_E2E_STUB = savedStub;
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedKey;
    vi.unstubAllGlobals();
  });

  it('HAPPY: an OpenAI reply carrying usage writes an ai_cost_events row', async () => {
    if (!dbAvailable) return;

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ answers: [] }) } }],
          // The field the cost branch depends on. Omit it — as every other test
          // in this file effectively does — and the branch never executes.
          usage: { prompt_tokens: 1000, completion_tokens: 500 },
        }),
      }))
    );

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const res = await upload('Our shop opens at nine and closes at five, Monday to Friday.');
    expect(res.statusCode).toBeLessThan(500);
    // Prove the LLM branch actually ran; otherwise an empty ledger below would
    // be a false negative rather than a real regression.
    expect(fetchMock).toHaveBeenCalled();

    // The cost write is deliberately fire-and-forget (`.catch(() => undefined)`)
    // so a telemetry failure can never break an import — which means the row
    // may land after the response. Poll briefly rather than race it; a fixed
    // sleep would be the wall-clock assertion this repo keeps getting bitten by.
    let costRows = { rows: [] as Record<string, unknown>[] };
    for (let i = 0; i < 50 && costRows.rows.length === 0; i++) {
      costRows = await setup.query(
        `SELECT source, provider, model, input_tokens, output_tokens, estimated_cost_usd
         FROM ai_cost_events
        WHERE tenant_id = $1 AND source = 'kb_ingestion'
        ORDER BY created_at DESC LIMIT 1`,
        [tenantId]
      );
      if (costRows.rows.length === 0) await new Promise((r) => setTimeout(r, 20));
    }

    expect(costRows.rows).toHaveLength(1);
    const row = costRows.rows[0];
    expect(row.provider).toBe('openai');
    expect(row.model).toBe('gpt-4o-mini');
    expect(Number(row.input_tokens)).toBe(1000);
    expect(Number(row.output_tokens)).toBe(500);
    // 1000 * 0.15e-6 + 500 * 0.6e-6 = 0.00045. Pinning the arithmetic, not just
    // that "a number was written" — a zero here is the exact shape of the
    // 2026-08-13 ledger bug.
    expect(Number(row.estimated_cost_usd)).toBeCloseTo(0.00045, 8);
  });
});
