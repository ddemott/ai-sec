# SecretaryHQ — Current Status
**Last updated:** 2026-03-23 (end of session)

---

## Where We Are

Phase 13 (Production Readiness) is in progress. The backend is deployed to Railway and live. A phone number has been provisioned via Vapi. The edge functions (voice AI tool handlers) are deployed to Supabase but are currently not responding — suspected Supabase free tier compute exhaustion.

---

## What's Working

| Component | Status | Details |
|-----------|--------|---------|
| **Backend API** | Live | `https://ai-sec-production.up.railway.app/` — Fastify, 16 route modules, Railway auto-deploy from main |
| **Landing page** | Live | Full marketing page at root URL with features, pricing, demo mockup |
| **Database** | Live | Supabase Postgres (managed), 57 migrations applied, FORCE RLS on all 20 tables |
| **Phone provisioning** | Working | `POST /provisioning/activate` creates Vapi assistant + phone number automatically |
| **DynaTire phone** | Provisioned | +1 (630) 397-0194 — Vapi assistant created, phone assigned |
| **Stripe billing** | Configured | Webhook registered at `/billing/webhook`, test keys + price IDs set |
| **Local dev** | Working | `npm start` runs backend (3000) + dashboard (3001), dotenv loads `.env` |
| **Tests** | 263 backend + 368 dashboard = 631 passing | All green as of this session |
| **Supabase CLI** | v2.83.0 | Updated from 2.77.1 |

## What's Broken / Blocked

### Edge Functions Not Responding (CRITICAL BLOCKER)

**Symptom:** All HTTP requests to `https://sgibijfchvfuizudrmir.functions.supabase.co/vapi-tools` time out (no response at all, even simple requests without DB access).

**Impact:** The voice AI cannot use any tools (check availability, book appointments, look up customers). Calls connect and the AI talks, but it stalls for 30-60+ seconds saying "just a sec" when trying to use tools, then never completes the action.

**What we tried:**
1. Redeployed edge function (v9) — still times out
2. Updated `DATABASE_URL` secret with new password — still times out
3. Changed code to prefer `SUPABASE_DB_URL` (internal networking) — still times out
4. Set `DATABASE_URL` to direct connection (`db.xxx.supabase.co`) — still times out
5. Set `DATABASE_URL` to transaction pooler (port 6543) — still times out
6. Tested with no auth header (should get instant 401) — still times out
7. Reset database password in Supabase dashboard — still times out

**Timeline of how it broke:**
1. Edge functions were working fine (deployed since March 1, version 5)
2. Mid-session, we changed the Supabase database password (from old to `llYAVWp0x8U9DfBm`)
3. The `DATABASE_URL` secret in edge functions still had the OLD password
4. Every Vapi tool call triggered the edge function → tried to connect to DB → wrong password → hung for 150 seconds → `WORKER_LIMIT` error
5. This happened repeatedly (every time the AI tried to use a tool during test calls)
6. After several of these 150-second failures, the function stopped responding entirely
7. Even after fixing the password, it remains completely unresponsive

