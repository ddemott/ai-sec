# Framework Migrations

Tracks in-flight and recently-completed framework/provider swaps. This is the index — detailed retrospectives live in commit messages, and active follow-ups live in `docs/TODO.md`.

**Last updated:** 2026-06-26 (Grok/xAI TTS removal finalized; OpenAI is now the sole TTS provider as it is smoother and fully integrated)

---

## 1. Voice orchestrator: Vapi → LiveKit Agents

**Status:** Shipped (commit `661d21d`, 2026-04-27). Vapi account deleted, all Vapi code removed.

**Why:** Vapi charged a $0.05/min orchestration tax. LiveKit Cloud free tier covers 1,000 SIP minutes/month at $0.

**Current stack:** Telnyx (carrier + SIP trunk) → LiveKit Cloud (SIP ingress) → LiveKit Agent worker (Node) → Deepgram Nova-3 (STT) + OpenAI GPT-4o-mini (LLM) + OpenAI TTS (default voice `shimmer`; per-tenant voice + speed via `tenants.tts_voice` / `tts_speed`; fully OpenAI since 2026-06-25 removal of xAI Grok) → Fastify `/agent-tools/*`.

**Open follow-up:** First live PSTN call still pending full different-carrier verification — see `docs/AIASSISTANT_GO_LIVE_TODO.md` and `docs/TODO.md`.

---

## 2. Tool runtime: Supabase Edge Functions (Deno) → Fastify (Node)

**Status:** Shipped (commit `661d21d`, 2026-04-27). `supabase/functions/vapi-tools/` deleted; `supabase/functions/` is now empty.

**Why:** LiveKit agent runs as a Node.js worker; keeping tools in Deno edge functions added a network hop and a second runtime. Consolidating into Fastify lets tools share the existing DB pool, middleware, and types.

**Current implementation:** ~19 voice tools (capability-composed) in `src/routes/agentTools.ts` + `agent/src/tools.ts`. Auth via `x-agent-secret` header. All booking routes gate on `isValidPhone`. See agent tools catalog in `docs/ARCHITECTURE.md`.

---

## 3. TTS provider: OpenAI TTS → xAI Grok (native in agent) — historical (2026-05)

**Status:** Code-complete 2026-05-01, dead-air guard validated 2026-05-03. This phase is now superseded (see section 4).

The fallback path inside `runFallback()` uses `openai.TTS` as a last-resort voice if config is too broken to construct GrokTTS — intentional, so a misconfigured XAI key never produces dead-air on the caller's end. **Caveat (historical):** between 2026-05-01 and 2026-05-03 this guard was aspirational — the actual `runFallback()` on main wired GrokTTS in both paths. Closed 2026-05-03 by extracting `runFallback()` to `agent/src/fallback.ts`, switching the TTS to OpenAI, and pinning the contract with 13 new 5W tests in `agent/src/fallback.test.ts`.

**Why (at the time):** Cost, latency, and voice quality evaluation. The earlier interim plan (Vapi custom-voice proxy at `src/routes/tts.ts`) was abandoned and that file deleted in `661d21d` along with everything else Vapi-shaped.

**Implementation (historical):** `agent/src/grokTTS.ts` — `GrokTTS` class extending `tts.TTS`, posting to `https://api.x.ai/v1/tts` with `output_format: { codec: 'pcm', sample_rate: 24000 }`. Wired into the primary `voice.AgentSession` at `agent/src/index.ts`. Voice configurable via `XAI_TTS_VOICE` env (eve | ara | rex | sal | leo, default `ara`). 9 unit tests covered request shape, etc. (file and env vars removed 2026-06-25).

---

## 4. TTS provider: xAI Grok → OpenAI TTS (full removal, 2026-06-25)

**Status:** Shipped (chore #94 and follow-ups). All Grok/xAI TTS code, env vars (`XAI_API_KEY`, `XAI_TTS_*`), `grokTTS.ts`, and references removed from the agent. Primary path and fallback are now both `openai.TTS`. Per-tenant control lives entirely in `tenants.tts_voice` (OpenAI ids: shimmer/nova/alloy/echo/onyx/fable) + `tts_speed` (and tone flags for the prompt, not prosody). No `XAI_API_KEY` required anywhere.

**Why:** OpenAI TTS is now smoother (lower latency, better seamlessness in practice) than the prior Grok implementation. Full removal also eliminates a second provider credential surface, simplifies cost tracking (all TTS under OpenAI), and aligns voice selection with the dashboard picker. Legacy Grok voice values (e.g. `ara`) are gracefully mapped to `shimmer` in `agent/src/index.ts:toOpenAIVoice`.

**Current implementation:** Standard `@livekit/agents-plugin-openai` TTS in `agent/src/index.ts` (both normal session and `runFallback`). Voice/speed pulled per-tenant in `tenantConfig.ts` and passed to the OpenAI TTS constructor. The output watchdog, adaptive interruption, Realtime mode (separate flag), and cached fillers provide the "never-silent" behavior. Cost events for TTS now always use provider `openai`.

**Verification:** `agent/src/fallback.test.ts` still asserts "uses OpenAI TTS for fallback (independent of primary path)". `simulate.sh call` and real calls exercise it. Docs, comments, and `supabase/baseline.sql` (regenerated as needed) updated for the final state.

---

## Related docs

- `docs/TODO.md` — full active task list
- `docs/ARCHITECTURE.md` — system architecture
- `CLAUDE.md` — project overview, includes migration callout
- `docs/VOICE_AGENT_PLAYBOOK.md` — rules for building/maintaining voice agents (pipeline vs Realtime, never-silent layers, etc.)
