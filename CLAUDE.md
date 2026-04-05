# SecretaryHQ - Multi-Tenant Voice AI Reception SaaS

## Project Overview
Multi-tenant AI receptionist platform for service businesses (tire shops, salons, auto shops, trades, fitness, food & beverage). Handles inbound calls via voice AI, books appointments, answers policy questions via RAG, and syncs with external calendars. HIPAA verticals (medical, dental, chiropractic, optometry, veterinary) are permanently excluded — they do not appear anywhere in the UI.

## Architecture
- **Voice AI**: Telnyx (telephony) -> Vapi (orchestrator, STT/LLM/TTS) -> Supabase Edge Function (Deno)
- **Backend API**: Node.js / Fastify (20 route modules under src/routes/) -> Postgres (Railway deployment)
- **Dashboard**: Next.js 14 (App Router) + Tailwind CSS + TypeScript
- **Database**: Postgres with pgvector, RLS multi-tenancy, atomic booking RPCs
- **Async Workers**: n8n (post-call summaries, calendar sync, SMS)
- **Auth**: JWT-based authentication (8h expiry, auto-logout on 401), bcrypt password hashing

## Key Directories
- `/src` - Fastify backend (slim index.ts entry, 20 route modules under src/routes/)
- `/src/routes` - Modularized route handlers (auth, tenants, appointments, customers, employees, shifts, resources, services, mappings, skills, calendar, knowledge, analytics, vocabulary, billing, provisioning, jobber, hubspot, square, servicetitan)
- `/src/services` - Service layer (vapiClient.ts, googleCalendar.ts, outlookCalendar.ts, calendarSync.ts, syncOrchestrator.ts, nameUtils.ts, jobberClient.ts, jobberSync.ts, hubspotClient.ts, hubspotSync.ts, squareClient.ts, squareSync.ts, servicetitanClient.ts, servicetitanSync.ts, oauthCallbackFactory.ts, tokenManagement.ts)
- `/src/middleware.ts` - Shared middleware (withHandler decorator, tenantMiddleware, AppError, logEvent/logWarning)
- `/dashboard` - Next.js frontend (components/, lib/, app/) — landing page at `/`, dashboard app at `/dashboard`
- `/supabase/functions/vapi-tools` - Deno Edge Functions (voice AI tool handlers)
- `/supabase/migrations` - 67 SQL migrations (schema, RLS, RPCs, coverage, billing, provisioning, CRM integrations, timezone fix, specific booking errors, shift_overrides, night shifts)
- `/shared` - Cross-runtime shared code (getEmbedding.ts, scheduling.ts) used by both Node and Deno
- `/supabase/seed.sql` - Seed data (platform admin + DynaTire tenant)
- `/scripts` - Automation (knowledge ingestion, `qa-live-test.py` QA suite)
- `/vapi` - Vapi agent config and tool definitions
- `/n8n` - Workflow blueprints (calendar sync, post-call summarizer)
- `/docs` - Architecture, setup, plans, and reference docs
- `/certs` - Self-signed HTTPS certificates for local dev

## Tech Stack
- **Backend**: Fastify 4.x, bcrypt, zod, pg (Node PostgreSQL driver)
- **Frontend**: Next.js 14, React 18, Tailwind CSS 3.4, Lucide icons, react-big-calendar
- **Edge Functions**: Deno, Supabase Edge Functions, Pino logger
- **Database**: PostgreSQL + pgvector (ankane/pgvector Docker image)
- **Testing**: Vitest (backend + dashboard), Deno test (edge functions)
- **Voice**: Vapi (Clara voice), Telnyx, OpenAI GPT-4o-mini, Deepgram Nova-2
- **QA**: `scripts/qa-live-test.py` — 29 tool calls, 88 assertions against live Supabase edge function

