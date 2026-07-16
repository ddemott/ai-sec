# Building the Call Script — Architecture, Bugs, and Gotchas

A running record of how the voice-agent call flow is built, why, and every bug we hit
getting it to work. Written so a second business — or a second developer — can rebuild
the same thing without re-paying for the lessons.

---

## ✅ VERIFIED SUCCESS POINT — 2026-07-15 (rollback anchor: COMMIT HASHES, no branch)

**The task-group call flow works end-to-end on a live voice call.** This is the point to
come back to. Everything below the line is why and how.

The `spike/task-group-ladder` branch was deliberately deleted (2026-07-16 branch cleanup —
hashes beat long-lived branches; everything below is merged into main so these commits are
permanent). To return to the verified point:

```
59651f3ec06695d483c436f2c15b5a4f9ef5a8e5   the spike tip — the exact tree re-verified live 2026-07-16
bce7ba269a7416ebe3b7382de30d20ecbea8e40b   "task-group call works cleanly on VOICE, start to finish"
5fb50d0bb4214183ff02a4e7ad5956c9d7ad190a   PR #264 merge commit into main

git checkout 59651f3                         # inspect (detached)
git branch spike/task-group-ladder 59651f3   # recreate the branch outright
```

Unmerged work preserved by hash in the same cleanup (recoverable, NOT in main):

```
7a61d2da164155ee9c9d6863f283cc6f6c256b66   fix/never-talk-over-the-caller tip (PR #263, closed) —
                                           parks save_customer_preference, talk-over fixes; needs a
                                           rebase over the #266 blocks.ts rewrite.
                                           Recover: git fetch origin pull/263/head
75553c253a95a34028ababd57ca1baf19ce2f6d8   chore/blueprints-plan-and-deno-cleanup tip (no PR) —
                                           Deno/Vapi toolchain removal + blueprints design spec.
                                           Lives only in local git objects until GC (~90 days).
```

What a real voice call did, confirmed in the database:

```
greeting → intent (begin_call) → TASK GROUP:
    identity → book_meeting → job_intake   (every rung completed)
    ✓ appointment: Programming Consultation, real time on the calendar
    ✓ job inquiry: name + phone + BOTH companies + rate + length + location, recorded
    ✓ clean goodbye by name, then hangup — NO re-collection
```

**What works (verified on the call, not just in tests):**

| Behaviour | Status |
|---|---|
| Runs the whole call as host-code rungs the model can't skip | ✅ works |
| Books the right service (semantic match) at a real time (not October) | ✅ works |
| Takes ALL job-intake details, both companies kept apart | ✅ works — the rung that used to get skipped |
| Identity flows to booking (no re-asking the phone) | ✅ works |
| Opens on what the caller already said (no "what would you like?") | ✅ works |
| No "how can I help?" re-ask after identity (positive framing) | ✅ works |
| Natural spoken summary, no markdown/run-on | ✅ works |
| Clean close by name, no end-of-call re-collection | ✅ works |

**What is NOT done yet (honest scope):**

- **5 rungs exist**: identity, book_meeting, job_intake, schedule_change (cancel /
  reschedule — added 2026-07-15 on the generic `makeRung` core, the first lookup-then-act
  rung), and take_message (added 2026-07-16 — the universal catch-all, an ACTION rung
  wrapping the real `take_message`; see below). Still not rungs: page-owner, policy Q&A.
  Adding them is now config on `makeRung`, not a new class.
