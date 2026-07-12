# SMS appointment confirmation (Y/N) — design

**Status:** phase 1 BUILT (inbound webhook + signature guard + STOP wiring); phases 2–3
not started. **Date:** 2026-07-11. **Owner:** Dale.

**Phase 1 is inert in prod until `TELNYX_PUBLIC_KEY` is set on Railway** — the route
fails closed (503) without it, so merging this changes nothing until you deliberately
enable it and point the Telnyx number's inbound-message webhook at
`/communications/telnyx/inbound`.

## Why

A booking made by voice carries a phone number we may not be able to trust, and an
intent we've only heard once.

- **Direct call** — caller ID is real (Telnyx hands us the number). A confirmation
  text mostly buys _intent_ plus a written record.
- **Forwarded call** — caller ID is the _forwarding line_, not the caller. The
  agent collects the number **by voice**, which is exactly the number that can be
  wrong: Deepgram mishears digits, callers transpose them, and nothing downstream
  notices. A booking can therefore carry a phone that reaches nobody — silently
  breaking the confirmation, the reminders, and "we'll call if anything changes."
  You find out at the no-show.

So the round-trip does two distinct jobs, and the second is the valuable one:

1. **Proof of intent** — they replied Y.
2. **Proof of reachability** — the text _arrived_, so the number is real and theirs.

Decision (Dale, 2026-07-11): **N cancels the appointment**, we confirm back, and the
owner is notified.

## What already exists (and what doesn't)

Reusable, verified by reading the code:

- `POST /communications/telnyx/status` — an existing **signature-verified Telnyx
  webhook** (`TELNYX_PUBLIC_KEY`, `telnyx-signature-ed25519` + `telnyx-timestamp`,
  Ed25519 over `timestamp|rawBody`, raw-body preserved, bad signature → 403). The
  inbound webhook mirrors this exactly. **This is the security backbone of the feature** —
  NOTE (2026-07-12): as originally written this spec — and the /status route it
  described — specified HMAC-SHA256, which is Stripe's scheme. Telnyx does not offer
  HMAC. Both routes now verify the real Ed25519 signature against the PUBLIC key from
  Mission Control → Keys & Credentials. Setting the old `TELNYX_WEBHOOK_SECRET` would
  have 403'd every genuine webhook. See src/services/telnyxWebhookAuth.ts.
  it is what stops a spoofed "N" from cancelling a stranger's booking.
- `SMSService` (consent-gated; opt-outs revoke consent; re-checks on every send) and
  the lower-level `sendSms`.
- Cancel semantics, already implemented twice (`/agent-tools/cancel-appointment`,
  `/self/cancel`): set `status='canceled'`, `syncAppointmentToAll(..., 'delete')` to
  free the calendar slot, cancel pending reminders.
- Owner notification pattern: `owner_phone ?? forward_phone` as destination,
  `inbound_phone` as sender (from `take-message` / `page-owner`).
- `consent_records` + verbal consent capture on the call (`/agent-tools/record-consent`).

**The gap: there is no inbound-SMS webhook at all.** `/communications/opt-out` is an
_authenticated, tenant-scoped API_ — nothing is wired to receive an actual text.
Two consequences:

- Y/N is not a flag on an existing pipe. **The pipe does not exist.** It is the bulk
  of this work.
- **A customer who replies STOP to any text we send today is not recorded as opted
  out by our system.** (Telnyx may block at the carrier level for 10DLC, but our
  `opt_out_records` never learn about it.) Phase 1 below closes this on its own and
  is worth shipping even if Y/N never is.

## Design

### Data — `appointment_confirmations`

1:1 with an appointment, so per the PK convention (CLAUDE.md, 1:1 extension tables)
it **reuses the parent's PK as its own** rather than inventing a surrogate:

```sql
CREATE TABLE appointment_confirmations (
  appointment_id UUID PRIMARY KEY REFERENCES appointments(appointment_id) ON DELETE CASCADE,
  tenant_id      UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  customer_phone TEXT NOT NULL,              -- normalized (shared/phone.ts)
  status         TEXT NOT NULL,              -- 'pending' | 'confirmed' | 'declined' | 'expired'
  sent_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at   TIMESTAMPTZ,
  response_body  TEXT,                       -- what they actually texted, for audit
  CONSTRAINT appointment_confirmations_status_chk
    CHECK (status IN ('pending','confirmed','declined','expired'))
);
CREATE INDEX idx_appt_conf_pending ON appointment_confirmations (tenant_id, customer_phone)
  WHERE status = 'pending';
```

RLS on, `FORCE ROW LEVEL SECURITY`, same as every other tenant table. Regenerate
`supabase/baseline.sql` (`npm run db:baseline`) or CI's schema-alignment guard fails.

### Outbound — send on booking

Fires after a successful booking (both `book_appointment` and
`book_with_scheduling`), **fire-and-forget**, never failing the booking:

> Confirming your Haircut Tue Jul 15, 3:30 PM with Tess. Reply Y to confirm, N to cancel. Reply STOP to opt out.

- **Consent-gated** — send through `SMSService`, which refuses an opted-out or
  never-consented number. The agent should capture verbal consent (`record-consent`)
  during the call; without it, no text (and that is correct behavior, not a bug).
- Writes the `pending` row. Time rendered in the **tenant's** IANA zone (the
  `send-self-service-link` route already does this — a server-zone render is a day
  off for some tenants).

