# Framework Migrations

Tracks in-flight and recently-completed framework/provider swaps. Detailed implementation plans live elsewhere — this is the index.

**Last updated:** 2026-04-21

---

## 1. Voice orchestrator: Vapi → LiveKit Agents

**Status:** In progress. Phase 1 complete, Phase 2 ready to start, **blocked on LiveKit API Secret + WSS URL from Dale**.

**Why:** Vapi charges a $0.05/min orchestration tax. LiveKit Cloud free tier is 1,000 SIP minutes/month.

**New stack:** Telnyx (phone) → LiveKit (orchestrator) → Deepgram (STT) → OpenAI (LLM) → xAI Grok (TTS)

**Plan file:** `.claude/plans/federated-snacking-puffin.md` (7 phases, ~8–12 days)

**Phases:**
- [x] 1. LiveKit Cloud setup + agent skeleton (account created, project "AI-Secretary", API Key `APIUn8THYfHACSz`)
- [ ] 2. Port 8 tools to Fastify `/agent-tools/*` routes ← **START HERE**
- [ ] 3. Wire tools into LiveKit agent
- [ ] 4. Custom xAI TTS plugin (native, replacing the Vapi custom-voice proxy)
- [ ] 5. Call lifecycle events
- [ ] 6. Provisioning rewrite (Vapi → LiveKit dispatch rules)
- [ ] 7. Cleanup + Telnyx SMS adapter

---

## 2. Tool runtime: Supabase Edge Functions (Deno) → Fastify (Node)

**Status:** Not started. Driven by migration #1 (Phase 2).

**Why:** LiveKit agent runs as a Node.js worker; keeping tools in Deno edge functions adds a network hop and a second runtime. Consolidating into Fastify simplifies deploys and lets tools share the existing DB pool, middleware, and types.

**Scope:** Port the 8 tools from `supabase/functions/vapi-tools/` into `src/routes/agentTools.ts`.

**Files to create:**
- `src/routes/agentTools.ts` (8 POST routes)
- `src/services/phoneUtils.ts`
- `src/services/timezoneUtils.ts`

**Files to modify:**
- `src/index.ts` — register routes, add `AGENT_SECRET`
- `src/middleware.ts` — exempt `/agent-tools/` from tenant middleware

**Source (port from):**
- `supabase/functions/vapi-tools/core/dispatcher.ts`
- `supabase/functions/vapi-tools/core/service.ts`
- `supabase/functions/vapi-tools/index.ts` (Zod schemas)

Phase 2 doesn't need LiveKit credentials — it's pure backend work and can proceed while waiting on Dale.

---

## 3. TTS provider: Vapi Clara → xAI Grok

**Status:** Shipped as a Vapi custom-voice proxy; will move native into the LiveKit agent in migration #1 Phase 4.

**Why:** Cost + latency + voice quality evaluation. (Vapi Clara is Vapi's native voice — `"provider": "vapi", "voiceId": "Clara"` in `vapi/assistant-update-april-2026.json`. Not ElevenLabs.)

**Current implementation:** `src/routes/tts.ts` — receives Vapi `voice-request` webhooks, proxies to `https://api.x.ai/v1/tts`, streams audio back. Auth via `x-vapi-secret` header.

**Next step:** Once on LiveKit, replace the proxy with a native xAI TTS plugin in the agent worker (no more Vapi round-trip).

---

## Related docs

- `docs/TODO.md` — full task list, references this file for migration status
- `docs/ARCHITECTURE.md` — current (pre-migration) architecture
- `CLAUDE.md` — project overview, includes migration callout
