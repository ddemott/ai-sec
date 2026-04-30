# NEEDS-REFACTORING

Living refactor backlog for the AI Secretary codebase. Items are ordered highest priority first. Renumber freely.

This is for **structural cleanup of existing code** — dead code to delete, dormant layers to wire-or-remove, conventions to enforce. New features and improvements live in `improvement-ideas.md`.

Last updated: 2026-04-28.

---

## P0 — Compounding debt or production blockers

### 1. Decide the fate of `src/services/crm/` (20+ dormant adapter classes)
**Problem.** `src/services/crm/` ships a `BaseCRMAdapter` interface and ~20 concrete adapters (GoHighLevel, Acuity, Booksy, Calendly, Mindbody, Pipedrive, Salesforce, Vagaro, Zenoti, Zoho, etc.) plus a `createCRMAdapter()` registry factory. **Zero routes consume any of it.** Meanwhile, the CRM integrations actually used in production (`jobberClient.ts`, `hubspotClient.ts`, `squareClient.ts`, `servicetitanClient.ts`) live as flat files alongside it, in a different shape.

**Why P0.** Two parallel CRM patterns rot fast. Every new contributor wonders which one to extend. Each new flat-client integration makes the eventual migration to the adapter pattern bigger.

**Options.**
- **A — Migrate flat clients to the adapter pattern.** Refactor jobber/hubspot/square/servicetitan into adapters under `crm/`, route them through the registry, delete the flat files. Significant work but resolves the duplication permanently.
- **B — Delete the unused adapters.** If the migration plan no longer applies, `git rm -r src/services/crm/` and continue with the flat pattern. Smallest change, accepts the current shape as the shape.
- **C — Park explicitly.** Add a top-of-file note in each adapter explaining the dormant status and projected wire-up date.

**Files.** `src/services/crm/*` (all), `src/services/jobberClient.ts`, `src/services/hubspotClient.ts`, `src/services/squareClient.ts`, `src/services/servicetitanClient.ts`.

---

### 2. Wire `TenantConfigService` into the agent worker
**Problem.** `agent/src/index.ts` hardcodes DynaTire's tenant name and timezone at runtime. Any other tenant falls back to "this business" with no timezone. `src/services/tenants/` already implements `DatabaseTenantConfigService`; nothing calls it from the agent.

**Why P0.** Hard blocker on multi-tenant production. Agent cannot serve a second tenant correctly.

**What to do.** Add a `/agent-tools/tenant-context` route (or extend an existing one) that returns `{ name, timezone, ... }` for a given tenant_id. Have the agent worker call it during session bootstrap (right after parsing dispatch metadata). Delete the hardcoded DynaTire constants.

**Files.** `agent/src/index.ts`, `agent/src/sessionContext.ts`, new endpoint in `src/routes/agentTools.ts`, wire to `src/services/tenants/`.

---

### 3. Resolve `UsageTrackingService` (in-memory stub vs. real billing)
**Problem.** `src/services/usage/UsageTrackingService.ts` records SMS/calls/emails to an in-memory map. No DB persistence, no Stripe sync. CommunicationService thinks it's tracking usage; nothing downstream actually reads the result.

**Why P0.** Pretends to support per-tenant billing. The longer it lives in this state, the more callers couple to a stub interface that will need to change when real persistence lands.

**Options.**
- **A — Implement.** Add a `usage_events` table, swap the in-memory map for DB inserts, add a Stripe metered-billing reporter that batches events on a cron. Real work — track separately as a feature.
- **B — Delete and unwire.** Remove the service, drop the calls from `CommunicationService` and any other callers. Re-add when real billing becomes a near-term need.

**Files.** `src/services/usage/`, all callers (search for `UsageTrackingService`).

---

## P1 — Dead code / unused layers eating mental overhead

### 4. Drop the legacy `employee_shifts` table
**Status.** CLAUDE.md confirms: "LEGACY (weekly patterns, day_of_week 0-6) — NOT used by any production code." All scheduling reads from `employee_schedule`.

**Why.** Dead schema is a footgun. Someone — including a future agent — will eventually write a query against the wrong table.

**What to do.** Verify zero production references (grep `employee_shifts` excluding `employee_schedule`). If clean, write a migration that drops the table and any orphaned indexes/constraints. If references remain, fix them first.

---

### ~~5. Delete `src/templates/medical_v1.yaml`~~
**Status: done 2026-04-30.** Verified the YAML files in `src/templates/` are reference/seed material only — runtime template loading goes through the `business_templates` Postgres table, populated by `supabase/migrations/20260321000001_template_categories.sql`. No code path imports or reads `medical_v1.yaml`, and the migration's `med-spa` entry is aesthetic services (not HIPAA-regulated), distinct from the deleted clinic template. File deleted; CLAUDE.md and `src/services/MIGRATED_FROM_AI_SECRETARY.md` updated to reflect 5 industry templates instead of 6 with the medical one called out as dead.

