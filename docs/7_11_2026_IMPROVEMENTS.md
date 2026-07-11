# Architecture Improvements — 2026-07-11

Derived from the 50,000-foot architectural review. Items are ordered by impact-to-effort ratio.

---

## 1. Split `src/routes/agentTools.ts` into a domain-grouped module (Priority: HIGH)

**Problem:** 2,998-line god file containing 27 tool routes, all Zod schemas, all business logic, utility functions, and test-mode infrastructure.

**Target structure:**

```
src/routes/agentTools/
  index.ts           ← registerAgentToolRoutes() + auth middleware only
  schemas.ts         ← all Zod schemas
  helpers.ts         ← ok(), fail(), toolRoute(), pgErrorFields(), interval math utilities
  session.ts         ← voice-session-start, voice-session-end, voice-session-transcript, tenant-config
  scheduling.ts      ← check-availability, available-slots, scheduling-options, book-appointment,
                        book-with-scheduling, cancel-appointment, reschedule-appointment, my-appointments,
                        send-self-service-link, record-sms-consent
  identity.ts        ← identify-caller, customer-context, find-customer-by-name, customer-history,
                        save-customer-preference
  knowledge.ts       ← policy-answer, service-catalog
  messaging.ts       ← take-message, page-owner, capture-job-inquiry,
                        send-verification-code, verify-phone-code
  aiCost.ts          ← record-ai-cost
  _testRoutes.ts     ← /agent-tools/_test/sync-events GET+DELETE (SYNC_TEST_RECORDER-gated)
```

**Steps:**

- [x] Create `src/routes/agentTools/` directory
- [x] Extract schemas block into `schemas.ts`
- [x] Extract helper functions into `helpers.ts` (ok, fail, toolRoute, pgErrorFields, timeToMinutes, dateTimeToMinutes, minutesToTime, mergeIntervals, subtractIntervals, bookingOutcomeFromAgentError, parseOrFail, captureRequestedService)
- [ ] Move session routes into `session.ts`
- [ ] Move scheduling routes into `scheduling.ts`
- [ ] Move identity routes into `identity.ts`
- [ ] Move knowledge routes into `knowledge.ts`
- [ ] Move messaging routes into `messaging.ts`
- [ ] Move aiCost route into `aiCost.ts`
- [ ] Move test routes into `_testRoutes.ts`
- [ ] Rewrite `index.ts` to import and register all sub-modules
- [ ] Update `src/index.ts` import path (`./routes/agentTools` → `./routes/agentTools/index`)
- [ ] Verify all tests still pass (`npm test`)

---

## 2. Move test files out of `src/` into a parallel `tests/` tree (Priority: MEDIUM)

**Problem:** `src/` root contains ~100 test files interleaved with source files, making the source tree hard to navigate. Two distinct test types are mixed: unit tests (`*.test.ts`) and real-DB integration tests (`*.realdb.test.ts`).

**Target structure:**

```
tests/
  routes/            ← mirrors src/routes/ — unit tests
  services/          ← mirrors src/services/ — unit tests
  integration/       ← all *.realdb.test.ts files
  shared/            ← tests for shared/ utilities
```

**Steps:**

- [x] Create `tests/` directory tree mirroring `src/`
- [x] Move all `src/routes/*.test.ts` → `tests/routes/`
- [x] Move all `src/routes/*.realdb.test.ts` → `tests/integration/`
- [x] Move all `src/services/*.test.ts` → `tests/services/`
- [x] Move all `src/services/*.realdb.test.ts` → `tests/integration/`
- [x] Move `src/*.test.ts` (middleware, index, etc.) → `tests/`
- [x] Update `vitest.config.ts` include patterns to point at `tests/`
- [x] Update all relative import paths in moved test files
- [x] Verify all tests still pass (2,345/2,345 ✓)

---

## 3. Extract logic from `src/routes/knowledge.ts` (1,087 lines) into services (Priority: MEDIUM)

**Problem:** RAG pipeline logic (embedding, cosine search, ingestion, website import, suggestion generation, query expansion) lives directly in route handlers rather than in a service layer.

**Steps:**

- [ ] Create `src/services/knowledgePipeline.ts` — extract search/retrieval logic from the `policy-answer` and `explain-answer` route handlers
- [ ] Extract website import orchestration from the import-website route into `knowledgeIngestion.ts` (already exists — extend it)
- [ ] Extract suggestion-generation logic into `src/services/knowledgeSuggestions.ts`
- [ ] Route handlers become: validate → call service → respond (target: ~300 lines for the route file)
- [ ] Verify knowledge-related tests still pass

---

## 4. Extract logic from `src/routes/analytics.ts` (880 lines) into services (Priority: MEDIUM)

**Problem:** Utilization calculation, coverage computation, and heatmap aggregation are inline in route handlers.

**Steps:**

- [ ] Create `src/services/analyticsAggregations.ts` — extract utilization, coverage gap, and first-time-fix calculations
- [ ] Route handlers become thin: validate params → call aggregation service → respond
- [ ] Target: ~300 lines for the route file
- [ ] Verify analytics tests still pass

---

## 5. Organize agent tool definitions by capability group (Priority: MEDIUM-LOW)

**Problem:** `agent/src/tools.ts` defines all 23 tools in a single flat file (~800+ lines). The capability grouping (`'knowledge' | 'messaging' | 'identity' | 'scheduling' | 'verification' | 'transfer'`) is defined but not expressed in the file structure. `agent/src/tools/` exists but only contains `wrapTool.ts`.

