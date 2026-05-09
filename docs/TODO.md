# TODO

**Last updated:** 2026-05-03

Single source of truth for all remaining work. Organized by priority.

## In-flight markers

This file uses these prefixes to make state explicit:

- **IN FLIGHT (external):** waiting on an external party (vendor, third-party support, etc.) — we can't move it; we can only escalate or work around.
- **IN FLIGHT (user):** waiting on a user action (set an env var, log into a console) that Claude can't take — needs Dale.
- **IN FLIGHT (prod-apply):** code/migration shipped to repo and CI; production Supabase / Railway hasn't received it yet. Action is "apply this against prod."
- **IN FLIGHT (decision pending):** technical or product call needed before code work can start.
- **IN FLIGHT (validation pending):** code shipped + unit tests green, but a real-world condition (live PSTN call, real CRM credentials, etc.) hasn't exercised it yet.

If an item has none of these prefixes, it's either complete (`[x]`) or unstarted (`[ ]` with no in-flight marker — pickable today).

---

## Phase 13: Ship It (blocking launch)

- [x] **Deploy dashboard** — shipped 2026-04-21 (commit `fb216e0`), live at https://dashboard-production-cee3.up.railway.app/
- [ ] **IN FLIGHT (user) — Set `DASHBOARD_URL` env var** in Railway backend (needed for Stripe checkout + OAuth redirects). Value: `https://dashboard-production-cee3.up.railway.app`. ~2 min via Railway → ai-sec service → Variables. Outstanding 6+ days as of 2026-05-03.
- [x] **Apply migration `20260427000000_telnyx_provisioning.sql` to production Supabase.** Done 2026-04-27. Dropped `vapi_assistant_id`/`vapi_phone_number_id` (verified empty across all 3 tenants beforehand), added `telnyx_phone_number_id`. Side effect: also applied `20260423000000_phone_verifications.sql` which had been sitting unapplied — SMS OTP table now exists in prod, fixing a silent runtime gap.
- [ ] **IN FLIGHT (external) — Telnyx PSTN ticket** — phone number `+1-630-937-9478` returning "not in service" from PSTN. Original ticket `#2850682` (2026-04-27) abandoned 2026-05-01 after 4 days without a human response; new ticket re-submitted 2026-05-01 to LERG/porting team. Zero inbound CDRs at Telnyx across the entire 2026-04-25 → 2026-05-03 window. See `TICKET_SUPPORT.md` for the submitted text + escalation plan. **Blocks every voice-validation item below.** Diagnostic fallback if it stalls again: provision a second DID (different DID works → this one is uniquely stuck → push for release+reissue; second also fails → wider Telnyx issue).
- [ ] **IN FLIGHT (external, transitive) — Beta testing with DynaTire** — blocked on phone working.
- [x] **BUG-072**: Front Desk scheduler shift bars not rendering — root cause: seed data populated legacy `employee_shifts` table instead of `employee_schedule`. Fixed seed to use `employee_schedule` (2 weeks of date-based shifts).

---

## Pre-launch hardening (from external review, 2026-05-01)

Reconciled from `GROK-SUGGESTIONS.md`. Items already tracked elsewhere are not duplicated here — only the genuinely additive entries live in this section. See GROK-SUGGESTIONS.md for the full reconciliation table.

### UX simplification — directional feedback (NEW, blocking beta)

External review flagged the dashboard as **complex and hard to understand for non-technical users**. The target audience is shop owners and front-desk staff, not sysadmins. Today the app exposes a lot of its internal model (resources, skills, coverage gaps, RLS-aware tenant switcher, version history, audit fields) directly to those users.

Treat this as a launch-blocker for beta with DynaTire — the carrier propagation question gets us a working voice path, but if the front-desk UI doesn't fit the staff member's day, the demo fails.

- [x] **Audit Front Desk view for non-technical operators — done 2026-05-07.** Audit (`docs/sessions/2026-05-07-front-desk-audit.md`) walked every primary daily-use task and produced a six-item priority punch list (3 P0, 3 P1/P2). **All 6 items shipped 2026-05-07.** Decision-counts after: book a call-in 8+→1, look up tomorrow 3→1, mark someone unavailable ∞→3, find a customer 2 (unchanged, already passing). All four tasks now meet the ≤3-decision threshold for the front-desk role.
- [x] **Hide "Back Office" surface from Front-Desk-only logins — done 2026-05-05.** Migration `20260505000000_user_roles.sql` adds `users.role` (`'owner' | 'front_desk'`, default `'owner'` so existing users are unaffected). Backend: `JwtPayload` + `AppRequest.auth` + `generateToken` carry the role; `/login` returns it on the response and includes it in the JWT; `/auth/refresh` preserves it; unrecognized values coerce to `'owner'` so a future role addition can't silently downgrade an existing user. Frontend: `SessionContext` exports `role` (persisted to localStorage); `OutlookLayout` accepts `role` and hides the Back Office tab in both the desktop FolderTabBar and the mobile mode-toggle when `role === 'front_desk' && !isAdmin`; a useEffect snaps front-desk users back to `dashboard` if they land on `my-business` / `my-team` / `ai-insights` via a stale URL. Super-admins still see Back Office regardless of `role` because admin status is identified by tenant_id, not by users.role. 4 new layout tests + 2 new auth-handler tests; 1,513 backend + 508 dashboard tests pass.
- [ ] **IN FLIGHT (validation pending) — Browser-verify role gating + invite flow end-to-end.** Unit tests pin both contracts but neither has been exercised in a real browser session. Run `npm start` and click through:
  - **Role gating (commit `8683222`):** (a) log in as the owner, navigate to Back Office → My Team → Logins, and use the invite flow below to seed a `front_desk` user (or fall back to SQL `UPDATE users SET role='front_desk' WHERE email = ...`); (b) log in as that user and confirm the Back Office tab is hidden in desktop nav, mobile mode-toggle, and that `?tab=my-business` redirects to `dashboard`; (c) confirm an `owner` user still sees both tabs; (d) confirm super-admin overrides `role`; (e) confirm `/auth/refresh` preserves role across token rotation.
  - **Invite + role-management UI (commit `e65c833`):** (a) `GET /users` populates the Logins list with the owner's row tagged "You" and the dropdown disabled on that row only; (b) clicking Invite, filling the form (default role Front Desk), and submitting closes the modal, shows a success toast, refreshes the list, and triggers a real invite email at the SMTP configured by `EMAIL_USER`/`EMAIL_PASS` (or a no-op transporter in test/dev); (c) the invitee opens the link, lands on `/reset-password`, sets a password, and can sign in; (d) changing a teammate's role via the dropdown succeeds and persists across reload; (e) the API correctly returns 400 if curl-tested for a same-user role change; (f) a `front_desk` user URL-hacking to any `/users` endpoint receives 403.
