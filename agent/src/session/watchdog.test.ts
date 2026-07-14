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
  const sayCalls: Array<{ text: string; opts: unknown }> = [];
  const handles: FakeHandle[] = [];
  let n = 0;

  const session = {
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

  return { session: session as unknown as voice.AgentSession, sayCalls, handles, emit };
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

  it('detach() clears a pending timer (no filler after teardown)', async () => {
    const f = makeFakeSession();
    const detach = attach(f);
    f.emit('thinking');
    detach();
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.sayCalls).toHaveLength(0);
  });
});
