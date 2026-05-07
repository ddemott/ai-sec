# SecretaryHQ — Resolved Issues Archive

Historical session journals, completed phases, and resolved bug logs. Moved out of `CLAUDE.md` on 2026-05-05 to keep the always-loaded context lean. Newest first.

---

## May 7, 2026 — Front-desk audit punch list complete + coverage consistency + Jest cleanup

Backend 1,637 → 1,646 from the morning (+9 from new coverage-consistency suite). Dashboard 516 → 556 across the day (+3 Quick Book trigger, +12 Mark off today, +11 CustomerCombobox, +9 empty-cell click, +5 date-nav chips). **All six audit punch-list items shipped — every daily-use task now meets the ≤3-decision threshold.** Nine pieces total:

- **Front-desk click-count audit (`docs/sessions/2026-05-07-front-desk-audit.md`).** Read-only walk through the four daily-use tasks for the `front_desk` role shipped 2026-05-05. Found that 3 of 4 daily tasks fail the docs/TODO.md "≤3 decisions" threshold: book a call-in (8+ decisions on the default Calendar path), look up tomorrow (3, borderline), mark someone unavailable (∞ — front_desk role literally cannot do it; `Staff & Shifts` is owner-only), find a customer (2 ✓). Top finding: the dashboard has two parallel scheduler implementations on the Schedule tab (`AppointmentView` calendar default, `NewSchedulerView` staff sub-tab) and Quick Book — the only sane create flow — appears only on Resources/List sub-tabs. Six-item priority punch list in the audit doc; items 1-3 are P0 launch-blockers.
- **Coverage gap detection backend↔UI consistency (`src/coverage-ui-consistency.test.ts`, 9 tests).** Closes the docs/TODO.md "Pre-launch validation" entry. Surfaced a real bug while writing the test: pre-fix, both `StepReview.tsx` and `SoloStepReview.tsx` derived the wizard review badge from `coverage_pct`, and the RPC returns `coverage_pct = 100.0` for the divide-by-zero case (`WHEN sc.open_count > 0 THEN ... ELSE 100.0`). Net effect: a tenant with no employees scheduled saw a green "Full Coverage / You're ready to go!" banner — the worst possible UX on the highest-stakes onboarding step. Fix: extracted `dashboard/lib/coverage.ts` with `statusToBadge(status)` + `isAllCovered(rows)`. Both wizard review components now derive from the backend's 5-state `status` field (mapped to 3 dashboard badges). Edge cases pinned: employee on leave (all `is_off=true`), shift starting before typical business hours (04:00-08:00), day with zero scheduled employees (Sat/Sun in a Mon-Fri shop), service with no qualified employees but other staff on shift, zero-staff tenant.
- **Quick Book hoisted to the Schedule tab toolbar (audit P0 #1).** Pre-fix, the Quick Book button only existed on Resources/List sub-tabs. Front-desk operators landing on the default Calendar view had to switch sub-tabs first, costing two clicks before the form. Fix: consolidated `SchedulerView.tsx`'s three returns into one — Quick Book button now visible in Calendar's toolbar (next to view tabs), Resources/List's toolbar (existing location), and the Staff sub-tab via a new optional `onQuickBook` prop on `NewSchedulerView`. Side benefit: `QuickBookPanel`, `EmployeeDayFocusPanel`, and `AppointmentPopover` now render at the outer level so they're reachable from every sub-tab (previously dead on Calendar + Staff). 3 new regression tests pin the trigger contract. Decision-count for "book a call-in" on the default landing: 8+ → 5.
- **Mark off today action on `StaffProfileCard` (audit P0 #2).** Closes the audit's biggest functional gap: the `front_desk` role literally could not mark someone unavailable without leaving Schedule (the off-day affordance lived only in `Staff & Shifts`, which is owner-only). Fix: optional `onMarkOff` / `markOffLabel` / `isMarkingOff` props on `StaffProfileCard` render a "Mark off today" button below Skills when (a) the parent wires the callback and (b) the employee has a shift on the viewed date. Parent (`NewSchedulerView`) owns the API call, confirm dialog (via existing `useConfirm` + `ConfirmModal`), success/error toast, and scheduler refresh — the card stays presentational. Label adapts: "Mark off today" when viewing today, "Mark off Mon, May 11" otherwise, so the button doesn't lie when the operator is on a different date. Disabled while in-flight to prevent duplicate writes on slow networks. 6 new card unit tests in `dashboard/components/scheduler/StaffProfileCard.test.tsx` pin the contract (button hidden by default, hidden when no shift, label override, click invokes parent, disabled+progress copy while in-flight). 6 new integration tests in `NewSchedulerView.test.tsx` pin the wiring (button visible/hidden based on shift data, confirm copy names employee+day, payload shape matches `Api.shifts.schedule.save({ employee_id, shift_date, is_off: true })`, success path toasts+refreshes+closes the card, save failure surfaces error toast and leaves modal open for retry, Cancel exits cleanly with no API call). Decision-count for "mark someone unavailable" as `front_desk`: ∞ → 3.
- **Searchable customer combobox (audit P0 #3).** `AppointmentDetailPanel` previously rendered every tenant customer in a single 50+-item native `<select>` — Hick's Law violation that the audit cited as the worst affordance on the create-appointment surface. Pre-fix, the only search UI lived inline in `QuickBookPanel.tsx:164-188` (search input filtering a `<select>`); the two surfaces shared the pattern in spirit but not in code. Fix: extracted `dashboard/components/ui/CustomerCombobox.tsx` — search input + filtered native `<select>` with consistent label format (`Name (formatted-phone)`), name + phone-substring filtering, prompt option, optional disabled state, and parent-owned value/onChange. Both `QuickBookPanel` and `AppointmentDetailPanel` now consume it. AppointmentDetailPanel's address pre-fill side effect (look up `findCustomerById` and populate location) is preserved — the parent still owns the side effect, the combobox just delivers the new id. Edge cases handled at the combobox level: customer with no phone (omits parens, no `(undefined)` leak), customer with no name (`(no name)` fallback so the row stays selectable), zero-match search (prompt option remains so the control isn't visibly broken). 11 new unit tests in `CustomerCombobox.test.tsx` (default copy, name filter case-insensitive, phone-substring filter, onChange contract, prompt-clear path, disabled, override copy, formatPhone in labels, no-phone fallback, no-name fallback, zero-match prompt-only). The two surfaces now drift as a compile error if the combobox API changes — replacing two inline implementations with one shared one was the audit's explicit recommendation.
- **Empty-cell click → Quick Book prefilled (audit P1 #4).** Two surfaces shipped together. (1) Staff sub-tab (`NewSchedulerView`) — every empty hour cell on a staff row is now a click target with full keyboard support: `role=button`, `aria-label="Book {employee} at {hour}"`, `tabIndex=0`, cursor pointer + hover tint. Click / Enter / Space delivers `{ employeeId, hour, date }` to `onQuickBook`. Skills mode keeps cells passive (the skill bars cover the row, and a click on a skill is meaningless for booking — a clickable cell there would be a UX trap). Outside-business-hours cells stay clickable so an operator can book a 7am Saturday off-schedule appointment. (2) Calendar sub-tab (`AppointmentView`) — added optional `onSelectSlot?: (range: { start, end }) => void` prop. When wired, BigCalendar runs `selectable=true` and slot click/drag fires the callback; when omitted, the calendar stays read-only on slots (the existing "+" sidebar affordance still creates appointments). Parent (`SchedulerView`) wires both: `handleNewQuickBook` widened from no-args to accept an optional prefill, merging `selectedDate` so cell-supplied date wins for cross-day clicks. The toolbar Quick Book button still calls `handleNewQuickBook()` no-args. 9 new tests in `NewSchedulerView.test.tsx`: click delivers `{employeeId, hour, date}` (the audit's done-signal example verbatim); slot is passive when prop omitted; role/aria-label/tabIndex appear when prop wired; Enter and Space activate; non-activation keys (Tab, ArrowRight, "a") are ignored; skills mode passive; outside-business-hours clickable; toolbar button passes no args.
- **Removed unused Jest from devDependencies (`7658fc5`).** Audit confirmed the entire test stack is Vitest 4.0.18 across all three workspaces; zero Jest API calls anywhere in `src/` / `dashboard/` / `agent/`; zero imports from `jest` or `@jest/*`. Yet root `package.json` declared `"jest": "^30.2.0"` and `"@types/jest": "^30.0.0"` — pure dead weight. Dropped both, refreshed `package-lock.json` (shrank 4,384 lines — jest dragged in 100+ transitive deps including babel runtimes, jest-runtime, alternate jsdom). Kept `@testing-library/jest-dom` (matcher library that works natively with Vitest via `dashboard/tsconfig.json`'s `"types": ["vitest/globals", "@testing-library/jest-dom/vitest"]`). Verified post-install: backend 1,646 + dashboard 551 + agent typecheck all clean.
- **Default Schedule sub-tab flipped to Staff (audit P1 #5).** `SchedulerView.tsx:37` `useState<SchedulerViewTab>('calendar')` → `'staff'`. The Staff sub-tab is the daily-use surface for front-desk operators (rows = staff, hours across, today highlighted, empty cells now click through to Quick Book per P1 #4); making it the landing eliminates the "switch sub-tabs first" friction that the audit flagged on the most-frequent task. Calendar branch's narrative subtitle reworked from "Start with the calendar. Switch to staff or resources only when you need detail" (which positioned itself as the recommended default and contradicted the flip) to neutral descriptive copy: "Month, week, or day view. Click a slot to book." No tests assumed Calendar-as-default; the existing e2e spec was already forward-compatible. Open-question from prior session ("design call on whether to flip given the inconsistent narrative copy") closed by reworking the copy in the same change.
- **Yesterday | Today | Tomorrow date chips (audit P2 #6).** `SchedulerDateNav` now renders three peer chips replacing the single Today button. Each meets WCAG 2.5.5 with `min-w-[48px] min-h-[48px]` (audit specified 48×48 for mobile reliability — tire shop / salon owners check schedules on their phones between customers per the audit theme). `aria-pressed` reflects which chip matches `selectedDate` so screen readers see the toggle state the visual primary-variant cue communicates to sighted users. Outside the today±1 window all three chips show un-pressed state — keeping the chips' job as "click to jump" affordances rather than a date-display widget. ChevronLeft/Right preserved for further-out dates. 5 new tests pin Yesterday/Tomorrow click behavior, aria-pressed truthing under varied selected dates, the touch-target minimums, and the outside-window un-pressed contract.

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
