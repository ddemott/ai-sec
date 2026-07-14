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

    // NEVER TALK OVER THE CALLER.
    //
    // The watchdog watched the AGENT for silence and never once looked at the CALLER.
    // So this happened, on a real call (2026-07-14):
    //
    //   Assistant: "What is your name?"
    //   Caller:    (starts saying his name, pauses for breath)
    //   -> the endpointer closes his turn at the pause, the agent enters 'thinking'
    //   -> 2.8s later the watchdog plays "Just a moment." ON TOP OF HIM
    //   Caller:    "You never got my name."
    //
    // His name was lost. And because barge-in is OFF by product decision, he could not
    // talk through it — he had to sit and listen to the interruption, then start again.
    // His verdict: "coming back too quick", "no time to answer questions".
    //
    // A hold line exists to reassure someone who is WAITING. Playing it at someone who
    // is mid-sentence is the exact opposite: it is the machine deciding its own silence
    // matters more than their voice. If the caller is speaking, there IS no dead air —
    // the call is going fine, and the only thing that can spoil it is us.
    //
    // So: if the user is speaking, stand down and re-arm. We will get another chance
    // the moment they stop, and if the agent really is stuck, the deadline fires then.
    if (session.userState === 'speaking') {
      timer1 = setTimeout(fireFiller, deadline1);
      return;
    }

    // Re-check: the real reply may have started between the timer scheduling and
    // now. Only hold the line if the agent is still thinking (no audio yet).
    if (session.agentState !== 'thinking') return;

    // THE AGENT ONLY SPEAKS WHEN IT IS ACTUALLY DOING SOMETHING.
    //
    // The hold line now plays ONLY while a tool is genuinely in flight. If no tool is
    // running, the agent is not working — it is waiting — and a machine that fills the
    // silence while it waits for a human to answer is not being helpful, it is talking
    // over them.
    //
    // The owner's instruction, after the call where it cut him off mid-name: "I need
    // ALL questions to have a watchdog and wait for the answer." That is the right
    // design, and it is stronger than the userState guard above (which only catches the
    // caller once they have already STARTED speaking — it cannot help the person who is
    // still drawing breath, or thinking, or reading a number off a screen).
    //
    // A question is an invitation to speak. The single rudest thing you can do after
    // asking one is make a noise. And here it is worse than rude: barge-in is OFF, so
    // the caller cannot talk through the interruption — they must stop, listen, and
    // start their answer again.
    //
    // The cost, accepted: pure LLM latency (~2-3s) is no longer covered by a spoken
    // line. That is a pause, and a pause after a question reads as LISTENING. The
    // deadline-2 recovery line still fires for a genuinely stuck turn, so a truly dead
    // call is never left dead. If the ambient cover is ever wanted back, that is what
    // ENABLE_THINKING_SOUND is for — a bed, not a sentence.
    if (!isToolRunning()) {
      timer2 = setTimeout(fireRecovery, deadline2);
      return;
    }

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
