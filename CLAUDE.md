# SecretaryHQ — Multi-Tenant Voice AI Reception SaaS

## Project Overview
Multi-tenant AI receptionist for service businesses (tire shops, salons, auto shops, trades, fitness, food & beverage). Inbound calls → voice AI books appointments, answers policy questions via RAG, syncs with external calendars. **HIPAA verticals (medical, dental, chiropractic, optometry, veterinary) are permanently excluded** — they never appear in templates, adapters, UI, or copy.

History of completed phases, retired migrations, and resolved bug sweeps lives in `RESOLVED.md`.

## What's in flight
See `docs/CURRENT_STATUS.md` → "What's in flight" for the full list. Two persistent items today:
- **Telnyx PSTN ticket** (external) — blocking voice validation
- **`DASHBOARD_URL` env var** unset on Railway (user) — blocking Stripe/OAuth redirects

`docs/TODO.md` and `NEEDS-REFACTORING.md` use a marker convention: `IN FLIGHT (external | user | prod-apply | decision pending | validation pending)`. No marker = pickable today.

## Framework Migrations
See `docs/FRAMEWORK_MIGRATIONS.md`. Status:
1. **Voice orchestrator: Vapi → LiveKit Agents** — Done 2026-04-27 (`661d21d`). Telnyx `+1-630-937-9478` → SIP Connection `livekit-outbound` (ID `2945038451784812111`) → dispatch rule `SDR_if97ky4Zf7e6` → Railway service `ai-sec-agent` (worker `AW_vPmGExrgTeGn`). **IN FLIGHT (external)** — awaiting first live call to confirm carrier propagation (`docs/TICKET_SUPPORT.md`).
2. **Tool runtime: Supabase Edge Functions → Fastify** — Done. 10 tools in `src/routes/agentTools.ts`; booking gated on `isValidPhone`. Edge functions deleted in `661d21d`.
3. **TTS provider: OpenAI → xAI Grok** — Code-complete 2026-05-01 (`f6cc1d4`); fallback wired through 2026-05-03 (`6488dc4`). `agent/src/grokTTS.ts` is primary; `runFallback()` uses OpenAI TTS so a Grok outage / missing `XAI_API_KEY` never produces dead-air. **IN FLIGHT (validation pending)** — blocked on Telnyx unblock above.

## Architecture
- **Voice**: Telnyx → LiveKit Cloud → LiveKit Agent (Node) → Deepgram (STT) + OpenAI (LLM) + xAI Grok (TTS) → Fastify `/agent-tools/*`
- **Backend**: Fastify (26 route modules under `src/routes/`) → Postgres (Railway)
- **Agent worker**: `agent/` package on Railway as `ai-sec-agent`. Single worker per tenant; tenant_id flows in via SIP dispatch metadata.
- **Dashboard**: Next.js 14 (App Router) + Tailwind + TS
- **Database**: Postgres + pgvector, RLS multi-tenancy, atomic booking RPCs
- **Async**: Mostly inline in routes (post-call summaries, calendar sync, SMS triggers). `src/workers/reminderScheduler.ts` polls `reminder_schedules` every 60s.
- **Auth**: JWT (8h, auto-logout on 401), bcrypt

## Tech Stack
- **Backend**: Fastify 4, bcrypt, zod, pg
- **Frontend**: Next.js 14, React 18, Tailwind 3.4, Lucide, react-big-calendar
- **Voice agent**: LiveKit Agents (Node), `@livekit/agents-plugin-{deepgram,openai}`, `livekit-server-sdk`
- **DB**: PostgreSQL + pgvector (ankane/pgvector Docker)
- **Voice stack**: Telnyx + LiveKit Cloud + Deepgram Nova-3 + OpenAI GPT-4o-mini + xAI Grok TTS (default voice `ara`; OpenAI TTS retained as fallback)
- **Testing**: Vitest (backend + dashboard), Playwright (e2e), `scripts/qa-live-test.py` (29 tool calls, 88 assertions)

