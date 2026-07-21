/**
 * CHECKLIST-AWARE TURN DETECTION (prototype, 2026-07-21).
 *
 * The idea (Dale's): "the detection should be — were my questions answered?"
 * A fixed silence threshold is boxed in from both sides (LESSONS_LEARNED
 * pattern 4): below ~1300ms it cuts off number-recall pauses, above ~1500ms it
 * livelocks against normal conversational pacing. There is no good number.
 *
 * So stop timing silence and read the WORDS: the checklist knows what question
 * is pending and what shape its answer has. Six digits of a phone number is
 * visibly incomplete — wait through the pause. "Yeah, that's right" is visibly
 * complete — respond immediately. The silence timer survives only as fallback.
 *
 * Mechanics (LiveKit `_TurnDetector` contract, @livekit/agents
 * dist/voice/audio_recognition.js): after VAD signals end-of-speech, the
 * framework calls predictEndOfTurn(chatCtx) → a probability. Below
 * unlikelyThreshold → wait `endpointing.maxDelay` before committing the turn
 * (caller resuming speech cancels the commit); at/above → `minDelay`. So this
 * detector doesn't replace endpointing — it CHOOSES, per utterance, between a
 * snappy commit and a patient one.
 *
 * No ML model, no new dependency: a heuristic fed by state we already keep.
 */
import type { llm } from '@livekit/agents';

/** Probability returned when the utterance is visibly mid-thought. */
export const NOT_DONE = 0.1;
/** Probability returned when the utterance is visibly complete. */
export const DONE = 0.9;
/** Neutral: no signal either way — the framework uses minDelay (fast). */
export const NEUTRAL = 0.6;
/** predictEndOfTurn results below this wait maxDelay instead of minDelay. */
export const UNLIKELY_THRESHOLD = 0.5;

const WORD_DIGIT = /\b(zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/gi;

/** Digits in the utterance, counting both numerals ("430" = 3) and spoken
 *  digit-words ("one one one" = 3). */
function digitCount(text: string): number {
  const numerals = (text.match(/\d/g) ?? []).length;
  const words = (text.match(WORD_DIGIT) ?? []).length;
  return numerals + words;
}

// Function words that end an utterance only when the speaker isn't done:
// "I'd like to…", "my number is…", "let's do…", "it's at…". STT finals often
// append a period mid-thought, so trailing punctuation is stripped first.
const TRAILING_INCOMPLETE =
  /\b(and|but|or|so|because|my|your|his|her|their|our|the|a|an|is|are|was|it's|its|at|to|of|for|with|about|on|in|do|let's|want|need|like|gonna|i'd|i'll|i'm|um+|uh+|er+)$/i;

// Crisp closures — confirmations and refusals that never trail into more.
// Compound stacks count ("Yeah. That's right.", "No, that's all."): callers
// pile affirmations, and every layer is still a closure.
const CLOSURE_PHRASE =
  "(yeah|yes|yep|yup|no|nope|correct|right|okay|ok|sure|perfect|great|sounds good|that works|that's (right|correct|all|it|fine))";
const CRISP_CLOSURE = new RegExp(`^(${CLOSURE_PHRASE}[.!,\\s]*)+$`, 'i');

/**
 * The heuristic core — pure, tested directly.
 *
 * @param raw            the caller's accumulated utterance so far this turn
 * @param pendingNodeId  the checklist's first open ask node (null when unknown
 *                       — non-checklist paths, or nothing pending)
 */
export function endOfTurnScore(raw: string, pendingNodeId: string | null): number {
  const text = raw.trim();
  if (!text) return NOT_DONE; // nothing transcribed yet — never commit on silence alone

  // A dictated phone number in progress outranks everything: waiting on
  // caller_phone with SOME digits but fewer than ten means the caller is
  // mid-number, however long the beat between groups ("111 222 …. 1256").
  // Ten or more means the number is complete — commit fast, no dead-waiting.
  const digits = digitCount(text);
  const phonePending = pendingNodeId === 'caller_phone';
  const soundsLikeDictation = phonePending || /\b(number|reach|call me|phone)\b/i.test(text);
  if (soundsLikeDictation && digits > 0) {
    return digits < 10 ? NOT_DONE : DONE;
  }

  // Trailing function word / filler = mid-thought ("I'd like to…", "it's um…").
  const unpunctuated = text.replace(/[.!?…]+$/, '').trimEnd();
  if (/[,\-–—:]$/.test(unpunctuated)) return NOT_DONE;
  if (TRAILING_INCOMPLETE.test(unpunctuated)) return NOT_DONE;

  // A crisp yes/no/confirmation is complete the moment it's said.
  if (CRISP_CLOSURE.test(text)) return DONE;

  return NEUTRAL;
}

/** Last user message's text out of the chat context, defensively — the
 *  framework appends the live transcript as the final user message. */
function lastUserText(chatCtx: llm.ChatContext): string {
  const items = (chatCtx as unknown as { items?: unknown[] }).items ?? [];
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i] as {
      type?: string;
      role?: string;
      textContent?: string;
      content?: unknown;
    };
    if (it.type === 'message' && it.role === 'user') {
      if (typeof it.textContent === 'string') return it.textContent;
      if (typeof it.content === 'string') return it.content;
      if (Array.isArray(it.content))
        return it.content.filter((c) => typeof c === 'string').join(' ');
      return '';
    }
  }
  return '';
}

export interface ChecklistTurnDetector {
  readonly model: string;
  readonly provider: string;
  unlikelyThreshold: (language?: string) => Promise<number | undefined>;
  supportsLanguage: (language?: string) => Promise<boolean>;
  predictEndOfTurn(chatCtx: llm.ChatContext, timeout?: number): Promise<number>;
}

/**
 * @param getPendingNode  live accessor for the checklist's first open ask node —
 *                        wired to the ChecklistAgent after construction (a ref,
 *                        because the session is built before the agent).
 */
export function createChecklistTurnDetector(
  getPendingNode: () => string | null,
  log: { info: (obj: object, msg: string) => void }
): ChecklistTurnDetector {
  return {
    model: 'checklist-heuristic-v1',
    provider: 'secretaryhq',
    // The _TurnDetector contract is async (the framework awaits these); our
    // implementations are synchronous, so resolve directly rather than mark them
    // async with no await (require-await).
    unlikelyThreshold: () => Promise.resolve(UNLIKELY_THRESHOLD),
    supportsLanguage: () => Promise.resolve(true), // heuristics are English-ish; fail open
    predictEndOfTurn(chatCtx: llm.ChatContext): Promise<number> {
      const text = lastUserText(chatCtx);
      const pending = getPendingNode();
      const score = endOfTurnScore(text, pending);
      // One log line per decision — cheap, and it's the trace that will tell us
      // whether the heuristics hold on a real call (the measure-first lesson).
      log.info(
        {
          event: 'turn_detector_decision',
          score,
          pending_node: pending,
          text_len: text.length,
          verdict: score < UNLIKELY_THRESHOLD ? 'wait_max' : 'commit_min',
        },
        `turn detector: ${score < UNLIKELY_THRESHOLD ? 'caller likely mid-thought — waiting' : 'turn looks complete — committing'}`
      );
      return Promise.resolve(score);
    },
  };
}