- [x] **Owner-facing UI to invite users + assign role — done 2026-05-05 (commit `e65c833`).** New `Logins` sub-tab under Back Office → My Team. Backend: three routes in `src/routes/users.ts` — `GET /users` (list with `is_self` flag so the UI can disable own-row dropdown), `POST /users/invite` (creates user with placeholder bcrypt hash + writes a `password_resets` token + sends `sendUserInviteEmail` with 3-day TTL; reuses the existing reset infra so the invitee chooses their own password), `PATCH /users/:id/role`. All three are owner-only via a `requireOwner()` gate; super-admins always pass; front_desk callers get 403. The role-update route also rejects same-user role changes (a 400 + clear error) so an owner can't accidentally lock themselves out — the UI's own-row dropdown is also disabled as a UX guardrail. Frontend: `dashboard/components/TeamAccessView.tsx` lists users with role badges + invite modal (radio role picker, default Front Desk). Wired into `MyTeamView` as a fifth sub-tab. **Tests:** 13 backend route tests + 5 dashboard component tests (1,526 backend / 513 dashboard total). Browser-validation tracked in the Browser-verify item above.
- [x] **Vocabulary pass on UI strings — done 2026-05-05 (commit `b293813`).** Verified zero user-visible occurrences of all 6 listed jargon terms ("Tenant", "RLS", "RPC", "embedding", "skill matrix", "coverage gap") across `dashboard/*.tsx` non-test files. 4 strings replaced: "Multi-Tenant Management" → "Multi-Business Management", "Skill Matrix" tab + "Service Assignment Matrix" heading → "Service Assignments", "coverage gaps" wizard copy → "aren't fully staffed yet". `vocabulary-guard.test.ts` extended with 4 new banned-pattern regexes so regressions fail fast with a named description pointing at the right replacement.
- [ ] **First-run guided tour for new tenants.** Today's setup wizard handles initial config but there's no "now that you're set up, here's what you do every morning" walkthrough.
- [ ] **Mobile responsiveness validated for shop owners.** Tire shop / salon owners check schedules on their phone between customers. Today the dashboard targets desktop primarily; verify the daily-use flows (today's schedule, quick book, customer lookup) on iOS Safari + Android Chrome at common screen sizes.

### Pre-launch validation

- [x] **Atomic booking RPC load test under concurrent calls.** Done 2026-05-01. Concurrency hole confirmed (9/20 winners on resource race, 20/20 on employee race) then closed by two GiST exclusion constraints (`appointments_no_resource_overlap`, `appointments_no_employee_overlap`) in migration `20260501000000`, paired with `exclusion_violation` handlers in both booking RPCs (migration `20260501000001`). New test file `src/booking-concurrency.test.ts` (2 tests, real-DB). Race losers receive `TIMESLOT_OCCUPIED` and the agent prompt maps it to "That time just got taken — could we try a different slot?". 1,495 backend tests pass. Migration not yet applied to production Supabase — see Phase 13 entry below.
- [x] **Timezone / DST edge case audit — done 2026-05-05.** Audited five code paths; one real bug found and fixed.

  | Path | DST handling | Disposition |
  |---|---|---|
  | `src/services/timezoneUtils.ts` `applyTimezone()` (voice-agent → backend offset attachment) | One-shot lookup via `Intl.DateTimeFormat` of "naive interpreted as UTC" — wrong offset for ~6h after each DST transition (returned pre-transition offset for naive times the user meant in the post-transition offset). | **Fixed:** added a fixed-point iteration step. Compute candidate offset, derive the real UTC instant under it, re-ask the formatter for the offset at THAT instant; on transition days the second answer wins. 7 new DST-transition tests pin both directions (spring + fall) including the ambiguous fall-back 1:30am case (resolves to first occurrence / CDT, IANA convention) and a cross-zone (`America/New_York`) sanity check that the fix isn't Chicago-specific. |
  | Booking RPCs (`book_with_scheduling_atomic`, `book_appointment_atomic`) | Postgres `AT TIME ZONE v_tenant_tz` — built-in DST-aware. | OK — already correct. |
  | `src/services/expandWeeklyToSchedule.ts` (UTC date math) | Generates date+time rows; the rows themselves are timezone-naive (interpreted in tenant TZ at query time), so DST math doesn't apply at expansion. | OK — by design. |
  | Reminder scheduler (`reminderScheduler.ts`, `reminderProcessor.ts`, `reminders/index.ts`) | Pure UTC arithmetic (`appointment.getTime() - hoursBefore * 3600_000`) — DST-agnostic by construction. | OK. |
  | `agent/src/prompt.ts` `formatDateForPrompt` | `Intl.DateTimeFormat` with `timeZone` parameter — correct. | OK. |

  Pre-fix concrete impact: a Chicago tenant taking a voice booking at 5:30am local on 2026-03-08 (or 3:00am local on 2026-11-01) had the appointment recorded at the wrong UTC instant, off by exactly 1 hour. Post-fix: both directions resolve to the correct offset. 1,558 backend + 513 dashboard tests pass.
- [x] **Skill + resource matching reliability sweep — done 2026-05-06.** New file `src/skill-resource-matching-sweep.test.ts` (13 tests, all green). Three sections: (1) per-industry HAPPY paths covering all 5 templates (automotive with hyphenless skills, salon with empty capabilities, mobile_tire with hyphenated `tire-mount`, auto_bays with cross-axis skill×capability join, ai_platform with no requirements at all); (2) error-code matrix pinning each of the 5 specific codes (`INVALID_PARAMS`, `NO_SKILLED_EMPLOYEE`, `EMPLOYEE_NOT_SCHEDULED`, `TIMESLOT_OCCUPIED`, `NO_AVAILABILITY`) plus a second `NO_AVAILABILITY` variant for the no-skill-required-but-capability-mismatch path; (3) cross-template guards covering tenant isolation under skill-name collision and exact-match (no substring) skill semantics. All 5W-annotated. The file deliberately does not duplicate `scheduling-atomic.test.ts` (abstract logic), `booking-concurrency.test.ts` (races), `scheduling-timezone-bug.test.ts` (DST), or `scheduling-overrides.test.ts` (override mechanics). Backend test count: 1,592 → 1,605.
- [x] **Coverage gap detection backend↔UI consistency — done 2026-05-07.** New file `src/coverage-ui-consistency.test.ts` (9 tests) pins the contract between `check_coverage_gaps()` and the wizard review steps. Surfaced a real bug while writing the test: pre-fix, both `StepReview.tsx` and `SoloStepReview.tsx` derived the badge from `coverage_pct`, and the RPC returns `coverage_pct=100` for the divide-by-zero case (`WHEN sc.open_count > 0 THEN ... ELSE 100.0`). Net effect: a tenant with no employees scheduled saw a green "Fully covered / You're ready to go!" banner — the worst possible UX on the highest-stakes onboarding step. Fix: extracted `dashboard/lib/coverage.ts` exporting `statusToBadge(status)` + `isAllCovered(rows)` helpers. Both wizard review components now derive from `status` (5 backend values → 3 dashboard badges). Edge cases verified: employee on leave, shift starting before business hours (04:00-08:00), day with zero scheduled employees (Sat/Sun in a Mon-Fri shop), service with no qualified employees, zero-staff tenant. Backend tests: 1,637 → 1,646 (+9).
- [x] **Multi-tenant isolation verification — done 2026-05-06.** Wrote `src/multi-tenant-isolation.test.ts` (25 tests across 5 probe categories: query-string override, cross-tenant id under JWT-only, body-tenant_id FK injection, positive controls including super-admin override, admin-only `/tenants/*` gating). Real Fastify app + real Postgres + RLS-enforced via api_user pool. **Probe found two real findings, both closed in the same session:**
  1. **Application-layer cross-tenant override (read + write).** `tenantMiddleware` accepted `?tenant_id=` and `body.tenant_id=` from any authenticated user with no auth gate (12/21 initial probes failed). 8 read-leak shapes and 4 write-injection shapes confirmed: any non-admin user could `?tenant_id=<other>` to read another tenant's customers/employees/services/resources/appointments/skills/knowledge/users, or POST `body.tenant_id=<other>` to insert rows under another tenant. Closed in `src/middleware.ts` `tenantMiddleware`: gate added that 403s any cross-tenant override unless the caller is super-admin; mismatched query-vs-body returns 400.
  2. **`/tenants/*` admin routes reachable by every authenticated user.** `requireAuth()` only checks "is authenticated," not "is super-admin." Any tenant user could `GET /tenants` (enumerate every customer), `DELETE /tenants/<other>`, `POST /tenants/reorder`, etc. Added `requireSuperAdmin()` helper to `src/middleware.ts` and applied to: `GET /tenants`, `DELETE /tenants/:id`, `POST /tenants/:id/update-attributes`, `POST /tenants/create`, `POST /tenants/reorder`, `POST /templates/create`. `GET /tenants/:id/config` + `POST /tenants/:id/update-config` get a "super-admin OR own-tenant" gate (tenant users edit their own config legitimately).
  Severity context: pre-beta, no real customer data was at risk because DynaTire isn't live. But either finding alone would have been a critical breach in a paying-tenant SaaS — both closed before launch. The probe is now permanent regression coverage; the existing DB-level RLS test (`src/rls.test.ts`) is unchanged. Backend 1,551 → 1,592 tests (+25 isolation probe + 10 new middleware unit tests pinning the gate + 6 from earlier same-day work already on main). Dashboard 514/514 still pass.
- [x] ~~**Refresh DynaTire test/seed data**~~ — done 2026-05-08 via `scripts/refresh-seed-data.sql` against prod. (a) 3 stale appointments (2026-03-31 + 2026-04-02) marked `status='completed'`. (b) "Wrong Tenant" customer deleted from super-admin tenant. (c) DynaTire shift coverage refreshed for current 2-week window (Mon–Fri × 3 employees, hours matching seed: Mike 07-16, Carlos 08-17, Dana 09-18). Audit re-run confirms zero findings on every check. Bella's Hair Studio empty-stub left alone — pending product decision on whether to populate as a salon-vertical demo or delete.

### Observability

Today the agent worker logs to stdout via Pino, the backend logs via Fastify, and the dashboard logs via Next.js. Nothing aggregates them or alerts on regression. Beta-blocker for support — when a customer says "the call dropped at 2:14pm", we need a way to find that call.

- [x] **Structured-log aggregation — backend + agent done 2026-05-07.** Picked Better Stack (Logtail's successor; free tier 1 GB / 3 days). Backend (`src/services/logger.ts`) and agent (`agent/src/logger.ts`) both build a Pino instance via the same factory shape: writes JSON to stdout always, additionally forwards via `@logtail/pino` worker-thread transport when `BETTER_STACK_TOKEN` is set. Both services tag every line with `service` (`ai-sec-backend` / `ai-sec-agent`) + `env`. Backend's `tenantMiddleware` already enriched the request logger with `tenant_id`; agent's `index.ts` now builds a per-call child logger with `tenant_id` + `call_id` + `caller_phone` + `room` after `sessionCtx` resolves. Lifecycle events instrumented: `call_start`, `session_context_resolved`, `tenant_config_fetched`, `session_started`, `fallback_triggered` (with `reason` discriminator). 13 new tests (7 backend + 6 agent) pin the token-absent fallback, base-context tags, env / level / cache contracts, child-logger inheritance. Setup docs in `docs/DEPLOYMENT.md` → "Observability". **Dashboard logs deferred** (lower priority than the call path); fallback-internal logging deferred (would touch the 13 fallback unit tests).
- [x] ~~**Basic metrics: call success rate, booking success rate, tool-call latency.**~~ Closed 2026-05-08. In-process registry at `src/services/metrics.ts` (Prometheus text exposition, no external deps). Six pre-declared metrics — `http_requests_total` + `http_request_duration_ms` histogram (auto-emitted from a Fastify onResponse hook), `booking_attempts_total{outcome,source}` (wired into `/appointments/create` + agent's book-with-scheduling), `tool_calls_total{tool,outcome}` (wired into the toolRoute helper), `sync_dispatches_total{provider,entity,action}` (alongside the existing recorder), `errors_total{event}` (sibling counter inside `logError`). Scrape via `GET /metrics` with `Authorization: Bearer $METRICS_TOKEN`; refuses (404) when env var unset. 14 unit tests in `src/metrics.test.ts` (counter/histogram semantics, exposition format, label cardinality DoS guard).
- [ ] **Error rate monitoring for first beta users.** Sentry (or similar) on dashboard + backend + agent. Alert on error-rate spike, not on individual errors.
- [ ] **Expanded live QA suite.** `scripts/qa-live-test.py` covers 29 tool calls today. Add coverage for the OTP flow, the 5 specific booking error codes, and the timezone edge cases above.

### Launch prep

- [ ] **Security review of the production surface.** Specifically: webhook signature verification (Stripe + future), RLS coverage on every new table since 2026-03, JWT lifetime + refresh story, and the `/agent-tools/*` shared-secret rotation plan.
- [ ] **Beta customer onboarding guide.** Setup wizard + first-call walkthrough + how to extend coverage forward. Currently nothing exists — first beta customer would need a screen-share with the founder.
- [ ] **Pricing tiers finalized.** Solo ($129/mo) and Growth ($279/mo) are wired in Stripe. The Pro and Enterprise price IDs are present in env but no product/positioning. Decide before pricing is shown to a public-facing customer.

### Voice validation (additive to Phase 13)

- [x] **Voice fallback path validation.** Unit-level done 2026-05-03 (commit `6488dc4`). The validation surfaced a real dead-air gap: docs across CLAUDE.md / ARCHITECTURE.md / NEEDS-REFACTORING.md #9 had claimed `runFallback()` used OpenAI TTS as a guard against Grok outage, but the actual code used GrokTTS in both the primary and the fallback path — meaning a Grok outage would leave the fallback unable to speak either. Closed in one focused refactor: extracted `runFallback()` to `agent/src/fallback.ts` with injectable provider deps, wired it to use OpenAI TTS (matching what docs already claimed), awaited `say()` so synthesis-time failures are caught inside the try block, and pinned the contract with 13 new 5W-annotated tests in `agent/src/fallback.test.ts` covering the happy path, the OpenAI-not-Grok provider choice, and the never-throw contract under each failure mode (session ctor / STT ctor / LLM ctor / TTS ctor / start() reject / say() reject). Agent suite: 53 → 66 tests, all green. Typecheck clean. **IN FLIGHT (validation pending)** — live-PSTN exercise of the fallback message still requires the Telnyx unblock above.
- [ ] **IN FLIGHT (validation pending) — Call transcript + summary flow confirmed end-to-end.** Post-call summary write-back (`call_summaries` + embedding) was wired for Vapi; verify the LiveKit-side dispatcher does the equivalent on call end. Blocked on the same Telnyx unblock.

### Booking enforcement hardening (in flight, 2026-05-08)

Background: the GiST exclusion constraints applied 2026-05-08 already block double-booked resources/employees and the `employee_schedule` shift-coverage check already blocks out-of-hours bookings — but the failure response is just a plain string ("Resource already booked during this timeslot"). For human-facing dashboard bookings, the system needs to surface WHICH appointment is blocking and show its details so the operator can pick another time. For voice-agent bookings, the system needs to PREVENT conflicts proactively rather than block-after-the-fact. New global constraint: all appointment start_time and end_time must land on 15-minute increments (:00, :15, :30, :45) — strictest enforcement: dashboard form + Zod + RPC.

Slices 1–3 build the human-facing surface now. AI prevention items below are TODO — built after the human surface is solid.

- [x] ~~**Slice 1 — backend conflict-details on overlap.**~~ Closed 2026-05-09. `src/services/conflictLookup.ts` exports `isOverlapError()` + `findOverlappingAppointment()` + `AppointmentConflict` type. Both `/appointments/create` (dashboard) and `/agent-tools/book-appointment` (agent) thread the conflict block through: when the RPC returns "already booked", a follow-up SELECT in the same transaction surfaces the blocking appointment's id, customer name, employee name, resource name, and time range. Dashboard route returns `409 + { conflict, next_available, error_code: 'TIMESLOT_OCCUPIED' }` (also threads `findNextAvailableSlots` for the modal's "try one of these times instead" UX). Agent route returns `200 + { success: false, conflict, error_code }`; non-overlap errors keep the legacy `{ success: false, error }` shape so the existing agent prompt parsing is undisturbed. **Tests:** `src/services/conflictLookup.test.ts` (17 tests — original 10 pinning SQL shape, gating, null-employee, ordering, joins; +7 new pinning the four overlap geometries (start-overlap, end-overlap, contained, containing) and both flavors (resource-conflict, employee-conflict). `src/agentTools.test.ts` +2 tests (overlap → conflict block + TIMESLOT_OCCUPIED contract; non-overlap → plain shape + no third query). Backend test count: 1,733 → 1,741.
- [x] ~~**Slice 1.5 — 15-min increment enforcement.**~~ Closed 2026-05-09. Three layers:
  - **DB CHECK** — migration `20260508000000_appointments_15min_increment.sql` (already applied; reused) enforces `EXTRACT(MINUTE FROM start_time) IN (0,15,30,45) AND EXTRACT(SECOND FROM start_time) = 0` on both `start_time` and `end_time`. Forward-only; the 3 prod rows are :00/:30 compliant.
  - **Validator** — `validateAppointmentTimeRange` refactored to return `{ error, code } | null` with stable `AppointmentValidationCode` union (`INVALID_PARAMS` | `INVALID_RANGE` | `INVALID_DURATION` | `INVALID_INCREMENT`). Routes thread `error_code` through the response so consumers branch on code, not message.
  - **Routes** — wired into all 3 call sites: `POST /appointments/create`, `POST /appointments/:id/update`, and `POST /agent-tools/book-appointment`. Each returns `{ success:false, error, error_code: 'INVALID_INCREMENT' }` (status 400 for dashboard, 200 for agent per its conversational contract) before any DB activity.
  - **Tests** — `appointmentValidation.test.ts` updated to assert structured shape (+1 test for unparseable-date INVALID_PARAMS path); `routes/appointments.test.ts` +3 tests (off-grid start/end on create + off-grid update); `agentTools.test.ts` +2 tests (off-grid start/end on agent route, both pin no-DB-call). Backend test count: 1,741 → 1,747.
- [x] ~~**Slice 2 — dashboard conflict modal + 15-min time picker.**~~ Closed 2026-05-09 (verified via audit; was shipped 2026-05-08 alongside the original Slices 1+1.5 work).
  - **ConflictModal** (`dashboard/components/scheduler/ConflictModal.tsx`) — surfaces existing booking's customer / employee / resource / time + Date · Time-range header + View / Pick-another-time CTAs. Bonus: optional next-available alternatives section that pre-fills the form when the operator picks one.
  - **15-min time picker** — both QuickBookPanel and AppointmentDetailPanel use `<input type="datetime-local" step="900">`; browser arrow-keys + `reportValidity()` snap to grid. Differs from the spec's "dropdown of options" but functionally equivalent (off-grid input rejected pre-submit) and matches platform conventions for date-time entry.
  - **Component tests** — `ConflictModal.test.tsx` (10 tests: full / partial details, View+Close wiring, alternatives section render + click + guards) + `QuickBookPanel.test.tsx` (2 conflict-wiring tests: 409 → modal renders + plain error → modal NOT rendered, inline error stays). 17/17 pass.
  - **E2E** — `dashboard/e2e/booking-enforcement.spec.ts` `ui-conflict-modal` (modal renders existing-appointment details after a real overlap booking) and `15min-form-rejection` (off-grid time inline error never reaches backend) — both pass.
- [x] ~~**Slice 3 — E2E with self-contained data lifecycle.**~~ Closed 2026-05-09. New `dashboard/e2e/helpers/fixtures.ts` exports `registerFreshTenant()` (POST /register → unique tenant + admin token), `seedBookingScenario()` (creates N employees + M resources + 1 customer + shifts on requested dates via existing routes + direct `employee_schedule` INSERT), `seedAppointment()` for "blocker" rows, `bookAppointmentAs()` / `updateAppointmentAs()` API conveniences, and `cleanTenantData()` (single-statement DELETE that cascades through every dependent table). The four backend-contract scenarios in `booking-enforcement.spec.ts` (out-of-hours, employee/resource double-book, partial-overlap) plus the edit-overlap test refactored to drop Page entirely + drop the DynaTire seed dependency: each test registers its own tenant, seeds entities, asserts via `request` context, cleans up via tenant cascade. UI tests (5 ui-conflict-modal, 6 15min-form-rejection) keep their existing pattern because the dashboard's tenant-aware UI needs a real tenant with populated dropdowns. Speedup: API tests went from ~4.8s each (Page-mediated) to ~100-460ms each. Three consecutive full runs (12.9s / 12.2s / 12.2s) — the prior auth-bleed flake on `15min-form-rejection` is gone since the surrounding API tests no longer touch Page state. 8/8 pass; dashboard unit suite 617/617 still green.
- [x] ~~**AI prevention — prompt-only enforcement.**~~ Closed 2026-05-09. Tightened `agent/src/prompt.ts` "Availability discipline" section: replaced the soft "the booking tools enforce this server-side" line (which gave the LLM license to skip the check) with a "this is a hard rule, not a guideline" framing + an explicit "Don't rely on the backend to catch you — by the time it rejects, the caller has already heard you propose a time you can't deliver" warning. Added explicit 15-min grid rule for spoken proposals (":00, :15, :30, :45 — never :07, :23, :40") so the agent doesn't propose an off-grid time the booking call will then reject with INVALID_INCREMENT. New "When the caller can't be accommodated" section directs the agent to STOP guessing and take a message (capturing name + reason, no fake callback windows promised) once alternatives are exhausted. Available tools list expanded to mention `check_availability` as a third entry-point alongside `get_available_slots` / `get_scheduling_options`. Pinned with 4 new CONVERSATION-SHAPE prompt-content tests in `agent/src/prompt.test.ts` covering scenarios (a) hard-rule check-before-book, (b) TIMESLOT_OCCUPIED → propose alternative, (c) 15-min grid in spoken times, (d) take-a-message escalation when nothing fits. Agent tests 81 → 85; typecheck clean.
- [ ] **AI prevention — pre-flight tool fallback (escalation, only if needed).** If beta data shows the agent skips the availability check >5% of the time despite the prompt rule, ship `/agent-tools/propose-times` returning 3-5 conflict-free 15-minute slots given a window. Server-enforced — agent reads from a list rather than picking arbitrary times. Don't build speculatively; only escalate if prompt-only proves unreliable.
- [x] ~~**AI prevention — E2E coverage.**~~ Closed 2026-05-09 alongside the prompt-only enforcement above (same scope; the four scenarios are pinned by the four CONVERSATION-SHAPE prompt-content tests). Live conversational behavior is validated end-to-end via `scripts/qa-live-test.py` (29 tool calls / 88 assertions) once Telnyx unblocks; an LLM-in-the-loop harness was deliberately deferred — non-deterministic, costs OpenAI tokens per run, and the "test or delete" Build Principle steers us away from coverage we can't validate against a real surface.

### E2E coverage gaps surfaced 2026-05-08 (deep-dive analysis)

After shipping slices 1-3 (37→42 E2E tests passing), a coverage analysis identified concrete gaps in the launch-readiness surface. Tier P0 items closed (multi-tenant isolation E2E, 15-min form-level rejection E2E, two pre-existing flakes fixed); P1/P2 below remain pickable.

#### P1 — high-value (real flows, real risk)

- [x] ~~**Calendar sync on booking.**~~ Closed 2026-05-08 (`calendar-sync.spec.ts`, 6 tests). Added an in-memory dispatch recorder to `syncOrchestrator` (gated by `SYNC_TEST_RECORDER=1` env var) + `/agent-tools/_test/sync-events` route. E2E asserts every appointment lifecycle event (create/update/delete) dispatches all 5 providers (calendar + 4 CRMs), every customer lifecycle event dispatches the 4 CRMs, and the fire-and-forget contract returns HTTP <3s even with all 5 sync promises in flight. Doesn't verify outbound HTTP shape (that's in unit tests with mocked provider modules), but pins the orchestration layer the routes depend on.
- [x] ~~**Setup wizard finalize → first usable tenant.**~~ Closed 2026-05-08 (`setup-wizard-to-booking.spec.ts`, 3 tests). Each test owns its own tenant via `/register` → drives the wizard's finalize sequence over HTTP (services/resource/employee/`/shifts/expand-weekly`) → asserts. Three scenarios: (a) HAPPY — fresh tenant can immediately book at +7 days inside the fanned-out window; (b) SAD — skipping `/shifts/expand-weekly` leaves booking with `EMPLOYEE_NOT_SCHEDULED` on every attempt, pinning the contract that fan-out is load-bearing; (c) RANGE — default `weeks_ahead=4` produces 28 employee_schedule rows reaching ~27 days out, catching a regression that quietly shrinks the window. API-only design (matches `calendar-sync.spec.ts`), no SSR/hydration flakes. Cleanup is `DELETE FROM tenants WHERE id = $1` (cascades).
- [x] ~~**Password reset flow.**~~ Closed 2026-05-08 (`auth-flows.spec.ts` password-reset test): seed user, /forgot-password creates a token row, test rotates the hash to a known plaintext, /reset-password with that plaintext succeeds, old password no longer logs in, new password does.
- [ ] **Cancel + restore appointment.** Soft-cancel keeps the row; we test the slot frees up (booking-alignment test 9). Missing: clicking on a canceled appointment, seeing canceled state, attempting to reactivate (or confirming the system says "this is canceled, book a new one").
- [x] ~~**Front-desk role 403 on owner-only routes.**~~ Closed 2026-05-08 (`auth-flows.spec.ts` role-gate test): seeds a front_desk user, logs in, hits POST /users/invite + PATCH /users/:id/role + GET /users — all return 403. Belt-and-suspenders DB check confirms the target user's role wasn't changed.
- [x] ~~**Booking past-time form-level rejection.**~~ Closed 2026-05-08: investigation found past-time bookings are intentionally allowed for walk-in retrospective records (e.g. customer walks in at 1:05, operator books for 1:00). The shift-coverage gate is the actual business-hours enforcement. Test correctly drops; no rejection needed.
- [ ] **Unassigned-booking outside-business-hours gate.** Today the shift-coverage check only fires for bookings with `employee_id` set. An unassigned (resource-only) booking at 5am — when no employee is scheduled — passes through. Whether that's a real gap depends on product policy: "unassigned bookings are just resource holds" → current behavior fine; "no booking outside business hours regardless of assignment" → need a new gate (probably "at least one employee has a shift covering this time on this date for this tenant"). Decision pending.
- [ ] **Scheduler shows the new appointment in real-time.** After successful booking, the scheduler grid should reflect the new row without manual refresh. Likely works (existing wiring) but unverified end-to-end.
- [x] ~~**Appointment-edit doesn't trip its own overlap constraint.**~~ Closed 2026-05-08 (`booking-enforcement.spec.ts` edit-overlap test): pre-INSERT two appointments A (14:00-14:30) and B (15:00-15:30), then PUT /appointments/:id/update tries to move B onto A's slot. Returns 4xx; B's start_time in the DB is unchanged.
- [x] ~~**OTP / phone-verification end-to-end.**~~ Closed 2026-05-08 (`auth-flows.spec.ts` otp-verify test): pre-INSERT a `phone_verifications` row with a bcrypt-hashed known code, /verify-phone-code with wrong code → success:false + verified_at NULL, /verify-phone-code with correct code → success:true + verified_at populated. The SEND path is unit-tested; not E2E'd here because actually sending an SMS via Telnyx requires inbound_phone configured + costs money + risks a real number receiving a real text.

#### P2 — nice-to-have but real gaps

- [ ] **All 5 industry templates produce a working setup.** Currently DynaTire (automotive) is the only one exercised end-to-end. Salon, mobile_tire, auto_bays, ai_platform have setup-wizard differences that aren't pinned by E2E.
- [ ] **Solo wizard vs multi-employee wizard divergence.** Two paths in the wizard; only one is exercised in audit.
- [ ] **Knowledge base upload + Q&A retrieval.** Upload PDF → embedding generated → ask question → policy-answer route returns relevant chunk. Untested end-to-end.
- [ ] **Reminder scheduled on appointment create.** `reminder_schedules` row appears with the right `scheduled_for`; worker delivers it (or, in dev, no-ops without crashing).
- [ ] **Tenant delete cascade.** Owner deletes tenant → all appointments, employees, customers, mappings, schedules go. Backend has tests; no E2E proof.
- [ ] **Vocabulary overrides flow through the UI.** Setting "tech" → "stylist" should change labels everywhere immediately. Tested in vocabulary-guard but not E2E.
- [ ] **Version-history restore for a soft-deleted record.** Critical for "we accidentally deleted X — restore it" customer-trust scenario.
- [ ] **Date-nav chips honor tenant timezone.** Yesterday/Today/Tomorrow logic depends on tenant's IANA zone. Test 26 (date-nav chips dashboard component) covers UI; not the timezone correctness end-to-end.

#### Deliberately NOT adding to E2E (better at other levels)

- RPC concurrency races (`booking-concurrency.test.ts` is real-DB and sufficient)
- Token refresh / JWT lifetime (unit-tested)
- Validation edge cases — long names, unicode, etc. (Zod tests are right level)
- RLS policy enforcement at DB layer (`rls.test.ts` exhaustive)
- Mobile responsiveness (manual on real devices is more meaningful — tracked under "Mobile responsiveness validated" elsewhere in this doc)
- Cross-browser (Chrome only; Firefox/Safari only matters if a customer reports an issue)
- Real OAuth flows for Google/Outlook/Jobber/HubSpot/Square/ServiceTitan/Stripe (would require credential rotation in CI; manual before release is more honest)
- Performance / load (separate tool — k6, Artillery)

---

## CI Rot — RESOLVED (2026-04-30, recurrence resolved 2026-05-06)

The 2026-04-30 fix held until 2026-05-04, after which CI was red on every push for ~3 days due to three independent root causes (postgres image lacked pgvector; `scripts/setup-db.sh` silently swallowed errors due to a `set -e` interaction; dashboard `tsconfig.json` had its `types` directive placed at the JSON root instead of inside `compilerOptions`). All three fixed 2026-05-06 — see `docs/CURRENT_STATUS.md` "May 6: CI rot fixed" for the full disposition. Verified against a fresh `npm ci` install to simulate CI before pushing.

Done in a focused pass. Two-job CI gate now runs on every push/PR to main:

- **Backend job:** `npm ci`, `npx tsc --noEmit`, `npm test` (1,479 tests, real Postgres service container).
- **Dashboard job:** `npm ci`, `npx tsc --noEmit`, `npm test` (498 tests).

**Deleted as zombies** (referenced paths/scripts that don't exist in this
repo, leftover from the ai-secretary import):

- `pnpm-workspace-sanity.yml` — no `pnpm-workspace.yaml` exists.
- `ci-smoke-assume-tenant.yml` — references `__tests__/auth.assume-tenant.test.ts`.
- `ci-smoke-calendar-appointments.yml` — references `__tests__/calendar.test.ts`.
- `pr-smoke-servers.yml` — references `seed-demo.sh`, port 3000, `admin@test.com`.

The smoke workflows' value is subsumed by the unit suite (calendar, auth,
appointment tests live under `src/` and run via the new backend job).

### Follow-up

- [x] **Re-enable dashboard typecheck in CI.** Done 2026-04-30. Fixed
  the three pre-existing test-file type errors that had been blocking
  the gate: `Boom` now declares `: never` return type;
  `process.env.NODE_ENV` writes replaced with `vi.stubEnv`/`vi.unstubAllEnvs`;
  `BusinessSettingsView.test.tsx` `window.location` override now uses
  `@ts-expect-error` (matching the existing pattern in
  `ErrorBoundary.test.tsx`). Dashboard CI job now runs `npx tsc --noEmit`
  + `npm test` (498 tests, all passing).

---

## Voice AI Migration: Vapi → LiveKit Agents

Migration shipped in `661d21d` (2026-04-27). Vapi account deleted. **Truth-of-state lives in `docs/FRAMEWORK_MIGRATIONS.md`** — don't duplicate it here.

**Open work (TODO-tracked, not in FRAMEWORK_MIGRATIONS.md):**
- **Phase 4 — native xAI Grok TTS in agent worker.** Code-complete 2026-05-01 (`agent/src/grokTTS.ts`). End-to-end PSTN validation pending Phase 5 below. Tracked at `NEEDS-REFACTORING.md` #9 and `FRAMEWORK_MIGRATIONS.md` #3.
- **Phase 5 — first live PSTN call + DynaTire integration testing.** Blocked on Telnyx ticket #2850682 (`+1-630-937-9478` PSTN reachability). See `TICKET_SUPPORT.md`.
- **Phase 6 — dashboard updates** (call status, live transcription). Design TBD; currently shows post-call summaries only. Only tracked here.

---

## Documentation Cleanup (Vapi → Telnyx/LiveKit)

Doc Phase 1 inventory completed 2026-04-27. 17 files contain 177 Vapi references; 76 are historical (leave alone), 101 are actionable. Three classes:

- **Category A — pure renames** (41 hits): stack listings, env var lists, file references. Mechanical.
- **Category C — stale env vars** (22 hits): `VAPI_API_KEY`, `VAPI_SERVER_URL_SECRET` documented in setup guides. Mechanical removal.
- **Category B — architectural** (38 hits): `improvement-ideas.md` and `docs/IMPROVEMENT_IDEAS.md` have proposed refactor tasks that assume the old Vapi shape. Need review — some tasks may need rewording, others may need to be dropped entirely now that the architecture changed.

**Files affected** (from inventory): README.md, CLAUDE.md, SUMMARY-2026-04-24-0030.md, improvement-ideas.md, docs/IMPROVEMENT_IDEAS.md, docs/CURRENT_STATUS.md, docs/ARCHITECTURE.md, docs/DEPLOYMENT.md, docs/FRAMEWORK_MIGRATIONS.md, docs/TODO.md, docs/PLAN.md, docs/UI_UX_DESIGN.md, docs/DESIGN_HANDOFF.md, docs/DIAGRAMS.md, docs/BUGS.md, .remember/state.md, src/services/MIGRATED_FROM_AI_SECRETARY.md.

- [x] **Phase 2a (mechanical):** Category A + C renames across the authoritative docs. Done 2026-04-27 in commit `33b685c` — README, CLAUDE.md, docs/CURRENT_STATUS.md, docs/DEPLOYMENT.md (incl. Phase 6 rewrite), docs/IMPROVEMENT_IDEAS.md updated; every remaining Vapi mention in those files is correctly historical.
- [x] **Phase 2b:** done 2026-04-30. Reviewed all 9 actionable Vapi-shaped references across both files. Result: 5 tasks dropped (3 TTS — `src/routes/tts.ts` deleted in `661d21d`; 1 provisioning Vapi-cleanup helper — single-step Telnyx release doesn't justify extraction; 1 analytics placeholder copy — already shipped with LiveKit wording). 2 tasks reworded (provisioning status helper, voice.ts route split — still valid, just stale terminology). 1 Status parenthetical cleaned up in `docs/IMPROVEMENT_IDEAS.md`. Remaining Vapi mentions are tombstones marking dropped tasks, not actionable work.
- [x] **Reconcile the stale Voice AI Migration section above** with truth from `docs/FRAMEWORK_MIGRATIONS.md`. Done 2026-04-30. The stale phase list (Phases 1a/1b/2/3/7 with status checkboxes pre-dating the migration) was already deleted in earlier doc-sweep commits (`04c2c29` "stop presenting Vapi as current architecture"). Final pass tightened the section to a pure pointer to `FRAMEWORK_MIGRATIONS.md` plus the three operational follow-ups (Phase 4 TTS, Phase 5 live-call testing, Phase 6 dashboard updates). No duplication of stack details with the truth-of-state doc.
- [x] **Role clarity for improvement-ideas files (instead of consolidation).** Done 2026-04-30. Phase 1 inventory mislabeled these as duplicates. They are two distinct files with different origins and formats: `docs/IMPROVEMENT_IDEAS.md` is the curated review-phase backlog (160 tasks across 10 phases, dated 2026-04-10/11, capitalized titles, no Self-Review footers). `improvement-ideas.md` is an automated daily-journal feed (dates 2026-04-20–25, "Self-Review" sections after each batch, lowercase titles, includes Tradeoff/Effort vs Gain blocks). Both stay; consolidation would lose information. `docs/TODO.md:172` already treats `docs/IMPROVEMENT_IDEAS.md` as the authoritative backlog.
- [x] **Within-file dedup pass on `improvement-ideas.md`.** Done 2026-04-30. Awk-based dedup keyed on exact `### Task:` titles: 13 distinct titles had duplicates, totaling 21 dropped task blocks (4× of the syncOrchestrator fan-out execution and fan-out logs tasks; 3× of the resource-route validation, ScheduleEntry rename, sendSuccess pilot, and resource update field assembly tasks; 2× of seven other tasks). File shrank 1641 → 1323 lines (-318). Tombstones, Self-Review structure, and tenant-Vapi historical references all preserved. **Open follow-up:** the automated journal generator that writes this file is producing the duplicates — without fixing it, the next run re-introduces them. Track that as a generator-side fix, not a doc fix.
- [x] **Within-file dedup pass on `docs/IMPROVEMENT_IDEAS.md`** (the curated backlog). Done 2026-04-30. Investigation flipped the framing: the duplicate `## Ideas —` headers are NOT exact-content duplicates (each instance has different tasks beneath). The actual duplication is at the **task** level — same awk-keyed-on-`### Task:` approach as `improvement-ideas.md`. 16 surplus task blocks dropped (1 task with 3 copies, 14 tasks with 2 copies, 1 with 4 — including "Extract shared tenant bootstrap helper", "Normalize billing/provisioning envelopes", "Extract shared OAuth state-token helper for Google/Outlook", others). Tasks: 205 → 189. File: 3371 → 3131 lines (-240). All 107 section headers preserved. Same generator-side root cause as the journal feed: until the review-loop process is fixed, future runs will re-introduce duplicates. TOC still deferred — section headers remain visually noisy because the same `## Ideas —` title can recur on the same date for different review focuses (different tasks under each), and that's the file's actual shape, not a defect.

---

## Code Quality

### Type Safety (from lint audit)
- [x] Replace `catch (err: any)` with `catch (err: unknown)` + type narrowing (provisioning.ts, TenantEditPanel.tsx)
- [x] Type `app: any` as `FastifyInstance<any, any, any>` in all 25 route modules + fix OAuth callback factory
- [x] Clean up `any` types in dashboard test mocks — done 2026-05-04 (commit `cbf22b0`). 27 → 0 across superadmin.test.tsx + settings.test.tsx; new `dashboard/lib/test-utils.ts` exports a typed `mockJsonResponse` helper that future dashboard fetch-mocking tests use.
- [ ] **Clean up `any` types in backend test files — 58 remaining (down from 215).** Earlier sweeps cleared 86 across `33f83cd` + `01b7009` (2026-05-04). 2026-05-05 cleared 17 in `src/middleware-helpers.test.ts`. 2026-05-06 cleared 60 in two batches: first batch (commit `dd642bf`) cleared 41 across normalizer (12), provisioning (10), coverage (7), auth (7), routeHelpers (5); second batch added 19 across servicetitan-sync (6), high-bugs (5), square-sync (4), jobber-sync (4). Verified `bugfix-comprehensive.test.ts` and `middleware.test.ts` had zero real instances (their counts of 11 and 8 were entirely English-word matches in `it()` description strings or 5W comments, an artifact of imprecise regex). Remaining 58 across ~22 files; top of the queue: expandWeeklyToSchedule (~8), versionHistory (3), token-refresh (3), square-routes (3), shifts-routes (3), servicetitan-routes (3), hubspot-sync (3), hubspot-routes (3), analytics (3). Pattern reference: `vi.mocked(mockFn)` for typed mock access, `as unknown as Type` for partial-mock structural casts, proper `Fastify`/`Pool` type imports for production-shape mocks; define a row type and use `client.query<RowType>(...)` for pg query-result rows instead of `(r: any)` callbacks; `as unknown as typeof fetch` for `global.fetch` overrides; `as unknown as { mock: { calls: [string, unknown[]?][] } }` for vitest internals.
- [ ] **Audit `any` types in backend production code — 62 instances.** Some intentional at framework boundaries (`Pool`, `FastifyInstance<any, any, any>`); the rest is real cleanup territory. Project-wide inventory + per-file disposition (replace vs justify).
- [x] **Fix dashboard typecheck regression in `TeamAccessView.test.tsx`** — done 2026-05-05. Widened `mockListResponse` parameter from `typeof ownerRow[]` to `(typeof ownerRow | typeof deskRow)[]` so the three callsites passing mixed-role arrays (lines 66, 109, 161) typecheck cleanly. Pre-existing since `e65c833`. Dashboard `tsc --noEmit` exits 0; TeamAccessView tests still pass (5/5). Restores CLAUDE.md's "Zero TypeScript errors" claim across the dashboard workspace.
- [ ] **Backfill 5W diagnostic comments to remaining 23 test files (project at 81% coverage; ~101/124 files at last audit).** Files mostly older mechanical schema/utility/sync tests where descriptive test names already serve as documentation — verify each file's tests would gain real readability from 5W vs being ceremony before backfilling. The high-value subset (security, regression suites, contract-pinning) was already backfilled 2026-05-05 in commit `9364773`. Remaining backend (20): coverage-gaps, appointment-date-filter, appointment-mutations, billing, medium-bugs, vocabulary, tools, vocabulary-wiring, solo-wizard, low-bugs, scheduling-atomic, service-enhancements, high-bugs, rag-normalization, middleware-helpers, versionHistory, knowledge-normalization, service-catalog, crm-appointments, services/consentService. Remaining dashboard (3): SettingsView.test.tsx, lib/phone.test.ts, components/scheduler/NewSchedulerView.test.tsx.

### Legacy Cleanup
- [x] `vapi/agent.json`, bug-fix markdown files, `fix-vapi-assistant.js/.ts`, `dashboard/test-fetch.js` — all already deleted in prior commits
- [x] `dashboard/server.js` — verified ACTIVE (dev HTTPS server + Railway deploy), not legacy
- [x] `scripts/configure-vapi-agent.sh` — deleted (superseded by provisioning API)
- [x] `n8n/` directory + `docs/N8N_WORKFLOWS.md` — deleted (functionality built into Fastify routes)
- [x] `shift_overrides` → `employee_schedule` rename, `employee_shifts` fallback removed from booking RPCs
- [x] **Remove unused Jest references from the project — done 2026-05-07** (commit `7658fc5`). Dropped `"jest": "^30.2.0"` and `"@types/jest": "^30.0.0"` from root devDependencies; `npm install` shrank `package-lock.json` by 4,384 lines (jest dragged in 100+ transitive deps — babel runtimes, jest-runtime, alternate jsdom). Kept `@testing-library/jest-dom` (matcher library that works natively with Vitest). Backend 1,646, dashboard 551, agent typecheck — all clean post-install.

### Soft Delete Filtering (BUG-038)
- [x] Add `WHERE is_deleted = false` to SELECT queries in routes touching soft-deletable tables. Audit done 2026-04-30 — most routes already filter (appointments, customers, employees, resources, services, agentTools). Four remaining gaps fixed: `voice.ts:321` (customer phone lookup), `voice.ts:393` (customer ID verify for note add), `agentTools.ts:602` (services CTE in available-time-slots), `analytics.ts:55` (service-employee skill matrix). All 1,468 backend tests pass.
- [ ] Service-layer SELECT queries in CRM/calendar sync code (`hubspotSync`, `squareSync`, `jobberSync`, `servicetitanSync`, `calendarSync`, `syncMapHelpers`) currently include soft-deleted records. Decide whether sync should push deletions to external systems (push the soft-delete state) or just exclude — needs a product call before changing.

---

## CRM Sync Unification (completed 2026-04-17, next steps)

Shared `syncMapHelpers.ts` extracted. Remaining opportunities:
- [x] **Unify calendar token refresh — partially shipped 2026-05-04.** Verify-first reframed the scope: the OAuth state JWT (sign + verify) was duplicated across **6** files (Google + Outlook calendars + Jobber + HubSpot + Square + ServiceTitan clients), not just 2. Extracted to `src/services/oauthStateJwt.ts` with 10 unit tests; ~72 lines deduped. The token *refresh* itself was deliberately NOT unified — Google uses the `googleapis` SDK and Outlook uses raw `fetch` with manual error handling; abstracting over them lands in the same strategy-pattern shape that NEEDS-REFACTORING #1 rejected.
- [x] **Extract shared tenant bootstrap helper — done 2026-04-30 (commit `19d6b8b`).** `src/services/tenants/bootstrap.ts` exports `createTenantWithOwner(pool, params)` — owns the BEGIN / duplicate-check / INSERT tenants / bcrypt / INSERT users / COMMIT (ROLLBACK on error) shape. Both `POST /register` (auth.ts:81) and `POST /tenants/create` (tenants.ts:136) consume it. Policy differences (email vs tenant-name duplicate check, conflict messages, optional first/last name fields) expressed via the `duplicateCheck` parameter. 9 unit tests in `bootstrap.test.ts` with 5W comments, happy + sad paths.

---

## Communications & Reminders Integration

Migrated from ai-secretary, stub implementations need wiring to production DB.

### Phase 1: Database Adapter
- [ ] Create DatabaseService adapter wrapping ai-sec's pool with reminder methods
- [ ] Create `reminder_schedules` table migration
- [ ] Wire TenantConfigService to DB (replace InMemoryTenantConfigService)

### Phase 2: Communications
- [ ] Install and configure nodemailer
- [ ] Install and configure Twilio SDK for SMS
- [ ] Wire email/SMS services to real providers
- [ ] Create tenant notification preferences columns

### Phase 3: Reminders
- [ ] Wire ReminderScheduler to real cron/timer system
- [ ] Connect ReminderProcessor to communications service
- [ ] Add appointment lifecycle hooks (create/update/cancel → schedule/reschedule/cancel reminders)

### Phase 4: Testing
- [ ] Integration tests with real DB for reminder CRUD
- [ ] E2e test: appointment created → reminder scheduled → sent

### Phase 5: Ops
- [ ] Monitoring dashboard for reminder delivery rates
- [ ] Retry logic for failed sends
- [ ] Rate limiting for SMS sends

---

## UX / Accessibility Backlog — COMPLETE (2026-04-20)

All 47 items from April 10-11 UX review resolved in commit `f9ffa8e`. Key changes:
- Clickable divs → semantic buttons with keyboard handlers across 8 components
- Hand-rolled modals → shared Modal (RecordHistoryModal, WizardModeChooser)
- All confirm()/alert() → ConfirmModal + showToast
- ARIA roles, aria-selected, aria-live, role="dialog" added throughout
- URL query param sync on sub-tabs (MyBusinessView, MyTeamView)
- Loading skeletons, empty states, dynamic popover height
- Radiogroup semantics, fieldset grouping, explicit labels
- In-panel nav, compact status dots, improved button labels

---

## Improvement Ideas (from code review)

160 proposed refactoring tasks in 10 phases. Top items by impact:

### Highest Impact (do first)
- [x] Unify calendar service token refresh (Google + Outlook) — partially shipped 2026-05-04 as `src/services/oauthStateJwt.ts` (state JWT only); refresh itself deferred (Google SDK vs Outlook fetch defeat clean abstraction). See "CRM Sync Unification" above.
- [x] Extract shared tenant bootstrap helper (auth register + admin create) — done 2026-04-30 (commit `19d6b8b`). See "CRM Sync Unification" above.
- [x] Extract dashboard controller hooks (AppointmentView + SuperAdminDashboard) — **verified + deferred 2026-05-04** under the same lens as NEEDS-REFACTORING #11's deferred part. The reusable pieces were already extracted in earlier work (`useStaticData(tenantId)`, `useActiveTenantId`, `useVocabulary`, `AppointmentDetailContext`). What remains is component-specific orchestration with exactly one consumer (Tenant-typed CRUD + drag-reorder for SuperAdminDashboard, appointment CRUD + calendar view/zoom for AppointmentView); extracting now would relocate code without enabling reuse or new test patterns. Build principle: "Working flat code beats a dormant abstraction." Re-evaluate if a second consumer for the reorder pattern or appointment-CRUD shape arrives. One narrow follow-up tracked: a `useDraggableList<T>` extraction would pay off the moment any other admin list needs reordering.
- [x] **Add tests for destructive flows — done 2026-05-05.** Earlier work: tenant delete + tenant reorder route tests in `src/tenant-routes.test.ts` (commit `5f12215`); shift override RPC route tests in `src/shift-overrides-routes.test.ts` (`5f12215`); mock-mode `handleUpdate` + `handleDelete` guard tests in `dashboard/appointment.test.tsx` (commit `2cd381a`). Final piece shipped today: mock-mode `handleCreate` guard test in `dashboard/appointment.test.tsx` (drives the "+" button → "Create Appointment" submit path through the UI and asserts no `POST /appointments/create` fetch happens while `usingMockData` is true). The fixture work that originally blocked it was minimal in the end: a `data-testid="new-appointment-btn"` attribute added to the sidebar's Plus button so the test can find it without anchoring on icon DOM. All three destructive guards (`handleCreate`/`handleUpdate`/`handleDelete`) are now contract-pinned; a refactor that re-orders the mock-mode check below the API call surfaces immediately. Dashboard tests: 9/9 in `appointment.test.tsx` (was 8); `tsc --noEmit` clean.
- [x] **Replace ad-hoc tenant typing with shared dashboard tenant view type — done 2026-05-05.** Three components had local `type Tenant = { ... }` declarations (TenantCard.tsx, SuperAdminDashboard.tsx, TenantEditPanel.tsx) — all subsets/supersets of `TenantFull` in `dashboard/lib/types.ts`. Migrated each to `import type { TenantFull } from '../lib/types'`. Two type fixes shipped along with the migration: (1) relaxed `Tenant.{voice_id,system_prompt,first_message}` from non-null `string` to nullable `string | null` (matches DB nullability + the local types' more accurate shape; consumers already guarded for null at runtime); (2) added `TenantFull.{system_prompt_template,first_message_template}` as optional read-only fields projected onto the row by the SuperAdmin /tenants list query. Net: 3 ad-hoc declarations gone, one canonical source of truth. Dashboard tsc clean, 504 tests pass, ESLint clean.
- [x] **Normalize response envelopes across CRM disconnect/sync-status routes — done 2026-05-05.** Verify-first found the response *shapes* were already normalized: all four `/<provider>/sync/status` routes already delegate to the shared `getCrmSyncStatus()` helper (`src/services/crmSyncStatus.ts`), and all four `/<provider>/settings/disconnect` routes already returned the same `{ success: true }` envelope. The remaining duplication was at the *implementation* level — 4 × 16-line disconnect handlers that differed only in the provider literal (~50 lines duplicated). Extracted `disconnectCrmIntegration(client, tenantId, provider)` to `src/services/crmDisconnect.ts`, mirroring the `crmSyncStatus.ts` shape. 5 unit tests (happy + 2 sad paths, 5W comments). Net: 4 routes × 13-line handler bodies → 4 routes × 6-line handler bodies; ~30 lines deduped. The `POST /<provider>/sync` trigger routes still return provider-specific entity counts (jobber: clients/visits, hubspot: contacts/meetings, square+servicetitan: customers/appointments) — that divergence is intentional, each CRM has different entity types worth surfacing per provider.

Full backlog: see `docs/IMPROVEMENT_IDEAS.md` (160 tasks across 10 review phases)

---

## Local DB integration tests — RESOLVED (2026-04-30)

Local test_db cleaned + re-migrated from scratch. Two migration fixes
shipped:

- `20260430000000` — `check_coverage_gaps` + `check_availability_with_tz`
  referencing the dropped `shift_overrides` table (real prod bug from
  the `20260420000000` rename — the function-rewrite step missed two
  RPCs).
- `20260430000001` — `auto_version_trigger` cascade-delete guard. Same
  pattern as `20260319000003` for `fn_audit_trigger`. Tenant deletion
  was failing on FK violation when `record_versions` tried to insert
  rows for a tenant being cascade-deleted.

19 stale tests updated to seed `employee_schedule` directly (booking
RPCs read it exclusively post-`20260420000000`). 2 tests pinning the
removed `get_effective_shifts` pattern fallback `it.skip`'d with
explanatory comments — **redesigned and re-enabled 2026-05-04** under
the employee_schedule-only contract (HAPPY: multi-day range returns
every row in date order; SAD: rows outside the queried range are
filtered out). Skip count: 2 → 0.

Test-utils gained `createScheduleEntry()` and `createShiftForDate()`
helpers so future DB tests have a clean way to seed date-specific
schedule rows.

**CI wired** to provision Postgres 16, apply migrations, and run the
full backend suite on every push — these tests are no longer silent
skips. 1,511 backend tests pass + 2 documented skips.

**Follow-ups:**

- [x] **Bug in `scripts/setup-db.sh` bootstrap step.** Done 2026-05-02.
  Removed the `-c "SET ..."` flag and moved the `SET client_min_messages`
  into the heredoc as its first statement; smoke-tested against a
  throwaway local DB (old pattern: table not created, new pattern:
  table created). CI workaround step in `.github/workflows/ci.yml`
  deleted in the same commit since the script bootstraps correctly
  on its own now.
- [x] Re-enable the 2 skipped `get_effective_shifts` tests — done
  2026-05-04. Both replaced with new tests targeting the
  employee_schedule-only contract: HAPPY "multi-day range returns every
  row in date order" (5 weekday seeds, distinct hours, asserts row order
  + content) and SAD "rows outside the queried date range are filtered
  out" (3 seeds Mon/Wed/Fri, query Wed-only, expect exactly 1 row).
  Both pass against the real DB. Skip count: 2 → 0.
