# Telnyx Support — Active Tickets

## New ticket — submitted 2026-05-01 (awaiting Telnyx-assigned number)

**Submitted:** 2026-05-01, daytime US Central
**Status:** Submitted; awaiting Telnyx-assigned ticket number and a human response
**Severity:** Blocking — phone unreachable for ~6 days, blocks all voice AI testing
**Reason for new ticket:** Prior ticket #2850682 went 4+ days without a human response after the auto-bot reply. Re-submitted as a new ticket to route to a fresh reviewer (LERG / porting team).

### Email submitted

**To:** support@telnyx.com
**Subject:** `+1-630-937-9478 unreachable from PSTN since purchase 2026-04-25 — likely stuck LERG/NPAC`

**Body:**

```
Hi Telnyx team,

I'm opening this as a new ticket because a prior ticket on the same
issue (#2850682, opened 2026-04-27) has gone four days without a
human response after the auto-bot's initial reply. I'd like a fresh
look from the LERG / porting team.

Issue
-----
+1-630-937-9478, purchased on 2026-04-25, has been unreachable from
PSTN since purchase. Every test call from multiple originating
carriers returns "this number is not in service" from the originating
carrier. Mission Control Portal shows zero inbound CDRs for this DID
across the entire window — calls are not reaching Telnyx at all.

This is consistent with a stuck LERG / NPAC propagation, not an
in-network routing issue. There is no SIP Call-ID to provide because
no SIP signaling ever arrives at Telnyx. Please do not close this on
the basis of "no Call-ID" — the absence of one is the symptom.

Account-side configuration (verified clean via Telnyx API, unchanged
since purchase)
---------------
- Phone number:    +1-630-937-9478
- Phone number ID: 2945732899996960462
- Status:          active
- Purchased:       2026-04-25T08:05:26Z
- Type:            local, country US
- Connection:      livekit-outbound
- Connection ID:   2945038451784812111 (FQDN)
- Inbound FQDN:    ai-secretary-nmlkkmgf.sip.livekit.cloud:5060
- DTMF:            RFC 2833
- Codecs:          G722, G711U, G711A, G729
- Routing method:  sequential

Downstream side (LiveKit Cloud) is also fully wired: the SIP
Connection above points to a registered dispatch rule and an agent
worker that has been online with LiveKit since 2026-04-25. None of
that matters yet because no PSTN call ever lands at Telnyx for the
SIP leg to begin.

Test history
------------
- CLD:        +1-630-937-9478 (every attempt)
- CLI:        multiple originating numbers, multiple mobile carriers
              plus Google Voice
- Date range: 2026-04-25 through 2026-05-01, multiple attempts per
              day
- Timezone:   US Central (CDT)
- Outcome:    "this number is not in service" intercept from the
              originating carrier on every attempt
- Telnyx-side CDRs over the same range: zero inbound attempts

Request
-------
1. Please route this to the LERG / porting team directly. First-tier
   triage cannot see the upstream records that are relevant here.

2. Verify NPAC OCN/SPID listing for +16309379478 — is Telnyx
   published as the carrier of record?

3. Verify LERG status — has the carrier-of-record change been
   published industry-wide?

4. Please confirm whether anything on Telnyx's side is holding up
   propagation (port-in flag, billing hold, account verification
   gate, etc.).

5. If this DID's LERG entry is genuinely stuck and you cannot
   resolve it in a reasonable timeframe, please tell me directly so
   I can release it and provision a different number. I have a beta
   launch blocked on this and would rather move forward with a
   working number than continue waiting.

For context, prior ticket #2850682 has the same issue documented; I
was hoping a fresh ticket would route to a human reviewer faster.
Feel free to merge or cross-reference as appropriate, but please do
not close this one without a substantive response.

Thanks,
Dale
```

### Test confirming issue still present (pre-submission)
- Re-tested before sending: `+1-630-937-9478` still returns "this number is not in service"
- Telnyx Reports still show zero inbound attempts

### Follow-up plan
- Note the assigned ticket number once Telnyx returns one and update this section
- If no human response within 24 hours, escalate via portal chat (`portal.telnyx.com` bottom-right, US Central business hours)
- If no response within 48 hours, call +1.888.980.9750 directly
- Diagnostic fallback if they stall again: provision a second DID. Second works → this number is uniquely stuck, push for release+reissue. Second also fails → wider Telnyx issue, escalate harder.

---

## Ticket #2850682 — "Not in service" on +1-630-937-9478 — SUPERSEDED

**Submitted:** 2026-04-27, 5:04 PM Central (CDT)
**Status:** SUPERSEDED 2026-05-01 — abandoned after 4 days without a human response. New ticket opened (see top of file). Telnyx may merge or cross-reference; not actively monitored.
**Severity:** Blocking — phone unreachable for ~2 days at time of submission, still unreachable as of 2026-05-01 (~6 days)

