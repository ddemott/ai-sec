# CALL 2 — 2026-08-13 19:49:56 CT (Thu) — "a position… in the Sahara Desert", booked

|                                |                                                                               |
| ------------------------------ | ----------------------------------------------------------------------------- |
| call_id                        | `SCL_KLvqZ2JkaQFU`                                                            |
| voice_session_id               | `0818911f-68f9-4af5-858b-0c2bc424b28b`                                        |
| tenant                         | Thinking Hammer `d5e3c6a1-7b9f-4e2a-bf30-8c11a5d8e9f0`                        |
| caller                         | `+1 262-497-9039` — Camille DeMott, known customer `fba1e39f…`                |
| duration                       | 96s (19:49:56 → 19:51:34 CT)                                                  |
| outcome recorded               | `booked`                                                                      |
| writes landed                  | appointment `2ee1fa75…` Mon 2026-08-31 3:00–3:15 PM CT · 1 `customers` UPDATE |
| writes that should have landed | **0 of 1 `job_inquiries`**                                                    |

Same caller, 3 minutes after Call 1. Evidence sources identical to `CALL1.md`.

---

## Transcript

```
Assistant [0:17]  Thanks for calling! I'm Piper, Dale's AI Assistant. This call is
                  transcribed for quality and service. Dale is available for hire —
                  you can leave him a message and tell me what it's about, or I can
                  schedule some time with him. What can I do for you?
Caller    [0:22]  What's his availability next week?
Assistant [0:25]  May I have your name, please?
Caller    [0:30]  It's Camille.
Assistant [0:35]  Thanks, Camille. What would you like the meeting to be about?
Caller    [0:40]  No. A position.
Caller    [0:42]  In the Sahara Desert
Assistant [0:55]  For a meeting about a position on Monday, August 17, I have 1:00, 1:15,
                  or 1:30 in the afternoon available. Does any of those times work for
                  you, Camille? Or did you have a different time in mind?
Assistant [1:05]  It seems Dale is not available next week for a meeting about a
                  position. Would you like me to check availability for the following
                  week or take a message for him instead, Camille?
Caller    [1:13]  How about August 31 at 03:00?
Assistant [1:28]  I've booked you, Camille, with Dale DeMott for a meeting about a
                  position on Monday, August 31 at 3:00 PM. Is there anything else I
                  can help you with?
Caller    [1:31]  No. I guess that's it.
Assistant [1:36]  You're all set, Camille. Thanks for calling, and have a great day!
```

Note the two assistant turns at 0:55 and 1:05 with **no caller turn between them.**
The agent offered three slots and then, ten seconds later, told the same caller there
was no availability that week. Nothing she said caused it.

## Tool trace (from `voice_sessions.metadata.tool_calls`)

| t         | tool                       | args                                                                                                                               | ok   | ms   |
| --------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- |
| 23.7s     | `set_purpose`              | trees `[identity, booking]`, work_direction `neither_or_unclear`                                                                   | true | 2    |
| 31.3s     | `record_answer`            | `caller_name` = "Camille"                                                                                                          | true | 3    |
| 40.8s     | `record_answer`            | `meeting_topic` = "a position"                                                                                                     | true | 0    |
| 41.6s     | `get_available_slots`      | date `2026-08-17`, service_type "a position"                                                                                       | true | 1053 |
| **43.5s** | **`book_with_scheduling`** | window_from **`2026-08-17T01:00:00`**, window_to `2026-08-21T17:00:00`, description "In the Sahara Desert", **no requested_start** | true | 1013 |
| 74.9s     | `get_available_slots`      | date `2026-08-31`, requested_time `15:00`                                                                                          | true | 890  |
| 77.8s     | `book_with_scheduling`     | window_from/to `2026-08-31T15:00:00`, requested_start `2026-08-31T15:00:00`, **no description**                                    | true | 667  |
| 92.5s     | `finish_call`              | —                                                                                                                                  | true | 3930 |

Shift data confirms the offer was real: employee `334b83c7…` is scheduled
**13:00–17:00 CT every weekday** Aug 17–21, 24–28, and 31. Mon Aug 17 at 1:00 PM was
genuinely open. The "not available" sentence was false.

---

## ✅ What went right

1. **The booking landed, correctly.** `2026-08-31 15:00–15:15 CT`, inside the 1–5 PM
   shift, real employee, real resource, `status='scheduled'`. Dates spoken correctly —
   Aug 17 and Aug 31 are both Mondays in 2026.
2. **Timezone handling is right.** Stored `2026-08-31T20:00:00Z`, spoken back "3:00 PM".
   The UTC-readback bug is dead.
3. **`service_id` is populated** — `a1b2c3d4-…-0005`. Migration `20260714140000` holding.
4. **Availability search was honest at the boundary.** `get_available_slots` for
   Aug 17 returned only 1:00/1:15/1:30 rather than inventing an 11 PM slot; the
   midnight-wrap fix (`20260718003000`) is holding.
5. **Recovered from its own error.** After the false "not available", it offered two
   real next steps and took the caller's counter-proposal cleanly.
