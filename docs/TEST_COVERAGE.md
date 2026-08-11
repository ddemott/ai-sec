# Test Coverage

**Headline counts last reconciled:** 2026-08-11 to the latest verified suite totals tied to the vertical-preset/block + intake-submission checkpoint — **2,675 backend + 1,031 dashboard + 1,498 agent = 5,204 passing tests**. The **per-file V8 coverage %** + the e2e workflow tables below are still from the **2026-05-22** coverage run and are stale — re-run [Regenerating](#regenerating) before trusting a specific percentage.

**Prior refresh:** 2026-05-22 — Walk-in customer create modal work. Replaced the single "Full name" field in CustomerCombobox with a proper `CustomerCreateModal` (split name, phone, email, address, timezone, internal notes). `name` is now derived from first+last on submit. Dashboard test count: 705 → 716.

**Previous major refresh (2026-05-13):** PK-rename pilot 28 closed the real-DB coverage gap. See `RESOLVED.md` for the full 28-pilot summary (including the 121 follow-up renames, 5 latent bugs surfaced, and the UUID type fixes). Detailed migration and test counts are in RESOLVED.md.

Older refresh history (May 9–12 PK-rename sprint, reminder wiring, security pass 2, etc.) has been consolidated in `RESOLVED.md`.


> **Maintenance rule:** Refresh this file whenever a commit measurably moves
> test counts or coverage percentages (added a test suite, deleted a stale
> test, raised coverage by ≥1pp on a hotspot, etc.). Re-run the commands in
> [Regenerating](#regenerating) and update the tables. The numbers go stale
> within a session — a stale table here is worse than no table.

## Headline counts

| Suite | Tests | Status | Runtime |
|---|---|---|---|
| Backend (`npm test`) | 2,675 passing | ✅ | latest verified full-suite run |
| Dashboard (`cd dashboard && npm test`) | 1,031 passing | ✅ | latest separately verified full-suite run |
| Agent (`cd agent && npm test`) | 1,498 passing | ✅ | latest verified full-suite run |
| Playwright e2e (`cd dashboard && npx playwright test`) | 38 spec files (exact pass/skip count: re-run to verify) | not re-run in this sweep | last known runtime ~175s |
| Targeted backend checkpoint run | 185 passing | ✅ | docs/intake-related verification subset for this checkpoint |

Total latest known verified suite counts: **5,204 passing** (2,675 backend + 1,031 dashboard + 1,498 agent).

> **On skipped e2e tests**: `calendar-sync.spec.ts` tests skip without `SYNC_TEST_RECORDER=1` (set it + restart the backend to run them). One test in `full-functional-audit.spec.ts` (Voice Calls) is deferred until Telnyx PSTN clears. Re-run the suite to get current pass/skip counts.

## Unit test coverage (V8)

| Project | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| Backend (`src/`, `shared/`) | **64.06%** (3,394/5,298) | 56.56% (1,844/3,260) | 67.58% (544/805) | 66.05% (3,238/4,902) |
| Dashboard (`components/`, `lib/`) | **49.01%** (2,505/5,111) | 46.19% (2,011/4,353) | 42.14% (628/1,490) | 51.26% (2,290/4,467) |

HTML reports: `coverage_data/index.html` (backend), `dashboard/coverage/index.html` (dashboard).

## E2E coverage — workflow-based, not percentage-based

E2E tests drive a black-box browser against the running stack; there's no
source instrumentation, so V8/Istanbul percentages don't apply without a
purpose-built coverage build. Track e2e by **workflows covered** instead.

### Hard-asserted workflows (fail loud on regression)

| File | Workflow | Surface exercised |
|---|---|---|
| `workflows.spec.ts` | smoke | Login → tab nav → Schedule → seeded appts |
| `workflows.spec.ts` | quick book | UI form → POST `/appointments` → GiST exclusion check → DB row |
| `workflows.spec.ts` | edit appointment | UI list visibility + PUT `/appointments/:id/update` (happy + sad) |
| `workflows.spec.ts` | create customer | POST `/customers/create` → list refresh → DB row |
| `workflows.spec.ts` | front-desk role gating | Login as `front_desk` → Advanced tabs hidden |
| `workflows.spec.ts` | invite teammate | Owner-only POST `/users/invite` → user + password_resets row |
| `quick-book-shift-overrides.spec.ts` | book against `employee_schedule` | shift override, no weekly pattern |
| `quick-book-shift-overrides.spec.ts` | validator: end ≤ start | rejected |
| `quick-book-shift-overrides.spec.ts` | validator: 23-hour appointment | rejected |
| `quick-book-shift-overrides.spec.ts` | resources/chairs view | renders rows |
| `calendar-sync.spec.ts` | appointment lifecycle dispatch | create/update/delete each fire calendar + Square via `SYNC_TEST_RECORDER` recorder |
| `calendar-sync.spec.ts` | customer lifecycle dispatch | create/update/delete each fire Square (no calendar — by contract) |
| `calendar-sync.spec.ts` | fire-and-forget contract | HTTP returns in <3s even with sync promises in flight |
| `setup-wizard-to-booking.spec.ts` | wizard finalize → first booking | `/register` → seed services/resource/employee → `/shifts/expand-weekly` → `/appointments/create` succeeds |
| `setup-wizard-to-booking.spec.ts` | skip-fan-out sad path | same flow minus expand-weekly → booking returns `EMPLOYEE_NOT_SCHEDULED` |
| `setup-wizard-to-booking.spec.ts` | range coverage | default `weeks_ahead=4` → 28 employee_schedule rows reaching ~27 days out |
| `workflows.spec.ts` | quick book real-time | submit Quick Book → capture `appointment_id` from POST response → assert `[data-testid="appointment-block-${id}"]` visible in grid without page reload |
| `appointment-cancel-restore.spec.ts` | reactivate happy round-trip | seed appt → `/cancel` → DB status='canceled' → `/reactivate` → DB status='scheduled' |
| `appointment-cancel-restore.spec.ts` | slot-rebooked race | cancel A → seed B in A's slot → reactivate A → 409 + TIMESLOT_OCCUPIED + conflict block; A stays canceled, B stays scheduled |
| `appointment-cancel-restore.spec.ts` | not-canceled guard | reactivate on status='scheduled' → 400 + NOT_CANCELED, no UPDATE issued |
| `mobile-responsive.spec.ts` | mobile schedule (iPhone 14) | 390×844 viewport → mobile nav renders → Schedule tab → scheduler-view + date display visible, no horizontal overflow |
| `mobile-responsive.spec.ts` | mobile quick book (iPhone 14) | Resources sub-view → Quick Book panel + customer/resource/confirm inputs visible, no overflow |
| `mobile-responsive.spec.ts` | mobile customer lookup (iPhone 14) | Customers tab → seeded customer name visible in list, no overflow |
| `mobile-responsive.spec.ts` | Android smoke (Pixel 7) | 412×915 viewport → mobile nav → Schedule reachable, no overflow (catches breakpoint-specific regressions iPhone width misses) |
| `tenant-delete-cascade.spec.ts` | full cascade | super-admin DELETE /tenants/:id → every dependent row count drops to 0 across 11 tenant-scoped tables (users / services / resources / employees / customers / employee_schedule / appointments / mappings / audit_log / record_versions) |
| `tenant-delete-cascade.spec.ts` | cross-tenant isolation | deleting tenant A leaves tenant B's row counts unchanged — cascade is scoped to the deleted tenant_id, not a schema-wide DELETE |
| `tenant-delete-cascade.spec.ts` | authz | tenant owner token cannot delete its own tenant → 403, tenant row + dependents untouched (gate fires before any SQL) |
| `version-history-restore.spec.ts` | soft-delete → restore round-trip | create customer → `/soft-delete` → filtered from `/customers` + appears in `/records/customers/deleted` → `/restore` → back in active list + gone from deleted list |
| `version-history-restore.spec.ts` | restore non-deleted | `/restore` on a record that was never deleted → 404 + `RECORD_NOT_DELETED`; record state unchanged |
| `version-history-restore.spec.ts` | invalid table whitelist | `/restore` against `foobar` or `tenants` → 400 + `INVALID_TABLE`; pins the SQL-injection-defense boundary on the route's inlined table name |

### Soft-checked workflows (`if (visible)` guards or `logIssue()`)

`critical-ux-fixes.spec.ts` — toast dismissal, shift validation toast, Quick
Book disabled-state, wizard step-guard, scheduler crash-on-empty, scheduler
stale-empty-state, unsaved-changes Save/Discard banner.

`full-functional-audit.spec.ts` — walks Home, Scheduler, CRM, Calls, Services
& Resources, My Team, Phone Assistant, theme switcher, URL-tab
restoration. Uses `logIssue()` not `expect()` — sections can be broken and
the test still passes.

### Not covered by any e2e

- Voice/AI loop (Telnyx → LiveKit → tools → booking) — covered by `./scripts/simulate.sh tools` (on-demand system harness), not Playwright
- ~~Calendar sync (Google + Outlook OAuth)~~ — orchestration layer covered by `calendar-sync.spec.ts` (2026-05-08); actual outbound HTTP shape still only at unit level
- ~~CRM sync (Square, bidirectional)~~ — dispatch (us → Square) covered by `calendar-sync.spec.ts`; bidirectional read path (Square → us) still uncovered. (The Jobber / HubSpot / ServiceTitan integrations were removed 2026-06-12.)
- ~~Setup wizard end-to-end (8 steps from business-type pick to first booking)~~ — finalize → first-booking path now covered by `setup-wizard-to-booking.spec.ts` (2026-05-08); 8-step UI walkthrough still uncovered, deferred (driving the modal's nested step state through Playwright is heavy for what unit-tests of `useWizardCrud` already cover)
- Stripe billing flow / checkout / webhook
- SMS OTP verification before booking
- Knowledge base upload → chunking → RAG query
- Multi-tenant admin (super-admin tenant switching, "Activate Phone")
- ~~Mobile responsive~~ — automated audit added 2026-05-11 (`mobile-responsive.spec.ts`, iPhone 14 + Pixel 7 viewports via `page.setViewportSize`). Real-device verification on iOS Safari + Android Chrome still recommended pre-beta for touch + virtual-keyboard behaviors Playwright Chromium can't fully emulate.

## Low-coverage hotspots worth attention

### Backend
| File | Statements | Notes |
|---|---|---|
| `src/services/tenants/index.ts` | 5.05% | `DatabaseTenantConfigService` — flagged as "delete by default" in CLAUDE.md |
| (removed) | src/services/communications/ legacy adapter files | Full removal of legacy SMS provider fallback (2026-06) |
| `src/workers/reminderScheduler.ts` | 17.74% | |
| `src/services/reminders/reminderProcessor.ts` | 0% | |
| `src/services/reminders/reminderRepository.ts` | 0% | |

### Dashboard
| File | Statements | Notes |
|---|---|---|
| `lib/policyQuestions.ts` | 0% | Pure re-export shim — no logic to test |
| `lib/api.ts` | 39.47% | Many namespaced helpers unexercised |
| `components/ui/TimeInput.tsx` | ~100% | Added 2026-07-07 (10 tests) |
| `lib/logger.ts` | ~100% | Added 2026-07-07 (7 tests) |
| `lib/ThemeContext.tsx` | ~90%+ | Added 2026-07-07 (10 tests) |
| `lib/VocabularyContext.tsx` | ~90%+ | Added 2026-07-07 (8 tests) |
| `components/ui/Toast.tsx` | ~90%+ | Added 2026-07-07 (13 tests total: 4 existing + 9 new) |
| `components/ui/FeedbackButton.tsx` | ~90%+ | Added 2026-07-07 (11 tests) |
| `lib/coverage.ts` | ~100% | Added 2026-07-07 (10 tests — critical 'closed'→'uncovered' branch) |
| `components/VersionBadge.tsx` | ~90%+ | Added 2026-07-07 (5 tests — env-var gate, ISO-slice format) |
| `components/SkillManagementView.tsx` | ~80%+ | Added 2026-07-07 (11 tests — create/delete/loading states) |
| `components/BillingView.tsx` | ~75%+ | Added 2026-07-07 (14 tests — plan display/checkout/portal) |
| `components/KnowledgeSuggestions.tsx` | ~85%+ | Added 2026-07-07 (12 tests — approve/reject/error paths) |
| `components/voice/MessagesInbox.tsx` | ~80%+ | Added 2026-07-07 (14 tests — filter/select/mark-read/actioned) |
| `components/CRMIntegrationCard.tsx` | ~80%+ | Added 2026-07-07 (15 tests — connect/disconnect/sync/status) |

## Regenerating

```bash
# Backend coverage (~90s, requires Postgres + test_db migrated)
npx vitest run --coverage

# Dashboard coverage (~30s)
cd dashboard && npx vitest run --coverage

# Playwright e2e count (requires servers running on :4000 + :4001 + Postgres)
cd dashboard && npx playwright test
```

After running, paste the new totals into the tables above and bump the
"Last refreshed" date. Per-file breakdowns are in the HTML reports — only
copy a file into the hotspots table if it materially moved.
