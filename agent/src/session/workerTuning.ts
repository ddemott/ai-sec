/**
 * Worker-level knobs read from the environment.
 *
 * WHO PAYS FOR PROCESS STARTUP (2026-08-15). A LiveKit job runs in its own
 * process, and prewarm — Silero VAD load, the DNS warm — runs inside it. The
 * SDK keeps `min(cpus, 4)` idle processes in production and **ZERO** in dev
 * mode, so a locally-tested call pays process spawn plus every cold connection
 * with the caller listening, while production never does. That difference made
 * local calls look broken when the deployed worker was fine.
 *
 * `undefined` means "keep the SDK default" — deliberately, because hard-coding
 * a number here would SHRINK the production pool from 4 to whatever suited a
 * laptop.
 */
export function idleProcessOverride(env: NodeJS.ProcessEnv = process.env): number | undefined {
  // Number('') is 0 and Number('abc') is NaN; either one handed to the SDK as a
  // pool size would silently disable pre-warming — the same blank-string trap
  // that MAX_TOOL_STEPS and the silence timers already guard against. A
  // misconfigured value falls back to the SDK default, never to zero.
  const parsed = Number.parseInt(env.NUM_IDLE_PROCESSES ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
