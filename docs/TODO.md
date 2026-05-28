# TODO

**Status at a Glance** (as of 2026-05-28 — UX pass + solo-mode dedup shipped)

- **Security**: 2026-05-21 closed a CVE-class anonymous cross-tenant data hole (`04cb661`, live in prod). Production-hardening batch shipped (deep `/ready`, pool fail-fast, `errors_total`, bad-input→400, agent graceful-recovery). See "Production hardening" + `RESOLVED.md`.
- **CI**: green again after a ~3-day red streak (stale migration-count drift, fixed `cd185dd`). Agent package now gated in CI. Tests: backend 1,930 · dashboard 720 · agent 99. E2E: 100 passed / 3 known flaky (see "E2E Known Issues" section below) as of 2026-05-27 run. New coverage added 2026-05-27: customer-notes.spec.ts (Gap 1), appointment-cancel-ui.spec.ts (Gap 2, hardened multi-surface cancel including the former flaky List popover path), owner-config-to-booking.spec.ts (Gap 3).
- **Voice / Telnyx**: `+1-630-937-9478` unreachable from PSTN. LERG ticket open. Zero inbound CDRs. Blocks all live voice validation and DynaTire beta.
- **Env vars (user action)**: `DASHBOARD_URL` + `SENTRY_DSN` + `METRICS_TOKEN` + `BETTER_STACK_TOKEN` not yet set on Railway. **P0: Railway deploy is NOT gated on CI** (deploys on push regardless of result).
- **Browser validation**: Role gating + invite flow needs real-browser testing.
- **UX audit pass 2 (2026-05-19)**: Raw findings were in `ux-review-notes.md` (now archived/reduced). Actionable items triaged into the clusters below. Cluster-B defects closed 2026-05-21.

Everything else complete or tracked below.

---

## In-flight markers

- **IN FLIGHT (external)**: Waiting on vendor/third party.
- **IN FLIGHT (user)**: Needs action from Dale.
- **IN FLIGHT (prod-apply)**: Code shipped; needs production DB/Infra apply.
- **IN FLIGHT (validation pending)**: Code + tests done; needs live condition (PSTN call, etc.).

---

## Phase 13 – Blocking Launch

- [ ] **IN FLIGHT (external)** Telnyx PSTN ticket for `+1-630-937-9478` (see `TICKET_SUPPORT.md`)
- [ ] **IN FLIGHT (user)** Set `DASHBOARD_URL=https://dashboard-production-cee3.up.railway.app` on Railway `ai-sec` service
- [ ] **IN FLIGHT (user)** Set `SENTRY_DSN` on Railway backend + agent (dashboard Sentry already wired client+server, just needs DSN)
- [ ] **IN FLIGHT (validation pending)** Browser-verify role gating + invite flow

Closed: prod migrations apply (36 applied 2026-05-17 → version `20260514000000`); first-run guided tour (`20838a4`).

---

## Production hardening (2026-05-21)

Opened after a perf check accidentally surfaced a CVE-class auth hole — the lesson being we can't rely on luck: under real call volume we must fail closed, fail fast, and stay observable. Some items shipped same-session (code), the rest need Dale/Railway.

