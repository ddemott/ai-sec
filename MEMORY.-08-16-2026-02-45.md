# SESSION SNAPSHOT — 2026-08-16, 02:45

Read `HANDOFF.md` first (its top section is this work). This file is the state: what is
running, what changed, what is proven, and what to do next.

**Nothing is committed. Nothing is merged. Prod is untouched.** Branch `main` at
`d4f64c2`; everything below lives in the working tree.

Supersedes `MEMORY.-08-15-2026-16-57.md` (the local-call/DNS session), which is still
accurate for its own session and is summarised in `HANDOFF.md`.

---

## 1. What this session was for

"Do some E2E testing. Not just asserts but look at the output and see if there are flaws
like long pauses, repeated data that was already given, incorrect paths, anything that
is unexpected even though the assert doesn't state it. Once found, make TODO item(s)
from it and then work on fixing it." Then, on the next turn: "Fix all E2E errors found
and fix any additional errors that happen."

**Result: 20 defects found, 20 fixed, in four passes.** The graders reported at most 6
of them, and usually blamed the least interesting thing that happened.

---

## 2. The numbers

| suite / eval       | before                                    | after                   |
| ------------------ | ----------------------------------------- | ----------------------- |
| `sim-questiontree` | deadlocked on scenario 1, never reached 9 | **22/22, exit 0**       |
| `sim-offscript`    | 3/12 (25%)                                | **12/12 (100%)**        |
| `sim-toolselect`   | 10/13 (77%, exit 1)                       | **11/13 (85%, exit 0)** |
| agent suite        | 1,672                                     | **1,704** (103 files)   |
| backend suite      | 2,741                                     | **2,744** (225 files)   |
| dashboard suite    | 1,044                                     | **1,044** (97 files)    |

`npm run checks` exits 0 and now covers the **agent** package too. `verify:claude-md`
clean. `simulate.sh tools --env local` 16/16, 0 gaps.

---

## 3. The four livelocks (the part worth remembering)

Each fix exposed the next, because each gate covered a different slice of "the call
cannot end". All four were reachable on a real phone line, which has no round cap.

1. **Booking guard could never release.** `slotsAwaitingChoice` cleared only on a
   SUCCESSFUL booking, so a booking the guard refused could not clear the condition
   refusing it; and the guard returns before `failCounts`, so `ACTION_FAILURE_LIMIT`
   never engaged. Observed: 12 refused bookings + 4 refused `finish_call`, caller said
   goodbye twice. → `BOOKING_GUARD_REFUSAL_LIMIT`, budget restored on a fresh offer.
2. **Goodbye gate had no bound.** → `FINISH_REFUSAL_LIMIT` (escalate at 2, release at 5,
   log `goodbye_gate_released` with the unmet nodes) + new `tracker.unresolvedNodeIds()`.
3. **Model said goodbye instead of calling `finish_call`.** Checklist COMPLETE, demo
   booked, twenty turns of farewells. → repeating resolved-branch nudge in
   `onUserTurnCompleted` (`GOODBYE_STALL_LIMIT`).
4. **Model stopped calling tools entirely.** `book` still `ready` for a caller who
   wanted a MESSAGE. Neither new hatch could see it. → the unresolved-stall nudge no
   longer latches; it re-fires, names the blocking node, and spells out the exit the
   model never finds alone: `set_purpose` with `wrong_trees`.

**Worst single finding:** with zero successful writes the agent said "The meeting is set
for tomorrow, Tuesday, July 22 at 1:15 PM", then "I'm still finalizing your meeting."

---

## 4. Everything else that was fixed

**Data integrity** (each one something a grader passed): `caller_name` recorded as the
literal string "caller" (`placeholderNameReason()`); `callers_company` recorded as the
caller's own name (`COMPANY_NODES`); a callback message taken with NO phone number
(`CONTACTLESS_TREES` — host adds `identity` to any goal-bearing selection); `meeting_topic`
recorded as "talk with Dale", the value its own node text forbids (`topicNamesOnlyAPerson()`);
a prospect who BOOKED a demo recorded as having declined one (`BOOKING_CLOSES_OFFER`);
the role matcher knew `job opportunity` but not the plural `job opportunities`; a
dental-clinic owner who wanted to BUY filed as a generic message (buy-vs-job nudge on
`message_body`).

**`qa` was a dead end.** KB could not answer, so the agent asked the CALLER to summarize
her own question, recorded it, hung up — name discarded, no number, no message. Fixed
both halves: `qa_summary` ask text, and `answer_question` now selects message+identity
in host code when the KB fails, so the goodbye gate holds the door.

**Harness honesty.** `sim-offscript` + `sim-questiontree` counted OpenAI 429s as
behavioural failures; both now retry (honouring `Retry-After`), grade only what reached
the model, exit **2** for infrastructure. `sim-toolselect` was grading `gpt-4o-mini`,
dropped from prod 2026-07-20, while its comment claimed it was the prod model.