- **The stack is snapshotted at group start** — a NEW goal raised at the very end ("oh, and
  can you also…") is not picked up; the fixed goodbye fires. Known limit, documented.
- **Text E2E (`sim-taskgroup.ts`) does not exercise the runtime handoff** — only a live
  call does. Keep both.
- **Behind `ENABLE_TASK_GROUP` only.** The agent answering the real phone is the prompt
  ladder, untouched.

**How to grow from 3 rungs to a full receptionist (the roadmap):**

You do NOT code per-request. You code per goal TYPE (a rung), and `begin_call` routes to it.
1. Build a rung per goal the business actually gets — same 5-part pattern, reuse existing
   tools (`cancel_appointment`, `take_message`, `get_company_policy_answer` all exist).
2. Add one boolean to `begin_call` for each, so intent detects it.
3. Add "loop back after the group" plumbing ONCE — re-run intent after `group.run()`, and if
   a new goal appeared, run a second group. That generically handles any known goal type
   raised late (the snapshotted-stack limit).

Each rung is small, safe, isolated (the loop keeps rungs from breaking each other), and has
its own tests. Adding a capability is bounded work, not a rewrite. That is the payoff.

---

## Hardening pass — a LIVE LLM caller, at volume (2026-07-15)

After the live-call success, the harness (`sim-taskgroup.ts`) was upgraded from a *scripted*
caller to a **live LLM caller**: a second model PLAYS the caller from a persona (the facts it
holds + a behavioural style — `plain`, `terse`, `chatty`, `frontloader`, `corrector`,
`rambler`) at temperature 0.9, so it words things differently every run. Same real
tasks/tools/backend/DB; every run verified against the **database**, not the transcript.
Dale's instinct — "real callers word things differently; make it bullet-proof" — was right:
the varied caller found bugs the scripted one never could, immediately.

Run at volume (30–48 runs/pass across the styles), it surfaced three more real faults. All
three fixed at the **shared instruction string**, so both flows benefit:

1. **Root cause 3, caught in the wild — and the fix is REORDERING, not prohibition.** ~1 run
   in 30, the agent gathered every job detail then *said* "I've noted that, I'll pass it
   along" **without ever calling `capture_job_inquiry`**. The instruction already *forbade*
   that exact phrase ("merely saying 'I've noted that' does nothing") — and the model said it
   anyway. **A prohibition cannot beat this; the model doesn't obey "don't."** What worked:
   reorder the action ahead of the speech — *"the instant you have the answers, your VERY
   NEXT action is to CALL the tool — before you say anything back."* Call, THEN confirm.
   Applied the same reorder preventively to the booking rung (say-you're-booked-without-
   booking is the identical failure). This is gotcha G (positive framing) applied to root
   cause 3: don't tell it what not to say, tell it what to do FIRST.

2. **A rung must survive a failed lookup it doesn't need.** `identify_caller` sits in the
   identity rung's toolset but is NOT required to finish it (`confirm_identity` is). When
   `identify_caller` returned an error, the model sometimes spiralled — "I'm having technical
   difficulties…", apology after apology, and it **never called `confirm_identity`**. The
   whole call lost at rung 1, over a tool that was never load-bearing. **Fix:** the rung's
   instructions now say a lookup hiccup never blocks completion — you already have the name
   and number, so call `confirm_identity` and move on. **Watch for:** any rung that exposes a
   tool it doesn't strictly need to complete. Either don't give it the tool (best), or tell
   it explicitly that the tool failing is survivable. A non-load-bearing tool that can derail
   the load-bearing path is a trap.

3. **The lookup error was a LOCAL DB GAP — and it teaches the debugging discipline.** The
   `identify_caller` 500 was `column "phone_verifications.call_id" does not exist`: three
   migrations were unapplied on the dev DB. The tell that cracked it: the 500 hit ONLY
   **returning** callers (the disclosure gate runs only when the customer already exists), so
   across repeated runs it looked *random* — pass, pass, pass, 500 — when it was in fact
   deterministic on "have we seen this phone before". **Get the real trace first:** a
   `SIM_TRACE=1` flag on the harness that logs every tool call + result turned "sometimes
   fails" into "`identify_caller -> {error: Backend returned 500}`", and the backend log gave
   the exact column + stack. One trace beat any amount of guessing. (Lesson mirrors
   `LESSONS_LEARNED.md` #1: measure/trace before fixing.)

**Result:** full suite **30/30 across all six styles**; in-house company-labeling **10/10**
in a focused stress run.

### Second hardening pass (2026-07-15, autonomous)

Fixed the two-companies `represents_company` wobble (a *placing-with-a-client* call
occasionally recorded as in-house) and closed three Copilot review nits. Two durable lessons:

- **DERIVE a fact from the data the model reports RELIABLY, not from a flag it flips.** The
  voice model reliably reports the two company NAMES it heard, but routinely flips the
  `represents_company` boolean. So `resolveJobCompanies` (messaging.ts) now DERIVES it: two
  different names → agency+client (false); same name → in-house (true). The trace showed the
  *residual* failures were a different bug — under the rambler style the model skipped asking
  "which company are YOU from?" and duplicated the client's name into `caller_company`, so
  even the derivation saw "same name → in-house". Fix was in the intake prompt: make
  capturing the caller's OWN company explicit and non-skippable, distinct from the client.
  Together: rambler job-only went from ~1-in-4 failing to **10/10**, full suite **19/19**.
- **The booking RPC wants a TARGETED window, not a wide one to scan.** `book_with_scheduling`
  with a wide multi-day window whose earliest slot is occupied COLLIDES ("already booked")
  rather than advancing — because the live agent always calls `get_available_slots` first and
  passes `window_from` = a known-open slot. The E2E seed learned this the hard way (a
  contended single-employee calendar): the seed now finds a real open slot via
  `available-slots`, then books that exact time. Also: a seed failure now skips that one run
  instead of throwing and crashing the whole suite.

### The take-message rung (2026-07-16, autonomous)

The 5th rung, and the clearest demonstration yet of WHY the task-group flow exists. It came
straight off a live prompt-ladder call that failed the way the ladder always fails.

**The failing call (prompt ladder).** A caller: "I'd like to leave a message for the owner…
tell him I have a job for him, and I'd like him to give me a callback." The agent collected
the name, the number, the message — then said *"I've passed that message along to the owner"*
and hung up. **`take_message` never fired. Nothing was saved.** The backend log confirmed it:
no `/agent-tools/take-message` call, no `customer_messages` row. Root cause 3 in its purest
form (a sentence is free, a tool call is work), and two rounds of prompt wording on the ladder
— including the exact instruction "saying it saves nothing, CALL the tool" — did not beat it.
The model narrated the save anyway. There was also an "out of order" tell: the ladder asked
for the message body before it had the caller's name, because the ladder sequences itself.

**The fix is structural, not more prompt.** `take_message` becomes an ACTION rung
(`takeMessageTask.ts`) wrapping the real tool; the rung completes only on a real `message_id`.
The TaskGroup loop cannot end until it does, so "I've passed that along" advances nothing —
the identical fix that stopped job-intake being skipped. Ordering fixes itself too: identity
is always rung 1 (`planCallTasks`), so the "asked for the message before the name" tell cannot
happen. `begin_call` gained a `wants_to_leave_message` boolean; the rung is placed after
book + intake, mirroring the composed-script ELSE order.

**One disambiguation the rung must carry.** A message that MENTIONS a job or a callback is
still a message — the caller ASKED to leave one. The intent step sets `wants_to_leave_message`
(not `has_job_inquiry`) for "leave a message… I have a job for him", and the rung's
instructions say a job/callback word inside a message does not send it back to booking or role
intake. Without this the widened job trigger swallows the message.

**Verified (sim, not yet a live mic call).** `sim-taskgroup.ts` gained two scenarios — a plain
message, and the job+callback message above — checked against a real `customer_messages` row
(not the transcript). **30/30 across plain/terse/chatty/frontloader**; the job+callback case
records a message and NO job inquiry every run. Unit: `takeMessageTask.test.ts` +
`callPlan.test.ts` (order + tool-narrowing). Gotcha #8 applied: the rung carries NO passthrough
tools — `take_message` is the completion and it needs nothing else, so there is nothing to
misfire. **Still unproven:** a live voice call (STT/TTS/turn-taking + the `voice_sessions`
row), exactly as with scheduling — the sim skips the runtime handoff.

---

**Two flows exist in the codebase. Know which you are reading about:**

1. **The prompt ladder** (shipped, default). The whole call is one big system prompt with
   an `IF/THEN` "ladder". The model sequences the call itself. Lives in `agent/src/prompt.ts`
   + a per-tenant script composed from `src/services/scripts/blocks.ts`.
2. **The task-group flow** (spike, behind `ENABLE_TASK_GROUP`). The call is a LiveKit
   `TaskGroup` of host-code rungs the model *cannot* skip. Lives in `agent/src/tasks/`.

The task-group flow is the direction of travel — it fixes the class of bug the prompt
ladder keeps hitting (the model skipping a step). This doc covers both, but leads with the
task-group flow because that is what to duplicate.

---

## Why we moved from prompt → task-group

The prompt ladder failed the same way over and over, on real calls: **the model would
complete one of the caller's goals and hang up with the second undone.** "I'd like a
meeting to talk about a job" is two goals — book the meeting AND record the job details —
and the model booked, then said goodbye. We tried to fix it with prompt text ("the call is
not over until every goal is done") and the model ignored it. Twice.

We researched what others do (Pipecat Flows, Parlant, Rasa CALM, LiveKit). The finding:

> You built the right thing one layer too high — in **prompt-space, where the model can
> decline to cooperate** — when the framework you already run offers the same control in
> **host-code, where it can't.**

The proof it was architectural, not a prompt/model problem: we swapped `gpt-4o-mini` →
`gpt-4.1-mini` and the eval score did **not** move (63% both, failing set still rotating).
A better model does not fix "the model skipped a step." Taking the sequencing away from the
model does.

**LiveKit ships the fix in the version already in `node_modules` (`@livekit/agents` 1.4.5,
`beta/workflows`).** `TaskGroup.onEnter` is a `while (taskStack.length > 0)` loop in host
code, and `complete()` sits AFTER the loop. The model has no tool to exit early. It cannot
narrate its way past a rung and cannot hang up with a goal unmet.

---

## The task-group architecture (what to duplicate)

```
Incoming call
   │
   ▼
index.ts entry ── speaks the tenant's PRE-GENERATED greeting (zero TTS latency)
   │
   ▼
CallRootAgent  ── the INTENT step. One tool: begin_call(wants_meeting, has_job_inquiry, …).
   │              The model's ONLY job here is to classify the ask into booleans.
   │              (Classifying one sentence = the thing LLMs are reliably good at.
   │               Sequencing a 5-step call = the thing they are bad at.)
   ▼
begin_call.execute → planCallTasks(goals) → buildCallTaskGroup() → await group.run()
   │
   ▼
TaskGroup loop (HOST CODE — the model cannot break out):
   IdentityTask     → get name + phone, read back, confirm → complete({name, phone})
   BookMeetingTask  → offer real slots, book               → complete on appointment_id
   JobIntakeTask    → walk the intake questions, record    → complete on job_inquiry_id
   │
   ▼
group.run() resolves only when the stack is EMPTY → root agent says goodbye
```

### The pieces (`agent/src/tasks/`)

| File | Role |
|---|---|
| `rung.ts` | **The generic rung core.** `makeRung(cfg)` builds an `AgentTask` with onEnter + ttsNode + completion-in-a-tool baked in. Every rung is built from it. |
| `callRootAgent.ts` | Greets, classifies intent via `begin_call`, runs the group inside that tool. |
| `callPlan.ts` | `planCallTasks(goals, deps)` → ordered `TaskSpec[]`. **This is the checklist.** Pure. Also `runtimePreamble`, `knownCallerLine`, `pick`. |
| `identityTask.ts` | Rung 1 — a COLLECT rung. Name + phone via `confirm_identity`. |
| `bookMeetingTask.ts` | Rung 2 — an ACTION rung. Wraps the real `book_with_scheduling`; completes on `appointment_id`. |
| `jobIntakeTask.ts` | Rung 3 — an ACTION rung. Wraps the real `capture_job_inquiry`; completes on `job_inquiry_id`. |
| `takeMessageTask.ts` | Rung 4 — an ACTION rung, the universal catch-all. Wraps the real `take_message`; completes on `message_id`. Carries NO passthrough tools (take_message IS the completion). |
| `schedulingTask.ts` | Rung 5 — a LOOKUP-THEN-ACT rung. Reads `get_my_appointments`, then completes on `cancel_appointment` OR `reschedule_appointment` OR `no_appointment_change`. |
| `../scripts/sim-taskgroup.ts` | E2E harness — runs the real tasks/tools/backend/DB with a **live LLM caller** (a second model plays the caller across phrasing styles). `SIM_TRACE=1` logs every tool call + result. |

### The GENERIC rung — one shape, a few TYPES (`rung.ts`)

A rung is DATA now, not a bespoke class. `makeRung(cfg)` takes `{ instructions, tools, completion }`
and returns a real `voice.AgentTask` with every rung guarantee baked in by CONSTRUCTION —
onEnter speaks, ttsNode strips markdown, and completion lives inside a tool. The
business-specific part is only the config. This killed the copy-paste that let a fourth rung
drift (forget the onEnter → dead call). There are exactly **two completion modes**, and every
rung so far — and every one we foresee — is one of them:

| TYPE | Completion mode | "Done" is… | Rungs |
|---|---|---|---|
| **Collect** | a synthetic confirm tool | the model has gathered + confirmed the facts | identity |
| **Action** | wrap the real doing-tool | the backend write returned its success id | book, job-intake, scheduling |

A **lookup-then-act** rung (scheduling) is just Action with a read tool added to `tools` and
**more than one** completion — `makeRung` accepts an array, and the first to succeed wins.
Scheduling carries three: cancel, reschedule, and a narrow `no_appointment_change` escape so a
caller with nothing upcoming can't hang the loop. Adding a business's rung is now: pick the
TYPE, write the instructions, list the load-bearing tools, name the completion. Nothing else.

To add a rung generically: `makeRung({ instructions, tools: pick(deps.tools, [...]), completion })`
where `completion` is one `{kind:'collect', …}` or `{kind:'action', …}` (or an array for a
multi-ending rung). Then register it in `planCallTasks` behind its goal flag and add the flag to
`begin_call`. The `idExtractor(idField, build)` helper turns any tool's success-id JSON into a
typed result, so an Action completion is usually one line.

### The core idea, in one sentence

**A task is an Agent with its own instructions and its own tools, and it ends ONLY when
something calls `this.complete()` — and `complete()` is called from inside a TOOL.** So
the only way out of a rung is to do the work. "Let me check…" advances nothing. "Have a
great day" advances nothing. The transition IS the tool call. (Pipecat calls this "routing
lives on the function.")

### How to add a new rung (the recipe)

1. Extend `voice.AgentTask<ResultT>`.
2. In the constructor, take the **real** tool(s) from `buildTools()` — do not reinvent them.
3. **Wrap** the tool whose success means "rung done": call the real execute, inspect its
   returned JSON for the success id, and if present call `this.complete(result)`.
4. Add `override async onEnter() { this.session.generateReply(); }` — **required, see
   gotcha #4.**
5. Add the markdown `ttsNode` override (gotcha #5) or the rung will read markdown aloud.
6. Register it in `planCallTasks` behind its goal flag, in the right order.
7. Thread any state it needs from earlier rungs via `CallState` (gotcha #2).

**And the four rules the hardening pass proved you cannot skip (each cost a lost call):**

8. **Give the rung ONLY the tools it needs to complete.** A non-load-bearing tool (a lookup
   the rung doesn't need to finish) that can error will sometimes derail the load-bearing
   path — the model apologises about the failed tool and never calls the completion tool.
   If a rung must carry such a tool, its instructions MUST say the tool failing is survivable
   ("you already have what you need — call `<completion_tool>` and move on"). Best is not to
   give it the tool at all (root cause 2 / gotcha #3).
9. **ACTION-FIRST wording: "call the tool, THEN confirm" — never the reverse.** The model
   will substitute a confirmation *sentence* for the completion *tool call* if the wording
   lets it. Write: *"the instant you have what you need, your VERY NEXT action is to CALL
   `<tool>`, before you say anything back."* This is the reliable defence against root cause
   3 inside a rung (the task-group structure defends the *ordering* of rungs; this defends
   *within* a rung).
10. **Positive framing, always (gotcha G).** Tell the rung what its next action IS, not what
    not to say. Prohibitions (even naming the exact bad phrase) do not reliably stop the
    model — reordering the instruction to a positive "do X first" does. Reserve negations for
    hard prohibitions where the prohibition itself IS the instruction ("never offer a time
    not in the list").
11. **Every fact from an earlier rung goes in THIS rung's instructions, not just the chat
    context.** A task's system prompt is fresh; the chat history carries the conversation but
    the model acts on its *instructions*. Inject the caller's name/number/prior-answers
    explicitly so the rung doesn't re-ask (root cause 1 / gotcha #6).

### How to duplicate for a new vertical

The intake rung is the only vertical-specific piece. A real-estate line is the same
identity + book rungs with a different intake rung (buyer/seller/agent branches). Mirror
`jobIntakeTask.ts` → `realEstateIntakeTask.ts`, register it under a new goal flag. Same as
the prompt ladder's swappable `INTAKE_*` blocks in `src/services/scripts/blocks.ts`.

---

## THE GOTCHAS (the things that cost us real calls)

These are ordered by how much time they burned. Every one passed unit tests and only a
whole-call run exposed it — **which is the meta-lesson: test the assembled call, not the
pieces.**

### 1. Tasks are BLIND to runtime context (date, hours) — they book October

Each task has its OWN instructions, which **replace** the system prompt where `buildSystemPrompt`
injects the current date and business hours. So inside the booking rung the model didn't
know what "today" was and queried availability for **October**, hit the "nothing that day"
fallback (raw soonest-from-now times like *1:41 PM*, drifting minute to minute), and every
`book_with_scheduling` failed `EMPLOYEE_NOT_SCHEDULED`.
**Fix:** `runtimePreamble(rt)` — "Today is X, we are open Y" — prepended to every rung.
**Watch for:** any new rung that reasons about time needs the preamble.

### 2. State does NOT flow between rungs — booking re-asks for the phone

Identity captured and confirmed the phone; the booking rung then asked for it *again*,
because each task is a separate agent with a fresh context and `book_with_scheduling`
**requires** a phone parameter. The booking failed.
**Fix:** a shared mutable `CallState` object in `deps` — identity writes `{callerName,
callerPhone}`, later rungs read it (their factories run *after* identity completes, so the
value is there). Also: identity sets `ctx.spokenPhone` so backend tools can fall back to
it, and the booking wrapper **defaults** the known name/phone into the call so a model that
forgets to pass them still books.
**Watch for:** anything a later rung needs that an earlier rung learned MUST go through
`CallState`. The chat context carries the conversation, but a task's *system prompt* is
fresh, so put facts a rung must act on into its instructions explicitly.

### 3. Passing the WHOLE toolbox to a task defeats the whole point

`BookMeetingTask` was handed `deps.tools` (all 24 tools). The model reached past the clean
`get_available_slots` (15-minute grid) for `get_scheduling_options` (raw resource times)
and had the bug-#3 traps `book_appointment`/`check_availability` available too.
**Fix:** `pick(tools, [...])` — each rung gets ONLY its own tools. Booking gets exactly
`get_available_slots`, `get_service_catalog`, `book_with_scheduling`. Nothing else.
**Watch for:** the temptation to "just pass everything." A tool a rung does not have is a
tool the model cannot misfire. This is the narrow-toolset benefit TaskGroup gives you — but
only if you actually narrow.

### 4. A task with no `onEnter` takes over and sits SILENT — the call hangs

First live call: `begin_call` fired, the group started, `IdentityTask` became the active
agent — and said nothing while the caller repeated "hello? you there?". An `AgentTask` does
not speak on entry unless you tell it to.
**Fix:** `override async onEnter() { this.session.generateReply(); }` on every conversational
rung. (The shipped `WarmTransferTask` defines `onEnter` for the same reason.)
**Watch for:** every new rung needs this. It is the easiest thing to forget and it produces
a totally dead call with no error in the log.

**Meta-gotcha:** our text E2E harness (`sim-taskgroup.ts`) drives the tasks' tools directly
and does **not** exercise the real `TaskGroup.run()` agent-swap. So it validated task logic,
state flow, and DB writes — but could NOT catch the missing `onEnter`. Only a live voice
call did. The harness is necessary but not sufficient; a real call is still the final gate.

### 5. Markdown reaches TTS on the task path — the summary reads as a run-on

The main path strips markdown via `SpeakingAgent.ttsNode`. The task agents are plain
`voice.Agent`, so a model that answered with a **bulleted summary** ("- Caller Company: ABC
- Client Company: Northern Trust") had its dashes and newlines read straight to Deepgram,
which collapsed them into one flat run with no pauses. Reported as "it ran the lines
together."
**Fix (two parts):** (a) add the `ttsNode` sanitizer override to every task agent AND
`CallRootAgent`; (b) instruct the intake rung to confirm in ONE natural sentence, never a
bulleted/field-labelled list — a list has no sentence boundaries so TTS never pauses.
**Watch for:** any new agent on this path needs the `ttsNode` override, or markdown leaks
to voice.

### 7. The root agent's persona must NOT be the ladder — a 10k-token contradiction loses calls

index.ts passed the FULL prompt-ladder system prompt (buildSystemPrompt output, ~10.5k chars
incl. the tenant's composed RUNG script) as CallRootAgent's `persona`. So the intent agent's
prompt was 130 lines of "run the call yourself — ask their name, take the message, here is
RUNG 4" followed by 14 lines of "your ONE job is to call begin_call". Which text won was a
coin flip per call: on 2026-07-16 a booking call handed off fine, and a leave-a-message call
20 minutes later never called begin_call at all — the root agent ran the ladder's
take-a-message script conversationally, held NO take_message tool, and the caller's message
was heading for a narrated save with nothing behind it. Zero tool calls in the entire call.
**Fix:** the root agent gets an IDENTITY LINE ("You are <persona_name>, the AI receptionist
for <business>"), never a script; the rungs carry their own instructions.
**Watch for:** any agent whose prompt embeds instructions meant for a DIFFERENT layer. And a
sober eval note: a single-turn text replay (sim-begincall.ts) could NOT reproduce this even
with the identical prompt at temperature 0 — the failure only manifested on the live voice
path. Some of these only a real call catches (gotcha F applies to prompts too).

### 6. Asking for something the caller already said

After identity, the booking rung opened with "What would you like to book a meeting for?" —
but the caller had said "a meeting about a job" at the very start. The task *received*
`requestedService` but didn't use it in its instructions.
**Fix:** inject "the caller ALREADY told you: '<their words>' — do not ask, go straight to
`get_available_slots`" into the booking instructions when `requestedService` is set.
**Watch for:** any fact captured before a rung should be reflected in that rung's opening so
it doesn't re-ask. Re-asking a known thing is the single most common "it sounds robotic"
complaint.

---

## Cross-cutting gotchas (bite BOTH flows)

These are not task-group specific — they burned us on the prompt ladder too and will bite
any voice agent.

### A. `??` does NOT fall through on `""` — and LLMs emit `""` constantly

`args.callback_phone ?? ctx.callerPhone` keeps an empty string, because `""` is not nullish.
A model sending `callback_phone: ""` both sends the empty string AND blocks the fallback.
**Fix:** a `blank()`/`firstPhone()` helper that treats whitespace as absent. Same bug bit
the dashboard customer-update (a blank email `""` failed `.email()` and 400'd an unrelated
name change). **Normalize blanks at the boundary, for every optional string.**

### B. The transcript is a GUESS about the truth, not the truth

Background noise became the word "Now", the agent took it as a time choice, and booked a
slot the caller never picked. STT on a phone line is lossy.
**Fix:** never book/act on a value that isn't clearly an answer to what was asked. "Yeah"/
"okay" are agreement, not a choice of time. If unsure which option they meant, ASK AGAIN.
Also: raise VAD `activationThreshold` (0.5→0.6) and `minSpeechDuration` (50ms→200ms) so a
cough isn't heard as speech, and `minSilenceDuration`/endpointing so a pause mid-phone-
number doesn't end the turn.

### C. The model narrates instead of acting

"Let me check availability…" then it never calls the tool — because a *sentence* satisfies
the instruction and a *tool call* is work. The prompt ladder had a line telling it to say
"one moment" before a lookup; that line was the CAUSE — it let the model narrate. The
task-group flow kills this structurally (the transition IS the tool call). On the prompt
path: remove any instruction to "announce" a lookup; let the runtime watchdog speak, not
the model.

### D. The runtime watchdog must not talk OVER the caller, and must not lie

The dead-air watchdog watched the AGENT for silence and fired "one moment while I check"
even when (a) the caller was mid-sentence, and (b) no tool was running (it was just LLM
latency). Two fixes: only fire when a tool is genuinely in flight (`isToolRunning()`), and
if it must fire on pure think-time say a neutral "Just a moment" that claims nothing. **A
machine that fills the silence while waiting for a human to answer is talking over them.**

### E. Never hardcode a real person's name in shared code

"I'll have **Dale** get back to you" was hardcoded in a route every tenant shares — so a
salon's caller heard it. There's now a test (`tests/noHardcodedNames.test.ts`) that fails
if a real identifier appears in shipping code. Use tenant data or a neutral word.

### H. After the group ends, the ROOT AGENT re-collects — close the session

The task-group flow runs inside `begin_call.execute` on the root agent. When
`group.run()` returns, control falls back to that root agent — whose instructions are
the START-of-call intent step ("understand the ask, collect identity"). It has no
memory that the sub-agents already booked and recorded everything (they were separate
agents with their own contexts). So with nothing left to do, it reverts to its opening
job and **asks for the name and phone AGAIN**, after the entire call was done. Seen on a
real call: "...I've passed those along to Dale. Is there anything else? … Great! I'll
need your name and the best phone number to reach you at."
**Fix:** when the group completes, DON'T hand back to the free-running root agent. Speak
a fixed, definitive goodbye (no LLM generation, no "anything else?" that invites more)
using the name from `CallState`, then `session.close()`. The rungs already confirmed the
concrete outcomes as they happened, so there is nothing left to say.
**Watch for:** any point where a sub-flow returns control to an agent whose instructions
are for a DIFFERENT phase of the call. The returning agent doesn't know what the
sub-flow did — end the call, or update its instructions to match the phase.

### G. Tell the model what TO DO, not what NOT to do

We fixed the "how can I help you?" re-ask (gotcha #6) with a negation — "do NOT ask
'how can I help'". Dale's insight: models act on positive instructions far more
reliably than negations, and naming the forbidden phrase can even prime it. The
reliable form tells the rung what its **last action IS**: "the moment you confirm
identity, your final words are a short 'Thanks, <name>' and the system takes over."
Nothing to decline — just a thing to do. **Prefer "do X" over "don't do Y" everywhere
in a script; reserve negations for hard prohibitions ("never book a time not in the
list"), where the prohibition IS the instruction.**

> Status: **VERIFIED on a live call 2026-07-15.** Positive framing ("your last words are a
> brief 'Thanks, <name>' and the system takes over") stopped the "how can I help?" re-ask
> cleanly — the agent went straight from confirming the number to offering booking times.
> Negation ("do NOT ask how can I help") had not been reliable; positive framing was.

### F. "It compiles and the tests are green" ≠ "it makes noise"

The whole reason this doc exists. A TTS engine swap passed typecheck + 567 unit tests and
took the phone line **completely silent** — not one test synthesizes a word. Every gotcha
above passed its unit tests. **The final gate is always a real call.** `cd agent && npm run
verify:tts` at least proves the voice makes sound; the browser sim (`simulate.sh call`)
proves the flow.

---

## A sample rung, annotated (copy this shape)

This is `IdentityTask` stripped to its skeleton. Every rung has the same five parts.
Copy this shape for a new rung and you inherit the guarantees for free.

```ts
export class IdentityTask extends voice.AgentTask<IdentityResult> {   // (1) typed RESULT
  constructor(opts: IdentityTaskOptions) {
    super({
      instructions: `${opts.runtimePreamble ?? ''}                     // (2) runtime facts FIRST
        Your ONE job is to get the caller's name and a confirmed phone number.
        Do not book. Do not take job details. Just identity.
        When you have both and they've confirmed the number, call confirm_identity.`,
      tools: {
        identify_caller: opts.identifyCaller,                          // (3) REUSE the real tool
        confirm_identity: llm.tool({                                   // (4) the COMPLETION tool
          parameters: { /* name, phone */ },
          execute: async ({ name, phone }) => {
            ctx.spokenPhone = phone;                                   //     write shared state
            await opts.onIdentified?.({ name, phone });
            this.complete({ name, phone });                            //     <-- THE ONLY EXIT
            return 'Got it.';
          },
        }),
      },
    });
  }
  override async onEnter() { this.session.generateReply(); }           // (5) SPEAK on entry
  override async ttsNode(text, ms) {                                   // (5) strip markdown
    return voice.Agent.default.ttsNode(this, sanitizeStream(text), ms);
  }
}
```

The five parts, and what breaks if you omit each:

| # | Part | Omit it and… |
|---|------|--------------|
| 1 | Typed `ResultT` | later rungs can't read what this one produced |
| 2 | `runtimePreamble` in instructions | the rung books October (gotcha #1) |
| 3 | reuse the real tool | you re-implement a week of bug fixes, badly |
| 4 | completion inside a tool | the model ends the rung by *talking* — the whole bug |
| 5 | `onEnter` + `ttsNode` | dead silence (#4) / markdown read aloud (#5) |

For a **booking-style** rung (BookMeeting, JobIntake) the completion tool isn't a separate
`confirm_*` — you WRAP the real doing-tool (`book_with_scheduling`, `capture_job_inquiry`)
and call `complete()` when its returned JSON has the success id. That's stronger: the
booking IS the completion, so there's no gap between "did the work" and "said it's done."

---

## WHY things break — the three root causes

Nearly every bug in this doc is one of three shapes. Learn the shapes and you predict the
bug before you write it.

### Root cause 1: A task is an ISLAND

Each task is a fresh agent — fresh system prompt, no memory of other rungs' prompts. So
**anything an earlier rung knew, a later rung does NOT know unless you carried it.** Date,
hours, the caller's name and number, what they already asked for — all invisible by
default. Gotchas #1, #2, #6 are all this one shape.

> **The tell:** if a rung needs a fact it didn't collect itself, and you didn't thread it
> in, it will ask for it again or guess it. Before writing a rung, list every fact it
> assumes — then check each one is either collected *in* the rung or threaded *into* it.

### Root cause 2: The model picks tools by DESCRIPTION SHAPE, not by intent

Tool selection is the model matching the caller's words against tool descriptions. Give it
two tools whose descriptions overlap ("remember a fact about the caller" vs "record a job
detail") and it flips a coin. Give it a messy tool alongside a clean one and it may grab the
messy one. Give it a tool with "use AFTER the questions" and it will *wait* when it should
act. Gotchas #3, and the `save_customer_preference`-stole-the-job-details bug, are this
shape.

> **The tell:** two tools that could plausibly answer the same caller sentence. Fix by (a)
> not giving a rung tools it doesn't need (`pick`), and (b) making descriptions name what
> they're FOR, not just what they do. "The ONE place job details go" beats "record a job
> inquiry."

### Root cause 3: A SENTENCE can satisfy an instruction that wanted an ACTION

"Confirm the booking" — the model says "you're all set!" without booking. "Take the job
details" — it says "I've noted that" and calls nothing. A sentence is free; a tool call is
work; offered both, the model takes the sentence. The prompt ladder is *made* of this bug.

> **The tell:** any instruction of the form "do X" where X is a tool call but the model
> could *say* it did X. The structural fix is the task-group flow itself — completion lives
> in a tool, so saying-it-did-it doesn't advance anything. On the prompt path, the only
> defence is verifying the tool actually ran (metrics + the eval's "claimed vs called"
> check).

---

## Spotting bugs from the SHAPE of the script (before they happen)

A checklist to run against a new rung or a new script, in order. Each maps to a root cause
above.

1. **List the rung's assumed facts.** For each: does it collect it, or is it threaded in via
   `CallState` / instructions? Any fact that is neither → it *will* re-ask or guess. (RC1)
2. **List the rung's tools.** Is any of them not strictly needed? Remove it. Do any two
   descriptions answer the same caller sentence? Disambiguate. (RC2)
3. **Find the completion.** Is it a tool call, and is it the REAL doing-tool (not a "say
   you're done" tool)? If the rung can end by the model talking, it will. (RC3) And is the
   wording **action-first** — "call `<tool>`, THEN confirm", never "confirm" before the call?
   (recipe rule 9)
3a. **Every tool the rung holds — is it load-bearing?** For each tool that is NOT the
   completion tool: if it errors, can the rung still finish? If the instructions don't say
   the failure is survivable, the model may spiral on it and never complete. Drop the tool or
   say "its failing is fine". (recipe rule 8)
4. **Check `onEnter` + `ttsNode` exist.** Missing `onEnter` = dead call. Missing `ttsNode` =
   markdown read aloud. (Gotchas #4, #5)
5. **Read the rung's opening line out loud.** Does it ask for something an earlier rung
   already has? (Gotcha #6) Does it produce a list/summary? Lists read as run-ons. (#5)
6. **Check the order.** Identity before anything that needs a name/number. The primary goal
   (the meeting) before the preparation for it (the details). Order is not a preference.
7. **Trace one full call on paper.** Greeting → intent → each rung → close. At the "close",
   ask: is every goal the caller stated *done*, with a tool result to prove it? If a goal
   can be reached without its tool firing, that's the skip bug.

If a script passes all seven and still misbehaves on a real call, it's almost certainly a
cross-cutting gotcha (A–F) — an empty-string, a mis-heard word, or the model narrating.

---

## Testing ladder (cheapest → most real)

1. **Unit tests** (`vitest`) — task logic, plan completeness, tool wiring. Fast, but blind
   to the assembled call (gotchas 1, 2, 4 all passed unit tests).
2. **`sim-taskgroup.ts`** — the whole call, real tasks/tools/backend/DB, **live LLM caller**
   across six phrasing styles (`plain`/`terse`/`chatty`/`frontloader`/`corrector`/`rambler`),
   verified against the DB. Catches state-flow, date-context, wrong-tool, DB-outcome, and
   **phrasing-induced** bugs a scripted caller misses. Run it at volume (`SIM_RUNS=N`) —
   several of the worst bugs showed up ~1 run in 30. `SIM_TRACE=1` logs every tool call +
   result (how the narrate-instead-of-act and the 500 were caught). **Does NOT** catch the
   runtime agent-swap / `onEnter` / TTS issues — only a live call does.
3. **`sim-toolselect.ts`** — the prompt-ladder eval; replays the real prompt + tools through
   the real model. Catches tool-selection and "narrates instead of acts". Costs OpenAI $.
4. **Browser voice call** (`simulate.sh call`, or a dispatched sim room) — the only thing
   that exercises STT/TTS/turn-taking/`onEnter`. The final gate. **Run against a dev worker
   under its own `AGENT_NAME`** so the job cannot land on the production worker.

**Gotcha for #4:** dispatched sim rooms are single-use — one greeting per dispatch. And the
local worker holds port 8081; a stale worker there silently blocks a restart (kill it by
PID, `lsof -ti :8081`).

---

## Running the task-group flow locally

```bash
# backend (has your tenant, migrated)
node dist/src/index.js &                       # https://localhost:4001

# worker on the task-group flow, its OWN name so it can't take prod's calls
cd agent
ENABLE_TASK_GROUP=true AGENT_NAME=ai-secretary-agent-dev \
  BACKEND_URL=https://localhost:4001 NODE_TLS_REJECT_UNAUTHORIZED=0 \
  node dist/index.js start

# dispatch a browser call to it
AGENT_NAME=ai-secretary-agent-dev SIM_TENANT=<tenant-uuid> node agent/scripts/sim-call.mjs

# or run the whole call end-to-end, no voice:
BACKEND_URL=https://localhost:4001 npx tsx agent/scripts/sim-taskgroup.ts
```

Flags that matter: `ENABLE_TASK_GROUP` (task flow vs prompt ladder), `ENABLE_SMS` (off until
10DLC), `ENABLE_PHONE_VERIFICATION` (off until SMS works — a code that can't be delivered
must not block a booking), `ENABLE_OUTPUT_WATCHDOG` (dead-air cover, on by default).
