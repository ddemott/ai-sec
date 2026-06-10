# Telnyx ↔ LiveKit Inbound Call Debugging — Handover

**Date:** June 9, 2026
**Session goal:** Diagnose why inbound calls to Telnyx DIDs were not reaching the LiveKit agent.
**Outcome:** SIP transport layer fully fixed and verified. Agent layer reaches a guarded fallback; one architectural decision remains before real calls produce live agent audio.

---

## TL;DR

Inbound calls to `+1-630-866-1960` and `+1-630-822-9086` were returning **"this number is not in service"** from the caller's carrier. Root cause was a **stale FQDN in the Telnyx SIP Connection** pointing to a LiveKit project subdomain that no longer existed. After updating the FQDN, the full SIP chain works end to end — Telnyx delivers the INVITE, LiveKit returns 200 OK, the agent worker is dispatched and joins the room.

The agent then **intentionally falls back** to "I'm sorry, we're having a system issue" because `sessionContext.ts` cannot resolve a `tenant_id`. Resolving this requires a small architectural decision (see *Open Decision* below).

---

## Current Status by Layer

| Layer | Status | Evidence |
| --- | --- | --- |
| Caller carrier → Telnyx PSTN ingress | ✅ Working | "Not in service" intercept is gone. CDRs now record inbound calls. |
| Telnyx SIP Connection → LiveKit SIP ingress | ✅ Working | SIP ladder on Jun 9 10:35:51 AM CT: INVITE → 100 → 180 → 200 → ACK → BYE. Q.850 cause 16 (normal clearing). |
| LiveKit Inbound Trunk match (DID → trunk) | ✅ Working | Trunk `ST_aUM3GuCuc9wL` accepted the call (no more 404). |
| LiveKit Dispatch Rule → agent worker | ✅ Working | Worker registered, dispatch fired, agent joined the room. |
| Agent entrypoint → tenant resolution | ⚠️ Falls back to "system issue" | `buildSessionContext` returns null because no `tenant_id` is in dispatch/room metadata. |
| Agent → live conversation | ⛔ Blocked on the above | TTS message plays ("system issue"), then the agent exits cleanly. |

---

## Architecture as Confirmed

```
[Caller phone]
       │
       ▼  PSTN
[Telnyx] ── SIP Connection: livekit-outbound (FQDN-routed)
       │   Inbound DIDs:
       │     +1-630-866-1960
       │     +1-630-822-9086
       │   Primary FQDN → 3jay24s076x.sip.livekit.cloud:5060
       ▼
[LiveKit Cloud — project AI-Secretary]
       │   SIP URI: sip:3jay24s076x.sip.livekit.cloud
       │   Inbound Trunk: ST_aUM3GuCuc9wL ("telnyx-inbound")
       │     numbers: ["+16308661960", "+16308229086"]
       │   Dispatch Rule: SDR_WEL49AwBB4NW ("thinkinghammer-dispatch")
       │     inbound routing: ST_aUM3GuCuc9wL
       │     destination room: call-<caller-number>
       │     agents: ai-secretary-agent
       │     rule type: Individual
       ▼
[Cloud-deployed agent: ai-secretary-agent  (A_LnyF3gJPXxUD)]
       │   1 worker registered. Joins room. Currently exits via fallback.
       ▼
[Caller hears the fallback message and call ends]
```

---

## Root Cause That Was Fixed

### The bug

Telnyx SIP Connection "livekit-outbound" had two FQDN-related fields both pointing at `ai-secretary-nmlkkmgf.sip.livekit.cloud:5060`:

1. **FQDNs table** (Authentication and routing tab)
2. **Primary FQDN** dropdown (Inbound calls routing section)

The `ai-secretary-nmlkkmgf` subdomain belonged to a previous/replaced LiveKit project. The current LiveKit project (`AI-Secretary`) uses a different subdomain: `3jay24s076x.sip.livekit.cloud`.

### How the symptom manifested

The Telnyx-side support agent's investigation showed Telnyx was successfully delivering the INVITE, but the destination was returning `404 No trunk found`. The 404 was correct from LiveKit's perspective — the request was hitting a nonexistent subdomain. The calling carrier translated the downstream failure into the "not in service" intercept upstream.

### The fix

Telnyx Mission Control Portal → Voice Suite → SIP Trunking → SIP Connections → `livekit-outbound` → Authentication and routing tab:

1. Added new FQDN: `3jay24s076x.sip.livekit.cloud`, port `5060`, A record
2. Switched **Primary FQDN** dropdown to the new FQDN
3. Removed the old `ai-secretary-nmlkkmgf.sip.livekit.cloud` row
4. Saved

After the change, the same test call produced the clean SIP ladder referenced above.

### Incidental Telnyx-side fix

The form save was blocked by an unrelated validation error on **Outbound calls authentication → Username**: `daledemott@gmail.com` contained `@` and `.`, which Telnyx now rejects (alphanumeric only). Username was changed to `daledemott`. **If any service was using the old SIP auth credentials, update it.** Outbound voice from LiveKit through Telnyx is not currently configured (0 outbound trunks in LiveKit), so this change is unlikely to have broken anything in production, but worth flagging.

