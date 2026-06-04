# Improvement Ideas — Curated Backlog

> **Restructured 2026-05-29.** Items verified against current code; done items moved to Closed section. All remaining items reworded to be bite-size.
>
> **Where things live:**
> - Mechanical/type/naming/convention work → `REFACTORING_TODO.md` (complete)
> - Blocking launch + UX audit pass 2 → `docs/TODO.md`
> - "Would be nice someday" → this file

---

## Quick wins (< 30 min each)


---

## Small (< 1 hr each)

### Agent: speak filler before slow tool calls
**File:** `agent/src/tools.ts`
**Do:** Before `getAvailableSlots`, `bookAppointment`, and `searchKnowledgeBase` tool calls, emit a short filler utterance (e.g. `"One moment while I check that."`) to cover the up-to-8s silence window. **First verify:** check LiveKit Agents Node SDK for the correct mid-session speech API (not `say()` — look for `session.say()`, `agent.say()`, or equivalent in the LiveKit agent context object passed to tool handlers).
**Done when:** Caller hears a phrase before tool network round-trip; no dead air on slow calls.
**Why:** 8s silence sounds like a dropped call. P3(C) from production hardening backlog.
`small` | impact: `medium`

---

## Medium (1–3 hr each)

---

## Large (dedicated session each)

### Finish CRM sync structure extraction
**Files:** `src/services/jobberSync.ts`, `src/services/hubspotSync.ts`, `src/services/squareSync.ts`, `src/services/servicetitanSync.ts`
**Do:** Move these four files into `src/services/crm/` with a shared sync interface. Each file keeps its provider-specific logic; a thin `crm/index.ts` registers providers.
**Done when:** `src/services/` root no longer has flat sync files; `syncOrchestrator.ts` imports from `crm/`.
**Why:** NEEDS-REFACTORING #10 — flat layout makes adding a provider and fixing parity bugs harder than it should be.
`large` | impact: `medium`

### Schedule C1+C2: consolidate 4 sub-views → 2 + unified header
**File:** `dashboard/components/SchedulerView.tsx` (currently 4 sub-views: calendar, staff, resources, list)
**Do:** Merge list into calendar view (Day/Month toggle); merge staff + resources into one Team/Resources view. Unify the three separate sub-view headers into one consistent shell.
**Done when:** Schedule tab has 2 sub-views; single header renders across both; all scheduler E2E tests pass.
**Why:** UX audit C1+C2 — 4 sub-views with 3 different headers is fragmented for a core daily-use screen.
`large` | impact: `high`

### E1: Threaded demo mode (session flag + sample data)
**Do:** Replace the static `/demo` page with a session flag (`isDemoMode`) that injects sample data into the live dashboard. Super-admin can activate demo mode for any tenant; data is read-only and resets on flag clear.
**Done when:** `/demo` route removed; demo mode works within the real dashboard shell; no static page.
**Why:** Static demo page requires maintenance in parallel with real UI — a session-flag approach stays in sync automatically.
`large` | impact: `medium`

### P2.5: Wizard draft state Phase B
**Files:** `dashboard/components/SetupWizard/` (~5K lines across wizard infrastructure)
**Do:** Hold services/resources/employees/shifts/mappings in local state during wizard flow; commit to DB only on Step 7 "Done" click; discard on dismiss. Requires `useWizardCrud.ts` rewrite + `VocabularyProvider` accepting `overrideTemplate` for draft business_type.
**Done when:** No DB writes during wizard navigation; back/dismiss discards all state; `SetupWizard.backToPicker.test.tsx` auto-seed-rollback contract preserved.
**Why:** Phase A fixed visible re-pick bug; Phase B is the principled fix for "data should not be solid until wizard completes."
`large` | impact: `high`

### P3: Dense-view decomposition (multiple sessions)
**Targets:** `SettingsView`, `TenantEditPanel`, `AppointmentView`, `DashboardHome`, `CustomerDetailPanel`, `DeletedRecordsPanel`, `NewSchedulerView`/`SchedulerView` overlap, `ShiftManagementView`, `ServiceAssignmentView`/`SkillAssignmentsView`/`SkillMatrixView`
**Do:** Split each overloaded view into focused sub-components. Sequence with C1+C2 (scheduler consolidation) and Cluster C (Modal primitive migration) to avoid duplicated churn.
**Done when:** Each target view is split with no single file over ~300 lines; existing tests pass.
**Why:** These screens mix rendering, orchestration, and form state — each is a regression risk in a frequently-touched area.
`large` | impact: `high`

