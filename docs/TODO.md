# TODO — SecretaryHQ (single backlog)

**This is the one and only backlog.** Consolidated 2026-07-05 from the former
`GAPS.md`, `IMPROVEMENT_IDEAS.md`, `IMPROVEMENTS_TODO.md`, and
`AIASSISTANT_GO_LIVE_TODO.md` (all deleted; their done items + analysis archived
verbatim in `docs/RESOLVED.md` under the 2026-07-05 entry).

Items are ordered by what should be done first. Ownership tags:
`(Dale)` = user/ops action, no code · `(code)` = codeable now · `(blocked)` = waiting on an external gate ·
**untagged** = deferred code work (the P3 / UX / doc-hygiene sections — no per-item owner because nothing there is scheduled).

**Not backlogs (left as reusable procedure/reference, do not fold here):**
`docs/BRANCH_CHECKLIST.md`, `docs/CODING_STANDARDS.md`, `docs/DEPLOYMENT.md`,
`docs/DEVELOPMENT_WORKFLOW.md`, `docs/ALERTS.md`. Completed work + history: `docs/RESOLVED.md`.
Voice/Telnyx go-live ops detail + incident recovery: `docs/RUNBOOK.md` §7.

---

## Next items to fix (coverage/build/deploy review)

- [x] ~~Commit E2E sweep fixes (20 defects, 4 livelocks)~~ — **DONE 2026-08-19**: Merged in PR #344 (`41c4d53`).
- [x] ~~Deploy recent changes to prod (Railway lags)~~ — **DONE 2026-08-19**: Deployed to Railway (`started_at` `2026-08-19T08:22:19Z`). Verified `GET /health` (200) and `POST /demo/start` (200).
- [x] ~~Create PR for main (protected branch)~~ — **DONE 2026-08-19**: PR #344 merged to `main`.
- [x] ~~Clean working tree~~ — **DONE 2026-08-19**: `main` clean.
- [x] ~~Refresh V8 coverage (stale since 05-22, run with DB)~~ — **DONE 2026-08-19**: reran root and dashboard coverage; `docs/TEST_COVERAGE.md` refreshed with exact totals.
- [x] ~~Setup test DB (fix 9 RLS failures)~~ — **DONE 2026-08-19**: `npm test` now passes at repo root (`2750 passed (2750)`), so the prior `app_user` / test_db RLS blocker is gone.
- [x] ~~Sync docs (TEST_COVERAGE, DEPLOYMENT, HANDOFF with current code)~~ — **DONE 2026-08-19**: refreshed counts/coverage/handoff and corrected deployment env wording.
- [x] ~~Test voice naturalness on simulator (inflections, pauses)~~ — **PARTIAL 2026-08-19**: a live browser-simulator call against prod surfaced two real defects. (1) Fixed: `agent/src/checklist/checklistTools.ts` — `job`/`fix_computer` co-selected with `generic_subject` left `generic_subject`'s own "what does this concern?" node open even after the topic was already known, so the caller got asked a second time; now backfilled from `TREE_TOPIC` same as `meeting_topic`. (2) Instrumented, not fixed: no engine-level inflection/pacing control exists (Aura's WS path rejects `?speed=`) and nobody had turn-latency numbers to diagnose "long pauses" from — `agent/src/session/watchdog.ts` now logs `turn_latency_ms` (INFO, WARN at ≥2500ms) on every turn, both the plain-transition and reply-queued-behind-filler paths. Next: pull `turn_latency_ms` from a real prod call (Better Stack) to find where the time actually goes before attempting a fix.
- [x] ~~Pull turn_latency_ms from a real prod call~~ — **DONE 2026-08-19, and it found the instrument was BROKEN.** Pulled `voice_sessions.transcript` + Railway logs for a real post-deploy call (`sim-call-1787158785189`, John Jones / job inquiry, 207s). Two real defects, both fixed on `fix/hiring-for-prefix-and-live-turn-latency`: **(1)** the transcript showed a clean re-ask the caller had to repeat — "Are you hiring for your own company... or placing with a client?" → caller answers plainly → agent asks AGAIN "just to be clear" 8s later. Logs showed why: the model recorded `hiring_for` as `"hiring_for_own_company"` (fused the node_id onto the valid option `own_company`), `tracker.record()` rejected it as an unknown option and the model, instead of silently retrying with the corrected key its own rejection message handed it, re-asked the caller. Fixed in `tracker.ts`'s choice-value check: strip a `${nodeId}_` prefix before rejecting, so this ONE mistake shape is accepted rather than round-tripped through the caller. **(2)** `turn_latency_ms` (shipped a few hours earlier, same day) **never once appeared in the log for this call** — zero occurrences, despite two turns that took 17s and 20s of real dead air per the transcript timestamps. Root cause: it was added inside `attachOutputWatchdog`, which is gated behind `ENABLE_OUTPUT_WATCHDOG`, and **prod runs that flag OFF** (`agent/src/index.ts` line ~1770 says so explicitly — the fact was already documented, just not connected to the new instrumentation before shipping it). Moved the same logging into `attachSilentTurnRecovery`, which is unconditional and the only thing that actually runs on every prod call. Both fixes have unit test coverage (`tracker.test.ts`, `watchdog.test.ts`).
- **OPEN, needs Dale's ear, not mine:** the 17s/20s dead-air turns are real and still uncovered — `ENABLE_OUTPUT_WATCHDOG` (the hold-line/filler backstop, `watchdog.ts`) would speak "Just a moment" into gaps exactly this size, but it is deliberately OFF pending a human validating it on a real call (`docs/VOICE_AGENT_PLAYBOOK.md` RULE 10.2 / RULE 8.1, `docs/RESOLVED.md`: "Real-call validation (Dale, not CI)... flag stays OFF until confirmed"). The code was already retuned after the LAST time it was tried (2800ms deadline, honest non-claiming filler text) but nobody has re-enabled and listened since. Recommend: set `ENABLE_OUTPUT_WATCHDOG=true` on the `secretary-hq-agent` Railway service, place one real test call, confirm the filler feels like cover and not a stutter, keep or revert.
- [x] ~~Reminder pipeline totally dead since 2026-08-06~~ — **FOUND AND FIXED 2026-08-19** on `fix/reminder-claim-status-constraint`. The atomic claim from #322 wrote a `status` the CHECK constraint rejected, so every tick threw and **zero reminders or confirmations were sent for 13 days** while the worker reported itself healthy. Migration `20260819000000` + `processReminder` accepting `'sending'` + `releaseStaleClaims()`, guarded by a real-DB regression suite. Full write-up in P0 §4b below and `docs/LESSONS_LEARNED.md`.
- **(Dale) DEPLOY ORDER FOR `20260819000000` — CODE FIRST, THEN THE MIGRATION. This is the REVERSE of the house rule, and the reversal is deliberate.** The standing rule ("prod DB migrations go in ahead of the merge") is right for an ADDITIVE migration that new code will start using. This one is different: prod is ALREADY running code that writes the value the constraint rejects, so widening the constraint changes prod behaviour on its own, with the old code still live.
  - **What applying the migration alone would do:** `origin/main` today writes `status='sending'` in the claim (#322), gates `processReminder` on `!== 'scheduled'`, and has **no** `releaseStaleClaims`. Widen the constraint and the claim starts SUCCEEDING — rows flip to `'sending'`, `processReminder` reads one, sees `'sending'`, returns, and the row is stranded permanently because the claim query only ever selects `'scheduled'` and nothing in prod recovers it. The worker counts each one as processed. That turns today's loud, harmless, total outage (nothing is written at all) into a **silent leak that damages rows** — strictly worse.
  - **Correct sequence:** (1) merge PR #350; (2) confirm the `secretary-hq` backend deploy actually landed (`/health` `started_at` moves — Railway can silently skip, see the SKIPPED-is-terminal note in `CLAUDE.md`); (3) THEN `npm run db:migrate -- "<prod DATABASE_URL>"`. Between (1) and (3) prod behaves exactly as it does today: still broken, still harmless.
  - **Confirm recovery** after step 3: no new `errors_total{event="reminder_batch_failed"}`, `reminder_schedules` rows moving past `'scheduled'`, and nothing accumulating in `'sending'`.
  - **The general lesson:** "migrations before merge" assumes the migration is inert until new code uses it. When the RUNNING code already emits the value a constraint blocks, the constraint is a live behavioural gate and relaxing it deploys a change by itself. Ask which side is already emitting the value before choosing the order.
- Fill real TELNYX_PUBLIC_KEY in .env

## 🔴 Flaky gates that block PROD DEPLOYS (2026-08-20)

A red `main` CI run makes Railway mark that commit's deployments **SKIPPED, and
SKIPPED is terminal** — turning CI green afterwards does not retry. So a flaky
test is not a nuisance here, it is a mechanism that silently stops merged code
from reaching production while every service reports healthy. Both of these
turned `main` red on `2aa61d4`.

> **THE PATTERN MATTERS MORE THAN ANY ONE OF THESE.** Three _different_ tests
> turned CI red on 2026-08-20 — `purge-soft-deleted` (timeout mismatch),
> `customer-preferences-config` (E2E, cause unproven), and
> `SetupWizard > shows success state with phone number after activation`
> (dashboard, passes locally, 1,115 ms under CI load). Only the first had a
> diagnosed cause. In a repo where a red `main` makes Railway skip the deploy
> **terminally**, CI flakiness is not a test-hygiene issue — it is an
> availability issue for shipping. If a fourth appears, stop adding features and
> treat runner contention as the bug: the common factor in all three is a
> wall-clock expectation meeting a loaded runner.

- [x] **`scripts/purge-soft-deleted.test.ts` — two timeouts that disagreed.** The
      harness gives its subprocess a 60s budget (`spawnSync timeout: 60_000`)
      while vitest's default test timeout is 5s, and the shorter one was arrived
      at by accident. Every case spawns `npx tsx`, paying npx resolution plus a
      TypeScript compile before the script runs — seconds, not milliseconds. On a
      loaded runner the happy-path case took **5,862 ms** and vitest killed it at
      5,000. All five cases now carry an explicit `SUBPROCESS_TEST_TIMEOUT_MS`
      matched to the subprocess budget, so a genuine hang is reported by
      `spawnSync` with its exit status and output rather than by vitest with a
      bare "timed out". Same class as the `PERF_ASSERT` fix: **the test was
      asserting the machine's speed, not the code's behaviour.**
- [ ] **Dashboard flake, not yet diagnosed** —
      `SetupWizard.test.tsx > shows success state with phone number after activation`.
      Failed once on 2026-08-20 (#362's run) and passes locally in isolation; took 1,115 ms on
      the CI runner. Not patched — one occurrence is not a diagnosis, and
      guessing at a fix for a timing-sensitive React test usually produces a
      test that passes for a new wrong reason. Recorded so the second occurrence
      is recognized as a pattern rather than investigated from scratch.
- [ ] **`customer-preferences-config.spec.ts` — root cause NOT yet proven.** It
      has now failed twice on 2026-08-20, on two different PRs, always the same
      way: the save succeeds, the toggle persists (`aria-checked=true` passes),
      and the guidance textarea comes back **empty** after the reload. Serial
      execution (`workers: 1`, `fullyParallel: false`) rules out cross-spec
      interference, and the backend merge semantics are correct
      (`body.preferences_instructions !== undefined ? … : prior`), so the two
      obvious explanations are already eliminated. **Not blind-patched.** What
      shipped instead makes the next occurrence diagnostic: the test now waits on
      the actual `update-config` RESPONSE rather than the "Saved!" label, and
      then asserts the value is IN POSTGRES before reloading — so a failure
      before the reload is a write bug and a failure after it is a read/render
      bug, which the previous version could not distinguish. If it recurs, read
      which assertion failed first.
  - **Also fixed here, and it was a real landmine:** the spec's `afterAll` ran
    `UPDATE tenants SET save_preferences_enabled = false, preferences_instructions = NULL`
    with **no WHERE clause** — resetting every tenant in the database. Harmless
    only because `workers: 1` pins serial execution; the day anyone raises that
    for speed it becomes cross-spec corruption presenting as a flake somewhere
    else entirely. Now scoped to the one tenant the spec edits.

---

## 📞 Live-call fix series (2026-07-30) — see `docs/CALL_FIX_PLAN.md`

The 12 real calls from 2026-07-26/27 (`CALL_IMPROVEMENTS.md`, root) produced an
8-batch PR plan: **G** (job-call capture completeness — role_description dropped
end-to-end, outcome mislabel, false "message" promise, stall detector, offer-meeting
on the live path) → **H** (per-call tool-call log + transcript fidelity) → **A**
(caller context/appointments reach the model) + **B** (booking mechanics, timezone,
cross-call duplicates, roster) → **C** (availability reason codes) → **D**
(corrections propagate) → **E** (junk "Caller" rows, urgency) → **F** (silence
handling, greeting metric, inbox unification). Full detail, cut lines, and the four
recurring failure classes: `docs/CALL_FIX_PLAN.md`.

---

## 📞 Live-call fix series (2026-08-13) — see `CALL1.md` / `CALL2.md`

Two real calls from the same caller (`+1 262-497-9039`, Camille), three minutes apart,
on tenant Thinking Hammer: `SCL_3a8SkDKzxN4B` (19:46 CT, message) and
`SCL_KLvqZ2JkaQFU` (19:49 CT, booked). Both were recruiting calls. Both wrote **zero**
`job_inquiries` rows. Full transcripts, persisted tool traces, and per-finding evidence
in `CALL1.md` / `CALL2.md` at repo root.

**Root cause, one line:** `job` sat in `forbidden_trees` on all three presets while
`ChecklistOverrides` could only SUBTRACT blocks — so **no configuration of any tenant
could select the job tree.** On CALL1 the model read the caller correctly, declared
`work_direction: caller_offers_owner_work`, and re-issued `set_purpose` to add `job`
16 ms later; the host answered `No tree called "job"`. `capture_job_inquiry` never
entered the toolset, the goodbye gate never saw the tree, and the call closed clean.

**Shipped on `fix/job-tree-unreachable`** (all green: agent 1622, backend, dashboard):

- [x] **A** — `owner_for_hire_front_desk` preset + derivation + dashboard picker + the
      `/tenants` Zod enum; `presetCatalog.test.ts` now **fails CI on any platform tree
      no preset can reach** (`fix_computer` is the one declared exception).
      `scripts/pin-owner-for-hire-preset.sql` pins the tenant explicitly — **Dale runs
      it, AFTER the agent deploys** (an unrecognized preset id falls back to today's
      broken state, so running it early is a silent no-op).
- [x] **B** — an unselectable-tree refusal is no longer silent, and no longer wears the
      same sentence as an invented tree name; `ToolCallLog` now persists a redacted
      tool RESULT, not just args and a did-not-throw flag.
- [x] **C** — host-side refusal of a booking the caller has not confirmed; a failed
      booking can no longer be relayed as "the owner is not available".
- [x] **D** — the two AI cost tables collapsed into one. The route was costing every
      call with a copy that knew only `gpt-4o-mini`, so the production voice LLM and
      all TTS recorded **$0.00**; the ledger reported 2.8–4.3% of the real bill.
- [x] **E** — the appointment now carries the meeting subject + volunteered context;
      `message_body` must stand alone.
- [x] **F** — the under-selection nudge no longer tells the model to add a tree the
      tenant cannot select; a recognized caller is never asked her name; greeting
      latency is now instrumented (`ms_since_participant` on `greeting_spoken`).

**Still open from these calls:**

- [ ] **(Dale)** Run `scripts/pin-owner-for-hire-preset.sql` against prod after deploy,
      then place a test call and confirm a `job_inquiries` row lands.
- [ ] **(Dale)** Read the first `greeting_spoken` `ms_since_participant` values off
      prod. Both calls showed the greeting at `[0:17]` on the transcript clock, which is
      NOT the caller's clock — nothing is worth optimizing until the real number is in.
      **MEASURE before fixing.**
- [ ] **Re-price the tiers** once the cost ledger has a few honest calls in it. P0 §2
      below is being decided against numbers that were ~35× too low. CALL2 really cost
      about **$0.068** for 96 seconds, dominated by **137,971 input tokens** —
      ~17k/turn, the checklist state block plus tool schemas resent every turn. That
      per-turn context is the product's whole cost curve and is now visible for the
      first time.
- [ ] **Do NOT "fix" the service semantic match by prefixing the query.** Measured and
      rejected 2026-08-13 (`scripts/probe-service-match.mjs`): `"a meeting about …"`
      lifts every score by roughly a constant, so `"four-wheel alignment"` (0.1739 →
      0.3571) clears the 0.35 threshold onto Programming Consultation. It defeats the
      threshold instead of improving discrimination — a confident wrong booking in place
      of a safe fallback. Recorded here because it looks like an obvious win.

---

## 🔬 E2E observation sweep (2026-08-15) — reading the output, not just the asserts

Run: `SIM_TRACE=1 npx tsx agent/scripts/sim-questiontree.ts` (real LLM caller vs the
real `ChecklistAgent` + real tracker + real toolset; backend tools faked) and
`agent/scripts/sim-offscript.ts`. `./scripts/simulate.sh tools --env local` was clean —
16/16 links passed, 0 gaps. The findings below are things the graders do **not**
assert and would not have reported: the first scenario's grader says "book never
completed", which is true and is the least interesting thing that happened.

Evidence: scenario `DALE'S CALL — meeting about a job` (trace kept in the session
scratchpad). Caller picked a time, was told the meeting was booked, and no booking
ever happened; the call then could not end.

- [x] **(code) E2E-1 — the booking guard and the goodbye gate deadlock the call.**
      `slotsAwaitingChoice` (`agent/src/checklist/checklistTools.ts`) is set by
      `wrapSlotReader` and cleared in exactly ONE place: a **successful** booking. A
      booking the guard itself refuses therefore cannot clear the condition that
      refuses it. Worse, the guard `return`s before `failCounts` is touched, so
      `ACTION_FAILURE_LIMIT` — the existing "stop retrying, take a message" escape
      hatch — never engages for a refusal, only for a real backend failure. Observed:
      **12 refused `book_with_scheduling` calls and 4 refused `finish_call` calls in
      one conversation**, the caller saying goodbye twice, and the run ending only
      because the harness caps at 48 rounds. On a phone line there is no 48-round cap.
- [x] **(code) E2E-2 — the agent verbally confirmed a booking that never happened.**
      With zero successful writes it said _"The meeting is set for tomorrow, Tuesday,
      July 22 at 1:15 PM. You'll be talking with the owner then."_ and then, four
      turns later, _"I'm still finalizing your meeting."_ This is the same class as the
      Telnyx false "sent" and the narrated-lookup filler: the caller hangs up believing
      a thing exists that does not. The anti-double-book gate has no anti-phantom-book
      twin — nothing tells the model "you have never successfully booked; do not say
      you have."
- [x] **(code) E2E-3 — the refusal misdiagnoses, so the model cannot act on it.** The
      caller HAD picked a time ("I'll take the 1:15 slot"); the model's call was
      `book_with_scheduling({"start_time":"Tuesday, July 22 at 1:15 PM"})` — a field
      that is **not in the tool's schema at all**, with all four required params
      (`service_type`, `window_from`, `window_to`, `phone`) omitted. `namesOneInstant`
      only reads `requested_start` (or a zero-width `window_from`/`window_to`), sees
      neither, and answers _"the caller has not picked one"_. That sentence is false
      and points the model back at a question already answered. The refusal must name
      what is actually missing.
- [x] **(code) E2E-4 — `sim-offscript` grades an OpenAI 429 as a behavioural failure.**
      9 of 12 cases errored on TPM rate limit and the run printed **"3/12 passed
      (25%) — threshold 80%"**, which reads as a catastrophic model regression when
      the model was never asked. `sim-questiontree` already retries (5 attempts);
      `sim-offscript` has no retry and no separate exit path for infrastructure error.
      A red eval that is red for the wrong reason is worse than no eval.
- [x] **(code) E2E-5 — a message asking for a callback was taken with no number.**
      Scenario WEDDING MESSAGE, and it **PASSED**: `set_purpose` selected
      `message + generic_subject` and _not_ `identity`, so `caller_phone` was
      never on the checklist. Grace Okafor said "I'd love for him to call me back", the message
      was written, the call closed clean, and there is no way to reach her.
      "Include identity whenever a goal needs a contact" was a prompt rule.
- [x] **(code) E2E-6 — `caller_name` was recorded as the literal string "caller".**
      Scenario DALE'S CALL: `set_purpose` arrived with `caller_name: "caller"` before
      a question had been asked, the checklist showed ✓, and the agent never once
      addressed him — nothing to say. That is a permanent phone-book row named
      "caller", the junk-`Caller`-row shape arriving through a working mechanism.
- [x] **E2E-7 — the model invents parameter and node names, and only booking dies of
      it.** Observed in one run: `book_with_scheduling({start_time})` (not a param),
      `capture_job_inquiry({role})` (not a param — `role_description` is), and five
      invented node ids in a single turn (`role_title`, `role_salary_range`,
      `role_location`, `role_company_name`, `role_employment_type`) each costing a
      round trip. The captures survive because `ACTION_ARG_BACKFILL` refills them
      from the tracker; booking did **not**, because its required params were not
      backfilled. Partly addressed (`service_type` + `name` now backfill); the
      general lesson is that any required action param with no backfill is one
      model slip from a dead call.
      _(Everything found in this sweep is now fixed — the list below is the record of what
      was wrong and why, not a backlog. The only item left open is E2E-9's cousin: filler
      repetition is addressed in the prompt, which is a request, not a guarantee.)_
- [x] **E2E-10 — `agent/` has pre-existing Prettier drift in 23 files.**
      Root `npm run checks` does not cover the agent package's format check, so
      `cd agent && npm run format:check` is red on work that predates this sweep
      (`src/tools.ts`, `src/transcript.test.ts`, `src/toolCallLog.ts`, …). Not fixed
      here — reformatting 23 files would bury the behavioural diff. Worth either
      folding the agent format check into `npm run checks` or running
      `cd agent && npm run format` as its own commit.
- [x] **E2E-9 (minor, conversational) — filler repetition.** Four of the seven intake
      turns opened with the identical string _"Thanks for that."_ Not asserted
      anywhere, and exactly the "Absolutely! / Great!" tic already in Known Issues.

**End state:** `sim-questiontree` **22/22**, zero errors, zero livelocks — from a
first run that deadlocked on scenario 1 and never reached scenario 9. `sim-offscript`
12/12. `sim-toolselect` 11/13 (85%, exit 0). `simulate.sh tools` 16/16, 0 gaps.
Agent suite **1687** green, tsc + lint + root format + `verify:claude-md` clean.

**Left deliberately unfixed, with reasons:**

- [ ] **`sim-toolselect` grades the LADDER, which production does not run.** Its cases
      are built on `start_booking` / `manage_appointment` routers and `toolPhases.ts` —
      the `SpeakingAgent` path, reachable only with `ENABLE_QUESTION_TREE=false`. Its
      two standing failures are therefore statements about dead code. Pointing it at
      the prod model (E2E-12) was worth doing because the model IS shared; rewriting
      the cases onto the checklist path is a real piece of work and should be a
      decision, not a side effect of a bug sweep. **Its pass/fail set also moves
      between runs** (2026-08-15: 11/13 both times, but a different two failed), so
      treat it as a trend line, not a gate.
- [ ] **`trees.ts` changed — tenant DB copies are now stale.** `qa_summary`'s wording
      is template content since migration 20260814130000. Run `npm run trees:local`
      locally and the prod tree rollout on deploy, or provisioned tenants keep asking
      the caller to summarize their own question.

**Fourth pass — a fourth livelock, a plural, and a lost sales lead:**

- [x] **E2E-18 — a FOURTH livelock, through the gap the first two fixes left.**
      BUY vs JOB ended with `book` still `ready` for a caller who had said plainly he
      wanted a MESSAGE, not a meeting. `finish_call` was refused (correctly — the
      checklist was open), the model made one malformed booking attempt, then
      **stopped calling tools entirely** and traded farewells for seven turns. Neither
      new hatch could reach it: the resolved-branch nudge needs a COMPLETE checklist,
      and `FINISH_REFUSAL_LIMIT` needs `finish_call` to keep being called. _"Not done,
      and no longer trying"_ is its own failure mode, and the unresolved-stall nudge
      latched after firing once. It now re-fires every `STALL_TURN_LIMIT` turns, names
      the blocking node, and spells out the exit the model never finds by itself:
      **`set_purpose` with `wrong_trees`** when the caller has stopped wanting the
      thing. Without that second exit a caller who changes their mind holds the call
      open forever.
- [x] **E2E-19 — the role matcher only knew the SINGULAR.**
      `meetingTopicNamesOwnerRole` matched `job opportunity` but not
      `job opportunities` — in a scenario literally named _"talk with Dale
      about job opportunities"_. The topic guard (E2E-8) worked, the model re-asked, the caller
      said "About the job opportunities", and the matcher missed the plural: no job
      tree, no role intake, a 15-minute meeting with no subject. Plural is the more
      natural of the two phrasings and it was the one that failed. Plurals added
      throughout; bare "a job" / "some jobs" still excluded (a SERVICE request here).
      **JAYA REPLAY 2/2.**
- [x] **E2E-20 — the warmest lead in the suite was filed as a note.** Neil Ashford, a
      dental-clinic owner who wanted to BUY the product, opened with _"I wanted to
      talk to someone about a business opportunity"_. The model asked nothing,
      selected `message`, and wrote "Neil Ashford called about a business
      opportunity." No business type, no call volume, no current setup, no email, no
      demo. The work-direction gate and the prompt's one-clarifying-question rule
      both only fire when the model SELECTS job or buy_service — selecting **neither**
      had no cover, the same omission shape the job under-selection nudge exists for.
      `record_answer` on `message_body` now nudges for that one question when the text
      sits on the buy-vs-job axis. A nudge, not a refusal, and the phrase list is
      deliberately tiny: a nudge that fires on every message is one the model learns
      to skip. **BUY vs JOB 2/2.**

**Third pass — two more defects, both visible only in the transcript of a scenario
whose grader reported something else entirely:**

- [x] **E2E-16 — a prospect who booked a demo was recorded as having DECLINED one.**
      BUY THE SERVICE: Dana said _"Yes, I'd be happy to book a demo any time you have
      available"_, the demo was booked (`book: done`) — and `demo_offer` stayed open,
      so the goodbye gate refused to close, so the model went looking for the missing
      item and asked an already-booked woman whether she'd rather just have the
      details emailed. She said email. The host wrote `demo_offer: not_now`. **The
      record now contradicts the appointment, and the lead reads as cold.** This is
      the `meeting_offer` bug exactly — fixed on the booking tree in the first pass —
      reappearing on `buy_service`, the same node one vertical over. Now keyed by
      node id (`BOOKING_CLOSES_OFFER`) so the next vertical is one line, not another
      postmortem. The caller's own answer still wins: `recordIfOpen`, never overwrite.
- [x] **E2E-17 — the host's own error message taught the model to speak an internal
      token aloud.** Same trace: the caller said "calls go to an answering service",
      the model recorded `"answering service"`, the tracker refused with _"The options
      are exactly: voicemail, answering_service, a_person, nothing"_ — and the model's
      very next spoken sentence was _"would you say your calls go to an
      **answering_service**?"_, underscore and all. That is the 2026-07-21 live-call
      defect the prompt has forbidden ever since ("record them exactly, but NEVER
      speak them"), reproduced by the runtime handing the model raw tokens at the
      exact moment it was composing a question. The refusal now prints each id with
      its spoken form and says plainly not to say them to a caller. **A rule in the
      prompt cannot outrank an example in a tool result.**

**Second pass — what closing the last items turned up.** Each of these was found by
building the guard, not by another call:

- [x] **E2E-7** — new `agent/src/checklist/actionArgCoverage.test.ts`: every required
      param of every action tool a tree can fire must be backfilled, host-supplied at
      runtime, or **declared model-only with a reason**. It failed on its first run
      against two tools no sim had ever reached: `cancel_appointment` and
      `reschedule_appointment` both require `appointment_id` — a **UUID the model can
      only get by copying it out of a `get_my_appointments` result and retyping it
      mid-call**, against this project's own "the model never holds a UUID" rule.
      Fixed rather than declared: `get_my_appointments` is now wrapped, and when the
      lookup returns **exactly one** appointment the host fills the id itself
      (`soleAppointmentIdIn`). Two or more stays the model's choice — guessing which
      booking to cancel is the unconfirmed-booking mistake with a worse ending.
- [x] **E2E-14b** — the structural half. `answer_question` now detects the backend's
      RAG no-answer line and **selects the message + identity trees in host code**, so
      an unanswerable question puts taking a message on the checklist and the goodbye
      gate holds the door. The two packages share no import, so
      `tests/routes/agentTools/policyFallbackContract.test.ts` pins the sentence on
      both sides — reword one and CI fails rather than the guarantee silently dying.
- [x] **E2E-15** — the abort test now drives **fake timers** instead of a stopwatch. It
      was asserting the machine's speed, not the code's behaviour; the real invariant
      is "the TIMER is what ended the call", and `fetchImpl` never resolves, so nothing
      but the abort can return at all.
- [x] **Two backend tests of the same class**, found by grepping for wall-clock
      assertions after the backend suite went 2-red under load and green on a quiet
      box: `tests/services/scheduling-atomic.test.ts` asserted `avg < 50ms` and
      `newAvg < 100ms` against a **real Postgres round trip**. The tight budget is now
      opt-in (`PERF_ASSERT=1`) behind a loose always-on ceiling — and the test named
      _"compare: old 4-query approach timing"_, which never compared anything, now
      asserts the ratio it always claimed to.
- [x] **E2E-10** — `agent/` formatted, and the reason it drifted is closed: root
      `npm run checks` never ran the agent package's format/lint/typecheck. New
      `checks:agent` step, wired into `checks`.
- [x] **E2E-9** — the speaking-style rules now forbid opening two turns with the same
      words, naming the observed tic. Prompt-tier, so a request rather than a
      guarantee — noted as such.

**Fixed in the first pass** (all in `agent/src/checklist/` unless noted):

- [x] **E2E-1** — `BOOKING_GUARD_REFUSAL_LIMIT`: the guard stands down after two
      refusals instead of holding an offer open forever, and a fresh
      `get_available_slots` restores its budget so the stand-down is never permanent.
- [x] **E2E-8** — `topicNamesOnlyAPerson()`: a `meeting_topic` that names only WHO
      ("talk with Dale", "speak with the owner") is refused, and the refusal asks for
      the subject. The node's own text has forbidden this since the 2026-07-27
      postmortem; the model broke it on roughly **half** of JAYA REPLAY runs, and each
      time the topic never named a role, so `meetingTopicNamesOwnerRole()` never fired,
      the job tree was never added, and a recruiter's call produced a 15-minute meeting
      with no subject. Matched on SHAPE (a verb of meeting + a person, no "about"), so
      it needs no staff roster and "talk with Dale about the Java contract" passes.
      **JAYA REPLAY went from ~50% flaky to 3/3.**
- [x] **E2E-14a** — `qa_summary`'s ask now says whose job it is ("YOU write this,
      silently — NEVER ask the caller to summarize their own question") and points an
      unanswerable question at the message tree instead of the exit. THE ELSE went
      ✗ FAIL → ✓ PASS twice running. **NB this edits `trees.ts`, which is now also
      template content in the DB — run `npm run trees:local` (and the prod rollout)
      or tenant copies keep the old wording.**
- [x] **E2E-13 — a THIRD livelock, and the one neither gate could see: the model
      never called `finish_call` at all.** Scenario BUY THE SERVICE, checklist fully
      RESOLVED (demo booked, every field answered), and the agent then traded
      farewells with the caller for twenty turns — "Goodbye!" / "Goodbye!" /
      "Goodbye! If you need anything else, just call back." — until the harness's
      round cap. The existing stall detector fires ONCE and says "wrap up the call",
      which the model satisfied with a sentence, repeatedly.
      `ChecklistAgent.onUserTurnCompleted` now has a resolved branch
      (`GOODBYE_STALL_LIMIT`) that
      REPEATS and names the missing fact: _saying goodbye does not end the call, only
      `finish_call` does_. Deliberately conditional — a caller may still ask something
      after the checklist completes. **Verified: scenario went ✗ FAIL (call never
      closed) → ✓ PASS.**
- [x] **E2E-1b** — `FINISH_REFUSAL_LIMIT`: the goodbye gate escalates its wording on
      the second refusal and releases the call on the fifth, logging
      `goodbye_gate_released` with the unmet nodes. `tracker.unresolvedNodeIds()` is
      new and is what makes that log readable.
- [x] **E2E-2 / E2E-3** — the refusal now names the invented field, lists the required
      args actually missing (measured AFTER backfill, so it never sends the model
      chasing values the host supplies), and ends _"NOTHING IS BOOKED: do not tell the
      caller the meeting is set."_ **Measured effect:** on the JAYA REPLAY scenario the
      model corrected itself on the very next call and booked — 12 refusals and a
      never-ending call became 1 refusal and a clean close.
- [x] **E2E-4** — `sim-offscript` retries 429/5xx five times honouring `Retry-After`,
      grades only cases that reached the model, and exits **2** (infrastructure) rather
      than 1 (model regression) when any case never got an answer. **Confirmed by
      re-run: 25% → 12/12 (100%), exit 0** — the model had never regressed at all.
      `sim-questiontree` carried the same defect one level up (`catch { fail++ }`) and
      got the same treatment: its 2026-08-15 "16/22" was 16 passes, ONE real failure,
      and five scenarios that never ran.
- [x] **E2E-5** — `CONTACTLESS_TREES`: the host adds `identity` to any selection that
      produces a record. `qa` alone is the deliberate exception — someone asking your
      closing time must not be interrogated for a phone number.
- [x] **E2E-6** — `placeholderNameReason()` refuses `caller` / `customer` / `unknown`
      / `n/a` and friends on both doors (`record_answer` and `set_purpose`'s own
      `caller_name` arg), leaving the node open so it is asked again.
- [x] **E2E-12** — `sim-toolselect` was grading **`gpt-4o-mini`**, the model production
      stopped using on 2026-07-20, and its own comment claimed that was "the same model
      the agent runs". The default now follows `agent/src/index.ts` to `gpt-4.1-mini`:
      the suite went **10/13 (77%, exit 1) → 11/13 (85%, exit 0)** with no other change.
      The irony is exact — 4o-mini was replaced _because_ it never scored a clean suite
      here, and the eval kept scoring it. (The two survivors are real and unfixed: a
      full-call booking case, and one where the model refuses a Sunday time and calls no
      tool at all, which may be the grader's bug rather than the model's — untouched
      because a same-day eval rewrite is how you get a green suite that means nothing.)
- [x] **E2E-11** — a company field that is character-for-character the caller's name
      is refused (`COMPANY_NODES`). Found on the re-run: with the booking deadlock
      gone, DALE'S CALL got all the way to a clean close and the ONLY remaining
      grader failure was `callers_company = "Marcus Webb"` — the caller had plainly
      said "I'm calling from Bell Labs", and the owner would have opened a lead whose
      employer is a person.

---

## 🔴 P0 — Launch blockers (clear before the first paying customer)

Ordered: the product must answer + transfer + book on a real call, then take money,
then be gated/insured. Most of this is your action, not code — the code is shipped.

### 1. Voice path — make a real call work end-to-end

_Post-live voice enhancements (recording disclaimer, etc.) live in **🎙️ Voice — Phase 2** at the bottom of this file._

- [x] **(Dale)** Enable **call transfer / REFER** on the Telnyx SIP Connection (`livekit-outbound`). ~~Until then `transfer_call` fails at runtime and the agent silently degrades to taking a message.~~ **RESOLVED 2026-07-07**: No toggle exists in Telnyx UI — FQDN connections support SIP REFER by default. Nothing to configure.
- [x] ~~**(Dale)** Confirm `TELNYX_API_KEY` + `TELNYX_SIP_CONNECTION_ID` are set on Railway~~ — **DONE 2026-07-09.** All three present. **`TELNYX_PHONE_NUMBER` held the DEAD `+16308661960`** (order deleted); corrected to `+16308229086` and the backend redeployed (`started_at` `23:49:38Z`).
  - **What it was breaking:** the var is the outbound-SMS `from` fallback (`tenantConfig.inboundPhone || process.env.TELNYX_PHONE_NUMBER`, `smsService.ts:66,147` + `appointments.ts:710`). Any tenant without its own `inbound_phone` was sending confirmations/reminders from a number Telnyx no longer owns → provider rejects → silent `status='failed'` rows in `communications_history`. **Inbound voice was unaffected** (routing is Telnyx number → SIP Connection, not this var), which is why the 2026-06-30 live-call test passed while SMS was broken.
  - **Why nothing caught it:** `featureReadiness.ts:68,81` checks only that the var is _set_, never that Telnyx still owns the number. A set-but-dead credential reads as healthy.
  - Only the backend reads this var — `agent/` and `dashboard/` never do (agent takes the transfer target from tenant config, not env). Single fix sufficed.
- [ ] **(Dale, use wife's phone)** **Live validation call** — do these steps together in one sitting:
  1. Set the **forward number** on the dashboard AI Persona → "Forward Calls to a Person" (`+1 608 217 5303`) before calling.
  2. Have wife call `+1 630-822-9086` (must use her phone — can't call from your cell and forward to it).
  3. Validate booking: appointment lands in `appointments` for tenant `d5e3c6a1` inside a real shift window.
  4. Validate transfer: say "talk to a person" → your cell rings + Calls tab shows the transcript.
  5. Validate dialog: agent asks preferred time, widens when none fit, never imposes a slot, recalls preferences across calls.
     (PSTN inbound itself already confirmed 2026-06-30; this closes the booking + transfer + preference legs.)

### 2. Billing — be able to take money

- [ ] **(Dale)** **Decide final tier pricing** before creating Stripe products — current placeholders ($129/$279) have not been validated. Research findings + cost model (2026-07-07):
  - **Variable cost per call (5-min avg):** Telnyx ~$0.03 + LiveKit ~$0.02–0.05 + Deepgram STT $0.02 + OpenAI LLM ~$0.001 + TTS ~$0.02–0.09 = **~$0.09–0.17/call**
    - ⚠️ **Stale input (flagged 2026-07-28):** the TTS figure is OpenAI's, and TTS moved to **Deepgram Aura** on 2026-07-14. The LLM also moved 4o-mini → **4.1-mini**. Both legs need re-pricing from current provider rates before this model is used to set a price — deliberately NOT guessed here.
  - **Loss point:** an uncapped Solo tier at 1,000 calls costs $90–170 in variable cost alone — near-zero or negative margin at $129/mo
  - **Recommended Solo cap: ~300–400 calls/month** → variable cost ~$27–51, gross margin ~$78–102 on $129/mo
  - **Competitor benchmarks (verified July 2026):** Rosie AI $49/$149/$299 (250/1,000/2,000 min); Goodcall $79/$129/$249/agent (100/250/500 unique customers/mo); Signpost $199/$399/$749 (AI-only → hybrid human+AI)
  - **Key differentiator to keep:** include booking + call transfer at ALL tiers — competitors (Rosie, Goodcall) gate these to mid-tier. Lead with "full receptionist from day one."
  - **Suggested tier shape:** Solo ~$99–129/mo (1 location, ~300 calls/mo cap, full booking+transfer) · Growth ~$199–249/mo (multi-location or higher volume, Square CRM sync, analytics) · Pro ~$349+/mo (unlimited volume, priority support)
  - **Volume metering is NOT built yet** — tiers are flat subscriptions today; cap enforcement + usage meter is a P1 build item (see P2 section below). Go flat-rate for first customer, retrofit volume once real usage data exists.
- [ ] **(Dale)** **Stripe setup — part A: test-mode wiring. NO BANK ACCOUNT NEEDED.** A bank account gates **payouts**, not API configuration; every step below works today on the `sk_test` key prod already carries. Test mode has its own separate keys and webhook endpoints, so none of this touches live money. Only the pricing decision above is a real prerequisite (price IDs get baked into env vars).
  1. **Create products + prices** in Stripe **test mode** — Solo, Growth, Pro. Note the 3 price IDs.
  2. **Register the webhook endpoint** in the Stripe dashboard **while it is in TEST MODE** (the toggle top-left — test and live endpoints are separate objects with separate signing secrets): `https://secretary-hq-production.up.railway.app/billing/webhook`, 3 events: `checkout.session.completed`, `invoice.payment_failed`, `customer.subscription.deleted`. Copy the endpoint's signing secret (`whsec_…`) shown after creation.
     - **Status 2026-08-04: NOT registered.** Probed the live account directly — `webhook_endpoints` returns **zero** endpoints, and prod's `STRIPE_SECRET_KEY` is an `sk_test` key. CLAUDE.md's Production section states this URL as if it were wired; it is not. Nothing has ever delivered to it.
  3. **Set 5 env vars on Railway**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (**the `whsec_` from step 2**), `STRIPE_SOLO_PRICE_ID`, `STRIPE_GROWTH_PRICE_ID`, `STRIPE_PRO_PRICE_ID`.
  4. **Test-mode round-trip** (no real money): trigger a test checkout and verify each event activates/revokes the tenant gate. Events arrive at prod from the endpoint registered in step 2 — nothing else to run. (`./scripts/simulate.sh stripe` path-checks the wiring first.)
     - **`STRIPE_WEBHOOK_SECRET` must match whichever path actually delivers, and there is exactly one signing secret in play at a time.** A registered dashboard endpoint signs with ITS `whsec_`; `stripe listen` signs with a DIFFERENT `whsec_` that the CLI mints per session and prints on startup. Point both at prod with one secret configured and every event down the other path fails signature verification with a 400 — which reads like broken webhook code and is not.
     - **`stripe listen` is an OPTIONAL, LOCAL-ONLY alternative** — use it to exercise the handler against a backend on your own machine, never alongside the registered prod endpoint: `stripe listen --forward-to http://localhost:4001/billing/webhook`, then set `STRIPE_WEBHOOK_SECRET` **locally** to the `whsec_` the CLI prints. Do not forward the CLI at the production URL; prod would receive each event twice, and the copy signed with the CLI's secret would 400.
- [ ] **(Dale)** **Stripe setup — part B: live mode. THIS is what needs the bank account.** Do only after part A's round-trip passes.
  1. **Open an LLC bank account** for Thinking Hammer LLC — required before Stripe can pay out. (Also listed under Legal §5 below.)
  2. **Connect bank account to Stripe** — Stripe dashboard → Settings → Bank accounts & scheduling.
  3. **Re-create products + prices in LIVE mode** — test-mode objects do not carry over. New price IDs.
  4. **Register the webhook again in LIVE mode**, same URL and same 3 events, and copy the new `whsec_`. Live-mode endpoints are separate objects from test-mode ones and sign with their own secret — this must come BEFORE the env swap, because the secret does not exist until the endpoint does.
  5. **Swap the 5 Railway env vars to live values** — live secret key, live price IDs, and the **new** `STRIPE_WEBHOOK_SECRET` from step 4. The moment this lands, the test-mode endpoint's events start failing signature verification; that is expected, and it is why part A must be finished first.
- [ ] **(Dale)** **Stripe Tax** (after round-trip verified): enable Stripe Tax in Stripe dashboard → Tax → Settings; register nexus for IL + customer states; set `STRIPE_AUTO_TAX=true` on Railway. (Code done — `automatic_tax` gated behind the flag.)

### 3. Deploy gate — protect main

- [x] ~~**(Dale)** Enable the **"Wait for CI"** toggle on the 3 Railway services~~ — **DONE 2026-07-09.** Enabled on all 3 (`secretary-hq`, `secretary-hq-agent`, `dashboard`) at Railway → Service → Settings → Source → "Wait for CI" ("Trigger deployments after all GitHub actions have completed successfully"). Railway stages settings edits — they only take effect after clicking **Deploy** on the "Apply N changes" banner. The Railway GitHub App already held `checks` + `commit statuses` read/write on all repos, so no permission grant was needed.
  - **Caveat:** this is **unversioned dashboard state** — `railway.json` has no field for it. If a service is ever recreated the toggle silently reverts, and nothing in the repo will tell you. Re-check after any service recreation.
  - **Caveat:** the setting waits on _all_ GitHub Actions on the commit, not on the branch-protection required-checks list. Any future workflow that runs on `main` and can fail will also block deploys.
- [x] ~~**(Dale, code)** **Prove the gate** end-to-end~~ — **PROVEN 2026-07-09 (PR #227).** A deliberately-failing test made `Backend` red → `mergeStateStatus: BLOCKED` → `gh pr merge` **refused** with `the base branch policy prohibits the merge`. Deleting the test flipped all 4 checks green → `CLEAN` → merge allowed. Branch protection holds.
  - **Not tested, deliberately:** `gh pr merge --admin`. If `enforce_admins` didn't hold, that would merge a failing test to `main` and deploy broken code to Railway. The API reports `enforce_admins: true` — verified-by-config, not by experiment.
  - **This proves the MERGE gate only.** The **deploy** gate is still open: after #226 merged, Railway brought up the new backend at `19:27:03Z` while CI didn't go green until `19:31:27Z` — prod deployed ~4 min _ahead_ of its checks. That is exactly what the "Wait for CI" toggle above closes. Branch protection stops a red PR from merging; nothing yet stops a merged commit from deploying before CI confirms it.

### 4. Security housekeeping

- [ ] **(Dale)** **Rotate the Railway team token** created 2026-06-12 — it was pasted into a Claude session. Burn + reissue.
- [ ] **(Dale)** **Rotate the Supabase DB password** — exposed in a session transcript 2026-07-11.

### 4b. Code review 2026-07-13 — four-reviewer sweep (backend, security, reliability, dead code)

> **Adversarially re-reviewed 2026-07-13 (Opus).** Two of my findings were **REFUTED and dropped**:
> **CORS is NOT open in prod** (`curl -H "Origin: https://evil.example.com"` → `access-control-allow-origin: https://www.secretaryhq.com`; Railway sets `CORS_ORIGIN`, only the code _default_ is bad), and my **`message_delivery_status` RLS finding was measured against the LOCAL database and reported as production** — where it is in fact RLS-enabled-with-zero-policies (see 4a). The proposed "fix" would have changed nothing under BYPASSRLS and then been written into `SECURITY.md` as "RLS enforced" — worse than leaving it.
>
> **Severity corrections:** `isTenantExempt`'s blanket `/tenants/*` exemption is **not latent** now that middleware is the sole boundary. The schedule-extender poison is **over-rated** (it is a _future_ regression needing an owner to add a far-future one-off shift — it is NOT the bug that killed the 2026-07-12 call, which was simply "the schedule ran out"). `ENABLE_VOICE_SESSION_REAPER`/`ENABLE_SCHEDULE_EXTENDER`: **my proposed "fix" was a regression** — those vars _do_ work outside production (that is how the realdb tests drive the workers); the real defect is the inverse (no way to turn a worker **off** in prod).

Every item below was **verified by reading the code**, not inferred. Ranked by what bites first.
The two CRITICALs are **fixed on branch `fix/jwt-type-confusion-and-context-gate`** (not yet merged).

> ## ⚠️ Re-verified end-to-end 2026-08-19 — and this list had drifted badly
>
> Two consecutive sessions found that most of what this section called open had
> already been fixed weeks earlier. Every remaining unchecked item was re-read
> against the working tree; the results are recorded inline below, including where
> the ORIGINAL FINDING WAS WRONG (`/templates/full` is not anonymous;
> `isTenantExempt` was never a behaviour bug) and where it was overstated
> (`find-customer-by-name` no longer matches a single letter).
>
> **Scoreboard:** 4 genuinely broken and now fixed (alternatives-search duration,
> purge `--older-than` NaN, `telnyxNumbers` timeout, plus the reminder-claim
> outage from the previous session) · 3 already fixed and merely unmarked
> (`'Caller'` placeholder, `/metrics` `!==`, and five items in the SMS/reminders
> block) · 2 wrong or overstated as written · 6 dead-code items still real and
> deliberately deferred to their own PR.
>
> **The meta-lesson, which is worth more than any single item:** a backlog nobody
> re-verifies becomes actively misleading, and it costs more than an empty one —
> it sends the next session to fix what is already fixed while the real outage
> (13 days of zero reminders) sat one line below, unnoticed. Mark items done when
> they ship, and re-verify before trusting an entry older than a few weeks.

**A grounding fact that reframes the rest:** production has **never booked an appointment** — 5 voice
calls, **0 appointments, 0 reminder_schedules, 0 communications_history**, all time. So no reminder
has ever been seeded, no SMS ever sent, and no self-service token ever minted. Several findings below
are unexploited _only because the feature has never once run_. The first real call is the moment they
all go live at the same time.

**CRITICAL — fixed on branch, awaiting merge**

- [x] ~~**Self-service SMS link authenticated as tenant OWNER.**~~ Cancel/reschedule tokens are signed with the same `JWT_SECRET` as sessions; `verifyToken` couldn't tell them apart and the hook did `role: decoded.role ?? 'owner'`. Anyone holding an appointment-confirmation text could replay it as a Bearer token and dump the tenant's customers/appointments/transcripts via `GET /export/tenant-data` for 24h, no password. Never exploited — no SMS has ever been sent. **Fix: every token declares a `typ`; each verifier accepts only its own kind; no owner default.**
- [x] ~~**The OTP gate guarded 1 of 3 doors.**~~ `identify-caller` was gated 2026-07-13; `customer-context` and `customer-history` returned the same name/preferences/history with **no check**, and the LLM picks the phone number it passes. Found independently by two reviewers. **Fix: one shared `callerMayHearCustomerData()` in front of all three; `phone_source` defaults to the cautious `'spoken'`.**

**HIGH — the OTP gate is still weaker than it looks**

> **Re-audited 2026-08-03 while wiring the tools into the live call (below): three of the four findings here were already fixed in `src/routes/agentTools/identity.ts` — this section had drifted stale the same way §4a had. Re-verified by reading the current code, not carried over on trust.**

- [x] ~~**OTP verification is phone-global for 24h, not call-bound.**~~ **FIXED** (`identity.ts:99-116`, `callerMayHearCustomerData`) — the gate now requires a `phone_verifications` row whose `call_id` matches the live call; a NULL/missing `call_id` can never satisfy it. Backed by migration `20260714000000_phone_verification_call_binding.sql`.
- [x] ~~**A 4-digit code is brute-forceable because the attempt cap resets per code.**~~ **FIXED** (`identity.ts:837-874`) — attempts are now summed per `(tenant, phone)` over a rolling 1-hour window across every code issued (not per-row); a resend expires all prior live codes first (one live code at a time); a lockout emits `errors_total{event="otp_phone_locked_out"}`.
- [x] ~~**A verified caller still can't cancel, reschedule, or hear their appointments.**~~ **FIXED** (`agent/src/tools.ts:854-876`, `verify_phone_code`) — on `verified:true` the tool now sets `ctx.callerPhone` to the server-normalized E.164 number, so `get_my_appointments`/`send_self_service_link`/cancel/reschedule stop hard-bailing after a successful OTP.
- [x] ~~**(code)** **`find-customer-by-name` enumerated real customers' NAMES on an unanchored `ILIKE '%…%'`.**~~ — **FIXED 2026-08-19.** The 4-character floor and LIKE-metacharacter escaping (2026-08-07) removed the cheapest probes and left the oracle intact: a 4+ character surname still returned up to 5 real customers plus the last four digits of each phone, with the guessed name as the only credential. **The match is now near-exact and LIKE is gone entirely** (`identity.ts`): the caller must supply BOTH name parts, and they must match exactly modulo case, punctuation, honorifics, and an extra middle name or suffix on either side (`normalizeNameForSearch` + `nameMatchesNearExactly`). One token — a bare first name or a bare surname — short-circuits before any SQL runs, and so does initials-only input under the retained 4-character floor. SQL prefilters on the surname as a whole word (same normalization on both sides) and the precise rule runs in-process, so a shared surname can no longer return the family that shares it. **What it costs, stated plainly:** fuzzy recovery. "Thornbury" for "Thornberry" now returns nothing and the caller is treated as new — the safe direction to fail. The route stays OUT of the model's toolset; tighten before wiring, not after. Tests: 8 in `tests/routes/agentTools/agentTools.test.ts` (guards + in-process filter, mocked pool) and 20 real-Postgres cases in `tests/integration/agentToolsCustomerSearch.realdb.test.ts` (three of them assert the old partial-match probes now return nothing). Tool description in `agent/src/tools.ts` updated to demand a full name.
- [x] ~~**None of the above ever ran on a live call anyway.**~~ **FIXED 2026-08-03.** All three backend fixes above were correct and complete — and entirely unreachable. Production runs question trees (`agent/src/checklist/`), and `checklistTools.ts`'s `selectedTools()` builds the model's toolset from an allowlist (`TREE_PASSTHROUGH_TOOLS`) that never included `send_verification_code`, `verify_phone_code`, or `get_customer_context` — they existed fully built in `agent/src/tools.ts` but no call could ever reach them. **They ARE capability-gated, in a second and independent place** (corrected 2026-08-07 from PR review — the earlier "confirmed unconditional" reading was wrong): `tools.ts:87-88` maps both OTP tools to the `'verification'` capability, `buildTools` drops them unless `capabilities` includes it (`tools.ts:280`), and `index.ts:884-890` filters `'verification'` out of `activeCapabilities` whenever `ENABLE_PHONE_VERIFICATION` is false. So a tool must clear BOTH gates to reach a live call — the tree allowlist AND the capability list — and neither implies the other. Do not read the fix below as "the OTP tools are always present in ToolContext"; with phone verification off they are absent regardless of the allowlist. A forwarded-line caller could never be recognized or verified, no matter what the backend was ready to do. Fix: added `identity: ['get_customer_context', 'send_verification_code', 'verify_phone_code']` to `TREE_PASSTHROUGH_TOOLS` — the `identity` tree is selected on every goal-bearing call. `find_caller_by_name` deliberately excluded (see item above). 2 new tests in `checklistTools.test.ts`; full agent suite (83 files / 1295 tests) + typecheck green.

**HIGH — SMS/reminders.** Re-audited against the code 2026-08-19. **Most of this
block had already been fixed and the list still said otherwise** — every claim below
is now re-verified against the source, not carried forward.

- [x] ~~The retry policy is unreachable dead code~~ — **DONE (2026-07-13).** `processReminder` rethrows; the worker's catch owns `decideRetry` / `retry_count` / the 5m/30m/2h backoff. Verified in `src/services/reminders/index.ts` (`ReminderSendError`).
- [x] ~~A reminder cancelled for "no consent" is silent~~ — **DONE.** `remindersSkippedTotal.inc({reason:'no_consent'})` + a 5W warn, plus `appointment_cancelled` / `appointment_passed` on the neighbouring branches.
- [x] ~~`reminders_sent_total` is never incremented~~ — **DONE.** `remindersSentTotal` fires on both outcomes inside the LIVE `ReminderService`, and `smsSendsTotal` is incremented at 5 call sites in the live `smsService.ts` / `telnyxSms.ts`. (The dead parallel `ReminderProcessor` is still to be deleted — see the dead-code item below.)
- [x] ~~Unbounded `fetch()` to Telnyx can wedge the reminder worker~~ — **DONE for the SMS paths.** `AbortSignal.timeout(10_000)` in `TelnyxSmsAdapter.ts:60` and `telnyxSms.ts` (`SEND_TIMEOUT_MS`). **Narrower remainder FIXED 2026-08-19:** `src/services/telnyxNumbers.ts` (the number-PROVISIONING client — it could never wedge the reminder tick, only hang a provisioning request an owner is watching) now carries `AbortSignal.timeout(TELNYX_REQUEST_TIMEOUT_MS)` on every call, and its catch names the cap instead of reporting the generic `TimeoutError` message.
- [x] ~~SIGTERM doesn't drain in-flight worker ticks~~ — **DONE.** `stopReminderScheduler()` awaits `_currentTick` behind a 10s timeout, wired to SIGTERM/SIGINT.

**MEDIUM — correctness in the code shipped 2026-07-12/13**

- [x] ~~**(code)** **One far-future shift row poisons the schedule extender forever.**~~ — **FIXED 2026-08-20** on `fix/schedule-extender-stores-the-rule`. `tail` was `MAX(shift_date)` over _all time_ and the pattern was the 7 days ending there, so one one-off shift 300 days out ("annual inventory Saturday") made the pattern **Saturday-only**; Mon–Fri quietly stopped being extended and the business went unbookable in ~180 days, killed by the worker written to prevent exactly that.
  - **Done as prescribed: STORE THE RULE.** Migration `20260820000000` adds `employee_schedule_pattern (tenant_id, employee_id, day_of_week, start_time, end_time)` — natural composite PK, RLS + admin bypass matching `employee_schedule`. `expandWeeklyToSchedule` now writes it from the same weekly grid the wizard already collects (both callers pass the COMPLETE pattern for one employee, so the rule is **replaced, not merged** — merging would resurrect a weekday the owner dropped, the same bug one table over). `extendSchedules` projects the declared rule where one exists; the `tail` CTE excludes rule-bearing employees outright, so declared and derived are disjoint by construction and `UNION ALL` cannot double-count.
  - **The derived fallback survives, with its tail clamped to `CURRENT_DATE + 14`.** That clamp is what fixes every tenant who predates the table. It keeps the two properties that mattered — a lapsed schedule is still backfilled (the tail is wherever it actually ended, however far back) and a dropped weekday is still not resurrected — while putting a far-future one-off out of reach. It is a fixed point, not a feedback loop: past the clamp the tail week IS the worker's own output, a faithful copy of the same pattern. The three rejected derivations are recorded in the file header so nobody re-proposes them.
  - **NO BACKFILL, deliberately.** Inventing a rule from existing rows is the archaeology the table exists to end. Existing tenants (Thinking Hammer included) keep the clamped fallback until they next save their hours, at which point the rule lands and the guessing stops for them permanently. **Consequence to know:** the poisoning is fixed for them by the clamp, not by the rule.
  - Tests: 5 real-DB cases in `tests/services/extendSchedules.realdb.test.ts` (incl. the far-future-Saturday regression, **verified to fail with the clamp removed**) + 3 in `tests/services/expand-weekly-integration.test.ts` (rule written / rule replaced on drop / empty pattern leaves the rule alone).
- [x] ~~**`SIGTERM drain` + `atomic claim` are ONE bug, and it fires on EVERY DEPLOY**~~ —
      **BOTH SHIPPED, AND THE CLAIM HALF THEN TOOK THE WHOLE PIPELINE DOWN FOR 13 DAYS.**
      Fixed 2026-08-19 on `fix/reminder-claim-status-constraint`. The claim landed in
      #322 (`6d94cf9`, 2026-08-06) exactly as prescribed here —
      `UPDATE ... SET status='sending' ... FOR UPDATE SKIP LOCKED RETURNING *` — and
      `reminder_schedules_status_check` allowed only `scheduled|sent|failed|cancelled`.
      So every 60s tick threw `violates check constraint`, `processBatch`'s outer catch
      bumped `errors_total{event="reminder_batch_failed"}` on the token-gated `/metrics`
      that nothing scrapes, and returned 0. **Not one reminder or confirmation was sent
      between 2026-08-06 and 2026-08-19.** `/health` green, worker "running", no alert.
      Reproduced against real Postgres before any code was written.
      **Three things ship together and all three must stay together:** migration
      `20260819000000` (widen the enum), `processReminder` accepting `'sending'` (it
      gated on `!== 'scheduled'`, so the moment the claim worked it would have silently
      skipped every claimed row and stranded it where the claim query never looks
      again — a second bug hiding behind the first), and `releaseStaleClaims()`
      returning rows abandoned in `'sending'` past 5 minutes (a claim introduces a way
      to LOSE a reminder that `'scheduled'` never had). `triggerReminder` deliberately
      still refuses `'sending'`.
      **The lesson, which is the whole point:** a reliability fix shipped with green
      unit tests that all mocked the pool, and a mock has no CHECK constraints. The
      guard is now `tests/regression/reminderClaimRealDb.test.ts` — real DB, running
      the worker's claim statement verbatim. Verified both directions: 5 of its 6 tests
      fail with the migration reverted, all 6 pass with it.

- [x] ~~**The alternatives search offers slots the booking then refuses**~~ — **FIXED 2026-08-19.** Re-verified as REAL before fixing, and the original description was half right: skills/capabilities were already threaded through, but the duration was not. The failure branch built its search from `args.requirements.*` — the MODEL's guess, which usually omits `durationMinutes` — while the RPC above used `resolved.duration_minutes` and preferred `resolved.required_skills`. A 90-minute skill-gated service was offered a 30-minute gap with an unskilled employee; the caller accepted and got `NO_SKILLED_EMPLOYEE`. The dead end became a rejection loop. **The reason it was not a one-line fix:** `resolved` is scoped inside the `outcomeOfBooking` callback and is not in scope at the failure branch (a first attempt failed `tsc` on exactly that), so the resolved duration + skills are now carried out on the callback's return value. Guarded by a new case in `agentTools.test.ts` asserting the slots query receives the resolved `90` and `['alignment']`; verified it fails with the fix reverted.
- [x] ~~**`'Caller'` is still an unfixable placeholder on the OTHER write path**~~ — **ALREADY FIXED 2026-07-13; this entry was stale.** `identity.ts`'s `ON CONFLICT DO UPDATE` now tests `customers.name = ANY($4::text[])` against the shared `PLACEHOLDER_NAMES` (`['Valued Customer', 'Caller', 'Unknown']`), so the `'Caller'` that `scheduling.ts:594` writes on a nameless booking IS overwritten when the caller later gives a name. The fix even carries a comment describing this exact bug. A real name is still never clobbered; a 2026-08-01 `is_correction` flag additionally allows a same-call correction.
- [x] ~~**`purge-soft-deleted.ts` `--older-than` typo → `NaN` → cutoff silently dropped**~~ — **FIXED 2026-08-19.** Verified real: `Number(valueOf('--older-than') ?? 0)` yielded NaN, `NaN > 0` was false, and the `AND deleted_at < …` clause was omitted ENTIRELY, so `--older-than abc --execute --yes` hard-deleted every soft-deleted tenant while the operator believed they had set a floor. Now rejects non-finite and negative values and exits non-zero before any DB connection is attempted (a negative would push the cutoff into the future — the same over-broad purge by another route). New `scripts/purge-soft-deleted.test.ts` drives the real script as a subprocess, because the guard runs at module scope and calls `process.exit`; verified both cases fail with the guard removed.
- [x] ~~`/metrics` compares its bearer token with `!==`~~ — **ALREADY FIXED; this entry was stale.** `health.ts:81` uses `safeEquals(provided, token)`, with a comment explaining the timing oracle.
- [x] ~~**(code)** **`GET /templates/full`**~~ — **FIXED 2026-08-20** on `fix/templates-full-super-admin`, **and the prescribed fix was wrong too.** The first finding (anonymous read) was already known to be wrong — the route is absent from `PUBLIC_ROUTES`, so the JWT preHandler rejects an unauthenticated request. The follow-up prescription, "add `requireSuperAdmin`, matching `/templates/create`", **would have broken onboarding for every real customer**: five owner-facing surfaces read this route (`SetupView`, `SetupWizard/index`, `SoloWizard`, `DashboardHome`, `BusinessTypeSection`), and the picker's own `TemplatePreviewModal` RENDERS `system_prompt_template` and `first_message` to the owner on purpose, under the headings "AI System Prompt" and "Greeting Message". Owners are not withheld the prompt anywhere in this product — `AIConfigView` lets them edit their own copy. A route whose whole job is showing templates to owners cannot be owner-inaccessible. **What was actually wrong was `SELECT *`** — an implicit contract that grows by itself: every column ever added to `business_templates` was published to every authenticated user the moment the migration landed, with nobody deciding to publish it. Today that meant `voice_provider` / `voice_name` (backfilled `'cartesia'` / `'elevenlabs'` — TTS providers this stack has never used, so the dashboard was handed values that are simply false) and `example_resources` (no client has ever heard of it). The route now selects an explicit 15-column list matching `BusinessTemplate` in `dashboard/lib/types.ts` field for field, pinned by two real-DB tests in `tests/integration/tenants.realdb.test.ts` — **both verified to fail against the old `SELECT *`** — so publishing a new column is a deliberate act, not a side effect of a migration. **Open decision, not code:** whether to narrow the audience from "any authenticated user" to owners/admins. It would exclude `front_desk` staff and, more to the point, self-serve `POST /demo/start` tenants — which mint an owner-role token, so anyone on the internet can read every template today. Left alone because `DashboardHome`'s business-type picker is a Primary tab and I could not prove no front-desk user reaches it; that is a product call.
- [x] ~~`isTenantExempt` exempts _all_ of `/tenants/*` regardless of the list~~ — **the code was rewritten 2026-08-19, but be clear about what that did: it changed NOTHING about behaviour.** The old predicate `path === r || path.startsWith('/tenants/')` ignores its loop variable, so `.some()` answered on the first element for any `/tenants/*` path — but the result is identical to an explicit prefix rule for every input, which was confirmed by running the new tests against the OLD implementation and watching all 46 pass. So this was never a live hole, and the backlog's "a new `/tenants/*` route inherits no middleware protection" is true of the intended design (those routes self-check with `requireSuperAdmin`), not of a defect. The rewrite splits `TENANT_EXEMPT_ROUTES` (exact matches) from `TENANT_EXEMPT_PREFIXES` (`/tenants/`, `/agent-tools/`) so the prefix rule is stated rather than smuggled into a predicate, and two tests now pin both halves.

**Dead code / simplification** (see also 🧹 Doc hygiene)

> **Every item below was re-verified against the working tree on 2026-08-19 and all
> of them are still real** — unlike the correctness block above, which was mostly
> stale. Deliberately NOT bundled into the fix PR: deleting ~600 lines is a
> different risk class from fixing four bugs, and mixing them makes both harder to
> review. Evidence is recorded per item so the follow-up does not have to re-derive
> it.

- [x] ~~**Delete the orphaned parallel reminder implementation — 391 lines, zero prod callers.**~~ — **DONE 2026-08-20.** Deleted `reminderProcessor.ts`, `reminderScheduler.ts`, `reminderRepository.ts` and `reminderProcessor-metrics.test.ts`. **The metrics halo was worse than "redundant coverage":** that test asserted `reminders_sent_total{channel: email|sms}` and `reminders_skipped_total{reason: processing_error}` — shapes the LIVE service has never emitted (it partitions by reminder `type`, and rethrows processing failures into `errors_total`). `metrics.ts` and `docs/ALERTS.md` documented the dead shape too, so any dashboard or alert filtering on `channel` matched nothing and read as "healthy". Replaced with `tests/services/reminders/reminderService-metrics.test.ts` against the live emitter, descriptions corrected, and `appointment_not_found` — documented since forever, never incremented — is now emitted (it fired 8 times in one prod minute on 2026-08-20 with nothing counting it). Original text: **Re-verified 2026-08-19:** `services/reminders/reminderScheduler.ts` has **zero** importers anywhere in `src/` or `tests/`; `reminderProcessor.ts` is reached only by that dead file's discarded `_ReminderProcessor` dynamic import and by its own metrics test. `services/reminders/reminderProcessor.ts` + `services/reminders/reminderScheduler.ts` are a second, unused implementation whose only caller is a discarded `_`-prefixed dynamic import and a test. The **name collision with the live `workers/reminderScheduler.ts` is what hid it** — and it holds the metrics that were supposed to be watching prod. Its `reminderProcessor-metrics.test.ts` gives the dead class a green-CI halo. Textbook "test it or delete it".
- [x] ~~**(code)** **Live `n8n` trigger fired on every appointment INSERT**~~ — **DONE 2026-08-21**, migration `20260821000000_drop_n8n_webhook`: trigger, SECURITY DEFINER function, and `tenants.n8n_webhook_url` all dropped. **Checked against PROD before touching schema — 0 tenants held a value and `pg_net` was not installed**, so nothing was lost and nothing behaved differently. What it cost while it lived: a `SELECT` against `tenants` on every appointment INSERT, inside the booking transaction, to read a column with zero readers and zero writers. What made it worth removing rather than leaving inert: with `pg_net` present the POST runs SYNCHRONOUSLY inside that transaction, so `book_with_scheduling_atomic` would block on an external host while holding the GiST exclusion constraints — a slow webhook endpoint becomes a booking outage. Guarded by `tests/regression/n8nWebhookRemoved.realdb.test.ts` (4 real-DB cases: trigger gone, function gone, column gone, and **a booking still INSERTs** — proving the drop by writing, not by reading the catalog).
- [x] ~~**`shared/dateTime.ts` — 85 lines, 8 exports, zero importers.**~~ — **DELETED 2026-08-20.** Import grep across `src/`, `shared/`, `dashboard/`, `agent/src/` and `tests/` returned nothing; removed from CLAUDE.md's `/shared` resident list at the same time. **Re-verified 2026-08-19:** still exactly 85 lines / 8 exports, and an import grep across `src/`, `shared/`, `dashboard/`, `agent/src/` and `tests/` returns nothing.
- [x] ~~**`TelephonyProvider`: 4 of 5 methods are dead Twilio residue**~~ — **DONE 2026-08-20.** Collapsed to `{ getName, sendSMS }`; `TelephonyCallRequest` removed. Verified zero callers of `makeCall` / `createInstruction` / `wrapResponse` / `generateInstruction` anywhere in `src/` or `tests/` before deleting, and `TelnyxSmsAdapter` threw on all four anyway. A knock-on the deletion exposed: `smsServiceMetrics.test.ts` carried an `as unknown as` cast that existed only to paper over the four members its literal did not implement — now unnecessary, and lint caught it. `ProviderRegistry`'s dead `JEST_WORKER_ID` disjunct went too (repo is Vitest-only). Original text: — both adapters `throw` on them, and `MockAdapter` still emits **TwiML XML** for a stack that dropped Twilio months ago. Collapse to `{ getName, sendSMS }` (~120 lines); the registry's one real job (the no-creds Mock switch) is a one-liner.
- [x] ~~**(code)** **42 migrations self-managed a transaction the runner already owns.**~~ — **DONE 2026-08-21.** All 42 stripped of their top-level `BEGIN;`/`COMMIT;`. The runner applies each file as `psql --single-transaction <<SQL \i <file> / INSERT INTO schema_migrations … SQL`, so `--single-transaction` wraps the whole heredoc — a file's own `COMMIT;` ended that wrapper early and the tracking INSERT landed outside it, meaning a later failure could leave DDL applied with no `schema_migrations` row. The file's own `BEGIN;` was separately a no-op that only warned "there is already a transaction in progress". Inert against prod (all 42 long applied); the damage was confined to fresh rebuilds and new environments. **Verified end-to-end by `npm run db:rebuild -- --yes`** — DROP SCHEMA, full chain, seed, clean, and `supabase/baseline.sql` came back byte-identical, which is the proof that stripping changed no schema. The strip skipped dollar-quoted bodies so `DO $$ BEGIN … END $$;` was never touched. Guarded by `tests/regression/migrationsOwnTransaction.test.ts`, which carries both a negative control (plpgsql must NOT be flagged) and a positive one (a real top-level transaction MUST be flagged) — a guard nobody has watched fail is not a guard. `scripts/setup-db.sh`'s comment now states the dependency instead of assuming it.
- [x] ~~**(code)** Inert columns to drop~~ — **DONE 2026-08-21**, migration `20260821010000_drop_inert_columns`. **Checked against prod first:** `business_templates` held 30 rows with `voice_provider` ∈ {cartesia, elevenlabs, NULL} and `voice_name` ∈ {Josh, Rachel, Default Male, NULL} — an ElevenLabs vocabulary for a product whose TTS has only ever been OpenAI and then Deepgram Aura, so those were not stale values but FALSE ones; `tenant_integration_settings` holds **zero rows**, so `webhook_secret` dropped nothing at all. All three had zero TypeScript readers. **`ENABLE_VOICE_SESSION_REAPER` / `ENABLE_SCHEDULE_EXTENDER` / `ENABLE_REMINDER_SCHEDULER`: decided and fixed.** The asymmetry is kept — prod ON by default, elsewhere OFF by default — because defaulting a worker off in prod because nobody set a variable is the failure this project has already lived through (13 days of zero reminders). What was missing was the escape hatch: `isProduction || flag === 'true'` is simply `true` in prod, so a misbehaving worker could only be stopped by shipping a deploy. New `src/services/workerEnabled.ts` honours an exact `ENABLE_X=false` in production and is otherwise byte-for-byte the old behaviour; near-misses (`False`, `0`, `no`, `' false'`) deliberately do NOT disable, because a kill switch that fires on a typo stops a worker silently. 7 unit tests. **`JEST_WORKER_ID` was already removed** in #353 (`ProviderRegistry.ts:42` now carries only the two live `VITEST` checks) — this entry was stale. **`STRIPE_AUTO_TAX` needs no code change**: it is correctly gated at `billing.ts:107` and `docs/RESOLVED.md` accurately describes the code as shipped while naming the Railway step as an outstanding user action — so `automatic_tax` has genuinely never been sent, and that remains a **(Dale)** item under P0 §2, not a code defect.
- [x] ~~**CLAUDE.md called `tts_soft`/`tts_cheerful` "inert"** — false, and dangerous next to "delete on sight."~~ **Fixed 2026-07-13.** They are live LLM prompt-style flags with dashboard toggles; deleting them would have removed two working features. HIPAA-residue sweep came back **clean**.

### 5. Legal / business (long lead time — start early)

- [ ] **(Dale)** Open an **LLC bank account** for Thinking Hammer LLC (required before Stripe payouts).
- [x] ~~**(Dale)** Publish + link **legal docs**~~ — **SHIPPED 2026-08-14.** Public `/privacy`, `/terms`, `/dpa`. Terms = Bonterms Standard Online Cloud Terms v1.0 by reference + Provider-Specific Terms. DPA = Bonterms DPA v2.0 cover + subprocessors. Privacy = ICO-style notice + product call-handling language. Footer + register checkbox link all three. Not a lawyer review.
- [ ] **(Dale)** Add **TCPA-compliant SMS opt-in** consent language at booking time — required before any confirmation texts.
- [ ] **(Dale)** **E&O insurance** before the first paying customer (~$800–1,200/yr; Next/Hiscox).
- [ ] **(Dale)** **Cyber Liability insurance** before the first paying customer (often bundled with E&O).

---

## 🟠 Legal-hold — built, DO NOT merge/enable without sign-off

Both erase PII irreversibly (kill-switched off / inert until enabled). Branches deleted in the 2026-06-23 cleanup; restorable from the PR pages.

- [ ] **(blocked — legal)** **PR #68** — `POST /customers/:id/purge` owner-gated single-customer GDPR/CCPA erasure (typed phone confirmation, atomic anonymize-in-place + audit_log PII redact, kill-switch `ENABLE_CUSTOMER_PURGE`; 8 tests).
- [ ] **(blocked — legal)** **PR #69** — disabled-by-default automated retention/purge worker (`ENABLE_RETENTION_WORKER` + explicit `RETENTION_DAYS`, no default window, per-tenant-failure-isolated; 9 tests). Broader-PII scope (`voice_sessions`/transcripts/appointment descriptions) is a deliberate follow-up.

---

## 🟡 P1 — Customer success & trust (non-blocking, do after P0)

- [x] ~~**`/demo/start` per-IP limiter is a global bucket**~~ — **investigated 2026-07-08, NOT a bug.** A controlled 16-min quiet-window test returned 200, so the window resets normally; the persistent 429s were self-inflicted test traffic. A spoofed `X-Forwarded-For` has no effect because Railway overwrites it with the true client IP (correct, non-spoofable). No action.
- [x] ~~**(code)** **Telnyx webhook verifies a re-stringified body.**~~ **FIXED 2026-07-09.** `/communications/telnyx/status` now HMACs `req.rawBody` (the exact received bytes), like `billing.ts`/`square.ts`. Signature verification was also moved **before** payload parsing — previously an unsigned caller reached the parse path and the route's safety rested on the id/status guard firing first (the parser synthesizes `{}` for an empty body). Compare is now `timingSafeEqual`. The old happy-path test hardcoded `JSON.stringify(payload)` as the signed bytes, so it could never see the bug; replaced with a regression test that signs raw bytes whose key order + whitespace `JSON.stringify` would not reproduce (asserted non-equal, so the test has teeth — verified failing against the old code).
- [x] ~~**(code)** **`npm run prepare-commit` reports a false failure.**~~ **FIXED 2026-07-09.** Two independent causes, both of which kept the gate red on a pristine `main`:
  1. `run_or_skip` eval'd each configured command in the parent shell, so the `cd dashboard` chained into `checks`/`unitTests` leaked out and stranded every later step in the wrong directory (`Missing script: "verify:claude-md"`). Each command now runs in a subshell — `if (eval "$cmd")`.
  2. Step 4's `focusedTestScan` regex was `(\.only\(|\.skip\()`, which flagged every **conditional** skip (`test.skip(process.env.FOO !== '1', …)`, `ctx.skip()`) as if it were a focused test — 12 legitimate guards, so the step could never pass. Extracted to `scripts/focused-test-scan.sh`, which flags only `.only(` and skips/todos whose first argument is a **string literal** (i.e. a test disabled by name = dead code). Verified: silent on the clean tree, and still catches an injected `describe.only(...)` / `it.skip('name', …)`.
- [x] ~~**(code)** **Dashboard vitest exits nonzero with 0 failing tests.**~~ **FIXED 2026-07-09.** Surfaced by the now-working `prepare-commit` gate: `Tests 1012 passed` + `Errors 2 errors`. `useEntityList` / `useServiceMappings` in `dashboard/lib/hooks.ts` fetched from an effect with no cancellation, so an unmount mid-flight ran `setLoading(false)` after vitest tore down jsdom → React read a dead `window` → unhandled rejection. Only reproduced under full-suite load. Fixed with a `useIsMounted()` guard on every post-`await` setter; 5 regression tests in `dashboard/lib/hooks.test.tsx` that simulate teardown by deleting `globalThis.window` (verified failing without the guard). Lesson recorded in `docs/LESSONS_LEARNED.md`.
- [ ] **(Dale)** Verify **reminder delivery stats** in prod. **Unblocked 2026-07-09** — Telnyx creds confirmed, and `TELNYX_PHONE_NUMBER` corrected from the dead `+16308661960` (see P0 §1). Note the stats before that fix were measuring a broken `from` address: fallback-tenant sends were rejected by Telnyx and logged as `status='failed'` in `communications_history`. Expect `sent` now. Check the Failed-only drill-down (`GET /communications/history?status=failed`) and confirm no new failures post-`23:49:38Z`.
- [ ] **(Dale/code)** **Pricing tiers (Pro/Enterprise)** positioning.

### Optional integrations — turn on per business need (code complete, need creds + a live round-trip)

- [ ] **(Dale)** **Google Calendar** — `GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL` + GCP OAuth app; prove a real round-trip via `calendarSync.ts` + `SYNC_TEST_RECORDER`.
- [ ] **(Dale)** **Outlook Calendar** — `OUTLOOK_CLIENT_ID/SECRET/CALLBACK_URL` + Azure app.
- [ ] **(Dale)** **Square CRM** — `SQUARE_CLIENT_ID/SECRET/CALLBACK_URL` + `SQUARE_WEBHOOK_SIGNATURE_KEY` + provider OAuth app (code no-ops safely until set).

---

## 🟢 P2 — Quality, scale & ops visibility

- [ ] **(code)** **Volume metering + tier cap enforcement** — do after first customer, once real usage data sets the bands. Data already exists (`voice_sessions` per tenant per month). Build: (1) monthly call counter endpoint; (2) per-plan limit config (Solo ~300–400 calls, Growth ~1,000, Pro unlimited); (3) dashboard usage meter + 80% warning banner; (4) soft cap enforcement. No Stripe Metered Billing needed — flat bands with a DB query. See pricing notes in §2 Billing above.
- [ ] **(Dale/code)** _(Optional)_ Repoint Railway `healthcheckPath` → `/ready` to gate deploy **promotion** on DB reachability (behavior change — could block promotion during a DB blip; your call).
- [x] ~~**(Dale)** **Alert rules** — stand up a hosted monitoring destination~~ — **DROPPED 2026-07-09. No vendor meets the "really free forever" bar.** Researched rather than assumed:
  - **UptimeRobot free is not usable here at all** — since 2024-12-01 its ToS restricts the free plan to _personal, non-commercial_ use, explicitly prohibiting revenue-generating applications. SecretaryHQ is a paid SaaS.
  - **Grafana Cloud free** doesn't expire but is capped: 10K active series, 14-day retention, 3 users; $6.50/1K series beyond. Our worst case is 10 metrics × the 1000-series `MAX_LABEL_CARDINALITY` cap = exactly 10K, and `http_request_duration_ms` (~32 route modules × 3 status families × 12 series) realistically lands ~2–3K. It would fit — but "free within limits that the vendor can move" is not free forever.
  - **Healthchecks.io free** is heartbeat/cron monitoring (20 jobs), not metric thresholds.
  - Every "free forever" tier is free-_within-limits_. Paid vendors (Sentry, Better Stack) were already **declined** 2026-07-02; the code keeps its no-op hooks either way.
  - **`docs/ALERTS.md` stays** as a reusable PromQL reference — the rules are collector-agnostic and cost nothing to keep. If a destination is ever chosen, it's paste-and-go.
  - **The one signal actually worth having** — "SMS failure ratio crossed 20%", which would have caught the dead `TELNYX_PHONE_NUMBER` on day one — needs no vendor. See the zero-vendor option below.
- [ ] **(code)** _(Optional, unscheduled)_ **Zero-vendor alert** — a scheduled GitHub Actions workflow that curls `/metrics` with `METRICS_TOKEN`, evaluates the two `sms_sends_total` / `errors_total` thresholds from `ALERTS.md` §3.9, and opens an issue on breach. No account, no series cap, no ToS that bans commercial use. Costs Actions minutes (~720/mo at a 30-min cadence, against 2,000 free on a private repo). Gives alerts, not dashboards — which is the actual need until real call volume exists.
- [ ] **(code)** **Website-scan re-scan scheduler** — periodic re-scan of stale KB. Deferred: needs a `last_scanned` column/migration + is a cost/product call.

### Structural refactors (folded in from root `07_11_2026_IMPROVEMENTS.md`, 2026-07-28 — that file is deleted; it duplicated this backlog and sat in the root, which by CLAUDE.md holds only CLAUDE.md / README.md / workflow.config.json / DEMO_SECTION.md)

Each status re-verified against the code on 2026-07-28, not carried over on trust. Item 1 of the original nine (**split `agentTools.ts` into a domain module**) is **DONE** — `src/routes/agentTools/` is a directory of 8 modules.

- [x] ~~**(code)** **Move test files out of `src/` into a parallel `tests/` tree**~~ — **DONE 2026-08-21.** The entry said "still mixed"; the actual remainder was **exactly one file**, `src/services/phoneLoopGuard.test.ts`. It is now `tests/shared/transferLoopGuard.test.ts`, renamed for what it covers — it exercises `isTransferLoop`/`canTransfer` in `shared/phone` directly, not the backend alias. `find src -name '*.test.ts'` returns **0**. Worth knowing it is NOT a duplicate of `tests/services/phoneLoopGuard.test.ts`: that sibling pins the alias `phonesWouldLoop`, so it is the one that would catch the re-export being broken or dropped. Two entry points, one implementation.
- [ ] **(code)** **Extract `src/routes/knowledge.ts` into services** — still **1,092 lines** (re-counted 2026-08-21; it has grown, not shrunk). Route should orchestrate; scanning/embedding/normalization belong in `src/services/`.
- [~] **(code)** **Extract `src/routes/analytics.ts` into services** — **PARTIAL 2026-08-21** (PR: characterization + first three extractions). **880 → 723 lines**; `dateBounds.ts` (shared date validation + the coverage schema/row type), `aiCost.ts`, `coveragePreview.ts` now live under `src/services/analytics/`. **The coverage work is the point, not the line count:** the existing suite covered 2 of 9 route paths, so this started with characterization tests written against the CURRENT code — **78.86% → 100% lines** on `analytics.ts` — and those same tests stayed green through every extraction step. `POST /coverage/dry-run` was wholly uncovered (lines 638-720) and is the only analytics route that WRITES: it inserts a full draft graph and rolls back, so two tests now pin ROLLBACK on the happy path AND on a throw — without the `finally`, a failed preview would leak services and staff into the tenant's real data. **Still in the route file:** `/analytics/stats`, `/analytics/calls`, `/analytics/cohorts`, `/analytics/utilization`, `/coverage`, `/call-summaries`, `/feedback`. Coverage is now 100% lines across route + services, so the rest can be extracted the same way — one piece at a time, suite green after each.
- [ ] **(code)** **Group agent tool definitions by capability** — `agent/src/tools.ts` defines **26** tools in one flat file; `agent/src/tools/` holds only `wrapTool.ts`. The capability union (`knowledge | messaging | identity | scheduling | verification | transfer`) exists in types but not in the file layout. **Do this together with the reachability audit below** — the two touch the same file.
- [ ] **(code)** **Reconcile `tools.ts` against what the model can actually reach** (new, 2026-07-27; re-audited 2026-08-03). 26 tools are defined; `selectedTools()` offers **12** under question trees. Some absences are correct (`start_booking` / `manage_appointment` were ladder routers; `book_appointment` / `check_availability` / `get_scheduling_options` are superseded; SMS tools are gated off anyway). Three of the originally-flagged absences are **resolved 2026-08-03**: `get_customer_context`, `send_verification_code`, `verify_phone_code` are now wired via `TREE_PASSTHROUGH_TOOLS.identity` (see the OTP section above). `attach_meeting_notes` was already wired (buy_service passthrough) and `identify_caller` is intentionally host-code-only, never model-facing (`checklistTools.ts`'s `maybeIdentify()`) — neither was actually a gap. **Still undecided:** `transfer_call` — _there is no human handoff on a live call_ — plus `page_owner_via_sms`, `save_customer_preference`, `get_detailed_customer_history`, `find_caller_by_name` (the last deliberately still excluded — see the enumeration bug above). Decide per tool: wire it into a tree / passthrough, or delete it.
- [x] ~~**(code)** **Dedupe `src/services/phoneUtils.ts` / `nameUtils.ts` against `shared/`**~~ — **ALREADY DONE; entry was misleading (verified 2026-08-21).** Both files exist, but neither contains an implementation — each is a one-line re-export (`export { normalizePhone, isValidPhone, formatPhone } from '../../shared/phone'`, and the same shape for `shared/name`). Same for `phoneLoopGuard.ts`. So there is exactly ONE implementation of each helper and nothing to dedupe; the entry's "both still exist" was true and its implication was not. Collapsing the ~9 importers onto the `shared/` path and deleting the shims is optional cosmetics, not deduplication — the shims' own comments say they are kept as the name the backend already imports.
- [ ] **(code)** **Finish the dashboard component subdirectory migration** — **49** loose `.tsx` files at `dashboard/components/` (count corrected 2026-08-21; the entry said 87, so this is already ~44% further along than the backlog claimed).
- [x] ~~**(code)** **Dead CRM schema cleanup**~~ — **DONE 2026-08-21**, migration `20260821020000_drop_dead_crm_providers`. The remainder was smaller and sharper than the entry implied: **two CHECK constraints**, `entity_sync_map_provider_check` and `tenant_integration_settings_provider_check`, both still enumerating `jobber`/`hubspot`/`servicetitan` alongside `square`. Every TypeScript hit for those names is a comment or a test documenting the 2026-06-12 removal. **Checked against prod first: both tables hold ZERO rows**, so narrowing cannot reject existing data. A constraint is a statement about what the system supports — leaving three dead providers in it says the product can sync Jobber, and nothing in the schema tells the reader that is false. `grep -icE 'jobber|hubspot|servicetitan|gohighlevel' supabase/baseline.sql` is now **0**.
- [ ] **(code)** **Migration chain squash** — **189** files in `supabase/migrations/` (count corrected 2026-08-21; the entry said 173). Do when convenient; `baseline.sql` already carries the collapsed schema.

---

## 🔵 P3 — Moat & expansion (deferred until a customer asks — build principle: no integrations on spec)

- [ ] **Square CRM deeper reads** — pull open jobs into voice context; real external OAuth + Stripe + live CRM round-trips in CI (recorder-only today).
- [ ] **Extended self-service** — public portal/login (manage all appointments); waitlist / callback-queue tool; no-show auto-marking + auto-rebook.
- [ ] **Voice enhancements** — post-call "how did we do?" SMS/NPS link; multi-language; real-time owner listen-in / barge.
- [ ] **Product expansion** — booking widget/embed; granular RBAC beyond owner/front_desk; white-label / reseller theming; public API; PDF + analytics export (CSV export shipped #189); SSO/SAML; international numbers (US-centric today); multi-DID per tenant.
- [ ] **Schedule sub-view consolidation (C1+C2)** — merge the 4 scheduler sub-views (calendar/staff/resources/list) → 2 (calendar Day/Month + Team/Resources) with one unified header. `dashboard/components/SchedulerView.tsx`. (large/UX; from the former IMPROVEMENT_IDEAS.) **Open — needs a UX design pass with Dale before build** (it changes the scheduler layout; brainstorm the target shape first).
- [ ] **Threaded demo mode (E1)** — replace the static `/demo` page with a session flag (`isDemoMode`) injecting read-only sample data into the live dashboard shell (stays in sync with real UI automatically). (large.)
- [ ] **Future CRM/platform candidates** (build-deferred per the `docs/STRATEGY.md` vendor heuristic — "how does this vendor make money?") — QuickBooks/Xero, Toast, Apple Calendar (safe infra/transaction partners); Microsoft Teams (notify-only); Vagaro/Mindbody, Acuity/Calendly (competitor-ish → shallow read or import-only).

---

## 🎨 UX backlog (separate workstream — `/ux-expert` audits)

- [x] ~~**BUG — Setup tabs don't scroll**~~ (reported by Dale 2026-07-11) — **FIXED 2026-07-11.** `SetupView`'s sub-tab panel was a plain block `<div>` with `overflow-hidden`. Two failures at once: the leaf views written as `flex-1 … overflow-y-auto` (Services, Resources, Employees, Business Settings) only get a bounded height as flex _children_, so under a block parent `flex-1` was inert — they sized to content, their own scrolling never engaged, and the parent clipped the overspill; and the plain-`<div>` views (Billing, Audit Log, Answer Debugger) have no scroll container at all. So no Setup tab scrolled. Fix: `flex-1 flex flex-col min-h-0 overflow-y-auto` (`min-h-0` is load-bearing — without it the default `min-height:auto` re-inflates the box and the clipping returns). Regression test: `dashboard/e2e/setup-tabs-scroll.spec.ts`, verified to fail against the pre-fix build.
- [ ] **(Dale — BLOCKER)** Review live scheduling **coloring/grading** so Cluster A neutral-language work can proceed (de-grade slices were reverted 2026-05-20; do not re-apply unprompted).
- [ ] **Cluster A — neutral-language / no-grading** (8 surfaces, blocked on the Dale review): `StepReview`, `SkillRelationshipMap`/`SkillMapNode`, `ResourceColumnsView`, `AppointmentListView`, `EmployeeDayFocusPanel`, `AnalyticsView`, `AppointmentDetailPanel`. (Violates the "no percentage/letter grading" product rule.)
- [x] ~~**Wizard Phase B**~~ — reversed from "held" and **shipped 2026-07-05/06** (PRs #204–#208): draft-commit `SetupWizard` + `GoLivePanel` + E2E coverage, merged to main, no prod migration needed. Full writeup + lessons in `docs/RESOLVED.md`.
- [ ] **Wizard Phase B follow-ups** (explicitly deferred in the design doc, not bugs): abandoned-test-number reaper (a `phone_status='active'` DID with no `forwarded_from_phone` and no recent `voice_sessions`) — queryable, not built; auto forwarding-verification heuristic (SIP caller-ID match instead of asking the owner) — named, not built; real Telnyx porting API integration — deferred until a real port customer per YAGNI.
- [ ] **Dense-view decomposition** — track, don't piecemeal: `SettingsView`, `TenantEditPanel`, `CRMView`, `AppointmentView`, `DashboardHome`, `CustomerDetailPanel`, scheduler orchestration, `ShiftManagementView`, `ServiceAssignmentView`/`SkillAssignmentsView`/`SkillMatrixView`. Split each overloaded view into focused sub-components (no file over ~300 lines); sequence with C1+C2 to avoid duplicated churn.
  - _First slice DONE 2026-07-05 (PR #201):_ `VoiceCallsView` 1185→711, extracted `components/voice/` (`callFormatters`, `outcome`, `CallRows`, `MessagesInbox` — each <300 lines; also closed a swallowed-failure defect in the inbox).
  - _Second slice DONE 2026-07-06 (PR #211):_ `KnowledgeBaseView` 1143→408 (`components/knowledge/`), `AnalyticsView` 970→265 (`components/analytics/`), `ShiftManagementView` 960→402 (`components/shifts/`), `DashboardHome` 838→318 (`components/home/`), `ServiceAssignmentView` 816→395 (`components/services/`). 874 dashboard tests green.
  - _Third slice DONE 2026-07-06 (PR #212):_ `AppointmentDetailPanel` 605→248 + `CustomerDetailPanel` 606→124 + `CRMView` 719→288 + `useCustomerForm` hook; `AIConfigView` 673→240 + 5 aiconfig sub-components; `BusinessSettingsView` 612→195 + 4 settings sub-components; `TenantEditPanel` 531→255 + 2 admin sub-components; `AppointmentView` 768→300 + `AppointmentCalendar` + `useAppointmentCRUD`; `VoiceCallsView` 711→243 + `CallListPanel` + `CallDetailPanel`; `SchedulerView` 532→253 + `SchedulerToolbar` + `useSchedulerActions`. 874 dashboard tests green. (`CRMView` landed at 288 lines post-decompose — at the limit, no further split needed.)
  - _Fourth slice DONE 2026-07-07 (PR #217):_ `AnalyticsMetricsGrid` 575→69 (+ `CorePerformanceMetrics` / `EngagementRetentionMetrics` / `ServiceCohortMetrics`); `RecordHistoryModal` 636→282 (+ `VersionTimeline` + `FieldRestorePanel` + `recordHistoryHelpers`); `DeletedRecordsPanel` 455→227 (+ `DeletedRecordRow` + `CopyFieldsModal`); `EmployeeManagementView` (+ `EmployeeCard` + `EmployeeEditModal`); `ResourceManagerView` (+ `ResourceCard` + `ResourceEditModal`); `TeamAccessView` 346→232 (+ `InviteTeamMemberModal`); `BusinessTypeSection` 371→269 (+ `TemplatePreviewModal`); `OutlookLayout` 692→465 (+ `layout/TenantSwitcherDropdown` + `ProfileMenuDropdown` + `ThemeSelectorDropdown` + `MobileTabBar`); `CustomerSidebar` 335→301 (+ `crm/CustomerListItem`); `api.ts` namespaced → `Api.{resource}.{action}()`; `ToggleSwitch` shared primitive. 874/874 dashboard + 2324/2324 backend tests green.
  - _Fifth slice DONE 2026-07-07 (PR #218):_ `SkillMatrixView` 334→212 (+ `skills/SkillMatrix`). Also: 55 new dashboard tests for coverage hotspots (ThemeContext, VocabularyContext, TimeInput, logger, Toast, FeedbackButton) — 874→929 dashboard tests.
  - _Coverage batch 2 DONE 2026-07-07 (PR #219):_ 81 new dashboard tests targeting 0%-coverage views — `coverage.ts`, `VersionBadge`, `SkillManagementView`, `BillingView`, `KnowledgeSuggestions`, `MessagesInbox`, `CRMIntegrationCard` — 929→1010 dashboard tests. **Remaining:** `NewSchedulerView` (1582 — do with C1+C2 scheduler consolidation); other over-300 files are unavoidable coordination code (wizard state machines, layout shell, GoLivePanel).

### Un-audited surfaces — `[REVIEW]` before beta

Each screen below has had NO dedicated UX review (owner-judgment items). Most already had a copy/a11y **partial fix** landed 2026-07-03, plus a **correctness/a11y defect batch 2026-07-05 (PR #200)** — swallowed server-failures (Shift/Resource/Employee/SuperAdmin/BusinessSettings handlers), a cross-tenant config-leak in AIConfigView, and dead controls (details in git / RESOLVED). What remains on each is the **owner-judgment layout/flow call**.

- [ ] **[REVIEW]** `AIConfigView` — "Voice Settings"; raw system-prompt ("the Brain") exposed to non-technical owners; dirty-save `warning` variant.
- [ ] **[REVIEW]** `AnalyticsView` — full layout, empty states, date-range controls, metric usefulness; no-show/"abandoned" semantics.
- [ ] **[REVIEW]** `VoiceCallsView` — list layout, transcript/summary rendering (badges/filters/vocab already aligned + a11y done).
- [ ] **[REVIEW]** `AppointmentView` + `AppointmentDetailPanel` + `AppointmentListSidebar` — 3-panel/high-density flow, mobile, status-change communication.
- [ ] **[REVIEW]** `CRMView` + `CustomerDetailPanel` — search UX, how AI call summaries surface.
- [ ] **[REVIEW]** `ProfileView` — password-change discoverability, "My Profile" vs "Business Settings" boundary.
- [ ] **[REVIEW]** `BusinessSettingsView` — what belongs here vs Setup / AI Persona.
- [ ] **[REVIEW]** `SettingsView` — owner vs super-admin split, overlap with BusinessSettingsView.
- [ ] **[REVIEW]** `EmployeeManagementView` — per-card skill-assignment model, deactivated-staff surfacing.
- [ ] **[REVIEW]** `ShiftManagementView` — team-size-conditional paths, copy-week discoverability.
- [ ] **[REVIEW]** `ResourceManagerView` — zero-resource empty state, mapping-checkbox model, "capabilities" meaning.
- [ ] **[REVIEW]** `ServiceAssignmentView` — is the 3-step wizard right, no-assignment case, cancel/exit flow.
- [ ] **[REVIEW]** `SkillMatrixView` + `SkillAssignmentsView` + `SkillRelationshipMap` — grid legibility at scale, does the map earn its keep, both-views-necessary.
- [ ] **[REVIEW]** `DeletedRecordsPanel` + `RecordHistoryModal` — discoverability, restore/copy-fields flow, version-history comprehensibility (copy-target is customers-only today).
- [ ] **[REVIEW]** `/register` — field order, post-signup first-run experience.
- [ ] **[REVIEW]** `LoginView` + `/forgot-password` + `/reset-password` — forgot→email→reset live proof, error-copy quality, mobile.
- [ ] **[REVIEW]** `SuperAdminDashboard` + `TenantCard`/`TenantCreateForm`/`TenantEditPanel` — admin-interface usability / onboarding friction (Dale-facing).
- [ ] **[REVIEW]** `FirstRunTour` — post-wizard overlay tour content/flow/copy (behavior already correct).

---

## 🧹 Doc hygiene (mechanical, ongoing — low priority)

- [ ] Continue count-drift passes (route modules / migrations / test numbers) after any new route or migration; keep secondary docs synced.
- [ ] Trim remaining historical narrative from active docs into `RESOLVED.md` when it goes cold.

---

## 🎙️ Voice — Phase 2 (after live, needs agent code + redeploy)

### Question-tree call review — 2026-07-21 07:34 call (branch `feat/question-tree-architecture`, room sim-call-1784637271290)

The call succeeded end-to-end (booked 4:30 PM ✓ linked job_inquiries.appointment_id ✓ semantic service match ✓ E.164 phone ✓ "Dale" not "Dale DeMott" ✓ no snake_case spoken ✓) — these are the conversation-layer snags it still had:

- [x] ~~**(code) Double read-back of the dictated number.**~~ — **ALREADY DONE; entry was stale (verified 2026-08-21).** The directive is conditional and the ordering was inverted so it cannot fire twice: `trees.ts` now tells the model to `record_answer` the number IMMEDIATELY and NOT read it back first, because _"the recording result hands you the exact read-back to speak (one read-back, one yes)"_; `checklistAgent.ts` states the invariant — _"read back exactly once — never skipped … and never twice"_. **The sim grader this entry asked for exists too**: `sim-questiontree.ts` counts agent read-back lines and requires exactly 1, with a comment naming _"the double read-back the unconditional host directive caused (call 7)"_.
- [x] ~~**(code) Redundant "What is the meeting about?" — third strike.**~~ — **ALREADY DONE; entry was stale (verified 2026-08-21).** Promoted to host exactly as prescribed: `checklistTools.ts` backfills `meeting_topic` from `TREE_TOPIC` (`job` → "a job opportunity", `fix_computer` → "a computer repair") whenever `booking` is selected alongside a subject tree, with the same treatment for `subject_details` when `generic_subject` rides along. Comment cites _"the third re-ask on a live call"_ and _"the promotion ladder"_. Covered by three tests in `checklistTools.test.ts`, **and the grader this entry asked for exists** — `sim-questiontree.ts` fails a run that _"asked for the topic the opener already gave"_.
- [x] ~~**(code) Silent-turn recovery fires during close.**~~ — **ALREADY FIXED; entry was stale (verified 2026-08-21).** `watchdog.ts` guards the nudge on `session.closing` before attempting `generateReply`, with a comment citing this exact 2026-07-21 hang-up, and `watchdog.test.ts` sets `closing = true` and asserts the nudge stands down. Re-checked because the new outage-voice path adds a SECOND way for the session to be closing mid-turn, and it lands on the same guard.
- [x] ~~**(code, polish) `set_purpose` passed `caller_name: ""`.**~~ — **ALREADY DONE; entry was stale (verified 2026-08-21).** `checklistTools.test.ts` carries exactly the pin this asked for — _"PIN: an empty volunteered caller_name never records (set_purpose passed "" live)"_ — passing `caller_name: ''` and asserting the node stays `open` so the real name is still asked.
- [ ] **(polish) Salary stored verbatim as words** — "one forty to one hundred and sixty thousand" in `rate_range`. Their-words capture is by design; consider a normalized display form ("$140–160k") for the owner email/dashboard alongside the verbatim.
- [ ] **(polish) Wrap-up turn is 12s long** — passed-along + email instruction + anything-else in one breath. Consider splitting the email ask from the closing question.

- [x] ~~**(code) OUTAGE VOICE — a caller must never get silence when the LLM is down.**~~ — **DONE 2026-08-21.** New `agent/src/session/outageGuard.ts` + `OUTAGE_LINE` in `holdLines.ts`. On the **2nd consecutive** `AgentSession` error with no successful speech in between, the agent plays a **pre-synthesized, cache-only** line — "I'm having some technical trouble on my end. Please try calling back in a few minutes" — and closes the call. **The line deliberately routes around the model**, which is the whole lesson of the 2026-07-21 08:56 call: every other recovery path here IS a `generateReply` or a live TTS round trip, so when the LLM is the thing that is down they all die of the same cause and the caller gets seven consecutive errors' worth of silence. Design notes: 2 not 1 (a single transient error is survivable and tripping at one would end salvageable calls); the count is CONSECUTIVE, reset by the `speaking` state transition, so a long healthy call with one blip in minute two and another in minute nine is not treated as an outage; and it fires exactly ONCE per call, because a second trip would talk over the goodbye. The line promises nothing it cannot do — no callback (the agent cannot dial out) and no message (that needs a tool round trip through the failing stack). 6 unit tests; agent suite 963 green. **The watchdog half of this item was already fixed on 2026-08-15 and the entry was stale:** the `reply_already_queued` branch no longer stands down — it arms the escalation timer, so a queued reply that produces no audio gets a spoken line at deadline2 instead of silence until the framework's 10s `ttsReadIdleTimeout`. Teaching the probe to recognise an _errored_ generation specifically would only save the wait to deadline2, inside `ENABLE_OUTPUT_WATCHDOG`, which is **off in prod** — so it would change nothing on a live call today and was not attempted on that basis.

### Phase 2 backlog

- [ ] Recording disclaimer → deterministic verbatim greeting (Illinois 2-party consent). Needs a `tenants.greeting` column + tenant-config route + `agent/src/index.ts` greeting line (currently hardcoded).
- [x] ~~`get_my_appointments` transfer-fallback string~~ — DONE 2026-07-05 (PR #198): the no-caller-ID fallbacks in `get_my_appointments`/cancel/reschedule now capability-gate the transfer offer (offer a message only when transfer is unwired).
