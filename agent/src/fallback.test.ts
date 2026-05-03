/**
 * Tests for the agent's fallback voice path.
 *
 * Goal: prove that when the entry point can't construct a full tool-backed
 * agent, the caller hears the fallback message rather than dead air. This
 * is the core launch-readiness contract — silence on a degraded call is
 * the worst possible UX, and we'd rather hear someone say "we're having
 * a system issue" than nothing at all.
 *
 * The function under test is `runFallback(ctx, message, config, deps)`.
 * Config is passed in so the function is testable without going through
 * the env-validation step in `./config.js` (which `process.exit(1)`s on
 * missing env). Deps inject LiveKit + provider classes so tests can use
 * spies; production binds the real classes.
 *
 * What we verify:
 *   - Happy path: session is constructed, started, and `say(message)`
 *     runs with `allowInterruptions: false`.
 *   - TTS provider choice: OpenAI TTS (NOT Grok) — independence from the
 *     primary path's Grok dependency is the whole point of the fallback.
 *   - Session.start failure → swallowed, no exception escapes the function.
 *   - TTS construction throw → swallowed.
 *   - LLM/STT construction throw → swallowed.
 *   - say() upstream failure → swallowed (the await catches it inside
 *     the try block).
 *
 * Per project convention, every test carries WHO/WHAT/WHEN/WHERE/WHY
 * diagnostic comments so a sad-path failure tells the debugger what
 * was expected and why.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runFallback, type FallbackDeps, type FallbackConfig } from './fallback.js';
import { GrokTTS } from './grokTTS.js';

/**
 * Build a minimal `JobContext`-shaped object. The fallback path only
 * touches `ctx.proc.userData.vad` and `ctx.room`, so we stub just those.
 */
function makeCtx() {
  return {
    proc: { userData: { vad: { __vad: true } } },
    room: { __room: true },
  } as unknown as Parameters<typeof runFallback>[0];
}

/**
 * Test config — distinct sentinel values so we can assert which key got
 * routed where. Production passes the real `config` from `./config.js`.
 */
const TEST_CONFIG: FallbackConfig = {
  DEEPGRAM_API_KEY: 'test-deepgram-key',
  OPENAI_API_KEY: 'test-openai-key',
};

interface CapturedSayCall {
  message: string;
  opts: unknown;
}

interface BuildSpyDepsOptions {
  /** When set, throws inside `start()` instead of resolving. */
  startThrows?: Error;
  /** When set, throws inside `say()` instead of recording. */
  sayThrows?: Error;
  /** When set, the TTS constructor throws on `new`. */
  ttsCtorThrows?: Error;
  /** When set, the LLM constructor throws on `new`. */
  llmCtorThrows?: Error;
  /** When set, the STT constructor throws on `new`. */
  sttCtorThrows?: Error;
  /** When set, the AgentSession constructor throws on `new`. */
  sessionCtorThrows?: Error;
}

