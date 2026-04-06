# SecretaryHQ — Current Status
**Last updated:** 2026-04-05

---

## Where We Are

Phase 13 (Production Readiness) in progress. Backend live on Railway. Phone provisioned. Voice AI working end-to-end.

### April 3-4 Session: Architecture Review + Scheduling Overhaul

**Architecture review completed** — 32 items across Critical/High/Medium all resolved. See `docs/ARCHITECTURE_REVIEW_20260403.md` for full report. Key changes:
- Rate limiting (`@fastify/rate-limit`) + security headers (`@fastify/helmet`) added
- CORS restricted via `CORS_ORIGIN` env var
- Token refresh endpoint (`POST /auth/refresh`) + client-side auto-refresh (10min before expiry)
- Sync orchestrator (`src/services/syncOrchestrator.ts`) replaces 35 scattered fire-and-forget calls
- SettingsView split: 1,008 → 467 lines (extracted `CRMIntegrationCard.tsx`)
- SetupWizard split: 584 → 203 lines (extracted `useWizardCrud.ts`)
- Night shift support (cross-midnight time comparison)
- `check_availability_with_tz()` now checks employee shift coverage + overrides
- `getAvailableSlots()` consolidated from 13 DB round trips to 1
- Modal focus trap, form label auto-ids (`useId()`), lazy loading for dashboard tabs

**Scheduling simplified** — User rejected pattern+override model as too complex:
- **New model**: date-based only. Click a day → set times → save. No weekly patterns.
- Data lives in `shift_overrides` table (renamed in API to `Api.shifts.schedule.*`)
- Both Working Hours and Front Desk scheduler read from same table
- Default times: 8:00 AM - 5:00 PM
- `employee_shifts` (weekly patterns) still exists in DB but no longer used by UI

### Active Bug: Front Desk Shift Bars Not Rendering
- Working Hours view shows shifts correctly for Bella Salon
- Front Desk scheduler does NOT display shift bars despite data being in API
- Debug `console.log` added to `NewSchedulerView.tsx` (~line 213) — need browser console output
- `useSchedulerData` fetches `Api.shifts.schedule.list()` → filters by date → maps to `shiftsByEmployee`
- API confirmed returning correct data. Display issue only.

### Other UI Work Done
- Landing page `public/index.html`: added "Log in" button (was missing entirely)
- Skill map connection lines: brightened opacity and colors for dark themes
- Modal: fixed focus trap stealing keystrokes (useEffect now stable on `[isOpen]` only)

## What's Left

### Immediate (pick up here)
1. **Fix Front Desk shift bars** — debug console.log is in place, need browser output
2. **Remove debug console.log** from NewSchedulerView after fixing
3. **Verify modal focus fix** — typing in skill modal should work now

### Phase 13 Remaining
- **Deploy dashboard to Railway** — code ready, blocked by Railway incident April 2
- **Set `DASHBOARD_URL`** on backend — needs dashboard deployed
- **UI/UX flow improvements** — ongoing
- **Database webhooks for n8n** — ops task, triggers exist
- **Beta testing with DynaTire** — needs dashboard deployed

### Test Count
- **1,468 tests passing, 0 failures** (as of last full run before scheduling changes)
- 1,118 backend + 347 dashboard + 3 edge function
- Some test files may need updating after scheduling simplification

---

## What's Working

