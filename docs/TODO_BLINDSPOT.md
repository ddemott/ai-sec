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

- [ ] **End-to-end booking integration test in CI** — real agent-tools route → real RPC → real DB → assert the stored appointment (time in UTC, assigned employee, on-shift). Would have caught bugs #1, #2, #4. The current `agentTools.test.ts` mocks the pg client, so SQL errors / tz / real-data validation are invisible.
- [ ] **Agent tool-selection eval** — a small harness that feeds representative asks ("book me tomorrow at 3", "what's open Friday") and asserts the agent picks a *valid tool sequence* (e.g. `available_slots → book_with_scheduling`, never `available_slots → book_appointment`). Nothing tests LLM tool choice today; bug #3 lived here.
- [ ] **Audit every `*.test.ts` that mocks the DB** and add a real-DB companion for anything that builds SQL (resolver, availability, booking, analytics). Rule already in CLAUDE.md ("mocked-API tests prove the mock, not the integration") — enforce it for query-building code.
- [ ] **Multi-employee / multi-service scheduling coverage** — all live testing has been ONE tenant, ONE employee (Dale), ONE service. Skill matching, resource conflicts, employee assignment, concurrent double-book (GiST) are unproven against realistic data.

## P0 — Stop being blind in prod (observability)

- [ ] **Set `SENTRY_DSN`** on ai-sec backend + ai-sec-agent (Railway). During this session there were ZERO error traces for a 100%-broken path — diagnosis required manually decrypting the prod DB, scraping `railway logs`, and reading `/metrics`. A real incident would be just as blind.
- [ ] **Set `BETTER_STACK_TOKEN`** on backend + agent (log aggregation).
- [ ] **Alerting** — rules exist in `docs/ALERTS.md` but aren't loaded. A booking path returning 5xx / validation_error on every call produced no page. Wire error-rate + booking-failure alerts.
- [ ] **Agent should log tool-call ARGS**, not just "tools executed: book_appointment". This session, the agent logs didn't show what time string it sent — forced inference. Add structured arg logging (redact PII).

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

## P2 — Process

- [ ] **A real QA loop that isn't "Dale dials in."** Every bug this session was found by manual calls. Define a pre-deploy voice smoke test (scripted sim-call asserting a booking lands correctly) that runs before merge, or at least a documented manual checklist.
- [ ] **`simulate.sh call` echo caveat** — document that browser-sim turn-taking is unreliable (echo); require headphones or PSTN for interruption judgments (already in VOICE_AGENT_PLAYBOOK; surface in the harness output).

---

**Bottom line:** the plumbing is now largely correct (crash, timezone, tool-flow, voice all fixed 2026-07-01). The gap is **verification** — integration tests, tool-selection evals, observability, and live-proofing of billing/calendar/reminders. The system looks done in the dashboard and passes CI, but the seams where real bugs live are untested and unmonitored.
