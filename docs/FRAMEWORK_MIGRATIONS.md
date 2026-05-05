# Framework Migrations

Tracks in-flight and recently-completed framework/provider swaps. This is the index — detailed retrospectives live in commit messages, and active follow-ups live in `NEEDS-REFACTORING.md`.

**Last updated:** 2026-05-05 (no new migrations since 2026-05-03 — date bumped to reflect doc audit; runFallback OpenAI-TTS dead-air guard from commit `6488dc4` is unchanged)

---

## 1. Voice orchestrator: Vapi → LiveKit Agents

**Status:** Shipped (commit `661d21d`, 2026-04-27). Vapi account deleted, all Vapi code removed.

**Why:** Vapi charged a $0.05/min orchestration tax. LiveKit Cloud free tier covers 1,000 SIP minutes/month at $0.

**Current stack:** Telnyx (carrier + SIP trunk) → LiveKit Cloud (SIP ingress) → LiveKit Agent worker (Node) → Deepgram Nova-3 (STT) + OpenAI GPT-4o-mini (LLM) + xAI Grok TTS (default voice `ara`; OpenAI TTS retained inside `runFallback()` only — see migration #3) → Fastify `/agent-tools/*`.

**Open follow-up:** First live PSTN call still pending — Telnyx ticket re-submitted 2026-05-01 (original `#2850682` abandoned after 4 days without a human response). See `TICKET_SUPPORT.md`.

---

## 2. Tool runtime: Supabase Edge Functions (Deno) → Fastify (Node)

**Status:** Shipped (commit `661d21d`, 2026-04-27). `supabase/functions/vapi-tools/` deleted; `supabase/functions/` is now empty.

**Why:** LiveKit agent runs as a Node.js worker; keeping tools in Deno edge functions added a network hop and a second runtime. Consolidating into Fastify lets tools share the existing DB pool, middleware, and types.

**Current implementation:** 10 tools (8 originals + 2 OTP helpers added 2026-04-23) in `src/routes/agentTools.ts`. Auth via `x-agent-secret` header. All booking routes gate on `isValidPhone`.

---

## 3. TTS provider: OpenAI TTS → xAI Grok (native in agent)

**Status:** Code-complete 2026-05-01, dead-air guard validated 2026-05-03. End-to-end validation against PSTN still pending first live call (blocked on Telnyx ticket). The fallback path inside `runFallback()` uses `openai.TTS` as a last-resort voice if config is too broken to construct GrokTTS — intentional, so a misconfigured XAI key never produces dead-air on the caller's end. **Caveat:** between 2026-05-01 and 2026-05-03 this guard was aspirational — the actual `runFallback()` on main wired GrokTTS in both paths. Closed 2026-05-03 by extracting `runFallback()` to `agent/src/fallback.ts`, switching the TTS to OpenAI, and pinning the contract with 13 new 5W tests in `agent/src/fallback.test.ts`.

**Why:** Cost, latency, and voice quality evaluation. The earlier interim plan (Vapi custom-voice proxy at `src/routes/tts.ts`) was abandoned and that file deleted in `661d21d` along with everything else Vapi-shaped.

**Implementation:** `agent/src/grokTTS.ts` — `GrokTTS` class extending `tts.TTS`, posting to `https://api.x.ai/v1/tts` with `output_format: { codec: 'pcm', sample_rate: 24000 }`. Wired into the primary `voice.AgentSession` at `agent/src/index.ts`. Voice configurable via `XAI_TTS_VOICE` env (eve | ara | rex | sal | leo, default `ara`). 9 unit tests cover request shape, frame emission, abort handling, upstream errors, and option updates.

---

## Related docs

- `NEEDS-REFACTORING.md` — code-cleanup backlog, including Phase 4 TTS work
- `docs/TODO.md` — full task list
- `docs/ARCHITECTURE.md` — system architecture
- `CLAUDE.md` — project overview, includes migration callout