### Telnyx contacts
- **Support phone:** +1.888.980.9750
- **Support email:** support@telnyx.com
- **Portal:** https://portal.telnyx.com → bottom-right chat (during business hours, US Central)
- **Ticket portal:** https://support.telnyx.com

### Affected number facts (verified via Telnyx API)
- **Phone:** +1-630-937-9478
- **Phone number ID:** 2945732899996960462
- **Status:** active
- **Purchased:** 2026-04-25T08:05:26Z
- **Type:** local, country US
- **Connection:** livekit-outbound (FQDN connection ID 2945038451784812111)
- **Inbound FQDN target:** ai-secretary-nmlkkmgf.sip.livekit.cloud:5060
- **DTMF:** RFC 2833
- **Codecs:** G722, G711U, G711A, G729
- **Routing method:** sequential

### Symptom
- Multiple carriers, multiple test calls over 2+ days
- All return intercept: "this number is not in service"
- **Zero inbound CDRs** in Mission Control Portal — calls never reach Telnyx
- Telnyx-side configuration verified clean — issue is upstream LERG / NPAC

### Original ticket text (submitted)

**Subject:**
```
Active phone number unreachable from PSTN — "not in service" — possible LERG propagation issue
```

**Phone number affected:**
```
+1-630-937-9478
```

**Description:**
```
Hi Telnyx team,

A newly purchased phone number is configured correctly on my end but is unreachable from PSTN. Callers from multiple carriers receive a "this number is not in service" recording. The issue has persisted for ~2 days, well past normal propagation lag, and zero inbound calls appear in CDRs — the calls are not reaching Telnyx at all. I suspect upstream LERG hasn't propagated the carrier-of-record change. Please investigate.

Account-side facts (verified via API):
- Phone number: +1-630-937-9478
- Phone number ID: 2945732899996960462
- Status: active
- Purchased: 2026-04-25T08:05:26Z
- Phone number type: local, country US
- Connection: livekit-outbound (FQDN connection ID 2945038451784812111)
- Inbound FQDN target: ai-secretary-nmlkkmgf.sip.livekit.cloud:5060
- DTMF: RFC 2833
- Codecs: G722, G711U, G711A, G729
- Routing method: sequential

Caller-side observation:
- Multiple carriers, multiple test calls, all return intercept message ("not in service")
- No CDRs visible in the Mission Control Portal for this DID over the past 7 days, inbound or otherwise

Request:
- Verify LERG status / upstream OCN routing for +16309379478
- Confirm Telnyx is listed as the carrier of record in NPAC / NANP-side databases
- If propagation is in progress, an ETA would help
- If something is stuck on Telnyx's side, please push it through

Thanks,
Dale
```

### Reply queued — push past the AI triage bot

The auto-bot asked for a SIP Call-ID at 5:05 PM Central. There is no Call-ID because no calls reach Telnyx — that's the issue. Paste this reply into the ticket so a human reads it instead of the bot closing it as unresolved:

```
Hi Telnyx team,

I cannot provide a SIP Call-ID — that's actually the core issue. Zero
inbound call attempts to +1-630-937-9478 are appearing in CDRs, even
though I've placed multiple test calls from different carriers over the
past several days. The calls return "this number is not in service"
BEFORE they ever reach the Telnyx network. There is no signaling to
inspect on your side because no signaling has arrived.

Approximate test details (caller-side, since I have no Telnyx-side
records):
- CLD: +1-630-937-9478
- CLI: multiple originating numbers (different mobile carriers + Google
  Voice)
- Date range: 2026-04-25 through 2026-04-27, multiple attempts each day
- Timezone: US Central (CDT)
- Outcome on every attempt: intercept message "this number is not in
  service" returned by the originating carrier

Because no signaling reaches Telnyx, no Call-ID exists. Please do not
close the ticket on this basis. Could a Telnyx engineer please verify:

1. NPAC OCN/SPID listing for +16309379478 — is Telnyx the assigned
   carrier of record?
2. LERG status — has the carrier-of-record change been published
   industry-wide?
3. Whether anything on Telnyx's side is blocking upstream propagation
   (held-up port-in completion, billing flag, etc.)?

This is consistent with stuck LERG/NPAC propagation, not an in-network
routing issue. Please escalate to your LERG/porting team if first-tier
cannot see the upstream-side records.

Thanks,
Dale
```

### Follow-up plan
- Tomorrow morning (~9 AM Central): if no human response, send the queued reply
- If still no response by noon Central: call +1.888.980.9750, reference Ticket #2850682
- If LERG investigation drags past Wednesday: consider buying a second number as a diagnostic test (does the second one also fail? = wider Telnyx issue, escalate harder)

### Resolution log

_Append updates here as the ticket progresses._
