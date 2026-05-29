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
