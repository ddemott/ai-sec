# Telnyx Support — Active Ticket

**Number**: `+1 630-866-1960` (active, Thinking Hammer LLC). Telnyx id `2973794140900296302`.
**Status (2026-06-02)**: The original `+1-630-937-9478` was a dead order (deleted, never kept) — root cause was a trial account that could only place 1 order plus a negative balance, not a LERG/carrier issue. Resolved by funding + upgrading the account, then purchasing **`+1 630-866-1960`** and routing it to SIP connection `livekit-outbound`. Ticket `#2850682` / LERG escalation is moot.
**Remaining to reach live**: LiveKit inbound trunk still points at the old number; needs fresh LiveKit creds + trunk update + tenant phone fields. See `docs/BETH_GO_LIVE_TODO.md`.

**Blocking**: Live voice validation, until the LiveKit trunk is repointed.

### Latest Escalation Email

See the full professional follow-up draft (with troubleshooting suggestions) in the project chat history (sent to support@telnyx.com).

### Recommended Next Actions
- Wait for LERG team response.
- If no movement in 48h, provision a second DID as a diagnostic.
- Update this file with any new ticket number or response.

**Last updated**: 2026-05-15