/**
 * Real-DB companion for the voice-session reaper's RPC.
 *
 * Motivation (docs/TEST_DB_AUDIT.md): the reaper is a prod BACKSTOP — it
 * force-finalizes any voice_sessions row stuck `status='active'` past the max
 * age when the agent never sends its completion record. `reapStaleVoiceSessionsNow`
 * is a thin wrapper over the SECURITY DEFINER `reap_stale_voice_sessions(mins)`
 * RPC, and that RPC has never been exercised against real Postgres — a mock
 * can't prove it finalizes the right rows, computes duration, or leaves recent
 * calls alone. This suite drives the real RPC and asserts the stored rows.
 *
 * The RPC is what carries all the logic, so we call it directly via the root
 * client (exactly what the worker wraps) — avoids the getPool() singleton
 * binding to the wrong database.
 *
 * ISOLATION NOTE: `reap_stale_voice_sessions()` is GLOBAL — it finalizes every
 * tenant's stale-active sessions (no tenant filter; it's the prod backstop).
 * That breaks the tenant-isolation this repo's real-DB suites rely on to run
 * in parallel: a sibling suite (e.g. voice.realdb) seeds hours-old active
 * sessions that this RPC would otherwise reap out from under it. So we isolate
 * by AGE instead — seed rows YEARS old and reap with a multi-year threshold,
 * far beyond any age a real suite ever seeds, so our reap can only ever touch
 * our own rows. (The RPC's logic is identical regardless of the exact age.)
 *
 * 5W for sad-path failures:
 *   WHO  — the reaper worker on its 60s tick
 *   WHAT — SELECT reap_stale_voice_sessions($mins)
 *   WHEN — after an agent crash leaves a call row 'active' forever
 *   WHERE — the SECURITY DEFINER UPDATE voice_sessions SET status='completed'…
 *   WHY  — an un-reaped row shows as a live call forever with no duration; an
 *          OVER-aggressive reaper would finalize a call mid-conversation
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { type Client } from 'pg';
import { getRootClient, createTenant, skipIfDbDown } from '../utils';

let setup: Client;
let dbAvailable = false;
let tenantId: string;
const tenantsToClean: string[] = [];

// Age-isolation constants — see ISOLATION NOTE above. Threshold sits between
// the "old" and "fresh" fixtures and is years beyond any real suite's rows.
const THRESHOLD_MIN = 730 * 24 * 60; // 730 days
const OLD_DAYS = 900; // past the threshold → reaped
const FRESH_DAYS = 400; // under the threshold (but still > prod's 15min) → spared

/** Insert a voice_sessions row started `daysAgo` days ago (root client bypasses RLS). */
async function seedSession(callId: string, daysAgo: number): Promise<void> {
  const startedAt = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  await setup.query(
    `INSERT INTO voice_sessions (tenant_id, call_id, status, started_at)
     VALUES ($1, $2, 'active', $3)`,
    [tenantId, callId, startedAt]
  );
}

async function sessionRow(callId: string): Promise<{
  status: string;
  duration_seconds: number | null;
  ended_at: Date | null;
  summary: string | null;
}> {
  const res = await setup.query(
    `SELECT status, duration_seconds, ended_at, summary
       FROM voice_sessions WHERE tenant_id = $1 AND call_id = $2`,
    [tenantId, callId]
  );
  return res.rows[0];
}

/** Call the reaper's RPC directly. Returns the reaped count. */
async function reap(maxAgeMinutes: number): Promise<number> {
  const res = await setup.query<{ reaped: number }>(
    'SELECT reap_stale_voice_sessions($1) AS reaped',
    [maxAgeMinutes]
  );
  return res.rows[0].reaped;
}

beforeAll(async () => {
  try {
    setup = await getRootClient();
    await setup.query('SELECT 1');
    tenantId = await createTenant(setup, 'Reaper Realdb Tenant', 'salon');
    tenantsToClean.push(tenantId);
    dbAvailable = true;
  } catch (err) {
     
    console.warn('[voiceSessionReaper.realdb.test] DB not available, skipping', err);
  }
});

afterAll(async () => {
  if (setup) {
    for (const id of tenantsToClean) {
      await setup.query('DELETE FROM tenants WHERE tenant_id = $1', [id]).catch(() => {});
    }
    await setup.end();
  }
});

beforeEach((ctx) => {
  skipIfDbDown(ctx, () => dbAvailable);
});

describe('reap_stale_voice_sessions() → real RPC', () => {
  it('HAPPY: finalizes a stale active session — status=completed, duration from started_at, summary marker', async () => {
    await seedSession('reap-stale-1', OLD_DAYS); // 900 days > 730-day threshold → stale
    const reaped = await reap(THRESHOLD_MIN);
    expect(reaped).toBeGreaterThanOrEqual(1);

    const row = await sessionRow('reap-stale-1');
    expect(row.status).toBe('completed');
    expect(row.ended_at).not.toBeNull();
    // Duration computed from started_at (~900 days ≈ 7.7e7 s) — allow slack.
    expect(row.duration_seconds).toBeGreaterThanOrEqual(OLD_DAYS * 86_400 - 86_400);
    expect(row.summary).toContain('Auto-finalized');
  });

  it('SAFETY: an active session younger than the threshold is NOT reaped', async () => {
    // WHY: over-aggressive reaping would finalize a live call mid-conversation.
    await seedSession('reap-fresh-1', FRESH_DAYS); // 400 days < 730-day threshold
    await reap(THRESHOLD_MIN);
    const row = await sessionRow('reap-fresh-1');
    expect(row.status).toBe('active');
    expect(row.ended_at).toBeNull();
  });

  it('IDEMPOTENT: after reaping, the row stays completed (a second pass leaves it alone)', async () => {
    await seedSession('reap-idem-1', OLD_DAYS);
    const first = await reap(THRESHOLD_MIN);
    expect(first).toBeGreaterThanOrEqual(1);
    // Count may include this suite's own other rows; assert on the specific row.
    await reap(THRESHOLD_MIN);
    const row = await sessionRow('reap-idem-1');
    expect(row.status).toBe('completed');
  });

  it('PRESERVES an existing duration_seconds instead of overwriting it', async () => {
    // The RPC COALESCEs duration — a partially-finalized row keeps its value.
    await seedSession('reap-dur-1', OLD_DAYS);
    await setup.query(
      `UPDATE voice_sessions SET duration_seconds = 42 WHERE tenant_id = $1 AND call_id = $2`,
      [tenantId, 'reap-dur-1']
    );
    await reap(THRESHOLD_MIN);
    const row = await sessionRow('reap-dur-1');
    expect(row.status).toBe('completed');
    expect(row.duration_seconds).toBe(42);
  });
});
