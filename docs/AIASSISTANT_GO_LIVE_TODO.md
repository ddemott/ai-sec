# __PERSONA_NAME__ Go-Live — Resume Checklist
# (file renamed to AIASSISTANT_ for generic codename, was BETH_GO_LIVE_TODO.md)
# Persona name variable in seed (currently 'Chris')
# Marker: __PERSONA_NAME__  (use in docs/comments for the name; change only in seed var)

Last worked: 2026-06-05. Owner: Dale. Claude walks you through each step.

**Goal:** __PERSONA_NAME__ answers real calls on `+1 630-822-9086` (live) for Thinking Hammer LLC
(tenant `d5e3c6a1-7b9f-4e2a-bf30-8c11a5d8e9f0`). Test verification number `+1 630-822-9086`. (Previous `+1 630-866-1960` dead.)

> ## 📩 2026-06-05 — Telnyx support escalated; account healthy
> Telnyx (Mark Morse, 13:55 UTC) replied: *"We have escalated these call examples to
> our team for investigation — we will let you know as soon as we hear back."* Ticket
> alive + escalated; awaiting Telnyx. Account suspension (30-day negative balance,
> 2026-05-25 — the real inbound-killer) cleared 2026-06-03: paid → re-enabled →
> upgraded → ID + account verification approved. Full thread in `docs/TICKET_SUPPORT.md`.
> **Still blocked on:** (a) Telnyx's escalation findings, AND (b) the different-carrier
> dial test below.

> ## 🔄 2026-06-30 UPDATE — live number corrected to 822-9086
> Live number `+1 630-822-9086` — the real owned + routed Telnyx DID. **Dial this for the PSTN test.**
> The long-documented `+1 630-866-9086` was a transcription error: that DID was **never owned** (it routes to another business that answers). `+1 630-866-1960` is a dead recycled DID.
> Landing pages, CLAUDE, RUNBOOK, TODO, tests, and `inbound_phone` fixtures now all use **822-9086**. Open PSTN verification steps target **822-9086**.

