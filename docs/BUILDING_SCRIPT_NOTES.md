# Building the Call Script — Architecture, Bugs, and Gotchas

A running record of how the voice-agent call flow is built, why, and every bug we hit
getting it to work. Written so a second business — or a second developer — can rebuild
the same thing without re-paying for the lessons.

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
| `callRootAgent.ts` | Greets, classifies intent via `begin_call`, runs the group inside that tool. |
| `callPlan.ts` | `planCallTasks(goals, deps)` → ordered `TaskSpec[]`. **This is the checklist.** Pure. Also `runtimePreamble`, `knownCallerLine`, `pick`. |
| `identityTask.ts` | Rung 1. Name + phone. Completion tool: `confirm_identity`. |
| `bookMeetingTask.ts` | Rung 2. Wraps the real `book_with_scheduling`; completes on `appointment_id`. |
| `jobIntakeTask.ts` | Rung 3. Wraps the real `capture_job_inquiry`; completes on `job_inquiry_id`. |
| `../scripts/sim-taskgroup.ts` | E2E harness — runs the real tasks/tools/backend/DB, scripted caller. |

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
   you're done" tool)? If the rung can end by the model talking, it will. (RC3)
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
2. **`sim-taskgroup.ts`** — the whole call, real tasks/tools/backend/DB, scripted caller.
   Catches state-flow, date-context, wrong-tool, DB-outcome bugs. **Does NOT** catch the
   runtime agent-swap / `onEnter` / TTS issues.
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