---

### 6. Resolve `src/core/`
**Problem.** Directory contains test files (`scheduling.test.ts`, `scheduling-overrides.test.ts`) but no implementation — the actual scheduling code lives in `shared/scheduling.ts`. New readers see a `core/` dir and assume it's load-bearing.

**Options.**
- **A — Move the tests** next to their subject (`shared/scheduling.test.ts`) and delete the empty `src/core/` directory.
- **B — Promote `core/` to a real module** by moving `shared/scheduling.ts` into it. Pick whichever direction matches the project's intended layout.

---

### 7. Reconcile `src/services/MIGRATED_FROM_AI_SECRETARY.md`
**Problem.** A migration-progress marker checked into the source tree. Either the migration is done or it isn't.

**What to do.** Confirm completion status, fold any still-relevant notes into `docs/` (not the source tree), delete the file.

---

### 8. Consolidate the bug-named test files
**Files.** `medium-bugs.test.ts`, `low-bugs.test.ts`, `high-bugs.test.ts`, `critical-bugs.test.ts`, `voice-ai-fixes.test.ts`, `architecture-review-fixes.test.ts`, `bugfix-comprehensive.test.ts`, `bugfix-regression.test.ts`.

**Problem.** These were created during specific bug-fix sweeps. The bugs are long fixed; the tests now just describe behaviors the system should keep. Naming them after the historical sweep makes them harder to discover when working on a feature.

**What to do.** Read each test file, redistribute the cases into the feature-named test files they actually relate to (e.g., a scheduling assertion goes in `scheduling-atomic.test.ts`). Delete the bug-named files when empty.

**Risk.** Moderate. Need to make sure no test loses coverage during the move.

---

## P2 — Code quality / convention drift

### 9. Switch agent TTS from OpenAI to xAI Grok (Phase 4)
**Status.** Documented as Phase 4 of the framework migrations in CLAUDE.md but not started in the new LiveKit-native stack. The agent worker currently calls `openai.TTS` at `agent/src/index.ts:122,150`. The earlier Grok-via-Vapi-proxy (`src/routes/tts.ts`) was deleted in commit `661d21d` along with the rest of the Vapi rip-out, so the project has prior Grok integration experience but no current Grok wiring.

**Why a refactor concern.** Doubles down on OpenAI for both LLM and voice — concentrates vendor risk and per-minute cost on one provider. The decision to switch was already made and documented; the longer it sits unfinished, the more Phase 4's context fades.

**What to do.**
- Build a `GrokTTS` class in `agent/src/` matching the LiveKit Agents TTS plugin interface, calling `https://api.x.ai/v1/tts` directly.
- Wire it into the voice.Agent at `agent/src/index.ts:122,150` (replacing `openai.TTS`).
- Add `XAI_API_KEY` to `.env.production.example` and to Railway env on the `ai-sec-agent` service.
- Pick a default voice ID; allow per-tenant override via tenant config.
- Test end-to-end with one live call before retiring the OpenAI TTS path.

**Files.** `agent/src/index.ts`, new `agent/src/grokTTS.ts`, env config, `tenant_config` schema if per-tenant voice is desired.

**Note.** Soft dependency on task #2 if you want per-tenant voice (`TenantConfigService` wiring). Standalone otherwise — ship a single global voice first.

---

### 10. Extract shared CRM sync structure
**Problem.** `jobberSync.ts`, `hubspotSync.ts`, `squareSync.ts`, `servicetitanSync.ts` likely share a strong push-pull-merge skeleton (timestamp-based merge, COALESCE non-conflicting fields, sync-map upsert). `oauthCallbackFactory.ts` and `tokenManagement.ts` already extracted the OAuth bits; the sync orchestration itself is probably still copy-pasted.

**What to do.** Read all four sync modules side-by-side. Identify the shared shape. Extract into `src/services/crmSyncBase.ts` (or fold into the existing `syncOrchestrator.ts`). Each provider keeps only its provider-specific mapping function.

**Worth verifying first.** Do a real diff of the four files before committing to this — extraction only pays off if the shared structure is genuinely large.

**Note.** Conflicts with task #1 if option A there is chosen (the adapter pattern would subsume this). Sequence: decide #1 first.

---