## Key Directories
- `/src` — Fastify backend (slim `index.ts` + 26 route modules)
- `/src/routes` — auth, tenants, appointments, customers, employees, users, shifts, resources, services, mappings, skills, calendar, knowledge, analytics, vocabulary, billing, provisioning, jobber, hubspot, square, servicetitan, voice, communications, reminders, versionHistory, agentTools
- `/src/routes/routeHelpers.ts` — `sendValidationError`, `sendNotFound`, `sendSuccess`, `sendConflict`, `assertRowAffected`, `requireValidUUID`, `parseDateRange`, `parsePagination`
- `/src/services` — Flat files: telnyxNumbers, telnyxSms, googleCalendar, outlookCalendar, calendarSync, syncOrchestrator, nameUtils, oauthCallbackFactory, oauthStateJwt, tokenManagement, plus the four CRM client/sync pairs (jobber, hubspot, square, servicetitan). Subdirs below.
- `/src/services/communications/` — CommunicationService + email/sms/appointment services + Handlebars templates + ProviderRegistry + Twilio/Mock adapters. Consent-gated.
- `/src/services/reminders/` — ReminderService schedules; reminderProcessor delivers via CommunicationService; reminderRepository handles DB.
- `/src/services/tenants/` — `DatabaseTenantConfigService` (dormant; agent worker now reads `/agent-tools/tenant-config` per call instead).
- `/src/database/index.ts` — Canonical pool (lazy singleton w/ deadlock-prevention timeouts: `statement_timeout=30000`, `lock_timeout=10000`, `idle_in_transaction_session_timeout=60000`, `max=10`). `createWithTenantClient(pool)` returns the per-request RLS-scoped helper injected into routes.
- `/src/workers/reminderScheduler.ts` — 60s tick, batches up to 100. Runs in prod or when `ENABLE_REMINDER_SCHEDULER=true`.
- `/src/templates/` — 5 industry YAML bundles (automotive_v1, salon_v1, mobile_tire_v1, auto_bays_v1, ai_platform_v1). No HIPAA verticals.
- `/src/types/` — Shared TS interfaces: ConsentRecord, OptOutRecord, ReminderSchedule/Data/AppointmentForReminder, RecordVersion/VersionComparison, VoiceSession/CallSummary/CustomerContext.
- `/src/middleware.ts` — `withHandler`, `tenantMiddleware`, `registerJwtAuthHook`, `generateToken`, `AppError`, `requireTenantId`, `requireAuth`, `requireSuperAdmin`, `logEvent/Warning/Error`. JWT preHandler (PUBLIC_ROUTES bypass + password-rotation check) lives here. `tenantMiddleware` enforces tenant isolation: any user-supplied `tenant_id` (query or body) that doesn't match the JWT's `tenant_id` is rejected with 403 unless the caller is super-admin (added 2026-05-06 after the multi-tenant-isolation probe found cross-tenant data leak via `?tenant_id=` override). Use `requireSuperAdmin` (not `requireAuth`) on `/tenants/*` and other cross-tenant admin operations.
- `/agent` — LiveKit Agents worker (Node). Modules: `index`, `prompt`, `toolsClient`, `sessionContext`, `tools` (10 tools), `fallback` (OpenAI TTS dead-air guard).
- `/dashboard` — Next.js (components/, lib/, app/). Landing at `/`, dashboard at `/dashboard`.
- `/supabase/migrations` — 86 SQL migrations.
- `/supabase/functions` — **Empty** (Vapi edge functions deleted in `661d21d`).
- `/shared` — Cross-runtime: `getEmbedding.ts`, `scheduling.ts`
- `/supabase/seed.sql` — Platform admin + DynaTire tenant
- `/scripts` — `qa-live-test.py`, `verify-claude-md.ts` drift detector
- `/docs` — Architecture, setup, plans, references
- `/certs` — Self-signed HTTPS certs for local dev

