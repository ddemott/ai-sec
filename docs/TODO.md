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
- [ ] **IN FLIGHT (prod-apply) — Apply migrations `20260501000000` + `20260501000001` to production Supabase** (atomic-booking exclusion constraints + RPC exception handlers). Code + unit tests green on main; CI applies them on every push against the test DB. Pre-flight on prod: query for any existing overlapping `appointments` rows on `(resource_id, time-range)` or `(employee_id, time-range)` where `status='scheduled'` AND `is_deleted=false`. If any exist they must be reconciled first or the `ALTER TABLE ... ADD CONSTRAINT EXCLUDE` will fail. Apply via `npm run db:migrate -- "$SUPABASE_URL"`.

---

## Pre-launch hardening (from external review, 2026-05-01)

Reconciled from `GROK-SUGGESTIONS.md`. Items already tracked elsewhere are not duplicated here — only the genuinely additive entries live in this section. See GROK-SUGGESTIONS.md for the full reconciliation table.

### UX simplification — directional feedback (NEW, blocking beta)

External review flagged the dashboard as **complex and hard to understand for non-technical users**. The target audience is shop owners and front-desk staff, not sysadmins. Today the app exposes a lot of its internal model (resources, skills, coverage gaps, RLS-aware tenant switcher, version history, audit fields) directly to those users.

Treat this as a launch-blocker for beta with DynaTire — the carrier propagation question gets us a working voice path, but if the front-desk UI doesn't fit the staff member's day, the demo fails.