---

## Closed / Done

Items confirmed done against current code (2026-05-29):

- **parseDateRange in calendar routes** — calendar.ts has no date-range params (only OAuth code/state). Item was invalid; closed.
- **UUID_RE → requireValidUUID in mappings.ts** — done 2026-05-29. `UUID_RE` deleted; all 4 handlers use `requireValidUUID` from routeHelpers. Tests updated.
- **Batch tenant reorder** — done 2026-05-29. Single `UPDATE … FROM unnest($1::uuid[], $2::int[])` replaces per-row loop. Test updated.
- **CRM auth-init success envelope** — done 2026-05-29. All 4 CRM providers (jobber, hubspot, square, servicetitan) return `{ success: true, authUrl }`. `api.ts` types + `CRMIntegrationCard` updated. Tests updated.
- **KB alert() → toast** — `KnowledgeBaseView.tsx` already uses `showToast()` for delete failures. `alert()` count: 0.
- **Shared Tenant type** — `SuperAdminDashboard.tsx`, `TenantCard.tsx`, `TenantEditPanel.tsx` all import `TenantFull` from `dashboard/lib/types.ts`. No local duplicates.
- **Super-Admin destructive/reorder tests** — `dashboard/superadmin.test.tsx` covers reorder, duplicate-name rejection, and delete confirmation gate.
- **Date-range query parsing (analytics)** — `analytics.ts` already imports and uses `parseDateRange` from `routeHelpers`. *(Calendar routes have no date params.)*
- **Extract Shared Route Guards** — `routeHelpers.ts` already provides `sendValidationError`, `sendNotFound`, `sendSuccess`, `sendConflict`, `assertRowAffected`, `requireValidUUID`, `parseDateRange`, `parsePagination`. Used across route modules.
- **All REFACTORING_TODO.md items** — fully closed 2026-05-27 (see that file).

Items completed 2026-05-29 (this session):

- **Add skill route tests (delete + not-found)** — `src/routes/skills.test.ts` (7 tests): GET list, POST create happy+2 sad, DELETE success, DELETE 404, DELETE 401. Commit `2471d58`.
- **Move appointment calendar config to a shared module** — `dashboard/lib/appointments/calendarConfig.ts` exports `localizer`, `CalendarEvent`, `ZOOM_LEVELS`, `CALENDAR_TIMESLOTS`, `CALENDAR_MIN/MAX/SCROLL_TO`, `toCalendarEvent()`. `AppointmentView.tsx` imports from there. Commit `178f7c3`.
- **Persist KB tab + search to URL query params** — `KnowledgeBaseView.tsx` reads `?tab=` and `?q=` on mount; tab/search changes update URL via `replaceState`; `popstate` listener syncs back/forward. Commit `8122ae1`.
- **Normalize skill/service names via `shared/name.ts`** — `skills.ts` imports `slugify` from `shared/name`; inline `toLowerCase().trim().replace(/\s+/g, '-')` removed. Commit `0e19b58`.
- **Analytics feedback access tests** — `src/analytics.test.ts`: 4 new tests covering `GET /call-summaries` missing param → 400, tenant-scoped query, `GET /feedback` normal tenant scoped, super-admin cross-tenant. Commit `cda0e05`.
- **Billing + provisioning unhappy-path tests** — `src/routes/billing.test.ts` (4 tests), `src/routes/provisioning.test.ts` (7 tests). Activate 503/400/409×2, deactivate partial-cleanup warning → 200+warnings, status happy+404, billing 503+404. Commit `b7b6aaf`.
- **CRM disconnect + sync-status parity tests** — already covered by existing `jobber-routes.test.ts`, `hubspot-routes.test.ts`, `square-routes.test.ts` (verified 2026-05-29).
- **Mapping-route tests (idempotency + tenant scoping)** — already covered in `src/routes/mappings.test.ts` (verified 2026-05-29).
- **Appointment mock-mode + super-admin routing tests** — `dashboard/appointment.test.tsx` extended with 2 super-admin routing tests: create routes to customer's `tenant_id`, guard blocks create with no customer. Commit `84e58d8`.
- **Extract provisioning state machine into a service** — `src/services/provisioningService.ts` (`activatePhone` + `deactivatePhone`); route thinned to validation + switch(result.status); all 5 log events preserved via result union fields. Service tests (6). Commit `3aefcb7`.
- **CRM route scaffold unification** — `src/routes/crmRouteScaffold.ts` handles 6 shared endpoints; all 4 provider files (jobber/hubspot/square/servicetitan) reduced to scaffold call + webhook. Commit `85a8524`.
- **Extract Super-Admin state into `useSuperAdminTenants` hook** — `dashboard/lib/useSuperAdminTenants.ts`; `SuperAdminDashboard.tsx` 490→210 lines. Commit `4f77a64`.
- **Extract knowledge document ingestion into a service** — `src/services/knowledgeIngestion.ts` (extractFileContent, splitIntoChunks, prepareQADocument, validators); `knowledge.ts` route uses service. Service tests (10). Commit `125d6a4`.
- **VoiceCallsView: extract row subcomponents** — `<ActiveCallRow>`, `<HistoryCallRow>`, `<OutcomeBadge>` extracted; inline row JSX removed; OutcomeBadge also used in right-panel detail view. Commit `6d63653`.

