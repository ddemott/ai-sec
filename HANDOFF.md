# HANDOFF

Read this first after session reset.

_Written 2026-08-14. Updated 2026-08-15 (local-call session) and 2026-08-15/16 (E2E
observation sweep — read that section first; it is the most recent work)._

## 2026-08-15/16 — E2E observation sweep: 20 defects, four of them livelocks

Goal: run the E2E lanes and **read the output**, not just the pass/fail — long pauses,
data repeated back that was already given, wrong paths, anything the asserts do not
cover. Then fix what turns up. Full write-up with per-finding evidence:
`docs/TODO.md` § "🔬 E2E observation sweep". **Nothing committed.**

**Headline: `sim-questiontree` went 22/22.** The first run of the day deadlocked on
scenario 1 and never reached scenario 9.

**Four separate livelocks, four different mechanisms.** This is the part worth
remembering — each fix exposed the next one, because each gate covered a different
slice of "the call cannot end":

1. **The booking guard could never release.** `slotsAwaitingChoice` was cleared in
   exactly one place — a _successful_ booking — so a booking the guard itself refused
   could not clear the condition that refused it. And the guard `return`s before
   `failCounts`, so `ACTION_FAILURE_LIMIT` (the existing "stop retrying" hatch) never
   engaged. Observed: 12 refused bookings + 4 refused `finish_call` in one call, the
   caller saying goodbye twice, ending only on the harness's 48-round cap. A phone
   line has no cap. → `BOOKING_GUARD_REFUSAL_LIMIT`, budget restored on a fresh offer.
2. **The goodbye gate had no bound.** → `FINISH_REFUSAL_LIMIT`: escalates on the second
   refusal, releases on the fifth, logs `goodbye_gate_released` with the unmet nodes.
3. **The model said goodbye instead of calling `finish_call`.** Checklist COMPLETE,
   demo booked — and it traded farewells for twenty turns. → a repeating resolved-branch
   nudge in `onUserTurnCompleted` (`GOODBYE_STALL_LIMIT`) that names the missing fact:
   saying goodbye does not end a call, only `finish_call` does.
4. **The model stopped calling tools entirely.** `book` still `ready` for a caller who
   wanted a _message_; neither new hatch could see it (one needs a COMPLETE checklist,
   the other needs `finish_call` to keep being called). → the unresolved-stall nudge
   no longer latches after one firing; it re-fires, names the blocking node, and spells
   out the exit the model never finds alone: **`set_purpose` with `wrong_trees`**.

**The worst single finding:** with zero successful writes the agent told a caller _"The
meeting is set for tomorrow, Tuesday, July 22 at 1:15 PM"_, then four turns later _"I'm
still finalizing your meeting."_ Same class as the Telnyx false "sent" — the caller
hangs up believing a thing exists that does not. The refusal now ends "NOTHING IS
BOOKED: do not tell the caller the meeting is set."

**Data-integrity guards, each one something the graders let through:**

- `caller_name` was recorded as the literal string **"caller"** → `placeholderNameReason()`
- `callers_company` was recorded as **the caller's own name** → `COMPANY_NODES` guard
- a message asking for a callback was taken with **no phone number** (identity was never
  selected) → `CONTACTLESS_TREES`; the host adds `identity` to any goal-bearing selection
- `meeting_topic` recorded as **"talk with Dale"** — the value its own node text forbids
  → `topicNamesOnlyAPerson()`
- a prospect who **booked a demo** was recorded as having declined one, because
  `demo_offer` stayed open and the model went hunting → `BOOKING_CLOSES_OFFER`, keyed by
  node id so the next vertical is one line, not another postmortem
- the role matcher knew `job opportunity` but **not the plural** `job opportunities`, in
  a scenario literally named "talk with Dale about job opportunities"
- a dental-clinic owner who wanted to **buy the product** was filed as a generic message
  ("called about a business opportunity") — the work-direction gate only fires when the
  model _selects_ job or buy_service; selecting **neither** had no cover

**Two lessons that generalize past this codebase:**

- **A rule in the prompt cannot outrank an example in a tool result.** The prompt says
  "never speak these internal tokens". The tracker's own rejection message listed them
  as bare words — and the model's next sentence to the caller was "would you say your
  calls go to an **answering_service**?", underscore aloud. The refusal now prints each
  id with its spoken form and says not to say them.
