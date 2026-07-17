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
import { isToolRunning } from './toolActivity.js';

/** SpeechHandle (not re-exported by the package) — the return type of say(). */
type SpeechHandle = ReturnType<voice.AgentSession['say']>;

export interface WatchdogOptions {
  /** Tenant voice id (cache key for the pre-synthesized clips). */
  voice: string;
  /** Spoken at deadline 1 when a TOOL IS RUNNING — it may name the lookup. */
  fillerText: string;
  /**
   * Spoken at deadline 1 when NO tool is running (the agent is just slow to think).
   * It must claim nothing: saying "let me check that for you" when there is nothing
   * being checked is a lie the caller can hear, and on 2026-07-14 he called it out
   * mid-call. Both lines are pre-synthesized.
   */
  thinkingText: string;
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
 * Attach the watchdog to a live AgentSession. Call once per session (index.ts
 * does); attaching twice would register duplicate listeners and double-fire.
 * Returns a detach function (clears timers + listeners) for teardown/tests.
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
        ? session.say(text, {
            audio: frameStream(frame),
            allowInterruptions: true,
            addToChatCtx: false,
          })
        : session.say(text, { allowInterruptions: true, addToChatCtx: false });
      opts.log.info(
        { event: 'watchdog_hold_played', label, cached: frame != null },
        `watchdog played a ${label} line (caller not left in silence)`
      );
      return handle;
    } catch (e) {
      // SchedulingPausedError (draining) or similar — nothing to play into.
      opts.log.warn(
        {
          event: 'watchdog_hold_skipped',
          label,
          error_message: e instanceof Error ? e.message : String(e),
        },
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
    // SAY THE TRUE THING. A tool really running earns "let me check that for you";
    // an LLM that is merely slow gets "just a moment", which promises nothing and so
    // cannot be false. The watchdog stays cause-AGNOSTIC about WHEN it fires (dead
    // air is dead air) and becomes cause-HONEST about WHAT it says.
    const running = isToolRunning();
    fillerHandle =
      speakHold(running ? opts.fillerText : opts.thinkingText, running ? 'filler' : 'thinking') ??
      undefined;
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
    // No agentState gate here: disarm() clears timer2 the moment real audio plays
    // (or the turn ends), so if this timer SURVIVED to fire, no real audio has
    // happened since the filler — we're still in dead air and should recover.
    // (Gating on agentState==='thinking' would wrongly skip recovery, because the
    // filler we just played transitions the agent into 'speaking'.)
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

/**
 * What the forced reply is told, when a turn dies silent (see
 * attachSilentTurnRecovery). Positive framing (gotcha G): it says what to DO —
 * speak, using what it already knows — not what went wrong. toolChoice:'none'
 * rides along in the generateReply call, so this turn CANNOT die the same
 * death: with no tools to chain there is no step cap to hit, and the model's
 * only move is to produce words.
 */
export const NUDGE_INSTRUCTIONS =
  'Reply to the caller RIGHT NOW in one or two short sentences, using what you already know from the conversation. Tell them plainly what you can do next or what you need from them. Never mention tools, systems, steps, or errors.';

/**
 * Silent-turn-death recovery — the backstop for a turn that ENDS without audio.
 *
 * The hold-line watchdog above covers a turn that is SLOW. This covers a turn
 * that is OVER: on 2026-07-17 a live call hit LiveKit's maxToolSteps cap
 * (default 3) mid-booking — the model chained three lookups, the framework
 * ended the turn, and the agent transitioned thinking → listening having said
 * NOTHING. The caller said "Hello?" twice into the silence and hung up. Three
 * aggravators made it unrecoverable:
 *
 *  - the hold-line watchdog treats 'listening' as "turn fully resolved" and
 *    DISARMS — the never-silent backstop stands down on exactly the transition
 *    that IS the silence;
 *  - the capped turn strands its last tool call with no output in history
 *    ("function call missing the corresponding function output" on every later
 *    turn);
 *  - the caller's "Hello?" replays the same doomed tool loop from the same
 *    context — the failure is STABLE, not transient.
 *
 * So: when a turn ends thinking → listening directly (no 'speaking' ever
 * happened — not even a filler, which would have moved the state to
 * 'speaking'), the RUNTIME forces a reply: generateReply with toolChoice
 * 'none', so the model must speak and cannot re-enter the tool loop. If that
 * forced turn ALSO dies silent (it shouldn't — no tools, no cap), we escalate
 * once to the pre-synthesized recovery line and stop; an unbounded nudge loop
 * would be its own bug.
 *
 * Honesty rules (gotcha D) hold here too: we never speak while the caller is
 * mid-utterance (their new turn is already the recovery — nudging would talk
 * over them), and the nudge claims nothing about work not done.
 *
 * DELIBERATELY SEPARATE from attachOutputWatchdog and NOT behind
 * ENABLE_OUTPUT_WATCHDOG: prod runs with that flag OFF (found 2026-07-17), and
 * a turn that ends in permanent silence is a dropped call, not a UX polish
 * option. index.ts attaches this unconditionally.
 */
export function attachSilentTurnRecovery(
  session: voice.AgentSession,
  opts: {
    /** Tenant voice id (cache key for the pre-synthesized recovery clip). */
    voice: string;
    /** Escalation line if the forced reply itself produces no audio. */
    recoveryText: string;
    log: { info: LogFn; warn: LogFn };
  }
): () => void {
  // True from the moment we fire a nudge until any agent audio plays. If a
  // second silent death arrives while this is set, the nudge itself failed —
  // escalate to the canned line instead of nudging forever.
  let nudgeInFlight = false;

  const onAgentState = (ev: voice.AgentStateChangedEvent) => {
    if (ev.newState === 'speaking') {
      nudgeInFlight = false;
      return;
    }
    // thinking → listening with no 'speaking' in between: the turn produced
    // zero audio and is already over. (A slow turn passes through 'speaking'
    // for its reply — or for the watchdog's filler — before 'listening'.)
    if (ev.oldState !== 'thinking' || ev.newState !== 'listening') return;

    // The caller is mid-utterance (barge-in / a new turn already forming):
    // their speech will drive the next reply. Speaking now would talk over
    // them (gotcha D) and race the incoming turn.
    if (session.userState === 'speaking') {
      opts.log.info(
        { event: 'silent_turn_death_deferred' },
        'turn ended with no audio, but the caller is speaking — their turn is the recovery'
      );
      return;
    }

    if (nudgeInFlight) {
      // The forced reply ALSO died silent. Stop generating; say the canned line.
      nudgeInFlight = false;
      opts.log.warn(
        { event: 'silent_turn_recovery_escalated' },
        'forced reply also produced no audio — playing the recovery line'
      );
      const frame = getFillerFrame(opts.voice, opts.recoveryText);
      try {
        // SpeechHandle is a thenable — fire-and-forget, explicitly discarded.
        void session.say(opts.recoveryText, {
          ...(frame ? { audio: frameStream(frame) } : {}),
          allowInterruptions: true,
          addToChatCtx: false,
        });
      } catch {
        // Session draining/closed — nothing to play into, nothing to do.
      }
      return;
    }

    nudgeInFlight = true;
    opts.log.warn(
      { event: 'silent_turn_recovered' },
      'turn ended with no audio (tool-step cap or empty generation) — forcing a spoken, tool-free reply'
    );
    try {
      // SpeechHandle thenable, fire-and-forget — playout is the framework's job.
      void session.generateReply({
        instructions: NUDGE_INSTRUCTIONS,
        toolChoice: 'none',
        allowInterruptions: true,
      });
    } catch (e) {
      // Draining/closed. Do not retry — the session is going away.
      nudgeInFlight = false;
      opts.log.warn(
        {
          event: 'silent_turn_recovery_failed',
          error_message: e instanceof Error ? e.message : String(e),
        },
        'silent-turn recovery could not speak — session not accepting speech'
      );
    }
  };

  session.on(voice.AgentSessionEventTypes.AgentStateChanged, onAgentState);
  return () => {
    session.off(voice.AgentSessionEventTypes.AgentStateChanged, onAgentState);
  };
}
