/**
 * Voice Session Reaper
 *
 * Server-side backstop that guarantees every call has a finalized record even
 * when the LiveKit agent never sends voice-session-end (worker stays alive
 * between jobs so the job-shutdown callback can be skipped; abrupt teardown;
 * network). Ticks on an interval and force-finalizes any voice_sessions row left
 * status='active' past VOICE_SESSION_REAP_MINUTES, computing duration from
 * started_at. The agent still supplies transcript/summary/outcome when it can;
 * this only ensures the row never sits open forever.
 *
 * Mirrors reminderScheduler's start/stop/interval shape. Calls the
 * SECURITY DEFINER reap_stale_voice_sessions() RPC so it bypasses RLS for this
 * cross-tenant maintenance.
 *
 * Usage:
 *   startVoiceSessionReaper(); // begin
 *   stopVoiceSessionReaper();  // graceful shutdown
 */

import { getPool } from '../database/index.js';
import { errorsTotal } from '../services/metrics.js';

const DEFAULT_INTERVAL_MS = 60_000; // 1 minute
// Calls almost never run longer than a few minutes; 15 min is a safe "this is
// definitely stranded, not in-progress" threshold. Override via env.
const DEFAULT_MAX_AGE_MINUTES = Number(process.env.VOICE_SESSION_REAP_MINUTES) || 15;

let reaperInterval: NodeJS.Timeout | null = null;
let isRunning = false;

/**
 * Finalize any stranded 'active' rows once. Returns the number reaped.
 * Exported for tests / manual trigger.
 */
export async function reapStaleVoiceSessionsNow(
  maxAgeMinutes: number = DEFAULT_MAX_AGE_MINUTES
): Promise<number> {
  const pool = getPool();
  const res = await pool.query<{ reap_stale_voice_sessions: number }>(
    'SELECT reap_stale_voice_sessions($1) AS reap_stale_voice_sessions',
    [maxAgeMinutes]
  );
  return res.rows[0]?.reap_stale_voice_sessions ?? 0;
}

async function tick(maxAgeMinutes: number): Promise<void> {
  if (isRunning) return; // skip overlapping ticks
  isRunning = true;
  try {
    const reaped = await reapStaleVoiceSessionsNow(maxAgeMinutes);
    if (reaped > 0) {
      // WHY this is WARN, not silent: a nonzero count means the agent failed to
      // finalize that many calls — a sad-path signal worth seeing, even though
      // the reaper recovered the record. Bump errors_total so it survives log
      // truncation and can alert.
      errorsTotal.inc({ event: 'voice_session_reaped' });
      console.warn(
        `🧹 voiceSessionReaper: finalized ${reaped} stranded 'active' voice_session(s) — agent end was not received`
      );
    }
  } catch (err) {
    errorsTotal.inc({ event: 'voice_session_reaper_failed' });
    console.error('voiceSessionReaper tick failed:', err instanceof Error ? err.message : err);
  } finally {
    isRunning = false;
  }
}

/**
 * Start the reaper. Runs once immediately, then on the interval.
 */
export function startVoiceSessionReaper(
  intervalMs: number = DEFAULT_INTERVAL_MS,
  maxAgeMinutes: number = DEFAULT_MAX_AGE_MINUTES
): void {
  if (reaperInterval) {
    console.warn('⚠️ voiceSessionReaper is already running');
    return;
  }
  console.log(
    `🚀 Starting voiceSessionReaper (interval: ${intervalMs}ms, max age: ${maxAgeMinutes}m)`
  );
  void tick(maxAgeMinutes);
  reaperInterval = setInterval(() => {
    void tick(maxAgeMinutes);
  }, intervalMs);
}

/**
 * Stop the reaper (graceful shutdown).
 */
export function stopVoiceSessionReaper(): void {
  if (reaperInterval) {
    console.log('🛑 Stopping voiceSessionReaper');
    clearInterval(reaperInterval);
    reaperInterval = null;
  }
}

/** True when the reaper interval is active. */
export function isVoiceSessionReaperRunning(): boolean {
  return reaperInterval !== null;
}
