/**
 * Tests for the output watchdog state machine. We drive a fake AgentSession by
 * emitting agent_state_changed transitions and use fake timers to cross the
 * deadlines — no real audio/TTS. (The acoustic behavior on a live call is a
 * separate, manual validation item per the never-silent spec.)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
      fillerText: FILLER,
      recoveryText: RECOVERY,
      log: noopLog,
    });

  it("SAD: stuck 'thinking' past deadline 1 → plays the filler line", async () => {
    // WHO: a turn where no agent audio is produced (slow TTS / stalled tool / silent LLM).
    // WHAT: after deadline1 of 'thinking' with no 'speaking', the watchdog speaks the hold line.
    const f = makeFakeSession();
    attach(f);
    f.emit('thinking');
    await vi.advanceTimersByTimeAsync(2500);
    expect(f.sayCalls).toHaveLength(1);
    expect(f.sayCalls[0].text).toBe(FILLER);
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
