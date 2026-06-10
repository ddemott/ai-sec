# Go-Live Findings & Action Plan — 2026-06-10

Compiled while Dale was away, per "keep researching until all issues are exhausted with reasonable certainty." **Nothing here was deployed or applied to prod** — account/deploy/registration steps are split out for Dale. Code items are *designs*, not committed (this repo certifies fixes by live call, not unit-green — see CLAUDE.md "false-green source / red E2E").

Source of truth for the telephony fix history: [TELNYX_HANDOVER.md](TELNYX_HANDOVER.md).

---

## ✅ What's working now (verified by live call 2026-06-10)

- SIP chain end-to-end (Telnyx FQDN repointed → LiveKit → agent joins room).
- Tenant resolution via **Option A** (hardcoded `{"tenant_id":"d5e3c6a1-…"}` in LiveKit dispatch rule `SDR_WEL49AwBB4NW`).
- `AGENT_SECRET` now matches between `ai-sec` (backend) and `ai-sec-agent` → `/agent-tools/*` reachable → **tenant-config loads real services**, agent converses + runs the booking flow.
- TTS voice is female (`XAI_TTS_VOICE=eve`).
- Prod migration `20260606000000_tenants_customer_preferences.sql` applied (the two columns exist).

---

## Issue 1 — Voice (`eve` sounds British / not what's wanted)

**Status:** Confirmed — xAI primary docs (direct fetch) + deep-research workflow `w1wg8h3mr` (high confidence, mostly unanimous votes). It IS Eve; quality is fine (Dale: "smooth, British, feminine" — not degraded). The British lilt is inherent to `eve`.

**Voice catalog (xAI docs, with gender/tone/accent):**
| voice_id | gender | character | accent |
|---|---|---|---|
| `eve` (default) | female | energetic/upbeat | **Australian/British lilt** ← what we have |
| `ara` | female | warm/friendly/conversational | (not American-guaranteed) |
| `rex` | male | confident/clear, **positioned for business** | — |
| `sal` | neutral | smooth/balanced | — |
| `leo` | male | authoritative/strong | British |