**Done 2026-05-21 (committed + pushed, `2461f08..cd185dd`; CI green):**
- [x] **SECURITY** Unauthenticated cross-tenant data access via `?tenant_id=` (read+write+delete) closed — `tenantMiddleware` 401s non-public/non-exempt requests with no `req.auth`; `requireTenantId` drops the body fallback. Probe 8 added (isolation suite now 39 probes). See `RESOLVED.md` + `docs/SECURITY.md`.
- [x] **Deep `/ready` endpoint** — DB ping + pool saturation stats (`total/idle/waiting`); 503 when DB unreachable. `/health` stays shallow (liveness). A monitoring signal, not yet a traffic gate.
- [x] **Pool fail-fast** — added `connectionTimeoutMillis: 5000`; pool-checkout under exhaustion now errors fast instead of hanging forever (the "many callers" failure mode).
- [x] **Alerting visibility** — `withHandler` unhandled errors now route through `logError` → `errors_total` ticks (pre-fix pool-exhaustion errors were invisible to `rate(errors_total)` alerting).
- [x] **Threadpool** — `GET /` + `/demo` no longer `fs.readFileSync` per request.
- [x] **Gap 3 — client-error 500s → 400** `withHandler` now maps Postgres class-22 data exceptions (`22P02`/`22003`/`22007`/`22008` — e.g. a non-UUID `:id`) to 400 and does NOT tick `errors_total`. Confirmed live: `GET /records/customers/not-a-uuid/history` 500→400. Unit tests added (incl. a guard that non-class-22 errors stay 500). Fixes the ~12 unvalidated `:id` routes in one place + stops client garbage polluting 5xx/error-rate alerts.
- [x] **Gap 1A — agent graceful recovery** `agent/src/prompt.ts` "Technical glitches" section: never speak raw error text (`500`/`timed out`/`backend`), recover in-character, never stall silently. Regression test pins it. (Wording is a placeholder for Dale to tune.)
- [x] **Gap 2 — agent CI job** `agent/` (tsc + 99 tests) now runs in CI — was previously ungated entirely.
- [x] **Testability extractions** `jsonContentTypeParser` (+ 400-on-bad-JSON fix) and `readinessHandler` extracted to modules with unit tests (incl. the `/ready` 503 DB-down branch). E2E added: anonymous-tenant 401, `/ready`, malformed-JSON.