- **The eval harnesses were lying, in both directions.** `sim-offscript` and
  `sim-questiontree` counted OpenAI 429s as behavioural failures — printing "3/12 (25%)"
  and "16/22" for runs where the model was largely never asked. Both now retry
  (honouring `Retry-After`), grade only what reached the model, and exit **2** for
  infrastructure rather than 1 for regression. `sim-toolselect` was grading
  **gpt-4o-mini**, which prod dropped on 2026-07-20 — and its own comment claimed it was
  "the same model the agent runs". Pointing it at `gpt-4.1-mini` took it from 77%,
  exit 1, to 85%, exit 0 — with no other change.

**Two new CI guards, both of which failed on their first run — that is the point:**

- `agent/src/checklist/actionArgCoverage.test.ts` — every required param of every action
  tool a tree can fire must be backfilled, host-supplied at runtime, or **declared
  model-only with a reason**. It immediately caught `cancel_appointment` and
  `reschedule_appointment`: both require `appointment_id`, a **UUID the model could only
  get by copying it out of a tool result and retyping it mid-call**, against this
  project's own "the model never holds a UUID" rule. Fixed rather than waived —
  `get_my_appointments` is wrapped and the host fills the id when the lookup returned
  **exactly one**. Two or more stays the model's choice: guessing which booking to
  cancel is the unconfirmed-booking mistake with a worse ending.
- `tests/routes/agentTools/policyFallbackContract.test.ts` — pins the backend's RAG
  no-answer sentence on both sides of a package boundary that has no shared import,
  because `answer_question` now keys a real guarantee off it (see below).

**Three flaky-under-load tests, same class, all fixed.** `toolsClient.test.ts` asserted
an abort finished in `<500ms` and measured 770ms while the sims were running;
`scheduling-atomic.test.ts` asserted `avg < 50ms` and `newAvg < 100ms` against **real
Postgres round trips** — almost certainly the 2 red backend tests seen mid-session that
went green on a quiet box. Wall-clock thresholds are now fake timers / opt-in
(`PERF_ASSERT=1`) behind a loose ceiling. Bonus: the test named _"compare: old 4-query
approach timing"_ never compared anything — it now asserts the ratio it always claimed.

