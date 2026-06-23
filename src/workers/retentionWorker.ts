/**
 * Data-Retention Worker
 *
 * Periodically anonymizes dormant customers past a tenant's retention window
 * (see src/services/retention/retentionService.ts for the erasure shape).
 *
 * ⚠️ DISABLED BY DEFAULT. This performs automated, IRREVERSIBLE erasure of
 * customer PII, so — unlike the reminder scheduler — it does NOT auto-start in
 * production. It starts only when BOTH are set:
 *   ENABLE_RETENTION_WORKER=true
 *   RETENTION_DAYS=<positive integer>   (the retention window; no default — an
 *                                        unset/invalid value means the worker
 *                                        refuses to run, so it can never erase
 *                                        anything by accident)
 * Optional:
 *   RETENTION_INTERVAL_MS  (default 24h)
 *   RETENTION_BATCH_SIZE   (default 100 customers/tenant/tick)
 *
 * FLAGGED FOR LEGAL REVIEW — do not enable in prod until retention periods are
 * signed off.
 */
import type { Pool } from 'pg';
import { getPool, createWithTenantClient, type WithTenantClient } from '../database/index.js';
import { sweepTenant, listTenantIds } from '../services/retention/retentionService.js';

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily
const DEFAULT_BATCH_SIZE = 100;

let workerInterval: NodeJS.Timeout | null = null;
// Tracks the in-flight pass so (a) overlapping ticks are skipped and (b)
// shutdown can await a sweep that's mid-flight before the pool closes.
let activePass: Promise<number> | null = null;

export interface RetentionConfig {
  retentionDays: number;
  intervalMs: number;
  batchSize: number;
}

/**
 * Resolve the worker config from the environment. Returns null when the worker
 * must NOT run: either the enable flag is not exactly "true", or RETENTION_DAYS
 * is missing / not a positive integer. Null is the safe default — no window, no
 * erasure.
 */
export function resolveRetentionConfig(
  env: NodeJS.ProcessEnv = process.env
): RetentionConfig | null {
  if (env.ENABLE_RETENTION_WORKER !== 'true') return null;

  const days = Number(env.RETENTION_DAYS);
  if (!Number.isInteger(days) || days <= 0) {
    console.warn(
      '⚠️ Retention worker enabled but RETENTION_DAYS is missing or invalid — refusing to run.'
    );
    return null;
  }

  const intervalMs = Number(env.RETENTION_INTERVAL_MS);
  const batchSize = Number(env.RETENTION_BATCH_SIZE);
  return {
    retentionDays: days,
    intervalMs: Number.isInteger(intervalMs) && intervalMs > 0 ? intervalMs : DEFAULT_INTERVAL_MS,
    batchSize: Number.isInteger(batchSize) && batchSize > 0 ? batchSize : DEFAULT_BATCH_SIZE,
  };
}

/**
 * Run one retention pass across every tenant. Exported for tests / manual
 * trigger. Returns the total number of customers anonymized.
 */
export async function runRetentionPass(
  pool: Pool,
  config: RetentionConfig,
  withTenantClientOverride?: WithTenantClient
): Promise<number> {
  const withTenantClient = withTenantClientOverride ?? createWithTenantClient(pool);
  const tenantIds = await listTenantIds(pool);
  let total = 0;
  for (const tenantId of tenantIds) {
    try {
      const result = await sweepTenant(
        withTenantClient,
        tenantId,
        config.retentionDays,
        config.batchSize
      );
      if (result.anonymizedCustomerIds.length > 0) {
        total += result.anonymizedCustomerIds.length;
        console.log(
          `🧹 Retention: anonymized ${result.anonymizedCustomerIds.length} customer(s) for tenant ${tenantId}`
        );
      }
    } catch (err) {
      // One tenant's failure must not stop the sweep for the rest.
      console.error(`Retention sweep failed for tenant ${tenantId}`, err);
    }
  }
  return total;
}

/**
 * Start the retention worker if (and only if) the environment opts in with a
 * valid retention window. No-op otherwise — the caller can always invoke this
 * unconditionally.
 */
export function startRetentionWorker(poolOverride?: Pool): void {
  if (workerInterval) {
    console.warn('⚠️ Retention worker is already running');
    return;
  }
  const config = resolveRetentionConfig();
  if (!config) return; // disabled or no valid window — stay off

  const pool = poolOverride ?? getPool();
  console.log(
    `🚀 Starting retention worker (window: ${config.retentionDays}d, interval: ${config.intervalMs}ms, batch: ${config.batchSize})`
  );

  // Run on the interval. Deliberately NOT immediate-on-start: an erasure pass
  // should not fire the instant a process boots/redeploys.
  workerInterval = setInterval(() => {
    // Skip this tick if the previous pass is still running — overlapping sweeps
    // would double-process the same customers (extra load, lock contention).
    if (activePass) return;
    activePass = runRetentionPass(pool, config)
      .catch((err) => {
        console.error('Retention pass failed', err);
        return 0;
      })
      .finally(() => {
        activePass = null;
      }) as Promise<number>;
  }, config.intervalMs);
}

/**
 * Stop the retention worker (graceful shutdown). Clears the interval AND awaits
 * any in-flight pass so the pool isn't closed out from under a sweep mid-erasure.
 */
export async function stopRetentionWorker(): Promise<void> {
  if (workerInterval) {
    console.log('🛑 Stopping retention worker');
    clearInterval(workerInterval);
    workerInterval = null;
  }
  if (activePass) {
    try {
      await activePass;
    } catch {
      // already logged inside the tick
    }
  }
}

/** Whether the worker is currently running. */
export function isRetentionWorkerRunning(): boolean {
  return workerInterval !== null;
}