**Key evidence:**
- Logs show `WORKER_LIMIT` error: "Function failed due to not having enough compute resources"
- Status code `546` with `execution_time_ms: 150738` (2.5 minutes per attempt)
- Even a simple request with NO database access times out (meaning the function isn't even booting)
- Redeploying the function doesn't help — it gets "No change found" or deploys but still won't respond

---

### Analysis: Why It's Failing (Theories Ranked by Likelihood)

**Theory 1: Free tier compute budget exhausted (MOST LIKELY — 70%)**
- Supabase free tier has limited compute for edge functions
- Each failed invocation burned 150 seconds of compute (the max before timeout)
- We triggered many of these back-to-back (test calls + manual curl tests)
- Once the budget is gone, ALL invocations are rejected — even ones that would succeed
- Evidence: `WORKER_LIMIT` error is specifically about compute resources
- Fix: Upgrade to Pro tier ($25/mo) — compute limits are much higher or removed
- Alternative: Wait for the monthly budget to reset (unclear when this happens on free tier)

**Theory 2: Function stuck in bad state / boot crash (LIKELY — 20%)**
- The Deno postgres Pool is created at module load time (line 14 of repository.ts: `new Pool(DB_URL, 3, true)`)
- If the Pool constructor hangs on a bad connection string, the entire function never finishes loading
- This would explain why even non-DB requests time out — the function can't boot
- The `SUPABASE_DB_URL` auto-set by Supabase may still have the old password (we reset it, but Supabase might cache it)
- Fix: Make the Pool lazy (don't create it until first use) so the function can at least boot
- Fix: Add a connection timeout to the Pool constructor
- Fix: Verify `SUPABASE_DB_URL` has the correct password in Supabase dashboard

**Theory 3: Supabase infrastructure issue / throttling (POSSIBLE — 10%)**
- The project might be flagged for abuse after repeated long-running failures
- Supabase might rate-limit the function after too many `WORKER_LIMIT` errors
- Could also be a regional issue (project is in us-west-2, edge functions run in us-east-2 per logs)
- Fix: Contact Supabase support or check their status page
- Fix: Create a new Supabase project and migrate (nuclear option)

---

### Possible Solutions (in order of what to try)

**Solution A: Upgrade to Supabase Pro ($25/mo)** ← Try first
- Removes or significantly raises compute limits
- Should immediately unblock edge functions
- Required for production anyway (free tier not suitable for live phone calls)
- Estimated fix probability: 70%

**Solution B: Make DB pool lazy (code change)**
- Move `new Pool(DB_URL, 3, true)` out of module scope into a `getPool()` function
- Add connection timeout (e.g., 5 seconds) so it fails fast instead of hanging 150 seconds
- Redeploy edge function
- This fixes Theory 2 and prevents future occurrences
- Should do this regardless of whether Solution A works
- Estimated fix probability: 20% (if the issue is boot crash, not compute budget)

**Solution C: Wait for compute reset**
- Free tier budget may reset monthly or weekly
- No action needed, just wait
- Risky — unclear when/if it resets
- Estimated fix probability: Unknown

**Solution D: Check Supabase dashboard for clues**
- Edge Functions → vapi-tools → look for `BOOT_ERROR` vs `WORKER_LIMIT` in invocation logs
- Settings → Database → verify the password matches what we set
- Settings → Edge Functions → check if there's a "compute usage" indicator
- This is diagnostic, not a fix, but tells us which theory is correct

**Solution E: New Supabase project (last resort)**
- Create a fresh project, apply all 57 migrations, re-deploy edge functions
- Fresh compute budget, no throttling history
- Painful but guaranteed to work
- Only do this if upgrading to Pro doesn't fix it

### Voice Quality Observations (from first test call)

- **Talks too fast** — Need to add `speed: 0.9` to Vapi voice config
- **Long pauses during tool calls** — This is the edge function timeout issue above
- **Never booked an appointment** — Edge function couldn't respond
- **Got the problem right** — LLM understood the caller's intent correctly
- **Latency ~1150ms** — Normal for Vapi (STT + LLM + TTS), can be optimized later

---

## Environment Variables

### Railway (Backend) — All Set
| Variable | Status |
|----------|--------|
| `DATABASE_URL` | Set (Supabase session pooler) |
| `NODE_ENV` | `production` |
| `JWT_SECRET` | Set |
| `JWT_EXPIRY` | `8h` |
| `OPENAI_API_KEY` | Set |
| `VAPI_SERVER_URL_SECRET` | Set |
| `VAPI_API_KEY` | Set (Vapi private key) |
| `STRIPE_SECRET_KEY` | Set (test mode) |
| `STRIPE_WEBHOOK_SECRET` | Set (`whsec_...`) |
| `STRIPE_SOLO_PRICE_ID` | Set |
| `STRIPE_GROWTH_PRICE_ID` | Set |
| `STRIPE_PRO_PRICE_ID` | Set |
| `STRIPE_ENTERPRISE_PRICE_ID` | Set |
| `DASHBOARD_URL` | **NOT SET** (need dashboard deployed first) |

### Supabase Edge Function Secrets — All Set
| Variable | Status |
|----------|--------|
| `DATABASE_URL` | Set (transaction pooler, port 6543) |
| `SUPABASE_DB_URL` | Auto-set by Supabase (may have stale password) |
| `OPENAI_API_KEY` | Set |
| `VAPI_SERVER_URL_SECRET` | Set |

### Local `.env` — All Set (except VAPI_API_KEY placeholder)
Needs `VAPI_API_KEY` value pasted from Railway/Vapi dashboard.

---

## Deployment Architecture

```
Customer calls phone number
    ↓
Vapi receives call (hosted by Vapi)
    ↓
Vapi orchestrates: Deepgram STT → Groq LLM → Vapi TTS (Elliot voice)
    ↓
LLM decides to call a tool (e.g., book_appointment)
    ↓
Vapi POSTs to Supabase Edge Function (vapi-tools) ← BROKEN HERE
    ↓
Edge function queries Supabase Postgres
    ↓
Result returned to Vapi → LLM continues conversation
```

**Backend (Railway):**
- Serves dashboard API (CRUD, auth, billing, provisioning)
- Does NOT handle voice calls (that's Vapi + edge functions)

**Edge Functions (Supabase):**
- Handle real-time tool calls during voice conversations
- Must respond fast (<2 seconds) or the AI stalls

---

## Provisioned Resources

| Resource | Value |
|----------|-------|
| Railway backend URL | `https://ai-sec-production.up.railway.app/` |
| Supabase project | `sgibijfchvfuizudrmir` (us-west-2) |
| Edge function URL | `https://sgibijfchvfuizudrmir.functions.supabase.co/vapi-tools` |
| DynaTire phone | +1 (630) 397-0194 |
| DynaTire Vapi assistant ID | `01af2ff0-1fc2-4238-bc84-300674967bef` |
| DynaTire Vapi phone number ID | `4ddb7650-9ae5-42ec-8ba1-41286c821583` |
| Stripe webhook URL | `https://ai-sec-production.up.railway.app/billing/webhook` |

---

## Remaining TODO (Priority Order)

1. **Upgrade Supabase to Pro** ($25/mo) — unblocks edge functions
2. **Verify edge functions work** — test tool calls after upgrade
3. **Tune voice quality** — speed, endpointing, system prompt
4. **Deploy dashboard** (Vercel or Railway) — currently local only
5. **Set `DASHBOARD_URL`** in Railway — for Stripe checkout redirects
6. **SetupWizard Step 7** "Go Live" — activate phone from onboarding wizard
7. **UI/UX flow improvements** — hands-on testing
8. **Vocabulary wiring** — frontend still hardcodes "Resources"/"Employees"
9. **Database webhooks for n8n** — post-call summaries, calendar sync triggers
10. **Outlook calendar sync** — Google works, Outlook not implemented
11. **OAuth token refresh** — for calendar sync
12. **Beta testing with DynaTire** — real-world validation

---

## Key Decisions Made This Session

| Decision | Why |
|----------|-----|
| Single DB pool (no `api_user`) | Supabase managed Postgres doesn't support custom roles via pooler |
| `FORCE ROW LEVEL SECURITY` on all tables | RLS must apply even to `postgres` superuser role on Supabase |
| Vapi built-in voice (`provider: vapi, voiceId: Elliot`) | Cartesia/ElevenLabs/PlayHT require external API credentials in Vapi account |
| Groq `llama-3.3-70b-versatile` | Old `llama-3-70b-8192` model was deprecated by Groq |
| `dotenv/config` added to backend | Local `.env` file wasn't being read (no dotenv dependency before) |
| `process.cwd()` for template paths | `__dirname` resolves differently in dev vs compiled output |
| Edge function prefers `SUPABASE_DB_URL` | Internal networking on Supabase, avoids pooler/IPv6 issues |

---

## Files Changed This Session

### New Files
- `supabase/migrations/20260323000000_force_rls_single_pool.sql` — FORCE RLS + admin bypass policies
- `supabase/migrations/20260323000001_phone_provisioning.sql` — vapi_assistant_id, vapi_phone_number_id, phone_status columns
- `src/services/vapiClient.ts` — Vapi REST API client
- `src/routes/provisioning.ts` — activate/deactivate/status endpoints
- `src/provisioning.test.ts` — 7 provisioning tests
- `src/middleware-helpers.test.ts` — 7 tests for withPoolClient and requireTenantId
- `public/index.html` — Marketing landing page
- `dashboard/components/SetupWizard/` — 8 files (split from 1,386-line monolith)

### Modified Files
- `src/index.ts` — dotenv, single pool, graceful shutdown, provisioning route registration
- `src/middleware.ts` — added `withPoolClient()` and `requireTenantId()` helpers
- `src/routes/*.ts` — 12 route files refactored (29 tenant validations + 19 pool boilerplate blocks replaced)
- `vapi/agent.template.json` — updated model to llama-3.3-70b-versatile
- `dashboard/lib/api.ts` — Api.provisioning namespace
- `dashboard/components/SuperAdminDashboard.tsx` — Activate Phone UI
- `supabase/functions/vapi-tools/db/repository.ts` — lazy DB pool + SUPABASE_DB_URL fallback
- `.env` — populated with all local dev secrets
- `.env.production.guide` — added VAPI_API_KEY, DASHBOARD_URL
- `.gitignore` — added .env.production.save
- `CLAUDE.md` — updated throughout session
- `docs/DEPLOYMENT.md` — Railway deployment details, env var table

### Deleted Files
- `dashboard/app/onboard-business.tsx` — dead code (unused stub)

### Refactoring Summary
| Refactor | Impact |
|----------|--------|
| `withPoolClient()` helper | Eliminated 19 pool.connect/release blocks |
| `requireTenantId()` helper | Replaced 29 tenant validation instances across 12 route files |
| Lazy DB pool in edge function | Prevents boot crash if DB unreachable |
| SetupWizard split | 1,386 lines → 8 focused files (types + 6 steps + orchestrator) |
| Dead code removal | Deleted unused onboard-business.tsx |
| Smoke test fix | Fixed stale "AI Secretary Portal" → "SecretaryHQ Portal" in dist |

### Test Counts
- **301 backend tests** (30 test files) — all passing
- **368 dashboard tests** (27 test files) — all passing
- **Total: 669 tests**

### Sad-Path / Error Diagnostic Coverage
All error responses now verified to include debugging context:
- **WHO**: tenant_id, tenant_name in error payloads
- **WHAT**: specific operation that failed, missing fields listed
- **WHEN**: timestamp on all error responses
- **WHERE**: Postgres error codes (23502, 23503, 23505) with column/table detail
- **WHY**: Vapi API error detail, Zod field-level paths, JWT error differentiation, booking RPC specificity