6. **`end_voice_session` re-captured context** — `customer_context.appointment_history.total`
   reads 2, with the new appointment listed. Migration `20260721130000` holding.
7. **No double-book, one goodbye, no promised text.**

---

## ❌ What went wrong

### 🔴 1 — It tried to book 1.9 seconds after offering the slots, before the caller answered.

`get_available_slots` at 41.6s → `book_with_scheduling` at **43.5s**. The caller's
next word arrives at 1:13. The model read out three options and immediately attempted
a write against a time nobody had agreed to.

It got away with it because the attempt failed. Had it succeeded, Camille would have
been booked into Monday 1:00 PM while still listening to the question asking which
time she wanted — and the transcript would show her being told about a booking she
never made.

`window_from` was `2026-08-17T01:00:00` — **1 AM**, for the 1 PM slot it had just
offered aloud. A 24-hour-clock error. The tool contract says it "books the EARLIEST
open slot at or after `window_from`", so had the window resolved against the real
13:00–17:00 shift it would have booked 1:00 PM without consent.

Two independent defects stacked: a premature write, and a wrong hour that happened to
neutralize it. Neither should be relied on to cover the other.

### 🔴 2 — The agent contradicted itself and told the caller something false.

"It seems Dale is not available next week" was untrue. The shift table has Dale open
1–5 PM every weekday that week, and the agent had recited three of those slots ten
seconds earlier. The model narrated the failed premature booking as a _statement about
availability_, over the top of its own correct answer.

Cost to the caller: she nearly walked. The recovery only happened because she
volunteered a date two weeks out.

**Why the booking attempt failed is not recoverable from the data.** `ToolCallLog`
stores `{t, tool, args, ok, ms}` — `ok:true` means "did not throw", not "succeeded."
The result body is not persisted. Two live candidates, undecidable:
(a) the 01:00 window resolved outside any shift, (b) service resolution for
"a position" returned something with no skilled/scheduled employee in that window.
This is the same class of dead end that CALL_IMPROVEMENTS.md #8 hit — batch H fixed
the "which tools fired" half and left the "what did they say back" half open.

### 🔴 3 — No `job_inquiries` row. Same root cause as Call 1.

This is a recruiting call: "a position", meeting requested with the owner. Zero job
rows. The model never even attempted `job` here — it declared
`work_direction: neither_or_unclear` at t=23.7s (before hearing "a position" at 0:40)
and never revisited.

That is partly the gate's own doing: the `neither_or_unclear` branch of `runSetPurpose`
**refuses** a `job` selection outright and tells the model to ask a clarifying question
first. And even if it had tried, the tenant's preset does not offer `job` at all:

```
business_type 'answering-service' + checklist_preset_id NULL
  → local_service_front_desk
  → identity, booking, message, generic_subject, qa, buy_service, schedule_change
  → job selectable? false
```

See `CALL1.md` §1 for the full derivation. **This is the single highest-value fix
across both calls.**

Consequence: the role, the location, the employment type, who is hiring — none of it
was collected, and the meeting on Aug 31 has no preparation attached to it.

### 🔴 4 — The owner's calendar entry says nothing about the meeting.

```
description  = "Booking via SecretaryHQ"
service      = "Personal Callback" (15 minutes)
```

Everything the caller said is missing:

- `meeting_topic` = "a position" was **recorded to the tracker** and never reached the appointment.
- `description` = "In the Sahara Desert" was passed on the **failed** attempt at 43.5s
  and **omitted from the successful one** at 77.8s. It was never recorded to a node, so
  `ACTION_ARG_BACKFILL` had nothing to restore it from — the backfill only rescues
  values the tracker owns, and location was passed as a raw arg, not an answer.

Dale opens his calendar on Aug 31 and sees: _Camille DeMott, Personal Callback, 15 min,
"Booking via SecretaryHQ."_ He will not know it is a recruiter, about a role, or where.

### 🟠 5 — "Personal Callback, 15 minutes" is the wrong booking for a job conversation.

`resolveServiceForBooking("a position")` semantic-matched nothing above threshold and
fell to the tenant default — the documented, deliberate behaviour from migration
`20260714150000` (a bad semantic match books the wrong thing silently, so it falls
through instead).

**CORRECTED 2026-08-13 after measuring** (`scripts/probe-service-match.mjs`, run against
prod). My first read said the catalog lacked a row for hiring conversations. It does
not. **"Programming Consultation" (30 min) already exists**, described as _"A meeting to
discuss a programming position or software project with Dale"_, it was embedded, and it
**was the top match**. It lost on confidence, not on absence:

| query                                        | similarity | vs 0.35 threshold                    |
| -------------------------------------------- | ---------- | ------------------------------------ |
| `a position`                                 | **0.2521** | below → fell to default              |
| `a meeting about a position`                 | 0.5142     | PASS                                 |
| `a programming position in downtown Seattle` | 0.4334     | PASS                                 |
| `a position in the Sahara Desert`            | 0.1438     | below, **and the top row was wrong** |

