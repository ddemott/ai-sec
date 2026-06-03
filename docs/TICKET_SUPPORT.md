# Telnyx Support — Active Ticket

**Number**: `+1 630-866-1960` (active, Thinking Hammer LLC). Telnyx id `2973794140900296302`.

**Status (2026-06-03) — OPEN, number unreachable.** Inbound calls hit a recorded
"no longer in service" carrier intercept; the call never reaches Telnyx. Telnyx config
fully re-verified clean via API (number active + voice-configured, connection + FQDN +
LiveKit trunk all correct). Likely root cause: recycled-DID sticky disconnect record
cached in carrier LERG/routing tables.

> **Full diagnosis + action plan live in `docs/BETH_GO_LIVE_TODO.md` → Step 5
> (2026-06-03 ~12:40 UTC entry).** That is the source of truth — do not duplicate it here.

**History**: The earlier `+1-630-937-9478` was a dead trial-account order (1-order cap +
negative balance, deleted). Ticket `#2850682` / its LERG escalation is moot — that was a
different number. The current intercept on `+16308661960` is a fresh issue.

### Recommended Next Actions (see BETH_GO_LIVE_TODO Step 5 for detail)
- Open a Telnyx ticket for `+16308661960` (recorded "no longer in service" intercept,
  no inbound CDRs, request upstream routing/activation refresh). **Log the ticket # here.**
- Retest from a different carrier; wait up to 24–72h from purchase (bought 2026-06-03T01:18Z).
- If still dead, provision a different fresh DID as the fastest fallback.
- Update this file with any new ticket number or Telnyx response.

**Last updated**: 2026-06-03 (ticket #: _none filed yet_)