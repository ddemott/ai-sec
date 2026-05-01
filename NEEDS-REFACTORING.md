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

### ~~2. Wire `TenantConfigService` into the agent worker~~
**Status: done 2026-05-01.**

The hardcoded `DYNATIRE_TENANT_ID` / `TENANT_DEFAULTS` block in `agent/src/index.ts` is gone. The agent now calls a new `POST /agent-tools/tenant-config` route during session bootstrap (right before `buildSystemPrompt`), and the system prompt + greeting use the returned `name` and `timezone`. Soft-fails to "this business" / America/Chicago on backend error so a config blip never hangs up a live caller.

10 new tests cover both sides: 4 backend (`src/agentTools.test.ts` — happy, null-tz fallback, unknown tenant, non-UUID) and 6 agent-side (`agent/src/tenantConfig.test.ts` — happy plus 5 fallback paths).

**Caveat.** The route reads `tenants` directly via `withTenantClient`, not through `DatabaseTenantConfigService`. The class in `src/services/tenants/` remains dormant. A separate decision is still open: route the agent through that service for caching/extension, or delete the class as YAGNI. Tracked in CLAUDE.md "Migrated, Not Yet Wired" — not blocking multi-tenant production any longer.

#### Original audit notes (kept for context)

> `agent/src/index.ts` hardcodes DynaTire's tenant name and timezone at runtime. Any other tenant falls back to "this business" with no timezone. `src/services/tenants/` already implements `DatabaseTenantConfigService`; nothing calls it from the agent.
>
> **Why P0.** Hard blocker on multi-tenant production. Agent cannot serve a second tenant correctly.
>
> **What to do.** Add a `/agent-tools/tenant-context` route (or extend an existing one) that returns `{ name, timezone, ... }` for a given tenant_id. Have the agent worker call it during session bootstrap (right after parsing dispatch metadata). Delete the hardcoded DynaTire constants.

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

### ~~4. Retire `employee_shifts`~~
**Status: done 2026-04-30 (Phase 1 + Phase 2 both shipped).**

**Phase 1** (commit `2f3c911`): bridged the wizard's weekly pattern
to bookings via the new `expandWeeklyToSchedule()` helper and
`POST /shifts/expand-weekly` endpoint. Fixed a silent post-onboarding
bug where finished tenants couldn't book.

**Phase 2** (today): wizard's hours grid is now ephemeral form state
that posts the pattern to expand-weekly at finalize; the legacy
`/shifts` CRUD routes + `Api.shifts.list/create/update/delete` are
deleted; `/coverage/staffing` (which joined on `employee_shifts`) is
gone since nothing in the dashboard consumed it; `check_coverage_gaps`
and `check_availability_with_tz` rewritten to read employee_schedule
directly; the `employee_shifts` table dropped via migration
`20260430000002`. Test suite updated (createShift removed from
test-utils, ~17 obsolete CRUD tests deleted, all booking tests now
seed `employee_schedule` directly).

The platform now has one schedule table. The end state is what
NEEDS-REFACTORING #4 originally described in the "drop the legacy
table" framing — the path there just turned out to be longer.

#### Original audit notes (kept for context — preceded the Phase 1+2 split)

Pre-Phase-2, `employee_shifts` was actively read/written by:

- `src/routes/shifts.ts:51-119` — full CRUD endpoints (GET /shifts, POST /shifts/create, /shifts/:id/update, DELETE /shifts/:id)
- `src/routes/analytics.ts:58` — `/coverage/staffing` JOIN (the service-employee skill matrix)
- `dashboard/components/SetupWizard/SoloWizard.tsx` and `useWizardCrud.ts` — onboarding wizard writes initial weekly patterns here
- `dashboard/lib/hooks.ts` `useShifts()` + `Api.shifts.list/create/update/delete`

