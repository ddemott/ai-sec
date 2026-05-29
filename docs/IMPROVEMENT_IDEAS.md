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

### Persist KB tab + search to URL query params
**File:** `dashboard/components/KnowledgeBaseView.tsx:396,400`
**Do:** Replace `useState` for `tab` (questionnaire/documents/entries) and `searchTerm` with URL `?tab=` and `?q=` params using the same pattern as other dashboard views (`history.pushState` + `popstate`).
**Done when:** Tab and search survive page refresh; invalid values fall back to questionnaire tab.
**Why:** Multi-step KB workflow — losing context on refresh adds friction; other views already do this.
`small` | impact: `medium`

### Agent: speak filler before slow tool calls
**File:** `agent/src/tools.ts`
**Do:** Before `getAvailableSlots`, `bookAppointment`, and `searchKnowledgeBase` tool calls, emit a short filler utterance (e.g. `"One moment while I check that."`) to cover the up-to-8s silence window. **First verify:** check LiveKit Agents Node SDK for the correct mid-session speech API (not `say()` — look for `session.say()`, `agent.say()`, or equivalent in the LiveKit agent context object passed to tool handlers).
**Done when:** Caller hears a phrase before tool network round-trip; no dead air on slow calls.
**Why:** 8s silence sounds like a dropped call. P3(C) from production hardening backlog.
`small` | impact: `medium`

### Move appointment calendar config to a shared module
**File:** `dashboard/components/AppointmentView.tsx:41-47`
**Do:** Extract the react-big-calendar localizer setup, zoom constants, and `Appointment → CalendarEvent` mapper into `dashboard/lib/appointments/calendarConfig.ts`. Import from there in `AppointmentView`.
**Done when:** `AppointmentView` no longer defines localizer or zoom constants inline; new module exports typed helpers.
**Why:** `AppointmentView.tsx` is already large; config extraction makes it easier to scan.
`small` | impact: `low`

### Normalize skill/service names via `shared/name.ts`
**Files:** `src/routes/skills.ts:63`, `src/routes/services.ts`
**Do:** Replace the inline lowercase + trim normalization in skill and service create/update handlers with `slugify` or a new `normalizeName` export from `shared/name.ts`. Add focused tests for the helper (spacing, casing, special chars).
**Done when:** No inline string normalization in skills/services routes; shared helper has unit tests.
**Why:** `shared/name.ts` already has `slugify` — route-level duplication is unnecessary.
`small` | impact: `low`

### Add skill route tests (delete + not-found)
**File:** `src/routes/skills.ts:45-60` (no dedicated test file)
**Do:** Add tests for: DELETE success, DELETE 404 (out-of-scope or missing), invalid UUID → 400. Mirror the assertion style in `src/routes/resources.test.ts`.
**Done when:** Skill delete happy + sad paths covered; guard behavior locked.
**Why:** Skills has the same destructive behavior as services/resources but no test parity.
`small` | impact: `medium`

---

## Medium (1–3 hr each)

### Extract Super-Admin state into `useSuperAdminTenants` hook
**File:** `dashboard/components/SuperAdminDashboard.tsx:29-260`
**Do:** Move tenant list fetch, selected-tenant init, reorder state, delete modal state, create form state, and save/delete/reorder handlers into `dashboard/lib/useSuperAdminTenants.ts`. Component keeps sidebar + modal rendering only.
**Done when:** Component no longer defines raw API calls inline; `notifyTenantsChanged` still fires after mutations; existing tests pass.
**Why:** Stateful control-center — extracting orchestration makes mutations easier to test and modify safely.
`medium` | impact: `high`

### Appointment mock-mode + super-admin routing tests
**File:** `dashboard/appointment.test.tsx` (extend existing)
**Do:** Add three paths: (1) API failure → mock appointments shown, create blocked; (2) super-admin create routes to selected customer's tenant, not super-admin tenant; (3) `SUPER_ADMIN_TENANT_ID` guard is covered.
**Done when:** All three paths are deterministically covered; existing tests pass.
**Why:** Both branches are easy to regress silently; super-admin routing to wrong tenant would be a data isolation bug.
`medium` | impact: `high`

