/**
 * T-011 — the AI cost ledger, end to end, against real Postgres.
 *
 * WHO  — a synthetic two-minute voice call, posted through the SAME route the
 *        agent posts through (`/agent-tools/record-ai-cost`).
 * WHAT — all FOUR cost legs of a call land as priced rows, and the per-call
 *        total sits in a sanity band rather than at a fixed value.
 * WHEN  — CI, on every change to pricing, the route, or the analytics rollup.
 * WHERE — src/services/aiCost.ts (pricing) → routes/agentTools/aiCost.ts
 *         (write) → services/analytics/aiCost.ts (read).
 * WHY  — this ledger once undercounted by ~35x. `gpt-4.1-mini` was missing from
 *        the pricing table, so the PRODUCTION VOICE LLM — 77-83% of a call's
 *        cost — recorded $0.00 on every row. Nothing failed. The ledger looked
 *        maintained and reported confidence in a number that was wrong, and
 *        tier pricing was going to be set from it.
 *
 * WHY A BAND, NOT A FIXED NUMBER: token counts vary per call and vendor rates
 * change. A fixed expectation would be edited to match reality every time it
 * broke, which trains everyone to ignore it. A band only fails when the number
 * stops being PLAUSIBLE — which is exactly the failure that happened (a real
 * call costing $0.002 instead of $0.06).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { type Client, Pool } from 'pg';
import { API_DB_URL, getRootClient, createTenant, skipIfDbDown } from '../utils';
import { createWithTenantClient } from '../../src/database';
import { registerAgentToolRoutes } from '../../src/routes/agentTools';
import { getAiCostBreakdown } from '../../src/services/analytics/aiCost';

const SECRET = 'test-agent-secret';

let setup: Client;
let pool: Pool;
let app: FastifyInstance;
let dbAvailable = false;
let tenantId: string;
const tenantsToClean: string[] = [];

/**
 * A ~2-minute call's usage, one entry per cost leg. Numbers are the shape a
 * real call produces: a voice LLM re-sent the growing context over ~12 turns
 * (input dominates), Aura synthesised the agent's spoken words, Deepgram
 * transcribed the caller's audio, and gpt-4o-mini wrote the post-call summary.
 */
const TWO_MINUTE_CALL = [
  {
    type: 'llm_usage' as const,
    provider: 'openai',
    model: 'gpt-4.1-mini',
    inputTokens: 120_000,
    outputTokens: 2_400,
    charactersCount: 0,
    audioDurationMs: 0,
  },
  {
    type: 'tts_usage' as const,
    provider: 'deepgram',
    model: 'aura-asteria-en',
    inputTokens: 0,
    outputTokens: 0,
    charactersCount: 2_600,
    audioDurationMs: 0,
  },
  {
    type: 'stt_usage' as const,
    provider: 'Deepgram',
    model: 'nova-3',
    inputTokens: 0,
    outputTokens: 0,
    charactersCount: 0,
    audioDurationMs: 120_000,
  },
  {
    type: 'llm_usage' as const,
    provider: 'openai',
    model: 'gpt-4o-mini',
    inputTokens: 3_200,
    outputTokens: 180,
    charactersCount: 0,
    audioDurationMs: 0,
  },
];

async function postUsage(callId: string, usage: unknown[] = TWO_MINUTE_CALL) {
  return app.inject({
    method: 'POST',
    url: '/agent-tools/record-ai-cost',
    headers: { 'x-agent-secret': SECRET },
    payload: { tenant_id: tenantId, call_id: callId, source: 'voice_call', model_usage: usage },
  });
}

async function ledgerRows(callId: string) {
  const res = await setup.query<{ model: string; estimated_cost_usd: string }>(
    `SELECT model, estimated_cost_usd FROM ai_cost_events
      WHERE tenant_id = $1 AND call_id = $2 ORDER BY model`,
    [tenantId, callId]
  );
  return res.rows.map((r) => ({ model: r.model, cost: Number(r.estimated_cost_usd) }));
}

async function breakdown() {
  const withTenantClient = createWithTenantClient(pool);
  return withTenantClient(tenantId, (client) => getAiCostBreakdown(client, tenantId));
}

beforeAll(async () => {
  try {
    setup = await getRootClient();
    await setup.query('SELECT 1');
    pool = new Pool({ connectionString: API_DB_URL, max: 5 });
    tenantId = await createTenant(setup, 'Cost Ledger Co', 'auto-shop');
    tenantsToClean.push(tenantId);
    process.env.AGENT_SECRET = SECRET;
    app = Fastify({ logger: false });
    registerAgentToolRoutes(
      app,
      pool,
      createWithTenantClient(pool),
      async () => new Array(1536).fill(0)
    );
    dbAvailable = true;
  } catch (err) {
    console.warn('[aiCostLedger.realdb] DB not available, skipping', err);
  }
});