## Development
- Bootstrap: `npm run bootstrap` (installs deps, starts DB, applies migrations, seeds)
- Start: `npm start` (Dashboard: https://localhost:3001, Backend: https://localhost:3000)
- Test backend: `npm test`
- Test dashboard: `cd dashboard && npm test`
- Test edge functions: `deno task test --no-check`
- Login: admin@secretaryhq.com / password
- Super-admin tenant: `00000000-0000-0000-0000-000000000000`
- PoC tenant (DynaTire): `f234e471-0e60-4163-86c9-93cfd9338e3a`
- Docker DB on port 5433

## Database Key Details
- RLS on all tenant-scoped tables using `app.current_tenant_id` context variable
- `FORCE ROW LEVEL SECURITY` on all 20 RLS-enabled tables (enforces RLS even for postgres superuser role)
- Single DB pool via `DATABASE_URL` (no separate `api_user` pool — works with Supabase managed Postgres)
- Admin bypass policies on `tenants`, `users`, `business_templates` for cross-tenant operations when no tenant context set
- Audit trigger (`fn_audit_trigger`) is `SECURITY DEFINER` to bypass RLS for internal logging
- `book_appointment_atomic()` RPC: 7-layer constraint check (resource availability, staff qualification, resource capability, staff on shift, service coverage, auto end-time, customer upsert) + past-time rejection, business hours validation, fuzzy service matching
- `book_with_scheduling_atomic()` RPC: Production booking RPC with shift_overrides support (checks overrides first, falls back to patterns), night shift support (cross-midnight), specific error codes (TIMESLOT_OCCUPIED, NO_SKILLED_EMPLOYEE, EMPLOYEE_NOT_SCHEDULED, NO_AVAILABILITY, INVALID_PARAMS)
- `shift_overrides` table: date-specific employee schedules (replaces weekly patterns in UI). Both Working Hours and Front Desk scheduler read from this table. API: `GET/POST /shifts/overrides`
- `employee_shifts` table: weekly patterns (day_of_week 0-6) — still exists for booking RPC fallback but NOT used by dashboard UI. UI uses date-based scheduling only.
- `search_tenant_docs()` RPC: cosine similarity over pgvector embeddings
- Polymorphic assignment: `p_assignment_id` is UUID
- All entity IDs are UUID (services and employees migrated from SERIAL to UUID in Phase 9)

## Code Conventions
- Dashboard navigation: Front Desk / Back Office two-tab layout with sub-views in each tab
- Toast notification system (dashboard/components/ui/Toast.tsx)
- Dashboard components follow List+Detail pane pattern (sidebar list, detail right)
- Large views split into sub-components (e.g., AppointmentView → AppointmentListSidebar + AppointmentDetailPanel)
- UI primitives in `dashboard/components/ui/` (Button with `isLoading`, Card, Input, Select, Modal with Escape/backdrop-close, Badge)
- API client centralized in `dashboard/lib/api.ts` with namespaced `Api.{resource}.{action}()`, fully typed return values (no `Record<string, unknown>`), shared `forceLogout()` + `checkAuthFailure()`
- Entity types in `dashboard/lib/types.ts` (Appointment, Customer, Resource, Employee, Service, Shift, Skill, Tenant, BusinessTemplate, etc.)
- **Zero TypeScript errors** — strict type checking passes (`npx tsc --noEmit`)
- Session state via `SessionContext` — use `useActiveTenantId()` for the effective tenant ID (replaces old `useSession` hook)
- No `overrideTenantId` prop drilling — components read tenant from context directly
- `useFormState<T>()` hook for generic form state + dirty tracking
- Deno service layer: Service -> Dispatcher -> Repository pattern
- Fastify: slim index.ts registers 20 route modules; all tenant-scoped routes use `withTenantClient()` for RLS
- All route mutations validated with Zod schemas (auth, tenants, employees, shifts, resources, services, skills, calendar, appointments, customers)
- All error responses use `{ success: false, error: string, details?: any }` format
- Production env validation: server refuses to start if DATABASE_URL, JWT_SECRET, OPENAI_API_KEY, or STRIPE_SECRET_KEY are missing
- Edge function tool responses use Vapi format: `{ results: [{ toolCallId, result }] }` with status 200
- Edge function errors return plain `"ERROR: ..."` strings (not nested JSON) so the LLM can relay them naturally
- Edge function DB pool: lazy init, pool size 2, 5s connection timeout via `connectWithTimeout()`
- Fetch timeouts on all OpenAI API calls (10s embeddings, 15s normalization) via AbortController
- Graceful shutdown: SIGTERM/SIGINT handlers close Fastify + drain DB pool (required for Railway deploys)

## Known Issues (as of April 2026)
- OpenAI API quota needs monitoring — edge functions use GPT-4o-mini for LLM + embeddings
- Voice AI filler phrases ("Absolutely!", "Great!") still slip through occasionally despite prompt engineering

### April 1, 2026 Remaining Bug Fixes
- BUG-030: `link_orphaned_transcripts()` now called automatically in `dispatcher.handleCallEnded()` after every call
- BUG-031: `checkAvailability()` now uses `check_availability_with_tz()` RPC for timezone-aware results
- BUG-032: n8n workflow now generates embeddings (text-embedding-3-small) and stores in `call_summaries.embedding`
- BUG-038: All edge function queries on soft-deletable tables filter `is_deleted`. `deleteEmployee()` uses soft delete
- BUG-039: ARIA attributes added to Toast, Card, FeedbackButton, CoverageBar, OutlookLayout tabs

## Resolved Issues
### March 2026 Code Review
- 58 bugs identified and resolved across Critical/High/Medium/Low severity
- users.email scoped to per-tenant uniqueness (BUG-002)
- RLS standardized on `app.current_tenant_id` (BUG-006)
- Dev bypass button removed (BUG-005)
- handleEditFormChange fixed in CRMView (BUG-004)
- Fastify monolith broken into 20 route modules with RLS enforcement (BUG-017)
- Scheduling logic consolidated into `shared/scheduling.ts` (BUG-016)

### April 1, 2026 Voice AI Bug Fixes
- BUG-059: Timezone regression in `book_with_scheduling_atomic()` — hardcoded UTC instead of tenant timezone for shift validation. Fixed with migration `20260401000000_fix_scheduling_timezone_bug.sql`
- BUG-060: Phone number stored as "+1" (incomplete) — `normalizePhone()` now rejects < 10 digits
- BUG-061: Wrong date booked — Vapi assistant had hardcoded stale date in system prompt, now uses dynamic date
- BUG-062: No employee assigned — AI wasn't passing `requiredEmployeeSkills` array, prompt updated with service-to-skill mapping
- BUG-063: Call hangs up on booking failure — added error handling to Vapi assistant prompt
- BUG-064: Generic booking error messages — added specific error codes (TIMESLOT_OCCUPIED, NO_SKILLED_EMPLOYEE, EMPLOYEE_NOT_SCHEDULED) to `book_with_scheduling_atomic()` via migration `20260401000001_specific_booking_errors.sql`

## Project Status
Phases 1–12 complete. Phase 13 (UI/UX Polish & Production Readiness) in progress. 1,118 backend tests + 347 dashboard tests + 3 edge function tests = 1,468 total passing (with DB running). 29 live QA tool-call tests (88 assertions). Zero TypeScript errors. Architecture review complete (32 items, all resolved — see `docs/ARCHITECTURE_REVIEW_20260403.md`).

### Remaining (Phase 13)
- ~~Supabase support ticket~~ — Resolved 2026-03-30. Project no longer stuck in "pausing" state.
- ~~End-to-end voice call~~ — Done (2026-03-30). Voice AI books appointments, answers policy questions, handles rejections naturally.
- **Deploy dashboard** (Vercel or Railway — currently local only)
- **Set `DASHBOARD_URL`** in Railway (after dashboard deployment, needed for Stripe checkout redirects)
- ~~SetupWizard Step 7 "Go Live"~~ — Done. Activate phone from wizard with area code input, provisioning spinner, success/error states
- UI/UX flow improvements (ongoing — finding issues through hands-on testing)
- ~~Vocabulary wiring~~ — Done. All dashboard components use `useVocabulary()` hook
- ~~Google Calendar sync~~ — Done. Real OAuth flow, token refresh, auto-sync on appointment create/update/delete/cancel
- ~~Outlook calendar sync~~ — Done. Microsoft Graph API, OAuth flow, token refresh, auto-sync on appointment create/update/delete/cancel
- ~~Jobber CRM integration~~ — Done. Bidirectional sync (push + pull), timestamp-based merge, OAuth flow, GraphQL API, webhook receiver, full sync
- ~~HubSpot CRM integration~~ — Done. Bidirectional sync, REST API (contacts + meetings), OAuth flow, webhook receiver with v3 signature verification, full sync
- ~~Square CRM integration~~ — Done. Bidirectional sync, REST v2 API (customers + bookings), OAuth flow, HMAC webhook verification, full sync
- ~~ServiceTitan CRM integration~~ — Done. Bidirectional sync, REST v2 API (customers + jobs), OAuth flow, ST-App-Key auth, full sync
- ~~Comprehensive sad path test coverage~~ — Done. 1,319 total tests (1,006 backend + 313 dashboard), 5W diagnostics in all error paths
- ~~Group 3 refactorings (production hardening)~~ — Done. All 24 items complete (see SUGGESTED_REFACTORINGS.md)
- ~~Knowledge base questionnaire~~ — Done (2026-03-30). 40 policy Q&A pairs across 9 categories, auto-save, document upload, embedding generation.
- ~~Voice AI fixes~~ — Done (2026-03-30). 8 critical fixes (tool response format, Zod relaxation, caller ID capture, timezone handling, natural error messages).
- ~~QA test suite~~ — Done (2026-03-30). `scripts/qa-live-test.py` — 29 tool calls, 88 assertions against live edge function.
- ~~Scheduling timezone fix~~ — Done (2026-04-01). BUG-059: `book_with_scheduling_atomic()` timezone regression fixed. Migration applied to production.
- ~~Voice AI phone/date/employee fixes~~ — Done (2026-04-01). BUG-060/061/062: Phone validation, dynamic date prompt, service-to-skill mapping.
- ~~Booking error handling~~ — Done (2026-04-01). BUG-063/064: Specific error codes (TIMESLOT_OCCUPIED, NO_SKILLED_EMPLOYEE, etc.) for better AI responses.
- ~~OAuth callback refactoring~~ — Done (2026-04-01). Generic `oauthCallbackFactory.ts` + shared `tokenManagement.ts` eliminate duplication across 4 CRM integrations.
- Database webhooks for n8n triggers
- Beta testing with DynaTire

### Railway Deployment Status (as of 2026-03-23)
- Backend live at `https://ai-sec-production.up.railway.app/`
- `railway.json` + `nixpacks.toml` configured (Node.js 20, Nixpacks builder)
- Single DB pool via `DATABASE_URL` (Supabase session-mode pooler)
- `FORCE ROW LEVEL SECURITY` migration applied to Supabase (20260323000000)
- Phone provisioning migration applied to Supabase (20260323000001)
- Graceful shutdown on SIGTERM/SIGINT
- All env vars configured in Railway (DB, JWT, OpenAI, Vapi secret, Stripe keys + webhook secret)
- Landing page at root URL, `/health` endpoint for monitoring
- Stripe webhook registered: `https://ai-sec-production.up.railway.app/billing/webhook`
- **Phone provisioning**: Automated via `POST /provisioning/activate` (creates Vapi assistant + phone number)
- `src/services/vapiClient.ts` — Vapi REST API client (template substitution + CRUD)
- `src/routes/provisioning.ts` — activate/deactivate/status endpoints
- SuperAdmin dashboard has "Activate Phone" button with area code input
- `VAPI_API_KEY` set in Railway
- Edge functions deployed to Supabase (vapi-tools v9), DB URL secrets updated
- Phone provisioned: +1 (630) 397-0194 on DynaTire (Vapi voice: Clara, LLM: OpenAI GPT-4o-mini)
- ~~Supabase pausing bug~~ — Resolved 2026-03-30. Edge functions now reachable.
- **Still needs**: Dashboard deployment, DASHBOARD_URL env var

### Phase 12: Scheduler, Assignments & Coverage Visibility (Complete)
- **12A — Repeatable Setup Wizard**: 7-step guided setup (Services, Resources, Employees, Shifts, Assignments, Review, Go Live), live coverage badges, phone activation on final step.
- **12B — Scheduler Views**: Staff swimlanes (24hr, zoom), resource columns, appointment list, calendar sub-view. Quick Book panel, Employee Day Focus panel.
- **12C — Skill Relationship Map**: Interactive 3-column mind map with click-to-connect/disconnect. BookOpen icon for skills, Cog for resources.
- **12D — Coverage Visibility**: `check_coverage_gaps()` RPC, coverage bars, status badges, `GET /coverage` endpoint.
- **12E — RAG Normalization Layer**: `shared/normalizeForEmbedding.ts` (gpt-4o-mini), `normalized_text` column, query normalization in edge functions.
- **12F — Stripe Lite**: Solo ($129/mo) + Growth ($279/mo), Stripe Checkout, webhook (3 events), subscription gate middleware (402).

### Additional Features (shipped with Phase 12)
- **Theme System**: 8 themes (light, dark, midnight, nord, sunset, forest, high-contrast, solarized). ThemeProvider + CSS custom properties + palette picker in sidebar.
- **Admin Tenant Reorder**: Drag-and-drop ordering with save/discard. `sort_order` column, `POST /tenants/reorder`.
- **Delete Confirmation**: Type-to-confirm modal for tenant deletion.
- **Tenant List Sync**: `tenantsVersion` counter in SessionContext keeps dropdown in sync with admin panel.

### Backlog (post-launch)
- **Automated Phone Provisioning**: Telnyx + Vapi auto-setup during onboarding. Manual provisioning works for first 10–20 customers.
- **Full Billing System**: Extends Stripe Lite with Professional tier ($449/mo), plan picker UI, Stripe Elements, 14-day trials, call limits, billing portal.
- **Business Intelligence & ROI**: Employee utilisation, service ROI, recommendations engine. Retention feature — not needed for launch.
- **Personal Resources**: `is_personal` flag on resources for mobile techs and service writers. Only needed for businesses without fixed stations.
- **Advanced Coverage Alerts**: Owner SMS, AI alternative time suggestions, missed revenue tracking, nightly coverage jobs.

## Design Session — March 24, 2026

A full UI/UX design session was completed. All decisions are documented in `docs/UI_UX_DESIGN.md`, `docs/DECISIONS.md`, and `docs/DESIGN_HANDOFF.md`. Do not second-guess these decisions without explicit instruction from Dale.

### Key changes that affect your work:

**Design session work items (all complete as of 2026-03-25):**
1. ~~Apply dark sidebar visual style~~ — Done. All components use CSS vars, all themes dark.
2. ~~Rebuild theme system~~ — Done. `--font-display`/`--font-body` in all 8 themes, dropdown switcher.
3. ~~Flip the scheduler~~ — Done. NewSchedulerView: rows=staff, cols=hours, 24hr, split-panel scroll sync, business hours shading, zoom.
4. ~~Staff quick profile card~~ — Done. Read-only, anchored, outside-click dismiss, skills as indented vertical list.
5. ~~Skills toggle~~ — Done. Hours mode (shift bar + appointments) / Skills mode (stacked skill-colored bars).
6. ~~Drag to reorder staff rows~~ — Done. Grip handles, save/discard, persists to localStorage per tenant.
7. ~~Rebuild analytics~~ — Done. 3 active metrics (booking data), 3 Phase 2 placeholders (Vapi).
8. ~~Remove Coverage Map~~ — Done. `ServiceCoverageView.tsx` deleted, zero references remain.

**Fonts locked:** Bebas Neue (`--font-display`) + DM Sans (`--font-body`). Universal. Use CSS variables only.

**Coverage Map removed:** Fully deleted. `ServiceCoverageView.tsx` removed. `CoverageBar` and `CoverageStatusBadge` primitives retained (used by SetupWizard, SkillMap, ResourceColumns).

**Analytics rebuilt:** Old version discarded. 6 metrics defined — 3 active from booking data (Busiest Hours, Return Rate, No-Show Pattern), 3 pending Vapi call log integration.

**Logo:** "Secretary HQ" (space between words).

**Philosophy:** We show data. They manage their business. No warnings, no grades, no opinions. See UI_UX_DESIGN.md Design Philosophy section.