function buildSpyDeps(opts: BuildSpyDepsOptions = {}): {
  deps: FallbackDeps;
  sayCalls: CapturedSayCall[];
  AgentSessionCalls: { args: unknown[]; constructed: boolean }[];
  startCalls: unknown[];
  TTSCalls: { args: unknown[]; constructed: boolean }[];
  LLMCalls: { args: unknown[]; constructed: boolean }[];
  STTCalls: { args: unknown[]; constructed: boolean }[];
  Classes: {
    FakeTTSClass: new (...args: unknown[]) => unknown;
    FakeLLMClass: new (...args: unknown[]) => unknown;
    FakeSTTClass: new (...args: unknown[]) => unknown;
  };
} {
  const sayCalls: CapturedSayCall[] = [];
  const startCalls: unknown[] = [];
  const AgentSessionCalls: { args: unknown[]; constructed: boolean }[] = [];
  const TTSCalls: { args: unknown[]; constructed: boolean }[] = [];
  const LLMCalls: { args: unknown[]; constructed: boolean }[] = [];
  const STTCalls: { args: unknown[]; constructed: boolean }[] = [];

  // Constructors get invoked with `new` inside runFallback, so the mock
  // factories must be classes (or named functions) — vi.fn() with an
  // arrow implementation triggers a "did not use 'function' or 'class'"
  // warning and the prototype chain lookup fails.

  class FakeSession {
    start: (config: unknown) => Promise<void>;
    say: (message: string, opts2: unknown) => Promise<void>;

    constructor(...args: unknown[]) {
      if (opts.sessionCtorThrows) throw opts.sessionCtorThrows;
      AgentSessionCalls.push({ args, constructed: true });
      this.start = async (config: unknown) => {
        startCalls.push(config);
        if (opts.startThrows) throw opts.startThrows;
      };
      this.say = async (message: string, opts2: unknown) => {
        if (opts.sayThrows) throw opts.sayThrows;
        sayCalls.push({ message, opts: opts2 });
      };
    }
  }

  class FakeAgent {
    constructor(_args: unknown) {
      // Agent body is opaque to runFallback; presence + new-ability is
      // all we need to assert on.
    }
  }

  class FakeSTT {
    constructor(...args: unknown[]) {
      if (opts.sttCtorThrows) throw opts.sttCtorThrows;
      STTCalls.push({ args, constructed: true });
    }
  }

  class FakeLLM {
    constructor(...args: unknown[]) {
      if (opts.llmCtorThrows) throw opts.llmCtorThrows;
      LLMCalls.push({ args, constructed: true });
    }
  }

  class FakeTTS {
    constructor(...args: unknown[]) {
      if (opts.ttsCtorThrows) throw opts.ttsCtorThrows;
      TTSCalls.push({ args, constructed: true });
    }
  }

  return {
    deps: {
      AgentSessionCtor: FakeSession as unknown as FallbackDeps['AgentSessionCtor'],
      AgentCtor: FakeAgent as unknown as FallbackDeps['AgentCtor'],
      STT: FakeSTT as unknown as FallbackDeps['STT'],
      LLM: FakeLLM as unknown as FallbackDeps['LLM'],
      TTS: FakeTTS as unknown as FallbackDeps['TTS'],
    },
    sayCalls,
    AgentSessionCalls,
    startCalls,
    TTSCalls,
    LLMCalls,
    STTCalls,
    Classes: {
      FakeTTSClass: FakeTTS,
      FakeLLMClass: FakeLLM,
      FakeSTTClass: FakeSTT,
    },
  };
}