So the catalog is right, the threshold is right, and the miss came from the caller
giving two words. The obvious fix — have the host prefix `"a meeting about …"` before
embedding — was measured too, and **must not be shipped**: it lifts every score by
roughly a constant instead of improving discrimination, so `"four-wheel alignment"`
(0.1739 → 0.3571) and `"just to talk"` (0.3061 → 0.3956) both clear the threshold onto
Programming Consultation. That trades a safe fallback for a confident wrong booking,
which is the failure `20260714150000` exists to prevent.

Nothing to change here. What makes it survivable is fix #5 below: with the subject
stamped on the appointment, Dale sees _"About: a position — In the Sahara Desert"_ and
the service row matters much less.

### 🟠 6 — Asked a known customer for her name.

Three minutes earlier, Call 1 addressed her as "Camille DeMott" without asking —
`customer_context` was populated identically on both calls (same `customer_id`,
`is_known_customer: true`). Here it asked. Nothing changed between the calls except
the model's turn. `maybeIdentify()` / context injection is not deterministic across
calls, and a returning caller being asked her name is the most visible tell that the
system does not remember her.

### 🟠 7 — 138k input tokens for a 96-second call.

| model                 | in          | out | chars       | recorded        | real     |
| --------------------- | ----------- | --- | ----------- | --------------- | -------- |
| gpt-4.1-mini          | **137,971** | 444 | —           | **$0.00000000** | ~$0.0559 |
| aura-asteria-en       | —           | —   | 681         | **$0.00000000** | ~$0.0102 |
| nova-3                | —           | —   | —           | $0.00182033     | $0.0018  |
| gpt-4o-mini (summary) | 472         | 29  | $0.00008820 | $0.0001         |

Real ≈ **$0.068**. Recorded: **$0.0019** — **2.8% of actual.** Cause is the two-cost-table
split documented in `CALL1.md` §5.

138k input tokens across ~8 model turns is ~17k/turn. That is the cost curve of this
product and it is currently invisible. `docs/TODO.md` P0 §2 pricing is being decided
against a ledger reporting one-thirty-fifth of the bill.

### 🟠 8 — 17 seconds before the first word. Same as Call 1.

Two calls, both `[0:17]`. Consistent enough to be structural.

### 🟡 9 — Caller's "No." false start was absorbed silently.

"No. A position." — the model correctly took "a position" and dropped the "No." Good
outcome, but there is no correction path recorded; worth knowing it worked by luck of
phrasing rather than by a rule.

---

## Fixes, in order

1. **Make `job` selectable on this tenant** (see `CALL1.md` fix #1). Highest value:
   it is the only fix that changes the outcome of _both_ calls.
2. **Refuse `book_with_scheduling` without an explicit caller-confirmed time.** Either
   require `requested_start` when the previous turn offered discrete slots, or have
   the host reject a booking attempt inside N seconds of a `get_available_slots` whose
   options have not been answered. A write the caller never agreed to is the worst
   available failure mode on this path, and today only an hour-parsing typo stopped it.
3. **Never narrate a booking failure as an availability fact.** A failed
   `book_with_scheduling` means the write failed — it does not license "Dale is not
   available." The model must re-read the slots it already has, or say the honest thing
   ("something went wrong booking that — let me try again"). Ideally the tool's own
   error text says so, the way `OFF_GRID_TIME` already does.
4. **Persist tool results in `ToolCallLog`**, not just args and a did-not-throw flag.
   The reason this call went sideways is permanently unknowable without it.
5. **Stamp the meeting subject onto the appointment.** `meeting_topic` was in the
   tracker; the appointment description is a template string. Same treatment as the
   `Job details:` stamp from migration `20260716120000`.
6. **Record location to a node** so `ACTION_ARG_BACKFILL` can carry it through a retry.
7. ~~**Add a real service row** for owner-time / consultation meetings.~~
   **WITHDRAWN — measured, premise was wrong.** The row already exists and was the top
   match; it lost on confidence at 0.2521 vs a 0.35 threshold. Neither the catalog nor
   the threshold should change, and the "a meeting about …" prefix that would lift the
   score must not ship (it lifts wrong matches too). See §5 above and
   `scripts/probe-service-match.mjs`.
8. **Cost tables** — see `CALL1.md` fix #5. Blocks pricing.
9. **Make known-caller identity deterministic** — if `customer_context.is_known_customer`
   is true, the name node should be host-recorded, not left to the model's turn.

---

## Cross-call summary

|                                 | Call 1                          | Call 2                              |
| ------------------------------- | ------------------------------- | ----------------------------------- |
| Recruiting call                 | yes                             | yes                                 |
| `job_inquiries` row             | **no**                          | **no**                              |
| Root cause                      | `job` tree not in tenant preset | same                                |
| Owner gets usable detail        | "It's for programming."         | "Booking via SecretaryHQ"           |
| Told the caller something false | no                              | **yes** ("not available next week") |
| Attempted an unconsented write  | no                              | **yes** (t=43.5s)                   |
| Greeting latency                | 17s                             | 17s                                 |
| Cost recorded vs real           | 4.3%                            | 2.8%                                |

**One config line explains the biggest failure in both calls.** Two recruiting calls
reached the AI receptionist of a business whose greeting advertises the owner for hire,
and the intake tree for hiring was not on the menu.
