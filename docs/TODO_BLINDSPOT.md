# TODO — Blind Spots (verification gaps)

**Created 2026-07-01** after a live-call debugging session exposed that the booking
path was 100% broken in production while **2026 backend tests passed green**. This
file tracks the *verification* holes — the seams where real bugs live but nothing
tests or watches. Distinct from `docs/TODO.md` (feature backlog) and `docs/GAPS.md`
(cross-angle inventory). Ordered by priority.

## Evidence that motivated this file
Four bugs shipped to prod through a green CI suite, each found only by Dale dialing in:
1. `serviceResolver` ambiguous `name` → `available-slots` 500 (SQL never ran in tests — mock pg client).
2. Timezone: a 3:30 PM request booked at 10:30 AM (no agent→route→RPC→DB clock test).
3. Tool-selection: `available_slots → book_appointment` dead-ended on a missing `resource_id` (nothing tests which tool the LLM picks).
4. Booking landed Unassigned + at the wrong time (no end-to-end assertion of the stored row).

---

## P0 — Stop the "green but broken" cycle (testing)

- [x] **End-to-end booking integration test in CI** — DONE 2026-07-01 (`src/agentToolsBookingIntegration.test.ts`): real route → `book_with_scheduling_atomic` → real Postgres; asserts stored UTC instant (independent Intl-computed expectation), assigned employee, `status='scheduled'`, local read-back, EMPLOYEE_NOT_SCHEDULED + TIMESLOT_OCCUPIED sad paths, and the serviceResolver ambiguous-`name` regression via `available-slots`. Mutation-verified: reverting the tz fix turns the suite red. Runs in CI (backend job already has real Postgres + `REQUIRE_DB_TESTS=1`).
- [x] **Agent tool-selection eval** — DONE 2026-07-01 (`agent/scripts/sim-toolselect.ts`, run via `./scripts/simulate.sh toolselect`): replays the REAL `buildSystemPrompt` + REAL 19 tool schemas through `gpt-4o-mini` chat.completions, feeds synthetic tool results, grades the chosen tool SEQUENCE (required-subsequence + forbidden set). 6 scripted-caller cases incl. the bug-#3 regression (`get_available_slots` must lead to `book_with_scheduling`, never `book_appointment`/`check_availability`). On-demand (real OpenAI, `OPENAI_API_KEY`-gated), not CI. Baseline run: 6/6 (threshold 80%).
- [x] **Audit every `*.test.ts` that mocks the DB** — DONE 2026-07-01: full audit in `docs/TEST_DB_AUDIT.md` (HIGH/MED/LOW risk table). All 6 HIGH-risk gaps got real-DB companions: `analytics.realdb`, `routes/auditLog.realdb`, `versionHistory.realdb`, `voice.realdb`, `services/reminders/scheduleForAppointment.realdb`, `agentToolsCustomerSearch.realdb`. Writing them surfaced 3 real issues (ILIKE wildcard over-disclosure, /voice/history NaN/uuid 500s, reminder double-seed) — logged in TODO.md.
- [x] **Multi-employee / multi-service scheduling coverage** — DONE 2026-07-02 (`src/multiEmployeeScheduling.realdb.test.ts`, 7 tests, real DB → real RPC). Realistic salon: 4 employees (mixed skills, one partial 09–13 shift), 4 services, 3 resources (one capability-gated nail station). Proves: skill matching (Color → only color-skilled employee, never a free unskilled one; unknown skill → NO_SKILLED_EMPLOYEE), employee spillover (two same-slot haircuts land on two DIFFERENT employees/resources; third → TIMESLOT_OCCUPIED), shift-aware assignment (skilled-but-off-shift employee never assigned), resource exhaustion (2 free nail techs + 1 station → second manicure refused, never lands on a chair), and the GiST race (4 PARALLEL same-slot requests → exactly 1 winner, 3 clean TIMESLOT_OCCUPIED, exactly 1 row — first test to actually race the exclusion constraint). Runs in CI (backend job, real Postgres).

## P0 — Stop being blind in prod (observability)

- [ ] **Set `SENTRY_DSN`** on ai-sec backend + ai-sec-agent (Railway). During this session there were ZERO error traces for a 100%-broken path — diagnosis required manually decrypting the prod DB, scraping `railway logs`, and reading `/metrics`. A real incident would be just as blind.
- [ ] **Set `BETTER_STACK_TOKEN`** on backend + agent (log aggregation).
- [ ] **Alerting** — rules exist in `docs/ALERTS.md` but aren't loaded. A booking path returning 5xx / validation_error on every call produced no page. Wire error-rate + booking-failure alerts.
- [x] **Agent should log tool-call ARGS**, not just "tools executed: book_appointment" — DONE 2026-07-02 (`agent/src/redactToolArgs.ts` + 13 tests). The `function_tools_executed` log line now carries `tool_calls: [{name, args, is_error}]` — args PII-redacted (phone/code/otp keys fully digit-masked; US phone shapes + 7-digit runs masked in free text; TIME STRINGS AND NAMES PRESERVED — the debugging payload), `is_error` paired from the call's output by callId. Never throws (malformed args → masked `_unparsed` preview). Validate on the next live call's Railway logs.