> ## ⚠️ 2026-06-04 UPDATE — supersedes the "NOT LiveKit / Telnyx-domain / do NOT
> ## mutate the trunk" conclusion below.
> Full live-API audit found **all config correct**; the inbound failure is **PSTN
> number-reachability**, not LiveKit or Telnyx config. Details in
> `docs/TICKET_SUPPORT.md` (top) — the 2026-06-04 provisioning-audit detail was folded in there; the standalone `PROVISIONING_AUDIT.md` was removed.
> - The earlier "INVITE never reaches LiveKit → don't touch the trunk" was based on a
>   broken test (Dale dialing from his cursed/unsynced carrier — that call never even
>   reaches Telnyx). We **did** touch the trunk (correctly): normalized its number to
>   `+E.164` and added the new number.
> - **New test number bought + fully wired today: `+1 630-822-9086`** (Telnyx id
>   `2975078589701031880`, on connection `2945038451784812111`, in LiveKit trunk
>   `ST_aUM3GuCuc9wL`). `+16308661960` is a dead recycled DID — stop testing it.
> - **NEXT STEP:** call `+16308229086` from a **different carrier** (not Dale's phone)
>   while monitoring LiveKit `listRooms()`. Room appears → pipe works, wait for
>   carrier propagation. Nothing → investigate UDP transport to LiveKit Cloud.

> ## 🔁 2026-06-11 — Live call-transfer (transfer_call) shipped; needs Telnyx REFER enabled
> Built `transfer_call`: when a caller needs a human, the agent cold-transfers the
> live PSTN leg off LiveKit to `tenants.forward_phone` (owner cell) via SIP REFER
> (`SipClient.transferSipParticipant` → `tel:<E.164>`). Set the number on the
> dashboard AI Persona page ("Forward Calls to a Person"). Code + tests green; NULL
> = no forwarding (agent takes a message).
> **RUNTIME DEPENDENCY — not solvable in code:** LiveKit's transfer rides a SIP
> REFER back through the **inbound trunk**, so the **Telnyx SIP Connection must
> have call transfer / REFER enabled**. Until that's turned on Telnyx-side, every
> transfer fails at runtime (the agent degrades to taking a message). Verify on the
> same different-carrier test call as the inbound-path check below.
> Caller ID on the transferred leg shows the trunk number (can't be set per-transfer).

---

## DONE (verified)

- [x] __PERSONA_NAME__ persona + booking model + 19 KB docs seeded on tenant d5e3c6a1 (prod DB).
- [x] Telnyx account funded ($10) + upgraded (trial 1-order cap lifted).
- [x] Number **`+1 630-866-1960`** purchased. Resource id `2973794140900296302`. Status: active.
- [x] Number routed to Telnyx SIP connection **`livekit-outbound`** (`2945038451784812111`).
- [x] That connection activated (was `active:false`).
- [x] **2026-06-03** Step 1 — live LiveKit creds recovered from Railway (`ai-sec-agent`
      service vars, key `APILz8…4i7Y`) + synced to local `.env`; `listRooms()` verified OK.
      Dead key was `APIUXRAMQuWQkkk`.
- [x] **2026-06-03** Step 2 — inbound trunk rebuilt with new number. List-field update is
      unsupported, so old trunk+rule were deleted and recreated. **Current live IDs:**
      - trunk **`ST_aUM3GuCuc9wL`** (`telnyx-inbound`, numbers `["16308661960"]`,
        **allowedAddresses `["0.0.0.0/0"]`**).
      - dispatch rule **`SDR_WEL49AwBB4NW`** (`thinkinghammer-dispatch`, individual,
        roomPrefix `call-`) → trunk above → agent `ai-secretary-agent`, metadata
        `{"tenant_id":"d5e3c6a1-7b9f-4e2a-bf30-8c11a5d8e9f0"}`.
      - ⚠️ CIDR fix: first rebuild carried `allowedAddresses:["0.0.0.0"]` from the old
        (never-proven-live) trunk — that's the literal host 0.0.0.0, a deny-all allowlist
        that silently rejects every caller. Corrected to `0.0.0.0/0` (accept any source IP).
        Number format kept WITHOUT leading `+` (`16308661960`), matching the old working shape.
        TODO security hardening (post-go-live): tighten `allowedAddresses` to Telnyx's
        published SIP signaling CIDRs instead of accept-any.
      - Dead intermediates (already deleted, ignore): `ST_Li58t3gXgo4N`/`SDR_if97ky4Zf7e6`
        (orig), `ST_w2eymtkQpKcq`/`SDR_Cvs2989McV68` (broken CIDR).
- [x] **2026-06-03** Step 3 — tenant phone fields written to prod DB (was `phone_status='failed'`,
      now `inbound_phone='+16308661960'`, `phone_status='active'`, `telnyx_phone_number_id='2973794140900296302'`).
- [x] **2026-06-03** Step 4 — `ai-sec-agent` deployment SUCCESS; logs show "registered worker";
      `agent/src/index.ts:253` registers `agentName: 'ai-secretary-agent'` (matches new rule).
      PROVEN LIVE: an explicit `AgentDispatchClient.createDispatch(room, "ai-secretary-agent",
      {tenant_id:d5e3c6a1})` was picked up in ~1s (agent participant joined). Worker is
      connected NOW, not just booted. Test room cleaned up. → only the PSTN leg is untested.

---

## TODO — to finish go-live (in order)

> Steps 1–4 COMPLETE 2026-06-03 (see DONE section). Only the live test remains.

### 5. LIVE TEST — call `+1 630-866-1960`  ← ONLY REMAINING STEP (Dale dials)
- __PERSONA_NAME__ should greet (name + recording notice + 3-path question).
- Walk each path: personal / programming / SecretaryHQ.
- Try a real booking → confirm row lands in `appointments` for tenant d5e3c6a1
  inside Dale's Mon–Fri 1–5pm window (out-of-window should reject).

**2026-06-03 ~16:00 UTC — INSTRUMENTED DIAL (decisive). Leg localized: NOT LiveKit.**
Telnyx support (earlier) said the number is active but the FQDN connection "lacks inbound
call handling." Re-verified via API: connection `2945038451784812111` inbound
`default_primary_fqdn_id` = `2945040817925916333`, which MATCHES the live LiveKit FQDN
`ai-secretary-nmlkkmgf.sip.livekit.cloud:5060` — so the static config LOOKS correctly wired.
To stop guessing, ran a measured dial:
- Baseline `RoomServiceClient.listRooms()` = 0. Dale dialed `+16308661960`. Polled again at
  +0s and +5s = **still 0 rooms.** No `call-*` room, no participant — **the SIP INVITE never
  reached LiveKit.**
- Dale heard his **carrier's** recorded intercept: "The number you dialed is not in service…
  dial 611 for customer service. **Message EL402IL53**" (EL…IL = an Illinois carrier SIT).
- **Conclusion:** the call dies UPSTREAM of LiveKit (Telnyx or originating carrier). LiveKit
  is exonerated — the earlier LiveKit trunk `+`/no-`+` DNIS-format theory is RULED OUT (no
  INVITE arrives to reject). Do NOT mutate the LiveKit trunk. This matches Telnyx support's
  "inbound not handled" direction: despite the inbound FQDN pointer being set, Telnyx is not
  delivering inbound INVITEs to our SIP server.
- **Next (Telnyx-domain, see `docs/TICKET_SUPPORT.md` for the reply):** go back to Telnyx with
  the data — "We use FQDN SIP trunking (your Option 1) to LiveKit; connection
  `2945038451784812111` inbound `default_primary_fqdn_id` points to our FQDN; on an inbound
  call NOTHING arrives at our SIP server. Are you (a) finding no inbound route, or (b) routing
  to the FQDN and getting a SIP failure — and what cause code do you see?" Plus Dale checks
  Mission Control → the number's inbound routing + the FQDN connection's SIP debugging/call
  flow. Do NOT create a Call Control/TeXML app (their options 2/3 — wrong for LiveKit).

---

**2026-06-03 09:33 UTC — first dial returned SIT "the number you dialed is not in service."**
Diagnosed as PSTN activation lag, NOT config. Verified correct end-to-end:
- Telnyx: `+16308661960` status active, voice-enabled, on FQDN connection `livekit-outbound`
  (`2945038451784812111`) → FQDN `ai-secretary-nmlkkmgf.sip.livekit.cloud:5060`, no
  call-forwarding, inbound_call_screening disabled.
- LiveKit: trunk `ST_aUM3GuCuc9wL` accepts the number + `0.0.0.0/0`; rule `SDR_WEL49AwBB4NW`
  → agent; worker proven live (explicit dispatch picked up in ~1s).
- Number was only ~8h old at dial time (purchased 2026-06-03T01:18Z). SIT intercept =
  originating carrier's routing tables not yet propagated; often per-carrier.
- Could NOT pull CDRs (Telnyx detail_records record_type=voice rejected; cdr_usage_reports
  404) to prove whether the call reached Telnyx. The different-carrier retest below closes that.
- **Next:** (1) retest from a DIFFERENT phone/carrier; (2) wait up to 24h from purchase;
  (3) if dead past 24h from multiple carriers, open Telnyx ticket (number active +
  voice-configured but SIT not-in-service, no inbound CDRs).

**2026-06-03 ~12:40 UTC — STILL DEAD. Dale dialed by hand, heard recorded
"Sorry, no longer in service."** Number now ~11h old (bought 01:18Z). Full Telnyx
re-verification via API (all clean — config is NOT the problem):
- Number order `success`; number `status=active`, `release_in_progress=false`,
  `phone_number_type=local`, `source_type=number_order` (recycled DID).
- `/voice` settings: connection `livekit-outbound` (`2945038451784812111`) assigned,
  `inbound_call_screening=disabled`, `call_forwarding_enabled=false`, `translated_number=""`.
- FQDN connection: `active=true`, primary FQDN `ai-secretary-nmlkkmgf.sip.livekit.cloud:5060`.
- LiveKit trunk/rule/worker all proven live 2026-06-03 (see DONE §, Step 4).

**Root cause (high confidence): recycled-DID sticky disconnect at the PSTN layer, NOT
SIP/config.** The symptom is decisive: a *recorded* "no longer in service" announcement is
a **carrier intercept** — the call dies at the originating/transit carrier and never reaches
Telnyx. A SIP/trunk/LiveKit fault would give dead air, fast-busy, or rings-then-silence —
never a spoken announcement. `+16308661960` is a recycled local number; its prior owner's
disconnect record is still cached in carrier LERG/routing tables. Telnyx now owns + routes it
correctly, but the wider PSTN has not refreshed.

**Action plan (Dale — cannot be fixed from code/API):**
1. **Open a Telnyx support ticket now** (most effective). Wording: "Inbound calls to
   +16308661960 from multiple carriers hit a recorded 'no longer in service' intercept. No
   inbound CDRs. Number shows active + voice-configured on FQDN connection `livekit-outbound`.
   Suspect a stale disconnect record on a recycled DID — please push an upstream
   routing/activation refresh." Log the ticket number in `docs/TICKET_SUPPORT.md`.
2. **Retest from a different carrier** (phone on another network) — confirms carrier-cache
   vs universal failure.
3. **Wait** — recycled-number intercepts commonly clear 24–72h post-purchase on their own.
4. **Fastest fallback:** release this DID, buy a *different* fresh number (no disconnect
   history routes immediately) via `POST /provisioning/activate` (search→purchase→assign),
   then redo Step 2 (trunk numbers) + Step 3 (tenant phone fields) for the new number.

> Minor config note for whoever picks this up: connection inbound has `dnis_number_format=e164`
> (Telnyx sends `+16308661960` with leading `+`), but the LiveKit trunk number list is
> `["16308661960"]` (no `+`). Irrelevant while calls never reach Telnyx, but verify the match
> once the PSTN intercept clears — if __PERSONA_NAME__ still doesn't answer after a real INVITE lands,
> normalize one side.

**If the call fails, the symptom tells you the layer:**
- **Dead air / instant hangup / fast-busy** → Telnyx not forwarding to LiveKit's inbound
  SIP URI, or trunk rejecting. Check the Telnyx connection's INBOUND routing actually
  targets LiveKit's inbound SIP host (the connection is named `livekit-outbound` — verify
  its inbound leg, not just outbound). Trunk allowlist/number-match already fixed.
- **Rings, connects, then silence (no agent joins)** → worker not connected to LiveKit
  *right now*. Deployment shows SUCCESS but that only proves it booted 2026-06-02; pull
  FRESH `ai-sec-agent` logs (Railway token method: memory `reference-railway-headless`)
  and look for a recent reconnect/crash. Redeploy the service to force a fresh registration.
- **__PERSONA_NAME__ answers but booking fails** → tenant data / booking RPC, not telephony.

---

## PHASE 2 — after live (separate work, needs agent code + redeploy)

- [ ] Recording disclaimer → deterministic verbatim greeting (Illinois 2-party
      consent). Needs `tenants.greeting` column + tenant-config route +
      `tenantConfig.ts` + `agent/src/index.ts` greeting line (currently hardcoded
      "Thanks for calling…").
- [ ] Personal-call transfer tool → Dale's cell, via
      `livekit-server-sdk` TransferSipParticipant. Depends on Telnyx outbound PSTN
      (now that account is upgraded, may work — untested). v1 fallback: __PERSONA_NAME__ books
      a callback / takes a message.

---

## Side items (not blocking)

- [ ] Review the 1 pending improvement proposal: `/improve` → "Wizard pre-fill
      from business template" (a/r/s).
- [ ] Correct stale note: old SIP connection id `2973577228794726874` in earlier
      memory does NOT exist. Real LiveKit connection = `2945038451784812111`.