afterAll(async () => {
  delete process.env.AGENT_SECRET;
  if (app) await app.close();
  if (pool) await pool.end();
  if (setup) {
    for (const id of tenantsToClean) {
      await setup.query('DELETE FROM tenants WHERE tenant_id = $1', [id]).catch(() => {});
    }
    await setup.end();
  }
});

beforeEach(async (ctx) => {
  skipIfDbDown(ctx, () => dbAvailable);
  if (!dbAvailable) return;
  await setup.query('DELETE FROM ai_cost_events WHERE tenant_id = $1', [tenantId]);
});

describe('T-011: all four cost legs of a call are recorded AND priced', () => {
  it('HAPPY: voice LLM, TTS characters, STT audio and the summary LLM each land priced', async () => {
    const res = await postUsage('call-four-legs');
    expect(res.statusCode).toBe(200);

    const rows = await ledgerRows('call-four-legs');
    expect(rows.map((r) => r.model)).toEqual([
      'aura-asteria-en',
      'gpt-4.1-mini',
      'gpt-4o-mini',
      'nova-3',
    ]);
    // THE assertion the 35x undercount would have failed: every leg carries a
    // real price. A leg recorded at $0.00 is the exact shape of that bug.
    for (const row of rows) {
      expect(row.cost, `${row.model} recorded $0 — is it in the pricing table?`).toBeGreaterThan(0);
    }
  });

  it('HAPPY: the per-call total is PLAUSIBLE for a 2-minute call ($0.03–$0.20)', async () => {
    await postUsage('call-band');
    const { avg_cost_per_call_usd, call_count } = await breakdown();
    expect(call_count).toBe(1);
    expect(avg_cost_per_call_usd).not.toBeNull();
    expect(avg_cost_per_call_usd!).toBeGreaterThanOrEqual(0.03);
    expect(avg_cost_per_call_usd!).toBeLessThanOrEqual(0.2);
  });

  it('HAPPY: the voice LLM dominates the bill — the leg that was silently free', async () => {
    // Not decoration. The undercount was invisible precisely because the
    // remaining legs still produced a non-zero total that looked reasonable.
    await postUsage('call-shape');
    const rows = await ledgerRows('call-shape');
    const total = rows.reduce((s, r) => s + r.cost, 0);
    const voiceLlm = rows.find((r) => r.model === 'gpt-4.1-mini')!.cost;
    expect(voiceLlm / total).toBeGreaterThan(0.5);
  });
});

describe('T-011: the per-call average the pricing decision reads', () => {
  it('HAPPY: averages over DISTINCT calls, not over ledger rows', async () => {
    // Four rows per call. Divide by rows and the average is 4x too cheap — and
    // it would still look like a plausible number, which is how this class of
    // bug survives.
    await postUsage('call-a');
    await postUsage('call-b');
    const { call_count, avg_cost_per_call_usd, voice_call_cost_usd } = await breakdown();
    expect(call_count).toBe(2);
    expect(avg_cost_per_call_usd!).toBeCloseTo(voice_call_cost_usd / 2, 10);
    expect(avg_cost_per_call_usd!).toBeGreaterThanOrEqual(0.03);
  });

  it('SAD: non-call spend is excluded from the per-call numbers', async () => {
    // KB ingestion is real money and real month-to-date total, but it is not
    // per-call spend. Folding it in makes the per-call figure drift with
    // something no caller ever touched.
    await postUsage('call-only');
    await app.inject({
      method: 'POST',
      url: '/agent-tools/record-ai-cost',
      headers: { 'x-agent-secret': SECRET },
      payload: {
        tenant_id: tenantId,
        source: 'kb_ingestion',
        model_usage: [
          {
            type: 'llm_usage',
            provider: 'openai',
            model: 'text-embedding-3-small',
            inputTokens: 500_000,
            outputTokens: 0,
            charactersCount: 0,
            audioDurationMs: 0,
          },
        ],
      },
    });

    const { call_count, avg_cost_per_call_usd, voice_call_cost_usd, total_estimated_cost_usd } =
      await breakdown();
    expect(call_count).toBe(1);
    expect(avg_cost_per_call_usd!).toBeCloseTo(voice_call_cost_usd, 10);
    // The month-to-date total still includes it — that IS the bill.
    expect(total_estimated_cost_usd).toBeGreaterThan(voice_call_cost_usd);
  });

  it('SAD: a month with no costed call reports null, never $0.00', async () => {
    // "We have not measured one" and "our calls are free" are different claims.
    // Returning 0 here would let a tier be priced off an average that was never
    // computed.
    const { call_count, avg_cost_per_call_usd } = await breakdown();
    expect(call_count).toBe(0);
    expect(avg_cost_per_call_usd).toBeNull();
  });
});
