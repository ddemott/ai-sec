/**
 * Tests for the checklist-aware turn detector — "were my questions answered?".
 * The heuristic core is pure (endOfTurnScore), so every live-call failure mode
 * that motivated it replays here as a table row. The detector wrapper is
 * exercised over a minimal fake ChatContext shape.
 */
import { describe, it, expect } from 'vitest';
import type { llm } from '@livekit/agents';
import {
  endOfTurnScore,
  createChecklistTurnDetector,
  NOT_DONE,
  DONE,
  NEUTRAL,
  UNLIKELY_THRESHOLD,
} from './turnDetector.js';

const waits = (score: number) => score < UNLIKELY_THRESHOLD;

describe('endOfTurnScore — phone dictation (the whole reason this exists)', () => {
  it('SAD, live: six digits of a ten-digit number → WAIT, however long the beat', () => {
    // WHO: every caller who says a number in 3-3-4 chunks with ~1s beats —
    // the pattern that drove VAD 550→900→1300→1800(reverted). The checklist
    // knows caller_phone is pending and the answer shape is ten digits.
    expect(waits(endOfTurnScore('One one one two two two', 'caller_phone'))).toBe(true);
    expect(waits(endOfTurnScore('312 865', 'caller_phone'))).toBe(true);
  });

  it('HAPPY: ten digits → COMMIT fast — the number is complete, no dead-waiting', () => {
    expect(endOfTurnScore('one one one two two two one two five six', 'caller_phone')).toBe(DONE);
    expect(endOfTurnScore('It is 111 222 1256', 'caller_phone')).toBe(DONE);
    expect(endOfTurnScore('1-111-222-1256', 'caller_phone')).toBe(DONE); // 11 with leading 1
  });

  it('dictation is recognized WITHOUT the checklist too ("my number is…") — fail open', () => {
    // Non-checklist paths pass pendingNodeId null; the words still signal it.
    expect(waits(endOfTurnScore('My number is one one one.', null))).toBe(true);
    expect(endOfTurnScore('You can call me at 111 222 1256', null)).toBe(DONE);
  });

  it('digit-words in a SALARY answer are not a phone — no false wait', () => {
    // "one forty to one sixty thousand" has digit-words but salary_range is
    // pending and nothing says "number" — must not trap the caller in maxDelay.
    expect(endOfTurnScore('One forty to one sixty thousand.', 'salary_range')).toBe(NEUTRAL);
  });
});

describe('endOfTurnScore — mid-thought vs complete', () => {
  it('SAD, live: trailing function words are mid-thought → WAIT', () => {
    // "Yeah. That's fine. How about—" (2026-07-21 call 1, endpointed mid-thought
    // and re-asked) and friends. STT finals often append a period — stripped.
    expect(waits(endOfTurnScore("I'd like to", null))).toBe(true);
    expect(waits(endOfTurnScore("I'd like to.", null))).toBe(true);
    expect(waits(endOfTurnScore("Let's do", null))).toBe(true);
    expect(waits(endOfTurnScore('I was hoping to speak to him about a', null))).toBe(true);
    expect(waits(endOfTurnScore("It's um", null))).toBe(true);
    expect(waits(endOfTurnScore('Tell Dale that he needs to bring the', null))).toBe(true);
  });

  it('HAPPY: crisp closures commit immediately — no 1.3s of silence after "yeah"', () => {
    expect(endOfTurnScore("Yeah. That's right.", null)).toBe(DONE);
    expect(endOfTurnScore('Yes', null)).toBe(DONE);
    expect(endOfTurnScore("No, that's all.", null)).toBe(DONE);
    expect(endOfTurnScore('Okay', null)).toBe(DONE);
  });

  it('ordinary complete sentences are NEUTRAL — the (fast) min delay applies', () => {
    expect(endOfTurnScore('I wanted to leave a message for Dale.', null)).toBe(NEUTRAL);
    expect(endOfTurnScore('It is a full time position.', null)).toBe(NEUTRAL);
    expect(endOfTurnScore('Beta software.', null)).toBe(NEUTRAL);
  });

  it('empty transcript → WAIT (never commit a turn on silence alone)', () => {
    expect(waits(endOfTurnScore('', null))).toBe(true);
    expect(waits(endOfTurnScore('   ', null))).toBe(true);
  });
});

describe('createChecklistTurnDetector — the LiveKit-facing wrapper', () => {
  const noopLog = { info: () => {} };
  const ctxWith = (text: string): llm.ChatContext =>
    ({
      items: [
        { type: 'message', role: 'assistant', textContent: 'What is the best number?' },
        { type: 'message', role: 'user', textContent: text },
      ],
    }) as unknown as llm.ChatContext;

  it('reads the LAST user message and the live pending node', async () => {
    let pending: string | null = 'caller_phone';
    const det = createChecklistTurnDetector(() => pending, noopLog);
    expect(await det.predictEndOfTurn(ctxWith('one one one two two two'))).toBe(NOT_DONE);
    expect(await det.predictEndOfTurn(ctxWith('one one one two two two one two five six'))).toBe(
      DONE
    );
    pending = null; // selection moved on — same words, dictation cue gone
    expect(await det.predictEndOfTurn(ctxWith('It is a full time position.'))).toBe(NEUTRAL);
  });

  it('threshold and language contract match what audio_recognition.js expects', async () => {
    const det = createChecklistTurnDetector(() => null, noopLog);
    expect(await det.unlikelyThreshold('en')).toBe(UNLIKELY_THRESHOLD);
    expect(await det.supportsLanguage('en')).toBe(true);
    expect(await det.supportsLanguage(undefined)).toBe(true); // unknown language: fail open
  });

  it('an empty/unparseable chat context never crashes — WAIT is the safe answer', async () => {
    const det = createChecklistTurnDetector(() => null, noopLog);
    const empty = { items: [] } as unknown as llm.ChatContext;
    expect(await det.predictEndOfTurn(empty)).toBe(NOT_DONE);
  });
});
