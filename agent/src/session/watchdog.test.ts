/**
 * Tests for the output watchdog state machine. We drive a fake AgentSession by
 * emitting agent_state_changed transitions and use fake timers to cross the
 * deadlines — no real audio/TTS. (The acoustic behavior on a live call is a
 * separate, manual validation item per the never-silent spec.)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toolStarted, toolFinished, _resetToolActivityForTest } from './toolActivity.js';
import { voice } from '@livekit/agents';
import { attachOutputWatchdog, attachSilentTurnRecovery, NUDGE_INSTRUCTIONS } from './watchdog.js';
import { _resetFillerCacheForTest } from './fillerCache.js';

const STATE_EV = voice.AgentSessionEventTypes.AgentStateChanged;
const noopLog = { info: () => {}, warn: () => {} };
const FILLER = 'One moment while I check that for you.';
const RECOVERY = 'Sorry, this is taking me a moment.';

interface FakeHandle {
  id: string;
  addDoneCallback: (cb: () => void) => void;
  fireDone: () => void;
  interrupted: boolean;
  interrupt: () => void;
}

function makeFakeSession() {
  const handlers: Record<string, Array<(ev: unknown) => void>> = {};
  let agentState = 'listening';
  let userState = 'listening';
  const sayCalls: Array<{ text: string; opts: unknown }> = [];
  const generateReplyCalls: Array<Record<string, unknown>> = [];
  const handles: FakeHandle[] = [];
  let n = 0;

  const session = {
    get agentState() {
      return agentState;
    },
    get userState() {
      return userState;
    },
    generateReply(opts: Record<string, unknown>) {
      generateReplyCalls.push(opts);
      return { addDoneCallback: () => {} };
    },
    on(ev: string, cb: (ev: unknown) => void) {
      (handlers[ev] ??= []).push(cb);
    },
    off(ev: string, cb: (ev: unknown) => void) {
      handlers[ev] = (handlers[ev] ?? []).filter((h) => h !== cb);
    },
    say(text: string, opts: unknown) {
      sayCalls.push({ text, opts });
      const cbs: Array<() => void> = [];
      const handle: FakeHandle = {
        id: `h${n++}`,
        addDoneCallback: (cb) => cbs.push(cb),
        fireDone: () => cbs.forEach((c) => c()),
        interrupted: false,
        interrupt: () => {
          handle.interrupted = true;
        },
      };
      handles.push(handle);
      return handle;
    },
    // The internal activity the watchdog probes for an already-queued reply.
    // Absent by default (pre-guard behavior); tests set it via setActivity.
    activity: undefined as unknown,
  };

  const emit = (newState: string) => {
    const oldState = agentState;
    agentState = newState;
    (handlers[STATE_EV] ?? []).forEach((cb) =>
      cb({ type: STATE_EV, oldState, newState, createdAt: 0 })
    );
  };

  return {
    session: session as unknown as voice.AgentSession,
    sayCalls,
    generateReplyCalls,
    handles,
    emit,
    setUserState: (s: string) => {
      userState = s;
    },
    setActivity: (a: unknown) => {
      (session as { activity: unknown }).activity = a;
    },
  };
}

describe('attachOutputWatchdog', () => {
  beforeEach(() => {
    _resetFillerCacheForTest();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  const attach = (s: ReturnType<typeof makeFakeSession>) =>
    attachOutputWatchdog(s.session, {
      voice: 'eve',
      thinkingText: 'Just a moment.',
      fillerText: FILLER,
      recoveryText: RECOVERY,
      log: noopLog,
    });

  it("SAD: stuck 'thinking' past deadline 1 WITH A TOOL RUNNING → names the lookup", async () => {
    // WHO: a caller waiting on a genuinely slow tool (availability, policy RAG — 2-4s).
    // WHAT: after deadline1 of 'thinking' with no 'speaking', the watchdog holds the line
    //       and it is ALLOWED to say what it is doing, because it really is doing it.
    _resetToolActivityForTest();
    toolStarted();
    const f = makeFakeSession();
    attach(f);
    f.emit('thinking');
    await vi.advanceTimersByTimeAsync(2500);
    expect(f.sayCalls).toHaveLength(1);
    expect(f.sayCalls[0].text).toBe(FILLER);
    toolFinished();
  });

  it('SAD: stuck thinking with NO tool running → asks for a moment, and CLAIMS NOTHING', async () => {
    // WHO: every caller, on nearly every turn — the STT→gpt-4o-mini→TTS pipeline
    //      routinely takes longer than the deadline to produce a first word.
    // WHAT: the hold line must NOT say "let me check that for you" when nothing is
    //      being checked.
    // WHY:  on the 2026-07-14 call it said exactly that SEVEN TIMES, and every tool on
    //      that call returned in under 15ms. Nothing was ever being looked up. The
    //      caller could tell, and said so, mid-call: "what are you checking?" and
    //      "what am I waiting for?"
    //
    //      This is the same defect as the prompt line we deleted for letting the MODEL
    //      claim work it had not done — except here the RUNTIME was doing the lying, on
    //      a timer. A machine lying on a schedule is still lying. The watchdog stays
    //      cause-AGNOSTIC about when it fires (dead air is dead air) and becomes
    //      cause-HONEST about what it says.
    _resetToolActivityForTest();
    const f = makeFakeSession();
    attach(f);
    f.emit('thinking');
    await vi.advanceTimersByTimeAsync(2500);
    expect(f.sayCalls).toHaveLength(1);
    expect(f.sayCalls[0].text).toBe('Just a moment.');
    expect(f.sayCalls[0].text).not.toMatch(/check|look|find/i);
  });

  it('HAPPY: real audio before deadline 1 → no filler ever plays', async () => {
    // WHO: a normal fast turn. WHAT: 'speaking' arrives before the deadline → disarm.
    const f = makeFakeSession();
    attach(f);
    f.emit('thinking');
    await vi.advanceTimersByTimeAsync(1000);
    f.emit('speaking'); // real reply audio, no filler outstanding → disarm
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.sayCalls).toHaveLength(0);
  });

  it('SAD: still no audio past deadline 2 → escalates to the recovery line', async () => {
    // A tool IS running here — otherwise deadline 1 speaks the neutral line and this
    // test would be asserting the wrong first utterance.
    _resetToolActivityForTest();
    toolStarted();
    const f = makeFakeSession();
    attach(f);
    f.emit('thinking');
    await vi.advanceTimersByTimeAsync(2500); // filler
    await vi.advanceTimersByTimeAsync(4000); // recovery
    expect(f.sayCalls.map((c) => c.text)).toEqual([FILLER, RECOVERY]);
  });

  it("the filler's OWN 'speaking' doesn't disarm; once it's done + real audio plays, no recovery", async () => {
    // WHO: filler plays, then the real reply follows (serialized after it).
    // WHAT: 'speaking' while the filler is still playing must NOT be mistaken for
    //        real audio; only after the filler is done does a 'speaking' disarm.
    const f = makeFakeSession();
    attach(f);
    f.emit('thinking');
    await vi.advanceTimersByTimeAsync(2500); // filler plays (handle h0)
    expect(f.sayCalls).toHaveLength(1);
    f.emit('speaking'); // this is the FILLER speaking (h0 not done) → must not disarm
    f.handles[0].fireDone(); // filler playout completes
    f.emit('speaking'); // now the REAL reply → disarm
    await vi.advanceTimersByTimeAsync(4000); // recovery window passes
    expect(f.sayCalls).toHaveLength(1); // filler only, NO recovery
  });

  it('SAD, live: reply queued BEHIND the filler → same continuous speaking state → recovery must NOT stomp it', async () => {
    // WHO: the 2026-07-21 question-tree test caller, mid slot-offer.
    // WHAT: the filler played at 93.6s, the real reply started at 94.6s while the
    //       agent was ALREADY in 'speaking' — the state never transitioned again, so
    //       the "a later 'speaking' disarms" assumption never got its event, timer2
    //       survived, and the recovery line played at 97.6s OVER the live slot offer.
    // WHERE: the speech queue serializes filler → reply inside ONE 'speaking' span.
    // WHY: the disarm must key off the FILLER'S PLAYOUT COMPLETING while audio is
    //       still rolling (that audio IS the reply), not off a transition that only
    //       exists when the reply starts from silence.
    _resetToolActivityForTest();
    const f = makeFakeSession();
    attach(f);
    f.emit('thinking');
    await vi.advanceTimersByTimeAsync(2500); // filler plays (handle h0)
    f.emit('speaking'); // the filler's own audio — one transition, never another
    f.handles[0].fireDone(); // filler playout completes; agent STILL 'speaking' = the real reply
    await vi.advanceTimersByTimeAsync(300); // the settle beat → disarm
    await vi.advanceTimersByTimeAsync(4000); // recovery window passes
    expect(f.sayCalls).toHaveLength(1); // filler only — the reply is never talked over
  });

  it('SAD, still covered: filler done while agent NOT speaking (genuine dead air) → recovery still fires', async () => {
    // The settle-beat disarm must not swallow real dead air: the filler's playout
    // completes while the agent state is still 'thinking' (no reply audio ever
    // came) → the beat finds no speaking → timer2 survives → recovery.
    _resetToolActivityForTest();
    const f = makeFakeSession();
    attach(f);
    f.emit('thinking');
    await vi.advanceTimersByTimeAsync(2500); // filler plays; state stays 'thinking'
    f.handles[0].fireDone(); // filler playout over, still dead air
    await vi.advanceTimersByTimeAsync(300); // settle beat: NOT speaking → no disarm
    await vi.advanceTimersByTimeAsync(4000);
    expect(f.sayCalls.map((c) => c.text)).toEqual(['Just a moment.', RECOVERY]);
  });

  it('SAD, live 2: reply already QUEUED at deadline 1 → no filler, no recovery — audio is imminent', async () => {
    // WHO: the 2026-07-21 second stomp call. The reply's SpeechHandle joins the
    // queue ~300ms before its audio starts; the filler fired inside that window,
    // queued BEHIND the reply, and the caller heard question + "Just a moment."
    // + recovery run together ("you're running all these sentences together").
    // WHAT: with a speech scheduled or playing, the filler is clutter — skip it
    // and the escalation entirely.
    _resetToolActivityForTest();
    const f = makeFakeSession();
    attach(f);
    f.setActivity({ currentSpeech: {}, speechQueue: { size: () => 0 } });
    f.emit('thinking');
    await vi.advanceTimersByTimeAsync(2500 + 4000);
    expect(f.sayCalls).toHaveLength(0);
  });

  it('SAD, live 2 race: reply slips in AFTER the filler → recovery skipped, stray filler cancelled', async () => {
    // The narrower race: the queue was empty when the filler fired, but the
    // reply got scheduled moments later — at deadline2 the agent is 'speaking'
    // (the ~1.2s filler cannot still be playing 4s on, so that audio IS the
    // reply). The recovery must NOT stack a third line onto live output, and
    // the filler still queued behind the reply must be interrupted so it never
    // plays as a stray after-thought.
    _resetToolActivityForTest();
    const f = makeFakeSession();
    attach(f);
    f.emit('thinking');
    await vi.advanceTimersByTimeAsync(2500); // filler fires (queue looked empty)
    expect(f.sayCalls).toHaveLength(1);
    f.emit('speaking'); // audio starts — actually the REPLY; filler never plays
    await vi.advanceTimersByTimeAsync(4000); // deadline2
    expect(f.sayCalls).toHaveLength(1); // no recovery line
    expect(f.handles[0].interrupted).toBe(true); // stray filler cancelled
  });

  it('detach() clears a pending timer (no filler after teardown)', async () => {
    const f = makeFakeSession();
    const detach = attach(f);
    f.emit('thinking');
    detach();
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.sayCalls).toHaveLength(0);
  });
});

describe('attachSilentTurnRecovery', () => {
  beforeEach(() => _resetFillerCacheForTest());

  const attachRecovery = (s: ReturnType<typeof makeFakeSession>) =>
    attachSilentTurnRecovery(s.session, {
      voice: 'eve',
      recoveryText: RECOVERY,
      log: noopLog,
    });

  it('SAD: turn dies thinking → listening with no audio → forces a spoken, TOOL-FREE reply', () => {
    // WHO: the 2026-07-17 live caller ("Monday at 1:30"). WHAT: the model burned
    // its maxToolSteps on lookups, LiveKit ended the turn with NO speech, and the
    // agent went thinking → listening in silence. WHERE: the exact transition the
    // hold-line watchdog treats as "resolved". WHY: the caller said "Hello?" twice
    // into the void and hung up — the runtime, not the model, must fill this.
    const f = makeFakeSession();
    attachRecovery(f);
    f.emit('thinking');
    f.emit('listening'); // turn OVER, zero audio
    expect(f.generateReplyCalls).toHaveLength(1);
    // toolChoice 'none' is what makes the forced turn un-killable by the same
    // cap — no tools, no steps, the only move is words.
    expect(f.generateReplyCalls[0].toolChoice).toBe('none');
    expect(f.generateReplyCalls[0].instructions).toBe(NUDGE_INSTRUCTIONS);
  });

  it('HAPPY: a normal turn (thinking → speaking → listening) never triggers it', () => {
    const f = makeFakeSession();
    attachRecovery(f);
    f.emit('thinking');
    f.emit('speaking'); // real reply
    f.emit('listening'); // normal turn end
    expect(f.generateReplyCalls).toHaveLength(0);
    expect(f.sayCalls).toHaveLength(0);
  });

  it('SAD but deferred: caller is mid-utterance when the turn dies → stays quiet (gotcha D)', () => {
    // WHO: a caller who barged in while the agent was thinking. WHAT: their own
    // new turn IS the recovery; speaking now would talk over them. WHY: gotcha D —
    // the runtime must never fill silence by talking over a human.
    const f = makeFakeSession();
    attachRecovery(f);
    f.setUserState('speaking');
    f.emit('thinking');
    f.emit('listening');
    expect(f.generateReplyCalls).toHaveLength(0);
    expect(f.sayCalls).toHaveLength(0);
  });

  it('SAD, twice: the forced reply ALSO dies silent → escalates ONCE to the canned recovery line', () => {
    // WHAT: if the nudged turn somehow produces no audio either, we must not
    // nudge forever (an unbounded generate loop is its own bug) — one canned
    // line, then stop.
    const f = makeFakeSession();
    attachRecovery(f);
    f.emit('thinking');
    f.emit('listening'); // death #1 → nudge
    expect(f.generateReplyCalls).toHaveLength(1);
    f.emit('thinking');
    f.emit('listening'); // death #2, nudge still unresolved → canned line, no second nudge
    expect(f.generateReplyCalls).toHaveLength(1);
    expect(f.sayCalls.map((c) => c.text)).toEqual([RECOVERY]);
  });

  it('recovers repeatedly across the call: audio between deaths re-arms the nudge', () => {
    // WHAT: once ANY agent audio plays, the in-flight flag clears — a later,
    // unrelated silent death gets its own fresh nudge (not the escalation path).
    const f = makeFakeSession();
    attachRecovery(f);
    f.emit('thinking');
    f.emit('listening'); // death #1 → nudge
    f.emit('speaking'); // the nudged reply plays — cycle resolved
    f.emit('listening');
    f.emit('thinking');
    f.emit('listening'); // death #2, fresh cycle → nudge again
    expect(f.generateReplyCalls).toHaveLength(2);
    expect(f.sayCalls).toHaveLength(0);
  });

  it('detach() removes the listener (no nudge after teardown)', () => {
    const f = makeFakeSession();
    const detach = attachRecovery(f);
    detach();
    f.emit('thinking');
    f.emit('listening');
    expect(f.generateReplyCalls).toHaveLength(0);
  });

  it('a CLOSING session never gets nudged — the teardown flap is not a silent death', () => {
    // WHO: every clean hang-up on 2026-07-21. finish_call's goodbye plays, the
    // session tears down, and the closing state flap (thinking → listening with
    // no speech) looked exactly like the failure this recovery exists for —
    // generateReply then threw "AgentSession is closing" and logged a failure
    // on every successful call. A goodbye is not a death.
    const f = makeFakeSession();
    attachRecovery(f);
    (f.session as unknown as { closing?: boolean }).closing = true;
    f.emit('thinking');
    f.emit('listening');
    expect(f.generateReplyCalls).toHaveLength(0);
    expect(f.sayCalls).toHaveLength(0);
  });

  it('the nudge wording carries the two live-firing lessons (re-ask; end with a question)', () => {
    // WHO: the 2026-07-17 16:02 UTC caller, on the recovery's FIRST live firing.
    // WHAT: v1 said "use what you already know" → the model answered its OWN
    //       pending read-back question ("Thank you! That's correct") — the
    //       caller never confirmed the number. And it promised "one moment"
    //       from a turn that holds no tools, then sat quiet for 20s.
    // WHY: pin the two load-bearing phrases so a future rewording can't
    //       silently drop either lesson.
    expect(NUDGE_INSTRUCTIONS).toMatch(/ask that question again/i);
    expect(NUDGE_INSTRUCTIONS).toMatch(/you do not know their answer/i);
    expect(NUDGE_INSTRUCTIONS).toMatch(/end by asking the caller a question/i);
    expect(NUDGE_INSTRUCTIONS).not.toMatch(/what you already know/i);
  });
});
