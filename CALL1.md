# CALL 1 — 2026-08-13 19:46:17 CT (Thu) — "position in downtown Seattle"

|                                |                                                                |
| ------------------------------ | -------------------------------------------------------------- |
| call_id                        | `SCL_3a8SkDKzxN4B`                                             |
| voice_session_id               | `60d12bcb-3e0f-4363-9e54-6ec87ac95e03`                         |
| tenant                         | Thinking Hammer `d5e3c6a1-7b9f-4e2a-bf30-8c11a5d8e9f0`         |
| caller                         | `+1 262-497-9039` — Camille DeMott, known customer `fba1e39f…` |
| duration                       | 67s (19:46:17 → 19:47:24 CT)                                   |
| outcome recorded               | `message`                                                      |
| writes landed                  | 1 `customer_messages` row · 1 `customers` UPDATE               |
| writes that should have landed | **0 of 1 `job_inquiries`**                                     |

Evidence sources: `voice_sessions.transcript`, `voice_sessions.metadata.tool_calls`
(persisted tool log), `audit_log`, `ai_cost_events`, and a local replay of
`ChecklistTracker` + `deriveChecklistRuntimeConfig` against this tenant's real config.

---

## Transcript

```
Assistant [0:17]  Thanks for calling! I'm Piper, Dale's AI Assistant. This call is
                  transcribed for quality and service. Dale is available for hire —
                  you can leave him a message and tell me what it's about, or I can
                  schedule some time with him. What can I do for you?
Caller    [0:29]  I'm wanting to know if he's interested in position in downtown Seattle
Assistant [0:40]  Thanks for letting me know you're interested in a position in downtown
                  Seattle. Could you please tell me more about the position or any
                  details you'd like Dale to know?
Caller    [0:46]  It's for programming.
Assistant [0:56]  Thanks, Camille. I've passed along your message about the programming
                  position to Dale. Anything else I can help you with?
Caller    [1:02]  No. That's all.
Assistant [1:06]  You're all set, Camille. Thanks for calling, and have a great day!
```

## Tool trace (from `voice_sessions.metadata.tool_calls`)

| t     | tool            | args                                                                                                 | ok   | ms   |
| ----- | --------------- | ---------------------------------------------------------------------------------------------------- | ---- | ---- |
| 31.8s | `set_purpose`   | trees `[identity, message]`, work_direction `caller_offers_owner_work`, caller_name "Camille DeMott" | true | 3    |
| 48.1s | `record_answer` | `message_body` = "It's for programming."                                                             | true | 1    |
| 48.1s | `set_purpose`   | trees `[identity, message, **job**]`, work_direction `caller_offers_owner_work`                      | true | 3    |
| 49.1s | `take_message`  | message "It's for programming.", caller_name "Camille DeMott"                                        | true | 801  |
| 62.9s | `finish_call`   | —                                                                                                    | true | 3666 |

`ok:true` means the tool did not throw. It does **not** mean the tool accepted the
request — a host refusal is returned as a successful string result. That distinction
is the whole story of this call.

---

## ✅ What went right

1. **Caller recognized without asking.** `set_purpose` carried `caller_name: "Camille
DeMott"` at t=31.8s — pulled from `customer_context`, never asked for. Correct
   behaviour on a carrier-attested number.
2. **Work direction classified correctly.** The model declared
   `work_direction: caller_offers_owner_work` on the _first_ `set_purpose`, from
   "is he interested in position in downtown Seattle". It understood the call.
3. **The model self-corrected.** 16 ms after recording the message body it re-issued
   `set_purpose` adding the `job` tree. The LLM did the right thing unprompted.
4. **No hallucinated capability.** Nothing promised a text, a callback time, or a
   transfer. SMS gate held.
5. **One goodbye, no double-farewell.** The `closing` latch from the 2026-07-27
   regression held.
6. **Message row upserted per call** (migration `20260801000000`) — one row, retry-safe.
7. **Tool log persisted.** This postmortem took one SQL query instead of three guesses.
   Batch H paid for itself.

---

## ❌ What went wrong

### 🔴 1 — ROOT CAUSE: the `job` tree is not selectable on this tenant. The model asked for it and the host refused.

Reproduced locally against the tenant's real config:

```
business_type       = 'answering-service'
checklist_preset_id = NULL
  ↓ resolveChecklistPresetId() falls through to the default
preset              = local_service_front_desk
selectable trees    = identity, booking, message, generic_subject, qa,
                      buy_service, schedule_change
job selectable?          false
fix_computer selectable? false
```

`shared/checklistPresetDerivation.ts` — **none of the three presets include `job`.**
`checklistTools.ts:424` then bounces any unlisted tree:

```
No tree called "job". Available: identity, booking, message, generic_subject, qa, buy_service, schedule_change.
```

So `tracker.select()` never ran for `job`; `capture_job_inquiry` never entered the
toolset; the goodbye gate never saw the tree; `finish_call` passed clean.

**This is why `job_inquiries` has zero rows for this call.** Not a selector miss, not
a prompt problem — the tree the model correctly asked for does not exist on this
tenant. Same for `fix_computer`.