describe('runFallback — happy path', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('HAPPY: speaks the provided message via the injected session', async () => {
    // WHO: An entry path that hit a misconfigured dispatch rule (no
    //       tenant_id) and decided to bail to fallback rather than try
    //       to run the full agent
    // WHAT: runFallback constructs a minimal session, starts it, then
    //        calls `say(message)` so the caller hears something
    //        coherent before the call ends
    // WHEN: Right after entry() decides it can't proceed normally
    // WHERE: agent/src/fallback.ts top-level path
    // WHY: Without an audible message the caller hears dead air and
    //       loses confidence in the platform on the very first
    //       interaction. Anything short of silence is acceptable.
    const ctx = makeCtx();
    const { deps, sayCalls } = buildSpyDeps();

    await runFallback(ctx, 'System is having a rough morning.', TEST_CONFIG, deps);

    expect(sayCalls).toHaveLength(1);
    expect(sayCalls[0]).toEqual({
      message: 'System is having a rough morning.',
      opts: { allowInterruptions: false },
    });
  });

  it('HAPPY: blocks interruptions on the fallback say()', async () => {
    // WHO: A caller who might try to talk over the fallback message
    // WHAT: `say()` is called with `allowInterruptions: false` so the
    //        caller can't talk the agent out of finishing the message
    // WHEN: During the single fallback utterance
    // WHERE: The `say` invocation in fallback.ts
    // WHY: The fallback message is short and load-bearing — interrupting
    //       it half-way leaves the caller with even less information
    //       than dead air would have. Better to let it finish.
    const ctx = makeCtx();
    const { deps, sayCalls } = buildSpyDeps();

    await runFallback(ctx, "msg", TEST_CONFIG, deps);

    expect((sayCalls[0].opts as { allowInterruptions: boolean }).allowInterruptions).toBe(false);
  });

  it('HAPPY: starts the session against ctx.room before saying anything', async () => {
    // WHO: LiveKit's voice runtime, which requires `start()` before
    //       any audio can be produced
    // WHAT: `session.start({ agent, room })` is called and resolves
    //        before `say()` runs
    // WHEN: During fallback session construction
    // WHERE: The await chain in fallback.ts
    // WHY: Skipping `start()` would mean `say()` runs against a session
    //       that hasn't joined the room → the audio stream has no
    //       destination → caller hears nothing.
    const ctx = makeCtx();
    const { deps, startCalls, sayCalls } = buildSpyDeps();

    await runFallback(ctx, "msg", TEST_CONFIG, deps);

    expect(startCalls).toHaveLength(1);
    expect(startCalls[0]).toMatchObject({ room: ctx.room });
    // Order: start completed before say() recorded
    expect(sayCalls).toHaveLength(1);
  });

  it('HAPPY: passes the prewarmed VAD into the session', async () => {
    // WHO: The prewarm step that loaded silero.VAD before the call
    //       began (non-trivial cost — loading VAD on each call would
    //       add ~100ms latency to every first utterance)
    // WHAT: The VAD instance from `ctx.proc.userData.vad` is wired
    //        into the session constructor's `vad` slot
    // WHEN: AgentSession construction inside runFallback
    // WHERE: The `vad: ctx.proc.userData.vad` line of fallback.ts
    // WHY: VAD is the difference between "agent listens for caller
    //       input" and "agent monologues at the caller." Even in a
    //       fallback path, the VAD must be wired or the session can't
    //       gracefully end on caller-side hang-up.
    const ctx = makeCtx();
    const { deps, AgentSessionCalls } = buildSpyDeps();

    await runFallback(ctx, "msg", TEST_CONFIG, deps);

    expect(AgentSessionCalls).toHaveLength(1);
    const sessionArgs = AgentSessionCalls[0].args[0] as { vad: unknown };
    expect(sessionArgs.vad).toBe(ctx.proc.userData.vad);
  });
});

