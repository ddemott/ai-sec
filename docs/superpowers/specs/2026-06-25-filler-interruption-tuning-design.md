# Cached filler audio + interruption tuning — design

**Date:** 2026-06-25
**Branch:** `feat/voice-filler-interruption-tuning`
**Stack:** `@livekit/agents` 1.4.5 (Node) + Deepgram + GPT-4o-mini + OpenAI `gpt-4o-mini-tts` + Telnyx/SIP
**Research basis:** `docs/VOICE_DEADAIR_RESEARCH.md`

> **Status (updated 2026-06-29):** sections **2 (adaptive interruption + false-interruption resume)**
> and **3 (non-interruptible greeting)** have **shipped** (`agent/src/index.ts`, via #103/#104/#108/#109)
> and are retained below as a verification record. Section **1 (cached filler audio)** is the only
> part still **outstanding** — `speakFiller` remains a no-op. This spec is also folded in as Layer 4 of
> `2026-06-25-never-silent-architecture-design.md`.

## Problem

Beth has a measured TTS gap (2–5s, non-streaming OpenAI TTS). During that gap callers say "hello?",
which can cancel the in-flight reply → the freeze family. When this spec was written, `speakFiller`
was a no-op (the #97 freeze removed the unsafe `session.say()`-inside-`execute()` version) and the
pipeline did not yet use adaptive interruption or false-interruption resume. Research said the
high-ROI fixes are (1) cached filler audio at the tool boundary and (2) adaptive interruption +
resume-on-false-interruption. **(2) has since shipped; (1) is still open** — see the Status note above.

## Scope — three changes in `agent/src/index.ts`, no backend/DB

> Of the three below, **#2 and #3 are implemented**; **#1 (cached filler) is the remaining work.**

### 1. Cached filler audio, played at the tool boundary
- **At session start (prewarm or session init):** pre-synthesize a small set of fixed filler lines
  once, via the configured OpenAI TTS, into `AudioFrame[]` and keep them in memory keyed by text:
  - "One moment while I check that."
  - "Let me look into that for you."
  - (keep it to 2–3 generic, NAME-FREE lines — never bake caller-specific text into a cached clip,
    per `tts-phrase-cache-design`.)
- **Re-enable `speakFiller`** (currently the `() => {}` no-op passed to `buildTools`) so it plays a
  cached clip via `session.say(text, { audio, allowInterruptions: false })`:
  - `audio` = a fresh `ReadableStream<AudioFrame>` built from the cached `AudioFrame[]` for that text
    (frames must be re-streamed per call — a ReadableStream is single-use).
  - `text` is still passed so the transcript/chat context records the line.
  - `allowInterruptions: false` so the short filler plays through.
- **Trigger:** `speakFiller` is already called at the top of slow tools (`get_available_slots`,
  `take_message`, `capture_job_inquiry`, scheduling). That IS the tool boundary — correct per
  research. Keep those call sites; just make the implementation play cached audio instead of no-op.
- **Safety:** this calls `session.say()` from the tool-boundary helper, NOT synthesizing inside the
  tool's `execute()` HTTP path — that distinction is what makes it safe vs. the #97 freeze. Verify
  on a real call that a filler followed immediately by the tool's real reply does not cause the
  `rotateSegment` audio-overlap (the choppy-voice bug); if it does, gate the filler to only fire
  when the tool is expected to be slow (e.g. RAG/policy-answer), not every tool.

### 2. Adaptive interruption + false-interruption resume — ✅ SHIPPED
**Implemented** in the `turnHandling.interruption` block of `agent/src/index.ts` (verify there;
`minDuration` was dropped as inert on the STT path):
```ts
interruption: {
  mode: 'adaptive',              // ML barge-in detection (filters "hello?"/backchannels acoustically)
  minWords: 2,                   // the effective lever when STT is enabled
  falseInterruptionTimeout: 2000, // if no transcript follows a detected interruption…
  resumeFalseInterruption: true,  // …resume speaking from where Beth left off
}
```
- `mode:'adaptive'` requires VAD (we have silero ✓) + non-realtime LLM (gpt-4o-mini ✓) + STT with
  aligned transcripts (Deepgram ✓). It's likely already default-on on LiveKit Cloud + 1.4.5 —
  setting it explicitly makes intent clear and survives a non-Cloud/self-host path.
- Verify these exact field names against `node_modules/@livekit/agents/.../turn_config/interruption.d.cts`
  (confirmed present in 1.4.5: `mode`, `minDuration`, `minWords`, `falseInterruptionTimeout`,
  `resumeFalseInterruption`).

### 3. Greeting plays through — ✅ SHIPPED
- The non-Realtime greeting already uses `session.say(greeting, { allowInterruptions: false })` in
  `agent/src/index.ts` (the exact line moves as the file evolves — grep `allowInterruptions: false`),
  so the opening line can't be cut by line noise / an eager caller. (The Realtime path uses
  server-side turn detection and rejects `allowInterruptions:false`, so it's intentionally omitted there.)

## Out of scope (note, don't build)
- **ElevenLabs / streaming TTS** — the bigger latency lever (sum→max), but a provider change with
  cost + voice-selection implications. Revisit if cached fillers + interruption tuning don't settle
  the dead air. Tracked as a follow-up.
- Relaxing `endpointing.minDelay` (1300ms) — re-measure after these land; may be able to lower it
  once adaptive interruption protects against premature cancellation.

## Testing
- **Unit (agent):** the tool-count/registry test is unaffected. Add a test that `speakFiller` builds
  a non-empty audio stream from the cache for a known line and that an unknown line falls back
  gracefully (no throw, no audio). Mock the TTS prewarm.
- **Can't unit-test the acoustic behavior** — `mode:'adaptive'` + resume + the rotateSegment overlap
  need a **real call** (per LESSONS_LEARNED "measure, don't guess"):
  1. Ask a question that triggers a slow tool → confirm a filler plays within ~1s, then the real answer.
  2. Say "hello?" into a gap → confirm Beth resumes/continues rather than going silent.
  3. Listen for choppiness/overlap when filler is immediately followed by the reply.
- Measure `gpt-4o-mini-tts` first-audio latency directly during the test to settle the ElevenLabs question.

## Deploy
Agent-only change → merge to main → `secretary-hq-agent` redeploys. No DB, no backend, no persona change.
Confirm the live build via the boot marker before the real-call test.

## Risks
- **#97 redux:** the filler must play from the tool-boundary helper, never from inside `execute()`'s
  await chain. The cached-audio path is synchronous-ish (no network) which further reduces risk.
- **Audio overlap (rotateSegment):** filler + immediate real reply may overlap on the OpenAI TTS
  pipeline (the known choppy-voice symptom). Mitigation: only fire filler for genuinely slow tools;
  verify on a real call before trusting.
- **Node API parity:** `resumeFalseInterruption`/`falseInterruptionTimeout` are confirmed in the
  1.4.5 type defs; behavior still needs a real-call check.