### Inbound — `POST /communications/telnyx/inbound`

Public route (add to `PUBLIC_ROUTES`), **signature-verified exactly like
`/communications/telnyx/status`**. Unsigned/bad-signature → 403, before reading the
payload.

1. **Resolve tenant** from `data.payload.to[0].phone_number` → `tenants.inbound_phone`.
   No match → 200 + ignore (never 500 at a provider; it retries).
2. **Normalize the reply**: trim, uppercase, strip punctuation. `Y`/`YES`/`YEAH`/`CONFIRM` → yes.
   `N`/`NO`/`CANCEL` → no. `STOP`/`UNSUBSCRIBE`/`END`/`QUIT` → opt-out.
3. **STOP** → `consentService.processOptOutCommand(...)` (already written). Closes the
   compliance gap. **Handled before anything else** — an opt-out must never be read as
   a booking reply.
4. **Match** the most recent `pending` confirmation for `(tenant_id, from_phone)`.
5. Apply the outcome (below), reply once, record `responded_at` + `response_body`.

### Outcomes

| Reply          | Effect                                                                                                                                                                                                                                             |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Y**          | `status='confirmed'`. Reply: "You're confirmed — see you then."                                                                                                                                                                                    |
| **N**          | Cancel: `appointments.status='canceled'`, `syncAppointmentToAll(...,'delete')` (frees the slot), cancel pending reminders, `status='declined'`. Reply: "Cancelled. Reply BOOK if that was a mistake and we'll get you back in." **SMS the owner.** |
| **STOP**       | Opt out; no booking change.                                                                                                                                                                                                                        |
| anything else  | Reply once with the Y/N nudge; do not guess. Never infer a cancel.                                                                                                                                                                                 |
| no pending row | Ignore (or nudge once). Never act.                                                                                                                                                                                                                 |

### The safety rules that matter

These are the ones I'd hold the line on:

- **Never auto-cancel when ambiguous.** If a phone has **more than one** pending
  confirmation, "N" does not identify _which_ booking. In that case: do **not**
  cancel — page the owner and reply "We'll call you to sort that out." A destructive
  action on an ambiguous input is how you cancel the wrong meeting.
- **Never cancel a past or already-canceled appointment.** Reuse the existing guard
  (`status='scheduled' AND start_time > NOW()`).
- **Expire pending rows** (cron/reaper, or lazily at match time) at appointment start.
  A stray "N" three days later must not cancel next month's booking.
- **Signature verification is load-bearing.** Without it, anyone who can POST to the
  endpoint can cancel any booking by spoofing a `from` number. `TELNYX_PUBLIC_KEY`
  must be set in prod before this route is enabled — treat an unset key as
  _reject all_, matching the `AGENT_SECRET` precedent (never "unlocked by default").
- **Idempotency.** Telnyx retries. Keying on the pending row's status (only `pending`
  transitions) makes a redelivered "N" a no-op rather than a double-cancel.

### Deliberately NOT in scope

- **"Reply BOOK" does not rebook.** Automated SMS rebooking (offer slots, hold one,
  confirm) is a whole feature. Phase 3 makes BOOK **page the owner** and tell the
  customer someone will call. Anything more is a separate spec — I'd rather say this
  plainly than imply the word "BOOK" does something it doesn't.
- Reminder-time re-confirmation ("still coming?" 24h before). Natural follow-on;
  the same table and webhook support it.

## Phases

Each ships independently and is separately valuable.

1. **Inbound webhook + STOP wiring.** The signature-verified route, tenant
   resolution, keyword parsing, STOP → existing opt-out service. **No booking
   behavior changes.** Closes a live compliance gap and is worth shipping alone.
2. **Confirmation send + Y path.** Migration, send-on-booking (consent-gated,
   fire-and-forget), Y → confirmed, confirm-back reply.
3. **N path.** Cancel + calendar sync + reminder cancellation + owner SMS +
   confirm-back. The ambiguity/expiry/idempotency guards above land here, with the
   cancel itself.

Dashboard: surface confirmation status on the appointment (a "Confirmed ✓ /
Awaiting reply / Declined" badge). Small, do it with phase 2.

## Verification

Vitest can't prove a webhook signature check or a real cancel; both need the real DB
and a real signed payload:

- **Real-DB integration** (`tests/integration/`): a signed inbound payload cancels the
  right appointment; an **unsigned/bad-signature** payload changes nothing (the
  security assertion — this is the one that matters); STOP records an opt-out; a
  redelivered N is a no-op; N with two pending confirmations does **not** cancel and
  pages instead; N on a past appointment does nothing.
- **Metrics**: `sms_confirmations_sent_total`, `sms_confirmation_replies_total{reply}`,
  `appointments_canceled_by_sms_total`, and `errors_total{event}` on every sad path
  (per the sad-path-instrumentation rule — this is a fire-and-forget surface, and an
  unlogged failure here is invisible).

## Rough effort

Phase 1 ~half a day; phase 2 ~half a day (migration + send + Y); phase 3 ~a day
(cancel path + the guards + real-DB tests). Prod needs `TELNYX_PUBLIC_KEY` set (copy it
from Mission Control → Keys & Credentials → Public Key) and the Telnyx number's
inbound-message webhook pointed at the new route.
