# "Never silent" voice architecture — deep-dive design

**Date:** 2026-06-25
**Branch (planned):** `feat/never-silent-voice-core`
**Stack:** LiveKit Agents (Node/TS) **1.4.5** + Deepgram STT + OpenAI GPT-4o-mini + OpenAI `gpt-4o-mini-tts` (non-streaming) + Telnyx/SIP
**Supersedes:** `2026-06-25-filler-interruption-tuning-design.md` (that spec is now Layer 4 of this one)
**Evidence base:** four parallel investigations (2026-06-25), all saved in session scratch:
- Real prod trace (`voice_sessions` for a production tenant)
- LiveKit 1.4.5 internals (cited, `deepdive-livekit-internals.md`)
- Our silence-surface code audit (cited, `deepdive-silence-surface.md`)
- Two deep-research web passes (LiveKit/Pipecat/OpenAI Realtime/ElevenLabs, adversarially verified)

## Requirement (Dale)

Beth must **never go silent at any point**, and the pieces (RAG-answer, take-message, send-text,
booking, …) must be **modular** so any composition a future customer assembles still can't leave
the caller in dead air. "Never silent" is a guaranteed property of the harness, not a per-feature fix.

## What the evidence established (don't re-litigate)

1. **No framework ships a turnkey "never-silent" guarantee** — verified across LiveKit + Pipecat.
   It must be built from primitives. LiveKit 1.4.5 exposes the right primitives.
2. **The watchdog is feasible + low-risk on 1.4.5.** `AgentStateChanged` ('thinking'/'speaking'),
   `SpeechCreated {source:'say'|'generate_reply'|'tool_response', speechHandle}`, and
   `session.say(text,{audio,allowInterruptions,addToChatCtx})` returning an interruptible
   `SpeechHandle` are all present. `mainTask` **serializes** the speech queue (`_waitForGeneration()`
   before popping next) → **audio frames never overlap**; the only risk is *double-speak* (filler then
   reply), solved by `.interrupt()`-ing the filler.
3. **The `rotateSegment` warning is harmless** — transcript-segment sync, not audio collision.
   (Removes a feared blocker from the go-live notes.)
4. **#97 freeze root cause = circular wait**, not a throw: a tool called `say()`+`waitForPlayout()`
   on its own handle and blocked `mainTask`. Now guarded by `SpeechHandleCircularWaitError`.
   → `say()` is safe from **timer/event callbacks**, never from inside `execute()`.