## Development
- Bootstrap: `npm run bootstrap` (deps + DB + migrations + seed + tests)
- Migrate: `npm run db:migrate [-- "postgres://..."]`
- Seed: `npm run db:seed [-- "postgres://..."]`
- Start: `npm start` (Dashboard https://localhost:4000, Backend https://localhost:4001)
- Test: `npm test` (backend), `cd dashboard && npm test`, `cd dashboard && npx playwright test` (e2e)
- Login: `daledemott@gmail.com` / `password`
- Super-admin tenant: `00000000-0000-0000-0000-000000000000`
- DynaTire (PoC) tenant: `f234e471-0e60-4163-86c9-93cfd9338e3a`
- Docker DB on port 5433

## Database Key Details
- RLS via `app.current_tenant_id` context var. `FORCE ROW LEVEL SECURITY` on all 20 RLS-enabled tables.
- Single DB pool via `DATABASE_URL` (Supabase managed; no separate `api_user` pool).
- Admin bypass policies on `tenants`, `users`, `business_templates` for cross-tenant ops with no tenant context.
- Audit trigger `fn_audit_trigger` is `SECURITY DEFINER` to bypass RLS for internal logging.
- **`employee_schedule` is the single source of truth** for shifts: `(tenant_id, employee_id, shift_date, start_time, end_time, is_off)`. The earlier weekly-pattern `employee_shifts` table was dropped 2026-04-30. Setup wizard collects a weekly grid in form state and posts it to `POST /shifts/expand-weekly` (`expandWeeklyToSchedule()` in `src/services/expandWeeklyToSchedule.ts`) — fans the pattern into `employee_schedule` for 4 weeks. Owners extend forward via the Schedule tab's copy-week button. API: `GET/POST /shifts/overrides`.
- **Booking RPCs** (both read `employee_schedule` directly):
  - `book_appointment_atomic()` — 7-layer constraint check + past-time rejection + employee-shift coverage (rejects with `EMPLOYEE_NOT_SCHEDULED` when no shift in `employee_schedule` covers the requested time) + service-aware skill+resource enforcement (when `p_service_id` is provided, prefers `service_employee` / `service_resource` mapping tables as the authoritative gate; falls back to `services.required_skills` / `required_resources` array check only when the mapping is empty for that service) + fuzzy service match. There is no separate tenant-level "business hours" config — the building's open window is implicitly the union of staff shifts.
  - `book_with_scheduling_atomic()` — production booking RPC; date-based shift validation, cross-midnight night shifts, specific error codes (`TIMESLOT_OCCUPIED`, `NO_SKILLED_EMPLOYEE`, `EMPLOYEE_NOT_SCHEDULED`, `NO_AVAILABILITY`, `INVALID_PARAMS`)
  - Both protected by GiST exclusion constraints (`appointments_no_resource_overlap`, `appointments_no_employee_overlap`) — race-safe under READ COMMITTED.
- `get_effective_shifts()` / `get_effective_shifts_bulk()` — return rows from `employee_schedule`. Bulk variant powers the scheduler.
- `check_availability_with_tz()` — timezone-aware availability lookup
- `check_coverage_gaps()` — coverage analysis powering the dashboard bars
- `search_tenant_docs()` — cosine similarity over pgvector embeddings
- All entity IDs are UUID. Polymorphic assignment uses `p_assignment_id` UUID.

## Build Principles
Durable rules-of-engagement that override "build for the future":

- **Test it or delete it.** Code that can't be exercised against a real external surface (real CRM, real provider API, real billing event) doesn't ship. Mocked-API tests prove the mock works, not the integration. Origin: deleted 21 dormant CRM adapters 2026-05-02 (none had ever touched a real CRM; two were HIPAA-vertical violations).
- **Build for real customers, not the imagined Pro tier.** No provider integrations, billing tiers, dashboard sections, or service layers because we *might* need them. Wait for a beta customer or sales call that names the need.
- **Working flat code beats a dormant abstraction.** When a "shared interface" or "registry" exists alongside the working flat-file equivalent, the flat files are the source of truth. Extract a shared shape after the third or fourth real consumer asks for it.
- **HIPAA verticals are permanently excluded.** Medical, dental, chiropractic, optometry, veterinary. Anything that surfaces them gets deleted on sight.

## Code Conventions

**Dashboard**
- Single primary nav bar: Primary tabs (Home, Schedule, Customers, Calls) always visible; Advanced tabs (Services & Resources, Staff & Shifts, AI & Knowledge) shown for owners/admins only. Front-desk-only users see Primary tabs only and are snapped back to Home if they hit a restricted tab via a stale URL.
- Components: List+Detail pane pattern (sidebar list, detail right). Large views split into sub-components.
- UI primitives in `dashboard/components/ui/` — Button (`isLoading`), Card, Input, Select, Modal (Escape/backdrop close), Badge, Toast (5s err/warn, 3s success/info, max 5), `ConfirmModal` + `useConfirm()` for destructive actions.
- API client: `dashboard/lib/api.ts` with namespaced `Api.{resource}.{action}()`, fully typed returns. Shared `forceLogout()` + `checkAuthFailure()`.
- Entity types: `dashboard/lib/types.ts`.
- Session: `SessionContext` + `useActiveTenantId()`. No `overrideTenantId` prop drilling.
- `useFormState<T>()` for form state + dirty tracking.
- Tab state synced to URL (`?tab=schedule`).
- **Zero TypeScript errors** (`npx tsc --noEmit`).

**Backend**
- Slim `index.ts` registers 26 route modules. Tenant-scoped routes use `withTenantClient()` for RLS.
- All mutations: Zod-validated, response shape `{ success, error?, details? }`, `assertRowAffected()` returns 404 on zero-row UPDATE/DELETE (never silent success).
- Production env validation: refuses to start without `DATABASE_URL`, `JWT_SECRET`, `OPENAI_API_KEY`, `STRIPE_SECRET_KEY`.
- Graceful shutdown on SIGTERM/SIGINT (closes Fastify + drains pool — required for Railway).
- Fetch timeouts on OpenAI calls (10s embeddings, 15s normalization) via AbortController.

**Agent tools**
- `/agent-tools/*` responses: `{ success: true, result }` or `{ success: false, error }` at status 200 — LLM relays both shapes naturally. Auth via `x-agent-secret` header.
- `SYNC_TEST_RECORDER=1` (off by default) flips on an in-memory ring buffer in `syncOrchestrator.ts` that records every appointment + customer sync dispatch (provider, action, tenantId, entityId, ts). Exposed via `GET /agent-tools/_test/sync-events` (read) and `DELETE /agent-tools/_test/sync-events` (clear), both gated by the env var AND the existing agent-secret. Used exclusively by `dashboard/e2e/calendar-sync.spec.ts` to assert the orchestration contract without real Google/Outlook/CRM credentials. Strict opt-in — anything other than the literal string `"1"` keeps it disabled, so a stray prod request can't enumerate sync activity.

**Observability**
- Pino → stdout (Railway live-tail) + Better Stack (when `BETTER_STACK_TOKEN` is set). Per-request enrichment: `service`, `env`, `tenant_id`, `call_id`. `logEvent`/`logWarning`/`logError` helpers in `middleware.ts` add structured fields.
- Prometheus-style metrics at `GET /metrics`, gated by `METRICS_TOKEN` env var (returns 404 when unset, 401 on missing/wrong Bearer). In-process registry in `src/services/metrics.ts` — no external deps, hard cap at 1000 series per metric (overflow funnels to `overflow="true"`). Pre-declared metrics: `http_requests_total{route,method,status}` + `http_request_duration_ms` (histogram, same labels), `booking_attempts_total{outcome,source}`, `tool_calls_total{tool,outcome}`, `sync_dispatches_total{provider,entity,action}`, `errors_total{event}`. Auto-emitted by Fastify `onResponse` hook (HTTP) and inside `logError` (errors); domain counters wired into appointments + agentTools + syncOrchestrator.

**Tests**
- All tests cover happy + sad paths with 5W diagnostic comments (WHO/WHAT/WHEN/WHERE/WHY).
- Mock helpers in `src/services/test-utils-mock.ts`.

## Migrated, Not Yet Wired
Service layers that exist but lack production callers. **Each is on borrowed time** — under Build Principles, anything that can't be tested against a real surface and isn't requested by a real customer resolves to *delete*.

- **`src/services/tenants/`** — `DatabaseTenantConfigService` has no caller. Per-call `/agent-tools/tenant-config` lookup serves the underlying need. Delete by default unless that lookup shows up as a hot spot worth caching.
- **`src/types/`** — `ConsentRecord` + `OptOutRecord` types and tables exist; no consent management UI yet.

## Known Issues
- OpenAI API quota needs monitoring (GPT-4o-mini for LLM + embeddings).
- Voice AI filler phrases ("Absolutely!", "Great!") still slip through occasionally despite prompt engineering.

## Project Status
**Phase 13 (Production Readiness) in progress.** 1,733 backend + 617 dashboard = 2,350 tests passing (verified 2026-05-08; 0 skips). 81 agent tests, 58 Playwright e2e (1 skipped), 29 live QA tool calls. Zero TS errors across backend / agent / dashboard. Detailed coverage breakdown — including V8 percentages and e2e workflow inventory — lives in `docs/TEST_COVERAGE.md`; refresh it whenever a commit measurably moves test counts or coverage.

Remaining blockers: deploy dashboard, set `DASHBOARD_URL`, beta test with DynaTire. Full task list and post-launch backlog in `docs/TODO.md`. Phases 1–12 history in `RESOLVED.md`.

## Railway Deployment
- Backend: `https://ai-sec-production.up.railway.app/` (`/health` endpoint, landing at root)
- `railway.json` + `nixpacks.toml` configured (Node 20, Nixpacks)
- Single DB pool via `DATABASE_URL` (Supabase session-mode pooler)
- All env vars set: DB, JWT, OpenAI, Telnyx (API key + SIP connection ID `2945038451784812111`), Stripe (keys + webhook secret), AGENT_SECRET, LIVEKIT_*, DEEPGRAM_API_KEY
- Stripe webhook: `https://ai-sec-production.up.railway.app/billing/webhook` (3 events)
- Phone: `+1-630-937-9478` (Telnyx). Provisioning automated via `POST /provisioning/activate` (search → purchase → assign to SIP Connection `livekit-outbound`). SuperAdmin dashboard has "Activate Phone" button.
- **Open**: `DASHBOARD_URL` env var on backend Railway service; first live call to confirm carrier propagation (`docs/TICKET_SUPPORT.md`).
