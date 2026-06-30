# SecretaryHQ — Resolved Issues Archive

Historical session journals, completed phases, and resolved bug logs. Moved out of `CLAUDE.md` on 2026-05-05 to keep the always-loaded context lean. Newest first.

---

## 2026-06-23 — Mechanical doc consistency hygiene pass (route counts + migrations + partial hosting refs)

- Synchronized all stale "26/27 route modules" and "140 migrations" references in secondary docs (root README.md, dashboard/README.md, docs/ARCHITECTURE.md, docs/DIAGRAMS.md, docs/diagrams/01-deployment-topology.mmd) to the canonical current values maintained in CLAUDE.md (29 route modules, 142 migrations) and enforced by `scripts/verify-claude-md.ts`.
- Refreshed the outdated enumerated list in docs/ARCHITECTURE.md §9.1 to accurately reflect current registered routes (incl. post-2026-06 additions: exportData for tenant portability, auditLog for owner history, selfService, health extraction; competitor CRMs removal noted).
- One Vercel "to be deployed" reference proactively aligned in ARCHITECTURE.md as part of the pass (full Vercel→Railway hosting alignment is follow-up mechanical task).
- Reworded the eslint-disable header comment across 38 files (35 `src/`+`shared/` modules, 3 `*.test.ts`) from "REFACTORING_TODO.md item 10" to "historical full cleanup (REFACTORING_TODO item 10; see RESOLVED.md for details)" — comment-only, no logic change.
- **Verification as proof (per CODING_STANDARDS review checklist + user instruction on tests/coverage for changes)**: 
  - Pre/post exhaustive `grep` for stale strings across *.md + *.mmd → 0 remaining stragglers reported.
  - Re-ran `npx tsx scripts/verify-claude-md.ts` (clean both times).
  - Re-ran `npm run format:check` (clean).
  - Re-ran full `npx tsc --noEmit` (root backend + `cd dashboard` + agent) — all clean, no output.
  - Re-ran `npm run checks` (format:check + lint --max-warnings 0 + all tsc) — exit 0, all gates green.
  - No behavioral .ts changes (the `.ts` edits are comment-only eslint-header rewords), so no new unit tests or 5W test blocks required (per AGENTS.md mechanical scope); the project's automated gates + full sweeps + 0-count proofs serve as the supporting verification that the consistency edits are safe and accurate. Full backend suite re-run green against test_db (1935 passed, 0 failed, 0 skipped). Updated RESOLVED per checklist.
- This keeps docs in sync with reality after the analytics/export/audit/RAG batch (PRs #56-59, #64-67) without introducing drift that would fail the guard on next PR.
- **PR #72 Copilot-review follow-up**: the sweep missed two agent tool-count mentions outside CLAUDE.md — fixed `README.md` ("12 tools" → "17 voice tools", phrased to note `transfer_call` uses SIP REFER not `/agent-tools/*`) and `docs/ARCHITECTURE.md` §0 ("12 voice tools" → 17). Also reworded the README ASCII diagram label (`Fastify /agent-tools/* (29 route modules)` → `Fastify backend (29 route modules; agent calls /agent-tools/*)` — the 29 is the whole backend, not the `/agent-tools/*` prefix), bumped the `docs/TODO.md` GAPS cross-ref date (GAPS.md was refreshed to 2026-06-23 in this PR), de-conflicted the `docs/DEPLOYMENT.md` Supabase-CLI bullet (drop global install → `npx supabase` / `npm run db:migrate`), and disambiguated bare doc references (`see RESOLVED` → `RESOLVED.md`; `per CLAUDE/HANDOFF` → `` `CLAUDE.md` / `HANDOFF.md` ``).

---

## 2026-05-29 — Improvement ideas triage + quick-win batch

- **IMPROVEMENT_IDEAS.md restructured** — verified all items against current code; 3 stale items closed (KB alert, shared Tenant type, SA tests already done); 1 item closed as invalid (parseDateRange in calendar.ts — no date params exist there); remaining items reworded to bite-size format with file:line, one-sentence do, concise done-when, size+impact.
- **UUID_RE → requireValidUUID in mappings.ts** — removed file-local `UUID_RE` regex; all 4 assign/unassign handlers now use `requireValidUUID` from routeHelpers. Tests updated to assert per-param error messages.
- **Tenant reorder batched** — replaced N-query for-loop with single `UPDATE … FROM unnest($1::uuid[], $2::int[])`. Reorder test updated to assert 1 query with correct array params.
- **CRM auth-init success envelope** — all 4 CRM providers (jobber, hubspot, square, servicetitan) now return `{ success: true, authUrl }` instead of `{ url }`. Updated: 4 backend routes, `api.ts` (4 type annotations), `CRMIntegrationCard` interface + `res.authUrl`. 4 auth test assertions updated.

---

## 2026 Early Reviews (March–April) — Bug & UX Cleanup (Historical)

During March–April 2026 code reviews, 72 bugs and 47 UX/a11y issues were tracked in a standalone bug log (the former `docs/BUGS.md`, since removed).

**Outcome:** All resolved (71 fixed, 2 not-a-bug, 47 UX issues resolved).

The standalone detailed log and per-session journals (`docs/sessions/`, `docs/BUGS.md`) have since been removed; the summary retained in this file is the surviving historical record.

This work established many of the consistency, accessibility, and empty-state patterns still used in the dashboard.

---

## 2026-05-28 — E2E flake fixes (timing synchronization in 3 tests)

Three known Playwright flakes fixed by replacing `waitForTimeout` with explicit DOM + network waits.

**1. `booking-alignment.spec.ts:295` — List sub-tab popover cancel**
- Root cause: fixed `waitForTimeout(800)` after clicking the Schedule tab wasn't long enough for `NewSchedulerView` (and its `view-tab-list` tab button) to mount. If the click landed before the button appeared in the DOM, Playwright would time out looking for the element. The Refresh button conditional check (`isVisible` with 2s grace) also silently skipped on slow renders, leaving stale data.
- Fix: replaced `waitForTimeout(800)` with `expect(view-tab-list).toBeVisible({ timeout: 8000 })`; replaced the conditional Refresh click with `expect(refreshBtn).toBeVisible({ timeout: 8000 })` + `refreshBtn.click()` + `waitForLoadState('networkidle')`.
- Same fix applied to `openAppointmentPopoverFromList` helper in `appointment-cancel-ui.spec.ts` (waited for `appointment-list-view` which is absent when the list is empty — now waits for the Refresh button which is always in the list header).

**2 & 3. `wizard-welcome-auto-open.spec.ts` — welcome dialog auto-open timing**
- Root cause: `switchToFreshTenant` used `waitForTimeout(600)` + `waitForTimeout(2000)` (total 2.6s) for `DashboardHome.loadData()` (6 parallel API calls) to settle. If the backend was under load or cold, loading took longer than 2s and the `AUTO_OPEN` effect hadn't fired when the assertions ran (even with an 8s assertion timeout, that wasn't the issue — the test assertions started before the load was done).
- Fix: removed `waitForTimeout(600)` (redundant after `page.goto` which waits for `'load'` by default) and replaced `waitForTimeout(2000)` with `page.waitForLoadState('networkidle')`. `networkidle` fires when all 6 `loadData()` responses have returned and there's 500ms of quiet — at that point `loading=false` is guaranteed, and the auto-open effect fires synchronously in the same render cycle.

---

## 2026-05-21 — Unauthenticated cross-tenant data access via `?tenant_id=` (CVE-class) + threadpool fix

**Two findings, fixed together; kept in separate commits.**

### Security: anonymous tenant-data access (read + write + delete)

While verifying that login worked end-to-end, an unauthenticated probe surfaced a serious hole:

```
GET /services?tenant_id=<any-tenant-uuid>     # no Authorization header → HTTP 200 + that tenant's data
DELETE /services/<id>/delete?tenant_id=<uuid>  # no auth → reached handler (404 on fake id, would delete a real one)
POST /services/create  {tenant_id:<uuid>,...}  # no auth → reached handler
```

**Cause chain:** (1) `registerJwtAuthHook` lets a request with no `Authorization: Bearer` header proceed anonymously (by design — handlers self-gate). (2) `tenantMiddleware` resolved the request tenant as `candidate || jwtTenant`, where `candidate` is the user-supplied `?tenant_id=`/body value; the 2026-05-06 cross-tenant override guard only fired when a `jwtTenant` already existed, so for an anonymous request it was skipped and the attacker-supplied tenant was trusted. (3) `requireTenantId` also fell back to `req.body.tenant_id` directly. (4) `withTenantClient` set RLS scope to the attacker-chosen tenant and returned its rows. RLS faithfully scoped to whatever tenant was set — RLS was never authentication, and there was no JWT to bound it. The 2026-05-06 isolation probe only tested an *authenticated* user overriding to another tenant; it never tested the *no-token-at-all* case, so this stayed open.

**Fix (`src/middleware.ts`):**
- `tenantMiddleware` now rejects any non-public, non-tenant-exempt request with no `req.auth` → **401**, *before* any tenant resolution can trust a user-supplied `tenant_id`. Public routes (login, password reset, demo, metrics, OAuth callbacks, HMAC-signed webhooks) and secret-authed `/agent-tools/*` (tenant-exempt, returns earlier) are unaffected.
- `requireTenantId` no longer falls back to `req.body.tenant_id` (trusts only the middleware-validated `req.tenantId`) and returns **401** ("Authentication required") when there is no authenticated session, rather than the misleading **400**.

**Verification:** live re-probe of GET/POST/DELETE anonymously → all **401**; authed own-tenant → 200; authed cross-tenant override → 403 (existing guard intact); public `/health` → 200. Added Probe 8 (5 cases: GET/POST/DELETE anonymous + body-injection + positive control) to `src/multi-tenant-isolation.test.ts` (now 39 probes). Full backend suite updated — 23 tests across 7 files had been pinning the old behavior (the misleading 400, the removed body fallback, and one test — `middleware.test.ts > "permits anonymous requests … to fall through"` — that literally encoded the hole); all rewritten to assert the correct fail-closed behavior, not weakened. Documented in `docs/SECURITY.md`.

### Perf: per-request `fs.readFileSync` on public routes

`GET /` and `GET /demo` re-read their HTML from disk on every request (blocking the event loop; spammable on unauthenticated routes). Moved the reads to module load (`LANDING_HTML` / `DEMO_HTML` constants); `{{DASHBOARD_URL}}` token still substituted per-request. `/demo` dropped from a per-request fs read to ~0.6ms.

### Production hardening + gap fixes (same day, 12 commits total `2461f08..cd185dd`, CI green, live in prod)