The irony is exact: the greeting on this line says _"Dale is available for hire"_,
and the one tree that captures a hire is the one the preset withholds. `buy_service`
(callers buying the AI receptionist) **is** selectable; `job` is not.

Verified the gate itself is healthy — replaying this call's node sequence with `job`
actually selected gives `isResolved() === false` and 8 open nodes, so `finish_call`
_would_ have refused. The gate is fine. The tree was never in the room.

### 🔴 2 — The message body lost the entire subject of the call.

Row `82bf609e…` reads, in full:

> **"It's for programming."**

The caller's actual message — _a position in downtown Seattle_ — was never recorded
to any node. `record_answer` captured only the second utterance; the first was
answered conversationally and dropped. Dale opens his inbox and sees four words with
no city, no role, no company, no indication anyone is hiring.

The `summary` column has it right ("programming position in downtown Seattle"), which
makes this worse, not better: the correct text existed in the same row and the field
the owner actually reads did not get it.

### 🟠 3 — `work_direction` is a one-way gate.

`runSetPurpose` refuses `caller_pays_us` + `job`, and `caller_offers_owner_work` +
`buy_service`, and `neither_or_unclear` + either. It does **not** check the case that
happened here: **`caller_offers_owner_work` declared with no `job` tree selected.**
The model told the host, in a machine-readable field, that this was a work-offer call,
and the host accepted a tree set with no work-offer tree in it. The contradiction was
sitting in the arguments.

### 🟠 4 — 17 seconds of silence before the first word.

Greeting lands at `[0:17]` on the transcript clock (which starts at agent job entry,
`index.ts:408`). The caller hears nothing for that whole stretch. Call 2 shows the
identical 0:17. This is consistent, not a fluke, and it is the first thing a real
caller experiences. Needs one direct measurement of SIP-answer → first-audio-frame
to say how much of it the caller actually hears.

### 🟠 5 — Cost ledger reports 4% of the real cost.

`ai_cost_events` for this call:

| model                 | in     | out | chars       | recorded        |
| --------------------- | ------ | --- | ----------- | --------------- |
| gpt-4.1-mini          | 53,119 | 207 | —           | **$0.00000000** |
| aura-asteria-en       | —      | —   | 356         | **$0.00000000** |
| nova-3                | —      | —   | —           | $0.00114667     |
| gpt-4o-mini (summary) | 323    | 30  | $0.00006645 |

Real cost ≈ **$0.028**. Recorded: **$0.0012** — 4.3%.

Cause: there are **two** pricing tables and the calls use the stale one.
`src/services/aiCost.ts:31` has `gpt-4.1-mini` (added 2026-07-21 for exactly this
bug). The route the agent actually posts to — `/agent-tools/record-ai-cost` —
imports `COST_PER_INPUT_TOKEN` from `src/routes/agentTools/schemas.ts:62`, which
holds only `gpt-4o-mini` and `text-embedding-3-small`. The 2026-07-21 fix landed in
the file that isn't on the path. TTS is also uncosted: `aiCost.ts:41` charges audio
only when `type === 'stt_usage'`, so Aura's char-priced output is always $0.

The comment in `services/aiCost.ts` calls a cost table missing the dominant cost
"worse than no table." That is still the live state, one file over.

### 🟡 6 — 53k input tokens for a 67-second, 5-tool call.

~10k tokens per model turn — full checklist state block plus tool schemas resent every
turn. Not wrong, but it is the entire cost curve of this product, and it is invisible
while finding #5 stands.

### 🟡 7 — The tool log records arguments but not results.

`ToolCallEntry` carries `{t, tool, args, ok, ms}`. `ok` is "didn't throw." The
refusal string that killed this call is not in the row. The root cause here was
recoverable only because the refusal is deterministic and re-derivable from config —
on a non-deterministic failure it would not be.

---

## Fixes, in order

1. **Add `job` (and `fix_computer`) to the tenant's selectable trees.** Fastest
   correct path for this tenant: a preset that includes them, or an override.
   `local_service_front_desk` covering every non-salon, non-auto-shop business while
   omitting `job` is the structural bug — a `job` call is not exotic, it is the
   primary traffic on this line.
2. **Make an unknown tree in `set_purpose` loud.** Today it returns a string the model
   can ignore. It should also emit `errors_total{event="tree_not_selectable"}` — a
   correct model request being silently denied by config should never again be
   invisible until a postmortem.
3. **Extend the work-direction gate to under-selection:** `caller_offers_owner_work`
   with no `job` in `trees` should refuse (or, when `job` isn't selectable, say so
   plainly so the model can fall back to a _complete_ message instead of a stub).
4. **Record the message body from the whole call, not the last utterance.** The
   subject line ("position in downtown Seattle") was spoken before the model asked
   for details and never made it to a node.
5. **Put `gpt-4.1-mini` + Aura into `schemas.ts`'s tables, or delete that table and
   import `services/aiCost.ts`.** Two cost tables is the defect; one of them is
   always going to be the stale one. Blocks the pricing decision in
   `docs/TODO.md` P0 §2.
6. **Log tool results (or at least a refusal flag) in `ToolCallLog`.**
7. **Measure greeting latency** SIP-answer → first audio frame.