**Two new CI guards, both red on their first run — that is the point:**

- `agent/src/checklist/actionArgCoverage.test.ts` — every required param of every action
  tool must be backfilled, host-supplied, or declared model-only WITH A REASON. Caught
  `cancel_appointment` / `reschedule_appointment` both requiring `appointment_id`, a
  UUID the model could only get by retyping it mid-call. Fixed: `get_my_appointments` is
  wrapped and the host fills the id when the lookup returned EXACTLY ONE.
- `tests/routes/agentTools/policyFallbackContract.test.ts` — pins the RAG no-answer
  sentence on both sides of a package boundary with no shared import.

**Three flaky wall-clock tests** (`toolsClient.test.ts` `<500ms` measured 770ms;
`scheduling-atomic.test.ts` `avg<50ms` / `newAvg<100ms` against REAL Postgres — almost
certainly the 2 red backend tests seen mid-session that went green on a quiet box). Now
fake timers / opt-in `PERF_ASSERT=1` behind a loose ceiling. The test named "compare:
old 4-query approach timing" never compared anything; it now asserts the ratio.

**Root cause of the drift:** `npm run checks` never ran the agent package's
format/lint/typecheck. New `checks:agent`, wired in; agent formatted (most of the file
count in the diff).

**Two lessons that generalize:** a rule in the prompt cannot outrank an example in a
tool result (the tracker's own error listed internal tokens, and the model said
"answering_service" aloud on the next turn). And: check what a harness measures before
believing red OR green.

---

## 5. Files this session touched

`agent/src/checklist/{checklistTools,checklistAgent,tracker,trees}.ts` (+ their tests),
`agent/src/toolsClient.test.ts`, `agent/scripts/sim-{offscript,questiontree,toolselect}.ts`,
`tests/services/scheduling-atomic.test.ts`, `package.json`, `docs/TODO.md`, `HANDOFF.md`.
New: `agent/src/checklist/actionArgCoverage.test.ts`,
`tests/routes/agentTools/policyFallbackContract.test.ts`.

Working tree total: **116 changed/untracked paths** (84 tracked, +4797/−469), three
sessions stacked on `d4f64c2`.

---

## 6. What is running right now

| process      | detail                                                      |
| ------------ | ----------------------------------------------------------- |
| backend      | `node dist/src/index.js`, `started_at` 2026-08-15T18:48:18Z |
| dashboard    | `node server.js` on :4000                                   |
| agent worker | `npm run dev:local` (tsx watch), `secretary-hq-agent-dev`   |
| Docker       | `secretary-hq-db` on :5433, healthy                         |

Local dev DB: 184 migrations · Thinking Hammer has 2 services / 10 question trees.
Prod `/health` `started_at` = 2026-08-14T04:24:31Z — still the #343 build, untouched.

---

## 7. Open — deliberately

1. **Nothing is committed.** Dale's call.
2. **`trees.ts` changed** (`qa_summary` wording) and that file is template content in the
   DB since migration 20260814130000. Run `npm run trees:local` locally and the prod
   tree rollout on deploy, or tenant copies keep the old wording.
3. **Playwright never ran** — Dale chose to skip it to protect the local voice rig, so
   the 40 UI specs are unexamined. Its globalSetup does DROP SCHEMA; ASK first.
4. **`sim-toolselect` grades the LADDER**, which prod does not run. Its standing failures
   are statements about dead code; rewriting its cases onto the checklist path is a
   decision, not a bug-sweep side effect.
5. **Multi-vertical demo** — open design discussion, no code. Three options costed
   (one number per vertical / one demo tenant with all blocks / mid-call vertical
   switch). Dale has NOT answered whether the single-number requirement is about a
   business card or choosing live in front of him. See the memory note
   `multi-vertical-demo-idea`.
6. Carry-over: prod preset pin unrun (`scripts/pin-owner-for-hire-preset.sql`, only AFTER
   the agent deploys); the greeting names nobody (`persona_name`, `greeting_menu`,
   `greeting_closer`, `call_disclosure` all NULL for Thinking Hammer); WSL resolver fix
   needs root; no real PSTN call has been made.

---

## 8. To resume

```bash
npm run status -- --env local --deep      # 4/4 up?
npm test                                  # 2,744
cd agent && npx vitest run                # 1,704
npm run checks                            # now includes the agent package
# read the conversation, not just the tally — run it SERIALLY, nothing else on the API:
cd agent && SIM_TRACE=1 npx tsx scripts/sim-questiontree.ts   # expect 22/22
```

`case_intake` settled 2026-08-16: it is ALREADY unreachable on Thinking Hammer
(`business_type: answering-service` → `owner_for_hire_front_desk`, which does not enable
it). No change was needed, and deleting the block would tear out the law-firm vertical.