- [ ] **Audit Front Desk view for non-technical operators.** Walk every primary task (book a call-in customer, look up tomorrow's schedule, mark someone unavailable, find a customer) and count clicks + decisions. Anything > 3 decisions for a daily task is a candidate for simplification.
- [x] **Hide "Back Office" surface from Front-Desk-only logins — done 2026-05-05.** Migration `20260505000000_user_roles.sql` adds `users.role` (`'owner' | 'front_desk'`, default `'owner'` so existing users are unaffected). Backend: `JwtPayload` + `AppRequest.auth` + `generateToken` carry the role; `/login` returns it on the response and includes it in the JWT; `/auth/refresh` preserves it; unrecognized values coerce to `'owner'` so a future role addition can't silently downgrade an existing user. Frontend: `SessionContext` exports `role` (persisted to localStorage); `OutlookLayout` accepts `role` and hides the Back Office tab in both the desktop FolderTabBar and the mobile mode-toggle when `role === 'front_desk' && !isAdmin`; a useEffect snaps front-desk users back to `dashboard` if they land on `my-business` / `my-team` / `ai-insights` via a stale URL. Super-admins still see Back Office regardless of `role` because admin status is identified by tenant_id, not by users.role. 4 new layout tests + 2 new auth-handler tests; 1,513 backend + 508 dashboard tests pass.
- [ ] **IN FLIGHT (validation pending) — Browser-verify role gating + invite flow end-to-end.** Unit tests pin both contracts but neither has been exercised in a real browser session. Run `npm start` and click through:
  - **Role gating (commit `8683222`):** (a) log in as the owner, navigate to Back Office → My Team → Logins, and use the invite flow below to seed a `front_desk` user (or fall back to SQL `UPDATE users SET role='front_desk' WHERE email = ...`); (b) log in as that user and confirm the Back Office tab is hidden in desktop nav, mobile mode-toggle, and that `?tab=my-business` redirects to `dashboard`; (c) confirm an `owner` user still sees both tabs; (d) confirm super-admin overrides `role`; (e) confirm `/auth/refresh` preserves role across token rotation.
  - **Invite + role-management UI (commit `e65c833`):** (a) `GET /users` populates the Logins list with the owner's row tagged "You" and the dropdown disabled on that row only; (b) clicking Invite, filling the form (default role Front Desk), and submitting closes the modal, shows a success toast, refreshes the list, and triggers a real invite email at the SMTP configured by `EMAIL_USER`/`EMAIL_PASS` (or a no-op transporter in test/dev); (c) the invitee opens the link, lands on `/reset-password`, sets a password, and can sign in; (d) changing a teammate's role via the dropdown succeeds and persists across reload; (e) the API correctly returns 400 if curl-tested for a same-user role change; (f) a `front_desk` user URL-hacking to any `/users` endpoint receives 403.
- [ ] **IN FLIGHT (prod-apply) — Apply migration `20260505000000_user_roles.sql` to production Supabase** alongside the two `20260501*` migrations already pending. Pre-flight: harmless additive ALTER (DEFAULT 'owner', no NULL backfill needed).
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
- [ ] **Skill + resource matching reliability sweep.** End-to-end test: caller books service X requiring skill Y on resource Z. Verify the RPC's 7-layer constraint check rejects mismatches and accepts valid bookings across all 5 industry templates (automotive, salon, mobile_tire, auto_bays, ai_platform).
- [ ] **Coverage gap detection backend↔UI consistency.** `check_coverage_gaps()` RPC and the dashboard's coverage bars both compute coverage. Verify they agree on edge cases (employee on leave, shift starting before business hours, day with zero scheduled employees).
- [x] **Multi-tenant isolation verification — done 2026-05-06.** Wrote `src/multi-tenant-isolation.test.ts` (25 tests across 5 probe categories: query-string override, cross-tenant id under JWT-only, body-tenant_id FK injection, positive controls including super-admin override, admin-only `/tenants/*` gating). Real Fastify app + real Postgres + RLS-enforced via api_user pool. **Probe found two real findings, both closed in the same session:**
  1. **Application-layer cross-tenant override (read + write).** `tenantMiddleware` accepted `?tenant_id=` and `body.tenant_id=` from any authenticated user with no auth gate (12/21 initial probes failed). 8 read-leak shapes and 4 write-injection shapes confirmed: any non-admin user could `?tenant_id=<other>` to read another tenant's customers/employees/services/resources/appointments/skills/knowledge/users, or POST `body.tenant_id=<other>` to insert rows under another tenant. Closed in `src/middleware.ts` `tenantMiddleware`: gate added that 403s any cross-tenant override unless the caller is super-admin; mismatched query-vs-body returns 400.
  2. **`/tenants/*` admin routes reachable by every authenticated user.** `requireAuth()` only checks "is authenticated," not "is super-admin." Any tenant user could `GET /tenants` (enumerate every customer), `DELETE /tenants/<other>`, `POST /tenants/reorder`, etc. Added `requireSuperAdmin()` helper to `src/middleware.ts` and applied to: `GET /tenants`, `DELETE /tenants/:id`, `POST /tenants/:id/update-attributes`, `POST /tenants/create`, `POST /tenants/reorder`, `POST /templates/create`. `GET /tenants/:id/config` + `POST /tenants/:id/update-config` get a "super-admin OR own-tenant" gate (tenant users edit their own config legitimately).
  Severity context: pre-beta, no real customer data was at risk because DynaTire isn't live. But either finding alone would have been a critical breach in a paying-tenant SaaS — both closed before launch. The probe is now permanent regression coverage; the existing DB-level RLS test (`src/rls.test.ts`) is unchanged. Backend 1,551 → 1,592 tests (+25 isolation probe + 10 new middleware unit tests pinning the gate + 6 from earlier same-day work already on main). Dashboard 514/514 still pass.

### Observability

Today the agent worker logs to stdout via Pino, the backend logs via Fastify, and the dashboard logs via Next.js. Nothing aggregates them or alerts on regression. Beta-blocker for support — when a customer says "the call dropped at 2:14pm", we need a way to find that call.

- [ ] **Structured-log aggregation.** Pick one (Railway logs, Logtail, Axiom, etc.) and forward backend + agent + dashboard logs there. Filter by `tenant_id` + `call_id` for support cases.
- [ ] **Basic metrics: call success rate, booking success rate, tool-call latency.** No PromQL / Grafana needed — a daily cron-emitted summary to email or Slack covers MVP.
- [ ] **Error rate monitoring for first beta users.** Sentry (or similar) on dashboard + backend + agent. Alert on error-rate spike, not on individual errors.
- [ ] **Expanded live QA suite.** `scripts/qa-live-test.py` covers 29 tool calls today. Add coverage for the OTP flow, the 5 specific booking error codes, and the timezone edge cases above.

### Launch prep

- [ ] **Security review of the production surface.** Specifically: webhook signature verification (Stripe + future), RLS coverage on every new table since 2026-03, JWT lifetime + refresh story, and the `/agent-tools/*` shared-secret rotation plan.
- [ ] **Beta customer onboarding guide.** Setup wizard + first-call walkthrough + how to extend coverage forward. Currently nothing exists — first beta customer would need a screen-share with the founder.
- [ ] **Pricing tiers finalized.** Solo ($129/mo) and Growth ($279/mo) are wired in Stripe. The Pro and Enterprise price IDs are present in env but no product/positioning. Decide before pricing is shown to a public-facing customer.

### Voice validation (additive to Phase 13)

- [x] **Voice fallback path validation.** Unit-level done 2026-05-03 (commit `6488dc4`). The validation surfaced a real dead-air gap: docs across CLAUDE.md / ARCHITECTURE.md / NEEDS-REFACTORING.md #9 had claimed `runFallback()` used OpenAI TTS as a guard against Grok outage, but the actual code used GrokTTS in both the primary and the fallback path — meaning a Grok outage would leave the fallback unable to speak either. Closed in one focused refactor: extracted `runFallback()` to `agent/src/fallback.ts` with injectable provider deps, wired it to use OpenAI TTS (matching what docs already claimed), awaited `say()` so synthesis-time failures are caught inside the try block, and pinned the contract with 13 new 5W-annotated tests in `agent/src/fallback.test.ts` covering the happy path, the OpenAI-not-Grok provider choice, and the never-throw contract under each failure mode (session ctor / STT ctor / LLM ctor / TTS ctor / start() reject / say() reject). Agent suite: 53 → 66 tests, all green. Typecheck clean. **IN FLIGHT (validation pending)** — live-PSTN exercise of the fallback message still requires the Telnyx unblock above.
- [ ] **IN FLIGHT (validation pending) — Call transcript + summary flow confirmed end-to-end.** Post-call summary write-back (`call_summaries` + embedding) was wired for Vapi; verify the LiveKit-side dispatcher does the equivalent on call end. Blocked on the same Telnyx unblock.

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