## Self-Review — 2026-05-28
**Cycles since last self-review:** 0
**What's working:** The UX backlog is finally back to zero, and the current process correctly treated root `improvement-ideas.md` as retired while continuing to use the canonical root `ux-review-notes.md` for component coverage. The rebuilt UX notes also stayed useful by clustering related views instead of spraying random one-file entries.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions were enough to handle the tricky parts, canonical-file resets, full-path matching, and append-only behavior. The only important live adjustment was following the repo’s own archival note that moved idea work to `docs/IMPROVEMENT_IDEAS.md`.

## Ideas — 2026-05-30 (code patterns)

### Task: Extract reusable URL query state hook for dashboard shallow state
**Status:** proposed
**Files to change:** `dashboard/components/KnowledgeBaseView.tsx:L396-L437`, `dashboard/components/SkillAssignmentsView.tsx:L31-L51`, `dashboard/lib/useUrlQueryState.ts` (new), `dashboard/components/SkillAssignmentsView.test.tsx:L1-L106`
**What to do:** Add a small client-side hook that owns four things currently being hand-written in view components: reading an initial query-param value, validating it against an allowed set, writing updates with `window.history.replaceState`, and reacting to browser `popstate`. Move the `tab` and `q` handling in `KnowledgeBaseView` and the `view` handling in `SkillAssignmentsView` onto that hook instead of each component building its own `URLSearchParams` logic. Keep the hook shallow, string-based, and intentionally limited to URL state, not API state.
**Done when:**
- [ ] `KnowledgeBaseView` no longer contains its own `useSearchParams` + `replaceState` + `popstate` wiring for `tab` and `q`
- [ ] `SkillAssignmentsView` uses the same hook for `view` and still keeps `grid` as the default canonical URL state
- [ ] `SkillAssignmentsView.test.tsx` still passes, and new or updated assertions cover back/forward synchronization through the shared hook
- [ ] All existing tests pass, new tests cover the change
**Why it matters:** This removes duplicated browser-state plumbing from two screens, makes future deep-linkable tabs cheaper to build, and centralizes the tricky `popstate` behavior in one place.
**Tradeoff:** Small abstraction cost up front, plus a little care needed to keep the hook generic without becoming a mini-router.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** About 1-2 hours of straightforward extraction buys back repeated, easy-to-get-wrong URL state code across multiple dashboard shells, so the return is solid.

### Task: Add popstate-safe view persistence to SkillAssignmentsView
**Status:** proposed
**Files to change:** `dashboard/components/SkillAssignmentsView.tsx:L31-L83`, `dashboard/components/SkillAssignmentsView.test.tsx:L1-L106`
**What to do:** Keep the existing `?view=map` deep-link behavior, but make the rendered view stay in sync when navigation changes happen outside the click handler, especially browser back/forward and parent-shell URL rewrites. The simplest path is to drive `view` from the extracted query-state helper instead of a one-time `initialView` snapshot from `useSearchParams()`. Extend the component test file with a case that starts on `?view=map`, rewrites the URL back to grid, dispatches `popstate`, and verifies the rendered marker flips back to Grid.
**Done when:**
- [ ] `SkillAssignmentsView` no longer relies on a one-time `initialView` read for long-lived state
- [ ] A test proves browser back/forward style URL changes update the rendered Grid/Map view
- [ ] Existing toggle and `aria-pressed` tests still pass
- [ ] All existing tests pass, new tests cover the change
**Why it matters:** Right now the toggle is deep-linkable but not fully navigation-safe, which is exactly the sort of subtle shell bug that is annoying to debug later.
**Tradeoff:** Slightly more state wiring and one more test branch for a bug that only shows up during navigation edge cases.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Under an hour of focused cleanup closes a real navigation edge case in a high-traffic admin view, which is a good trade.

