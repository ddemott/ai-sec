# SecretaryHQ — Current Status
**Last updated:** 2026-03-25

---

## Where We Are

Phase 13 (Production Readiness) is in progress. The backend is deployed to Railway and live. A phone number has been provisioned via Vapi. The edge functions (voice AI tool handlers) are deployed to Supabase but are currently not responding — Supabase project stuck in "pausing" state (known platform bug, not free tier). Waiting on Supabase support ticket.

All 8 design session work items from March 24 are now **complete** (dark theme, theme system, scheduler redesign, profile card, skills toggle, drag reorder, analytics rebuild, coverage map removal). See `docs/UI_UX_DESIGN.md` implementation table.

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
| **Tests** | 315 backend + 252 dashboard = 567 passing | All green, zero failures, zero TS errors |
| **Supabase CLI** | v2.83.0 | Updated from 2.77.1 |

## What's Broken / Blocked

### Edge Functions Not Responding (CRITICAL BLOCKER)

**Root Cause: Supabase platform bug — project stuck in "pausing" state.**

This is a known Supabase issue affecting multiple users. The project's internal state is stuck in a transitional "pausing" state, which prevents the edge function gateway from forwarding HTTP requests. The function boots successfully (69ms) but requests never reach it. The Restart/Pause buttons in the dashboard are greyed out.

**Status:** Waiting on Supabase support ticket. See `TRIAGE.md` for the full report and evidence.

**Known matching issues:**
- [Project stuck in PAUSING state #44125](https://github.com/supabase/supabase/issues/44125)
- [Project stuck in "Pausing..." state indefinitely #35136](https://github.com/supabase/supabase/issues/35136)
- [Discussion #37844](https://github.com/orgs/supabase/discussions/37844)

**Resolution:** Supabase support needs to manually reset the project state. Upgrading to Pro tier alone will not fix this.

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

1. **Open Supabase support ticket** — project stuck in pausing state, needs manual reset (see TRIAGE.md)
2. **Verify edge functions work** — test tool calls after Supabase fixes the project state
3. **Tune voice quality** — speed, endpointing, system prompt
4. **Deploy dashboard** (Vercel or Railway) — currently local only
5. **Set `DASHBOARD_URL`** in Railway — for Stripe checkout redirects
6. **SetupWizard Step 7** "Go Live" — activate phone from onboarding wizard
7. **UI/UX flow improvements** — hands-on testing
8. ~~**Vocabulary wiring**~~ — Done. 21 business-facing components use `useVocabulary()` hook
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
- `src/core/models.ts` — dead types + utility functions only used by one test (inlined into test)
- `src/core/scheduling.ts` — dead re-export wrapper (nothing imported it)

### Refactoring Summary
| Refactor | Impact |
|----------|--------|
| `withPoolClient()` helper | Eliminated 19 pool.connect/release blocks |
| `requireTenantId()` helper | Replaced 29 tenant validation instances across 12 route files |
| Lazy DB pool in edge function | Prevents boot crash if DB unreachable |
| SetupWizard split | 1,386 lines → 8 focused files (types + 6 steps + orchestrator) |
| Dead code removal | Deleted unused onboard-business.tsx, core/models.ts, core/scheduling.ts |
| Fetch timeouts | AbortController on getEmbedding (10s) and normalizeForEmbedding (15s) |
| Pool standardization | tenants.ts + auth.ts: all pool.connect() → withPoolClient() + withHandler() |
| Auth logout utility | forceLogout() + checkAuthFailure() extracted in api.ts (4 duplication sites → 1) |
| Vapi error format | All edge function errors return `{result: {success, error}}` with status 200 |
| Env validation | Production startup fails fast on missing DATABASE_URL/JWT/OpenAI/Stripe |
| Button prop cleanup | Removed deprecated `loading` prop; standardized on `isLoading` (12 callers) |
| Modal accessibility | Escape key + backdrop click to close |
| DB pool timeout | connectWithTimeout (5s) + pool size 2 for serverless edge functions |
| Session consolidation | Removed useSession hook + overrideTenantId prop drilling (~20 components) |
| Zod schemas | Added to tenants, employees, shifts, resources, services, skills, calendar routes |
| Error format | All error responses standardized to `{ success: false, error, details? }` |
| useFormState hook | Generic form state + dirty tracking in hooks.ts |
| Component splits | AppointmentView → +ListSidebar +DetailPanel; SuperAdmin → +TenantCard +CreateForm +EditPanel; CRM → +CustomerDetailPanel; Wizard → +WizardStepContent |
| Full type safety | API layer + hooks + 19 components: 233 TS errors → 0. All `Record<string, unknown>` replaced with proper entity types |
| Smoke test fix | Fixed stale "AI Secretary Portal" → "SecretaryHQ Portal" in dist |

### Test Counts
- **315 backend tests** (31 test files) — all passing
- **252 dashboard tests** (15 test files) — all passing
- **Total: 567 tests, zero failures**
- Note: dashboard test count increased from 194 → 252 due to NewSchedulerView tests (58 tests covering scheduler redesign features)

### Changes — 2026-03-25 Session
- Added shift duration bars in Hours mode (NewSchedulerView)
- Drag-to-reorder staff rows now persists to localStorage per tenant
- Deleted `ServiceCoverageView.tsx` (Coverage Map) — zero references remain
- Fixed "SecretaryHQ" → "Secretary HQ" in 4 UI files (5 occurrences)
- Updated Supabase blocker diagnosis: platform bug (project stuck in pausing state), not free tier
- Updated all status docs (CLAUDE.md, CURRENT_STATUS.md, UI_UX_DESIGN.md, MEMORY.md)
- **Route restructure**: Dashboard app moved to `/dashboard` route, landing page at `/`
- **Next.js landing page**: Full marketing page in `dashboard/app/page.tsx` (replaces static `public/index.html` for Next.js)
- **Backend `/demo` route**: Serves `public/secretaryhq-demo.html`
- **`{{DASHBOARD_URL}}` template**: Backend injects `DASHBOARD_URL` env var into landing page HTML
- **Duplicate tenant name prevention**: Both frontend (SuperAdminDashboard) + backend (tenants.ts, 409 on conflict)
- **Card `style` prop**: Added to `CardProps` interface, fixing 6 TS errors in KnowledgeBaseView + SettingsView
- **Area code input UX**: Added label with "Area code (optional)" above input
- **Flash-of-white prevention**: Inline critical CSS + localStorage theme script in `layout.tsx`
- **JetBrains Mono font**: Added to Google Fonts import for monospace UI elements

### Sad-Path / Error Diagnostic Coverage
All error responses now verified to include debugging context:
- **WHO**: tenant_id, tenant_name in error payloads
- **WHAT**: specific operation that failed, missing fields listed
- **WHEN**: timestamp on all error responses
- **WHERE**: Postgres error codes (23502, 23503, 23505) with column/table detail
- **WHY**: Vapi API error detail, Zod field-level paths, JWT error differentiation, booking RPC specificity
