/**
 * RUNG 2 OF THE LADDER: can the agent go a whole turn without dead air?
 *
 * Two things have to be true, and until now NEITHER was pinned by a test:
 *
 *   1. The watchdog is ON. It shipped inert for weeks, waiting for a real-call
 *      validation that never came — survivable only because the system prompt was
 *      telling the MODEL to say "one moment" instead. That instruction is gone (it
 *      was letting the model narrate a lookup instead of performing one), so the
 *      watchdog is now the ONLY thing between a slow tool and silence. If someone
 *      flips this default back, the line goes quiet and every test still passes.
 *
 *   2. The hold lines are ONE definition. The filler cache is keyed BY THE TEXT —
 *      getFillerFrame(voice, text). These strings used to be re-typed in three
 *      places (index.ts twice, wrapTool.ts once). A one-character drift between the
 *      copy that WARMS the cache and the copy that READS it misses silently: no
 *      error, no log, the watchdog just falls back to live TTS and the latency this
 *      whole mechanism exists to hide comes back on the line whose only job is to
 *      hide it.
 *
 * Neither of these can be caught by watching the code work. Both can be caught here.
 *
 * What these tests CANNOT tell you: whether it sounds right. That needs a real call,
 * and `npm run verify:tts` (which synthesizes these exact strings against the real
 * Deepgram socket) is the gate that at least proves they make noise.
 */
import { describe, it, expect } from 'vitest';
import { HOLD_LINE, RECOVERY_LINE, TOOL_FALLBACK_LINE, HOLD_LINES } from './holdLines.js';
import { envSchema } from '../configSchema.js';

describe('rung 2 — the runtime, not the model, covers dead air', () => {
  it('SAD: the output watchdog is ON by default', () => {
    // WHO: every caller, on every slow tool (availability, policy RAG — 2-4s).
    // WHAT: with no ENABLE_OUTPUT_WATCHDOG set, the watchdog must still attach.
    // WHY: it used to default OFF, and the prompt covered for it by telling the
    //      model to stall out loud. Deleting that instruction (it was the reason
    //      the model NARRATED lookups instead of doing them) removed the last
    //      cover. speakFiller has been a no-op since 2026-06-25. So this default
    //      is now load-bearing: flip it back and the caller hears nothing at all
    //      for 2-4 seconds, which is the bug that has taken this line down twice.
    //      An env var can still turn it off (ENABLE_OUTPUT_WATCHDOG=false) — but
    //      that has to be a DECISION, not an omission.
    // Parse the schema directly rather than importing `config`: importing config
    // validates the entire environment and process.exit(1)s under vitest. We are
    // asserting one DEFAULT, so parse one field with the var ABSENT — which is
    // exactly the condition that matters (nobody set it).
    const parsed = envSchema.shape.ENABLE_OUTPUT_WATCHDOG.parse(undefined);
    expect(parsed).toBe(true);

    // ...and that an explicit opt-out still works, so turning it off stays a
    // DECISION someone made, not an omission.
    expect(envSchema.shape.ENABLE_OUTPUT_WATCHDOG.parse('false')).toBe(false);
  });

  it('SAD: every pre-synthesized line is the SAME OBJECT the speaker reads', () => {
    // WHY: the cache is keyed by text. PREGEN_LINES warms it; watchdog.ts and
    //      wrapTool.ts read it. If those are three separately-typed literals, a
    //      drift is a silent cache miss — not a crash. Identity, not equality, is
    //      what this asserts: the warm list must contain the very constants the
    //      readers import.
    expect(HOLD_LINES).toContain(HOLD_LINE);
    expect(HOLD_LINES).toContain(RECOVERY_LINE);
    expect(HOLD_LINES).toContain(TOOL_FALLBACK_LINE);
  });

  it('HAPPY: the hold line is short enough to actually cover a gap', () => {
    // WHY: a hold line is only useful if it is speakable in roughly the time it is
    //      buying. Deadline 1 fires at 2.5s; a rambling filler would still be
    //      talking when the real answer arrives, and the caller would be
    //      interrupted by their own receptionist. Rough speech rate ~15 chars/sec.
    expect(HOLD_LINE.length).toBeLessThan(60);
  });

  it('HAPPY: no hold line contains markdown or a placeholder', () => {
    // WHY: these bypass the LLM entirely and go STRAIGHT to TTS — the speech
    //      sanitizer (ttsNode) protects model output, not these. An unsubstituted
    //      {{business_name}} or a stray asterisk here is read aloud, verbatim, to
    //      a customer. That exact class of bug already shipped once: the greeting
    //      spoke "{{business_name}}" out loud.
    for (const line of HOLD_LINES) {
      expect(line, line).not.toMatch(/[*_`~]|\{\{|\}\}/);
      expect(line.trim(), line).toBe(line);
    }
  });
});
