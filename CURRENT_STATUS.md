# SecretaryHQ — Current Status
**Last updated:** 2026-03-26

---

## Where We Are

Phase 13 (Production Readiness) is in progress. The backend is deployed to Railway and live. A phone number has been provisioned via Vapi. The edge functions (voice AI tool handlers) are deployed to Supabase but are currently not responding — Supabase project stuck in "pausing" state (known platform bug, not free tier). Waiting on Supabase support ticket.

All 8 design session work items from March 24 are now **complete**. All 24 refactoring items are **complete**. Calendar sync (Google + Outlook) and CRM integrations (Jobber + HubSpot) are **complete** with bidirectional sync and full test coverage.

---

## What's Working

| Component | Status | Details |
|-----------|--------|---------|
| **Backend API** | Live | `https://ai-sec-production.up.railway.app/` — Fastify, 19 route modules, Railway auto-deploy from main |
| **Landing page** | Live | Full marketing page at root URL with features, pricing, demo mockup |
| **Database** | Live | Supabase Postgres (managed), 59 migrations applied, FORCE RLS on all tables |
| **Phone provisioning** | Working | `POST /provisioning/activate` creates Vapi assistant + phone number automatically |
| **DynaTire phone** | Provisioned | +1 (630) 397-0194 — Vapi assistant created, phone assigned |
| **Stripe billing** | Configured | Webhook registered at `/billing/webhook`, test keys + price IDs set |
| **Local dev** | Working | `npm start` runs backend (3000) + dashboard (3001), dotenv loads `.env` |
| **Tests** | 638 backend + 313 dashboard = 951 passing | All green, zero failures, zero TS errors (strict unused checks) |
| **Google Calendar sync** | Working | OAuth flow, token refresh, auto-sync on create/update/delete/cancel |
| **Outlook Calendar sync** | Working | Microsoft Graph API, OAuth flow, token refresh, auto-sync on create/update/delete/cancel |
| **Jobber CRM sync** | Working | Bidirectional sync (push+pull), timestamp-based merge, OAuth, GraphQL API, webhooks |
| **HubSpot CRM sync** | Working | Bidirectional sync (push+pull), REST API (contacts+meetings), OAuth, webhook v3 verification |
| **Push triggers wired** | Working | Appointment + customer mutations fire-and-forget to all connected calendars + CRMs |
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

### Push Triggers (fire-and-forget, wired in route handlers)
| Mutation | Calendar sync | Jobber sync | HubSpot sync |
|----------|--------------|-------------|--------------|
| Appointment create | ✓ | ✓ | ✓ |
| Appointment update | ✓ | ✓ | ✓ |
| Appointment delete | ✓ | ✓ | ✓ |
| Appointment cancel | ✓ | ✓ | ✓ |
| Customer create | — | ✓ | ✓ |
| Customer update | — | ✓ | ✓ |
| Customer delete | — | ✓ | ✓ |

### Sync Strategy
- **Calendar**: Push-only. Calendar is display-only, not source of truth.
- **CRM**: Bidirectional with timestamp-based merge. Most recent `updated_at` wins per record. Non-conflicting fields merge via COALESCE.
- **Pull triggers**: Webhook receivers (`POST /jobber/webhook/:tenantId`, `POST /hubspot/webhook`) + periodic full sync (`POST /jobber/sync`, `POST /hubspot/sync`).
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

### Supabase Edge Function Secrets — Set
| Variable | Status |
|----------|--------|
| `DATABASE_URL` | Set (transaction pooler, port 6543) |
| `SUPABASE_DB_URL` | Auto-set by Supabase (may have stale password) |
| `OPENAI_API_KEY` | Set |
| `VAPI_SERVER_URL_SECRET` | Set |

---

## Remaining TODO (Priority Order)

1. ~~**Open Supabase support ticket**~~ — Email sent to support@supabase.com on 2026-03-26
2. **Verify edge functions work** — test tool calls after Supabase fixes the project state
3. **Tune voice quality** — speed, endpointing, system prompt
4. **Deploy dashboard** (Vercel or Railway) — currently local only
5. **Set `DASHBOARD_URL`** in Railway — for Stripe checkout + OAuth redirects
6. **Apply new migrations to Supabase** — 20260327000000 (Jobber tables) + 20260327000001 (HubSpot CHECK)
7. **UI/UX flow improvements** — hands-on testing
8. **Database webhooks for n8n** — post-call summaries, calendar sync triggers
9. **Beta testing with DynaTire** — real-world validation

### Done This Session (2026-03-26)
- ~~Outlook calendar sync~~ — Microsoft Graph API, OAuth, full CRUD
- ~~Jobber CRM integration~~ — Bidirectional GraphQL sync with timestamp merge
- ~~HubSpot CRM integration~~ — Bidirectional REST sync with meetings + contacts
- ~~CRM push triggers wired~~ — appointments.ts + customers.ts fire to all connected integrations
- ~~Comprehensive sad path coverage~~ — 951 total tests with 5W diagnostics
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
| Provisioning | 1 file | 39 | Area codes, Vapi errors, rollback, DB states |
| Scheduling | 1 file | 25 | Diagnostics, edge cases, empty data |
| Normalizer | 1 file | 17 | Timeouts, API errors, unicode |
| Vapi config | 1 file | 18 | Template validation, required fields |
| Dashboard (all) | 16 files | 313 | Components, wizards, scheduler, CRM, settings |
| Other backend | 11+ files | 281 | Auth, CRUD, billing, bugs, middleware, etc. |
| **Total** | **40 + 16** | **951** | Happy + sad paths, 5W diagnostics |
