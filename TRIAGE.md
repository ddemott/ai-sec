# Supabase Edge Function Triage Report

**Date:** 2026-03-25
**Project:** AI Secretary (SecretaryHQ)
**Project Ref:** `sgibijfchvfuizudrmir`
**Plan:** Free tier
**Organization:** DeMott LLC
**Owner:** daledemott@gmail.com
**Region:** us-west-2

---

## RESOLVED (2026-03-30)

The Supabase "pausing" blocker has been resolved. Edge functions are deployed, reachable, and serving live voice AI calls. The phone number +1 (630) 397-0194 is fully operational for DynaTire. The `book_with_scheduling_atomic` RPC is deployed to production and handling bookings end-to-end.

---

## Historical Context: PROJECT WAS STUCK IN PAUSING STATE

The Supabase project appears to be stuck in a transitional "pausing" state. Both the **Restart project** and **Pause project** buttons on the Settings → General page are **greyed out and unclickable**. The cursor shows a "not allowed" icon when hovering.

The pause tooltip reads: "Project is ALREADY PAUSED" — but the UI does not offer a Resume/Restore option.

---

## Impact

- **Edge functions are completely unreachable** — all HTTP requests to `https://sgibijfchvfuizudrmir.functions.supabase.co/vapi-tools` time out with zero bytes received
- **Voice AI phone system is down** — the edge function handles all tool calls (booking, availability, knowledge base) for our Vapi-powered AI receptionist
- **A live phone number (+1 630-397-0194) is provisioned** but cannot serve callers because the edge function can't process requests
- **Database appears accessible** — Railway backend can connect via the session pooler (`aws-0-us-west-2.pooler.supabase.com`)

---

## Evidence

### 1. Edge function boots successfully but requests never arrive

**Logs tab** (Edge Functions → vapi-tools → Logs) shows:
```
25 Mar 26, 01:17:31 — booted (116ms; 69ms)
25 Mar 26, 01:29:04 — shutdown
```

Boot event metadata:
```json
{
  "boot_time": 69,
  "deployment_id": "sgibijfchvfuizudrmir_6693ba14-ca9d-4a31-ba45-89961ae2b750_15",
  "event_type": "Boot",
  "execution_id": "78e9aad1-6fe4-4d5d-89ff-9a0decbaf8e0",
  "function_id": "6693ba14-ca9d-4a31-ba45-89961ae2b750",
  "level": "log",
  "region": "us-east-2",
  "served_by": "supabase-edge-runtime-1.73.0 (compatible with Deno v2.1.4)",
  "version": "15"
}
```

### 2. Invocations tab is completely empty

No requests have reached the function. The Supabase HTTP gateway is not forwarding requests to the function runtime.

### 3. Requests time out at the gateway level

```bash
$ curl -sv --max-time 10 -X POST "https://sgibijfchvfuizudrmir.functions.supabase.co/vapi-tools" \
    -H "Content-Type: application/json" -d '{}'

* SSL connection using TLSv1.3 / TLS_AES_256_GCM_SHA384
* Operation timed out after 10050 milliseconds with 0 bytes received
```

TLS handshake succeeds, but zero bytes are returned. The gateway accepts the connection but never forwards it to the function.

### 4. Browser requests also hang

Pasting `https://sgibijfchvfuizudrmir.functions.supabase.co/vapi-tools` in a browser results in infinite spinner — confirming this is not a WSL/network issue.

### 5. Project API reports ACTIVE_HEALTHY (contradicts UI)

```bash
$ curl -s -H "Authorization: Bearer $TOKEN" \
    "https://api.supabase.com/v1/projects/sgibijfchvfuizudrmir"

{
  "name": "AI Secretary",
  "status": "ACTIVE_HEALTHY",
  "region": "us-west-2",
  "organization_id": "hpntgvhuhpbjzicpybtr"
}
```

API says `ACTIVE_HEALTHY` but the dashboard shows Restart/Pause greyed out and edge functions unreachable.

