# Framework Migrations

Tracks in-flight and recently-completed framework/provider swaps. This is the index — detailed retrospectives live in commit messages, and active follow-ups live in `NEEDS-REFACTORING.md`.

**Last updated:** 2026-04-30

---

## 1. Voice orchestrator: Vapi → LiveKit Agents

**Status:** Shipped (commit `661d21d`, 2026-04-27). Vapi account deleted, all Vapi code removed.

**Why:** Vapi charged a $0.05/min orchestration tax. LiveKit Cloud free tier covers 1,000 SIP minutes/month at $0.

**Current stack:** Telnyx (carrier + SIP trunk) → LiveKit Cloud (SIP ingress) → LiveKit Agent worker (Node) → Deepgram Nova-3 (STT) + OpenAI GPT-4o-mini (LLM) + OpenAI TTS (TTS — see migration #3) → Fastify `/agent-tools/*`.

**Open follow-up:** First live PSTN call still pending — Telnyx ticket `#2850682`. See `TICKET_SUPPORT.md`.

---

## 2. Tool runtime: Supabase Edge Functions (Deno) → Fastify (Node)

**Status:** Shipped (commit `661d21d`, 2026-04-27). `supabase/functions/vapi-tools/` deleted; `supabase/functions/` is now empty.

**Why:** LiveKit agent runs as a Node.js worker; keeping tools in Deno edge functions added a network hop and a second runtime. Consolidating into Fastify lets tools share the existing DB pool, middleware, and types.

**Current implementation:** 10 tools (8 originals + 2 OTP helpers added 2026-04-23) in `src/routes/agentTools.ts`. Auth via `x-agent-secret` header. All booking routes gate on `isValidPhone`.

---

## 3. TTS provider: OpenAI TTS → xAI Grok (native in agent)

**Status:** Pending. Tracked as `NEEDS-REFACTORING.md` item #9 (P2).

**Why:** Cost, latency, and voice quality evaluation. The earlier interim plan (Vapi custom-voice proxy at `src/routes/tts.ts`) was abandoned and that file deleted in `661d21d` along with everything else Vapi-shaped.

**Current implementation:** Agent uses `openai.TTS` at `agent/src/index.ts:122,150`.

**Target:** Custom `GrokTTS` class hitting `https://api.x.ai/v1/tts` directly from the agent worker. Validatable via unit tests + LiveKit playground call (no PSTN dependency). Estimated 1–2 hours.

---

## Related docs

- `NEEDS-REFACTORING.md` — code-cleanup backlog, including Phase 4 TTS work
- `docs/TODO.md` — full task list
- `docs/ARCHITECTURE.md` — system architecture
- `CLAUDE.md` — project overview, includes migration callout
