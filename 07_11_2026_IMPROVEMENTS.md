# Architecture Improvements — 2026-07-11

Derived from the 50,000-foot architectural review. Items are ordered by impact-to-effort ratio.

---

## 1. Split `src/routes/agentTools.ts` into a domain-grouped module (Priority: HIGH) — ✅ DONE 2026-07-11

**Problem:** god file containing 27 tool routes, all Zod schemas, all business logic, utility functions, and test-mode infrastructure. (Stated as 2,998 lines at review time; it was 2,517 by the time the routes were split, because `schemas.ts` + `helpers.ts` had already been extracted.)

**Structure as shipped** (commit `7345943`):

```
src/routes/agentTools/
  index.ts           ← registerAgentToolRoutes() + auth middleware only     (107)
  schemas.ts         ← all Zod schemas                                      (306)
  helpers.ts         ← ok(), fail(), toolRoute(), pgErrorFields(), interval math,
                       + AgentToolDeps (the shared plumbing interface)      (290)
  session.ts         ← tenant-config, voice-session-{start,end,transcript}  (276)
  scheduling.ts      ← service-catalog, check-availability, scheduling-options,
                       available-slots, book-appointment, book-with-scheduling,
                       my-appointments, cancel-appointment, reschedule-appointment  (899)
  identity.ts        ← identify-caller, customer-context, find-customer-by-name,
                       customer-history, save-customer-preference, record-consent,
                       send-verification-code, verify-phone-code            (582)
  knowledge.ts       ← policy-answer                                        (149)
  messaging.ts       ← take-message, page-owner, capture-job-inquiry,
                       send-self-service-link                               (539)
  aiCost.ts          ← record-ai-cost                                       (74)
  _testRoutes.ts     ← /agent-tools/_test/sync-events GET+DELETE            (34)
```

**Deviations from the structure proposed above, and why.** Four routes landed in a different module than this doc planned. The grouping principle used was _"what is this route about?"_ rather than _"what mechanism does it use?"_:

- **`service-catalog` → `scheduling.ts`, not `knowledge.ts`.** It reads the `services` table and exists to answer "what can I book?" — it's the front half of the booking flow, not a RAG surface. `knowledge.ts` is now purely the pgvector/embedding path, which is a genuinely different dependency set (it's the only module needing `getEmbedding` / `expandQueryForEmbedding`).
- **`send-verification-code` + `verify-phone-code` → `identity.ts`, not `messaging.ts`.** The OTP pair sends an SMS, but its _purpose_ is establishing who the caller is and that the number is really theirs. Grouping it with take-message/page-owner would have grouped by transport.
- **`record-consent` → `identity.ts`, not `scheduling.ts`.** It's a fact about the caller, not about a booking.
- **`send-self-service-link` → `messaging.ts`, not `scheduling.ts`.** It doesn't mutate a booking; it's an outbound, consent-gated contact — the same shape as the other three in `messaging.ts`, and the only other consumer of `ConsentService`/`SMSService`.

Net effect on the module boundaries: each file's import list is now tight (`knowledge.ts` is the only one touching embeddings; `messaging.ts` is the only one touching the SMS/consent services), which was the point of the split.

**Steps:**

- [x] Create `src/routes/agentTools/` directory
- [x] Extract schemas block into `schemas.ts`
- [x] Extract helper functions into `helpers.ts` (ok, fail, toolRoute, pgErrorFields, timeToMinutes, dateTimeToMinutes, minutesToTime, mergeIntervals, subtractIntervals, bookingOutcomeFromAgentError, parseOrFail, captureRequestedService)
- [x] Move session routes into `session.ts`
- [x] Move scheduling routes into `scheduling.ts`
- [x] Move identity routes into `identity.ts`
- [x] Move knowledge routes into `knowledge.ts`
- [x] Move messaging routes into `messaging.ts`
- [x] Move aiCost route into `aiCost.ts`
- [x] Move test routes into `_testRoutes.ts`
- [x] Rewrite `index.ts` to import and register all sub-modules
- [x] Update `src/index.ts` import path (`./routes/agentTools` → `./routes/agentTools/index`)
- [x] Verify all tests still pass — 2,345/2,345 ✓, `npm run checks` clean
- [x] Update `CLAUDE.md` "Key Directories" for the new module path (per the note at the bottom of this doc)

**Notes for the next reader:**

- All 27 tool routes + the 2 test routes moved **verbatim** — no behavior change.
- `AgentToolDeps` (in `helpers.ts`) replaced threading five positional args through every module; `index.ts` builds it once and each module destructures only what it needs.
- Test imports needed no changes: they import the directory path (`src/routes/agentTools`), which resolves to `index.ts` under this repo's CommonJS setup. The one exception was `tests/routes/available-slots.test.ts`, which reads the route file **off disk** to assert the route still exists — it now points at `scheduling.ts`. Watch for that pattern if you split another route file.

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

- [x] Audit `src/services/phoneUtils.ts` — identify any backend-only logic (not in `shared/phone.ts`)
- [x] If no backend-only logic: replace `phoneUtils.ts` body with re-exports from `shared/phone.ts`; update all imports
- [x] Audit `src/services/nameUtils.ts` vs `shared/name.ts`
- [x] If no backend-only logic: replace `nameUtils.ts` body with re-exports from `shared/name.ts`; update all imports
- [x] Run `npm run checks` to confirm zero TS errors (`tsc --noEmit` clean ✓)

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