- **Accent is baked into the `voice_id`.** `language` is content language (BCP-47 / `auto`), NOT an accent selector — no `en-US` vs `en-GB` knob for a given voice. To change accent you must switch voice or **clone** one.
- Delivery params we're NOT using: **`speed`** (0.7–1.5, default 1.0), **speech tags** (`[pause]`, `[long-pause]`, `[laugh]`, `[sigh]` … and wrapping `<soft>`, `<whisper>`, `<slow>`, `<monotone>`), **`text_normalization`** (bool), `optimize_streaming_latency`. Our request (`agent/src/grokTTS.ts`) sends none of these.
- **Custom voice cloning is FREE in the xAI console** (up to **30** custom voices, all users — only the programmatic `POST /v1/custom-voices` endpoint is Enterprise-gated). The resulting custom `voice_id` (e.g. `nlbqfwie`, via the voice card's ⋯ → "Copy Voice ID") is **interchangeable** with built-ins — pass it to `/v1/tts` exactly as now. Our code already accepts arbitrary `voice_id` strings, so **no code change** is needed to use a clone.
  - Reference clip spec: ≤120s (90–120s best), single speaker, **no background noise** (it gets cloned too), `.wav` PCM **24 kHz / 16-bit / mono**, quiet soft-furnished room, spoken expressively (output matches input energy).

**Recommendation (best → fastest):**
1. **Best for an on-brand American female receptionist: clone a custom voice (free).** Record a clean 90–120s WAV (24 kHz/16-bit/mono) of the desired voice in the xAI console → copy the custom `voice_id` → set `XAI_TTS_VOICE=<that_id>` on `ai-sec-agent`. Guaranteed accent/persona, zero code change, no cost.
2. **Fastest no-record option: try `ara`** (warm/conversational female) — pure env change `XAI_TTS_VOICE=ara`. If you want male+business, `rex`. Pick by ear.
3. Optionally add `text_normalization=true` + a `speed` knob to `grokTTS.ts` for cleaner number/date reading + pacing (code-drafted, below).
4. Phone audio (8 kHz) ≠ app fidelity, but Dale confirms it sounds smooth — so this is voice *choice*, not a quality defect.

**Code-drafted (not committed):** add `speed?: number` + `text_normalization` to `GrokTTSOptions` and the request body in `agent/src/grokTTS.ts`; thread `XAI_TTS_SPEED` env through `config.ts`. ~15 lines + a unit test asserting the body includes them.

**Your action:** pick a voice by ear (`ara` vs `eve`, or clone); set `XAI_TTS_VOICE` on `ai-sec-agent`. **Verify:** call + listen.

---

## Issue 2 — SMS / texting (caller can't be texted; confirmations + OTP fail)

**Status:** Root cause confirmed in code; registration facts from authoritative Telnyx docs (deep-research; note: the run's adversarial verification was **rate-limited**, so its "refuted/inconclusive" label is a false negative — the Telnyx-sourced facts below are standard A2P 10DLC and reliable).

**Root cause (code):** `src/services/communications/ProviderRegistry.ts` runs SMS in **simulation mode** when `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` are absent (or `SMS_SIMULATION_MODE`/`TELEPHONY_SIMULATION_MODE=true`). Backend has no SMS creds → texts are logged, never sent. The only adapter is Twilio (`TwilioAdapter`) + a mock — **no Telnyx SMS adapter.**

**The real blocker is NOT code — it's A2P 10DLC registration:**
- US carriers **require A2P 10DLC registration** to send application-to-person SMS from a 10-digit long code (our DID). Unregistered traffic is **filtered/blocked** and **costs more** (~$0.011 vs ~$0.003/msg on T-Mobile).
- Two-stage: **Brand** registration (must match the LLC's IRS EIN / CP-575) → **Campaign** registration (declares use case + opt-in/opt-out/help keywords + messages) → assign number(s) to the campaign.
- **Timeline: ~3–7 business days** for carrier approval. SMS cannot be "switched on" instantly.
- **Sole-Proprietor** path fees ≈ $4 brand + $15 campaign vetting + $2/mo (Thinking Hammer LLC likely qualifies for **Standard brand** with its EIN, which has higher throughput — confirm in Telnyx portal).

**Send-SMS mechanics (Telnyx, once registered):**
- `POST https://api.telnyx.com/v2/messages`, `Authorization: Bearer <TELNYX_API_KEY>`, body `{from, to, text}` (E.164).
- The sending number must be assigned to a **Messaging Profile** (else error `40300`) AND the brand/campaign registered (else off-net `40301`).
- You **can** use the same Telnyx account/number you already use for voice — just enable messaging on it + attach a messaging profile.

**Recommendation:** Use **Telnyx for SMS too** (single vendor — already integrated for voice, already have `TELNYX_API_KEY`). Build a `TelnyxSmsAdapter` mirroring `TwilioAdapter` behind the existing `ProviderRegistry` interface. **Design-only for now** — can't be exercised against real Telnyx until the number is messaging-enabled + 10DLC-registered, and "test it or delete it" forbids shipping an untestable integration. Build it the same session you do the registration.

**Your action (the long pole — start ASAP, it gates SMS for days):**
1. Telnyx portal → Messaging → register **Brand** (use Thinking Hammer LLC EIN) → register **Campaign** (use case: appointment reminders + OTP; provide opt-in/opt-out/help copy) → create a **Messaging Profile** → assign `+1 630-866-1960` (or a dedicated messaging number) to it.
2. Decide adapter: Telnyx (recommended) vs set Twilio creds. If Telnyx, I'll build `TelnyxSmsAdapter` + wire `ProviderRegistry` when you greenlight.
**Verify:** after approval, send a test SMS via `/v2/messages`, then drive a booking confirmation + OTP through the agent.

**TCPA/consent:** appointment confirmations + OTP are transactional (lower risk than marketing) but still need prior express consent. Capture an SMS opt-in checkbox/disclosure at booking time (already a tracked `docs/TODO.md` launch item). Campaign registration also requires the opt-in/opt-out/HELP keyword flows.

---

## Issue 3 — Messages never persist (Calls tab is empty)

**Status:** Confirmed by code inspection.

**Root cause:** The retrieval side is fully built — `voice_sessions` table (transcript/summary/outcome incl. `'voicemail'`), `POST /voice` start + end-session endpoints, GET list/detail, and the **Calls tab** (`VoiceCallsView.tsx`) that renders them. **But the agent never calls `/voice`** — no `voice_sessions` row is ever written. There's also **no `take_message` tool** among the 11. So a caller's message lives only in the in-memory call transcript and is lost at hangup.

**Fix design (code-drafted, not committed):**
1. Agent calls `POST /voice` (StartSession) on connect and the end-session variant on shutdown, sending `transcript` + `summary` + `outcome` (incl. `'voicemail'`). Add an `endSession`/`startSession` method to `toolsClient.ts`. The backend routes already exist.
2. Add a 12th agent tool **`take_message`** (name, callback number, reason) so a message is *structured*, stored on the `voice_sessions` row (or `metadata`), and the prompt is updated to call it when the caller opts to leave a message.
3. Calls tab already surfaces these; optionally add a "Messages" filter (`outcome=voicemail`) later.

**Note:** `voice_sessions` still uses the legacy `id` PK + `tenant_id REFERENCES tenants(id)` (pre PK-rename convention) — fine, just don't expect `voice_session_id`.

**Your action:** none yet (code work). **Verify:** after deploy, place a call, leave a message, confirm a row appears in the Calls tab.

---

## Issue 4 — Persona ("not Beth", generic identity)  ⚠️ VERIFY ON RETURN

**Status:** Hypothesis — NOT confirmed (couldn't query prod DB).

**What I found:** `supabase/seed.sql` inserts tenant `d5e3c6a1` (lines 26, 34) but does **not** appear to set a Beth `system_prompt`/`first_message` (grep for those + "beth" on the tenant rows = nothing). `BETH_GO_LIVE_TODO.md` says "Beth persona + … 19 KB docs seeded on tenant d5e3c6a1 (prod DB)" — which suggests the persona may live in **KB docs (RAG)**, not `tenants.system_prompt`. The agent's identity comes from `tenants.system_prompt` (via `buildSystemPrompt customPrompt`); if that column is null, the agent falls back to the hardcoded **"Clara"** persona — which would explain "not Beth" even with config loading.

**Verify on return (one query):**
```
psql "<PROD_URL>" -c "SELECT name, first_message, left(system_prompt, 200) FROM tenants WHERE tenant_id='d5e3c6a1-7b9f-4e2a-bf30-8c11a5d8e9f0';"
```
- `system_prompt` null/generic → set Beth's persona via the dashboard **AI Persona** page (or SQL). That's the fix.
- `system_prompt` is Beth → the issue is prompt content/precedence; revisit `buildSystemPrompt`.

**Do NOT guess** — confirm the column first.

---

## Issue 5 — Option B: DID→tenant lookup (remove hardcoded dispatch metadata)

**Status:** Design confirmed against code; needed before tenant #2.

**Why:** Option A hardcodes `tenant_id` in the dispatch rule → every DID on that rule resolves to one tenant. Won't scale; `+1 630-822-9086` would misroute.

**Fix design (code-drafted, not committed):**
1. New backend route `POST /agent-tools/resolve-tenant-by-did` — **non-tenant-scoped** (it resolves *which* tenant, so it cannot require tenant context; relies on the `tenants` admin-bypass RLS policy), `x-agent-secret` auth, `SELECT tenant_id FROM tenants WHERE inbound_phone = $1` (`inbound_phone` is `UNIQUE`). Real-DB-testable in this repo.
2. `agent/src/toolsClient.ts` → `resolveTenantByDid(did)`.
3. `agent/src/sessionContext.ts` → make `buildSessionContext` **async**; after the metadata path fails, read the dialed DID from `participantAttributes['sip.trunkPhoneNumber']` (fallbacks `sip.to`/`sip.toUser`), **normalize to +E.164** (`shared/phone.ts`) to match stored `inbound_phone`, call `resolveTenantByDid`, return context. Metadata still wins → coexists with Option A.
4. `agent/src/index.ts` → `await buildSessionContext`.
5. Tests: known-DID→tenant, unknown→null, metadata-beats-DID, endpoint happy/sad.

**Your action:** after this ships + deploys, **remove** the hardcoded dispatch metadata. **Verify:** call both DIDs, each resolves to its own tenant.

---

## Issue 6 — Security: rotate logged credentials  ⚠️ YOUR ACTION

During this session two secrets entered the transcript:
1. **Prod DB password** (in the `psql` command for the migration) — `postgresql://postgres.sgibijfchvfuizudrmir:…@aws-0-us-west-2.pooler.supabase.com`. **Rotate** in Supabase → Project Settings → Database → Reset password, then update `DATABASE_URL` on `ai-sec` + `ai-sec-agent`.
2. **`AGENT_SECRET`** = `7dd8b22…e931` (the `openssl rand` value, now set on both services). Lower stakes (guards `/agent-tools/*`) but logged — **rotate** to a fresh value on both services after go-live.

---

## Suggested order of operations (for Dale)

1. **Start Telnyx 10DLC registration now** — it's the multi-day long pole (Issue 2).
2. **Verify the persona query** (Issue 4) — 1 minute, may be a 1-line fix that makes her "Beth."
3. Pick the voice by ear (Issue 1) — `ara` vs `eve` vs clone.
4. Greenlight the code work (Issues 3, 5, voice knobs) — I'll implement + you deploy + live-verify.
5. Build `TelnyxSmsAdapter` once the number is messaging-enabled (Issue 2).
6. Rotate the two logged secrets (Issue 6).

---

## Research provenance

- **Voice:** xAI `/v1/tts` docs fetched directly (authoritative) + deep-research workflow `w1wg8h3mr` (completed, high confidence — mostly unanimous adversarial votes; sources incl. xAI voice/TTS/custom-voices docs, Cloudflare, OpenRouter, Oracle GenAI). Catalog gender/accent, prosody params, free console cloning all corroborated.
- **SMS:** deep-research workflow `w6zyckg9e` — authoritative Telnyx support/developer docs; adversarial verification was rate-limited (false "inconclusive"), facts are standard A2P 10DLC and reliable.