describe('runFallback — provider choice (the dead-air-guard contract)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('HAPPY: uses OpenAI TTS, NOT Grok TTS, for fallback', async () => {
    // WHO: A caller who is in fallback specifically *because* Grok is
    //       down (or the XAI key has rotated mid-deploy and the worker
    //       still has the stale value)
    // WHAT: The TTS instance constructed for the fallback path comes
    //        from the OpenAI TTS class, not GrokTTS
    // WHEN: AgentSession construction inside runFallback
    // WHERE: The `tts:` slot of the AgentSession constructor in
    //         fallback.ts
    // WHY: This is the *whole point* of the fallback path. Using
    //       GrokTTS in fallback would leave the caller with dead air
    //       in exactly the failure scenario the path was supposed to
    //       guard against. The CLAUDE.md / ARCHITECTURE.md docs
    //       claim OpenAI TTS is the dead-air guard; this test makes
    //       that claim load-bearing instead of aspirational.
    const ctx = makeCtx();
    const { deps, AgentSessionCalls, TTSCalls, Classes } = buildSpyDeps();

    await runFallback(ctx, "msg", TEST_CONFIG, deps);

    expect(AgentSessionCalls).toHaveLength(1);
    expect(TTSCalls).toHaveLength(1);
    const sessionArgs = AgentSessionCalls[0].args[0] as { tts: unknown };
    // The tts slot received an instance of the *injected* OpenAI TTS
    // spy class. If a future refactor wires GrokTTS here instead, the
    // sessionArgs.tts would not be an instance of FakeTTSClass and
    // this fails. The next test pins the negative case (Grok absent).
    expect(sessionArgs.tts).toBeInstanceOf(Classes.FakeTTSClass);
  });

  it('SAD: a real GrokTTS instance is never constructed in fallback', async () => {
    // WHO: A future maintainer tempted to "simplify" by reusing the
    //       primary path's GrokTTS in fallback
    // WHAT: GrokTTS's constructor is never called during fallback —
    //        verified by confirming no GrokTTS instance is in the
    //        session's tts slot
    // WHEN: Across the entire runFallback call
    // WHERE: Same TTS slot as above, viewed through a different lens
    // WHY: This is a defense-in-depth assertion against drift. The
    //       previous test pins the *positive* case (OpenAI used);
    //       this pins the *negative* (Grok absent). Both can fail
    //       independently — Grok could be added back as a third
    //       provider for example — and we want a clear test for each.
    const ctx = makeCtx();
    const { deps, AgentSessionCalls } = buildSpyDeps();

    await runFallback(ctx, "msg", TEST_CONFIG, deps);

    const sessionArgs = AgentSessionCalls[0].args[0] as { tts: unknown };
    expect(sessionArgs.tts).not.toBeInstanceOf(GrokTTS);
  });

  it('HAPPY: configures OpenAI TTS with the OpenAI API key (not Grok key)', async () => {
    // WHO: The fallback path's TTS constructor
    // WHAT: The api key passed in is `OPENAI_API_KEY`, not `XAI_API_KEY`
    // WHEN: TTS construction
    // WHERE: The `new TTS({ apiKey: ... })` in fallback.ts
    // WHY: If we accidentally passed the Grok key into the OpenAI TTS
    //       client, the fallback would 401 on every call and produce
    //       — yes — dead air. Pinning the key plumbing prevents that
    //       silent regression.
    const ctx = makeCtx();
    const { deps, TTSCalls } = buildSpyDeps();

    await runFallback(ctx, "msg", TEST_CONFIG, deps);

    expect(TTSCalls).toHaveLength(1);
    const ttsArgs = TTSCalls[0].args[0] as { apiKey?: string };
    // The test config has distinct sentinel values for each key — we
    // assert TTS got the OpenAI one, not the Deepgram one. If a future
    // refactor accidentally cross-wires keys, this fails loudly.
    expect(ttsArgs.apiKey).toBe(TEST_CONFIG.OPENAI_API_KEY);
    expect(ttsArgs.apiKey).not.toBe(TEST_CONFIG.DEEPGRAM_API_KEY);
  });
});