### 11. Audit `src/index.ts` (385 lines) for extraction opportunities
**Problem.** Backend entry has grown to 385 lines including pool config, middleware chain, JWT decoder, route registration, reminder-scheduler lifecycle, and graceful shutdown. Some of this is irreducible Fastify plumbing; some of it can move out.

**Candidates.**
- Pool creation (`new Pool(...)` + `withTenantClient`) → `src/database/pool.ts`
- JWT preHandler logic → `src/middleware.ts` (already exists)
- Reminder-scheduler start/stop → its own `src/workers/index.ts` lifecycle module

**Effort.** Small per extraction. Worth doing once the file crosses ~500 lines or the next reader spends real time finding things.

---

### 12. Prune or split `improvement-ideas.md` (142KB, 156 sections)
**Problem.** A backlog file this large stops being a working document and becomes archaeology. Resolved-but-not-removed entries (e.g., "phone normalization" marked resolved 2026-04-23) still occupy space.

**What to do.**
- Sweep all `Status: resolved` entries — delete or archive to `docs/improvement-ideas-archive.md`.
- Consider splitting by area: `improvement-ideas-backend.md`, `improvement-ideas-dashboard.md`, etc.
- Or: migrate the genuinely active items into this file (NEEDS-REFACTORING.md) and let the rest decay.

---

### 13. CLAUDE.md and MEMORY.md drift detection
**Problem.** Both files are hand-maintained. Today's edit caught the route count off by one (24 vs 25), the migration count off by one (76 vs 77), and 8 missing directories. This drift will recur every time someone adds a route or service.

**Options.**
- **A — Scripted derivation.** A `scripts/verify-claude-md.ts` that compares CLAUDE.md's claims (route count, migration count, listed dirs) against the filesystem and exits non-zero on drift. Wire to a pre-commit hook or CI job.
- **B — Trim the auto-rotting parts.** Remove specific counts/lists from CLAUDE.md and let readers run `ls src/routes` themselves. Keep CLAUDE.md to genuinely durable architectural facts.

---

## P3 — Housekeeping

### 14. Investigate and resolve `pw.txt`
**Status: open — needs user judgment.** File is already gitignored (`pw.txt` is in `.gitignore`'s sensitive-files block) and was never committed to the repo. Cleanup pass on 2026-04-30 deliberately did NOT delete it: contents could be a real password or a deliberate local note, and that's the user's call. Single-line, 17 bytes, on disk only.

---

### ~~15. Stop tracking `.log` files at repo root~~
**Status: done 2026-04-30.** `*.log` was already in `.gitignore` and the working-tree `backend.log` / `dashboard.log` were untracked stragglers from a prior dev session. Both deleted from disk; CI/local runs regenerate as needed.

---

### ~~16. Archive completed session-summary docs~~
**Status: done 2026-04-30.** Three files originally listed:
- `SUMMARY-2026-04-24-0030.md` — already moved to `docs/sessions/2026-04-24-summary.md` in earlier commit `bea6129`.
- `TICKET_SUPPORT.md` — moved to `docs/TICKET_SUPPORT.md` (under `docs/` rather than `docs/sessions/` because the Telnyx ticket is still open, actively referenced from 7 other docs, and the bare-filename references inside `docs/*` files keep working as siblings without edits). The two root-level references in README.md and CLAUDE.md updated to the new path.
- `ux-review-notes.md` — current root-level file is an untracked working scratchpad (a different file from the previously-archived `docs/sessions/2026-04-20-ux-review.md`); left in place since it isn't a committed root-level doc.

---

### ~~17. Decide the fate of `.Clairvoyance/` and `.gemini/`~~
**Status: done 2026-04-30.** Both were abandoned. `.Clairvoyance/` already had a `.gitignore` entry but 3 stale tracked JSON files (editor-session, ui-state, workspace-session) and a never-filled-in LIBRARY.md boilerplate. `.gemini/settings.json` was also tracked. `git rm --cached` on all 4, added `.gemini/` to `.gitignore`, deleted both directories from disk.

---

### ~~18. Clean `coverage/` and `coverage_data/` from the working tree~~
**Status: done 2026-04-30.** Both were already in `.gitignore` (`/coverage` and `/coverage_data` lines). The working-tree `coverage/` directory (test-run output from 2026-04-12) was untracked; deleted from disk. `coverage_data/` did not exist on disk.

---

## How to use this file

- When starting refactor work, pick the lowest-numbered open item that fits your time budget.
- Mark items completed by adding `**Status: done <date> <commit>**` and striking the title (`### ~~1. ...~~`). Periodically delete completed items to keep the file scannable.
- When you discover a new structural concern, add it under the right priority bucket and renumber if needed.
- Items that turn out to be feature work (not refactors) move to `improvement-ideas.md`.