### Task: Persist AIInsights sub-tab selection with the shared URL-state helper
**Status:** proposed
**Files to change:** `dashboard/components/AIInsightsView.tsx:L1-L53`, `dashboard/lib/useUrlQueryState.ts` (new), `dashboard/components/AIInsightsView.test.tsx` (new)
**What to do:** Mirror the active `AIInsightsView` sub-tab to a query param such as `?aiTab=persona|knowledge|analytics`, using the same shared hook instead of local `useState` only. Initialize from the URL, preserve the existing default of `persona`, and add a focused component test file that verifies default render, deep-link render, click-to-update URL behavior, and back/forward synchronization. Keep the param scoped so it does not collide with existing `tab`, `subtab`, or `view` usage elsewhere in the dashboard.
**Done when:**
- [ ] Reloading or revisiting the page preserves the selected AI Persona / Knowledge Base / Analytics sub-tab
- [ ] `AIInsightsView` uses validated URL-backed state rather than local-only tab state
- [ ] A new test file covers default, deep-link, click update, and `popstate` sync behavior
- [ ] All existing tests pass, new tests cover the change
**Why it matters:** This brings one more tabbed shell into line with the dashboard’s growing deep-link conventions and makes debugging or sharing exact Phone Assistant states much easier.
**Tradeoff:** Adds one more query param convention to maintain, so naming and validation need to stay disciplined.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** This is a small polish task with moderate day-to-day value, especially once the shared hook exists, so it is worth doing after the extraction.

## Self-Review — 2026-05-30
**Cycles since last self-review:** 1
**What's working:** The UX pass now has full component coverage, and the improvement review was strongest when it stayed narrow, read a small file cluster deeply, and proposed bounded follow-up instead of broad “refactor this” advice.
**What I changed in HEARTBEAT.md:** Added one line telling future runs not to append a status-only UX note once full coverage is complete and no new component files were found.
**Why:** That avoids burning cycles and cluttering `ux-review-notes.md` with empty confirmation entries now that the component backlog is exhausted.

## Ideas — 2026-05-31 (developer experience)

### Task: Extend useFocusTrap to handle outside-dismiss overlays and migrate StaffProfileCard onto it
**Status:** proposed
**Files to change:** `dashboard/lib/useFocusTrap.ts:L1-L79`, `dashboard/components/scheduler/StaffProfileCard.tsx:L1-L106`, `dashboard/components/scheduler/StaffProfileCard.test.tsx:L49-L86`, `dashboard/components/scheduler/scheduler.test.tsx:L694-L729`
**What to do:** Expand `useFocusTrap` so callers can opt into outside-click dismissal in addition to Escape, Tab trapping, focus restore, and optional scroll locking. Then delete the custom `mousedown`/`keydown`/focus-restore effect from `StaffProfileCard` and replace it with the shared hook. Keep the hook small: accept an optional `onInteractOutside` callback or boolean flag, register the outside listener only while open, and preserve the current “do not steal focus if autofocus already landed inside” behavior.
**Done when:**
- [ ] `StaffProfileCard` no longer owns its own focus trap, Escape handler, outside-click wiring, or previous-focus restore effect
- [ ] `useFocusTrap` supports the outside-dismiss case without regressing existing modal/panel callers
- [ ] Existing `StaffProfileCard` keyboard tests still pass, and a test proves outside click still closes the card through the shared hook
- [ ] All existing tests pass, new tests cover the change
**Why it matters:** Overlay accessibility behavior is currently split between one shared hook and one hand-rolled implementation. Pulling the card back onto the common primitive reduces subtle drift and makes future overlay fixes land in one place.
**Tradeoff:** Slightly broadens the hook API, so the abstraction needs discipline to stay overlay-focused instead of growing into a generic event manager.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Roughly 1-2 hours of careful consolidation removes duplicate accessibility plumbing in a high-interaction area, which is a healthy return.