- **Deep `/ready`** — DB ping + pool saturation stats (`total/idle/waiting`), 503 when DB unreachable. `/health` stays shallow liveness. A monitoring signal, not a traffic gate.
- **Pool fail-fast** — `connectionTimeoutMillis=5000`: a checkout that can't get a slot under load now errors fast (→ `errors_total`) instead of hanging forever. The server-side GUCs (`statement/lock/idle-txn`) don't cap client checkout; this does.
- **Alerting visibility** — `withHandler`'s unhandled-error branch routes through `logError` so unknown route errors (incl. pool-checkout timeouts) increment `errors_total` and reach Sentry; previously a raw `req.log.error` did neither.
- **Gap 3 — bad client input → 400, not 500** — `withHandler` maps Postgres class-22 data exceptions (`22P02` etc., e.g. a non-UUID `:id`) to 400 and does NOT tick `errors_total`. Fixes ~12 unvalidated `:id` routes in one place + stops client garbage polluting 5xx/error-rate alerts. Verified live (`GET /records/customers/not-a-uuid/history` 500→400).
- **Gap 1A — agent graceful recovery** — `agent/src/prompt.ts` "Technical glitches" section: the LLM never speaks raw error text (`500`/`timed out`/`backend`), recovers in-character, never stalls silently on a backend tool failure. (Exact wording is owner-tunable.)
- **Gap 1 — agent dead-air guard** — the agent `entry` session-build/start/greeting is wrapped in try/catch → `runFallback`; a `session.start`/plugin-init throw now degrades to a "sorry" message instead of a silent job crash.
- **Testability extractions** — `jsonContentTypeParser` (+ bad-JSON now 400, was 500) and `readinessHandler` extracted to unit-tested modules; the route-test harness used a *different* parser, so the real one had never been covered (it's the one that once hung every JSON POST).
- **CI** — added an `agent` job (tsc + 99 tests; previously ungated entirely). E2E coverage added (anonymous-tenant 401, `/ready`, malformed-JSON). Fixed the `verify:claude-md` drift (migration count 122→126) that had main CI red ~3 days — first all-green 3-job run.
- **UX Cluster-B defect 1** — `SetupWizard/StepServices` duration field is clearable again (was forced to `0` by `parseInt||0`); 0 renders empty, save still rejects it. +regression spec.
- **UX Cluster-B defect 2** — `SuperAdminDashboard` business-search input was uncontrolled/dead; now filters the sidebar cards by name with a no-match message, and disables drag-reorder while filtering (new `draggable` prop on `TenantCard` — reorder is full-array-index based, so a filtered subset would corrupt order). +3 tests.
- **UX Cluster-B defect 3** — `SetupWizard` template-seed failure was a silent `console.warn` that left setup half-seeded with no recovery. Now: seed logic hoisted to a `runSeed` callback that **reconciles by name-diff** (creates only missing starter services, captured once in `seedTargetRef` so a user's own services aren't topped-up) → a partial-failure retry can finish (the old `services.length === 0` gate made retry impossible). Failure surfaces a Retry banner in the wizard body. +2 tests (failure surfaces banner; retry re-invokes + clears). All three Cluster-B defects now closed.
- **Mechanical refactor hygiene (REFACTORING_TODO #1)** — Eliminated duplication of voice CRM context types (`CustomerNote`, `VoiceSession*`, `CustomerContext`, `AppointmentSummary`/`History`, `formatContextForAI`) that lived in both `src/types/voiceCrm.ts` and `dashboard/lib/types.ts`. Single source moved to new `shared/voiceCrm.ts` (cross-runtime, no deps). Backend wrapper + dashboard re-exports preserve all public APIs. Both `tsc --noEmit` clean; zero stragglers per grep. CLAUDE.md + README.md + REFACTORING_TODO.md updated. Demonstrates the "extract after 3–4 consumers" + "shared/ for pure cross-boundary logic" principle in action.

**Still open (TODO → Production hardening):** P0 gate Railway deploy on CI green, P1 E2E-in-CI (needs Actions secrets), P2 healthcheck→`/ready`, Railway `METRICS_TOKEN`/`BETTER_STACK_TOKEN` + alert rules, gap-1 B/C, UX Cluster-B 2/3.

---

## 2026-05-17 — Production migration apply: prod brought from 86 → 122 migrations

Closes the long-standing **IN FLIGHT (prod-apply)** TODO item. Pre-apply, the production Supabase DB was 9 days behind `main` (latest applied was `20260508000001`, latest in repo was `20260514000000`). The TODO listed 4 dated groups (~9 files) but a `schema_migrations` diff against the filesystem showed **36 pending**, not 9 — the gap included the 26-file May-12 PK rename sweep and 3 May-9 RLS/error fixes that had never been called out separately.

**What got applied (36 migrations, version order):**

- **3 × May-9 fixes** — `password_resets_rls` (missing RLS on the table — direct security gap), `force_rls_voice_sessions_record_versions` (defense-in-depth FORCE RLS), `restore_granular_booking_errors` (re-adds specific error codes that an earlier RPC recreate had clobbered).
- **26 × May-12 PK rename sweep** — `ALTER TABLE … RENAME COLUMN id TO <table_singular>_id` across every domain entity table (record_versions, tenant_skills, reminder_schedules, consent_records, opt_out_records, voice_sessions, tenant_docs, users, services, resources, employees, employee_schedule, appointments, customers, tenants, user_feedback, soft_reservations, audit_log, unanswered_questions, phone_verifications, password_resets, call_transcripts, call_summaries, entity_sync_map) + 2 auto-version-trigger PK-aware recreates. Implements the PK column-name convention captured in CLAUDE.md (every single-column PK named `<table_singular>_id`, not bare `id`).
- **1 × May-11** — `employees_services_tenant_fk_cascade` (adds the missing `ON DELETE CASCADE` to `employees.tenant_id` + `services.tenant_id` — tenant delete previously left orphan rows; 85 orphans on local pre-fix).
- **5 × May-13** — `service_employee_tenant_fk_cascade` (same cascade fix; `ADD COLUMN IF NOT EXISTS` had silently no-op'd the original cascade clause in March), `tenants_notification_preferences` (adds `sms_enabled` + `email_enabled` columns — `PostgresTenantConfigService` was already mapping these column names but the schema lacked them, latent crash), `opt_out_records_fk_rename` (PK-rename follow-up: `original_consent_id` → `original_consent_record_id`), `deleted_customers_view_recreate` (rebinds the view's public columns after the customers PK rename), `soft_delete_restore_pk_aware` (`soft_delete_record()` / `restore_deleted_record()` now look up the PK column name from `information_schema` instead of hardcoding `id` — self-healing across future renames).
- **2 × May-01 → already on prod**, skipped (atomic booking GiST exclusion constraints + RPC exception wrapper — these had been applied earlier).
- **1 × May-14** — `reminder_retry_columns` (`retry_count INT DEFAULT 0` + `next_retry_at TIMESTAMPTZ NULL` on `reminder_schedules`, plus partial index — unlocks the retry-on-transient-failure worker logic that shipped May 14 in `src/workers/reminderScheduler.ts`).

**How the apply ran:**

- `./scripts/preflight-cloud.sh "$DATABASE_URL"` against `.env.production` first: 8 passed, 0 failed, 2 warnings (`pg_net` extension not enabled — irrelevant for these migrations; 31 existing tables — expected, not a fresh DB). Direct connection on port 5432 (not pooler 6543) confirmed.
- `./scripts/setup-db.sh "$DATABASE_URL"` — script reads `schema_migrations` once, then applies each pending file inside its own `--single-transaction` with `ON_ERROR_STOP=1`. Already-applied files SKIP cleanly. Stop-on-first-failure (script default; pass `--continue-on-error` to override, not used here).
- Output streamed: 86 SKIPs + 36 APPLYs + `APPLIED=36 SKIPPED=86 FAILED=0`. Total wall-clock under 30 seconds against the us-west-2 Supabase pooler endpoint.

**Post-apply verification (six invariants, all green):**

| Invariant | Expected | Actual |
|---|---|---|
| `schema_migrations` row count | 122 | 122 |
| GiST exclusion constraints on `appointments` | 2 (`_no_resource_overlap`, `_no_employee_overlap`) | both present |
| `reminder_schedules.retry_count` + `next_retry_at` | both | both |
| `tenants.sms_enabled` + `email_enabled` | both | both |
| PK renames took (sampled customers, appointments, tenants) | `<table>_id`, not `id` | all three renamed |
| FK cascade type on `employees` / `services` / `service_employee` `tenant_id_fkey` | `'c'` | all three `'c'` |

Backend smoke: `curl https://ai-sec-production.up.railway.app/health` → `HTTP 200` in 301ms post-apply. Backend code was already deployed assuming the renamed columns (local tests pass against them), so this apply brings prod-DB column shape into line with prod-code expectations — prior to this, any code path PKing renamed tables by name would have errored on prod.

**Discovery-vs-spec gap that bears calling out:** the TODO underspecified scope by 4x (9 files listed, 36 actually pending). The 27-file delta wasn't dropped on purpose — it was the cumulative result of two work weeks of merges where new migrations were added to the filesystem without the TODO being amended. Going forward, the safer pattern is to make `setup-db.sh` itself the source of truth (its `APPLIED_VERSIONS` query + filesystem diff) rather than a hand-maintained list in TODO.md.

**Still IN FLIGHT for Phase 13 launch (unchanged):** Telnyx PSTN unblock, `DASHBOARD_URL` + `SENTRY_DSN` env vars on Railway, browser-verify role gating + invite flow.

---

## 2026-05-17 — UX backlog: B3 + C3 + D1 + D3 + D4 + E3 (Phone Assistant KB, Home New Booking, wizard welcome, default-resource auto-seed, persistent setup-progress pill, active-call badge)

Closes six items from the 2026-05-16 `/ux-expert` audit plus the Phase 13 first-run guided tour:

- **B3** — Knowledge Base sub-tab moved from My Business → Phone Assistant. Sub-tab order under Phone Assistant is now Persona → Knowledge Base → Analytics (setup → setup → outcome). `'knowledge'` removed from `MyBusinessView`'s `VALID_SUB_TABS` — stale `?subtab=knowledge` bookmarks land on Services.
- **C3** — Primary "New Booking" button on Home. QuickBookPanel state hoisted into `DashboardHome`; `Api.customers.list` added to the `Promise.allSettled` batch; button is `disabled` when tenant needs setup so empty pickers can't look like a bug. Front-desk decision count for "book a call-in": 8+ (audit) → 3 (Quick Book hoisted) → 1.
- **D1** — Welcome screen ahead of `WizardModeChooser`. New `WizardWelcome` component sets scope ("~10 minutes from going live") and offers an explicit "I'll set up later, just show me around" exit before the binary solo/team fork. Wired into both auto-open (DashboardHome, new-tenant landing) and explicit-open (MyBusinessView Setup Assistant button) paths. Re-entry via the post-dismiss "Open Setup Assistant" banner skips welcome — the user has already chosen.
- **D3** — Auto-create default resource for 1-location team wizards. Extended the team wizard's existing `seedFromTemplate` effect to also create one resource when `resources.length === 0` on open. Vocab-driven name matches the SoloWizard finalize formula: `"Main Location"` for generic templates, `"<resource_label> 1"` otherwise (e.g. `"Bay 1"`, `"Chair 1"`, `"Truck 1"`). The "No resources yet" empty state in StepResources never shows for fresh tenants now — owners can rename, add more, or delete-and-replace, but the manual-create friction is gone for the common single-location case.
- **Coding standards: ESLint + Prettier adoption + CODING_STANDARDS.md expansion.** Installed `prettier@^3.3.3` across backend / agent / dashboard with a shared `.prettierrc.json` at repo root (semi: true, single quotes, 100 width, JSX double quotes, ES5 trailing commas) + `.prettierignore` covering build artifacts, `supabase/migrations/`, and historical post-mortem docs. Installed `@typescript-eslint@^7.18.0` for backend + agent (dashboard already had it transitively via `eslint-config-next`); all three projects now extend `plugin:@typescript-eslint/recommended-type-checked` — the official preset from the TypeScript team that uses the full type-checker for rules like `no-floating-promises`, `no-misused-promises`, `consistent-type-imports`. Created `tsconfig.eslint.json` (extends `tsconfig.json`, adds `scripts/` + `tests/` + test files) so typed lint covers everything without polluting the build graph. All rules land as `warn` initially so existing surface is visible without blocking CI; promotion-to-error per family tracked as cleanup TODOs. `CODING_STANDARDS.md` (184 → 626 lines) gained: **Tooling baseline** (with published-standards citations — typescript-eslint, Effective TypeScript, TS Handbook), **Testing conventions** (5W + HAPPY/SAD + isolation), **Backend route conventions** (`withHandler`, response envelope, `assertRowAffected`, Zod, tenant isolation), **Dashboard conventions** (Api namespacing, hook usage, component shape, `EmptyState`), **Commit message conventions** (Conventional Commits), **Code-review checklist**, **Formatting** (Prettier as enforcer + per-setting rationale), **Function and file size** (soft heuristics), **Pattern guidance** (composition over inheritance, hooks not HOCs, throw `AppError` not Results, flat services until 3rd caller). Verified: dashboard 680/680, backend 1910/1910, agent 91/91, all three tsc clean, all three `npm run lint` exit 0.
- **Trim CLAUDE.md** (154 → 125 lines, ~19% reduction). Removed: the Framework Migrations section (replaced with a one-line pointer to `docs/FRAMEWORK_MIGRATIONS.md`), the "Two persistent in-flight items" block (duplicated `docs/TODO.md`), the "Migrated, Not Yet Wired" section (`DatabaseTenantConfigService`, `ConsentRecord`/`OptOutRecord` — belong in TODO.md as deletion candidates), the "Test-skip honesty" + "Sentry error monitoring" narrative blocks (one-time-fix history, already in `RESOLVED.md`), and `/src/routes`/`/src/services`/`/src/types`/`/shared`/`/supabase/seed.sql`/`/docs`/`/certs` entries in Key Directories (derivable from the filesystem). Collapsed the 8-line Railway Deployment section to 4 lines pointing at `docs/DEPLOYMENT.md` (kept the prod URL, phone number, and webhook URL since those are commonly-referenced). Kept all high-signal content: Build Principles, Database Key Details (RLS, booking RPCs, ID + PK conventions), Code Conventions, `tenantMiddleware` 403-enforcement rule, tenant IDs / login / ports. Drift detector `npx tsx scripts/verify-claude-md.ts` still clean, 25/25 drift-detector unit tests still pass.
- **B1** — Merged "Service Assignments" (SkillMatrixView, grid) and "Skill Map" (SkillRelationshipMap, node graph) into a single My Team → Service Assignments sub-tab via the new `SkillAssignmentsView` wrapper with a Grid/Map toggle in the top-right. Both views operate on the same `service_employee` + `service_resource` mapping data at different zoom levels — keeping them as separate tabs was H4 (consistency and standards) noise. Active view persists to `?view=grid|map`; stale `?subtab=skill-map` bookmarks are normalized on mount to `?subtab=skills&view=map`. Switching off the merged tab discards the view override so the next visit defaults to Grid (the bulk-edit affordance most owners reach for first).
- **E2** — Consistent empty-state pattern across views. New `components/ui/EmptyState.tsx` primitive (icon + title + description + action slot, `centered` / `compact` variants). Migrated 4 high-visibility callsites: `AnalyticsView` ("No booking data yet"), `CRMView` ("No customers yet"), `NewSchedulerView` ("No staff to display" — preserved `data-testid="scheduler-empty"` for E2E hooks), `TeamAccessView` ("No team logins yet"). Left intentional drop-zone styled empties alone (`KnowledgeBaseView` upload zone, `SkillManagementView` skill grid, wizard internal steps) — they communicate "drop something here" not "you have nothing." Standardizes the H4 (consistency and standards) violation without flattening intentional distinctions.
- **First-run guided tour** (Phase 13 launch-blocker) — `FirstRunTour` overview modal that fires the first time a tenant lands on Home after completing the setup wizard. Single-modal design (not coachmark/spotlight) for v1: lists the five primary tabs (Schedule, Customers, Calls, My Business, Phone Assistant) with one-line descriptions and "jump to tab" clickable cards. Trigger: the Done button on both `SetupWizard` step 7 and `SoloWizard` step 3 calls `markFirstRunTourPending(tenantId)`, which writes `firstRunTour_<tenantId>` = 'pending' to localStorage. The tour reads on mount, sets the flag to 'shown' immediately to prevent StrictMode/re-render replays, and renders. Per-tenant gating so a super-admin managing many tenants sees the tour once per tenant.
- **E3** — Active-call badge on the Calls tab. Mirrors the unanswered-questions badge on the AI Insights tab: fetch `Api.voice.getActiveCalls(tenantId)` on mount + tab change, render a small numeric pill on the Calls tab when `total > 0`. Uses `var(--danger)` with `animate-pulse` (vs. the KB badge's calm `var(--accent)`) so a live call is visually distinct from "unanswered questions piled up." Rendered on both desktop FolderTabBar and mobile bottom-nav.
- **D4** — Persistent "Setup: N of 6 done" pill in OutlookLayout's top utility row (next to theme picker). New `useSetupProgress` hook counts six wizard-step proxies (services / resources / active employees / shifts in `employee_schedule` next 30d / `service_employee` mappings / auto-credited "Look it over" when steps 1-5 done). Auto-dismisses at 6/6. Click pushes `?tab=dashboard&wizard=open` and dispatches popstate; `DashboardHome` consumes the param on mount and force-opens the wizard past the welcome (pill clicks are second-touch — user already saw welcome on auto-open). Refetch via `notifySetupProgressChanged` window event, dispatched from both wizard-close handlers so the pill vanishes the same tick setup completes.

Verified: backend 1910/1910, dashboard 655/655 (+21 from D1+D4: 5 WizardWelcome + 4 DashboardHome staging + 7 useSetupProgress + 5 SetupProgressPill), agent 91/91, E2E 99 passed / 7 skipped (+6 cases on wizard-welcome-auto-open.spec.ts: 4 D1 auto-open + 1 D4 pill flow). Zero TS errors across all three projects.

Bug caught during D4 E2E: first pass pushed `tab=home` from the pill but the internal tab id is `dashboard` (the FolderTab label says "Home" but `VALID_TABS` lists `'dashboard'`). The popstate listener silently ignored the unknown tab, leaving the URL updated and the user stranded on Schedule. Spotted from the test-failure screenshot showing the pill rendering correctly but no tab change.

---

## 2026-05-14 — Per-tenant SMS rate limiter + 429 retry-policy carve-out

Closes TODO Phase 5 Ops "Rate limiting for SMS sends." Pre-fix the project relied entirely on the legacy SMS provider's account-wide throttle to bound SMS volume — a single tenant batching 200 reminders could exhaust the per-second budget for everyone else on the same account. (Legacy SMS provider support fully removed 2026-06; Telnyx is the only provider.) New behavior caps each tenant individually so a noisy tenant only slows itself down.

**Implementation:**

- New `src/services/communications/smsRateLimit.ts`:
  - `SmsRateLimiter` class — token bucket per `tenantId`, refilled lazily on each `acquire()` call based on elapsed wall-clock time.
  - Defaults: capacity=60, refillRate=1/sec (matches the TODO spec line "1 SMS/sec, 60/min"). Both env-configurable via `SMS_RATE_LIMIT_CAPACITY` / `SMS_RATE_LIMIT_REFILL_PER_SEC` for production tuning without a code change.
  - `acquire(tenantId)` throws `RateLimitedError` with `status: 429` and `retryAfterMs` (computed from bucket state — how long until the next whole token).
  - `tryAcquire(tenantId)` is the boolean alternative for call sites that prefer a flag.
  - Fresh tenants start with a full bucket so a small first send doesn't immediately rate-limit.
  - Defensive: a clock running backwards (NTP adjustment, DST boundary) doesn't refill the bucket.
  - Singleton `smsRateLimiter` shared across the process; tests construct fresh instances for isolation.

- Wiring in `src/services/communications/smsService.ts`:
  - `SMSService.sendSMS` calls `smsRateLimiter.acquire(tenantId)` after the consent check, before the provider call. On `RateLimitedError`, re-throws so the worker's retry policy sees the structured error.
  - `sendSystemSMS` deliberately does NOT rate-limit — opt-out confirmations are themselves bounded by inbound STOP/UNSUBSCRIBE volume, and dropping one would leave a customer wondering whether their opt-out took effect.

- Retry policy carve-out in `src/services/reminders/retryPolicy.ts`:
  - `isRetryable` now special-cases HTTP 429 as retryable before applying the generic "4xx → don't retry" rule. 429 is HTTP's canonical "wait and retry" signal — both the new in-process limiter and the (then) legacy provider's external throttle emit it. (Legacy SMS provider support fully removed 2026-06; Telnyx is the only provider.) Without this carve-out the reminder retry policy would mark rate-limited rows failed immediately, defeating the whole feature.

**Composition with retry logic (yesterday's commit):** rate-limited send → `RateLimitedError` (status 429) → reminder retry policy sees retryable → row's `retry_count` increments + `next_retry_at` set to now + 5/30/120 min → worker picks up after backoff → bucket has likely refilled → send succeeds. Zero new error plumbing required.

**Tests added** (+10 backend total):

- `src/services/communications/smsRateLimit.test.ts` (9 unit tests): fresh-bucket-full; drain-and-block at capacity; refill-rate math; capacity-cap (quiet tenants don't accumulate unbounded budget); RateLimitedError carries status=429 + retryAfterMs; **separate-tenants-have-independent-buckets** (load-bearing — the entire point of the feature); tryAcquire boolean shape; reset() for tests; clock-going-backwards defense.
- `src/services/reminders/retryPolicy.test.ts` (+1 test): 429 retryable carve-out. Existing 4xx-non-retryable test pinned the inverse — together they document the exact policy line.

**Configuration knobs for production tuning** (no code change needed):

- `SMS_RATE_LIMIT_CAPACITY` — max burst size (default 60). Raise for tenants with legitimate bulk-send needs.
- `SMS_RATE_LIMIT_REFILL_PER_SEC` — sustained rate (default 1.0). Raise to allow more sustained throughput per tenant.

**After-state:** backend 1,893 → 1,903 (+10). Zero TS errors. Drift detector clean. No migration needed — pure in-memory rate limiting.

---

## 2026-05-14 — Beta customer onboarding guide

Closes TODO Pre-launch hardening "Beta customer onboarding guide" — pre-fix the next beta customer would have needed a screen-share with the founder to get from "I'd like to try this" to "my voice AI is taking real calls." Now `docs/BETA_ONBOARDING.md` (~280 lines) walks through it.

**Contents:**

1. Pre-flight checklist — 8 items to collect before Day 1 (business name, timezone, employees + phones, services + duration/price, resources, weekly hours, skill-service mapping, policy answers). Explicitly flags timezone as "get this right on Day 1 — changing later requires re-converting historical timestamps."
2. Dashboard tab tour — the 4 primary tabs (Home / Schedule / Customers / Calls) + the 3 Back Office sub-tabs (My Business / My Team / AI & Knowledge), with what each is for.
3. Setup wizard — all 7 steps (Business type → Employees → Resources → Services → Assignments → Shifts → Go live) with what each step asks for and the most common mistakes (skipping shifts, service-skill mismatch, wrong timezone).
4. First test call — 4 scripted scenarios (book an appointment, ask a policy question, try an unavailable time, try a service you don't offer) with the expected AI behavior for each.
5. Knowledge base setup — the 9 policy categories with the questions to fill in first per category. PDF/doc upload path noted.
6. Daily workflow — the 5-min morning check (Home → flagged calls → mark-off-today). Frames most days as "I open Home and that's it; the AI handles everything else."
7. Weekly Copy Week — explains the date-based `employee_schedule` model + the Friday-afternoon copy-forward ritual. Includes the failure symptom (>4-week-out callers get "no availability") so the operator knows what to look for.
8. Common admin tasks — 7 entries (add employee, add service, update hours, mark off today, cancel appointment, move appointment via drag, invite front-desk login) each with the exact dashboard location.
9. Troubleshooting — 6 real failure modes likely to surface in beta (phone rings but AI never picks up, booked outside shifts, customer got wrong-time reminder, missing call in Calls tab, wrong price, "Something went wrong" boundary), each with diagnostic steps and root-cause hypothesis order.
10. Escalation — support email + status page + founder direct line for the first 30 days of beta.
11. HIPAA-excluded-verticals note — preserved from CLAUDE.md, called out so prospective beta customers know up-front.

**Out of scope** (left to the founder's first-30-days direct line): screenshots/screen-recordings, video walkthrough, per-template playbooks beyond mobile-tire's DynaTire example. Those are higher-fidelity content for later; this doc gets a beta customer unblocked on Day 1 without a human in the loop.

No code changes; pure docs. Linked from `docs/TODO.md` close note. Backend tests unchanged (1,893). Migration count unchanged (122). Drift detector clean.

---

## 2026-05-14 — Retry logic for failed reminder sends

Closes TODO Phase 5 Ops "Retry logic for failed sends." Pre-fix, `src/workers/reminderScheduler.ts` caught any send failure and immediately flipped the row to `status='failed'` — meaning a single transient legacy provider 5xx or DNS blip lost the reminder permanently. (Legacy SMS provider support fully removed 2026-06; Telnyx is the only provider.) The cure surface is one migration + one new module + one worker rewrite.

**Migration `20260514000000_reminder_retry_columns.sql`** adds two columns to `reminder_schedules`:

- `retry_count INT NOT NULL DEFAULT 0` — counts attempts spent; 0 = original attempt has not yet failed.
- `next_retry_at TIMESTAMPTZ` (nullable) — earliest pickup time after a transient failure. NULL = original attempt or terminal state.

Plus a partial index on `(scheduled_for, next_retry_at) WHERE status='scheduled'` so the worker's batch query stays fast as the row count grows.

**Policy module `src/services/reminders/retryPolicy.ts`** (pure helpers, no DB / no provider calls):

- `MAX_RETRIES = 3` — total retry attempts before permanent failure (4 total send attempts).
- `BACKOFF_MIN = [5, 30, 120]` — wait minutes before the 1st / 2nd / 3rd retry. Matches the policy line in the TODO ("5m / 30m / 2h").
- `isRetryable(error)` — `false` for 4xx HTTP errors (input is broken; re-send produces same result), `true` for 5xx and any error without HTTP status info (conservative: better over-retry than lose).
- `nextRetryAt(currentRetryCount, now?)` — returns the timestamp for the next attempt, or `null` if MAX exhausted. `now` injectable for tests.
- `decideRetry(error, currentRetryCount, now?)` — top-level composition; returns `{action: 'retry', nextRetryCount, nextRetryAt}` or `{action: 'fail', reason: 'non_retryable' | 'max_retries_exceeded'}`. Worker calls this once per failure and acts on the result.

**Worker rewrite** in `src/workers/reminderScheduler.ts` catch block:

Pre-fix: any error → `status='failed'`.
Post-fix: catch error → `decideRetry(err, row.retry_count ?? 0)` → either `UPDATE reminder_schedules SET status='scheduled', retry_count=N+1, next_retry_at=...` (transient + budget remaining) or `UPDATE ... SET status='failed', error='msg (reason: max_retries_exceeded)'` (4xx or budget exhausted). The `4xx vs max-retries` distinction surfaces in the `error` column for operator diagnostics.

**Pickup-query change** in `src/database/index.ts:getDueReminders`:

```sql
WHERE status = 'scheduled'
  AND scheduled_for <= NOW()
  AND (next_retry_at IS NULL OR next_retry_at <= NOW())  -- NEW
```

The `IS NULL` branch preserves back-compat: rows that have never failed (or that pre-date the migration) still qualify on the original `scheduled_for` clock. Rows mid-backoff are held back until their next_retry_at clears.

**Tests added**:

- `src/services/reminders/retryPolicy.test.ts` (13 unit) — `isRetryable` against 4xx / 5xx / network / no-status / 3xx-and-6xx edge cases; `nextRetryAt` against each backoff slot + MAX-exhausted; `decideRetry` composition; `BACKOFF_MIN.length === MAX_RETRIES` invariant.
- `src/reminder-retry-worker.test.ts` (7 real-DB integration) — schema introspection of the two new columns; pickup-query temporal contract across the 3 next_retry_at states (NULL / future / past); end-to-end worker write path for 5xx-retryable, 4xx-non-retryable, and 5xx-at-MAX-retries dispositions.

After-state: backend 1,873 → 1,893 (+20); migration count 121 → 122. Zero TS errors across backend / dashboard / agent. **Outstanding for prod-apply**: `20260514000000` joins the queue with the other 35 pending migrations. Production reminder workers will continue marking-failed-on-first-error until prod is migrated; the worker code is backward-compatible (it reads `retry_count ?? 0` so missing-column rows would behave as the pre-fix did — but the column-add migration is forward-only so this safety net only applies during the deployment gap).

---

## 2026-05-13 — PK rename pilot 28: real-DB integration coverage + final code-residue sweep

Closes the May 12 PK-rename sprint. After the per-pilot renames, only ~44% of the new `<table>_id` columns had real-DB test coverage. Pilot 28 added comprehensive coverage and cleaned up residual `id` references.

**Key outcomes:**
- New `src/pk-rename-coverage.test.ts` (30 tests) exercises every renamed PK against actual Postgres.
- 121 follow-up renames across routes, services, tests, shared/, dashboard, e2e, and seed.sql.
- 5 latent bugs surfaced and fixed during the sweep.
- All single-column PKs in public schema now follow the `<table_singular>_id` convention.

Full details (28 pilots, specific migrations, bugs found, and the 121-edit sweep) are in the original session notes and earlier entries in this file.

See also the compact summary table of all PK-rename pilots added in the May 12–13 block above.

## 2026-05-12 — PK naming convention conversion, Part 2: **non-domain cleanup (9 pilots, 9 migrations)**

Continuation of the sprint into the nine leaf tables. These still violated the `<table_singular>_id` convention even though they were "non-domain."

**Pilots summary (Part 2):**

| Pilot | Commit | Table | Notes / Latent Bugs |
|-------|--------|-------|---------------------|
| 17 | e570197 | user_feedback | Terminal table. Surfaced stale JOINs in analytics.ts |
| 18 | 766e07b | soft_reservations | Pure rename |
| 19 | a8d1379 | audit_log | Surfaced stale id ref in tenant-delete-cascade e2e spec |
| 20 | 0fca817 | unanswered_questions | Backend-compat alias kept on GET |
| 21 | f92a566 | phone_verifications | Backward-compat alias on API + e2e |
| 22 | dda9ddd | password_resets | Two latent bugs from pilot 9 (users.id) surfaced in invite + e2e teardown |
| 23 | 34d5387 | call_transcripts | Pure rename + RPC recreation |
| 24 | 9bb65e1 | call_summaries | Pure rename |
| 25 | (this commit) | entity_sync_map | Largest surface (20 files). Three latent bugs from prior pilots fixed in syncMapHelpers + jobberSync |

All green. Every single-column PK in the public schema now follows the convention.

Two follow-on pilots after Part 2 closed the schema-rename work itself. No migrations — pure code/test sweep — but they fixed real production bugs that the unit-test CI gate hadn't been catching.

**Pilot 26 — code-residue sweep** (`ad72daa`):

## 2026-05-12 — PK rename code-residue + test-mock sweep (pilots 26 + 27)

Two follow-on sweeps after the schema renames (no new migrations).

**Pilot 26 — code-residue sweep:** ~50 stale `WHERE id` / `RETURNING id` references found across the codebase. Reasons: Playwright e2e specs aren't in unit CI gate; multi-line SQL strings; a few production routes had stale SELECT projections. Touched 12 e2e spec files + many backend services/routes. Used `RETURNING ..._id AS id` backward-compat alias where needed.

**Pilot 27 — test-mock alignment:** Fixed real production bugs that mocked tests had hidden (mostly from earlier pilots).

Both pilots: backend + dashboard green. Significant latent bug surface area cleaned up.

| Pilot | Commit | Tables | Key Notes / Latent Bugs |
|-------|--------|--------|-------------------------|
| 1+2 | 40c57d5 | record_versions, tenant_skills | Recipe template set; view + 2 RPCs recreated |
| 3 | 29c27c1 | reminder_schedules | First SERIAL PK pilot |
| 4 | a89fd50 | consent_records | SERIAL PK |
| 5 | cb88e6c | opt_out_records | Same shape as pilot 4 |
| 6 | df44c50 | voice_sessions | Terminal table; RPC recreated |
| 7+8 | 6607873 | tenant_docs, tenant_integration_settings | No inbound FKs; tenant_calendar_settings deferred (composite PK) |
| 9 | c02ac5c | users | High entanglement (auth, JWT, polymorphic assignment_id) |
| 10 | 4e65bb1 | services | Major RPC entanglement; surfaced `auto_version_trigger` latent bug (fixed + SECURITY DEFINER + cascade guard restored). 14 dashboard components |
| 10 (fix) | e4f173c | — | Missed `BusinessSettingsView.test.tsx` Service-shape type (CI red) |
| 11 | d682ecf | resources | 3 RPCs; surfaced `fn_audit_trigger` latent bug. 25 dashboard files |
| 12 | b8287b9 | employees | 5 RPCs; night-shift test caught `check_availability_with_tz`. Kept `employee_id::text AS id` alias for polymorphic UNION |
| 13 | 010c6dc | employee_schedule | Smallest pilot; 2 RPCs |
| 14 | 389245e | appointments | Largest blast radius. 4 RPCs (table-qualified RETURNING to avoid ambiguity). Surfaced stale `services.id` in appointments.ts |
| 15 | 1dacf9b | customers | 4 RPCs. Surfaced stale `resources.id` in jobberSync |
| 16 | f486f6b | tenants | Sprint complete. 3 RPCs + trigger guards. Surfaced 3 latent bugs (notify_n8n, create_default_resources, database/index tenant existence check) |

**Trigger evolution:** Both `auto_version_trigger` and `fn_audit_trigger` now use CASE ON TG_TABLE_NAME for every versioned/audited table (required because each has its own renamed PK column).

**Standing authorization:** After the first two pilots, the user granted standing autonomous-commit approval (continue without re-asking as long as CI is green on first push). One pause only (pilot 10 dashboard tsc miss).

**Recipe (locked by repetition):** (1) Migration RENAME, (2) recreate affected RPCs, (3) extend triggers if needed, (4) code sweep with perl one-liner, (5) tests with `RETURNING ... AS id` backward-compat alias, (6) dashboard types + tsc sweep, (7) docs + drift detector, (8) one commit.

**Latent bugs surfaced during the sweep (real production issues that mocked tests had hidden):** See individual pilots above + detailed notes in the original May 12–13 entries.

**After-state:** backend 1,781 / dashboard 620 / agent 85 — all green. Zero TS errors. Drift detector clean. The sprint is **complete** for every domain entity table.

**Remaining decision:** `tenant_calendar_settings` (composite PK) — tracked in `docs/TODO.md`.

**Outstanding:** All 17 PK-rename migrations still need to land on production Supabase (forward-only, must be applied in order).
- `04a96b4` — **fix(e2e): stabilize two latent flakes.** `workflows.spec.ts` smoke asserted on seed-customer names visible in TODAY's calendar view (empty on weekends since DynaTire seeds Mon-Fri shifts only); replaced with unconditional `scheduler-date-display` check. `quick-book-shift-overrides` booking test used `today` for the booking date (failing legitimately on weekends) plus a broken `/shifts/overrides` URL that hit the dashboard's catch-all (HTML response) instead of the backend (port 4001) — `res.json()` threw, helper silently returned null, auto-assign landed on a non-scheduled employee. Fixed by walking to the next weekday, using the absolute backend URL, and skipping the service selection (orthogonal to the test's shift-coverage contract). Test also lacked cleanup — it had been "passing by failing" pre-fix; added try/finally with capture-from-response → DELETE.
- `07103cc` — **test(e2e): mobile-responsiveness audit on iPhone 14 + Pixel 7 viewports.** `mobile-responsive.spec.ts` (4 tests) drives the three daily-use flows (today's schedule, Quick Book, customer lookup) at 390×844 and 412×915 via `page.setViewportSize`. Asserts mobile bottom nav (`md:hidden`) surfaces the primary tabs, critical inputs/controls render visible, page never overflows its viewport horizontally. Audit found no regressions — `OutlookLayout`'s mobile nav + Tailwind responsive classes work cleanly at both widths.
- `ae7dd12` — **feat(schema): close tenant-delete cascade gap on employees + services.** **Surfaced a real data-integrity bug** while writing E2E coverage for the `DELETE /tenants/:id` cascade: `employees.tenant_id` and `services.tenant_id` were declared `NOT NULL UUID` but lacked the `REFERENCES tenants(id) ON DELETE CASCADE` constraint that every other tenant-scoped table has. (Initial-schema migration declared the FK; a later column-rename or table-recreate appears to have dropped it without restoring it.) Local DB had accumulated 77 orphan employee rows + 8 orphan service rows from past test runs. Migration `20260511000000_employees_services_tenant_fk_cascade.sql`: DELETE orphans whose tenant_id no longer exists → ADD CONSTRAINT FK CASCADE on both. Pre-fix, tenant offboarding silently leaked rows — would have been a GDPR posture issue at beta scale. **Production Supabase still needs this applied.** Plus `tenant-delete-cascade.spec.ts` (3 tests: full cascade across 11 tables, cross-tenant isolation, owner-403 authz gate). Migration count 89 → 90.
- `f43e535` — **test(e2e): soft-delete → restore round-trip on customers.** `version-history-restore.spec.ts` (3 tests) covers the "we accidentally deleted X — restore it" customer-trust scenario. Happy round-trip: create → `/soft-delete` → filtered from `/customers` + appears in `/records/customers/deleted` → `/restore` → back in active list + gone from deleted list. Sad paths: 404 `RECORD_NOT_DELETED` on never-deleted (distinguishes stale UI from gone record); 400 `INVALID_TABLE` on non-whitelisted table name (`foobar`, `tenants`) — pins SQL-injection defense on the inlined table name. Audit found no regressions; feature was already solid end-to-end.
- `4d30eff` + interleaved doc commits — TODO.md marks all 5 closed items with detailed notes; TEST_COVERAGE.md tracks the 14 new workflow rows across 4 new spec files; CLAUDE.md migration count 89 → 90.

**After-state:** backend 1,770 → 1,775; dashboard 617 → 620; agent unchanged at 85; E2E 55 → 69 passing (7 intentional skips). All typecheck clean. Zero failures. **Outstanding for next session:** apply migration `20260511000000` to production Supabase.

---

## 2026-05-09 — Booking-RPC granular errors restored + 12 pre-existing test failures closed

Same-day follow-up to security pass 2. The full-suite run had surfaced 12 pre-existing failures in 4 test files; this session closes them all. Net green: 1,770/1,770 backend tests pass for the first time today.

**Root cause: granular error codes regressed in migration `20260508000001`.** That migration's intended change was the auto-assignment policy rewrite (alphabetical → fewest-skills + least-busy + random) for senior-time preservation. But the rewrite accidentally collapsed the four-code diagnostic block from migration `20260401000001` (NO_SKILLED_EMPLOYEE / EMPLOYEE_NOT_SCHEDULED / TIMESLOT_OCCUPIED / NO_AVAILABILITY) into a single NO_AVAILABILITY return when the candidate JOIN produced no rows. Real impact: the agent prompt branches on these specific codes — without them, callers hear "nothing's open there" when the actual issue is "we don't have a tech with that skill" — misleading and unhelpful.

**Fix: migration `20260509000002_restore_granular_booking_errors.sql`.** Keeps the 2026-05-08 assignment policy intact and re-incorporates the diagnostic block from `20260401000001`, updated to use `employee_schedule` (the `employee_shifts` table the original used was dropped 2026-04-30). After applying, all `scheduling-atomic.test.ts` and `skill-resource-matching-sweep.test.ts` tests that asserted on specific codes pass cleanly.

**Side fixes along the way:**

- **2 tests needed `DELETE FROM resources` after `createTenant`.** `scheduling-atomic.test.ts` "matches employee by skill and shift" and `skill-resource-matching-sweep.test.ts` "salon: books haircut..." both asserted on a specific resource_id/name. The `auto-shop` and `salon` business templates auto-seed resources via DB trigger; the new assignment policy's `random()` tiebreaker (added 2026-05-08) picks any matching resource. Adding the DELETE matches the existing pattern in test 128 ("fails when all resources are booked") and gives deterministic resource selection.
- **3 `crm-appointments.test.ts` tests violated the 15-min CHECK constraint.** They inserted appointments with `NOW() + interval '1 day'` which is rarely on a 15-min boundary. Migration `20260508000000` added `appointments_start_time_15min` / `appointments_end_time_15min` checks. Switched to `date_trunc('hour', NOW() + interval '1 day')` to land on `:00`, which satisfies the constraint.
- **1 booking-concurrency test was `Promise.all` over 20 deadlocking transactions.** Under extreme concurrency, the GiST exclusion-constraint check can deadlock between two transactions; one rolls back with `40P01`. Promise.all rejects fast on first rejection so the test crashed before asserting. Switched to `Promise.allSettled`, kept the at-most-one-winner contract (data integrity preserved), added a defense-in-depth `SELECT COUNT(*)` row-count assertion, and bumped the test timeout to 30s (deadlock detection takes ~1s per pair, cascading deadlocks among 20 callers can exceed 5s). The underlying limitation — that a deadlock-rolled-back loser doesn't see the prettiest error code — is acceptable: data integrity holds, the agent prompt would surface "something went wrong, please try again" which is OK user-facing behavior under that load.

**Files touched:** `supabase/migrations/20260509000002_restore_granular_booking_errors.sql` (new), `src/scheduling-atomic.test.ts`, `src/skill-resource-matching-sweep.test.ts`, `src/crm-appointments.test.ts`, `src/booking-concurrency.test.ts`.

Backend test count: 1,770/1,770 pass (was 1,758 / 1,770 with 12 failing earlier this session).

---

## 2026-05-09 — Security review pass 2: RLS coverage + JWT/refresh + AGENT_SECRET rotation

Three sub-audits, three findings. New `docs/SECURITY.md` documents the as-shipped posture for future audits.

**RLS coverage audit on tables since 2026-03.** Inventoried every CREATE TABLE migration, cross-referenced against the global FORCE-RLS migration `20260323000000_force_rls_single_pool.sql`. Three real gaps:

1. `password_resets` (created `20260422000000`) had **zero RLS** — no `ENABLE`, no policy. Holds short-lived account-recovery tokens; cross-tenant leak material if any future caller joined or read this table from a tenant-context-set connection. Closed by migration `20260509000000_password_resets_rls.sql`: ENABLE + FORCE + a permissive policy that only allows access when `app.current_tenant_id` is empty (the unauthenticated `/forgot-password` and `/reset-password` flows). Authenticated tenant sessions get NO access — defense in depth.
2. `voice_sessions` (created `20260409000000`) had `ENABLE ROW LEVEL SECURITY` + a tenant-isolation policy but lacked FORCE. On Supabase managed Postgres (where we connect as `postgres`, a non-super non-BYPASSRLS role per the 2026-03-23 migration's rationale), policies-without-FORCE may bypass — `voice_sessions` stores call_id + transcript + AI-judged outcome, all cross-tenant leak-worthy.
3. `record_versions` (same migration date) had the same shape gap. Stores soft-delete + version-history rows — leaking these would expose prior values of edited records (e.g. customer's old phone number, appointment's prior status).

Closed by migration `20260509000001_force_rls_voice_sessions_record_versions.sql` applying FORCE to both. Pinned by Probe 6 in `multi-tenant-isolation.test.ts` (4 tests checking `pg_class.relrowsecurity` + `relforcerowsecurity` metadata + the `pg_policies` row for password_resets + a positive-control INSERT/SELECT under empty tenant context). Local test `postgres` is SUPERUSER+BYPASSRLS so behavioral cross-tenant probes under that role are meaningless locally; the metadata probes catch a future migration that drops RLS or FORCE on these tables.

**JWT lifetime + refresh + revocation.** No fixes needed. The current shape is robust: 8h stateless tokens, `/auth/refresh` sliding-window, and the cleverest piece — every authenticated request looks up `users.password_changed_at` and rejects tokens with `iat < password_changed_at` epoch. Password rotation is the revocation mechanism. Documented gaps: no admin "lock account" UI without password change (workaround: SQL `UPDATE users SET password_changed_at = NOW()`), no per-token denylist (acceptable for stateless tokens at this scale).

**AGENT_SECRET timing-safe + rotation.** Pre-fix the auth comparison was plain `provided !== AGENT_SECRET` — short-circuit on first mismatched byte → timing oracle in principle. Switched to `crypto.timingSafeEqual` with a length-mismatch guard so the helper doesn't crash on different-length input. Added `AGENT_SECRET_OLD` for hot rotation: backend accepts either primary or old during the transition window. Rotation procedure: set new + old on backend, redeploy worker with new, drop old. Pinned by 3 new auth tests in `agentTools.test.ts` (length-mismatch no-crash, OLD accepted, OLD doesn't wildcard-accept third values).

**Out of scope this session (deliberate):** ServiceTitan webhook contract test (no real integration today). Admin "lock account" UI surface. Per-worker agent identity (only matters when running multiple agent workers). Investigation of the 12 pre-existing test failures from migration `20260508000001` — same-day discovery during the full-suite run, tracked separately in `docs/TODO.md`.

**Backend tests:** 1,763 → 1,770 from this session's adds (+7). 12 pre-existing failures unrelated to this work tracked separately. Net green: 1,758 backend tests passing.

---

## 2026-05-09 — Security review pass 1: webhook signature verification + CRM HMAC bug fix

Audit + fix in one session. Two findings, both closed.

**Finding 1 — Stripe webhook signature contract had zero tests.** The `/billing/webhook` route correctly used `stripe.webhooks.constructEvent` against the raw body (preserved by the global content-type parser at `src/index.ts:142`), but no test pinned the contract. A refactor that reordered constructEvent before the sig check, removed the rawBody preservation, or replaced constructEvent with `JSON.parse(req.body)` for "convenience" would slip past the suite. New file `src/webhook-signatures.test.ts` adds 3 Stripe contract tests: missing-signature → 400 with no DB activity, invalid-signature → 400 (logged via `stripe_webhook_signature_failed`), valid-signature → 200 with the checkout.session.completed handler running and the tenants UPDATE firing. Tests use `Stripe.webhooks.generateTestHeaderString` so the signature math is real, not stubbed.

**Finding 2 — HubSpot, Square, and Jobber webhooks had broken HMAC verification.** All three routes had `const rawBody = JSON.stringify(req.body)` and passed that into `verifyWebhookSignature`. This is fundamentally broken: providers sign the EXACT bytes they sent, and re-serializing through V8's `JSON.stringify` doesn't byte-match — whitespace, key order, number formatting, escape sequences can all differ. Production-impact today is contained because no real CRM is wired (all four CRM integrations are OAuth-pending env vars), but the bug would have surfaced on the first real webhook. Fixed all three routes to read `req.rawBody` (already preserved globally) with a defensive 400 fallback if rawBody is somehow missing. New tests in `webhook-signatures.test.ts` pin the contract per provider: bad-signature → 401, valid-signature → 200, plus replay-protection on HubSpot's timestamp-freshness window and a no-active-integration → 404 short-circuit on Jobber.

**Test scaffolding side-effect.** The fix required `req.rawBody` to be available in test apps. `buildRouteTestApp` in `src/test-utils-mock.ts` was updated to mirror the production content-type parser. The three existing route tests (`hubspot-routes.test.ts`, `square-routes.test.ts`, `jobber-routes.test.ts`) build their own Fastify instances directly, so they got a copy-paste of the same parser block — small duplication accepted to keep the change minimal.

**Pass 2 of the security review deferred to a future session:** RLS coverage audit on tables added since 2026-03; JWT lifetime + refresh story (revocation strategy); `/agent-tools/*` shared-secret rotation plan.

**Backend tests:** 1,752 → 1,763 (+11 webhook signature tests). Dashboard / agent unchanged.

---

## 2026-05-09 — Booking enforcement chain closed end-to-end (5 sub-slices in one session)

Backend 1,733 → 1,747 (+14). Agent 81 → 85 (+4). Dashboard 617 unchanged. Six TODO entries closed under the `Booking enforcement hardening` section: Slice 1, 1.5, 2, 3, AI prevention prompt-only, AI prevention E2E coverage. Only `pre-flight tool fallback` remains and it's deliberately deferred ("only ship if beta data shows the prompt rule is unreliable").

**Slice 1 — backend conflict-details on overlap.** `src/services/conflictLookup.ts` (helper, dashboard wiring, dashboard tests) was already shipped 2026-05-08; the gap was the agent route. Wired `findOverlappingAppointment` + `isOverlapError` into `/agent-tools/book-appointment` (`src/routes/agentTools.ts`): on `"already booked"`, runs the lookup in the same transaction and returns `{ success: false, error_code: 'TIMESLOT_OCCUPIED', conflict }` at status 200 (agent's conversational shape). Non-overlap errors keep the legacy `{ success: false, error }` plain shape so the existing agent-prompt parsing is undisturbed. Tests: `conflictLookup.test.ts` +7 (four overlap geometries — start, end, contained, containing — plus two flavors — resource-conflict, employee-conflict); `agentTools.test.ts` +2 (overlap → conflict block + TIMESLOT_OCCUPIED contract; non-overlap → plain shape + no third query).

**Slice 1.5 — 15-min increment enforcement.** Migration + validator already shipped 2026-05-08; gap was `INVALID_INCREMENT` not surfaced as `error_code`. Refactored `validateAppointmentTimeRange` to return `{ error, code } | null` with stable `AppointmentValidationCode` union (`INVALID_PARAMS` | `INVALID_RANGE` | `INVALID_DURATION` | `INVALID_INCREMENT`). Threaded through 3 call sites: `POST /appointments/create`, `POST /appointments/:id/update`, `POST /agent-tools/book-appointment`. Tests: `appointmentValidation.test.ts` updated to assert structured shape (+1 unparseable-date INVALID_PARAMS test); `routes/appointments.test.ts` +3 (off-grid start/end on create + off-grid update); `agentTools.test.ts` +2 (off-grid start/end agent route, both pin no-DB-call).

**Slice 2 — dashboard conflict modal + 15-min time picker.** Audit-only — already fully shipped (`ConflictModal.tsx` with bonus next-available alternatives section, both panels using `<input type="datetime-local" step="900">`, 17 component tests passing, `ui-conflict-modal` + `15min-form-rejection` E2E both pass). Spec said "dropdown of options", implementation uses `step="900"` — functionally equivalent (browser snap + `reportValidity()`), captured the divergence in TODO.md.

**Slice 3 — E2E with self-contained data lifecycle.** New `dashboard/e2e/helpers/fixtures.ts` exports `registerFreshTenant()` (POST `/register` → unique tenant + admin token), `seedBookingScenario()` (creates N employees + M resources + 1 customer + shifts on requested dates), `seedAppointment()` (direct INSERT for "blocker" rows), `bookAppointmentAs()` / `updateAppointmentAs()` (API conveniences), `cleanTenantData()` (single-statement DELETE that cascades). Refactored `booking-enforcement.spec.ts` tests 1-4 + 7 (out-of-hours, employee/resource double-book, partial-overlap, edit-overlap) to drop Page entirely and drop the DynaTire seed dependency: each test registers its own tenant, asserts via `request` context, cleans up via tenant cascade. UI tests 5-6 keep their existing pattern (need real dashboard navigation). Speedup: API tests went from ~4.8s each (Page-mediated) to ~100-460ms each. Three consecutive full runs (12.9s / 12.2s / 12.2s) — the prior auth-bleed flake on `15min-form-rejection` is gone since the surrounding API tests no longer touch Page state.

**AI prevention — prompt-only enforcement + E2E coverage.** Tightened `agent/src/prompt.ts` "Availability discipline" section: replaced the soft "the booking tools enforce this server-side" framing (which gave the LLM license to skip the check) with a "this is a hard rule, not a guideline" framing + an explicit "Don't rely on the backend to catch you — by the time it rejects, the caller has already heard you propose a time you can't deliver" warning. Added 15-min grid rule for spoken proposals (":00, :15, :30, :45 — never :07, :23, :40") so the agent doesn't propose an off-grid time the booking call will then reject with INVALID_INCREMENT. New "When the caller can't be accommodated" section directs the agent to STOP guessing and take a message (capturing name + reason, no fake callback windows promised) once alternatives are exhausted. `check_availability` now mentioned alongside `get_available_slots` / `get_scheduling_options` as a third gate entry-point. Pinned with 4 new CONVERSATION-SHAPE prompt-content tests in `agent/src/prompt.test.ts` covering scenarios (a) hard-rule check-before-book, (b) TIMESLOT_OCCUPIED → propose alternative, (c) 15-min grid in spoken times, (d) take-a-message escalation. LLM-in-the-loop conversation harness deliberately deferred — non-deterministic, costs OpenAI tokens per run, and `scripts/qa-live-test.py` is the proper place for end-to-end conversational validation once Telnyx unblocks.

**Files touched:** `src/services/appointmentValidation.ts` (+ test), `src/services/conflictLookup.test.ts`, `src/routes/appointments.ts` (+ test), `src/routes/agentTools.ts`, `src/agentTools.test.ts`, `agent/src/prompt.ts` (+ test), `dashboard/e2e/helpers/fixtures.ts` (new), `dashboard/e2e/booking-enforcement.spec.ts` (refactored), `docs/TODO.md`, `docs/TEST_COVERAGE.md`, `docs/CURRENT_STATUS.md`, `CLAUDE.md`, `RESOLVED.md`.

---

## 2026-05-08 — Quick-book e2e deflake (date reach + local-time bug)

Surface area: `dashboard/e2e/workflows.spec.ts` quick-book test only. No production code touched.

Two compounding bugs were causing the test to fail intermittently — and consistently in the full-suite run vs. passing in isolation, which is the classic shape of a hidden race-or-state issue. Both turned out to be deterministic once unpacked:

1. **Date reach.** Test booked +35 days out, but `refresh-seed-data.sql` (applied this morning) only extends `employee_schedule` ~12 days forward. Beyond that there are zero shifts → booking RPC rejects with `EMPLOYEE_NOT_SCHEDULED` → no row inserted → `expect(rowCount).toBeGreaterThanOrEqual(1)` fails. The test's prior "+35 days" was tolerant of an older, longer seed window; the seed-refresh tightened it.
2. **Local-vs-UTC datetime-local.** `setHours(9, 15)` sets local hours; `toISOString()` returns UTC; `<input type="datetime-local">` then interprets the string we fill as LOCAL again. On a CDT machine, hour 13 → "T18:00" → form picker reads 18:00 LOCAL → outside Mike's 07-16 shift, outside Carlos's 08-17, exactly at Dana's 18 boundary. Consequence: the random hour 9-13 choice silently became 14-18 LOCAL and only the bottom of that range was bookable. Failure rate scaled with whichever employee the booking RPC's auto-assign happened to pick.

**Fix.** Walk +3 days, skip Sat/Sun to land on a covered weekday. Build the datetime-local string from local Y/M/D + HH:mm components directly (no `toISOString()` round-trip). Range tightened to 10-14 LOCAL so even the ends of the random distribution sit comfortably inside every seed employee's shift window.

**Doc fix bundled in same commit.** `docs/TEST_COVERAGE.md` previously claimed "58 passed, 1 skipped" — that count came from a `SYNC_TEST_RECORDER=1` run during validation, but the standard developer run is 52 passed + 7 skipped (the 6 calendar-sync tests skip-guard themselves when the env var is unset, plus 1 historic skip in full-functional-audit). Now stated accurately with both counts (default + recorder-enabled) called out. Quick-book passing again brings the default-env run back to 52 / 7 / 0.

---

## 2026-05-08 — Observability slice 2: in-process Prometheus metrics + scrape endpoint

Backend 1,719 → 1,733 (+14 metrics-registry unit tests). Dashboard / agent / Playwright unchanged. The "Basic metrics" item in `docs/TODO.md` Observability section is now `[x]`.

- **`src/services/metrics.ts` — in-process registry, no external deps.** Standard counter + histogram shapes, Prometheus text-format exposition. Hard-coded label cardinality cap (1000 series per metric, overflow funnels to `overflow="true"`) so a misbehaving caller emitting per-phone-number labels can't pin process memory. Singleton registry exported as `registry`. Six pre-declared metrics live in the same file so the taxonomy is discoverable in code review:
  - `http_requests_total{route,method,status}` — partitioned by route PATTERN (e.g. `/appointments/:id`), not rendered URL, to keep cardinality bounded.
  - `http_request_duration_ms` — histogram with the same labels. Buckets `[10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]` cover the realistic range for this service (most routes <100ms, booking RPC sometimes 500ms p99, anything >2s should alert).
  - `booking_attempts_total{outcome, source}` — outcome ∈ `success | timeslot_occupied | employee_not_scheduled | no_skilled_employee | no_availability | validation_error | past_time | other_error`; source ∈ `api | agent`. Powers booking success-rate dashboards.
  - `tool_calls_total{tool, outcome}` — outcome ∈ `success | error | validation_error`. tool name is the `/agent-tools/<name>` suffix (10 tools today; bounded cardinality).
  - `sync_dispatches_total{provider, entity, action}` — 5 providers × 2 entities × 3 actions = 30 series max. Lets us verify in prod that the orchestrator is firing the way `calendar-sync.spec.ts` proves it does in dev.
  - `errors_total{event}` — sibling counter inside `logError()`. Pair with `rate(errors_total[5m])` alerts in Grafana for higher-signal alerting than scraping log lines.
- **Auto HTTP metrics via Fastify onResponse hook (`src/index.ts`).** Status code is rolled up to family (`2xx`/`4xx`/`5xx`) to keep cardinality sane. Skips `/health` (constant traffic, no signal) and `/metrics` (avoids recursive scrape). Uses `req.routerPath` (not `req.url`) so `/appointments/abc-123` and `/appointments/def-456` collapse into the same `/appointments/:id` series. `reply.elapsedTime` (Fastify built-in) feeds the histogram.
- **Domain counters wired at the call sites that matter.** Booking outcomes in `/appointments/create` (4 paths: validation, success, conflict-409, other-error) and the agent's `/agent-tools/book-appointment` + `/agent-tools/book-with-scheduling`. Tool-call outcomes via the existing `toolRoute()` wrapper — `ok()`/`fail()` set a `_toolOutcome` marker on the reply, the wrapper reads it after the handler returns and bumps the counter. Sync dispatches alongside the recorder hook (single dispatch loop, both call sites), error counter in `logError()`.
- **`GET /metrics` scrape endpoint, gated by `METRICS_TOKEN`.** Strict opt-in: returns 404 when the env var is unset (so a fresh deploy can't leak tenant counters publicly), 401 on missing or wrong Bearer header, 200 with `text/plain; version=0.0.4` body when correct. Added `/metrics` to `PUBLIC_ROUTES` in `middleware.ts` so the JWT auth hook doesn't try to validate the bearer as a JWT before the route handler runs. Verified live with curl against a backend started with `METRICS_TOKEN=...`: counters populate per-request, no public exposure when env var is removed.
- **`src/metrics.test.ts` — 14 unit tests.** Counter inc with no labels / multiple label combos / sort-stable label keys, by=N step argument, cardinality cap behavior. Histogram cumulative bucket placement, sum + count accumulation, separate-series by labels, ascending-bucket validation. Registry double-registration semantics (same type returns same instance, different type throws), exposition format (HELP / TYPE / +Inf / _sum / _count), label-value escaping (quotes / backslashes / newlines per Prometheus spec).
- **Doc deltas.** `CLAUDE.md` documents the metrics taxonomy + `METRICS_TOKEN` env var; bumps backend tests 1,719 → 1,733 (Phase 13 line). `docs/TEST_COVERAGE.md` headline refreshed; counts bumped. `docs/TODO.md` marks "Basic metrics" `[x]` with a one-paragraph wrap-up.

---

## 2026-05-08 — Calendar + CRM sync E2E (last beta-blocker P1 closed)

Backend 1,712 → 1,719 (+7 recorder semantics). Dashboard 617 unchanged (recorder logic lives backend-side). Playwright 52 → 58. Last unchecked P1 in `docs/TODO.md` Test Suite Gap Analysis is now `[x]`.

- **Sync-test recorder hook in `syncOrchestrator.ts`.** Test-only in-memory ring buffer (cap 500) gated by `SYNC_TEST_RECORDER=1`. Strict opt-in — `"true"`, `"yes"`, `"on"`, empty string all stay disabled. `record()` is a no-op outside test mode so prod paths are untouched. `record()` runs synchronously inside the dispatch loop BEFORE the provider promise fires, so the recorder reflects intent-to-dispatch even when a provider's `.catch()` is still pending.
- **`/agent-tools/_test/sync-events` route.** GET reads the buffer, DELETE clears it. Both gated by both the env var (404 when off) AND the existing agent-secret hook. The recorder + endpoint live alongside the 10 production agent tools but are clearly namespaced under `/_test/` so a code review can spot test infrastructure at a glance.
- **`dashboard/e2e/calendar-sync.spec.ts` — 6 tests.** API-only design (uses Playwright's `APIRequestContext`, no page navigation), so it sidesteps any dashboard SSR/hydration flake. Logs in as `admin@dynatire.com` (DynaTire tenant admin) rather than `admin@secretaryhq.com` (super-admin) — `DELETE /appointments/:id` and `PUT /customers/:id` read tenant_id from JWT only, no super-admin override path, so logging in as platform admin would 404 against rows in the DynaTire tenant. Asserts: each appointment lifecycle event (create/update/delete) dispatches all 5 providers with the right action label; each customer event dispatches the 4 CRMs (no calendar — by contract); fire-and-forget HTTP returns in <3s with 5 sync promises in flight. Each test creates its own customer + employee_schedule + appointment in `try`, cleans up in `finally` per the test-isolation feedback memory; clears the recorder buffer in `beforeEach` so cross-test contamination is structurally impossible.
- **`src/sync-orchestrator.test.ts` — 7 unit tests.** Pin recorder semantics in isolation: enabled mode appends 5 appointment / 4 customer events with the right shape, disabled mode (env unset OR any value other than literal `"1"`) records nothing, `clearSyncRecorder()` empties the buffer, ring-buffer caps at 500 events dropping oldest, append-order is preserved across multiple calls. Co-exists with the prior `src/services/syncOrchestrator.test.ts` (file-grep regression tests) — different files, different mechanisms; both pass.
- **Two test-fixture bugs surfaced + fixed during validation.**
  - DELETE requests with `Content-Type: application/json` and no body trip Fastify's parser (`Invalid JSON` → 500). Removed the header on the body-less DELETEs (appointment-delete, customer-delete, recorder clear).
  - DynaTire's tenant timezone is `America/Chicago`, so the booking RPC translates UTC `start_time` to local before checking shift coverage. Initial fire-and-forget test used `11:00 UTC` (`06:00 CDT`, before Mike's 09:00 shift) → `EMPLOYEE_NOT_SCHEDULED` 400. Moved to `17:00 UTC` (`12:00 CDT`, mid-shift). Comment in the spec calls out the timezone math so a future refactor doesn't drift back.
- **Doc deltas.** `CLAUDE.md` documents the `SYNC_TEST_RECORDER` flag + the namespaced test endpoints, bumps backend tests 1,712 → 1,719 + Playwright 52 → 58. `docs/TEST_COVERAGE.md` headline refreshed; "Calendar sync" + "CRM sync" struck through with a note that orchestration layer is now covered (outbound HTTP shape still only at unit level). `docs/TODO.md` marks Calendar sync E2E as `[x]` — last unchecked P1 in that section.

---

## 2026-05-08 — 7 prod migrations applied (3 silently overdue) + customer-create as a separate transaction

Backend 1,659 → 1,666 (+7: customerLookup helper +4, agentTools persistence regressions +3). Dashboard + agent untouched.

- **Applied 7 pending migrations to production Supabase.** Initial intent: apply `20260505000000_user_roles.sql` only, after the audit found the new Logins UI's `users.role` column was missing in prod and would 500 the route. Pre-flight read-only check confirmed the column genuinely didn't exist on `public.users` (an `auth.users.role` returned by an earlier broader query was Supabase's own auth schema, not ours). Manual `psql` + `INSERT INTO schema_migrations` to avoid the bulk `setup-db.sh` path picking up other pending work. Then drafted `scripts/preflight-booking-overlap.sql` for the GiST exclusion-constraint pair (`appointments_no_resource_overlap` + `appointments_no_employee_overlap`); pre-flight returned 0 conflicting pairs against the half-open `tstzrange(start_time, end_time, '[)')` predicate. Ran `setup-db.sh` to apply `20260501000000` + `20260501000001` + `20260507000000` (mapping-aware skill check + `appointments.service_id` column). **Surprise:** the run also applied `20260430000000` + `20260430000001` + `20260430000002` — three migrations the docs had claimed prod-applied 8 days prior. They had not been: prod was running `check_coverage_gaps()` and `check_availability_with_tz()` RPCs that still referenced the dropped `shift_overrides` table name, and the `employee_shifts` legacy weekly-pattern table was still alive. No traffic was hitting them so the breakage went unnoticed; lucky catch before first live call. All 7 applied cleanly via `--single-transaction` with `ON_ERROR_STOP=1`.
- **Test-data audit (`scripts/audit-test-data.sql`).** Kept as a re-runnable artifact with the pre-flight scan. 8-section sweep (time integrity, tenant-FK boundary, FK reference integrity, status hygiene, business-hours alignment via `employee_schedule`, resource/employee/customer overlap, schedule sanity, per-tenant inventory). Findings on prod data: 3 stale `scheduled` appointments 35-37 days past, 1 appointment violating shift-coverage (Mike Rivera 2026-04-02 14:00 CT with no covering shift in his week), 2 unassigned 2026-03-31 appointments where DynaTire had zero employee shifts that day, "Wrong Tenant" customer leftover from a prior multi-tenant probe in the super-admin tenant, and Bella's Hair Studio empty-stub tenant. None block the migrations (the new constraints are forward-only) but tracked as a discrete cleanup task in `docs/TODO.md` under Pre-launch validation.
- **Customer-create as a separate transaction.** Surfaced 2026-05-08 by walking the booking flow: `/agent-tools/book-with-scheduling` did customer get-or-create INSIDE `book_with_scheduling_atomic`'s plpgsql function, so the row's persistence on RPC failure was a side-effect of `RETURN QUERY ... RETURN` semantics + connection-level auto-commit. A future refactor wrapping `withTenantClient` in explicit `BEGIN/COMMIT` (audit logging, savepoints, etc.) would silently start rolling back the customer on every booking failure, forcing the agent to re-collect identity on every retry. Fix: extracted `src/services/customerLookup.ts` with `getOrCreateCustomerByPhone(withTenantClient, tenantId, phone, name)`. Each call acquires its own pool client → runs auto-committed statements → releases, so the customer write is structurally a separate transaction regardless of how the caller is wrapped. Both `/agent-tools/book-appointment` and `/agent-tools/book-with-scheduling` now call the helper before the booking RPC, in two distinct `withTenantClient` blocks. RPC bodies and signatures untouched — they still support inline-create for any future direct caller, but our actual callers now drive the persistence decision at the Node layer where the transactional intent is visible.
- **Tests.** 4 helper unit tests in `customerLookup.test.ts` (HAPPY existing-row short-circuits INSERT, HAPPY no-match → INSERT, SAD soft-deleted row doesn't block fresh INSERT, WIRING tenant_id forwarded to withTenantClient for RLS scope). 3 persistence regressions in `agentTools.test.ts` (book-appointment + book-with-scheduling: customer SELECT/INSERT runs BEFORE the RPC even when RPC returns failure; existing-customer reuse with only SELECT + RPC). 3 pre-existing book-with-scheduling tests updated with the new fixture shape (helper SELECT response prepended). All 5W-annotated.
- **Doc deltas.** `CLAUDE.md` test count refreshed 1,659 → 1,666. `docs/TEST_COVERAGE.md` refreshed (counts + headline date). `docs/TODO.md` marks the prod-apply items done and adds a new "Refresh DynaTire test/seed data" task with the 5 specific findings from the audit. `docs/CURRENT_STATUS.md` removes the resolved atomic-booking row from the in-flight table.

---

## May 7, 2026 — Audit punch list + coverage consistency + Jest cleanup + observability + booking alignment (UI + RPC) + cross-view appointment actions

Backend 1,637 → 1,659 across the day (+9 coverage-consistency, +7 logger, +6 booking-mapping). Dashboard 516 → 575 (+3 Quick Book trigger, +12 Mark off today, +11 CustomerCombobox, +9 empty-cell click, +5 date-nav chips, +1 cell-gate per-employee, +13 booking-alignment filter, +5 popover Edit/Cancel). Agent 72 → 78 (+6 logger). Plus a Fastify-5 boot-time logger fix (`loggerInstance` not `logger`) that production startup needed. Audit punch list 100% complete + booking enforces "everything aligns" at BOTH the UI level AND the RPC level + appointment Edit/Cancel now work from any view via the popover. Thirteen pieces total:

- **Front-desk click-count audit** (formerly `docs/sessions/2026-05-07-front-desk-audit.md`, since removed; summary retained here). Read-only walk through the four daily-use tasks for the `front_desk` role shipped 2026-05-05. Found that 3 of 4 daily tasks fail the docs/TODO.md "≤3 decisions" threshold: book a call-in (8+ decisions on the default Calendar path), look up tomorrow (3, borderline), mark someone unavailable (∞ — front_desk role literally cannot do it; `Staff & Shifts` is owner-only), find a customer (2 ✓). Top finding: the dashboard has two parallel scheduler implementations on the Schedule tab (`AppointmentView` calendar default, `NewSchedulerView` staff sub-tab) and Quick Book — the only sane create flow — appears only on Resources/List sub-tabs. Six-item priority punch list in the audit doc; items 1-3 are P0 launch-blockers.
- **Coverage gap detection backend↔UI consistency (`src/coverage-ui-consistency.test.ts`, 9 tests).** Closes the docs/TODO.md "Pre-launch validation" entry. Surfaced a real bug while writing the test: pre-fix, both `StepReview.tsx` and `SoloStepReview.tsx` derived the wizard review badge from `coverage_pct`, and the RPC returns `coverage_pct = 100.0` for the divide-by-zero case (`WHEN sc.open_count > 0 THEN ... ELSE 100.0`). Net effect: a tenant with no employees scheduled saw a green "Full Coverage / You're ready to go!" banner — the worst possible UX on the highest-stakes onboarding step. Fix: extracted `dashboard/lib/coverage.ts` with `statusToBadge(status)` + `isAllCovered(rows)`. Both wizard review components now derive from the backend's 5-state `status` field (mapped to 3 dashboard badges). Edge cases pinned: employee on leave (all `is_off=true`), shift starting before typical business hours (04:00-08:00), day with zero scheduled employees (Sat/Sun in a Mon-Fri shop), service with no qualified employees but other staff on shift, zero-staff tenant.
- **Quick Book hoisted to the Schedule tab toolbar (audit P0 #1).** Pre-fix, the Quick Book button only existed on Resources/List sub-tabs. Front-desk operators landing on the default Calendar view had to switch sub-tabs first, costing two clicks before the form. Fix: consolidated `SchedulerView.tsx`'s three returns into one — Quick Book button now visible in Calendar's toolbar (next to view tabs), Resources/List's toolbar (existing location), and the Staff sub-tab via a new optional `onQuickBook` prop on `NewSchedulerView`. Side benefit: `QuickBookPanel`, `EmployeeDayFocusPanel`, and `AppointmentPopover` now render at the outer level so they're reachable from every sub-tab (previously dead on Calendar + Staff). 3 new regression tests pin the trigger contract. Decision-count for "book a call-in" on the default landing: 8+ → 5.
- **Mark off today action on `StaffProfileCard` (audit P0 #2).** Closes the audit's biggest functional gap: the `front_desk` role literally could not mark someone unavailable without leaving Schedule (the off-day affordance lived only in `Staff & Shifts`, which is owner-only). Fix: optional `onMarkOff` / `markOffLabel` / `isMarkingOff` props on `StaffProfileCard` render a "Mark off today" button below Skills when (a) the parent wires the callback and (b) the employee has a shift on the viewed date. Parent (`NewSchedulerView`) owns the API call, confirm dialog (via existing `useConfirm` + `ConfirmModal`), success/error toast, and scheduler refresh — the card stays presentational. Label adapts: "Mark off today" when viewing today, "Mark off Mon, May 11" otherwise, so the button doesn't lie when the operator is on a different date. Disabled while in-flight to prevent duplicate writes on slow networks. 6 new card unit tests in `dashboard/components/scheduler/StaffProfileCard.test.tsx` pin the contract (button hidden by default, hidden when no shift, label override, click invokes parent, disabled+progress copy while in-flight). 6 new integration tests in `NewSchedulerView.test.tsx` pin the wiring (button visible/hidden based on shift data, confirm copy names employee+day, payload shape matches `Api.shifts.schedule.save({ employee_id, shift_date, is_off: true })`, success path toasts+refreshes+closes the card, save failure surfaces error toast and leaves modal open for retry, Cancel exits cleanly with no API call). Decision-count for "mark someone unavailable" as `front_desk`: ∞ → 3.
- **Searchable customer combobox (audit P0 #3).** `AppointmentDetailPanel` previously rendered every tenant customer in a single 50+-item native `<select>` — Hick's Law violation that the audit cited as the worst affordance on the create-appointment surface. Pre-fix, the only search UI lived inline in `QuickBookPanel.tsx:164-188` (search input filtering a `<select>`); the two surfaces shared the pattern in spirit but not in code. Fix: extracted `dashboard/components/ui/CustomerCombobox.tsx` — search input + filtered native `<select>` with consistent label format (`Name (formatted-phone)`), name + phone-substring filtering, prompt option, optional disabled state, and parent-owned value/onChange. Both `QuickBookPanel` and `AppointmentDetailPanel` now consume it. AppointmentDetailPanel's address pre-fill side effect (look up `findCustomerById` and populate location) is preserved — the parent still owns the side effect, the combobox just delivers the new id. Edge cases handled at the combobox level: customer with no phone (omits parens, no `(undefined)` leak), customer with no name (`(no name)` fallback so the row stays selectable), zero-match search (prompt option remains so the control isn't visibly broken). 11 new unit tests in `CustomerCombobox.test.tsx` (default copy, name filter case-insensitive, phone-substring filter, onChange contract, prompt-clear path, disabled, override copy, formatPhone in labels, no-phone fallback, no-name fallback, zero-match prompt-only). The two surfaces now drift as a compile error if the combobox API changes — replacing two inline implementations with one shared one was the audit's explicit recommendation.
- **Empty-cell click → Quick Book prefilled (audit P1 #4).** Two surfaces shipped together. (1) Staff sub-tab (`NewSchedulerView`) — every empty hour cell on a staff row that the row's employee actually has a shift for is a click target with full keyboard support: `role=button`, `aria-label="Book {employee} at {hour}"`, `tabIndex=0`, cursor pointer + hover tint. Click / Enter / Space delivers `{ employeeId, hour, date }` to `onQuickBook`. Skills mode keeps cells passive. **Out-of-shift cells (whether outside the building's open window OR inside the open window but outside this specific employee's shift) stay passive — no role, no click, no hover.** Original P1 #4 left them clickable with the rationale "operators may book early/late," but that path landed `EMPLOYEE_NOT_SCHEDULED` immediately on submit, so the click was an invitation to a guaranteed-failure state. The system's design contract is "book only when employee+skill+resource+time align"; the UI must enforce the time half before the operator types in a customer name. Off-schedule one-offs require adding an `employee_schedule` entry first (Back Office → Shifts), then booking. (2) Calendar sub-tab (`AppointmentView`) — added optional `onSelectSlot?: (range: { start, end }) => void` prop. When wired, BigCalendar runs `selectable=true` and slot click/drag fires the callback; when omitted, the calendar stays read-only on slots. Parent (`SchedulerView`) wires both: `handleNewQuickBook` widened from no-args to accept an optional prefill, merging `selectedDate` so cell-supplied date wins for cross-day clicks. The toolbar Quick Book button still calls `handleNewQuickBook()` no-args. 10 tests in `NewSchedulerView.test.tsx` pin the contract: click delivers `{employeeId, hour, date}`; slot is passive when prop omitted; role/aria-label/tabIndex appear when prop wired AND the row's employee is on shift at that hour; Enter and Space activate; non-activation keys ignored; skills mode passive; **per-employee gate** (Carlos's 9am clickable, Mike's 6am NOT clickable even though both are on the same shop's grid); toolbar button passes no args.
- **Removed unused Jest from devDependencies (`7658fc5`).** Audit confirmed the entire test stack is Vitest 4.0.18 across all three workspaces; zero Jest API calls anywhere in `src/` / `dashboard/` / `agent/`; zero imports from `jest` or `@jest/*`. Yet root `package.json` declared `"jest": "^30.2.0"` and `"@types/jest": "^30.0.0"` — pure dead weight. Dropped both, refreshed `package-lock.json` (shrank 4,384 lines — jest dragged in 100+ transitive deps including babel runtimes, jest-runtime, alternate jsdom). Kept `@testing-library/jest-dom` (matcher library that works natively with Vitest via `dashboard/tsconfig.json`'s `"types": ["vitest/globals", "@testing-library/jest-dom/vitest"]`). Verified post-install: backend 1,646 + dashboard 551 + agent typecheck all clean.
- **Default Schedule sub-tab flipped to Staff (audit P1 #5).** `SchedulerView.tsx:37` `useState<SchedulerViewTab>('calendar')` → `'staff'`. The Staff sub-tab is the daily-use surface for front-desk operators (rows = staff, hours across, today highlighted, empty cells now click through to Quick Book per P1 #4); making it the landing eliminates the "switch sub-tabs first" friction that the audit flagged on the most-frequent task. Calendar branch's narrative subtitle reworked from "Start with the calendar. Switch to staff or resources only when you need detail" (which positioned itself as the recommended default and contradicted the flip) to neutral descriptive copy: "Month, week, or day view. Click a slot to book." No tests assumed Calendar-as-default; the existing e2e spec was already forward-compatible. Open-question from prior session ("design call on whether to flip given the inconsistent narrative copy") closed by reworking the copy in the same change.
- **Yesterday | Today | Tomorrow date chips (audit P2 #6).** `SchedulerDateNav` now renders three peer chips replacing the single Today button. Each meets WCAG 2.5.5 with `min-w-[48px] min-h-[48px]` (audit specified 48×48 for mobile reliability — tire shop / salon owners check schedules on their phones between customers per the audit theme). `aria-pressed` reflects which chip matches `selectedDate` so screen readers see the toggle state the visual primary-variant cue communicates to sighted users. Outside the today±1 window all three chips show un-pressed state — keeping the chips' job as "click to jump" affordances rather than a date-display widget. ChevronLeft/Right preserved for further-out dates. 5 new tests pin Yesterday/Tomorrow click behavior, aria-pressed truthing under varied selected dates, the touch-target minimums, and the outside-window un-pressed contract.
- **E2E coverage for the booking-alignment work.** Closed the gap that the user explicitly flagged: "does the E2E suite verify booking with people resources + skills + availability + time alignment?" Honest answer was no — the existing `quick-book-shift-overrides.spec.ts` only happy-pathed shift coverage; `workflows.spec.ts` quick-book test commented "booking can fail validly (no employee skilled+scheduled)" and treated alignment failures as acceptable. New `dashboard/e2e/booking-alignment.spec.ts` (4 tests, 5W-annotated, all passing against live servers in ~25s): (1) **UI alignment filter** — picks Balancing service in QuickBook → asserts Carlos and Dana drop OUT of the Tech dropdown (only mapped to Mike per seed), Mike + Unassigned remain. (2) **RPC enforcement** — POSTs to `/appointments/create` directly with Balancing + Carlos (unmapped pair), asserts 400 + "not assigned to perform" + zero rows inserted. (3) **Cross-view popover Cancel** — pre-INSERTs an appointment for today with a 13:23 offset, navigates to the List sub-tab (NOT Calendar), clicks the row by `data-testid="list-item-${id}"`, clicks the new popover Cancel button, accepts the native confirm, asserts DB row is `status='canceled'` AND row still exists (soft cancel, not hard delete). (4) **Cancel frees the slot** — books appointment A, cancels via API, books appointment B at the same resource+time → asserts both end up in DB (A canceled, B scheduled) proving the slot opens up after cancel. Each test cleans up in a try/finally with explicit DELETE. Total Playwright suite: 28 → 32 passing.

- **Cross-view Edit + Cancel for appointments (+ soft-cancel switch).** Closes a real architectural gap surfaced by the user during browser verification: pre-fix, the `<AppointmentDetailPanel>` (with Edit + Cancel buttons) was rendered ONLY inside `<AppointmentView />` (the Calendar sub-tab). On Resources / List / Staff sub-tabs, clicking an appointment opened only an `<AppointmentPopover>` — read-only, no way to edit or remove. The operator had to navigate to Calendar and click the appointment again to access either action. Plus the existing "Cancel Appointment" button on AppointmentDetailPanel was wired to the hard-DELETE endpoint (`DELETE /appointments/:id`) despite saying "Cancel" — a stale-list re-click after delete returned 404 ("Appointment not found"), which the user reported as the symptom that drove this slice. **Two fixes shipped together:** (1) `AppointmentPopover` gains optional `onEdit` and `onCancel` props with `appointment-popover-edit` / `-cancel` testids. Both buttons hide when the appointment is already canceled. `SchedulerView` wires them: `onEdit` switches to the Calendar sub-tab and passes `pendingEditAppointmentId` to `<AppointmentView />` so it pre-selects the appointment + enters edit mode on next render (new `initialEditAppointmentId` + `onInitialEditConsumed` prop pair). `onCancel` calls `Api.appointments.cancel(id, tenantId)` (soft endpoint) with a confirm dialog, refreshes both the scheduler data and the static data, shows a success/error toast. (2) `AppointmentView.handleDelete` (the existing "Cancel Appointment" button on the detail panel) switched from `Api.appointments.delete` to `Api.appointments.cancel`. Soft-cancel keeps the row in the DB with `status='canceled'` so a stale-list re-click can't 404, the audit trail is preserved, and the row can still be referenced by reports / call summaries. The backend's `POST /appointments/:id/cancel` route also drops the slot from synced calendars + CRMs (matches what an operator expects from "cancel"). 5 new tests in `dashboard/components/scheduler/AppointmentPopover.test.tsx` (popover renders neither button when callbacks omitted; Edit invokes with id; Cancel invokes with id; both hide when status='canceled'; Edit-only wiring renders alone). The existing `appointment.test.tsx` mock-mode guard test rewritten to pin BOTH (a) usingMockData still short-circuits and (b) the request shape that would have gone out is the new POST `/cancel` not the old DELETE — so a future regression that reverts to hard delete or re-orders the guards surfaces here.

- **Booking alignment slice 2: backend enforcement of skill+resource mapping.** Closes the determined-caller gap that slice 1 (UI filtering) couldn't reach: a curl/Postman call hitting `/appointments/create` directly could still post an incompatible booking because `book_appointment_atomic` was checking the `services.required_skills` text array against `employees.skills`, and seed data populates the `service_employee` mapping table but not the skills arrays — so the array check passed everything. Migration `20260507000000_appointments_service_id_mapping_check.sql`: (1) `appointments` gains nullable `service_id UUID FK` with `ON DELETE SET NULL` so deleting a service doesn't cascade-delete history; index on `service_id WHERE NOT NULL`. (2) `book_appointment_atomic` updated so when `p_service_id` is provided, it prefers `service_employee` mapping (when populated for that service) as the authoritative skill check, falling back to the `required_skills` array only when the mapping is empty — same precedence for `service_resource`. Mapping miss → "Employee/Resource is not assigned to perform this service". (3) Schema: `AppointmentCreateSchema.service_id` (optional UUID); `/appointments/create` route threads it to the RPC. (4) Dashboard: `QuickBookPanel` passes `service_id: serviceId || null`; `AppointmentView.handleCreateAppointment` derives it from `services.find(s => s.name === form.description)?.id`. Backward-compat: callers that omit `service_id` get unchanged behavior — every existing test passes. 6 new tests in `src/book-appointment-mapping.test.ts` (real DB + transaction-rollback): HAPPY mapped employee booking + service_id persisted on the row, SAD employee not in mapping → rejected with no row inserted, OPEN-SERVICE no rows = booking accepted, LEGACY-FALLBACK array check fires when mapping empty + skills set, NO-SERVICE-ID legacy callers unchanged, SAD resource not in mapping. Backend 1,653 → 1,659.

- **Booking alignment: dashboard dropdowns now filter to valid combinations.** Closes a real operational gap: the dashboard previously let an operator pick (employee + service + resource + time) combinations the booking RPC would reject — picking Mike + Tire Mount when Mike isn't tire-mount-trained, or Bay 3 for a service that requires Bay 1/2. The system's design contract was "book only when employee+skill+resource+time align," but only the agent's `get_available_time_slots` and the RPC's specific error codes (NO_SKILLED_EMPLOYEE, NO_AVAILABILITY) enforced it; the dashboard let the operator try and surfaced the error as a post-submit toast. Fix: new `dashboard/lib/availability.ts` exporting `buildMappingMaps(seRows, srRows)` + `filterEmployeesByService(employees, serviceId, map)` + `filterResourcesByService(resources, serviceId, map)`. New `useServiceMappings(tenantId)` hook in `dashboard/lib/hooks.ts` loads `Api.mappings.listServiceEmployee` + `listServiceResource` and exposes `O(1)` lookup Sets keyed by service_id. Both `QuickBookPanel` and `AppointmentDetailPanel` consume it and apply the filters: the Tech and Bay dropdowns narrow when a service is picked, and a stale selection that's no longer in the dropdown auto-clears. When a service has zero qualified options (orphaned mapping or service-with-no-staff-assignments), an inline `role=status` block shows "No Tech is configured to perform this service. Assign one in Back Office → Service Assignments first." and the Book/Save button disables. Open services (no `service_employee` rows) keep all options selectable, mirroring the booking RPC's "empty required-skills array = no constraint" branch — onboarding flow that introduces services before mapping them stays unblocked. 13 new tests: 8 in `availability.test.ts` (helper purity: nullable inputs, missing-key fall-open, empty-Set fall-open, defensive row guards) + 5 in `QuickBookPanel.test.tsx` (no-service all-visible, mapped-service narrows, open-service all-still-visible, blocking-message + disabled-button, reactive un-narrow when service cleared). `scheduler.test.tsx` got a one-time top-level mock for `Api.mappings.listServiceEmployee` / `listServiceResource` + `useActiveTenantId` so the legacy QuickBookPanel test cases pass under the hook's new mount-time fetch. **Out of scope for this slice (backend enforcement)**: the dashboard's `/appointments/create` calls `book_appointment_atomic`, which doesn't enforce skill matching — appointments table doesn't store `service_id`. Adding backend enforcement is a separate slice involving an appointments-table schema change. UI filtering is the practical guard: the operator can't easily pick incompatibly, but a determined caller hitting the API directly could still bypass it.

- **Observability slice 1: structured-log aggregation (backend + agent).** Picked Better Stack (Logtail's successor; free tier 1 GB / 3 days, sufficient for current ai-sec scale). Backend gained `src/services/logger.ts` — a Pino factory that writes JSON to stdout always and, when `BETTER_STACK_TOKEN` is set, additionally forwards via `@logtail/pino` worker-thread transport. Agent gained `agent/src/logger.ts` mirroring the same shape with a singleton cache. Both services tag every line with `service` + `env`. Backend's `tenantMiddleware` already enriched the request logger with `tenant_id`; agent's `index.ts` now builds a per-call child logger with `tenant_id` + `call_id` + `caller_phone` + `room` after `sessionCtx` resolves, so a single Better Stack filter (`call_id: <id>`) returns the full timeline of a specific call. Lifecycle events instrumented in agent entry: `call_start`, `session_context_resolved`, `tenant_config_fetched`, `session_started`, `fallback_triggered` (with `reason` discriminator: `dispatch_metadata_invalid` / `session_context_lost`). Pino transport runs in a worker thread → Better Stack downtime / invalid token never blocks the main thread. 13 new tests (7 backend + 6 agent) pin the token-absent fallback (most important: a missing token must NEVER crash the boot), base-context tags, env-derived defaults (info in prod, debug in dev), `LOG_LEVEL` override, and child-logger inheritance. Setup runbook in `docs/DEPLOYMENT.md` → "Observability" with the support-query patterns ("the call dropped at 2:14pm", "why did the AI not book this customer?", "did fallback trigger today?"). **Deferred for follow-up slices:** dashboard logs (Next.js — lower priority than call path), fallback-internal logging (would touch the 13 fallback unit tests), Sentry-style error grouping, basic metrics (call success rate, booking success rate, tool-call latency), expanded live QA suite. All tracked separately in `docs/TODO.md` → Observability.

**Standing-authorization rule activated.** User granted blanket commit+push authority conditional on four objective gates being met (docs updated / tests have 5Ws / tests pass / coverage good). Memory file `feedback_per_commit_approval.md` rewritten and `~/.claude/skills/commit-code/SKILL.md` updated to encode the rule in Steps 9, 12, the Confirmation discipline preamble, the Failure handling section, and the Non-negotiables list. The earlier per-action approval rule is rescinded for ai-sec only; other projects retain whatever their own memory files define.

---

## May 6, 2026 — Test cleanup batch + skill-resource sweep + coverage tooling

Backend tests: 1,592 → 1,605 (+13 from new launch-readiness sweep). Dashboard 514/514 held. Theme: continue the any-type debt drawdown from the morning, ship the skill+resource matching reliability sweep that the pre-launch validation list called out, then wire `@vitest/coverage-v8` so the next coverage push has a real baseline to measure against.

- **`dd642bf` — Drop 41 `'any'` casts across 5 backend test files.** normalizer (12 → 0): `mockResponse as unknown as Response` for partial fetch mocks, typed RequestInit destructure. provisioning (10 → 0): `as unknown as typeof fetch` for global.fetch overrides, `init: RequestInit` parameter. coverage (7 → 0): defined `CoverageRow` type for `client.query<CoverageRow>(...)` rows. auth (7 → 0): typed `MockReply`, `RouteCapture`, `AppRequest`; `typeof import('./routes/auth').registerAuthRoutes`. routeHelpers (5 → 0): typed MockReply with FastifyReply intersection, ZodIssue import, dropped redundant `as any` on `{}`. Audited bugfix-comprehensive: 11 supposed instances were all comment-text matches in 5W headers ("WHO: any API caller"), zero work needed — same false-positive class flagged the imprecise regex artifact. TODO count refreshed (215 → 77).
- **`bbda0da` — Drop 19 `'any'` casts in 4 backend sync/regression tests.** servicetitan-sync (6 → 0): `[string, unknown[]?][]` for vitest mock-call shape; `unknown[]` for pg query params and rows; `{ id: 0, customerId: 0 } as ServiceTitanJob` for cancelJob/updateJob mock returns. high-bugs (5 → 0): `import type { JwtPayload }` + `import type { ZodIssue }`; defined `TestJwtPayload` for the 3 jwt.verify casts. square-sync (4 → 0): same vitest-mock and pg-params pattern. jobber-sync (4 → 0): same pattern; one cast became `as unknown as jobber.JobberVisit` for the deliberate null-client sad-path that exercises the runtime null guard. Audited middleware: 8 supposed instances all "WHO: any service / route..." in `it()` description strings. TODO count refreshed (77 → 58).
- **`4a4b9b4` — Drop "Axiom" from log-aggregation candidate list.** Replaced with "Better Stack, Grafana Loki" because Axiom (axiom.co) — a real log-aggregation SaaS — collides with the user's other project also named Axiom. Memory file added (`feedback_axiom_naming.md`) so future suggestions don't reintroduce it. Doc-only.
- **Pending: skill-resource matching reliability sweep + backend coverage tooling.** New file `src/skill-resource-matching-sweep.test.ts` (13 tests, 5W-annotated). Closes the docs/TODO.md "Pre-launch validation" entry "Skill + resource matching reliability sweep — across all 5 industry templates." Three sections: (1) per-industry HAPPY paths covering all 5 templates — automotive with hyphenless skills, salon with empty capabilities, mobile_tire with hyphenated `tire-mount`, auto_bays with cross-axis skill×capability join, ai_platform with no requirements at all; (2) error-code matrix pinning each of the 5 specific codes (`INVALID_PARAMS`, `NO_SKILLED_EMPLOYEE`, `EMPLOYEE_NOT_SCHEDULED`, `TIMESLOT_OCCUPIED`, `NO_AVAILABILITY`) plus a second `NO_AVAILABILITY` variant for the no-skill-required-but-capability-mismatch path; (3) cross-template guards covering tenant isolation under skill-name collision and exact-match-not-substring skill semantics. The file deliberately does not duplicate `scheduling-atomic.test.ts` (abstract logic), `booking-concurrency.test.ts` (races), `scheduling-timezone-bug.test.ts` (DST), or `scheduling-overrides.test.ts` (override mechanics). What it catches that the prior tests did not: hyphenated skill names breaking under any future regex/substring matching change; empty-capabilities arrays vocabulary-colliding with the no-skill ELSE branch; cross-axis skill×capability JOIN drift; the `NO_AVAILABILITY` catch-all becoming unreachable if a future refactor moves a more-specific code below it; substring skill matching ("cut" matching "haircut") being introduced "for convenience". Same commit also wires `@vitest/coverage-v8` into `vitest.config.ts` so backend coverage is now measurable: first baseline run shows lines 62.67%, statements 60.58%, branches 53.80%, functions 64.47%. Logic coverage on launch-critical paths is strong (95%+ on auth/users/voice/agentTools/booking RPCs/all CRM clients/most services), route-handler coverage is the gap (5-50% on appointments/billing/calendar/mappings/provisioning/reminders/communications/vocabulary route handlers because tests exercise the underlying RPC/service layer rather than going through fastify.inject()). Dashboard `dashboard/package.json` also got `@vitest/coverage-v8` declared explicitly so a fresh `npm ci` in dashboard installs the dep that `dashboard/vitest.config.ts:11` already references.

---

## May 6, 2026 — Multi-tenant isolation audit + CI rot recurrence

Backend tests 1,551 → 1,592 (+41 over the day's two commits). Dashboard 514/514 held. Theme: pre-launch hardening — close two cross-tenant authorization gaps surfaced by a verify-first probe, then unbreak ~3 days of red CI on main.

- **`3a72f0d` — Multi-tenant isolation probe + cross-tenant leak fixes.** Built `src/multi-tenant-isolation.test.ts` (25 tests across 5 probe categories: query-string override, cross-tenant id under JWT-only, body-tenant_id FK injection, positive controls, admin-only `/tenants/*` gating). Real Fastify + real Postgres + RLS-enforced via api_user pool. Probe found two findings, both closed in the same commit:
  - **Finding 1 — application-layer cross-tenant override (read + write).** `tenantMiddleware` precedence (`query > body > JWT`) had no auth gate; any non-admin could pass `?tenant_id=<other>` to read another tenant's data, OR POST `body.tenant_id=<other>` to write to another tenant. 12 of 21 initial probes failed (8 read-leak shapes + 4 write-injection shapes). Closed by adding a 403 gate in `tenantMiddleware` for any cross-tenant override unless caller is super-admin; mismatched query-vs-body returns 400.
  - **Finding 2 — `/tenants/*` admin routes had no super-admin gate.** Every route used `requireAuth()` only, which checks "is authenticated" not "is super-admin." Any tenant user could `GET /tenants` (enumerate every customer), `DELETE /tenants/<other>`, `POST /tenants/reorder`, etc. Added `requireSuperAdmin()` helper to `src/middleware.ts` and applied to the destructive surface; `GET /tenants/:id/config` + `POST /tenants/:id/update-config` get a "super-admin OR own-tenant" gate so tenant users can still manage their own config.
  - **Fallout repaired:** `src/tenant-routes.test.ts` had `authStub` shape using camelCase (`tenantId`) while the production JWT payload is snake_case (`tenant_id`). New gate exposed the mismatch via undefined `req.auth.tenant_id`; fixed the stub to match. 10 new middleware unit tests pin the gate + `requireSuperAdmin` at the unit layer in addition to the integration probe.
  - Severity: pre-beta, no real customer data was at risk because DynaTire isn't live. But either finding alone would have been a critical breach in a paying-tenant SaaS once one beta customer was on the platform; both closed before launch. The probe is now permanent regression coverage; the existing DB-level `rls.test.ts` stays unchanged (DB layer was correctly enforcing whatever context the app set — the bug was that the app set the wrong context).

- **CI rot recurrence — pgvector image, set-e blind spot, dashboard tsconfig.** After pushing the security fix, discovered CI on main had been red since 2026-05-04. Three independent root causes, all fixed in one commit:
  - **CI postgres image had no pgvector.** `.github/workflows/ci.yml` used `postgres:16` (vanilla); the first migration calls `CREATE EXTENSION vector` and silently failed. Switched the CI service image to `ankane/pgvector:v0.5.1` to match the local Docker stack documented in CLAUDE.md.
  - **`scripts/setup-db.sh` swallowed migration errors.** `OUTPUT=$(psql ... 2>&1); RC=$?` looks like it captures the exit code, but with `set -e` the script exits on `OUTPUT=...` failure *before* `RC=$?` runs — the FAIL handler that prints the error never ran. Three days of red CI showed `exit 3` with no message. Wrapped the psql call with `set +e` / `set -e` so the FAIL block actually fires and prints the psql output.
  - **`dashboard/tsconfig.json` had `"types": ["vitest", "jest"]` placed at the JSON root level instead of inside `compilerOptions`.** TypeScript silently ignores misplaced fields, so the directive was dead config. It worked locally because `tsc` auto-discovers everything in `node_modules/@types/*` and lifecycle-hook globals leaked in transitively. Fresh CI installs didn't get the same tree, so `afterAll`/`afterEach` resolved as `Cannot find name`. Moved into `compilerOptions` and switched to the proper values: `["vitest/globals", "@testing-library/jest-dom/vitest"]`.
  - Verified against a fresh `npm ci` install to simulate CI before pushing: dashboard tsc clean, 514/514 tests pass, lint clean. Setup-db script tested locally — exits 1 with a visible psql error on real failure (was silent exit-3 before).

---

## May 5, 2026 — Cleanup Sweep (7 commits, type-safety + lint debt + audit truth-up)

Continuation of the verify-first pattern. Backend tests: 1,514 → 1,536 (+22, all from new helper test coverage). Skip count: 0 (held). Dashboard: 500 → 504 (+4 from new vocabulary-guard regex patterns). Theme: drive down `any`-type debt across backend tests, extract two more shared helpers, ship a UX vocabulary pass, truth up TODO entries that had drifted from reality.

- **`f686672` → `b293813` → `9364773`** — High-value 5W backfill across `rls`, `schema`, `customer`, `tenant-reorder`, `critical-bugs` test suites. 23 tests gained WHO/WHAT/WHEN/WHERE/WHY annotations covering security-critical RLS isolation invariants, the booking RPC contract (overlap-rejection error_message string the agent prompt depends on), the customer schema timezone defaults, the drag-reorder schema invariants, and the BUG-001/002/006 regression suite. Backend 5W coverage: 64 → 70/90 files.
- **`33f83cd` + `01b7009`** — Backend test `any`-type cleanup. Top-5 offender files (reminders, consentService, communications, middleware, bugfix-comprehensive) cleaned with `vi.mocked(...)` for typed mock access + `as unknown as Type` for partial-mock structural casts + proper Fastify/Pool type imports. Net: 215 → 129 instances across backend tests (40% cleared); rest tracked in TODO.md.
- **`5f12215` + `2cd381a`** — Destructive-flow tests (NEW). Four flows pinned: tenant DELETE (3 tests), tenant POST /reorder (5 tests, asserts sort_order = 0..N-1 invariant + ROLLBACK on partial UPDATE failure + auth gates), shift override CRUD (9 tests across POST create + POST update + DELETE), and AppointmentView mock-mode `handleUpdate` + `handleDelete` guards (2 tests verifying no `/update` POST and no DELETE fetch happen when `usingMockData=true`).
- **`88701c0`** — NEEDS-REFACTORING #11 deferred-part verify-first. Reusable pieces (`useStaticData`, `useActiveTenantId`, `useVocabulary`, `AppointmentDetailContext`) were already extracted; remaining orchestration is component-specific with one consumer each.
- **`cbf22b0`** — Dashboard test `any`-type cleanup. ~27 instances → 0 across `superadmin.test.tsx` + `settings.test.tsx`. New `dashboard/lib/test-utils.ts` exports a typed `mockJsonResponse(body, init?)` helper. Caught a real latent bug: a `lastCall = .find(...)` deref of a `T | undefined` that the prior `as any` cast had been hiding.
- **`b293813`** — Vocabulary pass on UI strings. 4 user-visible jargon strings replaced: "Multi-Tenant Management" → "Multi-Business Management", "Skill Matrix" / "Service Assignment Matrix" → "Service Assignments", "coverage gaps" → "aren't fully staffed yet". `vocabulary-guard.test.ts` extended with 4 new banned-pattern regexes.
- **`3eba91b`** — `disconnectCrmIntegration` helper extracted. Verify-first found CRM disconnect/sync-status response *shapes* were already normalized. The remaining duplication was at the *implementation* level — 4 × 16-line disconnect handlers differing only in the provider literal. Extracted to `src/services/crmDisconnect.ts`. 5 unit tests. Net: ~30 lines deduped.
- **`faf3056`** — Canonical `TenantFull` typing for the dashboard. Three components (TenantCard, SuperAdminDashboard, TenantEditPanel) had local `type Tenant = { ... }` declarations. Migrated to `import type { TenantFull }`. Two canonical-type fixes: relaxed `Tenant.{voice_id, system_prompt, first_message}` to `string | null` (matches DB nullability), added `TenantFull.{system_prompt_template, first_message_template}` as optional read-only.

## May 4, 2026 — Refactor Marathon (8 commits, ~−800 lines net)

Backend tests: 1,456 → 1,514 (+58, mostly from new helper test files). Skip count: 2 → 0. Dominant pattern: extract-helper-then-migrate-callers, with verify-first redirecting two original framings ("unify token refresh" → "extract OAuth state JWT"; "drop withTenantClient param" → "extract mock test helpers") toward higher-ROI targets.

- **`9b0a572`** — UsageTrackingService deleted (NEEDS-REFACTORING #3). In-memory stub with no DB persistence, no Stripe meter reporter, no metered-tier customer. Deleted under the test-or-delete lens. Removed `src/services/usage/`, `src/types/usage.ts`, the optional `usageTracker?` constructor param on `CommunicationService` + `SMSService`, and the `await trackSMS(...)` block.
- **`f4ac89a`** — `paginateSync()` helper extracted (NEEDS-REFACTORING #10, narrow). 7 inline pagination loops across the 4 CRM sync modules collapsed into calls to `src/services/syncPaginate.ts`. Generic over both item type and cursor type (handles Jobber GraphQL `pageInfo`, HubSpot `paging.next.after`, Square `result.cursor`, ServiceTitan page-number `hasMore`). 9 5W-annotated tests including a regression test for the null-initial-cursor case caught mid-refactor.
- **`c12d075`** — CLAUDE.md drift detector (NEEDS-REFACTORING #13). New `scripts/verify-claude-md.ts` runs five checks (route count, migration count, template count, listed-directory existence, commit reachability from main). Wired into the backend CI job + `npm run verify:claude-md`. Numeric-count checks scope to the current-state portion (skip historical Resolved Issues archive); commit-reachability scans the full document. Inline `<!-- verify-claude-md: unmerged -->` marker opts known-unreachable hashes out. 25 5W-annotated tests pin the pure check functions.
- **`24a2e47`** — `improvement-ideas.md` pruned (NEEDS-REFACTORING #12). 6 closed task blocks deleted, 1 ALREADY SHIPPED entry preserved as audit evidence. Preamble rewritten to declare the file as generator output, not a curated backlog. 2137 → 2089 lines.
- **`cdfd0b4`** — Mock test helpers extracted (~350 lines deduped). Surfaced by the verify-first on the deferred part of NEEDS-REFACTORING #11: 13 test files duplicated `createMockClient` / `createMockPool` / `mockWithTenantClient` (~25 lines each). New `src/services/test-utils-mock.ts` is a strict superset: always tracks queries, always bypasses `SET LOCAL` / `RESET` session-variable scaffolding, mock pool exposes both `connect()` and `query()`. 12 5W-annotated helper tests.
- **`647866a`** — OAuth state JWT helpers extracted (~72 lines deduped). The truly shared code wasn't the token refresh (Google SDK vs Outlook fetch genuinely differ) but the **OAuth state JWT** — sign + verify duplicated across 6 files (Google + Outlook calendars + Jobber + HubSpot + Square + ServiceTitan clients) with only the `purpose` discriminator differing. New `src/services/oauthStateJwt.ts` with 10 5W-annotated tests covering round-trip, payload shape, env-secret fallback, custom expiry, and four sad paths including cross-provider replay defense.
- **`ed26cbc`** — Tenant bootstrap doc cleanup. Verify-first found `src/services/tenants/bootstrap.ts` was already shipped on 2026-04-30 (commit `19d6b8b`); both call sites already consumed it; 9 unit tests with 5W comments already covered happy + sad. Pure `docs/TODO.md` truth-up.
- **`f686672`** — `get_effective_shifts` skips re-enabled (2 → 0). Both `it.skip`'d tests in `src/shift-overrides-edge.test.ts` (skipped 2026-04-30 when the `employee_shifts` pattern fallback was retired) replaced with new tests under the `employee_schedule`-only contract: HAPPY "multi-day range returns every row in date order" (5 weekday seeds, asserts row order + content) and SAD "rows outside the queried range are filtered out" (3 seeds Mon/Wed/Fri, query Wed-only, expect exactly 1 row).

## May 3, 2026 — Voice Fallback Validation + Tenant-Config Redo on Main

Two-part day. The fallback validation surfaced a documented-but-not-actually-shipped feature, and the same investigation found that NEEDS-REFACTORING #2 (tenant-config wiring) was in the same shape — claimed shipped, actually on a forgotten branch. Both closed.

**Voice fallback path validation** (queue #9). CLAUDE.md / ARCHITECTURE.md / NEEDS-REFACTORING.md #9 had all claimed `runFallback()` used OpenAI TTS as a guard against Grok outage, but the actual code on main wired GrokTTS in both the primary path and the fallback — meaning a Grok outage would leave the fallback unable to speak. Three closures:

- Extracted `runFallback()` to `agent/src/fallback.ts` with injectable provider deps.
- Switched the fallback TTS to OpenAI (matches what docs already claimed). Provider keys are passed in as a `FallbackConfig` arg rather than imported, so the function is testable without going through the env-validation `process.exit(1)` path.
- Awaited `session.say()` so a synthesis-time TTS failure is caught inside the try block instead of escaping as an unhandled promise rejection.

13 new 5W-annotated tests in `agent/src/fallback.test.ts`: happy path message + interruption blocking + start-before-say ordering + VAD wiring; OpenAI-not-Grok provider-choice contract (3 tests including a dedicated negative test); never-throw contract under each failure mode.

**Tenant-config wiring redone on main** (closes NEEDS-REFACTORING #2). The fallback validation surfaced that commit `e92b3bf` <!-- verify-claude-md: unmerged --> ("feat(agent): fetch tenant display config from backend at call start"), claimed on 2026-05-01 to close NEEDS-REFACTORING #2 P0, actually lived on a `hold-tenant-config` branch and was never merged to main. Path B (redo on main) taken:

- New `POST /agent-tools/tenant-config` route in `src/routes/agentTools.ts` returns `{ name, timezone }`; null timezone → `'America/Chicago'`. 4 backend tests.
- New `agent/src/tenantConfig.ts` module with `fetchTenantConfig(client, tenantId)` and `TENANT_FALLBACK` constant. Returns the fallback on any non-success envelope. 6 agent-side tests.
- Agent worker wired — `agent/src/index.ts` now calls `await fetchTenantConfig(...)` and uses the result for `buildSystemPrompt(...)` and the spoken greeting. The hardcoded DynaTire block deleted.

Backend: 1,475 → 1,479. Agent suite: 53 → 72 tests.

## May 2, 2026 — Concurrency Fix + Structural Refactors + Test-or-Delete Policy

12-commit unblocked-work session that closed a real launch blocker, slimmed `src/index.ts` by 28%, and captured the decision principle as a durable Build Principle.

**Booking concurrency hole closed** (`55be6dc`):
- Race confirmed under READ COMMITTED with a 20-caller load test: 9/20 winners on the resource race, 20/20 on the employee race. The find-then-insert pattern in `book_appointment_atomic` / `book_with_scheduling_atomic` could pass two `NOT EXISTS` checks before either committed.
- Closed by two GiST exclusion constraints (`appointments_no_resource_overlap`, `appointments_no_employee_overlap`) scoped to scheduled, non-deleted appointments, paired with `exclusion_violation` handlers in both RPCs that return the existing `TIMESLOT_OCCUPIED` error code.
- New test file `src/booking-concurrency.test.ts` (2 real-DB race tests).
- Migrations `20260501000000` + `20260501000001` shipped to repo, **not yet applied to prod Supabase** — pre-flight overlap-scan needed first.

**`src/index.ts` 385 → 279 lines** across three commits:
- `fbc1eaf` — JWT preHandler extracted to `src/middleware.ts` as `registerJwtAuthHook(app, pool)`. Includes `JWT_SECRET`/`JWT_EXPIRY`/`generateToken`/`verifyToken`/`PUBLIC_ROUTES` and the password-rotation check.
- `9b78030` — DB pool config consolidated. `src/database/index.ts:getPool()` is now the canonical singleton with deadlock-prevention timeouts.
- `5077fd6` — `withTenantClient` factory moved to `src/database/index.ts` as `createWithTenantClient(pool)`.

**`src/services/crm/` deleted** (`2cc782a`, NEEDS-REFACTORING #1):
- 21 dormant CRM adapters + `BaseCRMAdapter` interface + `createCRMAdapter()` factory + the mocked-API test file removed (3,480 lines).
- Two of the deleted adapters (`dentrix.ts`, `eaglesoft.ts`) were dental-practice CRMs that violated the platform's HIPAA-excluded-vertical policy.
- Decision policy locked: anything we can't test against gets deleted. The four working flat clients (jobber/hubspot/square/servicetitan) are unaffected.

**Build Principles captured in CLAUDE.md** (`18181bc`):
- Test it or delete it. Build for real customers. Working flat code beats a dormant abstraction. HIPAA verticals permanently excluded.
- NEEDS-REFACTORING.md gained a "Resolution lens" preamble.

**Other landings:**
- `c9f40c6` — `scripts/setup-db.sh` bootstrap bug fixed (psql `-c` and stdin heredoc were mutually exclusive).
- `6f91b7b` — OTP Phase 3 status truthed up in CLAUDE.md (work had already shipped in commit `18caffe` on 2026-04-24).
- `c18c996` — Telnyx PSTN ticket re-submitted to LERG/porting team after the original `#2850682` went 4 days without a human response.
- `889d25b` — All *.md files aligned with the day's landings.
- `444dad1` — Last three pre-existing test files (`index.test.ts`, `normalizer.test.ts`, `scheduling.test.ts`) gained 5W diagnostic comments — 47 tests annotated; the 5W convention is now universal.

**Test state at session close (May 2):** 1,475 backend + 498 dashboard = 1,973 passing + 2 documented skips, 0 failures, typecheck clean both surfaces.

## April 24, 2026 — UX Review & Polish Batch

Full UX review of the dashboard identified 20 items across P0–P3. 14 shipped across commits `dac97cb`, `91c9903`, `7042a8e`, `3954d4c` + supporting refactors (`2f74991`). Deferred items need design input (admin-mode color, theme-selector placement, first-run nav callout) or bigger investment (skeleton screens, Remember-me refresh tokens).

**P0 trust fixes:**
- Visible load-error banner + retry on `DashboardHome`. Uses `Promise.allSettled` so partial data still renders.
- Login copy stripped of developer-internal terminology ("Multi-Tenant Management Console", "Ready for Live Integration", "Is the backend server running?").
- `ErrorBoundary` shows a friendly message in production; raw `Error.message` only renders when `NODE_ENV !== 'production'`.

**P1 affordances:**
- Login: create-account link, password show/hide toggle, `autoComplete="username"`, label/input a11y wiring.
- Today's Schedule empty state offers CTAs ("View this week", "See staff shifts").
- Unanswered-questions badge bubbles up to the Back Office mode tab.
- Fitts's Law: entire Today's Schedule card header is a single large click target.
- Icon-only buttons in `OutlookLayout` top bar carry `aria-label`. Profile button has `aria-expanded` + `aria-haspopup`.
- `ErrorBoundary` has a "Reload page" escape hatch.

**P2 polish:**
- Tenant switcher dropdown uses CSS vars (themes correctly across all 8 palettes).
- Quick-actions grid: `md:grid-cols-3` → `md:grid-cols-2 lg:grid-cols-3`.
- "Setup Assistant" quick action label corrected to "Services & Resources".
- User-facing "tenant" replaced with "business" in error messages. `vocabulary-guard.test.ts` prevents regression.

**Backend hardening:**
- Startup warnings extracted from `index.ts` into `src/services/envWarnings.ts` (pure function, 10 unit tests). Added a warning for missing `TELNYX_API_KEY`.

**Test coverage added:** +50 dashboard tests, +10 backend tests.

## April 23, 2026 — Phone Verification (SMS OTP)

- New table `phone_verifications` (tenant_id, phone, code_hash, expires_at, attempt_count, verified_at). RLS + FORCE RLS. Migration `20260423000000_phone_verifications.sql`.
- New service `src/services/telnyxSms.ts` — Telnyx Messaging API wrapper + `generateVerificationCode(digits)` using `crypto.randomInt`.
- New agent tools: `POST /agent-tools/send-verification-code` (rate-limited: 3/phone/hour, 100/tenant/day) and `POST /agent-tools/verify-phone-code` (5 tries max, 10-min TTL, bcrypt-hashed codes).
- SMS body locked: `Your SecretaryHQ verification code is: 123456. Reply STOP to opt out.` (TCPA opt-out required).
- Booking routes (`book-appointment`, `book-with-scheduling`) gate on `isValidPhone(args.phone)`. Invalid phone → route returns the ask-for-phone message; LLM reads it, asks the caller verbally, kicks into the OTP flow. Valid caller-ID phone skips verification.
- 12 new tests in `agentTools.test.ts`, 7 in `telnyxSms.test.ts`, 3 in booking-route gates.
- **System prompt (Phase 3):** Done in commit `18caffe` (2026-04-24) when the LiveKit `agent/src/prompt.ts` was created.

## April 12, 2026 — Improvement Hardening

- Employee update route missing `AND tenant_id` in WHERE clause — cross-tenant employee updates were possible. Fixed by adding tenant_id scoping + `assertRowAffected` guard.
- Zero-row mutation guards added to employees, customers, appointments, tenants, knowledge, resources, services routes — all previously returned `{ success: true }` when UPDATE/DELETE affected 0 rows (silent no-op).
- Shared route helpers extracted to `src/routes/routeHelpers.ts`.
- `nameUtils.ts` extended with `slugify()` and `buildDisplayName()`.

## April 1, 2026 — Voice AI Bug Fixes

- BUG-059: Timezone regression in `book_with_scheduling_atomic()` — hardcoded UTC instead of tenant timezone for shift validation. Fixed with migration `20260401000000_fix_scheduling_timezone_bug.sql`.
- BUG-060: Phone number stored as "+1" (incomplete) — `normalizePhone()` now rejects < 10 digits.
- BUG-061: Wrong date booked — Vapi assistant had hardcoded stale date in system prompt, now uses dynamic date.
- BUG-062: No employee assigned — AI wasn't passing `requiredEmployeeSkills` array, prompt updated with service-to-skill mapping.
- BUG-063: Call hangs up on booking failure — added error handling to Vapi assistant prompt.
- BUG-064: Generic booking error messages — added specific error codes (TIMESLOT_OCCUPIED, NO_SKILLED_EMPLOYEE, EMPLOYEE_NOT_SCHEDULED) via migration `20260401000001_specific_booking_errors.sql`.

## April 1, 2026 — Remaining Bug Fixes

- BUG-030: `link_orphaned_transcripts()` now called automatically in `dispatcher.handleCallEnded()` after every call.
- BUG-031: `checkAvailability()` now uses `check_availability_with_tz()` RPC for timezone-aware results.
- BUG-032: n8n workflow now generates embeddings (text-embedding-3-small) and stores in `call_summaries.embedding`.
- BUG-038: All edge function queries on soft-deletable tables filter `is_deleted`. `deleteEmployee()` uses soft delete.
- BUG-039: ARIA attributes added to Toast, Card, FeedbackButton, CoverageBar, OutlookLayout tabs.

## March 2026 — Code Review

- 58 bugs identified and resolved across Critical/High/Medium/Low severity.
- `users.email` scoped to per-tenant uniqueness (BUG-002).
- RLS standardized on `app.current_tenant_id` (BUG-006).
- Dev bypass button removed (BUG-005).
- `handleEditFormChange` fixed in CRMView (BUG-004).
- Fastify monolith broken into 20 route modules with RLS enforcement (BUG-017).
- Scheduling logic consolidated into `shared/scheduling.ts` (BUG-016).

## Phase 12 — Scheduler, Assignments & Coverage Visibility (Complete)

- **12A — Repeatable Setup Wizard**: 7-step guided setup (Services, Resources, Employees, Shifts, Assignments, Review, Go Live), live coverage badges, phone activation on final step.
- **12B — Scheduler Views**: Staff swimlanes (24hr, zoom), resource columns, appointment list, calendar sub-view. Quick Book panel, Employee Day Focus panel.
- **12C — Skill Relationship Map**: Interactive 3-column mind map with click-to-connect/disconnect.
- **12D — Coverage Visibility**: `check_coverage_gaps()` RPC, coverage bars, status badges, `GET /coverage` endpoint.
- **12E — RAG Normalization Layer**: `shared/normalizeForEmbedding.ts` (gpt-4o-mini), `normalized_text` column, query normalization in edge functions.
- **12F — Stripe Lite**: Solo ($129/mo) + Growth ($279/mo), Stripe Checkout, webhook (3 events), subscription gate middleware (402).

**Additional features shipped with Phase 12:**
- 8-theme system (light, dark, midnight, nord, sunset, forest, high-contrast, solarized) — ThemeProvider + CSS custom properties + palette picker.
- Admin tenant reorder via drag-and-drop with save/discard. `sort_order` column, `POST /tenants/reorder`.
- Type-to-confirm modal for tenant deletion.
- `tenantsVersion` counter in SessionContext keeps the dropdown in sync with the admin panel.

## Design Session — March 24, 2026

Full UI/UX design session. All decisions documented in `docs/UI_UX_DESIGN.md`, `docs/DECISIONS.md`, `docs/DESIGN_HANDOFF.md`. Do not second-guess these without explicit instruction from Dale.

**Work items (all complete as of 2026-03-25):**
1. Apply dark sidebar visual style — all components use CSS vars, all themes dark.
2. Rebuild theme system — `--font-display`/`--font-body` in all 8 themes, dropdown switcher.
3. Flip the scheduler — NewSchedulerView: rows=staff, cols=hours, 24hr, split-panel scroll sync, business hours shading, zoom.
4. Staff quick profile card — read-only, anchored, outside-click dismiss, skills as indented vertical list.
5. Skills toggle — Hours mode (shift bar + appointments) / Skills mode (stacked skill-colored bars).
6. Drag to reorder staff rows — grip handles, save/discard, persists to localStorage per tenant.
7. Rebuild analytics — 3 active metrics (booking data), 3 Phase 2 placeholders (Vapi).
8. Remove Coverage Map — `ServiceCoverageView.tsx` deleted, zero references remain.

**Locked decisions:**
- **Fonts:** Bebas Neue (`--font-display`) + DM Sans (`--font-body`). Universal. Use CSS variables only.
- **Coverage Map:** Removed. `CoverageBar` and `CoverageStatusBadge` primitives retained (used by SetupWizard, SkillMap, ResourceColumns).
- **Analytics:** Rebuilt. 6 metrics — 3 active from booking data (Busiest Hours, Return Rate, No-Show Pattern), 3 pending call log integration.
- **Logo:** "Secretary HQ" (space between words).
- **Philosophy:** We show data. They manage their business. No warnings, no grades, no opinions. See `docs/UI_UX_DESIGN.md` Design Philosophy section.

## 2026-06-23 — Mechanical TODO hygiene batch 2 (10 items, separate branch/PR)

New branch `chore/mechanical-todo-hygiene-batch-2` (created via `bash scripts/create-feature-branch.sh` from latest main for separation from prior `chore/eslint-header-comment-refresh` hygiene work).

10 mechanical items (only doc + comment consistency / ref standardization; no logic, no new features, no test fixes, per AGENTS.md scope strictly):

1. Fixed incorrect `src/routes/export.ts` reference in Gap inventory "Key files per gap" table in docs/TODO.md (updated to actual `src/routes/exportData.ts` and improved description).

2. Populated the previously "(empty)" "## Documentation" section in docs/TODO.md with 4 small current mechanical/doc tasks (hygiene sweeps, Gap table sync, footers, etc.).

3-10. Mass + targeted mechanical cleanup of remaining old/short REFACTORING_TODO / NEEDS-REFACTORING references (using bash grep + sed for cross-file patterns + search_replace for precision + post-edit `grep -r "old_pattern" . | wc -l` confirmations reporting 0 stragglers):

   - Updated short "REFACTORING_TODO #9" in describe() in scripts/verify-schema-alignment.test.ts.
   - Updated "REFACTORING_TODO.md item 10" in scripts/ingest-knowledge.ts and verify-*.ts comments to include "historical ... (see RESOLVED.md)".
   - Updated 4 "See REFACTORING_TODO.md item 10." in src/services/*/ *.test.ts + tests/template_test.ts + tests/schema_test.ts to "See historical ... (see RESOLVED.md for details).".
   - Updated "REFACTORING_TODO.md Item 2" in src/services/reminders/types.ts.
   - Updated several "Part of ESLint debt reduction (REFACTORING_TODO.md item 10)." in src/database/, src/services/tokenManagement.ts, src/services/crm/squareClient.ts, reminders/ etc.
   - Mass sed normalized ~35+ "as part of full cleanup (REFACTORING_TODO.md item 10)." eslint-disable header comments in shared/, src/routes/*, src/services/*, src/workers/, src/*.ts etc. to the canonical "historical full cleanup (REFACTORING_TODO item 10; see RESOLVED.md for details)." form used elsewhere.
   - Additional targeted fixes in src/types/index.ts (header + inline comment).

All changes are string/comment/doc only. Final verification grep for bad short forms: 0 remaining.

**Gates run (per standards):**
- `npm run verify:claude-md`: clean.
- `cd dashboard && npx tsc --noEmit`: clean (empty output).
- `npm run checks`: format:check clean, lint clean (exit 0 overall).
- No `npm test` (per AGENTS).

Updated docs/TODO.md (Status at a Glance + the 10 listed) and this RESOLVED entry. BRANCH_CHECKLIST.md copied by create script.

This batch continues the mechanical hygiene theme from TODO's "Small mechanical hygiene pass completed" and "Tooling cleanup" notes, without touching any non-mechanical P0/P1/P2 items. 

Ready for prepare-commit / commit-code / PR.

---

## 2026-06-23 — Additional mechanical doc hygiene batch (10 independent items on chore/eslint-header-comment-refresh)

Continuation of the prior 2026-06-23 hygiene pass (route counts, eslint header comments). 10 small, independent, solo-doable mechanical refactors / doc syncs (no new logic, no design, no test authoring/fixing per AGENTS.md scope). All changes are comment/doc/string consistency only. Branch already clean at start; edits + gates only.

Picked from spirit of open doc hygiene / stale ref items tracked in TODO/RESOLVED/GAPS (e.g. "Doc hygiene pass (route counts, Vercel refs, phone quals, REFACTORING comments) done mechanically", "full Vercel→Railway hosting alignment is follow-up mechanical task", lingering historical file refs, count drift in secondary docs).

Items executed (each independent, verifiable by grep + tsc/checks/verify):

1. Replaced stale "134 migrations" (x2) → "142 migrations" in root README.md (table row + project structure tree).
2. Replaced stale "Backend routes (26 modules)" → "Backend routes (29 modules)" in root README.md coverage table.
3. Synced approximate test counts in root README "Testing" section + commands (Backend ~1,770→~1,940; Dashboard ~747→~790; E2E note updated for accuracy per CLAUDE).
4. Fixed docs/ARCHITECTURE.md: "### 9.1 Route modules (27)" header → (29); cleaned parenthetical "28 distinct registered..." claim to accurate "28 registered calls ... + 1 internal scaffold helper".
5. Removed duplicated " `src/index.ts` is slim — ..." paragraph (was repeated verbatim right after itself) in docs/ARCHITECTURE.md §9.1.
6. Mechanical cross-file normalization (bash grep + sed + targeted edit + post-grep zero stragglers for live pointers): removed lingering "lives in `RESOLVED.md` / `NEEDS-REFACTORING.md`" phrasing and the table row for the deleted file in root + docs/README.md (historical narrative refs in TODO/RESOLVED/DIAGRAMS left as-is).
7. Updated CLAUDE.md agent description "tools (12 tools)" → "tools (17 tools)" (actual count: `grep -c 'llm\.tool(' agent/src/tools.ts` = 17 — tools are registered via `llm.tool(...)`, not `createTool`); drift verify re-ran clean.
8. Bumped "Last updated" / "Last verified" footers in root README.md, docs/README.md, docs/ARCHITECTURE.md to document this additional hygiene pass (and noted the 10-item batch).
9. Sweep + zero additional fixes needed: grepped *.md + *.mmd for other stale "2[0-9] route", "13x migrations", old test nums, etc. Confirmed uniformity at 29/142 after prior items; no actionable stragglers beyond historical cites.
10. Full verification gates (per CODING_STANDARDS + DEVELOPMENT_WORKFLOW + BRANCH_CHECKLIST + PR template): `npm run verify:claude-md` (clean), `npm run checks` (format:check + lint --max-warnings 0 + tsc root + dashboard; exit 0, no output on tsc means zero errors), explicit `npx tsc --noEmit` (backend/dashboard/agent — all clean). No `npm test` per AGENTS mechanical scope. Updated this RESOLVED + TODO status note. Changes are doc-only so no e2e or behavioral tests required.

**Verification proofs (as in prior hygiene entry):**
- Pre/post `grep` for stale strings (134 migrations, 26 modules, (27), NEEDS-REFACTORING live paths, etc.) → 0 remaining actionable.
- `npm run verify:claude-md` clean (twice).
- `npm run checks` exit 0.
- Full `npx tsc --noEmit` (root + dashboard + agent) — zero errors, no output.
- `grep -r "old" .` style confirmations reported in session for each replace.
- Git working tree had only these targeted doc edits.

This keeps secondary docs from drifting after the 29/142 state (post PRs #56-67 etc). No prod impact, no migration, no runtime change. Ready for `npm run prepare-commit` style close if committing.

**Test state note:** Units per CLAUDE ~1,940+790+360 (no new tests added in this mechanical pass).
