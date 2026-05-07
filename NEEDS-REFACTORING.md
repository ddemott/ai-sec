# NEEDS-REFACTORING

Living refactor backlog for the AI Secretary codebase. Items are ordered highest priority first. Renumber freely.

This is for **structural cleanup of existing code** — dead code to delete, dormant layers to wire-or-remove, conventions to enforce. New features and improvements live in `docs/IMPROVEMENT_IDEAS.md`.

Last updated: 2026-05-05 (#3, #10, #12, #13 closed across the 2026-05-04 + 2026-05-05 sessions; #10 broader extraction, #11 deferred part, and #14 are the only items still open).

## In-flight markers

Same convention as `docs/TODO.md`. Every open entry below uses one of:

- **IN FLIGHT (decision pending)** — needs user judgment / green-light before code work can start.
- **IN FLIGHT (partially shipped)** — some pieces shipped to main, others deferred (with explicit reasoning). The remaining pieces are pickable when the deferral conditions change.
- **open, not started** — Claude can pick this up today without further discussion.
- Strikethrough title + `**Status: done <date> <commit>**` — fully shipped on main, kept for context.

## Resolution lens

Every "wire this dormant layer or delete it" entry below resolves through the same lens (see `CLAUDE.md` → Build Principles):

1. **Can it be tested against a real external surface today?** A real CRM account, a real Stripe metered-billing event, a real provider API. Mocked-API tests don't count.
2. **Is there a real customer or sales conversation asking for it?** "Pro tier roadmap" and "we might need this someday" don't qualify.

If the answer to both is no, the entry resolves to *delete*. Speculative scaffolding is more expensive than re-adding the layer when a real consumer arrives. Resolved that way for #1 (CRM adapters, deleted 2026-05-02) and #3 (UsageTrackingService, deleted 2026-05-04), and applies to any future "dormant layer" entries.

---

## P0 — Compounding debt or production blockers

### ~~1. Fate of `src/services/crm/` (20+ dormant adapter classes)~~
**Status: done 2026-05-02.** Option B — entire directory deleted (`git rm -r src/services/crm/`). 21 adapters + `BaseCRMAdapter` interface + `createCRMAdapter()` factory + the mocked-API test file removed; 3,480 lines net. Decision policy locked: **anything we can't test against gets deleted; when a beta customer brings a CRM we don't have a flat client for, we wire it up at that point.** The 20+ adapters had never been exercised against real CRM credentials (write-only code), and two of them (`dentrix.ts`, `eaglesoft.ts`) were dental-practice CRMs that violated the platform's HIPAA-excluded-vertical policy. The four working flat clients (jobber/hubspot/square/servicetitan) are unaffected. Test count: 1,495 → 1,475 (the 20-test drop is the deleted `crm-adapters.test.ts`, which mocked the CRM APIs rather than exercising them — exactly the validation gap that drove the decision).

---

### ~~2. Wire `TenantConfigService` into the agent worker~~

**Status: done on main 2026-05-03 (path B from the reopened-on-2026-05-03 entry).** Multi-tenant production no longer blocked by the agent worker's display path.

The hardcoded `DYNATIRE_TENANT_ID` / `TENANT_DEFAULTS` block in `agent/src/index.ts` is gone. The agent now calls a new `POST /agent-tools/tenant-config` route during session bootstrap (right after building the tools client, right before `buildSystemPrompt`), and the system prompt + greeting use the returned `name` and `timezone`. Soft-fails to "this business" / America/Chicago on backend error so a config blip never hangs up a live caller.

10 new tests cover both sides: 4 backend (`src/agentTools.test.ts` — happy, null-tz fallback, unknown tenant, non-UUID) and 6 agent-side (`agent/src/tenantConfig.test.ts` — happy plus 5 fallback paths: success:false, HTTP 500, missing name, missing timezone, HTTP 401).

#### History

- **2026-05-01:** Originally implemented as commit `e92b3bf` on a `hold-tenant-config` branch. CLAUDE.md and session memory claimed this had landed on main, but the branch was never merged — the agent worker on main still hardcoded DynaTire. Discovered 2026-05-03 during the voice-fallback validation work (NEEDS-REFACTORING #9).
- **2026-05-03 (path B):** Redone directly on main, reusing the branch's design (route shape, agent module API, soft-fail semantics) as a reference. The branch is now superseded; nothing on it is uniquely valuable. The redo took ~30 minutes because the design was already proven on the branch.

**Caveat (carried over from the original entry).** The route reads `tenants` directly via `withTenantClient`, not through `DatabaseTenantConfigService`. The class in `src/services/tenants/` remains dormant. A separate decision is open: route the agent through that service for caching/extension, or delete the class. The Build Principles "test or delete" lens marks delete as the default unless caching shows up as a measurable hot spot — see CLAUDE.md "Migrated, Not Yet Wired".

10 new tests cover both sides: 4 backend (`src/agentTools.test.ts` — happy, null-tz fallback, unknown tenant, non-UUID) and 6 agent-side (`agent/src/tenantConfig.test.ts` — happy plus 5 fallback paths).

**Caveat.** The route reads `tenants` directly via `withTenantClient`, not through `DatabaseTenantConfigService`. The class in `src/services/tenants/` remains dormant. A separate decision is still open: route the agent through that service for caching/extension, or delete the class as YAGNI. Tracked in CLAUDE.md "Migrated, Not Yet Wired" — not blocking multi-tenant production any longer.

#### Original audit notes (kept for context)

> `agent/src/index.ts` hardcodes DynaTire's tenant name and timezone at runtime. Any other tenant falls back to "this business" with no timezone. `src/services/tenants/` already implements `DatabaseTenantConfigService`; nothing calls it from the agent.
>
> **Why P0.** Hard blocker on multi-tenant production. Agent cannot serve a second tenant correctly.
>
> **What to do.** Add a `/agent-tools/tenant-context` route (or extend an existing one) that returns `{ name, timezone, ... }` for a given tenant_id. Have the agent worker call it during session bootstrap (right after parsing dispatch metadata). Delete the hardcoded DynaTire constants.

---

### ~~3. Resolve `UsageTrackingService` (in-memory stub vs. real billing)~~
**Status: done 2026-05-04.** Option B — `src/services/usage/` deleted (UsageTrackingService.ts + its test). `src/types/usage.ts` deleted (`Provider` enum + `UsageRecord` interface had no other consumers). Optional `usageTracker?` constructor param removed from `CommunicationService` and `SMSService`; no production caller had been passing it anyway (`src/routes/communications.ts`, `src/services/reminders/index.ts`, `communications.test.ts` all used the 2-arg form). The `await this.usageTracker.trackSMS(...)` block in `SMSService.sendSMS()` removed. Re-add when a metered-tier customer signs up — the shape will need to change for real DB persistence + Stripe meter event push, so re-implementing is cheaper than evolving the stub. Same lens disposition as #1 (CRM adapters, deleted 2026-05-02).

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
**Status: done 2026-04-30.** File deleted. The migration was complete; the doc had drifted into stale-marker territory (referenced Vapi, deleted CI workflows like `pnpm-workspace-sanity.yml`, etc.). Useful content was already mirrored elsewhere; the open decisions it pointed at have since closed (the dormant CRM adapter layer was deleted 2026-05-02 — see #1; tenant config was wired 2026-05-01 — see #2; UsageTrackingService remains open — see #3). The dangling `docs/PLAN_COMMUNICATIONS_REMINDERS_INTEGRATION.md` reference fixed in the same commit.

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
**Status: code-complete 2026-05-01, dead-air guard validated 2026-05-03.** New `agent/src/grokTTS.ts` implements `tts.TTS` (24kHz mono PCM) against `https://api.x.ai/v1/tts`. The primary `voice.AgentSession` in `agent/src/index.ts` now uses GrokTTS. The `runFallback()` last-resort path uses `openai.TTS` so a Grok outage / missing / invalid `XAI_API_KEY` never produces dead-air on a live call. **Important caveat caught during validation:** between 2026-05-01 and 2026-05-03, this entry's "OpenAI TTS in fallback" claim was aspirational — the actual `runFallback()` on main wired GrokTTS in both paths, leaving the dead-air guard non-functional. Closed 2026-05-03 by extracting `runFallback()` to `agent/src/fallback.ts`, switching its TTS to OpenAI, and pinning the OpenAI-not-Grok contract with 13 new 5W-annotated tests in `agent/src/fallback.test.ts`. Voice configurable via `XAI_TTS_VOICE` env (`eve | ara | rex | sal | leo`, default `ara`). 9 unit tests in `agent/src/grokTTS.test.ts` cover request shape (URL, bearer auth, body keys), frame emission with `final:true` on the trailing frame, abort handling, upstream non-2xx → error event, and `updateOptions()` voice swap. `npx tsc --noEmit` clean both backend and agent; agent suite is now 72 passing tests (was 66 before #2's tenant-config redo on 2026-05-03 added 6 more).

**Caveat.** End-to-end validation requires a live PSTN call, currently blocked on the open Telnyx ticket (original `#2850682` superseded 2026-05-01; new ticket awaiting reviewer). Once that clears, the first call should be on the new `+1-630-937-9478` number with `XAI_API_KEY` set in Railway. If GrokTTS misbehaves, swapping back is a one-line revert in `agent/src/index.ts`.

**Open follow-up.** Per-tenant voice override is not wired. The `XAI_TTS_VOICE` env is process-global. Wiring it into `tenant_config` requires the same call as #2's `DatabaseTenantConfigService` decision — defer until that lands.

---

### 10. Extract shared CRM sync structure — IN FLIGHT (narrow extraction shipped 2026-05-04, broader extraction deferred)
**Status: IN FLIGHT (narrow extraction shipped, broader extraction deferred).** The verify-first pass landed on a focused extraction of just the pagination loop; the broader push/pull skeleton extraction was considered and deferred under the "working flat code beats a dormant abstraction" build principle.

**Narrow extraction shipped 2026-05-04.** The 7 pagination loops across the 4 sync modules (`jobberSync` 2 loops, `hubspotSync` 1, `squareSync` 2, `servicetitanSync` 2) collapsed into calls to a new `paginateSync()` higher-order helper in `src/services/syncPaginate.ts`. The helper is 86 lines, fully unit-tested in isolation (9 tests, happy + sad: single page, multi-page cursor chain, empty page, non-string cursor types for ServiceTitan page numbers, item-error recovery, page-error fatal, page-error on first page, log-line format preservation, and the null-initialCursor case for Jobber's GraphQL `after: null`). The loop body is pure mechanism — fetch page → iterate items → catch per-item errors and continue → break on page-fetch error → terminate on `nextCursor === null`. Each provider's residual code is a thin closure that normalizes its provider-specific page shape (Jobber GraphQL `pageInfo`, HubSpot `paging.next.after`, Square `result.cursor`, ServiceTitan page-number with `hasMore`). The 4 sync files net −45 lines; the helper +86; the helper is reusable for a future 5th provider. Existing log-line formats preserved exactly so support runbooks that grep for the legacy strings still match.

**Broader extraction deferred.** The push/pull skeletons across the 4 providers (push-customer, push-appointment, pull-appointment) share a real ~30-line scaffold each, but each provider has at least one quirk that resists clean parameterization: Jobber's GraphQL response unwrapping + `userErrors` arrays, HubSpot's meeting↔contact association as a separate API call, Square's cancel-on-delete API call before sync-map clear, ServiceTitan's extra `appKey`/`tenantSid` token fields. Parameterizing all of these turns the "shared" function into the same kind of strategy pattern that NEEDS-REFACTORING #1 (the deleted CRM adapter layer) rejected on 2026-05-02. The build principle is "working flat code beats a dormant abstraction" — the 4 sync files are stable, no 5th provider is asking, and reading each provider's push/pull function linearly is more maintainable than reading a generic helper plus a config object plus a closure. **Re-evaluate when a 5th provider arrives** — the answer may flip if the shared scaffolding appears 5 times instead of 4.

---

### 11. Audit `src/index.ts` for extraction opportunities (385 → 279 lines, partially done) — IN FLIGHT (partially shipped)
**Status: IN FLIGHT (partially shipped) 2026-05-02.** Three extractions shipped in this order:
1. `fbc1eaf` — JWT preHandler extracted to `src/middleware.ts` as `registerJwtAuthHook(app, pool)` (also `generateToken`, `verifyToken`, `PUBLIC_ROUTES`).
2. `9b78030` — Pool config consolidated. `src/database/index.ts:getPool()` is now the canonical singleton with the deadlock-prevention timeouts, so reminders + communications inherit the same safety net as routes.
3. `5077fd6` — `withTenantClient` factory extracted as `createWithTenantClient(pool)` in `src/database/index.ts`. Routes and tests untouched (still receive it injected).

Net: `src/index.ts` 385 → 279 lines. 1,495 backend tests green throughout.

**Pool config drift fixed 2026-05-02.** The two-pool problem was the real safety win — `src/database/index.ts` `getPool()` was building a separate pool *without* the deadlock-prevention timeouts, so anything routed through the reminder scheduler / communications service had a softer safety net than the Fastify route surface. Consolidated: `getPool()` now applies `statement_timeout=30000` / `lock_timeout=10000` / `idle_in_transaction_session_timeout=60000` and `max=10`, and `src/index.ts` calls `getPool()` instead of constructing its own pool. Both consumers now share one singleton.

**`withTenantClient` factory extracted 2026-05-02.** The function body moved to `src/database/index.ts` as `createWithTenantClient(pool)`; `src/index.ts` now reads `const withTenantClient = createWithTenantClient(pool);`. Routes and tests are unchanged — they keep receiving `withTenantClient` as injected, which preserved the test-mocking pattern (route tests inject a closure that returns a mock `PoolClient`). The duplication of the function body is gone.

**Still open:**
- **Drop the `withTenantClient` parameter from `register*Routes` signatures.** Would let routes import the factory directly, but tests inject a mocked `withTenantClient` to avoid spinning up a real DB — switching to a singleton-based version means rewriting many test files around `vi.mock` or seeded test DBs. Real work, ~3-4h, defer until there's a separate reason to touch the test surface.
- **Reminder-scheduler start/stop** is now ~3 lines of conditional + ~5 lines of signal handler. Extracting adds more boilerplate than it removes. Skip unless other lifecycle work joins it.

---

### ~~12. Prune or split `improvement-ideas.md` (was 184KB / 2137 lines)~~
**Status: done 2026-05-04.** Pruned the closed entries; declined the split. Took the third option from the original framing: clarify the file's role as generator output, prune the closed entries that occupy space, accept the bulk of `Status: proposed` items as decay, and rely on `NEEDS-REFACTORING.md` / `docs/TODO.md` as the curated working lists.

Six closed task blocks deleted (1 `resolved 2026-04-23`, 3 `dropped 2026-04-30` from the same TTS batch consolidated into a one-line note at the parent batch header, 2 individually-dropped 2026-04-30 entries). One `ALREADY SHIPPED` entry (line 2000, the tenant-config duplicate that the journal-loop generator emitted right before commit `e92b3bf` landed) deliberately left in place — an inline note marks it as audit evidence of generator behavior, and the surrounding Self-Review at the end of that batch references it.

Preamble rewritten to make the file's status explicit: "This file is generator output, not a curated backlog. If a proposed task here matters enough to act on, promote it to NEEDS-REFACTORING.md or docs/TODO.md. Otherwise it decays." That framing is the honest answer — the journal-loop generator produces ideas faster than anyone can act on them, periodic prune passes remove closed entries, and trying to curate the 113 `proposed` tasks as a working list would be feature work without a real consumer.

Did NOT split by area. The two-file separation between this and `docs/IMPROVEMENT_IDEAS.md` (already documented as deliberate in `docs/TODO.md`) is the only split that maps to a real role distinction; further splits would add navigation overhead without payoff.

File: 2137 → 2089 lines (−48). Closed-task signal pollution cleared. Generator-side dedup ("check git log before proposing") remains a separate open issue tracked in `.remember/state.md` "Open questions" — unaffected by this prune.

---

### ~~13. CLAUDE.md and MEMORY.md drift detection~~
**Status: done 2026-05-04.** Option A shipped — `scripts/verify-claude-md.ts` is a drift-detector that runs on every backend CI job (`.github/workflows/ci.yml` → "Verify CLAUDE.md" step) and is also runnable locally via `npm run verify:claude-md`.

Five checks land:

1. **Route count** — every `(N) route modules?` claim in the current-state portion of CLAUDE.md must match the live count of `.ts` files under `src/routes/` (excluding tests + `routeHelpers.ts`).
2. **Migration count** — `(N) SQL migrations?` claims must match `supabase/migrations/*.sql`.
3. **Industry templates** — `(N) industry YAML bundles?` must match `src/templates/*.{yaml,yml}`.
4. **Directory existence** — every `\`/path\`` in the `## Key Directories` section must resolve on disk.
5. **Commit reachability** — every `commit \`<hash>\`` reference (and every bare backticked 7-12-hex-with-letter token) must be reachable from `main` via `git merge-base --is-ancestor`. This is the headline win — it would have caught the 2026-05-03 lie where `e92b3bf` was claimed shipped on 2026-05-01 but actually lived on the never-merged `hold-tenant-config` branch.

Two design calls worth noting:

- **Numeric counts skip the `## Resolved Issues` archive** (via `stripHistoricalSections`). Historical post-mortems are date-locked — "BUG-017 split the monolith into 20 route modules" was true in March 2026 and re-flagging it every time routes grow is the wrong signal. Commit-reachability still scans the FULL document because historical "I shipped X in commit Y" claims are exactly the kind that can lie.
- **`<!-- verify-claude-md: unmerged -->` opt-out marker.** A backticked hash followed by that HTML comment is recognized as expected-unreachable — used today on the `e92b3bf` reference itself, which the doc legitimately mentions to explain the 2026-05-03 incident. The marker renders as nothing in Markdown so prose stays clean.

Pure check functions are exported and tested in `scripts/verify-claude-md.test.ts` — 25 tests, happy + sad with 5W diagnostic comments, no I/O (filesystem and git access are injected).

---

## P3 — Housekeeping

### 14. Investigate and resolve `pw.txt` — IN FLIGHT (decision pending)
**Status: IN FLIGHT (decision pending) — needs user judgment.** File is already gitignored (`pw.txt` is in `.gitignore`'s sensitive-files block) and was never committed to the repo. Cleanup pass on 2026-04-30 deliberately did NOT delete it: contents could be a real password or a deliberate local note, and that's the user's call. Single-line, 17 bytes, on disk only.

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
- Items that turn out to be feature work (not refactors) move to `docs/IMPROVEMENT_IDEAS.md`.
