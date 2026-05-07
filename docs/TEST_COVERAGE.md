# Test Coverage

**Last refreshed:** 2026-05-07 (added coverage-ui-consistency +9 backend; Mark off today +12, CustomerCombobox +11, empty-cell click +9, date-nav chips +5 dashboard)

> **Maintenance rule:** Refresh this file whenever a commit measurably moves
> test counts or coverage percentages (added a test suite, deleted a stale
> test, raised coverage by ≥1pp on a hotspot, etc.). Re-run the commands in
> [Regenerating](#regenerating) and update the tables. The numbers go stale
> within a session — a stale table here is worse than no table.

## Headline counts

| Suite | Tests | Status | Runtime |
|---|---|---|---|
| Backend (`npm test`) | 1,646 / 1,646 | ✅ | ~150s |
| Dashboard (`cd dashboard && npm test`) | 556 / 556 | ✅ | ~30s |
| Playwright e2e (`cd dashboard && npx playwright test`) | 28 passed, 1 skipped | ✅ | ~40s |

Total unit tests: 2,202.

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
- Calendar sync (Google + Outlook OAuth)
- CRM sync (Jobber / HubSpot / Square / ServiceTitan, bidirectional)
- Setup wizard end-to-end (8 steps from business-type pick to first booking)
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