### Task: Extract a shared SchedulerSidePanel shell for right-edge scheduler drawers
**Status:** proposed
**Files to change:** `dashboard/components/scheduler/QuickBookPanel.tsx:L246-L357`, `dashboard/components/scheduler/EmployeeDayFocusPanel.tsx:L55-L168`, `dashboard/components/scheduler/SchedulerSidePanel.tsx` (new), `dashboard/components/scheduler/scheduler.test.tsx:L694-L862`, `dashboard/components/scheduler/QuickBookPanel.test.tsx:L65-L183`
**What to do:** Create a narrow presentational shell for the repeated right-edge scheduler drawer pattern: fixed right positioning, width, border, slide-in animation, header row with title/icon/close action, scrollable body, and optional sticky footer. Move `QuickBookPanel` and `EmployeeDayFocusPanel` onto that shell while leaving their business logic, data shaping, and inner content in place. Pass the panel title, icon, close label, main content, and optional footer as props so both drawers keep their current behavior without carrying duplicated layout chrome.
**Done when:**
- [ ] `QuickBookPanel` and `EmployeeDayFocusPanel` no longer duplicate the outer fixed drawer container and header chrome
- [ ] The new shell supports an optional footer so Quick Book keeps its sticky CTA while Employee Focus remains body-only
- [ ] Existing panel tests still pass with selectors updated only where the shared shell intentionally changes markup
- [ ] All existing tests pass, new tests cover the change
**Why it matters:** These two scheduler drawers already share a lot of shell behavior, and the next overlay tweak will otherwise need to be made twice. A small shell reduces copy-paste churn without forcing the inner flows into the same component.
**Tradeoff:** Adds one more component boundary, and if the shell becomes too opinionated it could fight legitimate differences between quick-book and focus-review workflows.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** About 1-2 hours of extraction should pay back quickly because scheduler overlay polish currently has to be duplicated by hand.

### Task: Move StaffProfileCard action controls onto shared button primitives and tokens
**Status:** proposed
**Files to change:** `dashboard/components/scheduler/StaffProfileCard.tsx:L131-L257`, `dashboard/components/ui/Button.tsx`, `dashboard/components/scheduler/StaffProfileCard.test.tsx:L88-L141`
**What to do:** Replace the card’s custom close button and custom “Mark off” action button with the shared `Button` primitive, adding a small variant or size only if the current primitive truly cannot express the compact icon-close and warning-tinted full-width action. Keep the card’s current copy and behavior, but stop hand-authoring hover, disabled, and font styles inline. If the primitive needs one scheduler-safe warning style, add it centrally instead of leaving this card as a one-off.
**Done when:**
- [ ] The close control and Mark off action in `StaffProfileCard` render through shared button primitives instead of raw `<button>` styling
- [ ] Disabled/loading behavior for the Mark off action still matches current behavior
- [ ] Existing StaffProfileCard tests still pass, with any new assertions covering the primitive-backed disabled and accessible-label behavior
- [ ] All existing tests pass, new tests cover the change
**Why it matters:** This keeps a frequently used scheduler popover aligned with the dashboard’s shared interaction system and cuts one more pocket of bespoke styling that will drift over time.
**Tradeoff:** If `Button` needs a new variant, that adds a little design-surface maintenance to avoid turning the primitive into a catch-all.
**Size:** small (< 1hr)
**Impact:** low
**Effort vs Gain:** Less than an hour of tidy-up removes a bespoke control pair in a high-traffic surface, so the gain is modest but clean.

## Self-Review — 2026-05-31
**Cycles since last self-review:** 0
**What's working:** The UX pass now stays cheap because full coverage can be confirmed with a quick path-count diff, and the improvement pass still produces better output when it sticks to one tight file cluster instead of sampling the whole repo.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current heartbeat instructions already handled the finished UX backlog correctly and still left enough freedom to pivot into a fresh code slice for improvement review.

## Ideas — 2026-06-01 (architecture)

### Task: Split version history routes into focused registrars and shared helpers
**Status:** proposed
**Files to change:** `src/routes/versionHistory.ts:L18-L187`, `src/routes/versionHistory.ts:L198-L520`, `src/routes/versionHistory.ts:L527-L850`, `src/routes/versionHistory/validators.ts` (new), `src/routes/versionHistory/historyRoutes.ts` (new), `src/routes/versionHistory/recoveryRoutes.ts` (new), `src/versionHistory.test.ts:L1-L1188`
**What to do:** Keep `registerVersionHistoryRoutes()` as the public entrypoint, but move the current inline helpers and route blocks into smaller modules grouped by concern. Put shared table validation, body validation, error-response creation, and table metadata in `validators.ts`. Move history, compare, and restore-preview reads into `historyRoutes.ts`. Move restore-fields, restore deleted, copy-fields, and deleted-record listing into `recoveryRoutes.ts`. Have the top-level file compose those registrars so route URLs and behavior stay unchanged. Update `src/versionHistory.test.ts` only as needed to keep imports and route registration pointed at the same public function.
**Done when:**
- [ ] `src/routes/versionHistory.ts` becomes a thin composition file instead of owning every helper and route body inline
- [ ] Shared validation and error-shape code lives in one helper module, not repeated inside route closures
- [ ] Route URLs, payloads, and response shapes remain unchanged
- [ ] All existing tests pass, new tests cover the change
**Why it matters:** The current 850-line route file mixes validation, SQL shaping, recovery logic, and read-only history logic in one place, which makes future fixes risky and keeps the file stuck in any-heavy territory.
**Tradeoff:** This is mostly structural work, so the payoff is maintainability rather than visible user-facing change, and careless extraction could create import churn if the boundaries are not kept simple.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** A couple hours of careful extraction should pay back quickly because this is a dense route cluster with a lot of behavior packed into one file.

