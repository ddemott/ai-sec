# Test Coverage

**Last refreshed:** 2026-05-10 (+1 E2E: scheduler grid real-time refresh after Quick Book — pins `SchedulerView.handleQuickBooked → useSchedulerData.refresh → render` wiring; closed P1 docs/TODO.md item. Earlier today: closed P1 "Cancel + restore appointment" via new `POST /appointments/:id/reactivate` route — commit `1fb8b11`. +5 backend route tests, +3 dashboard component tests, +3 E2E tests against real DB with self-contained tenant fixtures. Backend 1,770→1,775; dashboard 617→620; E2E 55→59 passing, full sweep clean on weekend after fixing two latent flakes: workflows.spec.ts smoke asserted on seed-customer names visible in TODAY's calendar view (empty on weekends since DynaTire seeds Mon-Fri shifts) — replaced with `scheduler-date-display` check which is unconditional but still proves the build mounted; and quick-book-shift-overrides booking test used `today` for the booking date (failing legitimately on weekends) plus a broken `/shifts/overrides` URL that hit the dashboard's catch-all instead of the backend, silently returning null and forcing auto-assign to land on a non-scheduled employee — fixed by walking to the next weekday and using the absolute backend URL. Test also lacked cleanup (it had been passing by failing); added try/finally with capture-from-response → DELETE. Previous refresh 2026-05-09: security pass 2 + booking-RPC granular-error restoration. Pass 2 closed 3 RLS gaps + AGENT_SECRET timing-safe + rotation. Then closed the 12 pre-existing test failures from migration `20260508000001`: that migration's RPC rewrite accidentally collapsed `NO_SKILLED_EMPLOYEE` / `EMPLOYEE_NOT_SCHEDULED` / `TIMESLOT_OCCUPIED` into a single `NO_AVAILABILITY` return, breaking the agent prompt's per-code messaging. New migration `20260509000002` restores granular diagnostics from `20260401000001` while keeping the new fewest-skills + least-busy assignment policy. Side fixes along the way: 2 tests needed `DELETE FROM resources` after `createTenant` to clear template-auto-seeded resources (random tiebreaker post-2026-05-08 broke the deterministic-resource assertions); 3 crm-appointments tests needed `date_trunc('hour', NOW() + ...)` instead of raw `NOW()` (15-min CHECK constraint from migration `20260508000000` rejects off-grid times); 1 booking-concurrency test needed `Promise.allSettled` + 30s timeout + a defense-in-depth row-count assertion (GiST exclusion deadlocks under 20-concurrent-callers extreme load — data integrity preserved, error code is best-effort). Backend 1,752 → 1,770 (+18 across pass 2 work + concurrency-test hardening). Pass 1 earlier 2026-05-09 shipped webhook signature verification + CRM HMAC bug fix.)