| Component | Status | Details |
|-----------|--------|---------|
| **Backend API** | Live | `https://ai-sec-production.up.railway.app/` — Fastify, 20 route modules, Railway auto-deploy from main |
| **Landing page** | Live | Full marketing page at root URL with features, pricing, demo mockup |
| **Database** | Live | Supabase Postgres (managed), 63 migrations applied, FORCE RLS on all tables |
| **Phone provisioning** | Working | `POST /provisioning/activate` creates Vapi assistant + phone number automatically |
| **DynaTire phone** | Provisioned | +1 (630) 397-0194 — Vapi assistant (Clara voice, GPT-4o-mini), phone assigned |
| **Voice AI (end-to-end)** | Working | Answers calls, books appointments, answers policy questions, rejects invalid bookings naturally |
| **Edge functions** | Working | Supabase pausing bug resolved 2026-03-30, all 7 tools operational |
| **Knowledge base** | Working | 40 policy Q&A pairs across 9 categories, document upload (PDF/TXT/DOC/DOCX/MD), auto-save |
| **QA test suite** | Working | `scripts/qa-live-test.py` — 29 tool calls, 88 assertions against live edge function |
| **Stripe billing** | Configured | Webhook registered at `/billing/webhook`, test keys + price IDs set |
| **Local dev** | Working | `npm start` runs backend (4001) + dashboard (4000), dotenv loads `.env` |
| **Tests** | 1,038 backend + 332 dashboard = 1,370 passing + 88 QA assertions | All green (with DB running), zero TS errors |
| **Google Calendar sync** | Working | OAuth flow, token refresh, auto-sync on create/update/delete/cancel |
| **Outlook Calendar sync** | Working | Microsoft Graph API, OAuth flow, token refresh, auto-sync on create/update/delete/cancel |
| **Jobber CRM sync** | Working | Bidirectional sync (push+pull), timestamp-based merge, OAuth, GraphQL API, webhooks |
| **HubSpot CRM sync** | Working | Bidirectional sync (push+pull), REST API (contacts+meetings), OAuth, webhook v3 verification |
| **Push triggers wired** | Working | Appointment + customer mutations fire-and-forget to all connected calendars + CRMs |
| **Supabase CLI** | v2.83.0 | Updated from 2.77.1 |

## What's Broken / Blocked

### ~~Voice AI Scheduling Bug~~ — RESOLVED (2026-04-01)

**BUG-059**: `book_with_scheduling_atomic()` was using hardcoded UTC timezone for shift validation, causing bookings to fail for non-UTC tenants (e.g., Chicago tenant booking at 5 PM Friday would fail because function checked for Saturday shifts in UTC).

**Fixed**: Applied migration `20260401000000_fix_scheduling_timezone_bug.sql` — now uses tenant's actual timezone from `tenants.timezone` column.

**Impact**: Voice AI can now successfully book appointments for tenants in any timezone.

**Test**: Created `src/scheduling-timezone-bug.test.ts` to verify fix (TDD approach).

### ~~Edge Functions Not Responding~~ — RESOLVED (2026-03-30)

Supabase project is no longer stuck in "pausing" state. Edge functions are reachable and fully operational. See `TRIAGE.md` for historical context.

### Minor Issues (non-blocking)
- **OpenAI API quota** — Edge functions use GPT-4o-mini for LLM + embeddings. Monitor usage as call volume grows.
- **Filler phrases** — Voice AI occasionally says "Absolutely!" or "Great!" despite prompt engineering. Iterating on system prompt.

---

## Integration Architecture

### Calendar Sync (Push-only: SecretaryHQ → Calendar)
| Provider | Service file | Route file | How it works |
|----------|-------------|------------|-------------|
| Google Calendar | `src/services/googleCalendar.ts` | `src/routes/calendar.ts` | googleapis SDK, OAuth 2.0, Events API |
| Outlook Calendar | `src/services/outlookCalendar.ts` | `src/routes/calendar.ts` | Raw fetch to Microsoft Graph API v1.0 |
| Sync orchestrator | `src/services/calendarSync.ts` | — | Provider-agnostic, 5-min token refresh buffer, 5W logging |

### CRM Sync (Bidirectional: push + pull with timestamp merge)
| Provider | Client file | Sync file | Route file | API type |
|----------|------------|-----------|------------|----------|
| Jobber | `src/services/jobberClient.ts` | `src/services/jobberSync.ts` | `src/routes/jobber.ts` | GraphQL |
| HubSpot | `src/services/hubspotClient.ts` | `src/services/hubspotSync.ts` | `src/routes/hubspot.ts` | REST v3 |
| Square | `src/services/squareClient.ts` | `src/services/squareSync.ts` | `src/routes/square.ts` | REST v2 |
| ServiceTitan | `src/services/servicetitanClient.ts` | `src/services/servicetitanSync.ts` | `src/routes/servicetitan.ts` | REST v2 |

