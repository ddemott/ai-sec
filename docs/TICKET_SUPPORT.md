# Telnyx Support — Active Ticket

**Number**: `+1 630-866-1960` (active, Thinking Hammer LLC). Telnyx id `2973794140900296302`.

**Status (2026-06-03) — OPEN, inbound unreachable. Leg localized via instrumented dial: NOT LiveKit; Telnyx-domain.**
A measured dial proved the SIP INVITE never reaches our LiveKit SIP server (LiveKit
`listRooms()` stayed at 0 across the dial; no `call-*` room created). Caller hears a carrier
intercept: "The number you dialed is not in service… Message EL402IL53." This matches Telnyx
support's "the FQDN connection lacks inbound call handling." Earlier "recycled-DID propagation"
theory is superseded; LiveKit `+`/format theory is ruled out (no INVITE arrives to reject).

> **Full evidence in `docs/BETH_GO_LIVE_TODO.md` → Step 5 (2026-06-03 ~16:00 UTC entry).**

**Added evidence (2026-06-03):** Telnyx's own Elastic SIP Trunking dashboard shows
**0 inbound calls / 0 minutes** for this number — inbound never reaches the trunk at
all (not a SIP-negotiation failure on our connection). API confirms only 2 connections
exist (`livekit-outbound` FQDN `2945038451784812111` — the number's connection — + an
unused "Forward Only" credential conn `2944916791014459118`), number `connection_id`
correctly = `2945038451784812111`, status active. So the number's inbound routing onto
the trunk, or its PSTN reachability, isn't active on Telnyx's side. Append to the reply:
*"Your Elastic SIP Trunking dashboard shows 0 inbound calls/minutes for +16308661960 —
inbound isn't reaching our trunk. Please confirm inbound calls are delivered to connection
2945038451784812111 and that the number is fully activated for inbound on your network."*

**Reply to send Telnyx (data-backed; keeps us on Option 1, refuses Call Control/TeXML):**
> We use **FQDN SIP trunking (your Option 1)** to an external SIP server (LiveKit Cloud) — a
> Call Control/TeXML app (options 2/3) would break our architecture, so we won't use those.
> The number `+16308661960` is on FQDN connection `2945038451784812111`, whose **inbound
> `default_primary_fqdn_id` = `2945040817925916333`**, which is our FQDN
> `ai-secretary-nmlkkmgf.sip.livekit.cloud:5060`. On an inbound call, **nothing arrives at our
> SIP server** and the caller gets a "not in service" intercept (carrier code EL402IL53).
> Question: on an inbound call to this number, are you (a) finding **no inbound route**, or
> (b) routing to our FQDN and getting a **SIP failure** back — and **what SIP cause code** do
> you see? The inbound FQDN pointer is set, so we need to know why inbound isn't being
> delivered to it.

### Also have Dale check in Mission Control
- The number's **inbound routing** (number → connection inbound, not just outbound assignment).
- Voice → the FQDN connection's **SIP call-flow / debugging** tool for the failed inbound attempt.
- Fallback if Telnyx stalls: provision a different fresh DID (`POST /provisioning/activate`).

**Last updated**: 2026-06-03 (ticket #: _none filed yet_ — send the reply above)