## P1 — Booking correctness (still wrong after 2026-07-01 fixes)

- [ ] **Books 30 min early** — a 4:30 request stored 4:00. `book_with_scheduling` likely gets a wide window and picks the earliest opening. Fix: agent sends a TIGHT window = exactly the picked slot.
- [ ] **Agent confirms the REQUESTED time, not the actual `booked_start`** — it said "4:30" while booking 4:00. It can lie to the caller. Confirm back the real booked slot.
- [ ] **Offers alternatives when the caller named a specific time** — said "4:30", agent offered "3:30 or 4:30". When a specific time is given, verify + confirm THAT; only offer options if it's taken.
- [ ] **`book_appointment` / `check_availability` resource_id trap** — they require a `resource_id` only `get_scheduling_options` provides; a stray call after `available_slots` still fails validation. Consider making them harder to misuse (or fold into `book_with_scheduling`).

## P1 — Voice paths never validated live

- [ ] **Real PSTN inbound** end-to-end (only browser-sim tested, which echoes; see VOICE_AGENT_PLAYBOOK RULE 7.3).
- [ ] **Transfer to a human (REFER)** — not enabled on the Telnyx SIP connection, never tested.
- [ ] **Cancel / reschedule by voice** — untested live.
- [ ] **Blocked caller-ID / OTP verification** flow — untested live.

## P1 — Features that have NEVER run in prod

- [ ] **Stripe billing** — built, never live-tested (checkout → webhook → subscription → gate). Cannot take money yet.
- [ ] **Calendar sync (Google / Outlook)** — code exists, no proven real round-trip.
- [ ] **Reminders delivery in prod** — unverified (needs Telnyx creds confirmed on Railway).
- [ ] **SMS + TCPA consent language** — not validated; legal exposure before any confirmation texts.

## P2 — Data integrity / hygiene

- [ ] **Duplicate `Dale DeMott` employee** in prod (one soft-deleted, one active) — clean up + add a guard. Symptom of no validation on the employee/service data the booking RPC depends on.
- [ ] **No cleanup pass** for soft-deleted employees/services lingering in mapping tables (`service_employee`).
- [ ] **`password_resets` RLS conflicts with the invite flow (latent, prod-safe today)** — found 2026-07-02 while writing `src/routes/users.realdb.test.ts`. The `POST /users/invite` handler INSERTs a `password_resets` row **inside `withTenantClient`** (so `app.current_tenant_id` is set), but the only `password_resets` policy is `password_resets_unauthenticated_only`, whose `WITH CHECK` permits writes **only when `app.current_tenant_id IS NULL`**. Under a non-`BYPASSRLS` role (the test's `api_user`) that INSERT is rejected `42501` → the whole invite 500s. It works in prod **only because** the managed `DATABASE_URL` role bypasses RLS — **VERIFIED 2026-07-02**: prod `current_user = postgres` with `rolbypassrls = true`, so the password_resets INSERT bypasses RLS and invites succeed (severity confirmed as latent, NOT a live outage). So the app's own policy would reject the app's own write the moment prod moved to a locked-down role — a defense-in-depth gap. **Fix options (Dale's call, security-model decision):** (a) add a scoped admin-bypass/`WITH CHECK` policy that also allows the insert when the acting user belongs to the target tenant, or (b) perform the `password_resets` insert outside the tenant context (clear `app.current_tenant_id` for that one statement, matching how the reset-request path writes it). The real-DB test documents the limitation and tests the 409-dup path (which fires at the users INSERT, before password_resets); the invite HAPPY path can't be exercised under `api_user` until this is resolved.

## P2 — Process

- [ ] **A real QA loop that isn't "Dale dials in."** Every bug this session was found by manual calls. Define a pre-deploy voice smoke test (scripted sim-call asserting a booking lands correctly) that runs before merge, or at least a documented manual checklist.
- [ ] **`simulate.sh call` echo caveat** — document that browser-sim turn-taking is unreliable (echo); require headphones or PSTN for interruption judgments (already in VOICE_AGENT_PLAYBOOK; surface in the harness output).

---

**Bottom line:** the plumbing is now largely correct (crash, timezone, tool-flow, voice all fixed 2026-07-01). The gap is **verification** — integration tests, tool-selection evals, observability, and live-proofing of billing/calendar/reminders. The system looks done in the dashboard and passes CI, but the seams where real bugs live are untested and unmonitored.
