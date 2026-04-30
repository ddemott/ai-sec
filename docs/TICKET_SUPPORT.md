# Telnyx Support — Active Tickets

## Ticket #2850682 — "Not in service" on +1-630-937-9478

**Submitted:** 2026-04-27, 5:04 PM Central (CDT)
**Status:** Awaiting human response (auto-bot replied 5:05 PM asking for SIP Call-ID — see queued reply below)
**Severity:** Blocking — phone unreachable for ~2 days, blocks all voice AI testing

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
