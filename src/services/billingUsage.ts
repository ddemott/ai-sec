/**
 * Usage metering + monthly billing statements, computed from voice_sessions.
 *
 * Billing model: answered call only. A call bills when it completed, the caller
 * actually spoke, and it lasted at least BILLABLE_MIN_SECONDS. Silent rooms,
 * instant hang-ups, spam, and still-active calls are free. Overage is flat
 * call packs, never per-minute surprise billing and never service cutoff.
 */
import type { Pool } from 'pg';

export const BILLABLE_MIN_SECONDS = 15;
const CALLER_LINE_RE = '(?:^|\\n)Caller(?: \\[\\d+:\\d{2}\\])?: ';

export interface PlanQuota {
  includedCalls: number;
  packCalls: number;
  packPriceUsd: number;
}

export const PLAN_QUOTAS: Record<string, PlanQuota> = {
  solo: { includedCalls: 150, packCalls: 30, packPriceUsd: 25 },
  growth: { includedCalls: 500, packCalls: 30, packPriceUsd: 25 },
};

export interface MonthlyStatement {
  month: string;
  totalCalls: number;
  answeredCalls: number;
  freeCalls: number;
  includedCalls: number | null;
  overageCalls: number | null;
  packsApplied: number | null;
  packChargeUsd: number | null;
  inProgress: boolean;
}

export interface UsageStatementResult {
  plan: string | null;
  quota: PlanQuota | null;
  billableMinSeconds: number;
  monthBoundaries: 'utc';
  statements: MonthlyStatement[];
}

export async function computeUsageStatements(
  pool: Pool,
  tenantId: string,
  monthsBack: number
): Promise<UsageStatementResult> {
  const months = Math.min(Math.max(monthsBack, 1), 24);

  const tenantRes = await pool.query<{ subscription_plan: string | null }>(
    'SELECT subscription_plan FROM tenants WHERE tenant_id = $1',
    [tenantId]
  );
  if (tenantRes.rows.length === 0) throw new Error('Tenant not found');

  const plan = tenantRes.rows[0].subscription_plan;
  const quota = plan ? (PLAN_QUOTAS[plan] ?? null) : null;

  const usage = await pool.query<{ month: string; total: number; answered: number }>(
    `SELECT to_char(date_trunc('month', started_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (
              WHERE status = 'completed'
                AND COALESCE(duration_seconds, 0) >= $3
                AND transcript ~ $4
            )::int AS answered
       FROM voice_sessions
      WHERE tenant_id = $1
        AND started_at >= date_trunc('month', now() AT TIME ZONE 'UTC') - ($2 - 1) * interval '1 month'
        AND (is_deleted IS NULL OR is_deleted = false)
      GROUP BY 1
      ORDER BY 1 DESC`,
    [tenantId, months, BILLABLE_MIN_SECONDS, CALLER_LINE_RE]
  );

  const currentMonth = new Date().toISOString().slice(0, 7);
  const statements: MonthlyStatement[] = usage.rows.map((row) => {
    const overageCalls = quota ? Math.max(0, row.answered - quota.includedCalls) : null;
    const packsApplied =
      quota && overageCalls !== null ? Math.ceil(overageCalls / quota.packCalls) : null;
    return {
      month: row.month,
      totalCalls: row.total,
      answeredCalls: row.answered,
      freeCalls: row.total - row.answered,
      includedCalls: quota ? quota.includedCalls : null,
      overageCalls,
      packsApplied,
      packChargeUsd: quota && packsApplied !== null ? packsApplied * quota.packPriceUsd : null,
      inProgress: row.month === currentMonth,
    };
  });

  return {
    plan,
    quota,
    billableMinSeconds: BILLABLE_MIN_SECONDS,
    monthBoundaries: 'utc',
    statements,
  };
}