5. **Documented dead-air mode with NO error event (livekit/agents#3418):** an interruption race can leave the agent
   in **`'speaking'` state producing no audio**, indefinitely, with no exception. **Consequence: the
   watchdog must key off *actual audio output*, not merely the `'speaking'` state.**
6. **Double-speak bug (livekit/agents#1365)** only triggers with `preemptiveGeneration` enabled. **We don't enable
   it** (default off) → not a current risk. Rule: do not enable it on tool-bearing turns until
   PR livekit/agents#1369 is confirmed in our version.
7. **Framework has NO per-tool timeout.** A stalled tool blocks the turn forever. Our `ToolsClient`
   *does* bound HTTP calls (8s write / 16s read, never throws) — but `transfer_call` bypasses it and
   is **unbounded**. → a per-tool wrapper is mandatory.
8. **Root TTS gap is real but fixable at the source:** non-streaming OpenAI TTS measured 2–5s
   (our LESSONS_LEARNED). Streaming TTS (ElevenLabs Flash v2.5, ~75ms inference / 100–200ms TTFB)
   or OpenAI **Realtime** (speech-to-speech, removes the TTS step) attack the cause. (The "Realtime
   = ~300ms" claim was refuted — treat Realtime as an *evaluate-by-measurement* lever, not a proven win.)
9. **Prod trace:** post-#98/#100 calls complete with real transcripts — fixes held; no live freeze
   repro remains. We have **no per-turn latency instrumentation** — the watchdog supplies it.

## Silence-source → guarantee map

| Silence source | Covered by |
|---|---|
| TTS synthesis gap (2–5s) | Layer 0 (streaming/Realtime) + Layer 4 (cached filler) |
| Reply cancelled by "hello?" | Layer 4 (adaptive interruption + resumeFalseInterruption) |
| Tool HTTP slow/hangs | Layer 2 wrapper (Promise.race timeout) — incl. transfer_call |
| Tool throws | framework catches; Layer 2 also catch→string |
| Tool returns empty | Layer 2 never-empty contract + backend route helper |
| RAG embedding failure → 500 → JSON | Layer 3 fix + backend route helper |
| Agent 'speaking' but no audio (livekit/agents#3418) | Layer 1 watchdog (keys off actual audio) |
| LLM stalls / says nothing | Layer 1 watchdog (cause-agnostic backstop) |
| Session-init throws | Layer 3: pre-rendered STATIC-audio fallback (no TTS) |
| Provider/key outage | Layer 3 static fallback (no shared TTS failure domain) |

## Architecture — 4 layers + reuse module structure

### Layer 0 — Cut the TTS gap at the source (measure, then choose)
The single biggest dead-air reducer. Two candidate levers; **decide by measurement**:
- **ElevenLabs Flash v2.5 streaming TTS** — lower-risk drop-in (swap the TTS plugin). Verify the
  LiveKit Node plugin's actual model/streaming surface (specific config claims were refuted).
- **OpenAI Realtime** (`openai.realtime.RealtimeModel` as the `llm`, first-party LiveKit plugin,
  full tool-calling) — removes the TTS step entirely; bigger change; latency/cost unproven → spike.
**Action:** a measurement spike timing first-audio latency of current TTS vs ElevenLabs Flash vs
Realtime on our SIP path before committing. Layers 1–4 stand regardless of the outcome.

### Layer 1 — Output watchdog (the categorical guarantee), in the harness
Session-level, **cause-agnostic**, keys off **actual audio**:
- Arm a deadline timer on `AgentStateChanged → 'thinking'` (caller turn ended, agent should respond).
- **Cancel only on evidence of real audio** — the `SpeechCreated{source:'generate_reply'}` handle
  actually starting playout (track its `SpeechHandle`; not the bare `'speaking'` state, per livekit/agents#3418).
- Deadline 1 (~2.5s, tunable post-measurement) → play a **cached filler** clip via
  `say(text,{audio, allowInterruptions:true, addToChatCtx:false})`; keep its `SpeechHandle`.
- When the real reply produces audio → `fillerHandle.interrupt()` to prevent double-speak.
- Deadline 2 (~+4s, still no real audio) → play a **cached recovery** clip ("Sorry, give me one
  moment — or I can take a message") and re-prompt.
- **livekit/agents#3418 guard:** if `'speaking'` persists with the same handle and no completion for an abnormal
  window, treat as stuck → recovery. (Validate the exact signal on a real call.)
- Guard `say()` with try/catch for `SchedulingPausedError` (draining). Re-check `agentState` inside
  the timer callback before firing.
- **Emits metrics** (`watchdog_fired`, `filler_played`, `recovery_played`, time-to-first-audio) —
  this is also our missing per-turn latency instrumentation.

### Layer 2 — Capability-tool wrapper (`wrapTool`): non-freeze by construction
Every capability tool is defined through one wrapper enforcing the contract, so no composition can
introduce a freezing tool:
- **Timeout** every `execute()` body via `Promise.race` (covers non-HTTP paths like `transfer_call`,
  which `ToolsClient` doesn't bound). On timeout → graceful string + metric.
- **Catch-all → non-empty string** (never throw, never empty/undefined; fixes the `formatResponse`
  `undefined` latent gap centrally).
- **Forbid `say()` inside `execute()`** by construction (the helper owns the call path).
- Mirror on the backend: an `okOrGraceful()` route helper that converts caught errors (e.g. embedding
  failure) into a graceful `{success:true, result:"…"}` string instead of a 500-to-agent.

### Layer 3 — Point fixes the structure systematizes
1. **`transfer_call` timeout** (`transferClient.ts:68`) — `Promise.race` 10s → `{ok:false, reason:'transfer_timeout'}`. (Subsumed by `wrapTool` once tools route through it.)
2. **RAG embedding try/catch** (`agentTools.ts:1009`) → return the same warm "I don't have that, want
   to leave a message?" string as the zero-hits path. (Subsumed by `okOrGraceful`.)
3. **`fallback.ts` → pre-rendered STATIC audio** (no TTS, no shared key/failure domain) as the final
   backstop; + boot-time provider-key validation.
4. **`formatResponse` undefined guard** (subsumed by `wrapTool`).

### Layer 4 — Reduce how often the backstop fires (the prior spec)
Cached filler at the tool boundary (re-enable the no-op `speakFiller` via `say({audio})`),
`interruption.mode:'adaptive'`, `falseInterruptionTimeout:2000` + `resumeFalseInterruption:true`,
`minWords:2` (the effective lever; `minDuration` is inert on the STT path), greeting
`allowInterruptions:false`.

### Reuse module structure (Dale's core ask)
```
agent/src/
  tools/
    _wrapTool.ts        # Layer 2 contract — EVERY capability built through this
    knowledge.ts        # get_company_policy_answer (RAG, never-empty)
    messaging.ts        # take_message, capture_job_inquiry (+ future send_text)
    identity.ts         # identify_caller, find_caller_by_name, get_customer_context, save_pref
    scheduling.ts       # catalog, slots, options, check, book, book_with_scheduling, mine, cancel, reschedule
    verification.ts     # send_verification_code, verify_phone_code
    transfer.ts         # transfer_call (now timeout-bounded)
    index.ts            # buildTools(ctx, client, { capabilities }) — composes selected modules
  session/
    watchdog.ts         # Layer 1
    buildSession.ts     # pipeline + turnHandling (Layer 4 config)
    wireEvents.ts       # session.on(...) wiring + watchdog attach
    callRecorder.ts     # call-logging lifecycle (start/finalize/usage) extracted from index.ts
    staticFallback.ts   # Layer 3 pre-rendered audio
  runVoiceSession.ts    # composes a capability set onto the guaranteeing harness
  index.ts              # thin: defineAgent({ prewarm, entry: ctx => runVoiceSession(ctx) })
```
A customer picks capabilities (`buildTools(ctx, client, {capabilities:['knowledge','messaging']})`)
or copies a module; the harness (watchdog + wrapper + static fallback) guarantees never-silent
**regardless of composition**. Default `opts` = today's Beth behavior, so `index.ts` is behavior-identical.

## Open items — resolve by MEASUREMENT (our #1 rule)
1. First-audio latency: current `gpt-4o-mini-tts` vs ElevenLabs Flash vs OpenAI Realtime on SIP → picks Layer 0.
2. Does livekit/agents#3418 ('speaking' but silent) reproduce on 1.4.5 Node → confirms the watchdog's audio-keyed cancel.
3. ElevenLabs LiveKit Node plugin actual config surface (model default, streaming params) — refuted claims, must verify.
4. Watchdog real-call validation: filler→reply transition has no double-speak / overlap; deadline values feel right.
5. Confirm `preemptiveGeneration` stays off (it is) — do not enable on tool turns until livekit/agents#1369 verified.

## Phased implementation plan (each its own PR, agent tests green per step)
- **PR-A (point fixes, ship now, low risk):** transfer_call timeout + RAG embedding try/catch +
  formatResponse guard + static-audio fallback. Immediate dead-air risk reduction; no new architecture.
- **PR-B (Layer 4):** cached filler (re-enable speakFiller safely) + adaptive interruption + false-
  interruption resume + greeting allowInterruptions. (The prior spec.)
- **PR-C (Layer 1):** the output watchdog + its metrics, in `session/watchdog.ts`. Real-call validate.
- **PR-D (Layer 2 + reuse):** `wrapTool` + split `tools.ts` into capability modules + `okOrGraceful`
  backend helper; route every tool through the wrapper.
- **PR-E (harness extraction):** `buildSession`/`wireEvents`/`callRecorder`/`runVoiceSession`; thin index.ts.
- **PR-F (Layer 0, after measurement):** ElevenLabs streaming TTS and/or Realtime, per the spike.
- Each PR is behavior-preserving for Beth; reusability lands incrementally.

## Risks
- Watchdog double-speak / overlap — mitigated by serialized queue + interrupt; real-call validate.
- livekit/agents#3418 stuck-speaking detection signal — confirm empirically before relying on it.
- Layer 0 provider swap (ElevenLabs/Realtime) changes voice + cost — measure + owner sign-off.
- Scope: this is large; PR-A delivers the biggest safety win first and is independently shippable.