**`qa` was a dead end.** A caller asked something the knowledge base could not answer;
the agent read the fallback aloud, asked _her_ to summarize her own question (it read
`qa_summary`'s `[ASK]` marker and turned its note-taking into an interrogation),
recorded it and hung up — name discarded, no number, no message. Both halves fixed:
the ask text says whose job it is, and `answer_question` now selects the message +
identity trees **in host code** when the KB could not answer, so the goodbye gate holds
the door until a message actually lands.

**The gap that let the drift accumulate is closed:** root `npm run checks` never ran the
agent package's format/lint/typecheck. New `checks:agent` step, wired in; agent
formatted (that is most of the file count in the diff).

**Left open ON PURPOSE, both written up in `docs/TODO.md`:**

1. `sim-toolselect` grades the **LADDER**, which prod does not run — its standing
   failures are statements about dead code. Rewriting its cases onto the checklist path
   is a decision, not a bug-sweep side effect. Its pass/fail set also moves between runs.
2. **`trees.ts` changed** (`qa_summary` wording), and that file is template content in
   the DB since migration `20260814130000`. Run `npm run trees:local` locally and the
   prod tree rollout on deploy, or provisioned tenants keep the old wording.

## 2026-08-15 — local calls: the pause and the errors are gone

Goal for the session: a local call with no pause and no errors, nothing pushed to prod. **Nothing was committed and nothing was merged** — the working tree carries this session's changes on top of the batch already there.

**The pause was DNS, not TTS.** A sim call greeted at `ms_since_participant: 11944` with `pregenerated: true` — cached frame, ready, and twelve seconds of silence anyway. `dns.lookup('api.deepgram.com')` takes **11,069 ms** on this WSL host: getaddrinfo waits for A _and_ AAAA, and the Windows-side resolver (`nameserver 10.255.255.254`) takes 11 s on AAAA (`dig AAAA … @1.1.1.1`: 46 ms). Socket timeline: `{lookup: 11085, tcp: 11086, tls: 11195, done: 11607}` first request, `{done: 358}` second. **After the fix: `ms_since_participant` = 940 ms**, same cached frame.

What changed (all in the working tree):

- `agent/src/session/dnsWarm.ts` (new, + tests) — resolves the call-path hosts in **prewarm**, logs anything over 1 s at WARN, bounded at 8 s so a hung resolver can never hold a worker.
- `agent/src/session/dnsIpv4.ts` (new, + tests) — `DNS_FORCE_IPV4=true`, **default OFF**, installs an A-only lookup on `http/https.globalAgent.options.lookup`. **Not** on `dns.lookup`: `node:net` captures its default lookup by reference at module load, so patching the dns module measured 18 ms and changed nothing (first `collect()` stayed 11.7 s; via the agents it dropped to 1.7 s).
- `agent/src/index.ts` — prewarm calls the warm; `NUM_IDLE_PROCESSES` env override on `WorkerOptions` (the SDK keeps `min(cpus,4)` idle processes in production and **0** in dev, so locally the caller paid process spawn + VAD load); `tenant_config_fetched` now logs `question_tree_source` (`tenant_db` / `platform_fallback`) + `question_tree_count`.
- `agent/package.json` — **`npm run dev:local`** is now the way to run a local worker: dev agent name (the default name races the Railway worker for every dispatch), `NODE_EXTRA_CA_CERTS` (the agent's fetches to the self-signed local backend were failing TLS — that was `voice_session_start_failed` and a tenant config degraded to the name "this business"), one idle process, IPv4 lookup.
- `package.json` — `npm run trees:local` (seed templates + convert every local tenant in one command).
- `scripts/seed-question-tree-templates.ts` — the projection is now an exported `seedQuestionTreeTemplates(client)`; the CLI wrapper only runs when invoked directly.
- `tests/questionTreeRoundTrip.test.ts` — **seeds its own fixture every run.** It previously read whatever a developer had seeded by hand: a one-clause reword of `case_intake/matter_description` in `trees.ts` produced 7 failures that read like a broken conversion, and **nothing seeds templates in CI at all**, so its own guard would have thrown there on first run.
- `tests/services/browserCallerSession.test.ts` — pinned the literal banner string `Waiting up to 3 minutes`, which the (uncommitted) `SIM_CALL_JOIN_WAIT_MS` change had made a template. Now pins the default and the ordering, not the wording.
- Docs: `docs/LESSONS_LEARNED.md` (the DNS lesson), root `DEVELOPMENT_WORKFLOW.md` (local voice-call rig + the resolver fix), `CLAUDE.md`.

**Local DB state:** `test_db` was 2 migrations behind and is now at 184. The local dev DB has templates seeded and all 3 tenants converted — `/agent-tools/tenant-config` returns 10 `question_trees` and preset `owner_for_hire_front_desk` for Thinking Hammer. Playwright's globalSetup rebuilds that DB, so re-run `npm run trees:local` after an e2e run.

**Still needs root, so it is Dale's to do (optional — `DNS_FORCE_IPV4` works around it):** point the WSL resolver at 1.1.1.1 (`/etc/wsl.conf` `generateResolvConf = false` + `/etc/resolv.conf`, then `wsl --shutdown`). Commands are in root `DEVELOPMENT_WORKFLOW.md`.

**Not verified by any of this:** a real PSTN call. The browser sim proves the agent publishes audio and how fast; it sends a fake tone, not speech, so `no_caller_audio` in the log after a sim call is expected and not a fault.

### Round two — a real mic call (`sim-call-1786817155950`, 13:06 CDT) found three more

The greeting was fast (1.4 s) and the job capture worked end to end, but every SPOKEN TURN was still slow and two turns made no sound at all. Fixed:

1. **The DNS fix had only covered one seam.** `ws` sets its own `createConnection` and calls `tls.connect(options)` directly, so the global agents are never consulted. WS open **11,300 ms → 237 ms**, Aura TTS time-to-first-frame **11,445 ms → 318 ms**, once `tls.connect`/`net.connect` were patched too. The greeting (HTTP collect) had looked like proof the fix worked; the streaming path is every word after it.
2. **`silent_turn_recovered` fired twice, and its own message was wrong.** Not the tool-step cap, not an empty generation: TTS produced zero frames and LiveKit's `ttsReadIdleTimeout` (default **10 s**) ended the turn — measured at 10.003 s and 10.000 s. Three fixes: the event now reports what it observed plus `ms_since_thinking`; the watchdog's `reply_already_queued` branch arms the escalation instead of standing down (a queued reply is a promise of audio, not audio); and the cap is an explicit 4 s via `TTS_READ_IDLE_TIMEOUT_MS`.
3. **The transcript recorded a sentence the caller never heard.** The framework records assistant turns off the token stream, not off playout — so the call record showed the agent reading the phone number back, immediately followed by the caller saying "You just didn't say anything." Those lines now render as `Assistant (NOT HEARD — no audio reached the caller)`, marked from the silent-turn path.

### Round three — the booking landed, and found four more

Call `sim-call-1786818806598` (13:33 CDT) **booked** (1:00 PM Mon 17th, appointment linked to a complete `job_inquiries` row), greeting 841 ms, turns ~2–3 s, zero silent turns. What went wrong, all fixed:

1. **A 9-digit number was recorded as ✓.** `identify_caller` rejected it and the error was swallowed (it returns 200 with an `error` field; `maybeIdentify` only logs on a throw). `record_answer` now refuses an undialable `caller_phone`, names what it heard, and leaves the node open.
2. **The booking refusal dropped the caller's requested time.** He asked for 1 PM; the gate answered only about phone numbers, and he had to ask again two minutes later. `phoneGateMessage()` now leads with "I can hold 1:00 PM for you".
3. **It asked for a number "to text or call", then said it could not text.** Wording fixed, and the OTP capability is now derived — `ENABLE_PHONE_VERIFICATION && ENABLE_SMS` — so `send_verification_code` is absent while SMS is off, instead of depending on an ops note nobody had set.
4. **It asked "would you like a meeting?" after already trying to book one.** A booking ATTEMPT now records `meeting_offer: wants_meeting` in host code.

**Open, and yours:** the greeting names neither the owner nor the assistant — the caller opened with "Who's AI assistant are you? He never told me." `tenants.persona_name`, `greeting_menu`, `greeting_closer` and `call_disclosure` are all NULL for Thinking Hammer. Editable on Phone Assistant → AI Persona.

Plus: **local was not bookable** (`npm run local:business`, new `scripts/seed-local-business.ts` — localhost-only, no `--force`, idempotent). The failure was success-shaped — `{"success":true,"result":"I'm not able to pull up our booking options right now…"}` — so nothing counted it as an error and the call slid into message-taking.

## Current state

- Repo: `/home/dale/projects/secretary-hq`
- Branch: `main` (tracks `origin/main`), HEAD = `d4f64c2`
- Latest merge: PR #343 — `fix(runtime): make the job tree reachable, and stop the silent losses around it`
- Prod backend `/health` `started_at` = `2026-08-14T04:24:31.392Z` (so #343 did deploy — check this moved before believing any later merge shipped)

## What just landed

- **#340** docs sync to the shipped presets
- **#341** Step 9 wording + dry-run
- **#342** Step 10 call-path journeys
- **#343** **the job tree was unreachable by every tenant.** `job` sat in `forbidden_trees` on all three original presets, and `ChecklistOverrides` can only SUBTRACT — so no tenant configuration could select it. Two recruiter calls on 2026-08-13 wrote zero `job_inquiries` rows (`CALL1.md` / `CALL2.md`). Fix: `owner_for_hire_front_desk` preset, an unselectable-tree refusal that no longer looks like an invented-tree refusal, persisted tool RESULTS in `ToolCallLog`, and host-side refusal of an unconfirmed booking.

Live path: `tenants.checklist_preset_id` + `checklist_overrides` → `deriveChecklistRuntimeConfig` → `/agent-tools/tenant-config` → `ChecklistAgent({ runtimeConfig })`. Owners edit it on Business Settings → Call checklist.

## ROADMAP (`docs/ROADMAP.md`)

Steps 1–10 closed in CI.

## THE WORKING TREE IS NOT CLEAN (but all suites are green)

**116 changed/untracked paths, none committed** (84 tracked files, +4797/−469). Three
sessions of in-flight work stacked on `d4f64c2`, not scratch. Roughly: the batch that
was already there on 2026-08-14, the local-call/DNS session, and the E2E sweep. A large
slice of the file count is the one-off `agent/` Prettier pass — see `checks:agent`.

- **`agent/src/greetingPickup.ts` (new) + `agent/src/index.ts`** — tenant config + greeting TTS warm now run BEFORE `waitForParticipant()`, i.e. while the phone is still ringing, because `waitForParticipant` IS pickup. `GREETING_POST_PICKUP_WAIT_MS = 0`: the old cap had been raised to 12s so a slow local warm could finish, and the caller sat in dead air after join and hung up. Also: **Aura's WebSocket `speak` returned ZERO audio bytes from this dev host** while HTTP `collect` returned audio on the same key and voice — hence the collected greeting frame and the `AURA_TTS_STREAMING=false` escape hatch. Prod keeps the streaming default and has NOT been shown to have this fault; one host is not a platform outage.
- **`agent/src/checklist/checklistTools.ts` + `trees.ts`** — `meetingTopicNamesOwnerRole()` selects the `job` tree in HOST CODE when the meeting topic names a role. The node's prompt already asked the model to re-declare purpose and it did not, and by then purpose had locked anyway.
- **Legal pages** — `/privacy`, `/terms`, `/dpa` + `components/legal/LegalDocLayout.tsx`, linked from the landing footer and a required consent checkbox on `/register`. Bonterms base, not lawyer-reviewed.
- `public/caller-simulator.html` + `src/routes/callerSimulator.ts` + `dashboard/e2e/caller-pickup.spec.ts`.

**Was red, now fixed (2026-08-14):** `tests/noHardcodedNames.test.ts` caught `meetingTopicNamesOwnerRole()` hardcoding the owner's first name in its `hire|hiring` branch. That function runs for every tenant, so one business's owner name is dead weight in every other. **There is no owner-name column on `tenants`** — only `persona_name`, which names the ASSISTANT, not the person being hired — so the branch now matches pronouns and `the owner` only. The residual gap (a bare "hiring &lt;Name&gt;" no longer matches) is written into the function's comment instead of papered over: widening to "hire/hiring + any token" would swallow "hiring a plumber", a SERVICE request in this product. A name-agnostic pin test was added — that is the +1 on the agent suite below.

**Trap if this guard ever fires again:** its failure message computes line numbers AFTER stripping comments, so the line it prints does not match the file (it said `:138` for a regex on line 206). Search for the offending string; do not trust the number.

## Verified facts (measured, not copied — suite totals + evals re-run 2026-08-16, the rest 2026-08-15)

- backend route modules under `src/routes/`: **29** (plus `agentTools/`)
- `/agent-tools/*` routes: **29** (plus `_test/sync-events`, which the agent never calls)
- SQL migrations on disk: **184** · local dev DB and `test_db` both at `20260814130000`
- Playwright spec files under `dashboard/e2e/`: **40** (`caller-pickup.spec.ts` still uncommitted)
- trees in `PLATFORM_TREE_LIBRARY`: **10** · presets: **5**
- defined agent tools in `agent/src/tools.ts`: **26**
- suite totals, all three re-run against real `test_db` on **2026-08-16**: backend
  **2,744** (225 files) · dashboard **1,044** (97 files) · agent **1,704** (103 files) —
  all green. (Earlier in this doc: 2,732 / 1,044 / 1,655 as of 2026-08-15.)
- `npm run checks` exits 0 — it now also runs the **agent** package's format + lint +
  typecheck via the new `checks:agent` step; `npm run verify:claude-md` clean
- on-demand evals, 2026-08-16: `sim-questiontree` **22/22** · `sim-offscript` **12/12** ·
  `sim-toolselect` 11/13 (85%, exit 0 — grades the dead ladder path, see the sweep
  section) · `simulate.sh tools --env local` 16/16, 0 gaps
- local pickup latency, browser sim: `greeting_spoken pregenerated:true ms_since_participant` **652 ms** (tenant-DB trees) / **830 ms** (cold DB, platform fallback), zero `level:50` lines in the call
- NB `cd dashboard && npx eslint .` reports **14 pre-existing errors** (unused vars, an unescaped apostrophe) in files untouched by this session. No CI job runs eslint at all, so nothing gates on it.

## Open ops action

`scripts/pin-owner-for-hire-preset.sql` pins Thinking Hammer to the new preset. **Dale runs it, and only AFTER the agent deploys** — an unrecognized `checklist_preset_id` falls back to the derived default, so running it early is a silent no-op that looks like it worked.

## Good next checks

1. `git status --short --branch`
2. `curl -sS https://secretary-hq-production.up.railway.app/health` — `started_at` must be ≥ 2026-08-14T04:24:31Z
3. `npm test` — expect all green (**2,744**); `cd agent && npx vitest run` → **1,704**
4. Local call rig: backend + dashboard up, then `cd agent && npm run dev:local`, then `cd dashboard && npx playwright test e2e/caller-pickup.spec.ts`. Read `ms_since_participant` in the worker log.
5. Conversation quality, on demand and worth the minutes:
   `cd agent && SIM_TRACE=1 npx tsx scripts/sim-questiontree.ts` — expect **22/22**, and
   **read the transcripts**, not just the tally. Every one of the 20 defects in the
   sweep above was visible in output that a grader either passed or blamed on something
   else. Run it serially — running it alongside another OpenAI job burns the TPM ceiling
   and the scenarios come back ungraded (they now say so instead of counting as failures).

## Style reminder

Stay terse. Verify with tools. Don't trust stale markdown when the filesystem can answer it exactly.