---

## Timeline: How This Happened

| Time | Event |
|------|-------|
| Before 2026-03-23 | Edge function working fine (deployed since March 1, version 5) |
| 2026-03-23 ~15:00 UTC | Changed Supabase database password |
| 2026-03-23 ~15:00-16:00 | Edge function `DATABASE_URL` secret still had OLD password |
| 2026-03-23 ~16:00-20:00 | Every Vapi tool call → edge function → DB connection with wrong password → hung for 150 seconds → `WORKER_LIMIT` error |
| 2026-03-23 ~20:00 | Fixed `DATABASE_URL` secret with new password |
| 2026-03-23 ~20:00 | Redeployed edge function — still times out |
| 2026-03-23 ~20:30 | Reset database password in Supabase dashboard |
| 2026-03-23 ~20:30 | Updated all secrets (`DATABASE_URL`, `VAPI_SERVER_URL_SECRET`, `OPENAI_API_KEY`) |
| 2026-03-23 ~21:00 | Redeployed edge function again — still times out |
| 2026-03-25 ~06:15 | Deleted and redeployed edge function fresh — still times out |
| 2026-03-25 ~06:30 | Discovered project appears stuck in "pausing" state |
| 2026-03-25 ~06:35 | Confirmed: Restart and Pause buttons both greyed out |

---

## What We Tried (All Failed)

| # | Action | Result |
|---|--------|--------|
| 1 | Updated `DATABASE_URL` secret to new password | Still times out |
| 2 | Updated `VAPI_SERVER_URL_SECRET` to match | Still times out |
| 3 | Changed edge function to prefer `SUPABASE_DB_URL` (internal networking) | Still times out |
| 4 | Set `DATABASE_URL` to direct connection (`db.xxx.supabase.co`) | Still times out |
| 5 | Set `DATABASE_URL` to transaction pooler (port 6543) | Still times out |
| 6 | Sent request with no auth header (should get instant 401) | Still times out |
| 7 | Sent empty request (should get instant 400) | Still times out |
| 8 | Reset database password in Supabase dashboard | Still times out |
| 9 | Redeployed edge function (version 15) | Still times out |
| 10 | Deleted edge function entirely and redeployed fresh | Still times out |
| 11 | Tested from browser (not just WSL/curl) | Still times out |
| 12 | Attempted project restart via API (`POST /pause`) | 400 error |
| 13 | Attempted to click Restart Project in dashboard | Button greyed out |

---

## Known Supabase Issue

This matches a known pattern reported by multiple users:

- [Project stuck in PAUSING state #44125](https://github.com/supabase/supabase/issues/44125)
- [Project stuck in "Pausing..." state indefinitely #35136](https://github.com/supabase/supabase/issues/35136)
- [Project stuck, cannot pause or delete (Discussion #37844)](https://github.com/orgs/supabase/discussions/37844)

The recommended resolution from Supabase is to **open a support ticket** for manual project state reset.

---

## Support Ticket Log

### 2026-03-26 — Email sent to support@supabase.com

**From:** daledemott@gmail.com
**To:** support@supabase.com
**Subject:** Project stuck in PAUSING state — edge functions unreachable (sgibijfchvfuizudrmir)
**Status:** Awaiting response / ticket number

**Full email text (verbatim):**

> Hi Supabase Support,
>
> My project is stuck in a transitional "pausing" state and edge functions are completely unreachable. This is a known recurring issue affecting multiple users — see the references below.
>
> **Project details:**
> - **Project ref:** sgibijfchvfuizudrmir
> - **Organization:** DeMott LLC
> - **Account email:** daledemott@gmail.com
> - **Region:** us-west-2
> - **Plan:** Free tier
>
> **Problem:**
> - Restart and Pause buttons are greyed out in the dashboard
> - Edge function gateway accepts TLS connections but returns zero bytes (all requests time out)
> - Management API reports `ACTIVE_HEALTHY` but dashboard shows stuck state
> - Database is accessible via session pooler — only edge functions are down
> - This has been stuck since March 23, 2026
>
> **Business impact:** This project is a production-grade SaaS platform (SecretaryHQ — AI receptionist for service businesses) that I'm building to launch my company. The edge functions are the backbone of the voice AI call handling pipeline. A provisioned phone number (+1 630-397-0194) is live but unable to serve callers, and I cannot move forward with beta testing or onboarding customers until this is resolved. Every day this remains stuck delays my business launch.
>
> **This is not a one-off.** Multiple users are hitting the same issue right now:
> - **Issue #44125** (ianmerrill10, March 24) — project `hpssqzqwtsczsxvdfktt` stuck in PAUSING for 3+ hours: https://github.com/supabase/supabase/issues/44125
> - **Issue #42764** (Feb 13) — project stuck in PAUSING indefinitely: https://github.com/supabase/supabase/issues/42764
> - **Issue #35136** — same pattern reported months ago: https://github.com/supabase/supabase/issues/35136
> - **Discussion #37844** — cannot pause or delete: https://github.com/orgs/supabase/discussions/37844
> - As recently as today (March 26), new users are commenting on #44125 with the same problem (gerbenupinion, project `oxexkyjshtbfaujqnzdk`)
>
> **What I need:**
> 1. Reset the project state so Restart/Pause buttons work
> 2. Ensure the edge function gateway forwards requests to my `vapi-tools` function
> 3. If a free tier compute quota was exceeded, please reset it
>
> I've tried redeploying the edge function, resetting the DB password, updating all secrets, and deleting/redeploying the function entirely — nothing helps. Full triage details are in my repo if needed.
>
> If this requires infrastructure team intervention, please escalate and provide me with a ticket number so I can follow up. I'm also open to upgrading to the Pro plan if that would help resolve the stuck state.
>
> Thank you,
> Dale DeMott

**Next steps:**
- [x] Receive ticket confirmation / ticket number from Supabase — **Resolved 2026-03-30**
- [x] If no response within 48 hours (by March 28), follow up via email — **Not needed, issue resolved**
- [x] If ticket number received, post it on GitHub issue #44125 for community escalation (per GaryAustin1's advice) — **Not needed, issue resolved**
- [x] Once resolved, implement prevention plan (see below) — **Edge functions operational, voice AI live**

---

## Request to Supabase Support (Reference Copy)

**Please reset the project state for `sgibijfchvfuizudrmir`.**

Specifically:
1. Clear the stuck pausing/transitional state so Restart and Pause buttons are functional
2. Ensure the edge function gateway forwards HTTP requests to the `vapi-tools` function
3. If there is a free tier compute quota that was exceeded, please reset it

---

## Project Technical Details (for Supabase staff)

- **Edge Function:** `vapi-tools` (function_id: `6693ba14-ca9d-4a31-ba45-89961ae2b750`)
- **Function URL:** `https://sgibijfchvfuizudrmir.functions.supabase.co/vapi-tools`
- **JWT Verification:** Disabled (`--no-verify-jwt` on deploy)
- **Script Size:** 775kB
- **Deployments:** 16 (latest version 16, previously deleted and redeployed)
- **Runtime:** supabase-edge-runtime-1.73.0 (Deno v2.1.4)
- **Function Region:** us-east-2 (project region: us-west-2)
- **Database:** PostgreSQL with pgvector extension, 57 migrations applied
- **DB Connection:** Session-mode pooler at `aws-0-us-west-2.pooler.supabase.com:5432`

---

## Prevention Plan (After Fix)

Once resolved, we will:
1. Set up a **GitHub Actions keep-alive cron** to ping the edge function every 4 hours and prevent auto-pause
2. Add a **connection timeout** (already implemented: 5s timeout with `connectWithTimeout()`)
3. Add **DB retry logic** (already implemented: 2 retries on transient Postgres errors)
4. Ensure `DATABASE_URL` secret is updated **before** changing the DB password
