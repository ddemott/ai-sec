import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Client } from 'pg';
import { Pool } from 'pg';
import { getRootClient, createTenant, skipIfDbDown } from '../utils';
import {
  computeUsageStatements,
  BILLABLE_MIN_SECONDS,
  PLAN_QUOTAS,
} from '../../src/services/billingUsage';

let client: Client;
let pool: Pool;
let tenantId: string;
let noPlanTenantId: string;
let dbAvailable = true;

async function insertSession(
  tid: string,
  opts: {
    status?: string;
    durationSeconds?: number | null;
    callerSpoke?: boolean;
    startedAt?: string;
  }
) {
  const transcript =
    opts.callerSpoke === false
      ? 'Assistant: Hi, thank you for calling!'
      : 'Assistant: Hi, thank you for calling!\nCaller: I would like to book a meeting.';
  await client.query(
    `INSERT INTO voice_sessions (tenant_id, call_id, status, started_at, duration_seconds, transcript)
     VALUES ($1, $2, $3, COALESCE($4::timestamptz, now()), $5, $6)`,
    [
      tid,
      `billing-usage-test-${Math.random().toString(36).slice(2)}`,
      opts.status ?? 'completed',
      opts.startedAt ?? null,
      opts.durationSeconds === undefined ? 120 : opts.durationSeconds,
      transcript,
    ]
  );
}

beforeAll(async () => {
  try {
    client = await getRootClient();
    pool = new Pool({
      connectionString:
        process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/test_db',
      max: 2,
    });
    tenantId = await createTenant(client, 'Billing Usage Test Tenant', 'salon');
    noPlanTenantId = await createTenant(client, 'Billing Usage No-Plan Tenant', 'salon');
    await client.query(`UPDATE tenants SET subscription_plan = 'solo' WHERE tenant_id = $1`, [tenantId]);
  } catch {
    dbAvailable = false;
  }
});

afterAll(async () => {
  if (!dbAvailable) return;
  for (const tid of [tenantId, noPlanTenantId]) {
    await client.query(`DELETE FROM voice_sessions WHERE tenant_id = $1`, [tid]);
    await client.query(`DELETE FROM tenants WHERE tenant_id = $1`, [tid]);
  }
  await pool.end();
  await client.end();
});

describe('billingUsage — the answered-call definition', () => {
  it('HAPPY: a completed call where the caller spoke for >= 15s bills; spam/silent/short/active calls are FREE', async (ctx) => {
    skipIfDbDown(ctx, () => dbAvailable);
    await insertSession(tenantId, {});
    await insertSession(tenantId, { callerSpoke: false });
    await insertSession(tenantId, { durationSeconds: BILLABLE_MIN_SECONDS - 1 });
    await insertSession(tenantId, { durationSeconds: null });
    await insertSession(tenantId, { status: 'active' });

    const res = await computeUsageStatements(pool, tenantId, 1);
    expect(res.plan).toBe('solo');
    expect(res.quota).toEqual(PLAN_QUOTAS.solo);
    expect(res.statements).toHaveLength(1);
    const m = res.statements[0];
    expect(m.totalCalls).toBe(5);
    expect(m.answeredCalls).toBe(1);
    expect(m.freeCalls).toBe(4);
    expect(m.inProgress).toBe(true);
    expect(m.overageCalls).toBe(0);
    expect(m.packsApplied).toBe(0);
    expect(m.packChargeUsd).toBe(0);
  });

  it('HAPPY: exactly BILLABLE_MIN_SECONDS bills (boundary is inclusive)', async (ctx) => {
    // WHO: an owner whose call hits the exact billable threshold.
    // WHAT: 15 seconds counts as billable; boundary is inclusive.
    // WHEN: duration_seconds === BILLABLE_MIN_SECONDS.
    // WHERE: computeUsageStatements() answered-call filter.
    // WHY: off-by-one here changes invoices.
    skipIfDbDown(ctx, () => dbAvailable);
    const before = await computeUsageStatements(pool, tenantId, 1);
    await insertSession(tenantId, { durationSeconds: BILLABLE_MIN_SECONDS });
    const after = await computeUsageStatements(pool, tenantId, 1);
    expect(after.statements[0].answeredCalls).toBe(before.statements[0].answeredCalls + 1);
  });

  it('SAD: a tenant with NO plan gets usage numbers but null quota/overage/charge', async (ctx) => {
    // WHO: a tenant without a recognized subscription plan.
    // WHAT: usage still computes, but quota/overage fields stay null.
    // WHEN: subscription_plan is NULL.
    // WHERE: computeUsageStatements() quota shaping.
    // WHY: informational usage must not invent billing policy.
    skipIfDbDown(ctx, () => dbAvailable);
    await insertSession(noPlanTenantId, {});
    const res = await computeUsageStatements(pool, noPlanTenantId, 1);
    expect(res.plan).toBeNull();
    expect(res.quota).toBeNull();
    const m = res.statements[0];
    expect(m.answeredCalls).toBe(1);
    expect(m.includedCalls).toBeNull();
    expect(m.overageCalls).toBeNull();
    expect(m.packsApplied).toBeNull();
    expect(m.packChargeUsd).toBeNull();
  });

  it('SAD: unknown tenant throws Tenant not found', async (ctx) => {
    // WHO: route caller asking for usage on a nonexistent tenant.
    // WHAT: service throws Tenant not found.
    // WHEN: tenant lookup returns zero rows.
    // WHERE: computeUsageStatements() tenant preflight.
    // WHY: route maps this to 404 instead of fake empty statements.
    skipIfDbDown(ctx, () => dbAvailable);
    await expect(
      computeUsageStatements(pool, '00000000-0000-4000-8000-00000000dead', 1)
    ).rejects.toThrow('Tenant not found');
  });
});


describe('billingUsage — pack math', () => {
  it('HAPPY: overage rounds UP to whole packs, priced at packPriceUsd each', async (ctx) => {
    // WHO: a solo-plan tenant who goes over quota.
    // WHAT: overage rounds up to whole packs at flat pack pricing.
    // WHEN: answeredCalls exceed includedCalls by 31.
    // WHERE: computeUsageStatements() pack math.
    // WHY: undercharging leaks revenue; overcharging torches trust.
    skipIfDbDown(ctx, () => dbAvailable);
    const packTenant = await createTenant(client, 'Billing Usage Pack Tenant', 'salon');
    try {
      await client.query(`UPDATE tenants SET subscription_plan = 'solo' WHERE tenant_id = $1`, [packTenant]);
      const lastMonth = new Date();
      lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
      lastMonth.setUTCDate(3);
      await client.query(
        `INSERT INTO voice_sessions (tenant_id, call_id, status, started_at, duration_seconds, transcript)
         SELECT $1, 'pack-test-' || g, 'completed', $2::timestamptz, 60,
                'Assistant: hello' || E'\n' || 'Caller: booking please'
           FROM generate_series(1, 181) g`,
        [packTenant, lastMonth.toISOString()]
      );

      const res = await computeUsageStatements(pool, packTenant, 3);
      const m = res.statements.find((s) => !s.inProgress && s.answeredCalls === 181);
      expect(m).toBeDefined();
      expect(m!.overageCalls).toBe(31);
      expect(m!.packsApplied).toBe(2);
      expect(m!.packChargeUsd).toBe(2 * PLAN_QUOTAS.solo.packPriceUsd);
      expect(m!.inProgress).toBe(false);
    } finally {
      await client.query(`DELETE FROM voice_sessions WHERE tenant_id = $1`, [packTenant]);
      await client.query(`DELETE FROM tenants WHERE tenant_id = $1`, [packTenant]);
    }
  });
});
