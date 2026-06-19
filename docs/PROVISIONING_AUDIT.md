# Provisioning Audit — Inbound Call Failure Root Cause

**Date:** 2026-06-04
**Trigger:** Number `+1 630-866-1960` receives no inbound calls. Telnyx SIP Call
Flow Tool shows **4 inbound CDRs (Jun 3)**, all `+1-608-217-5303 → +1-630-866-1960`,
**0s duration**; "Call Data Debugging" returns Telnyx internal **error 10007**.
Telnyx support SLA quoted at **2 days**; prior ticket (#2850682) abandoned after 4.

## TL;DR

The inbound failure is **connection-level config, not a bug in the happy path** of
the provisioning code. But the code has real defects that (a) make every customer
inherit the same dead connection and (b) report dead numbers as healthy. Switching
carriers fixes nothing unless the inbound trunk is configured correctly AND the code
verifies inbound actually works before marking a tenant `active`.

## How provisioning works today

`src/services/provisioningService.ts` → `activatePhone()`:

1. `searchAvailable(areaCode)` — find a number
2. `orderNumber(phone_number)` — `POST /number_orders`
3. `assignToConnection(ordered.id, TELNYX_SIP_CONNECTION_ID)` — `PATCH /phone_numbers/{id}` `{connection_id}`
4. `UPDATE tenants SET phone_status='active'`

`TELNYX_SIP_CONNECTION_ID` is a **single shared env var** — every tenant's number is
stapled to the same connection.

## Root cause: one shared connection, never configured by code

- No code anywhere configures the connection / FQDN / inbound routing. (Grep for
  `fqdn|/connections|inbound` setup across `src` = zero hits.) The connection is
  assumed pre-built and correct.
- That connection is named **`livekit-outbound`** — outbound-oriented. If its
  **inbound** leg isn't pointed at the LiveKit FQDN (correct host **+ port 5060**,
  inbound enabled), inbound INVITEs arrive with no delivery target → Telnyx logs a
  CDR (inbound, 0s) and fails delivery → generic error.
- Because all numbers share this one connection, **every provisioned number fails
  inbound identically.** This is the systemic "every customer will have it" cause.

## Code defects (fix regardless of carrier)

### 1. `active` status is unverified — dead numbers report healthy

`provisioningService.ts:135` flips the tenant to `active` solely because
`assignToConnection` didn't throw. It never confirms the number can receive a call.
A silently-dead line looks healthy in the DB. **Fix:** verify after assign (re-GET
the number, confirm `connection_id` stuck; ideally a real inbound smoke test) before
setting `active`.

### 2. Phone-number ID provenance is unverified ⚠️ VERIFY

`telnyxNumbers.ts:95` returns `number_orders.data.phone_numbers[].id` and
`provisioningService.ts:133,141` uses it as the `/phone_numbers/{id}` **resource id**
for assign, stores it as `telnyx_phone_number_id`, and later DELETEs it on release.
In Telnyx v2 the order-line id is **not guaranteed** to equal the phone_numbers
resource id. If they differ: the assign PATCH targets the wrong/nonexistent resource
(connection silently not set) and release DELETEs nothing (orphaned numbers, billing
leak). **Fix:** after ordering, `GET /phone_numbers?filter[phone_number]=+1...` to get
the real resource id; use that everywhere.

### 3. No order-completion wait

`telnyxNumbers.ts:81` assumes `POST /number_orders` returns `success` synchronously
and never checks `phone_numbers[].status`. If the order is `pending`,
`assignToConnection` races ahead of activation and the assignment may not stick.
**Fix:** check order status; poll `GET /number_orders/{id}` until `success` (bounded)
before assigning.

## Decision implications

- The routing approach (assign `connection_id`) is correct — not fundamentally broken.
- Death = shared connection's inbound config (external) + code trusting it blindly.
- **Telnyx 2-day support SLA is disqualifying** for a revenue-facing product when a
  carrier outage takes a customer dark. Independent of the bug, this argues for
  moving production telephony to a carrier with same-day support (Twilio is the
  default target; architecture carrier→LiveKit is unchanged).
- Whichever carrier: the trunk must be **inbound-configured** (port 5060, FQDN =
  LiveKit, inbound enabled) AND provisioning must **verify** before `active`.

## Decisive test (do before/independent of any switch)

Provision a **fresh number through the automated flow** and dial it untouched:

- Works → flow is fine, `+16308661960` was a one-off dud; ship.
- Dies 0s/10007 → confirmed systemic (shared connection or Telnyx inbound defect).

## Fix backlog

- [ ] **Inspect/rebuild the SIP connection's inbound config** (port 5060, LiveKit FQDN, inbound enabled) — the actual inbound-death root cause; external config, still open
- [x] **Code:** verify `connection_id` stuck before marking `active` — done 2026-06-04 (`provisioningService.ts`, post-assign `getPhoneNumber` check + rollback; test `VERIFY FAILS`)
- [x] **Code:** resolve real phone_numbers resource id via `GET /phone_numbers?filter[phone_number]=` — done 2026-06-04 (`findPhoneNumberIdByNumber` + `resolvePhoneNumberId` with bounded retry)
- [ ] **Code:** poll `GET /number_orders/{id}` for `success` before assign — partial: resolver retries on number-listing, but order _status_ is not yet explicitly polled
- [ ] **Inbound smoke test** in verification (a real test call), not just connection_id binding — stronger guarantee than the current check
- [ ] Evaluate Twilio as production carrier (support SLA); design carrier failover so no single carrier is a death switch

## UPDATE 2026-06-04 (afternoon) — live API audit reversed the root cause

A full end-to-end audit using the live Telnyx + LiveKit APIs found **no config fault
anywhere.** The inbound failure is **PSTN-layer (number reachability), not connection
or trunk config** — and it is **carrier-agnostic** (switching to Twilio would not fix
recycled-DID or propagation issues).

**Verified clean (live API):**

- Telnyx number `+16308229086` (new, bought today): `active`, on connection
  `2945038451784812111`, `inbound_call_screening=disabled`, no forwarding/translation.
- Connection `2945038451784812111`: `active`, inbound `default_primary_fqdn_id` →
  LiveKit FQDN `ai-secretary-nmlkkmgf.sip.livekit.cloud:5060`. Transport **UDP**.
- LiveKit inbound trunk `ST_aUM3GuCuc9wL`: `numbers ["+16308661960","+16308229086"]`
  (normalized to +E.164 from bare digits today), `allowedAddresses ["0.0.0.0/0"]`.
- Dispatch rule `SDR_WEL49AwBB4NW` → agent `ai-secretary-agent`. **LiveKit creds work**
  (the repo's "dead local LiveKit creds" note is stale — they authenticate fine).

**What was actually wrong:**

1. `+16308661960` = recycled DID, stuck "disconnected" in carrier tables → "not in service".
2. New `+16308229086` also "not in service" **from Dale's phone only** → his carrier hasn't
   synced the numbers (propagation), NOT a config fault. Other carriers reached Telnyx
   (4 inbound CDRs from `+1-608-217-5303` on the old number).

**Implication for the connection-inbound-config theory (above):** that theory is now
**weakened** — the connection's inbound FQDN routing is correctly set and was never the
proven cause. The "shared connection misconfigured → every customer dies" risk is NOT
demonstrated. The provisioning **code** fixes below still stand on their own merit
(don't mark a number active until verified), but the inbound death was a PSTN/number
issue, not the connection.

**Still unproven:** whether a call reaching Telnyx lands in LiveKit. Decisive test:
call `+16308229086` from a different carrier while watching LiveKit `listRooms()`.
If that fails, the next (and only remaining) config suspect is **UDP transport** to
LiveKit Cloud (may need TCP/TLS).

**Re: "switch to Twilio."** The support-SLA concern (2-day turnaround) may still justify
evaluating Twilio for a revenue product, but the _technical_ case collapsed: the infra
was correctly configured; the failures were carrier-side number problems Twilio shares.

## Changelog

- **2026-06-04** — Added ID resolution + post-assign verification to provisioning.
  A number whose `connection_id` does not bind now fails provisioning and is
  released, instead of being marked `active` (silent-dead-line fix). Files:
  `src/services/telnyxNumbers.ts` (+`findPhoneNumberIdByNumber`, +`getPhoneNumber`, +`PhoneNumberDetail`), `src/services/provisioningService.ts` (resolve+verify in
  `activatePhone`, +`resolvePhoneNumberId`). Tests: +`VERIFY FAILS` case; 7 pass,
  `tsc --noEmit` clean. **Does NOT fix inbound** — that's the connection config
  (still open). It stops dead numbers from reporting healthy.