**Target structure:**

```
agent/src/tools/
  wrapTool.ts         ← existing
  knowledge.ts        ← get_company_policy_answer, get_service_catalog
  messaging.ts        ← take_message, capture_job_inquiry, page_owner_via_sms,
                         send_verification_code, verify_phone_code, send_self_service_link
  identity.ts         ← get_customer_context, get_detailed_customer_history,
                         find_caller_by_name, identify_caller, save_customer_preference
  scheduling.ts       ← get_available_slots, get_scheduling_options, check_availability,
                         book_appointment, book_with_scheduling, get_my_appointments,
                         cancel_appointment, reschedule_appointment, record_sms_consent
  transfer.ts         ← transfer_call
  index.ts            ← re-exports buildTools(), CAPABILITY_OF, Capability type
```

**Steps:**

- [ ] Create capability-grouped files under `agent/src/tools/`
- [ ] Move tool definitions from `tools.ts` into the appropriate file
- [ ] Rewrite `agent/src/tools.ts` (or rename to `tools/index.ts`) to import from sub-files
- [ ] Verify agent tests still pass (`cd agent && npm test`)

---

## 6. Eliminate duplication between `src/services/phoneUtils.ts` / `nameUtils.ts` and `shared/` (Priority: LOW)

**Problem:** `phone.ts` and `name.ts` live in `shared/` as the canonical cross-runtime implementations, but `src/services/phoneUtils.ts` and `src/services/nameUtils.ts` contain overlapping implementations.

**Steps:**

- [ ] Audit `src/services/phoneUtils.ts` — identify any backend-only logic (not in `shared/phone.ts`)
- [ ] If no backend-only logic: replace `phoneUtils.ts` body with re-exports from `shared/phone.ts`; update all imports
- [ ] Audit `src/services/nameUtils.ts` vs `shared/name.ts`
- [ ] If no backend-only logic: replace `nameUtils.ts` body with re-exports from `shared/name.ts`; update all imports
- [ ] Run `npm run checks` to confirm zero TS errors

---

## 7. Complete the dashboard component migration to subdirectory pattern (Priority: LOW)

**Problem:** `dashboard/components/` has ~50 flat `*View.tsx` files (old pattern) alongside ~20 domain subdirectories (new pattern). Both patterns coexist without resolution.

**Remaining flat files that have a clear domain home:**

- `AppointmentView.tsx`, `AppointmentDetailPanel.tsx`, `AppointmentListSidebar.tsx` → `appointments/`
- `EmployeeManagementView.tsx`, `EmployeeServiceAssignmentView.tsx` → `employees/`
- `SkillAssignmentsView.tsx`, `SkillManagementView.tsx`, `SkillMatrixView.tsx` → `skills/`
- `ResourceManagerView.tsx` → `resources/`
- `VoiceCallsView.tsx` → `voice/`
- `KnowledgeBaseView.tsx`, `KnowledgeSuggestions.tsx`, `ExplainAnswerView.tsx` → `knowledge/`
- `AnalyticsView.tsx`, `UtilizationHeatmap.tsx` → `analytics/`
- `CRMView.tsx`, `CRMIntegrationCard.tsx` → `crm/`
- `BillingView.tsx` → `settings/` or new `billing/`
- `AppShell.tsx`, `OutlookLayout.tsx`, `DashboardHome.tsx` → `layout/`

**Steps:**

- [ ] For each view listed above: `mv` to target subdir, update barrel `index.ts` if present, fix all import paths in `dashboard/app/`
- [ ] Run `cd dashboard && npm test` and `npx playwright test` after each batch
- [ ] Leave `ui/` primitives, `SetupWizard/`, `admin/` as-is (already organized)

---

## 8. Dead CRM schema cleanup (Priority: LOW)

**Problem:** Migrations added Jobber, HubSpot, and ServiceTitan tables/columns (`20260327000000`–`20260327000002`). Those integrations were deleted; `src/services/crm/` only has Square. Dead schema creates confusion and bloat.

**Steps:**

- [ ] Audit which tables/columns from the 2026-03-27 migrations are still referenced anywhere in code
- [ ] If confirmed dead: write a new migration that drops the orphaned tables/columns
- [ ] Update `supabase/baseline.sql` (`npm run db:baseline`)
- [ ] Verify `npm run db:rebuild` succeeds cleanly

---

## 9. Migration chain squash (Priority: LOW — do when convenient, not urgently)

**Problem:** 155 migration files spanning ~5 months (including a 26-file PK-rename batch). Fresh rebuilds replay all 155 sequentially.

**Steps:**

- [ ] Pick a stable cut point (e.g., everything before `20260601`) as the new baseline
- [ ] Run `pg_dump --schema-only` on a DB at that point to produce a new `baseline.sql`
- [ ] Delete the pre-cutpoint migration files
- [ ] Update `scripts/rebuild-db.sh` to apply baseline then remaining migrations
- [ ] Document the squash in `docs/RESOLVED.md`
- [ ] ⚠️ Coordinate timing — any Railway DB that was provisioned before the cutpoint needs a one-time migration state reset

---

## Notes

- Items 1–4 are pure refactors: behavior unchanged, tests must stay green throughout.
- Each item should land as its own PR (no bundling) so CI validates each step independently.
- Item 9 (migration squash) requires DB coordination and should not happen mid-sprint.
- After completing item 1, update `CLAUDE.md` "Key Directories" entry for `agentTools` to reflect the new module path.