> **Maintenance rule:** Refresh this file whenever a commit measurably moves
> test counts or coverage percentages (added a test suite, deleted a stale
> test, raised coverage by ≥1pp on a hotspot, etc.). Re-run the commands in
> [Regenerating](#regenerating) and update the tables. The numbers go stale
> within a session — a stale table here is worse than no table.

## Headline counts

| Suite | Tests | Status | Runtime |
|---|---|---|---|
| Backend (`npm test`) | 1,775 / 1,775 | ✅ | ~120s |
| Dashboard (`cd dashboard && npm test`) | 620 / 620 | ✅ | ~10s |
| Agent (`cd agent && npm test`) | 85 / 85 | ✅ | ~3s |
| Playwright e2e (`cd dashboard && npx playwright test`) | 59 passed, 7 skipped | ✅ | ~135s |

Total unit tests: 2,387 passing (backend + dashboard) + 85 agent.

> **Note on the 7 skips**: 6 are `calendar-sync.spec.ts` tests that
> require the backend to start with `SYNC_TEST_RECORDER=1`. Without the
> env var, the spec's `beforeEach` skip-guards every test with a clear
> message. Run `SYNC_TEST_RECORDER=1 npm start && cd dashboard && npx
> playwright test` to flip them to passing — total becomes 61 passed,
> 1 skipped. The remaining 1 skip is in `full-functional-audit.spec.ts`
> Voice Calls section, deferred until Telnyx PSTN clears.

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
| `calendar-sync.spec.ts` | appointment lifecycle dispatch | create/update/delete each fire all 5 providers (calendar + 4 CRMs) via `SYNC_TEST_RECORDER` recorder |
| `calendar-sync.spec.ts` | customer lifecycle dispatch | create/update/delete each fire the 4 CRMs (no calendar — by contract) |
| `calendar-sync.spec.ts` | fire-and-forget contract | HTTP returns in <3s even with 5 sync promises in flight |
| `setup-wizard-to-booking.spec.ts` | wizard finalize → first booking | `/register` → seed services/resource/employee → `/shifts/expand-weekly` → `/appointments/create` succeeds |
| `setup-wizard-to-booking.spec.ts` | skip-fan-out sad path | same flow minus expand-weekly → booking returns `EMPLOYEE_NOT_SCHEDULED` |
| `setup-wizard-to-booking.spec.ts` | range coverage | default `weeks_ahead=4` → 28 employee_schedule rows reaching ~27 days out |
| `workflows.spec.ts` | quick book real-time | submit Quick Book → capture `appointment_id` from POST response → assert `[data-testid="appointment-block-${id}"]` visible in grid without page reload |
| `appointment-cancel-restore.spec.ts` | reactivate happy round-trip | seed appt → `/cancel` → DB status='canceled' → `/reactivate` → DB status='scheduled' |
| `appointment-cancel-restore.spec.ts` | slot-rebooked race | cancel A → seed B in A's slot → reactivate A → 409 + TIMESLOT_OCCUPIED + conflict block; A stays canceled, B stays scheduled |
| `appointment-cancel-restore.spec.ts` | not-canceled guard | reactivate on status='scheduled' → 400 + NOT_CANCELED, no UPDATE issued |

### Soft-checked workflows (`if (visible)` guards or `logIssue()`)

`critical-ux-fixes.spec.ts` — toast dismissal, shift validation toast, Quick
Book disabled-state, wizard step-guard, scheduler crash-on-empty, scheduler
stale-empty-state, unsaved-changes Save/Discard banner.

`full-functional-audit.spec.ts` — walks Home, Scheduler, CRM, Calls, Services
& Resources, Staff & Shifts, AI & Knowledge, theme switcher, URL-tab
restoration. Uses `logIssue()` not `expect()` — sections can be broken and
the test still passes.

### Not covered by any e2e

- Voice/AI loop (Telnyx → LiveKit → tools → booking) — covered by `scripts/qa-live-test.py`, not Playwright
- ~~Calendar sync (Google + Outlook OAuth)~~ — orchestration layer covered by `calendar-sync.spec.ts` (2026-05-08); actual outbound HTTP shape still only at unit level
- ~~CRM sync (Jobber / HubSpot / Square / ServiceTitan, bidirectional)~~ — dispatch covered by `calendar-sync.spec.ts`; bidirectional read paths (CRM → us) still uncovered
- ~~Setup wizard end-to-end (8 steps from business-type pick to first booking)~~ — finalize → first-booking path now covered by `setup-wizard-to-booking.spec.ts` (2026-05-08); 8-step UI walkthrough still uncovered, deferred (driving the modal's nested step state through Playwright is heavy for what unit-tests of `useWizardCrud` already cover)
- Stripe billing flow / checkout / webhook
- SMS OTP verification before booking
- Knowledge base upload → chunking → RAG query
- Multi-tenant admin (super-admin tenant switching, "Activate Phone")
- Mobile responsive (Playwright config is desktop chromium only)

## Low-coverage hotspots worth attention

### Backend
| File | Statements | Notes |
|---|---|---|
| `src/services/tenants/index.ts` | 5.05% | `DatabaseTenantConfigService` — flagged as "delete by default" in CLAUDE.md |
| `src/services/communications/TwilioAdapter.ts` | 6.25% | |
| `src/workers/reminderScheduler.ts` | 17.74% | |
| `src/services/reminders/reminderProcessor.ts` | 0% | |
| `src/services/reminders/reminderRepository.ts` | 0% | |

### Dashboard
| File | Statements | Notes |
|---|---|---|
| `components/ui/TimeInput.tsx` | 0% | UI primitive without coverage |
| `lib/logger.ts` | 0% | |
| `lib/policyQuestions.ts` | 0% | |
| `lib/ThemeContext.tsx` | 9.52% | |
| `lib/VocabularyContext.tsx` | 13.04% | |
| `components/ui/Toast.tsx` | 21.87% | |
| `components/ui/FeedbackButton.tsx` | 29.16% | |
| `lib/api.ts` | 39.47% | Many namespaced helpers unexercised |

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
