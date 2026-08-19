/**
 * Real-DB companion for POST /agent-tools/record-ai-cost.
 *
 * Motivation (docs/TEST_DB_AUDIT.md): the handler builds a **dynamic multi-row
 * INSERT** — `VALUES ${placeholders.join(', ')}` with a flat params array — the
 * same placeholder-assembly class as the reminder double-seed bug. If the
 * per-row placeholder count and the params array ever drift, every insert
 * mis-binds or 500s, and a mock never runs the SQL. This suite posts a
 * multi-item model_usage payload and reads the stored ai_cost_events rows back.
 *
 * 5W for sad-path failures:
 *   WHO  — the agent worker reporting a call's model usage at shutdown
 *   WHAT — POST /agent-tools/record-ai-cost {model_usage: [...]}
 *   WHEN — end of every voice call
 *   WHERE — agentTools.ts multi-row INSERT INTO ai_cost_events
 *   WHY  — a mis-bound multi-row INSERT drops cost data (billing/usage blind)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { type Client, Pool } from 'pg';
import { API_DB_URL, getRootClient, createTenant, skipIfDbDown } from '../utils';
import { createWithTenantClient } from '../../src/database';
import { registerAgentToolRoutes } from '../../src/routes/agentTools';

const AGENT_SECRET = 'test-aicost-secret';
const stubEmbedding = (): Promise<number[]> => Promise.resolve(new Array(1536).fill(0));
const stubNormalizer = async (text: string): Promise<string> => text;

let setup: Client;
let pool: Pool;
let app: FastifyInstance;
let dbAvailable = false;
let tenantId: string;
let prevAgentSecret: string | undefined;
const tenantsToClean: string[] = [];

beforeAll(async () => {
  try {
    setup = await getRootClient();
    await setup.query('SELECT 1');
    pool = new Pool({ connectionString: API_DB_URL, max: 5 });
    prevAgentSecret = process.env.AGENT_SECRET;
    process.env.AGENT_SECRET = AGENT_SECRET;

    app = Fastify({ logger: false });
    const withTenantClient = createWithTenantClient(pool);
    registerAgentToolRoutes(app, pool, withTenantClient, stubEmbedding, stubNormalizer);
    await app.ready();

    tenantId = await createTenant(setup, 'AiCost Realdb Tenant', 'salon');
    tenantsToClean.push(tenantId);
    dbAvailable = true;
  } catch (err) {
     
    console.warn('[agentToolsAiCost.realdb.test] DB not available, skipping', err);
  }
});

afterAll(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
  if (setup) {
    for (const id of tenantsToClean) {
      await setup.query('DELETE FROM tenants WHERE tenant_id = $1', [id]).catch(() => {});
    }
    await setup.end();
  }
  if (prevAgentSecret === undefined) delete process.env.AGENT_SECRET;
  else process.env.AGENT_SECRET = prevAgentSecret;
});

beforeEach((ctx) => {
  skipIfDbDown(ctx, () => dbAvailable);
});

describe('record-ai-cost → real ai_cost_events rows (dynamic multi-row INSERT)', () => {
  it('HAPPY: a 2-item model_usage payload lands as 2 rows with computed cost', async () => {
    // WHY: two rows exercise the placeholder-join across multiple VALUES tuples
    // — the exact assembly a single-row mock never stresses.
    const callId = 'aicost-call-1';
    const res = await app.inject({
      method: 'POST',
      url: '/agent-tools/record-ai-cost',
      headers: { 'x-agent-secret': AGENT_SECRET },
      payload: {
        tenant_id: tenantId,
        call_id: callId,
        source: 'voice_call',
        model_usage: [
          {
            type: 'llm_usage',
            provider: 'openai',
            model: 'gpt-4o-mini',
            inputTokens: 1000,
            outputTokens: 500,
          },
          {
            type: 'tts_usage',
            provider: 'openai',
            model: 'gpt-4o-mini-tts',
            charactersCount: 1200,
            audioDurationMs: 8000,
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);

    const rows = await setup.query(
      `SELECT model, input_tokens, output_tokens, characters_count, estimated_cost_usd
         FROM ai_cost_events WHERE tenant_id = $1 AND call_id = $2 ORDER BY model`,
      [tenantId, callId]
    );
    expect(rows.rows).toHaveLength(2);
    const llm = rows.rows.find((r) => r.model === 'gpt-4o-mini');
    expect(llm.input_tokens).toBe(1000);
    expect(llm.output_tokens).toBe(500);
    // gpt-4o-mini has known rates → cost > 0 (1000*0.15e-6 + 500*0.6e-6).
    expect(Number(llm.estimated_cost_usd)).toBeGreaterThan(0);
    const tts = rows.rows.find((r) => r.model === 'gpt-4o-mini-tts');
    expect(tts.characters_count).toBe(1200);
  });

  it('HAPPY: interruption_usage items are filtered out (not stored)', async () => {
    // The handler drops type='interruption_usage' before building the INSERT.
    const callId = 'aicost-call-2';
    const res = await app.inject({
      method: 'POST',
      url: '/agent-tools/record-ai-cost',
      headers: { 'x-agent-secret': AGENT_SECRET },
      payload: {
        tenant_id: tenantId,
        call_id: callId,
        source: 'voice_call',
        model_usage: [
          {
            type: 'interruption_usage',
            provider: 'openai',
            model: 'x',
            inputTokens: 5,
            outputTokens: 5,
          },
          {
            type: 'stt_usage',
            provider: 'deepgram',
            model: 'nova-3',
            audioDurationMs: 4000,
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const rows = await setup.query(
      `SELECT model FROM ai_cost_events WHERE tenant_id = $1 AND call_id = $2`,
      [tenantId, callId]
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].model).toBe('nova-3');
  });
});
