/**
 * THE LINES THE RUNTIME SPEAKS SO THE CALLER IS NEVER LEFT IN SILENCE.
 *
 * These are the ONLY hold lines in the product, and they exist here — as data,
 * in one place — for two reasons.
 *
 * 1. THE MODEL MUST NOT BE THE ONE STALLING. The system prompt used to instruct
 *    the agent to "lead with 'one moment while I look that up...'" before a slow
 *    tool. It obeyed — and then never called the tool. On 2026-07-13 it said that
 *    sentence three times in one call and performed no work at all, because the
 *    sentence SATISFIED the instruction and a tool call is work. A hold line the
 *    MODEL speaks is an action it can fake. A hold line the RUNTIME speaks is a
 *    fact: it plays because a tool really is taking time, and a timer cannot lie
 *    about work it did not do.
 *
 * 2. THEY WERE DUPLICATED AS STRING LITERALS, and that is a silent failure.
 *    watchdog.ts looks the audio up in the filler cache BY THE TEXT ITSELF —
 *    getFillerFrame(voice, text) is a keyed lookup. index.ts warmed the cache with
 *    one copy of the string and the watchdog spoke another. They happened to
 *    match. Change a comma in one and nothing breaks loudly: the cache MISSES, the
 *    watchdog silently falls back to live TTS, and the very latency the
 *    pre-synthesis exists to remove comes back — on the line whose entire job is
 *    to cover latency. One definition, imported everywhere, so that cannot happen.
 *
 * Pre-synthesized (fillerCache) so the hold line itself costs ZERO TTS latency.
 * A hold line you have to wait for is not a hold line.
 */

/** Deadline 1 (~2.5s of thinking, no audio): a tool is slow, cover it. */
export const HOLD_LINE = 'One moment while I check that for you.';

/** Deadline 2 (~4s, still nothing): stop pretending, offer a way out. */
export const RECOVERY_LINE =
  "Sorry, this is taking me a moment. If you'd like, I can take a message and have someone get right back to you.";

/**
 * Spoken when a TOOL fails outright (timeout / throw / empty) — wrapTool.ts hands
 * this to the model as the tool's result, so the caller hears a graceful offer
 * instead of a stack trace or silence. Lives here for the same cache-key reason:
 * it is pre-synthesized too, and a drifted copy would miss the cache.
 */
export const TOOL_FALLBACK_LINE =
  "Sorry, I'm having a little trouble with that right now. Would you like me to take a message and have someone get back to you?";

/**
 * Every fixed line worth pre-synthesizing per tenant voice, minus the greeting
 * (which is tenant-specific and warmed alongside these at call start).
 */
export const HOLD_LINES = [HOLD_LINE, RECOVERY_LINE, TOOL_FALLBACK_LINE] as const;
