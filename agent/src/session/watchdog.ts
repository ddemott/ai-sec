/**
 * Turn-output watchdog — the categorical "never silent" guarantee.
 *
 * Cause-agnostic: it watches the OUTPUT, not the cause. After the caller's turn
 * ends (agent enters 'thinking'), it starts a deadline. If no agent audio has
 * started by deadline 1, it plays a cached filler ("one moment…"); if still no
 * audio by deadline 2, it plays a cached recovery line. This catches every
 * dead-air source — slow TTS, a stalled tool, an LLM that says nothing — because
 * it triggers on "no audio by deadline," whatever produced (or failed to
 * produce) it.
 *
 * Safety (validated against @livekit/agents 1.4.5 internals):
 * - `say()` is called from EVENT/TIMER callbacks, never inside a tool's
 *   execute() — that circular-wait pattern is what froze #97 (now guarded by
 *   SpeechHandleCircularWaitError, but we still avoid it).
 * - `mainTask` SERIALIZES the speech queue, so the filler and the real reply
 *   never overlap — the filler plays, then the reply. (That filler→reply
 *   sequence is the intended UX, not the double-speak bug, which only occurs
 *   with preemptiveGeneration — which we do not enable.)
 * - `say()` throws SchedulingPausedError while the session is draining — guarded.
 *
 * Known edge (real-call validation item, not handled here): #3418 — an
 * interruption race can leave the agent in 'speaking' with no audio and no
 * error. The common dead-air cases (TTS gap / tool stall / silent LLM) keep the
 * agent in 'thinking', which this covers; the 'speaking'-but-silent edge is a
 * follow-up once reproduced.
 */
import { voice } from '@livekit/agents';
import { getFillerFrame, frameStream } from './fillerCache.js';

/** SpeechHandle (not re-exported by the package) — the return type of say(). */
type SpeechHandle = ReturnType<voice.AgentSession['say']>;

export interface WatchdogOptions {
  /** Tenant voice id (cache key for the pre-synthesized clips). */
  voice: string;
  /** Filler line spoken at deadline 1 (must be warmed in the filler cache). */
  fillerText: string;
  /** Recovery line spoken at deadline 2. */
  recoveryText: string;
  /** ms of 'thinking' with no audio before the filler plays. */
  deadline1Ms?: number;
  /** ms after the filler with still no real audio before the recovery line. */
  deadline2Ms?: number;
  /** Structured logger (callLog). */
  log: { info: LogFn; warn: LogFn };
}

type LogFn = (obj: Record<string, unknown>, msg: string) => void;

const DEFAULT_DEADLINE_1 = 2500;
const DEFAULT_DEADLINE_2 = 4000;

/**
 * Attach the watchdog to a live AgentSession. Idempotent per session; returns a
 * detach function (clears timers + listeners) for teardown/tests.
 */
export function attachOutputWatchdog(
  session: voice.AgentSession,
  opts: WatchdogOptions
): () => void {
  const deadline1 = opts.deadline1Ms ?? DEFAULT_DEADLINE_1;
  const deadline2 = opts.deadline2Ms ?? DEFAULT_DEADLINE_2;

  let timer1: ReturnType<typeof setTimeout> | undefined;
  let timer2: ReturnType<typeof setTimeout> | undefined;
  // The filler we injected this turn, and whether its playout has finished.
  // Used to tell our OWN filler's 'speaking' event apart from the real reply's:
  // the speech queue is serialized, so the reply only starts speaking AFTER the
  // filler is done — i.e. a 'speaking' while the filler is still playing is the
  // filler; a 'speaking' once it's done (or with no filler) is real audio.
  // SpeechHandle isn't re-exported from the package, so derive its type from
  // say()'s return rather than importing it by name.
  let fillerHandle: SpeechHandle | undefined;
  let fillerDone = false;

  const clearTimers = () => {
    if (timer1) clearTimeout(timer1);
    if (timer2) clearTimeout(timer2);
    timer1 = undefined;
    timer2 = undefined;
  };

  const disarm = () => {
    clearTimers();
    fillerHandle = undefined;
    fillerDone = false;
  };

  // Speak a cached clip (zero-latency) if warmed, else fall back to live TTS via
  // a plain text say() — slower, but never silent. Returns the handle or null
  // when the session refused the say (draining).
  const speakHold = (text: string, label: string): SpeechHandle | null => {
    const frame = getFillerFrame(opts.voice, text);
    try {
      const handle = frame
        ? session.say(text, { audio: frameStream(frame), allowInterruptions: true, addToChatCtx: false })
        : session.say(text, { allowInterruptions: true, addToChatCtx: false });
      opts.log.info(
        { event: 'watchdog_hold_played', label, cached: frame != null },
        `watchdog played a ${label} line (caller not left in silence)`
      );
      return handle;
    } catch (e) {
      // SchedulingPausedError (draining) or similar — nothing to play into.
      opts.log.warn(
        { event: 'watchdog_hold_skipped', label, error_message: e instanceof Error ? e.message : String(e) },
        'watchdog hold skipped — session not accepting speech'
      );
      return null;
    }
  };

  const fireFiller = () => {
    timer1 = undefined;
    // Re-check: the real reply may have started between the timer scheduling and
    // now. Only hold the line if the agent is still thinking (no audio yet).
    if (session.agentState !== 'thinking') return;
    fillerDone = false;
    fillerHandle = speakHold(opts.fillerText, 'filler') ?? undefined;
    // Mark when the filler's playout finishes so a later 'speaking' (the real
    // reply, which is serialized AFTER the filler) is recognized as real audio.
    fillerHandle?.addDoneCallback(() => {
      fillerDone = true;
    });
    // Arm deadline 2 — if STILL no real audio, escalate to the recovery line.
    timer2 = setTimeout(fireRecovery, deadline2);
  };

  const fireRecovery = () => {
    timer2 = undefined;
    if (session.agentState !== 'thinking') return;
    // Return value (the SpeechHandle thenable) intentionally unused — fire-and-forget.
    void speakHold(opts.recoveryText, 'recovery');
  };

  const onAgentState = (ev: voice.AgentStateChangedEvent) => {
    if (ev.newState === 'thinking') {
      // New turn to respond — (re)arm the deadline.
      clearTimers();
      fillerHandle = undefined;
      fillerDone = false;
      timer1 = setTimeout(fireFiller, deadline1);
    } else if (ev.newState === 'speaking') {
      // Audio started. If our filler is still playing, this 'speaking' IS the
      // filler — ignore it. Otherwise (no filler this turn, or it already
      // finished) real audio is now playing → the caller hears something →
      // disarm. (The queue is serialized, so the reply can only speak after the
      // filler's playout completes.)
      const isFillerSpeaking = fillerHandle != null && !fillerDone;
      if (!isFillerSpeaking) disarm();
    } else if (ev.newState === 'listening' || ev.newState === 'idle') {
      // Turn fully resolved — stand down.
      disarm();
    }
  };

  session.on(voice.AgentSessionEventTypes.AgentStateChanged, onAgentState);

  return () => {
    clearTimers();
    session.off(voice.AgentSessionEventTypes.AgentStateChanged, onAgentState);
  };
}