### Shared OAuth/Token Infrastructure
| File | Purpose |
|------|---------|
| `src/services/oauthCallbackFactory.ts` | Generic OAuth callback handler factory — eliminates duplication across 4 CRM integrations |
| `src/services/tokenManagement.ts` | Shared token refresh logic with 5-min buffer for all OAuth integrations |

### Push Triggers (fire-and-forget, wired in route handlers)
| Mutation | Calendar sync | Jobber sync | HubSpot sync | Square sync | ServiceTitan sync |
|----------|--------------|-------------|--------------|-------------|-------------------|
| Appointment create | ✓ | ✓ | ✓ | ✓ | ✓ |
| Appointment update | ✓ | ✓ | ✓ | ✓ | ✓ |
| Appointment delete | ✓ | ✓ | ✓ | ✓ | ✓ |
| Appointment cancel | ✓ | ✓ | ✓ | ✓ | ✓ |
| Customer create | — | ✓ | ✓ | ✓ | ✓ |
| Customer update | — | ✓ | ✓ | ✓ | ✓ |
| Customer delete | — | ✓ | ✓ | ✓ | ✓ |

### Sync Strategy
- **Calendar**: Push-only. Calendar is display-only, not source of truth.
- **CRM**: Bidirectional with timestamp-based merge. Most recent `updated_at` wins per record. Non-conflicting fields merge via COALESCE.
- **Pull triggers**: Webhook receivers (`POST /jobber/webhook/:tenantId`, `POST /hubspot/webhook`, `POST /square/webhook`, `POST /servicetitan/webhook`) + periodic full sync (`POST /{provider}/sync`).
- **DB tables**: `tenant_integration_settings` (OAuth tokens per provider), `entity_sync_map` (local↔external ID mapping with timestamps).

---

## Environment Variables

### Railway (Backend) — Set
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
| `STRIPE_WEBHOOK_SECRET` | Set |
| `STRIPE_SOLO_PRICE_ID` | Set |
| `STRIPE_GROWTH_PRICE_ID` | Set |
| `STRIPE_PRO_PRICE_ID` | Set |
| `STRIPE_ENTERPRISE_PRICE_ID` | Set |
| `DASHBOARD_URL` | **NOT SET** (need dashboard deployed first) |
| `GOOGLE_CLIENT_ID` | **NOT SET** (need Google Cloud OAuth app) |
| `GOOGLE_CLIENT_SECRET` | **NOT SET** |
| `GOOGLE_CALLBACK_URL` | **NOT SET** (`https://ai-sec-production.up.railway.app/calendar/auth/google/callback`) |
| `OUTLOOK_CLIENT_ID` | **NOT SET** (need Azure AD app registration) |
| `OUTLOOK_CLIENT_SECRET` | **NOT SET** |
| `OUTLOOK_CALLBACK_URL` | **NOT SET** (`https://ai-sec-production.up.railway.app/calendar/auth/outlook/callback`) |
| `JOBBER_CLIENT_ID` | **NOT SET** (need Jobber developer app) |
| `JOBBER_CLIENT_SECRET` | **NOT SET** |
| `JOBBER_CALLBACK_URL` | **NOT SET** (`https://ai-sec-production.up.railway.app/jobber/auth/callback`) |
| `HUBSPOT_CLIENT_ID` | **NOT SET** (need HubSpot developer app) |
| `HUBSPOT_CLIENT_SECRET` | **NOT SET** |
| `HUBSPOT_CALLBACK_URL` | **NOT SET** (`https://ai-sec-production.up.railway.app/hubspot/auth/callback`) |
| `SQUARE_CLIENT_ID` | **NOT SET** (need Square developer app) |
| `SQUARE_CLIENT_SECRET` | **NOT SET** |
| `SQUARE_CALLBACK_URL` | **NOT SET** (`https://ai-sec-production.up.railway.app/square/auth/callback`) |
| `SERVICETITAN_CLIENT_ID` | **NOT SET** (need ServiceTitan developer app) |
| `SERVICETITAN_CLIENT_SECRET` | **NOT SET** |
| `SERVICETITAN_APP_KEY` | **NOT SET** (ST-App-Key header) |
| `SERVICETITAN_CALLBACK_URL` | **NOT SET** (`https://ai-sec-production.up.railway.app/servicetitan/auth/callback`) |