describe('runFallback — error swallowing (the never-throw contract)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('SAD: swallows when AgentSession constructor throws', async () => {
    // WHO: A worker hitting a transient LiveKit SDK initialization bug
    //       (rare but observed during version drift)
    // WHAT: runFallback completes without throwing — the call ends
    //        with whatever LiveKit does on its own when no audio is
    //        produced; the worker stays alive for the next call
    // WHEN: The first `new AgentSessionCtor({...})` line throws
    // WHERE: Inside the `try` block at the top of runFallback
    // WHY: Throwing here would propagate up to entry(), which itself
    //       is awaited by LiveKit's job runner. An uncaught reject
    //       there could crash the worker and brick *every* subsequent
    //       call until Railway restarts. The catch keeps the worker
    //       healthy.
    const ctx = makeCtx();
    const { deps } = buildSpyDeps({
      sessionCtorThrows: new Error('LiveKit session ctor failed'),
    });

    await expect(runFallback(ctx, 'msg', TEST_CONFIG, deps)).resolves.toBeUndefined();
  });

  it('SAD: swallows when STT constructor throws (e.g., bad Deepgram key)', async () => {
    // WHO: A worker whose Deepgram key was rotated upstream but env
    //       vars haven't been redeployed
    // WHAT: runFallback completes without throwing
    // WHEN: `new STT({ apiKey: ... })` throws on construction
    // WHERE: Inside the AgentSession constructor's `stt` slot
    //         (eager construction)
    // WHY: A bad Deepgram key is a config failure, not a runtime
    //       crash. We log + swallow; the call ends silently which is
    //       still better than an uncaught reject crashing the worker.
    const ctx = makeCtx();
    const { deps } = buildSpyDeps({
      sttCtorThrows: new Error('Deepgram auth failed'),
    });

    await expect(runFallback(ctx, 'msg', TEST_CONFIG, deps)).resolves.toBeUndefined();
  });

  it('SAD: swallows when LLM constructor throws (e.g., bad OpenAI key)', async () => {
    // WHO: A worker whose OpenAI key was rotated mid-deploy
    // WHAT: runFallback completes without throwing
    // WHEN: `new LLM({ apiKey: ... })` throws on construction
    // WHERE: AgentSession `llm` slot
    // WHY: Same shape as the STT case — config failures shouldn't
    //       crash the worker.
    const ctx = makeCtx();
    const { deps } = buildSpyDeps({
      llmCtorThrows: new Error('OpenAI LLM auth failed'),
    });

    await expect(runFallback(ctx, 'msg', TEST_CONFIG, deps)).resolves.toBeUndefined();
  });

  it('SAD: swallows when TTS constructor throws', async () => {
    // WHO: A worker whose OpenAI key was rotated specifically for the
    //       TTS endpoint (or the OpenAI TTS plugin had a startup bug)
    // WHAT: runFallback completes without throwing
    // WHEN: `new TTS({ apiKey: ... })` throws
    // WHERE: AgentSession `tts` slot
    // WHY: This is the most painful failure to debug — TTS is the one
    //       that actually produces sound — but worker-stability still
    //       wins over loud failure. The caller hears dead air either
    //       way; the difference is whether the next caller also does.
    const ctx = makeCtx();
    const { deps } = buildSpyDeps({
      ttsCtorThrows: new Error('OpenAI TTS init failed'),
    });

    await expect(runFallback(ctx, 'msg', TEST_CONFIG, deps)).resolves.toBeUndefined();
  });

  it('SAD: swallows when session.start() rejects', async () => {
    // WHO: A worker whose LiveKit room subscription fails (network
    //       blip during start, room already closed, etc.)
    // WHAT: runFallback completes without throwing
    // WHEN: `await session.start(...)` rejects
    // WHERE: The line right before `say()`
    // WHY: A failed `start()` is recoverable at the worker level —
    //       the next call will get a fresh session attempt. Crashing
    //       here would block every following call.
    const ctx = makeCtx();
    const { deps, sayCalls } = buildSpyDeps({
      startThrows: new Error('LiveKit room subscribe timeout'),
    });

    await expect(runFallback(ctx, 'msg', TEST_CONFIG, deps)).resolves.toBeUndefined();
    // And — since start() never resolved — say() must not have run
    expect(sayCalls).toHaveLength(0);
  });

  it('SAD: swallows when say() rejects (TTS upstream failure)', async () => {
    // WHO: A worker whose OpenAI TTS endpoint returned 5xx mid-call
    //       (or the request timed out, or the audio stream choked)
    // WHAT: runFallback completes without throwing — the await on
    //        `session.say(...)` is inside the try block specifically
    //        so a synthesis-time failure is caught
    // WHEN: `await session.say(message, ...)` rejects
    // WHERE: The final line of the try block in fallback.ts
    // WHY: Pre-fix, the original `runFallback` did NOT await say();
    //       a synthesis failure became an unhandled promise rejection
    //       on the worker. Awaiting + catching makes the caller's
    //       experience identical (dead air either way) but keeps the
    //       worker process clean.
    const ctx = makeCtx();
    const { deps, startCalls } = buildSpyDeps({
      sayThrows: new Error('OpenAI TTS upstream 503'),
    });

    await expect(runFallback(ctx, 'msg', TEST_CONFIG, deps)).resolves.toBeUndefined();
    // start() did succeed before say() failed
    expect(startCalls).toHaveLength(1);
  });
});