---

## Remaining Block — Agent Fallback

### What happens now on a real call

1. Caller dials `+1-630-866-1960`
2. Telnyx delivers INVITE to `sip:16308661960@3jay24s076x.sip.livekit.cloud`
3. LiveKit Inbound Trunk matches the DID, returns 200 OK
4. Dispatch rule fires, room `call-<caller-number>` created, `ai-secretary-agent` dispatched
5. Agent worker joins the room
6. Agent's `entry` function calls `buildSessionContext({ jobMetadata, roomMetadata, participantAttributes })`
7. `parseRoomMetadata` fails on both `jobMetadata` and `roomMetadata` — neither contains `{"tenant_id": "<uuid>"}`
8. `buildSessionContext` returns `null`
9. Agent hits **line 73** of `agent/src/index.ts`, logs `dispatch_metadata_invalid`, captures to Sentry
10. Agent says: **"I'm sorry, we're having a system issue. Please try calling back in a moment."**
11. Agent exits cleanly. Caller hangs up.

### Why the dispatch rule isn't supplying metadata

Looking at `SDR_WEL49AwBB4NW` ("thinkinghammer-dispatch") in the LiveKit dashboard, the visible columns are: Dispatch Rule ID, Rule Name, Inbound Routing, Destination Room, Agents, Rule Type. No metadata is being set on the agent job at dispatch time, so `ctx.job.metadata` is empty when the worker picks up the dispatch.

### Why the agent code can't fall back to a different tenant resolution

`agent/src/sessionContext.ts` resolves `tenantId` **exclusively** from JSON metadata. There is no path that looks up tenant by the called DID, the caller phone, or anything else. Quote from the code:

```ts
const meta = parseRoomMetadata(args.jobMetadata) ?? parseRoomMetadata(args.roomMetadata);
if (!meta) return null;
```

If `meta` is null, the function returns null and the entry function takes the fallback branch.

---

## Open Decision: How to Resolve Tenant

### Option A — Hardcode `tenant_id` in dispatch metadata (single-tenant patch)

In LiveKit Cloud → Telephony → Dispatch rules → edit `thinkinghammer-dispatch` → set **Dispatch metadata** to:

```json
{"tenant_id": "<UUID-of-tenant-that-owns-866-1960>"}
```

**Pros:** Zero code changes. Verifies the rest of the agent chain works (greeting, tools, prompt). Minutes to apply.

**Cons:** Every call to every DID on this dispatch rule resolves to the same tenant. Doesn't scale past one tenant. The other DID (`+1-630-822-9086`) would also be misrouted to this tenant.

**When this is the right call:** You want to verify the agent's tenant-config fetch, tool builder, and greeting work end to end before touching the architecture. Treat as a smoke test, then move to Option B.

### Option B — Phone-based tenant lookup (multi-tenant fix)

Modify `agent/src/sessionContext.ts` to attempt a DID-based lookup when metadata is absent. Sketch:

```ts
// agent/src/sessionContext.ts (after the current metadata path)

const calledDid = args.participantAttributes?.['sip.to']
              ?? args.participantAttributes?.['sip.toUser']
              ?? null;

if (calledDid) {
  const tenantId = await lookupTenantByDid(calledDid);  // new function, hits backend
  if (tenantId) {
    const caller = extractCallerInfo(args.participantAttributes);
    return { tenantId, callerPhone: caller.callerPhone, callId: caller.callId };
  }
}
```

This requires:

- Making `buildSessionContext` async (it isn't currently)
- A backend endpoint or DB query that maps DID → tenant_id (already implicit in the onboarding wizard since each tenant has a phone_number column)
- Re-running the agent build/deploy on LiveKit Cloud

**Pros:** Matches the auto-provisioning architecture already designed for SecretaryHQ — a wizard provisions a number, stores it on the tenant row, and the agent finds the right tenant at call time without per-tenant dispatch rules.

**Cons:** Real code change. Needs unit-test coverage. Adds one extra DB round-trip per call (mitigatable with a small cache).

**When this is the right call:** Before scaling past the first tenant. Necessary for the onboarding wizard's "create tenant → number works in 60 seconds" flow.

### Recommended path

1. **Today (5 min):** Apply Option A with the tenant UUID for the row that owns `+1-630-866-1960`. Place a real test call and confirm the greeting plays.
2. **Before adding a second tenant:** Implement Option B and remove the hardcoded metadata.

---

## Key Configuration Values (Reference)

### Telnyx

| Field | Value |
| --- | --- |
| SIP Connection name | `livekit-outbound` |
| Connection type | FQDN |
| Primary FQDN | `3jay24s076x.sip.livekit.cloud:5060` |
| DNS Record Type | A |
| SIP transport protocol | UDP |
| Destination number format (inbound) | E.164 |
| Origination number format | E.164 / National (10 digits) |
| Outbound auth Username | `daledemott` (was `daledemott@gmail.com`) |
| Codecs (in order) | G722, G711U, G711A, G729 |
| Assigned DIDs | `+1-630-866-1960`, `+1-630-822-9086` |
| Outbound voice profile | `default-outbound` (Profile ID `2945738775713548128`) |

### LiveKit Cloud — project AI-Secretary

| Field | Value |
| --- | --- |
| Project SIP URI | `sip:3jay24s076x.sip.livekit.cloud` |
| Inbound trunk ID | `ST_aUM3GuCuc9wL` |
| Inbound trunk name | `telnyx-inbound` |
| Inbound trunk numbers | `+16308661960`, `+16308229086` |
| Allowed addresses | `0.0.0.0/0` (open for now; tighten later) |
| Dispatch rule ID | `SDR_WEL49AwBB4NW` |
| Dispatch rule name | `thinkinghammer-dispatch` |
| Dispatch destination room | `call-<caller-number>` |
| Dispatch agent | `ai-secretary-agent` |
| Dispatch metadata | **(currently empty — see Open Decision)** |
| Agent deployment ID | `A_LnyF3gJPXxUD` |
| Workers registered | 1 |
| Agent name (worker registration) | `ai-secretary-agent` |

### Test reference call

| Field | Value |
| --- | --- |
| Date / time | June 9, 2026, 10:35:51 AM CT |
| Caller (from) | `+1-608-217-5303` |
| Called (to) | `+1-630-866-1960` |
| Q.850 cause code | 16 (normal call clearing) |
| Actual duration | 19s |
| SIP ladder | INVITE → 100 → 180 → 180 → 200 → ACK → BYE → 200 (all OK) |
| Outcome | Connected; agent joined room; agent spoke fallback message; caller hung up |

---

## How to Verify Current State

### Verify SIP layer (should pass cleanly)

1. Telnyx → Debugging → SIP Call Flow Tool
2. Direction: Inbound, Destination #: `+1-630-866-1960`, time window covering a recent test call
3. Open the resulting CDR → "Call Data Debugging"
4. Expect a ladder ending in `200 OK` and `BYE`, Q.850 cause `16`

### Verify the agent is reachable

1. LiveKit Cloud → Agents → click the terminal icon (`>_`) next to `ai-secretary-agent`
2. The Console opens. Status: Connected.
3. Send any test message or speak. The agent currently responds with the fallback message — that confirms the worker is up and the room/audio path works.

### Verify the bug

1. Call `+1-630-866-1960` from a real phone
2. Expect the call to connect (no "not in service")
3. After ~2 seconds of silence, hear: "I'm sorry, we're having a system issue. Please try calling back in a moment."
4. Call ends cleanly (Q.850 16)

---

## Loose Ends Worth Tracking

1. **Outbound SIP from LiveKit is not configured.** LiveKit SIP trunks page shows 0 outbound trunks. Any feature where the agent calls a number (callback, owner-notification voice, follow-up) is currently impossible. Inbound and outbound are separate and need separate setup.

2. **Telnyx outbound auth username was changed.** Old: `daledemott@gmail.com`. New: `daledemott`. If any external service was authenticating outbound calls through Telnyx with the old creds, it will now fail. (Unlikely to matter right now — see point 1.)

3. **Dispatch rule destination room is `call-<caller-number>`.** That's the *caller's* number, not the *called* DID. Fine for now since tenant resolution moves to participant attributes (Option B above), but worth noting if any downstream tooling parses the room name for the dialed number.

4. **The trunk numbers field is in E.164 with the `+` prefix** (`+16308661960`), while Telnyx sends the To-header user as `16308661960` (no plus). LiveKit handled the match correctly anyway — confirmed by the working test call — but worth knowing if format-matching becomes a question later.

5. **The Telnyx ticket should be closed.** The issue is no longer on their side. They diagnosed the 404 correctly and pointed at LiveKit; the FQDN fix on our side resolved it.

6. **Sandbox deprecation notice in LiveKit dashboard:** "Sandbox is being deprecated and is targeted for removal on June 16." Not relevant to this debugging session but worth knowing if any tooling currently relies on Sandboxes — they need to migrate to Console.

---

## Files Touched (none in repo)

No source code changes were made during this session. All changes were configuration-only in the Telnyx and LiveKit dashboards. The remaining work (Option B) would touch:

- `agent/src/sessionContext.ts` — add async DID lookup branch
- `agent/src/index.ts` — possibly adjust the call to `buildSessionContext` if it becomes async
- A new function or call into `ToolsClient` for DID → tenant lookup (the backend endpoint may already exist for the wizard; verify)
- Tests covering the new lookup path

---

## Quick-Resume Checklist

When picking this back up:

- [ ] Decide Option A vs Option B (or A first, then B)
- [ ] If A: get the tenant UUID owning `+1-630-866-1960` from the tenants table, set Dispatch metadata in the LiveKit dispatch rule, place a test call, confirm the greeting plays
- [ ] If B: implement the phone-based lookup in `sessionContext.ts`, rebuild and redeploy the cloud agent, test
- [ ] Once a successful real call lands the greeting, move on to: outbound trunk setup (LiveKit → Telnyx → PSTN) for callback/notification flows
- [ ] Then: revisit the wizard's automated phone provisioning (Telnyx number purchase + SIP routing + LiveKit trunk-number-add) so onboarding new tenants doesn't repeat any of this manual work