### Task: Centralize version-history system-field exclusion by table-aware primary key
**Status:** proposed
**Files to change:** `src/routes/versionHistory.ts:L66-L76`, `src/routes/versionHistory.ts:L795-L816`, `dashboard/components/DeletedRecordsPanel.tsx:L166-L174`, `dashboard/components/RecordHistoryModal.tsx:L428-L440`, `shared/versionHistoryFields.ts` (new), `src/versionHistory.test.ts:L330-L356`
**What to do:** Create one shared helper that returns the non-restorable, non-display system fields for each versioned table, including the real table-specific primary key (`customer_id`, `appointment_id`, `employee_id`, etc.), tenant metadata, and soft-delete audit fields. Use that helper in the backend restore-preview builder and in both dashboard recovery surfaces instead of maintaining three separate exclusion lists that only know about a bare `id` column. Add or update a route test proving restore-preview does not emit the table PK as a selectable field.
**Done when:**
- [ ] Restore preview excludes the table-specific primary key, not just a generic `id`
- [ ] DeletedRecordsPanel and RecordHistoryModal use the same exclusion source instead of local hard-coded arrays
- [ ] No recovery UI shows internal PK or audit-only fields as copy/restore choices
- [ ] All existing tests pass, new tests cover the change
**Why it matters:** Right now the recovery stack duplicates exclusion logic and is out of sync with the project’s renamed PK convention, which makes internal fields more likely to leak into restore or copy workflows.
**Tradeoff:** Shared cross-runtime constants add one more module to keep clean, and the helper needs to stay narrowly scoped so it does not turn into a dumping ground for unrelated field rules.
**Size:** small (< 1hr)
**Impact:** high
**Effort vs Gain:** Under an hour of focused cleanup closes a real correctness gap in a recovery flow, so the return is strong.

### Task: Add a batch restore payload so mixed-version field restores use one request
**Status:** proposed
**Files to change:** `dashboard/components/RecordHistoryModal.tsx:L211-L257`, `dashboard/lib/api.ts:L1043-L1059`, `src/routes/versionHistory.ts:L342-L420`, `src/versionHistory.test.ts:L180-L205`
**What to do:** Replace the modal’s per-version restore loop with a single batch payload that can carry multiple `{ source_version, fields[] }` groups in one submit. Extend the restore-fields route schema to accept either the current single-group shape or a new `restores` array, then execute the grouped restores inside one request-scoped transaction while preserving the existing audit metadata. Update the dashboard API client to send the grouped payload and keep the success response shape stable so the modal can still reload history and close cleanly after one submit.
**Done when:**
- [ ] RecordHistoryModal no longer loops over grouped versions and fires multiple sequential restore requests for one user action
- [ ] The backend accepts and processes a multi-group restore payload in one request
- [ ] Audit metadata (`restored_by`, `change_source`) still applies to every grouped restore
- [ ] All existing tests pass, new tests cover the change
**Why it matters:** The current modal turns one restore action into several network round trips, which is slower, harder to reason about on partial failure, and more likely to leave the UI mid-operation if one request fails after earlier ones succeeded.
**Tradeoff:** The route schema and handler become a little more complex because they need to support grouped work, and test coverage has to be explicit about partial-failure behavior.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** About 1-2 hours of API tightening removes avoidable multi-request restore behavior in a sensitive recovery flow, which is a solid payoff.

## Self-Review — 2026-06-01
**Cycles since last self-review:** 0
**What's working:** The heartbeat process handled a fully complete UX backlog correctly, and the latest improvement ideas stay strongest when they zoom into one subsystem and name exact line ranges instead of proposing broad “clean up version history” work.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions already prevented wasted UX-note churn after full coverage and still pushed this cycle toward concrete, non-duplicate architecture work.