**Open — needs Dale / Railway (config, can't be done from here):**
- [ ] **IN FLIGHT (user)** Set `METRICS_TOKEN` on Railway backend (Prometheus `/metrics` returns 404 until set — currently no metrics scrape in prod).
- [ ] **IN FLIGHT (user)** Set `BETTER_STACK_TOKEN` on Railway backend + agent (no log aggregation in prod until set).
- [ ] **IN FLIGHT (user)** (Optional) Repoint Railway healthcheck → `/ready` if you want deploy promotion gated on DB reachability (note: Railway healthcheck gates promotion, not per-request traffic).
- [ ] **Alert rules** — once `METRICS_TOKEN`/`BETTER_STACK_TOKEN` are live, wire alerts on `rate(errors_total[5m])`, `booking_attempts_total{outcome="failure"}`, http 5xx rate, p95 `http_request_duration_ms`, and sustained `/ready` `waiting>0`. Route to a channel Dale watches.

**Open — LOAD TESTING (deferred — not a current concern, Dale 2026-05-21):**
- [ ] **Load-test the booking path** to find the concurrent-call ceiling before pool exhaustion / latency cliff. Pool `max=10`, single agent worker per tenant — ceiling currently unknown. Define expected concurrency, size pool + LiveKit accordingly.
- [ ] **Pool-exhaustion integration test** — spin an isolated `Pool({max:1, connectionTimeoutMillis})`, hold the only client, fire another checkout, assert it rejects fast AND `errors_total` ticks via `withHandler`→`logError`. Proves the fail-fast + alerting path end-to-end (today's unit test only throws a *synthetic* error, not a real timed-out checkout). **This is load-testing scope — defer with the booking load test above.**

**Gap 2 — CI / deploy gate (prioritized; agent job already DONE above):**
- [ ] **P0 — Gate Railway deploy on CI green.** Today Railway auto-deploys on push to `main` *independently* of GitHub Actions — a red CI run does NOT stop the deploy. Fix via Railway "Wait for CI" / check-suite gating, or branch-protect `main` + deploy from a CI step. **Needs Dale (Railway dashboard + GitHub branch protection).** Highest priority — without it every other CI improvement is advisory only.
- [ ] **P1 — Add E2E (Playwright) job to CI.** The runtime security proof (anonymous-401, cross-tenant 403, `/ready`) runs only locally today. Concrete plan: new `e2e` job — `ankane/pgvector` service (mirror backend job) → `npm ci` (root + dashboard) → `npm run build` (backend) → start backend + dashboard → `npx playwright install --with-deps chromium` → `cd dashboard && npx playwright test`. **Needs first-run validation in Actions** (browser install + server startup are the usual flake sources) — don't mark required until one green run.
- [ ] **P2 — Repoint Railway `healthcheckPath` → `/ready`.** `railway.json` currently `/health` (shallow); `/ready` would gate deploy *promotion* on DB reachability. Behavior change (could block promotion during a DB blip) — Dale's call.

**Gap 1 — agent resilience (1A done; remainder):**
- [ ] **P2 — Wrap the agent `entry` tail in try/catch → `runFallback`.** `agent/src/index.ts` ~143-181 (`fetchTenantConfig`→`buildTools`→`session.start`→greeting) is outside the fallback try/catch; an unexpected throw there propagates out of `entry`, the LiveKit job dies, and the caller hits dead air. Catch → fallback message. Low risk, real dead-air path.
- [ ] **P3 — (B) idempotent-read retry** in `toolsClient` — one retry on a transient 5xx for READ tools only (never mutations: a timed-out booking may have succeeded server-side → double-book). Backed out 2026-05-21 (not approved); revisit.
- [ ] **P3 — (C) latency filler** — speak a short "one sec while I check that" before known-slow tool calls to cut the up-to-8s silence window. Pairs with reconsidering `toolsClient` `timeoutMs` (8s is long for voice).

**Gap 3 — follow-through (core fix done above):**
- [ ] **P3 — Audit the ~12 `:id` routes** for any place that still leaks a raw value or 500 on bad input despite the class-22 mapper (e.g. routes not wrapped in `withHandler`, or non-pg validation). The mapper is the safety net; explicit `requireValidUUID` at the route door is the belt.

---

## Voice Validation (blocked on Telnyx)

- [ ] Call transcript + summary flow end-to-end
- [ ] Expanded live QA suite (`scripts/qa-live-test.py`)
- [ ] Reminder delivery monitoring dashboard
- [ ] Add coverage for OTP + all 5 booking error codes in live QA

---

## Non-blocking / Polish

- [ ] Pricing tiers (Pro/Enterprise) positioning
- [ ] Continue `src/index.ts` extraction / cleanup
- [ ] Finish broader CRM sync structure extraction (NEEDS-REFACTORING #10)

Closed: `pw.txt` decision (`ac61161` — deleted, NEEDS-REFACTORING #14 closed); dashboard Sentry integration (`c3e679e` — `@sentry/nextjs` server+client wired); `docs/README.md` (2026-05-15).

## UX backlog (from 2026-05-16 `/ux-expert` audit)

Closed items in `RESOLVED.md` under 2026-05-16 + 2026-05-17.

Open:
- [ ] **B4** Reconsider sub-tab URL persistence (verify usage first)
- [ ] **C1 + C2** Schedule: 4 sub-views → 2 (Day/Month), unify the 3 separate headers
- [ ] **E1** Threaded demo-mode (sample data via session flag, obsoletes static `/demo`)

## UX audit pass 2 (2026-05-19)

Source: Raw UX audit performed 2026-05-19 (previously captured in `ux-review-notes.md`, now archived). High/medium findings triaged below. No separate source-of-truth file is maintained for the raw notes.

### P0 — verified rule violations + real defects (small, concrete)

- [ ] **BLOCKER (Dale)** Dale needs to go over the scheduling and how the coloring, grading, etc. work in the live UI so he can guide the system on how to deal with grading. Cluster A below is **on hold** until then — a first attempt (wizard review + skill-map de-grade) was built and reverted 2026-05-20 (`git reset --hard 0f7f1d0`) because the right neutral treatment depends on how each surface actually works. Do not re-apply the de-grade slices unprompted. See memory `feedback-no-coverage-grading`.
- [ ] **Cluster A — neutral-language / no-grading** (8 surfaces) — *blocked on the Dale review above.* Violates the explicit product rule "no percentages, no warnings, no opinions" (`docs/DESIGN_HANDOFF.md:284`, `docs/UI_UX_DESIGN.md:30`). Same fix shape everywhere: rename grading tokens → neutral connection/availability state, drop green/yellow/red threshold colors, factual copy.
  - ~~`SoloStepReview.tsx`~~ DONE 2026-05-28 (`b140f98`) — coverage pills replaced with neutral language. + `StepReview.tsx` — still open — `allCovered`/`partial` + green/yellow/red readiness badges
  - ~~WCAG `text-[10px]`~~ DONE 2026-05-28 — 45 replacements across 25 files; 0 remaining occurrences
  - `skill-map/SkillRelationshipMap.tsx` + `SkillMapNode.tsx` — footer `full`/`partial`/`uncovered` + warning/danger colors
  - `scheduler/ResourceColumnsView.tsx` — empty slots classed as `gap`
  - `scheduler/AppointmentListView.tsx` — long gaps as amber alert rows
  - `scheduler/EmployeeDayFocusPanel.tsx` — utilization color-graded green/yellow/gray
  - `AnalyticsView.tsx` — keep summaries neutral, no implicit scoring
  - (related medium) `AppointmentDetailPanel.tsx` — alignment-blocked message reads as warning banner; make factual
- [ ] **Cluster B — verified defects** (3 sites, independent fixes)
  - [x] `SetupWizard/StepServices.tsx` — DONE 2026-05-21. Duration field now uses a raw-text display state; clearing leaves it empty (was forced to `0`), empty propagates `0` (saveService's `< 1` guard rejects it), never NaN. +3-test regression spec `StepServices.test.tsx`. (Note: it was an input-UX bug, not silent data loss — `saveService` already rejected `0`.)
  - [x] `SuperAdminDashboard.tsx` — DONE 2026-05-21. Search input now controlled; filters sidebar cards by name (case-insensitive), shows a no-match message, and **disables drag-reorder while filtering** (added `draggable` prop to `TenantCard`; reorder math is by full-array index so a filtered subset would corrupt order). +3 tests in `superadmin.test.tsx`.
  - [x] `SetupWizard/index.tsx` — DONE 2026-05-21. Seed hoisted to `runSeed` (reconcile by name-diff via `seedTargetRef`, so partial-failure retry finishes without topping-up a user's own services); failure now surfaces a Retry banner instead of a silent `console.warn`. +2 tests. **All three Cluster-B defects closed.**

### P1 — a11y + shared-primitive consistency (cluster fixes)

- [ ] **Cluster C — overlay/dialog focus management.** Move custom overlays onto the shared Modal primitive (Escape/backdrop close, focus trap, initial focus, visible close affordance): `WizardModeChooser` (high — no focus trap), `WizardWelcome`, `FirstRunTour`, `SetupWizard/index` shell, `scheduler/AppointmentPopover`, `scheduler/StaffProfileCard`, `scheduler/EmployeeDayFocusPanel` (dialog/landmark role), `skill-map/SkillMapFixPanel` (bare `✕`).
- [ ] **Cluster D — accessible action controls.** Replace icon-only / hover-only action buttons with shared button/icon-button primitives + `aria-label` + visible focus; route destructive actions through the shared confirm: `SetupWizard/StepEmployees`, `StepServices`, `StepResources`, `SkillManagementView`, `scheduler/StaffSwimLaneView` (hover-only delete), `ResourceManagerView`, `scheduler/AppointmentBlock` (no keyboard move path).
- [ ] **Cluster E — empty / loading / filtered-no-results distinctness.** Make "no data yet" vs "no matches" vs "still loading" visually distinct (recurring medium): `AppointmentListSidebar`, `KnowledgeBaseView`, `VoiceCallsView`, `Step2Resources`, `EmployeeManagementView`, `MyTeamView`, `CustomerDetailPanel` empty fields, `DeletedRecordsPanel`.

### P2 — copy / trust polish

- [x] `SetupWizard/WizardWelcome.tsx` — DONE 2026-05-28 (`c804025`). Removed inaccurate "10 minutes / 6 quick questions" copy.
- [x] `SkillMatrixView.tsx` footer + `Step7GoLive.tsx` — drop persuasive/reassurance phrasing; state what changes factually. Done 2026-05-28.
- [x] `SetupProgressPill.tsx` — DONE 2026-05-28 (`bdd549e`). Removed `hidden` class; pill visible on all screen sizes.
- [ ] `ProfileView.tsx` — "Security" card "coming soon" placeholder; replace with real account facts or collapse.

### P2.5 — Wizard Phase B: full draft commit model

- [ ] **`SetupWizard` + `SoloWizard` draft state.** Phase A (2026-05-27) added back-at-every-stage + auto-seed rollback on re-pick, which solves the visible bug Dale flagged ("all of the businesses have the same data when picking services"). Phase B is the principled fix for the parallel ask ("data shouldn't be solid until we are out of the wizard"): hold services/resources/employees/shifts/mappings in local state during the wizard, commit to DB only on the Step 7 Done click, discard on dismiss. Touches ~5K lines of wizard infrastructure (`useWizardCrud.ts` rewrite, `WizardStepContent` props, all `Step*.tsx` components, 5 test files). Needs `VocabularyProvider` to accept an `overrideTemplate` so vocab follows draft business_type without DB write. Open in a fresh branch; coordinate with P1 Cluster C (Modal primitive migration) since both touch overlay shells. See `dashboard/components/SetupWizard/SetupWizard.backToPicker.test.tsx` for the auto-seed-rollback contract Phase B must preserve.
- [x] **`tenants /update-config` partial-update safety.** Already implemented — read-then-merge in place (lines 204–207 `body.field !== undefined` check inside the `FOR UPDATE` transaction). Verified 2026-05-28. Standalone small PR.

### P3 — large structural decomposition (defer; medium-high effort, vague-per-finding)

- [ ] Dense-view chunking / shell-continuity `[high]`s — track but don't action piecemeal: `SettingsView` (split owner vs super-admin), `TenantEditPanel` (separate provisioning from AI-config), `CRMView`, `AppointmentView`, `DashboardHome` hierarchy, `CustomerDetailPanel`, `DeletedRecordsPanel`, `RecordHistoryModal`, `NewSchedulerView` / `SchedulerView` orchestration overlap, `ShiftManagementView` changed-vs-saved, `ServiceAssignmentView` / `SkillAssignmentsView` / `SkillMatrixView` completion cues. Several overlap with **C1+C2** (scheduler consolidation) above — sequence with that work.
- [ ] Responsive fallbacks for wide matrices/maps (medium): `SchedulerDateNav`, `ResourceColumnsView`, `SkillRelationshipMap`, `OutlookLayout`.

## Tooling cleanup (remaining ESLint promotions)

Small mechanical hygiene pass completed: cleaned up remaining references to the now-historical NEEDS-REFACTORING.md in source comments (updated to point to RESOLVED.md / REFACTORING_TODO.md for accuracy).

Most of the 2026-05-17 lint adoption already promoted to `error`. Still at `warn`:

- [ ] `@typescript-eslint/no-explicit-any` + `no-unsafe-*` family (~1100 sites — batch-N cleanup ongoing)
- [ ] `@typescript-eslint/no-misused-promises`
- [ ] `@typescript-eslint/await-thenable`
- [ ] `@typescript-eslint/unbound-method` (heavy in tests — may stay warn forever)

Closed: `consistent-type-imports`, `no-unused-vars`, `no-floating-promises`, `require-await`, `restrict-template-expressions`, `no-unnecessary-type-assertion`, `no-base-to-string`, `ban-types`, `prefer-promise-reject-errors` (all promoted to error 2026-05-17/18); Prettier format sweep across all three projects (`79b227c`).

## Documentation

(empty)

---

## E2E Known Issues (Playwright)

These three failures were observed during a full E2E run on **2026-05-27** (after bringing up a fresh `docker compose` Postgres on 5433, running `scripts/rebuild-db.sh --yes`, and starting backend + dashboard in production mode). The run executed 110 tests; 100 passed, 3 failed, 7 skipped. Voice / customer-context flows (the area touched by the recent `shared/voiceCrm.ts` refactor) were all green.

### 1. Booking alignment — List sub-tab popover cancel
- **Location**: `dashboard/e2e/booking-alignment.spec.ts:295`
- **Failure**: "cross-view: appointment popover Cancel works from the List sub-tab and soft-cancels in DB"
- **Symptom**: After clicking Cancel in the AppointmentPopover while viewing the List sub-tab, the subsequent DB state or UI assertions did not match expectations (soft-cancel not reflected, or timing out waiting for the row to update).
- **Related UX note**: See the original raw audit (archived) for AppointmentPopover findings on popover reliability.
- **Reproduction**: Requires a scheduled appointment visible in both Calendar and List views + the popover interaction from the list.

### 2 & 3. Wizard welcome dialog timing (D1/D2 work)
- **Location**:
  - `dashboard/e2e/ui-rename-verification.spec.ts:129` — "Setup Assistant opens welcome → 'Let's go' advances to mode chooser"
  - `dashboard/e2e/ui-rename-verification.spec.ts:167` — "Setup Assistant → welcome 'show me around' exits cleanly (no chooser appears)"
- **Failure**: `expect(page.getByRole('dialog', { name: /welcome/i })).toBeVisible()` timed out (10s).
- **Symptom**: The new `WizardWelcome` dialog (introduced for the first-run guided tour) is not reliably appearing in the DOM in time for the test assertions.
- **Related UX note**: Original raw audit (archived) for WizardWelcome findings on dialog semantics and copy. Tracked under P1 Cluster C.
- **Reproduction**: Run with a fresh tenant or cleared localStorage so the first-run welcome flow triggers.

**Notes & Next Steps**:
- These are **not** regressions from the `shared/voiceCrm.ts` type move (that refactor passed all relevant E2E).
- Strong candidates for the existing "P1 — Add E2E (Playwright) job to CI" item (the comment already calls out "browser install + server startup are the usual flake sources").
- Recommended actions:
  - Add explicit `waitFor` + retry helpers (or `expect.poll`) around the welcome dialog and booking list updates.
  - Consider `test.fixme()` or `test.skip()` on the two wizard tests with links back here until the dialog is moved onto the shared Modal primitive (Cluster C).
  - For the booking cancel test: improve state synchronization between the List view and the soft-cancel DB assertion (possible `waitForResponse` or polling the appointments table).
- Once stabilized, move these bullets to `RESOLVED.md` under the date they are closed.

**New E2E coverage added 2026-05-27**: 
- `customer-notes.spec.ts` (Gap 1) — Internal Notes persistence + visibility. Research surfaced likely latent bug: CRMView sends top-level `notes` on PUT but backend schema drops it.
- `appointment-cancel-ui.spec.ts` (Gap 2) — Cancel from List, Customer history, and popover surfaces (hardened version of the known flake at booking-alignment:295 using response waits + status polling).
- `owner-config-to-booking.spec.ts` (Gap 3) — Owner adds employee + shifts (via expand-weekly) + service/resource, then successfully books against them; plus the sad path of no shifts configured.

Cross-references:
- Original raw UX audit notes (archived; key findings triaged here)
- `docs/TODO.md` → UX audit pass 2 → P1 Cluster C and P2 wizard copy items
- CI section: "P1 — Add E2E job to CI"

---

**Archived detailed history**: See `CURRENT_STATUS_ARCHIVED_2026-05-15.md` for previous session notes and long-form status.