### Supabase Edge Function Secrets — Set
| Variable | Status |
|----------|--------|
| `DATABASE_URL` | Set (transaction pooler, port 6543) |
| `SUPABASE_DB_URL` | Auto-set by Supabase (may have stale password) |
| `OPENAI_API_KEY` | Set |
| `VAPI_SERVER_URL_SECRET` | Set |

---

## Remaining TODO (Priority Order)

1. **Deploy dashboard** (Vercel or Railway) — currently local only
2. **Set `DASHBOARD_URL`** in Railway — for Stripe checkout + OAuth redirects
3. ~~Apply new migrations to Supabase~~ — Done. All 63 migrations applied including April 1 timezone fix + specific booking errors
4. **UI/UX flow improvements** — hands-on testing
5. **Database webhooks for n8n** — post-call summaries, calendar sync triggers
6. **Beta testing with DynaTire** — real-world validation with live calls

### Done This Session (2026-04-01)
- ~~BUG-059: Timezone regression~~ — `book_with_scheduling_atomic()` used hardcoded UTC for shift validation; now uses tenant timezone. Migration `20260401000000`
- ~~BUG-060: Phone number incomplete~~ — `normalizePhone()` now rejects < 10 digits (was accepting "+1" as valid)
- ~~BUG-061: Wrong date booked~~ — Vapi assistant had hardcoded stale date in system prompt; updated with dynamic date handling
- ~~BUG-062: No employee assigned~~ — AI wasn't passing `requiredEmployeeSkills`; prompt updated with service-to-skill mapping
- ~~BUG-063: Call hangs up on booking failure~~ — Added error handling instructions to Vapi assistant prompt
- ~~BUG-064: Generic booking errors~~ — Added specific error codes (TIMESLOT_OCCUPIED, NO_SKILLED_EMPLOYEE, EMPLOYEE_NOT_SCHEDULED) via migration `20260401000001`
- ~~OAuth callback refactoring~~ — Created `oauthCallbackFactory.ts` + `tokenManagement.ts` to eliminate duplication across Jobber, HubSpot, Square, ServiceTitan
- ~~Test expansion~~ — Added scheduling timezone bug test, voice AI fixes test, available slots test, comprehensive bug fix regression tests (rounds 1-5)
- ~~BUG-030: Orphaned transcripts~~ — `link_orphaned_transcripts()` now called in `dispatcher.handleCallEnded()` after every call
- ~~BUG-031: Timezone availability~~ — `service.checkAvailability()` now calls `check_availability_with_tz()` RPC for timezone-aware results
- ~~BUG-032: Call summary embeddings~~ — n8n workflow now generates embeddings (text-embedding-3-small) and stores them in `call_summaries.embedding`
- ~~BUG-038: Soft delete filtering~~ — All 7 edge function queries on soft-deletable tables now filter `is_deleted`. `deleteEmployee()` converted to soft delete
- ~~BUG-039: ARIA accessibility~~ — Toast, Card, FeedbackButton, CoverageBar, OutlookLayout tabs all have proper ARIA attributes