**Reality check.** The two tables coexist by design: `employee_shifts` holds weekly base patterns (the wizard's "Mon–Fri 9–5" affordance), `employee_schedule` holds date-specific entries (overrides + the source of truth booking RPCs read). CLAUDE.md's `employee_shifts` description (lines around 88) needs to be corrected.

**Real decision.** Either:
- **A — eliminate weekly patterns.** Wizard fans out the 7-day grid into `employee_schedule` rows for each onboarded employee + a recurring template. Drops the second table cleanly. Loses the "set once, forget" UX unless the wizard becomes a generator.
- **B — keep both, document accurately.** Update CLAUDE.md to reflect the dual-table reality, add a note that weekly patterns are the *base* and date-specific overrides win. No code changes; clears the misleading "LEGACY" label so future agents stop trying to drop it.
- **C — flip authority.** Make `employee_shifts` weekly the single source for booking, deprecate `employee_schedule`. Probably wrong — `employee_schedule` was added later with timezone fixes and night-shift support.

**Blocked on user pick.** Cannot do autonomously — affects setup wizard UX, analytics, 8+ test files, seed data. Originally listed as a mechanical drop; turns out to be a product decision.

---

### ~~5. Delete `src/templates/medical_v1.yaml`~~
**Status: done 2026-04-30.** Verified the YAML files in `src/templates/` are reference/seed material only — runtime template loading goes through the `business_templates` Postgres table, populated by `supabase/migrations/20260321000001_template_categories.sql`. No code path imports or reads `medical_v1.yaml`, and the migration's `med-spa` entry is aesthetic services (not HIPAA-regulated), distinct from the deleted clinic template. File deleted; CLAUDE.md and `src/services/MIGRATED_FROM_AI_SECRETARY.md` updated to reflect 5 industry templates instead of 6 with the medical one called out as dead.

---

### ~~6. Resolve `src/core/`~~
**Status: done 2026-04-30.** Option A taken — tests live alongside `src/` (e.g. `src/scheduling.test.ts`), `src/core/` directory deleted. Scheduling implementation remains at `shared/scheduling.ts`. Only stale reference is a historical entry in `docs/BUGS.md` (FIXED record), kept as part of the bug log.

---

### ~~7. Reconcile `src/services/MIGRATED_FROM_AI_SECRETARY.md`~~
**Status: done 2026-04-30.** File deleted. The migration was complete; the doc had drifted into stale-marker territory (referenced Vapi, deleted CI workflows like `pnpm-workspace-sanity.yml`, etc.). Useful content was already mirrored elsewhere: CLAUDE.md's "Migrated, Not Yet Wired" section covers the dormant CRM adapter layer, and NEEDS-REFACTORING #1/#2/#3 own the open decisions about adapter fate, TenantConfigService wiring, and UsageTrackingService. The dangling `docs/PLAN_COMMUNICATIONS_REMINDERS_INTEGRATION.md` reference fixed in the same commit.

---

### ~~8. Consolidate the bug-named test files~~
**Status: addressed differently 2026-04-30.** The original recommendation was to redistribute test cases by feature into feature-named files. Audit found the actual problem was *discoverability* — naming them after the historical bug sweep made them harder to find when working on a feature. The redistribute itself was moderate risk: each bug-named file spans many features, and splitting them by feature loses the "all the BUG-XXX cases live together" context that's useful for retro/audit.

Cheaper fix that solves the discoverability problem: every bug-named file now opens with a "Feature areas covered" header listing the surfaces the file touches. Searching by feature finds the file via the header comment. Files affected:

- `critical-bugs.test.ts` (BUG-001 timezone booking, BUG-002 email tenant scoping, BUG-006 RLS)
- `high-bugs.test.ts` (BUG-007/8 RLS + api_user, BUG-009/27 booking validation, BUG-012 JWT, BUG-010/11/26 input validation)
- `medium-bugs.test.ts` (BUG-013 reservation cleanup, BUG-014 booking, BUG-022/23 names, BUG-029 day-of-week, BUG-020 pagination)
- `low-bugs.test.ts` (BUG-040 booking duration, BUG-052 schema, BUG-057 timezones)
- `voice-ai-fixes.test.ts` (BUG-060/61/62 voice booking)
- `architecture-review-fixes.test.ts` (Fix #1 booking, #2 coverage, #4 RLS, #5 rate limit, #6 helmet)
- `bugfix-comprehensive.test.ts` (tenant isolation, DELETE 404, Zod validation, HubSpot webhook, knowledge upload)

`bugfix-regression.test.ts` from the original list never existed.

If a true redistribute is wanted later, the entry can be reopened — but the discoverability cost the entry actually flagged is now resolved.

---

## P2 — Code quality / convention drift

### ~~9. Switch agent TTS from OpenAI to xAI Grok (Phase 4)~~
**Status: code-complete 2026-05-01.** New `agent/src/grokTTS.ts` implements `tts.TTS` (24kHz mono PCM) against `https://api.x.ai/v1/tts`. The primary `voice.AgentSession` in `agent/src/index.ts` now uses GrokTTS; the `runFallback()` last-resort path still constructs `openai.TTS` so a missing/invalid `XAI_API_KEY` never produces dead-air on a live call. Voice configurable via `XAI_TTS_VOICE` env (`eve | ara | rex | sal | leo`, default `ara`). 9 unit tests in `agent/src/grokTTS.test.ts` cover request shape (URL, bearer auth, body keys), frame emission with `final:true` on the trailing frame, abort handling, upstream non-2xx → error event, and `updateOptions()` voice swap. `npx tsc --noEmit` clean both backend and agent; agent suite is now 53 passing tests.

**Caveat.** End-to-end validation requires a live PSTN call, currently blocked on Telnyx ticket #2850682. Once that clears, the first call should be on the new `+1-630-937-9478` number with `XAI_API_KEY` set in Railway. If GrokTTS misbehaves, swapping back is a one-line revert in `agent/src/index.ts`.

**Open follow-up.** Per-tenant voice override is not wired. The `XAI_TTS_VOICE` env is process-global. Wiring it into `tenant_config` requires the same call as #2's `DatabaseTenantConfigService` decision — defer until that lands.

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
