/**
 * Tests for the output watchdog state machine. We drive a fake AgentSession by
 * emitting agent_state_changed transitions and use fake timers to cross the
 * deadlines — no real audio/TTS. (The acoustic behavior on a live call is a
 * separate, manual validation item per the never-silent spec.)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toolStarted, toolFinished, _resetToolActivityForTest } from './toolActivity.js';
import { voice } from '@livekit/agents';
import { attachOutputWatchdog } from './watchdog.js';
import { _resetFillerCacheForTest } from './fillerCache.js';

const STATE_EV = voice.AgentSessionEventTypes.AgentStateChanged;
const noopLog = { info: () => {}, warn: () => {} };
const FILLER = 'One moment while I check that for you.';
const RECOVERY = 'Sorry, this is taking me a moment.';

interface FakeHandle {
  id: string;
  addDoneCallback: (cb: () => void) => void;
  fireDone: () => void;
}

function makeFakeSession() {
  const handlers: Record<string, Array<(ev: unknown) => void>> = {};
  let agentState = 'listening';
  let userState = 'listening';
  const sayCalls: Array<{ text: string; opts: unknown }> = [];
  const handles: FakeHandle[] = [];
  let n = 0;

  const session = {
    get userState() {
      return userState;
    },
    setUserState(v: string) {
      userState = v;
    },
    get agentState() {
      return agentState;
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
      };
      handles.push(handle);
      return handle;
    },
  };

  const emit = (newState: string) => {
    const oldState = agentState;
    agentState = newState;
    (handlers[STATE_EV] ?? []).forEach((cb) =>
      cb({ type: STATE_EV, oldState, newState, createdAt: 0 })
    );
  };

  /** The caller's state — the thing the watchdog used to ignore, and talk over. */
  const setUserState = (v: string) => {
    userState = v;
  };

  return {
    session: session as unknown as voice.AgentSession,
    sayCalls,
    handles,
    emit,
    setUserState,
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

  it('SAD: the hold line NEVER plays while the caller is still speaking', async () => {
    // WHO: a caller halfway through saying his name.
    // WHEN: 2026-07-14, a real call.
    //
    //   Assistant: "What is your name?"
    //   Caller:    (starts his name, pauses for breath)
    //   -> the endpointer closes his turn at the pause; the agent enters 'thinking'
    //   -> 2.8s later the watchdog plays "Just a moment." STRAIGHT OVER HIM
    //   Caller:    "You never got my name."
    //
    // His name was lost. Barge-in is OFF by product decision, so he could not talk
    // through it — he had to sit and listen to the interruption and start again. His
    // verdict: "coming back too quick", "no time to answer questions".
    //
    // The watchdog watched the AGENT for silence and never once looked at the CALLER.
    // But a hold line exists to reassure someone who is WAITING. Played at someone
    // mid-sentence it is the exact opposite — the machine deciding its own silence
    // matters more than their voice. **If the caller is speaking there IS no dead air**,
    // and the only thing that can spoil the call is us.
    // A tool IS running — so a hold line is legitimate here, and would play if the
    // caller were silent. The ONLY reason it must not is that he is mid-sentence.
    _resetToolActivityForTest();
    toolStarted();
    const f = makeFakeSession();
    attach(f);
    f.emit('thinking');
    f.setUserState('speaking'); // he is mid-sentence

    await vi.advanceTimersByTimeAsync(2500);
    expect(f.sayCalls, 'must not talk over a speaking caller').toHaveLength(0);

    // ...and it re-arms, so a genuinely slow tool is still covered once he stops.
    f.setUserState('listening');
    await vi.advanceTimersByTimeAsync(2500);
    expect(f.sayCalls).toHaveLength(1);
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

    // NOTHING. The agent is not working — it is waiting — and a machine that fills the
    // silence while it waits for a human to answer is talking over them.
    //
    // The owner's instruction, after it cut him off mid-name: "I need ALL questions to
    // have a watchdog and wait for the answer." A question is an invitation to speak;
    // the rudest thing you can do after asking one is make a noise. And barge-in is OFF,
    // so he cannot talk through it — he has to stop, listen, and start again.
    expect(f.sayCalls, 'a waiting agent must be SILENT').toHaveLength(0);
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

  it('detach() clears a pending timer (no filler after teardown)', async () => {
    const f = makeFakeSession();
    const detach = attach(f);
    f.emit('thinking');
    detach();
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.sayCalls).toHaveLength(0);
  });
});