### VoiceCallsView: extract row subcomponents
**File:** `dashboard/components/VoiceCallsView.tsx:200-342`
**Do:** Extract active-call rows (lines 200-232) and history-call rows (lines 297-342) into `<ActiveCallRow>` and `<HistoryCallRow>` subcomponents. Share one outcome/status badge helper.
**Done when:** Row rendering lives in focused subcomponents; polling updates and selected-row behavior preserved.
**Why:** Dense operational data — consistent row patterns improve scanning; shrinks a large component.
`medium` | impact: `medium`

### Extract knowledge document ingestion into a service
**File:** `src/routes/knowledge.ts`
**Do:** Move PDF/text extraction, normalization, and chunk-preparation logic out of the route into `src/services/knowledgeIngestion.ts`. Route handles HTTP + tenant context; service handles content processing.
**Done when:** `knowledge.ts` route contains no low-level extraction logic; new service has focused tests.
**Why:** Route mixes HTTP concerns with document processing — separation makes both easier to test and debug.
`medium` | impact: `high`

### Analytics feedback access tests
**File:** `src/routes/analytics.ts:97-175` (new or extended test file)
**Do:** Add tests: missing `customer_id` on `/call-summaries` → 400; normal tenant read is tenant-scoped; super-admin read is cross-tenant.
**Done when:** All three access branches explicitly covered; response shape asserted.
**Why:** Branching access logic is easy to regress without pinned tests.
`medium` | impact: `high`

### Billing + provisioning unhappy-path tests
**Files:** `src/routes/billing.ts`, `src/routes/provisioning.ts`
**Do:** Add sad-path route tests: missing Stripe config, missing Telnyx/SIP config, invalid activate payload, conflict states (`active` and `provisioning`), at least one deactivation partial-cleanup warning path.
**Done when:** Critical operational failures are locked with explicit status + body assertions.
**Why:** Business-critical flows with no sad-path coverage — manual checks are not enough for payment + phone setup failures.
`medium` | impact: `high`

### CRM disconnect + sync-status parity tests
**Files:** `src/routes/jobber.ts`, `src/routes/hubspot.ts`, `src/routes/square.ts`
**Do:** Add tests for each provider: disconnect clears integration settings + sync maps; sync-status returns expected aggregate counts and `last_sync_at`. Use one shared assertion shape across all three.
**Done when:** All three providers have disconnect + sync-status coverage; shape differences surface immediately.
**Why:** Parallel providers = parallel drift risk; tests pin parity.
`medium` | impact: `medium`

### CRM route scaffold unification
**Files:** `src/routes/jobber.ts`, `src/routes/hubspot.ts`, `src/routes/square.ts`
**Do:** Extract the repeated auth-start / settings-fetch / disconnect / sync-trigger / sync-status endpoint structure into a shared scaffold. Keep provider-specific clients and sync modules untouched.
**Done when:** Adding a 4th provider reuses the scaffold without copy-pasting boilerplate; existing tests pass.
**Why:** Three parallel implementations of the same shape — any fix currently needs three edits.
`medium` | impact: `high`

### Mapping-route tests (idempotency + tenant scoping)
**File:** `src/routes/mappings.test.ts` (exists, extend)
**Do:** Add: repeated assign is idempotent (ON CONFLICT DO NOTHING → no duplicate rows); unassign succeeds; list returns only rows for active tenant.
**Done when:** Three behaviors locked; shared assertion shape ready for future providers.
**Why:** Small file, central to setup relationships — correctness depends on behavior that's easy to assume without tests.
`medium` | impact: `medium`

### Extract provisioning state machine into a service
**File:** `src/routes/provisioning.ts`
**Do:** Move tenant-fetch, prerequisite checks, phone-status transitions, Telnyx number order/assign/release, and rollback logic into `src/services/provisioningService.ts`. Route maps service results to HTTP responses only.
**Done when:** Route has no orchestration logic inline; service has tests covering activation + rollback paths.
**Why:** Highest-risk operational workflow — isolating the state machine makes it testable without HTTP.
`medium` | impact: `high`

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