### Done Previous Session (2026-03-30)
- ~~Supabase blocker resolved~~ — Project no longer stuck in "pausing" state
- ~~Voice AI end-to-end working~~ — 8 critical fixes (tool response format, Zod relaxation, caller ID, timezone, natural errors)
- ~~LLM switched~~ — Groq/Llama 3.3 → OpenAI GPT-4o-mini (better instruction following)
- ~~Voice switched~~ — Vapi "Elliot" (male) → Vapi "Clara" (young American female)
- ~~Vapi assistant configured~~ — Smart endpointing, background denoising, Deepgram keywords, speaking plans
- ~~Booking validation~~ — Past-time rejection, business hours check, fuzzy service matching, timezone conversion (America/Chicago)
- ~~Knowledge base questionnaire~~ — 40 policy Q&A pairs across 9 categories, auto-save, document upload, embedding generation
- ~~DynaTire data cleanup~~ — 1 employee (Mike Rivera), 1 truck, all 5 services assigned, Mon-Fri 8-6
- ~~System prompt engineering~~ — Name spelling, no phone collection (use caller ID), no filler, natural datetime speech
- ~~QA test suite~~ — `scripts/qa-live-test.py` — 29 tool calls, 88 assertions, all passing
- ~~tools.json updated~~ — Added `get_company_policy_answer` and `get_service_catalog` tools

### Done Previous Session (2026-03-26)
- ~~Outlook calendar sync~~ — Microsoft Graph API, OAuth, full CRUD
- ~~Jobber CRM integration~~ — Bidirectional GraphQL sync with timestamp merge
- ~~HubSpot CRM integration~~ — Bidirectional REST sync with meetings + contacts
- ~~Square CRM integration~~ — Bidirectional REST v2 sync with customers + bookings
- ~~ServiceTitan CRM integration~~ — Bidirectional REST v2 sync with customers + jobs
- ~~CRM push triggers wired~~ — appointments.ts + customers.ts fire to all connected integrations (4 CRMs + 2 calendars)
- ~~Comprehensive sad path coverage~~ — 1,319 total tests with 5W diagnostics
- ~~30 unused variable warnings cleaned~~ — zero TS errors with strict checks
- ~~Scheduling diagnostics~~ — `selectAssignments()` returns reason strings ("all 3 bays busy", etc.)
- ~~All refactoring items complete~~ — 24/24 done (SUGGESTED_REFACTORINGS.md)

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

## Test Coverage Summary

| Area | Test files | Test count | Coverage |
|------|-----------|------------|----------|
| Calendar sync (Google + Outlook) | 3 files | 102 | OAuth, sync orchestration, happy + sad |
| Jobber CRM | 3 files | 82 | Client, sync, routes — happy + sad |
| HubSpot CRM | 3 files | 74 | Client, sync, routes — happy + sad |
| Square CRM | 3 files | ~70 | Client, sync, routes — happy + sad |
| ServiceTitan CRM | 3 files | ~70 | Client, sync, routes — happy + sad |
| Provisioning | 1 file | 39 | Area codes, Vapi errors, rollback, DB states |
| Scheduling + timezone | 2 files | 34 | Diagnostics, edge cases, UTC drift, DST transitions, midnight boundary, 5W sad paths |
| Voice AI fixes | 1 file | 22 | Phone normalization (E.164, partial, garbage), date calc (month/year boundary), skill mapping, error codes — all with 5W |
| OAuth/token management | 2 files | 20+ | Generic callback factory, token refresh |
| Normalizer | 1 file | 17 | Timeouts, API errors, unicode |
| Vapi config | 1 file | 18 | Template validation, required fields |
| Bug fix regression | 6 files | 80+ | April 1 rounds 1-5, comprehensive, regression |
| Dashboard (all) | 16 files | 313 | Components, wizards, scheduler, CRM, settings |
| Other backend | 11+ files | 281 | Auth, CRUD, billing, bugs, middleware, etc. |
| QA live tests | 1 file | 29 calls / 88 assertions | Live edge function tool calls with DB verification |
| **Total** | **59 + 16 + 1** | **1,319 + 88 QA** | Happy + sad paths, 5W diagnostics, live integration |
