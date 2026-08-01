# CALL_IMPROVEMENTS

PROBLEM / ANALYSIS / SOLUTION log for real production calls that were not handled as expected.
Working document: each entry is one call, newest first. Fixes get pulled from here into `docs/TODO.md` / PRs; when a SOLUTION ships, mark the entry with the commit/PR.

Source of truth for each entry: prod `voice_sessions` (transcript, summary, outcome), `appointments`, `customer_messages`, `job_inquiries`, `customers`. Railway agent live-tail no longer covers 2026-07-27 (container restarted 2026-07-28 10:30 UTC), so tool-call-level traces for these calls are unrecoverable — where the DB can't prove which tool fired, the analysis says so.

Analyzed 2026-07-30 (12 calls: all real inbound `SCL_*` calls from 2026-07-26/27; `sim-call-*` harness rows skipped).

---

## Cross-cutting themes (from the 12 calls below)

1. **"Booked a call" has no call mechanics.** The system books a _meeting row_ but nobody defines who dials whom. The agent invents an answer under pressure — on call #9 it told the caller to "call Dale directly at two thirty **on the same number**", which is the AI's own line. That single sentence produced four more failed calls from the same caller (#5–#8).
2. **Existing bookings are invisible on repeat calls.** Caller with a live appointment called back and was told "you don't have a booked time on file" (#8). Whether `get_my_appointments` was never called, or requires an identity the caller hadn't re-established, is unprovable without agent logs — but the customer_id → phone linkage existed in the DB.
3. **Caller timezone is never reconciled.** Caller repeatedly said "2:30 **EST**"; tenant runs America/Chicago. The 2:30 booked is 2:30 CT (= 3:30 EST). No prompt/tool handles "caller states a timezone different from the tenant's".
4. **No escalation path exists on a live call.** `transfer_call` and `page_owner_via_sms` are not in the question-tree toolset (known — CLAUDE.md 2026-07-27 diff). An "urgent" caller (#7) had no route to a human and got a slot list instead.
5. **Corrections don't propagate to rows already written.** Message saved under "Jamil"; caller corrected to "Camille" 30 seconds later; message row still says Jamil (#2).
6. **STT + accented callers = garbled names/companies.** Same caller's company transcribed three ways across three calls (Connolly System / Kona VA Systems / Punoviate); "Dale" heard as "Dell" throughout; "Jamil" for "Camille". The agent builds records from first-pass STT without confirmation spelling.
7. **Junk identity rows.** Customer created named literally "Caller" (#3); customer named "Jaya from Connolly System" with `last_name = "from Connolly System"` (#10) — the company phrase went through `splitName` untouched.
8. **Silent calls get no recovery.** Four calls (13–42s) contain only the greeting: no "are you there?", no "call back or leave a message" close visible in the transcript.
9. **Ghost/duplicate bookings.** Same caller, same purpose, two live appointments 90 minutes apart (#9, #10); the first (booked 3 minutes before its own start time) was never cancelled or honored.

---

## 1. SCL_nRKo3KEVw8Yh — 2026-07-27 16:42 CT, 298s, outcome=message (Sage / eTeam, +17324018834)

> **FIX SHIPPED — PR #307** (2026-07-30): wording rule (no "message" promise on job calls), outcome `job_inquiry`, stall detector, `finish_call` once-guard, offer-meeting on the live path — plus the deep-dive finding the original analysis missed: `role_description` was dropped end-to-end (tree collected it, write had no param/field/column; now migration `20260730120000` + full plumbing + a completeness CI guard).

**PROBLEM.** 5-minute call with an AI recruiter bot. Agent promised twice to "leave a message for Dale with all the details" — **no `customer_messages` row exists for this call.** The data landed only in `job_inquiries` (correctly captured: eTeam → Capgemini, contract-to-hire, hybrid, Hanover NH, "competitive"). Call also looped: agent asked "which company / would you like to leave a message" variants ~5 times against a bot that mirrored the question back. Two consecutive goodbye utterances at the end.

**ANALYSIS.** (a) The job tree's action tool (`capture_job_inquiry`) fired and satisfied the checklist, so `take_message` never ran — but the agent's _language_ promised a message. Outcome column says `message`, the Messages inbox shows nothing; if Dale checks Messages he misses this lead unless he also checks job inquiries. Verbal promise and executed tool diverged. (b) Bot-loop: both sides were AIs politely deferring; the agent has no "caller is repeating themselves / not answering" detection, so it spent 5 minutes extracting what the bot said in its first sentence. (c) Double farewell = two `session.say`/reply turns racing at close.

**SOLUTION.** (a) When the agent verbally commits to "leaving a message", either route the commitment through `take_message`, or make the job-tree wrap-up phrasing say what actually happens ("I've recorded the position details for Dale") — never promise an artifact that won't exist. Cheapest fix: prompt wording in the job tree's confirmation; better: dashboard shows job inquiries in the same inbox as messages. (b) Add a stall detector: N consecutive caller turns with no new checklist answer → offer to wrap up. (c) Guard `finish_call` so the goodbye line renders once.

## 2. SCL_ReG7kLRiY94c — 2026-07-27 16:37 CT, 71s, outcome=message (Camille, +12624979039)

**PROBLEM.** Caller name heard as "Jamil"; message saved immediately ("returning Dale's call"); caller then corrected — "You got my name wrong… Camille, C-A-M-I-L-L-E." Message row in `customer_messages` still says **Jamil**. Customer row separately shows "Camille DeMott".

**ANALYSIS.** `take_message` wrote the row mid-call with the then-current name. `record_answer` accepted the correction and the agent acknowledged it, but nothing re-touches rows already written this call. Host-owned state was corrected; the persisted artifact wasn't — same "state theater" class as the dropped `location_type` lesson in `checklistTools.ts`.

**SOLUTION.** When `record_answer` updates a node that a _completed_ action consumed (name/phone on a saved message), re-fire an UPDATE on that call's row (`customer_messages` keyed by `call_id`). Alternatively, defer the message INSERT to call end (goodbye gate ensures it happens) so it's written with final values. Also: spelled-out corrections ("C a m I l l e") should be normalized before save.

## 3. SCL_JqvihjHH9nqp — 2026-07-27 16:06 CT, 31s, outcome=none (+14158438896)

**PROBLEM.** Robocall/bot ("Repeat this message."). Agent asked a clarifying question, call died. A **customer row named "Caller"** was created for this phone number.

**ANALYSIS.** Handling of the bot itself was fine (31s wasted, acceptable). The junk row is the failure: identity capture created a customer with the placeholder name for a caller who never identified. Junk customers pollute the dashboard, CRM export, and future context snapshots ("returning customer: Caller").

**SOLUTION.** Don't upsert a customer until a real name is recorded (or make placeholder-named customers invisible in the dashboard and eligible for cleanup). Optional: known robocall-phrase heuristic → fast polite hangup.

## 4. SCL_F8DyDDWzUEws — 2026-07-27 15:47 CT, 13s, outcome=none (+12624979039)

**PROBLEM.** 13 seconds, greeting only, no caller speech. Same number as Camille (#2), 50 minutes _before_ her message call.

**ANALYSIS.** 13s barely covers the greeting: caller hung up during or right after it. Likely bad-moment call or greeting-length impatience — this greeting is ~9s of speech before the caller may talk. Not a defect on its own, but it's one of four greeting-only calls in a single afternoon; the pattern says the greeting is long enough that early hangups look like this.

**SOLUTION.** Track a `greeting_only_hangup` metric (transcript length == greeting length). If the rate is material, shorten the greeting's first sentence and move the menu after a beat of silence. No code change on this call alone.

## 5 & 6. SCL_8onBgV2RSjiW (13:55 CT, 40s) and SCL_BRQq7dNa9xrg (14:54 CT, 42s) — outcome=none (Jaya, +17734487716)

**PROBLEM.** Two calls, 40+ seconds each, transcript contains ONLY the greeting. Caller (who had a 14:30 CT appointment and had been told at 13:03 to "call Dale on this same number") stayed on the line ~40 seconds and either said nothing the STT kept, or waited for a human, and hung up.

**ANALYSIS.** These are the direct fallout of call #9's bad instruction — the caller is doing exactly what the agent told them to do: dialing the same number at their understood meeting time and getting the AI menu instead of Dale. 40 seconds of silence with no re-prompt also means dead-air handling didn't engage (or its output isn't transcribed): nothing in the transcript between greeting and hangup.

**SOLUTION.** (a) Fix the root cause (#9's who-calls-whom). (b) Silence for >10s after greeting → one "Are you still there? I can take a message or book a time." → then a graceful close that leaves a breadcrumb row (`outcome='silent_hangup'`) instead of blank outcome. (c) Verify TranscriptRecorder captures watchdog/hold-line utterances so silent calls are diagnosable.

## 7. SCL_dpp8qN8ogCtF — 2026-07-27 13:33 CT, 95s, outcome=no_availability (Jaya, +17734487716)

**PROBLEM.** Caller: "I want to talk with him **urgently**" about the 2:30 call with "Dell". Agent offered 1:45 / 2:00 / 2:15 slots. Transcript ends mid-sentence ("Do any of these work for you,") — caller hung up. Nothing booked, no message taken, no escalation.

**ANALYSIS.** Three misses stack: (1) caller has a live 14:30 CT appointment — never surfaced; agent treats them as a new booking request; (2) "urgent" has no route — `transfer_call` / `page_owner_via_sms` are not in the tree toolset, so the strongest signal a caller can send gets a slot menu; (3) 2:30 absent from the offered slots _because the caller's own appointment occupies it_ — the agent presented the symptom (2:15 then 3:00) with no explanation, which reads as stonewalling to an already frustrated caller.

**SOLUTION.** (a) Surface existing same-day appointments for the caller's phone at call start (the `customer_context` snapshot already loads — put upcoming appointments in the checklist header so the model can't miss them). (b) Urgency keyword → offer "I'll get a message to Dale right away" (`take_message` with priority flag) until a real transfer/page path is in the toolset. (c) When a requested slot is occupied _by the caller themselves_, say that: "You already have 2:30 booked."

## 8. SCL_VcKTTgo4kS2v — 2026-07-27 13:27 CT, 136s, outcome=no_availability (Jaya, +17734487716)

> **PARTIAL FIX SHIPPED — PR #309** (2026-07-30, batch A): upcoming appointments now ride the customer-context prefetch into the checklist prompt header (the model is TOLD about the 2:30 before the first word), `get_my_appointments` is in the toolset every turn, and the prompt makes existing bookings tool-gated facts. Two sim evals pin it (header path + claimed-booking-must-check path). Root-cause bonus: the prefetch itself had been dead since 2026-07-13 (disclosure gate defaulted an omitted phone_source to 'spoken'). **BATCH C SHIPPED** (2026-07-31): `available-slots` now takes `requested_time` + a server-injected `caller_phone` and returns a verdict — `occupied_by_caller` / `occupied` / `outside_shift` / `past` / `no_room` / `closed` — with the sentence to speak and the next step to take. The caller's own booking is named ("You already have an appointment at 2:30"); a stranger's is only "already spoken for", never described. The spoken line leads with THEIR time, then the alternatives.

**PROBLEM.** Caller: "I already scheduled call with him… 2:30." Agent replied: **"It looks like you don't have a booked time on file with us yet"** — false; the 14:30 CT appointment (booked 13:05, same phone, same customer_id) was live. Then: **"we can only book on the quarter hour, so 2:30 won't work"** — incoherent (2:30 IS a quarter hour; the slot was unavailable because the caller's own appointment occupies it). Caller gave up two turns later.

**ANALYSIS.** Worst call of the set — the system contradicted its own database twice in one call. Candidate causes (logs unrecoverable, all three plausible): (1) `get_my_appointments` never called — model asserted "no booked time" from context absence; (2) it was called but returned empty because the session's customer linkage/identity gate differed on this call; (3) it returned the appointment and the model misread it. The "quarter hour" line is a model **hallucinated explanation** for a tool result (slot list missing 2:30) it didn't understand — the same class as the pre-`holdLines` "let me check that for you" narration: the model fills causal gaps with fluent falsehoods.

**SOLUTION.** (a) Make claims about existing bookings _tool-gated_: prompt rule — never assert presence/absence of an appointment without a fresh `get_my_appointments` result in this call; better, inject upcoming appointments for the caller's phone into the checklist automatically (no tool call for the model to skip). (b) When a requested time is missing from availability, return WHY in the tool result (`occupied_by_caller`, `occupied`, `outside_shift`) so the model relays a true reason instead of inventing one. (c) Add a `toolselect` eval case: caller claims an existing booking → must call `get_my_appointments` before denying.

## 9. SCL_6QQqjBf7kNQj — 2026-07-27 13:03 CT, 259s, outcome=booked (Jaya, +17734487716)

> **FIX SHIPPED — PR #310** (batch B): (a) `tenants.booking_mechanics` — the owner writes what happens at the booked time ONCE and the booking tool returns it for the agent to speak VERBATIM, so "who calls whom" is never improvised again; (b) caller-timezone reconciliation — a listen-only node plus a prompt rule that converts and confirms BOTH times before booking ("2:30 Eastern is 1:30 our time"); (c) cross-call duplicate guard — a same-day booking on a different call is refused with the appointment they already have, and the refusal carries its own exit so the call can still close.

**PROBLEM.** Booking succeeded (14:30 CT, job inquiry context captured) — then the agent destroyed it in the wrap-up. Caller: "So I need to call Dell directly at 02:30PM… Right?" Agent: **"Yes, that's right. You'll need to call Dale directly at two thirty PM today… you can use the same number."** The "same number" is the AI receptionist line. Also: caller said "2:30 **EST**" — booked as 2:30 CT (3:30 EST) with no timezone reconciliation; a duplicate meeting existed (13:00 CT from call #10, same purpose) and was neither mentioned nor cancelled; agent re-asked for the address after the caller said they'd already shared it with Dale.

**ANALYSIS.** (1) The model has no ground truth about what a booked "phone call" operationally means, so when the caller asked the reasonable question — who calls whom? — it confabulated the most agreeable answer. Every subsequent failure that afternoon (#5–#8) traces to this line. (2) "EST" was spoken plainly and dropped; slot math runs entirely in tenant timezone. (3) The double-booking: `wrapAction`'s anti-double-book guard protects _within_ a call; nothing checks "this caller already booked the same thing 6 minutes ago on a previous call."

**SOLUTION.** (a) Give the agent a factual answer for call mechanics — per-tenant setting or fixed copy: "Dale will call you at this number at the booked time." Put it in the booking tree's confirmation step so it's said every time a phone-meeting books. (b) Timezone: if the caller utters a timezone, record it (`record_answer` node on the booking tree) and confirm the converted time ("2:30 Eastern is 1:30 our time — want 1:30?"). (c) Cross-call duplicate guard: booking action checks for a same-day, same-service, non-cancelled appointment for this customer and asks "you already have 1:00 today — keep it, move it, or book both?"

## 10. SCL_yyZ7Qd7WTcQx — 2026-07-27 12:57 CT, 137s, outcome=booked (Jaya, +17734487716)

> **FIX SHIPPED — PR #310** (batch B): the tenant's active staff first names now ride the per-call config into the prompt, and an off-roster name must be offered back as a QUESTION ("Do you mean …?") — never repeated as fact, never booked against. The duplicate guard covers the 1:00/2:30 pair. STILL OPEN: name/company splitting on capture (batch D).

**PROBLEM.** Caller asked for **"Jane"** — no Jane exists (Dale is the only employee). Agent adopted the name unchallenged, confirmed "You're booked for 1:00 PM today **with Jane**" (row: Dale DeMott). Caller wanted to talk "Immediately" — agent booked a 1:00 PM slot 3 minutes in the future with no explanation of what would happen at 1:00. When the caller then said "Just schedule a call with them," the agent offered **tomorrow's** slots — losing the context that it had just booked today. Customer saved as name="Jaya from Connolly System", `last_name="from Connolly System"`.

**ANALYSIS.** (1) "Jane" is an STT mangle of "Dale" (parallel to "Dell" all afternoon); the agent had the employee list and never reconciled the requested person against it — a caller heading into a meeting believing the person is "Jane" is a trust failure even when the row is right. (2) "Immediately" → nearest slot is fine mechanically, but a 3-minute-lead booking with no "Dale will call you" statement guaranteed the confusion that followed. (3) The tomorrow-slots turn is a context miss right after its own confirmation. (4) The name is stored with the company phrase because record_answer accepted "Jaya from Connolly System" verbatim and `splitName` split on first space.

**SOLUTION.** (a) When the caller names a person, match against the employee roster; no match → "You mean Dale?" — never repeat an unknown name back as fact. (b) Same-hour bookings must state the mechanics ("Dale will call you at this number in a few minutes"). (c) Name capture: strip "from <company>" into the company field (the job tree already has both nodes — teach record_answer/prompt to split the compound utterance). (d) The tomorrow-offer context slip is model behavior worth a `toolselect`/sim case: post-booking "schedule a call" from the same caller should reference the existing booking first.

## 11. SCL_nqDRGYRWXbHi — 2026-07-27 12:47 CT, 21s, outcome=none (Jaya, +17734487716)

**PROBLEM.** Greeting-only, 21s, hangup. First contact from this caller.

**ANALYSIS.** First attempt in the Jaya sequence — caller likely startled by an AI menu when expecting a person, hung up, steeled themselves, called back 10 minutes later. Combined with #4/#5/#6, that's 4 greeting-only calls in one afternoon; the calls that followed show the caller DID want service.

**SOLUTION.** Covered by #4's metric + #5/6's silence re-prompt. A softer first sentence ("…I can book a time with Dale or take a message — how can I help?") may keep surprised callers on the line; measure before changing.

## 12. SCL_Yqp4P9cuvoMu — 2026-07-26 09:25 CT, 31s, outcome=none (+16288000576)

**PROBLEM.** Robocall ("Repeat this message."). Agent asked for a name; call ended. Call also arrived at 9:25 AM — 3.5 hours before Dale's 1 PM shift start — and nothing in the greeting or flow reflects "outside working hours."

**ANALYSIS.** Same bot pattern as #3 (no junk customer row this time — "Caller" row belongs to #3's number only). The off-hours angle matters for real callers: a human calling at 9 AM gets offered nothing time-aware; slots exist only 1–5 PM, which surfaces late and confusingly ("We're open for meetings and calls from 1 to 5", #8).

**SOLUTION.** Robocall heuristic as #3. Consider a greeting variant outside shift hours: "Dale's hours are 1–5 PM Central — I can book you a time or take a message." Cheap, uses `employee_schedule` data already loaded for availability.
