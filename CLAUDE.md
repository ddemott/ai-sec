# SecretaryHQ - Multi-Tenant Voice AI Reception SaaS

## Project Overview
Multi-tenant AI receptionist platform for service businesses (tire shops, salons, auto shops, trades, fitness, food & beverage). Handles inbound calls via voice AI, books appointments, answers policy questions via RAG, and syncs with external calendars. HIPAA verticals (medical, dental, chiropractic, optometry, veterinary) are permanently excluded — they do not appear anywhere in the UI.

## Framework Migrations

See `docs/FRAMEWORK_MIGRATIONS.md` for the full index. Summary:
1. **Voice orchestrator: Vapi → LiveKit Agents** — Done (2026-04-27, commit `661d21d`). Vapi account deleted, all Vapi code removed. Telnyx number `+1-630-937-9478` → SIP Connection `livekit-outbound` (ID `2945038451784812111`) → LiveKit dispatch rule `SDR_if97ky4Zf7e6` → Railway service `ai-sec-agent` (worker `AW_vPmGExrgTeGn` registered). Awaiting first live call to confirm carrier-side propagation; see `docs/TICKET_SUPPORT.md` (Telnyx ticket #2850682).
2. **Tool runtime: Supabase Edge Functions (Deno) → Fastify (Node)** — Done. 10 voice AI tools (8 original + 2 OTP) in `src/routes/agentTools.ts`. All booking routes gated on `isValidPhone`. Edge function `supabase/functions/vapi-tools/` deleted in `661d21d`.
3. **TTS provider: OpenAI TTS → xAI Grok (native in agent)** — Pending. Agent currently uses `openai.TTS` at `agent/src/index.ts:122,150`. Phase 4 swaps to a custom `GrokTTS` class hitting `https://api.x.ai/v1/tts` directly. The earlier Vapi custom-voice proxy at `src/routes/tts.ts` was deleted in `661d21d` along with everything else Vapi-shaped.

## Architecture (current)
- **Voice AI**: Telnyx (carrier + SIP trunk) -> LiveKit Cloud (SIP ingress) -> LiveKit Agent worker (Node) -> Deepgram (STT) + OpenAI (LLM/TTS) -> Fastify `/agent-tools/*`
- **Backend API**: Node.js / Fastify (25 route modules under src/routes/) -> Postgres (Railway deployment)
- **Agent worker**: `agent/` package, deployed on Railway as `ai-sec-agent`. Single worker serves every tenant; tenant_id flows in via SIP dispatch metadata.
- **Dashboard**: Next.js 14 (App Router) + Tailwind CSS + TypeScript
- **Database**: Postgres with pgvector, RLS multi-tenancy, atomic booking RPCs
- **Async Workers**: Mostly inline in Fastify routes (post-call summaries, calendar sync, SMS push triggers). Background polling worker for appointment reminders lives in `src/workers/reminderScheduler.ts` (60s tick, multi-channel delivery via CommunicationService).
- **Auth**: JWT-based authentication (8h expiry, auto-logout on 401), bcrypt password hashing

## Key Directories
- `/src` - Fastify backend (slim index.ts entry, 25 route modules under src/routes/)
- `/src/routes` - Modularized route handlers (auth, tenants, appointments, customers, employees, shifts, resources, services, mappings, skills, calendar, knowledge, analytics, vocabulary, billing, provisioning, jobber, hubspot, square, servicetitan, voice, communications, reminders, versionHistory, agentTools)
- `/src/routes/routeHelpers.ts` - Shared route utilities (sendValidationError, sendNotFound, sendSuccess, sendConflict, assertRowAffected, requireValidUUID, parseDateRange, parsePagination)
- `/src/services` - Service layer. Flat files at root: telnyxNumbers.ts [provisioning], telnyxSms.ts [OTP], googleCalendar.ts, outlookCalendar.ts, calendarSync.ts, syncOrchestrator.ts, nameUtils.ts, oauthCallbackFactory.ts, tokenManagement.ts, plus the legacy CRM clients (jobberClient/Sync, hubspotClient/Sync, squareClient/Sync, servicetitanClient/Sync). Subdirectories add migrated layers — see `/src/services` subdirs below.
- `/src/services/crm/` - 20+ CRM adapter classes (GoHighLevel, Acuity, Booksy, Calendly, Mindbody, Pipedrive, Salesforce, ServiceTitan, Vagaro, Zenoti, Zoho, etc.) with a `BaseCRMAdapter` interface and registry factory `createCRMAdapter(provider, config)`. **Migrated from ai-secretary, not yet wired to any routes.** Will eventually replace the flat legacy clients above.
- `/src/services/communications/` - Multi-channel comms engine. CommunicationService orchestrator + emailService, smsService, appointmentService, emailTemplates (Handlebars), ProviderRegistry, TwilioAdapter, MockAdapter, TelephonyProvider.interface. Consent-gated via ConsentService, usage-tracked via UsageTrackingService.
- `/src/services/reminders/` - Appointment reminder pipeline. ReminderService schedules on appointment create; reminderProcessor delivers via CommunicationService; reminderRepository handles DB CRUD. Worker pulls from `reminder_schedules` table.
- `/src/services/tenants/` - TenantConfigService (in-memory + DB-backed). The class is still dormant (no callers), but the *need* it was meant to address is now solved — agent worker fetches `name`/`timezone` per call via `/agent-tools/tenant-config` (2026-05-01).
- `/src/services/usage/` - UsageTrackingService stub. Records SMS/calls/emails in memory only; no DB persistence, no Stripe sync yet (TODO).
- `/src/database/index.ts` - Lazy-init singleton pool. Bridges native `withTenantClient(pool)` to a `DatabaseService` interface used by communications/reminders/workers. Invisible glue; no routes touch it.
- `/src/workers/reminderScheduler.ts` - Background job processor. Polls every 60s, batches up to 100 reminders, runs in prod or when `ENABLE_REMINDER_SCHEDULER=true`. Started in `index.ts`, stopped on SIGTERM.
- `/src/templates/` - 5 industry YAML bundles (automotive_v1, salon_v1, mobile_tire_v1, auto_bays_v1, ai_platform_v1). HIPAA verticals are permanently excluded — there is no medical_v1. Each bundle: prompt template, first message, voice ID, field labels, example services. Loaded by tenants provisioning route.
- `/src/types/` - Shared TS interfaces. ConsentRecord, OptOutRecord (GDPR/TCPA), ReminderSchedule/ReminderData/AppointmentForReminder, UsageRecord + Provider enum, RecordVersion/VersionComparison, VoiceSession/CallSummary/CustomerContext.
- `/src/middleware.ts` - Shared middleware (withHandler decorator, tenantMiddleware, AppError, requireTenantId, requireAuth, logEvent/logWarning/logError)
- `/agent` - LiveKit Agents worker (Node). Entry `src/index.ts`, prompt `src/prompt.ts`, tool client `src/toolsClient.ts`, session context `src/sessionContext.ts`, tools `src/tools.ts` (10 tools wired to `/agent-tools/*`)
- `/dashboard` - Next.js frontend (components/, lib/, app/) — landing page at `/`, dashboard app at `/dashboard`
- `/supabase/migrations` - 80 SQL migrations (schema, RLS, RPCs, coverage, billing, provisioning, CRM integrations, timezone fix, specific booking errors, employee_schedule, night shifts, get_effective_shifts_bulk, phone_verifications, telnyx_provisioning, RPC + table cleanup for the employee_shifts retirement)
- `/supabase/functions` - **Empty.** All Vapi edge functions deleted in commit `661d21d`.
- `/shared` - Cross-runtime shared code (getEmbedding.ts, scheduling.ts)
- `/supabase/seed.sql` - Seed data (platform admin + DynaTire tenant)
- `/scripts` - Automation (knowledge ingestion, `qa-live-test.py` QA suite)
- `/docs` - Architecture, setup, plans, and reference docs
- `/certs` - Self-signed HTTPS certificates for local dev

## Tech Stack
- **Backend**: Fastify 4.x, bcrypt, zod, pg (Node PostgreSQL driver)
- **Frontend**: Next.js 14, React 18, Tailwind CSS 3.4, Lucide icons, react-big-calendar
- **Voice agent**: LiveKit Agents (Node), `@livekit/agents-plugin-deepgram`, `@livekit/agents-plugin-openai`, `livekit-server-sdk`
- **Database**: PostgreSQL + pgvector (ankane/pgvector Docker image)
- **Testing**: Vitest (backend + dashboard), Playwright (e2e)
- **Voice stack**: Telnyx (carrier + SIP trunk), LiveKit Cloud (orchestrator), Deepgram Nova-3 (STT), OpenAI GPT-4o-mini (LLM), OpenAI TTS (xAI Grok TTS planned for Phase 4)
- **QA**: `scripts/qa-live-test.py` — 29 tool calls, 88 assertions against `/agent-tools/*` Fastify routes

## Development
- Bootstrap: `npm run bootstrap` (installs deps, starts DB, applies migrations, seeds, runs tests)
- Migrate only: `npm run db:migrate` or `npm run db:migrate -- "postgres://..."` (cloud-ready)
- Seed only: `npm run db:seed` or `npm run db:seed -- "postgres://..."` (demo data, safe to re-run)
- Start: `npm start` (Dashboard: https://localhost:4000, Backend: https://localhost:4001)
- Test backend: `npm test`
- Test dashboard: `cd dashboard && npm test`
- Test edge functions: `deno task test --no-check`
- Login: daledemott@gmail.com / password
- E2e tests: `cd dashboard && npx playwright test`
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
- `book_with_scheduling_atomic()` RPC: Production booking RPC using `employee_schedule` for shift validation (date-based only, no weekly pattern fallback), night shift support (cross-midnight), specific error codes (TIMESLOT_OCCUPIED, NO_SKILLED_EMPLOYEE, EMPLOYEE_NOT_SCHEDULED, NO_AVAILABILITY, INVALID_PARAMS)
- `employee_schedule` table: date-specific employee schedules (replaces weekly patterns in UI). Both Working Hours and Front Desk scheduler read from this table. API: `GET/POST /shifts/overrides`
- `get_effective_shifts()` and `get_effective_shifts_bulk()` RPCs: return entries from `employee_schedule` table (which IS the schedule). Date-based scheduling only.
- `get_effective_shifts_bulk()` RPC: returns effective shifts for all employees in a date range (single query) — used by scheduler for efficient bulk loading
- `employee_schedule` is the only schedule storage. Date-specific rows
  (tenant_id, employee_id, shift_date, start_time, end_time, is_off).
  Booking RPCs (`book_appointment_atomic`, `book_with_scheduling_atomic`,
  `check_availability_with_tz`, `check_coverage_gaps`,
  `get_effective_shifts`) all read this table directly. The setup
  wizard collects a weekly grid in form state and posts it to
  `POST /shifts/expand-weekly`, which fans the pattern into
  `employee_schedule` for the next 4 weeks via
  `expandWeeklyToSchedule()` (`src/services/expandWeeklyToSchedule.ts`).
  Owners then extend coverage forward via the Front Desk scheduler's
  copy-week button. The earlier `employee_shifts` weekly-pattern table
  was dropped 2026-04-30 (NEEDS-REFACTORING #4 Phase 2).
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
- Fastify: slim index.ts registers 25 route modules; all tenant-scoped routes use `withTenantClient()` for RLS
- Shared route helpers in `src/routes/routeHelpers.ts`: `sendValidationError()`, `sendNotFound()`, `sendSuccess()`, `sendConflict()`, `assertRowAffected()`, `requireValidUUID()`, `parseDateRange()`, `parsePagination()`
- All route mutations validated with Zod schemas (auth, tenants, employees, shifts, resources, services, skills, calendar, appointments, customers)
- All mutation routes use `assertRowAffected()` guard — zero-row UPDATE/DELETE returns 404, never silent success
- All error responses use `{ success: false, error: string, details?: any }` format
- Name utilities in `src/services/nameUtils.ts`: `splitName()`, `joinName()`, `slugify()`, `buildDisplayName()`
- Production env validation: server refuses to start if DATABASE_URL, JWT_SECRET, OPENAI_API_KEY, or STRIPE_SECRET_KEY are missing
- `/agent-tools/*` responses use `{ success: true, result }` or `{ success: false, error }` with status 200 — the LLM relays both shapes naturally. Auth via `x-agent-secret` header.
- Edge function errors return plain `"ERROR: ..."` strings (not nested JSON) so the LLM can relay them naturally
- Edge function DB pool: lazy init, pool size 2, 5s connection timeout via `connectWithTimeout()`
- Fetch timeouts on all OpenAI API calls (10s embeddings, 15s normalization) via AbortController
- Graceful shutdown: SIGTERM/SIGINT handlers close Fastify + drain DB pool (required for Railway deploys)
- `ConfirmModal` component + `useConfirm()` hook for all destructive actions (replaces browser `confirm()`)
- Toast system: dismissable, 5s for errors/warnings, 3s for success/info, max 5 visible
- All tests include happy + sad paths with 5W diagnostic comments (WHO/WHAT/WHEN/WHERE/WHY)
- Tab state synced to URL query params (`?tab=schedule`) — shareable links, browser back/forward works
- Scheduler view tabs (Staff/Resources/List/Calendar) visible from all views including Staff timeline

## Migrated, Not Yet Wired
Several service layers exist in the codebase but are not yet exposed via routes or fully connected. Reading these dirs may suggest features that don't actually function end-to-end:
- **`src/services/crm/`** — 20+ adapter classes for booking platforms (Mindbody, Vagaro, Acuity, Calendly, Salesforce, etc.). No `routes/crm.ts` exists; the registry factory has no callers. Will eventually replace the legacy flat clients (`jobberClient.ts`, `hubspotClient.ts`, `squareClient.ts`, `servicetitanClient.ts`).
- **`src/services/usage/UsageTrackingService.ts`** — In-memory only. Does not persist to DB, does not feed Stripe billing.
- **`src/services/tenants/`** — `DatabaseTenantConfigService` is implemented but no caller routes through it. The agent worker no longer hardcodes DynaTire — a per-call `/agent-tools/tenant-config` lookup reads `tenants` directly (2026-05-01). Decision pending: either route the agent through `DatabaseTenantConfigService`, or delete the class.
- **`src/types/`** — `ConsentRecord` and `OptOutRecord` have full type shapes and DB tables, but no consent management UI exists in the dashboard yet.

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
### April 24, 2026 UX Review & Polish Batch
A full UX review of the dashboard identified 20 items across P0-P3. 14 shipped across commits `dac97cb`, `91c9903`, `7042a8e`, `3954d4c` + supporting refactors (`2f74991`). Deferred items need design input (admin-mode color, theme-selector placement, first-run nav callout) or bigger investment (skeleton screens, Remember me refresh tokens).

**P0 trust fixes:**
- Visible load-error banner + retry on `DashboardHome` — no more empty dashboards on API failure. Uses `Promise.allSettled` so partial data still renders.
- Login copy stripped of developer-internal terminology ("Multi-Tenant Management Console", "Ready for Live Integration", "Is the backend server running?") — now reads as a customer product.
- `ErrorBoundary` shows a friendly message in production; raw `Error.message` only renders when `NODE_ENV !== 'production'`.

**P1 affordances:**
- Login: create-account link, password show/hide toggle, `autoComplete="username"`, label/input a11y wiring.
- Today's Schedule empty state now offers CTAs ("View this week", "See staff shifts" — latter hidden for solo operators).
- Unanswered-questions badge bubbles up to the Back Office mode tab so Front-Desk-only users see pending items.
- Fitts's Law: entire Today's Schedule card header is a single large click target; chevron stays as affordance.
- Icon-only buttons in `OutlookLayout` top bar carry `aria-label` (tooltips don't work on touch / screen reader). Profile button has `aria-expanded` + `aria-haspopup`.
- `ErrorBoundary` has a "Reload page" escape hatch for persistent errors.

**P2 polish:**
- Tenant switcher dropdown uses CSS vars instead of hardcoded `bg-white dark:bg-[#222]` — now themes correctly across all 8 palettes.
- Quick-actions grid: `md:grid-cols-3` → `md:grid-cols-2 lg:grid-cols-3` so cards breathe at tablet widths.
- "Setup Assistant" quick action label corrected to "Services & Resources" (the tab it actually opens — wizard button kept its "Open Setup Assistant" label).
- User-facing "tenant" vocabulary replaced with "business" in error messages. `vocabulary-guard.test.ts` prevents regression.

**Backend hardening:**
- Startup warnings extracted from `index.ts` into `src/services/envWarnings.ts` (pure function, 10 unit tests). Added a warning for missing `TELNYX_API_KEY` so OTP misconfig is visible at boot instead of mid-call.

**Test coverage added:** +50 dashboard tests (LoginView, DashboardHome, ErrorBoundary, vocabulary-guard), +10 backend tests (envWarnings).

### April 23, 2026 Phone Verification (SMS OTP)
- New table `phone_verifications` (tenant_id, phone, code_hash, expires_at, attempt_count, verified_at). RLS + FORCE RLS. Migration `20260423000000_phone_verifications.sql`.
- New service `src/services/telnyxSms.ts` — Telnyx Messaging API wrapper (single fetch, no SDK) + `generateVerificationCode(digits)` using `crypto.randomInt` for unbiased codes.
- New agent tools: `POST /agent-tools/send-verification-code` (rate-limited: 3/phone/hour, 100/tenant/day) and `POST /agent-tools/verify-phone-code` (5 tries max, 10-min TTL, bcrypt-hashed codes).
- SMS body locked: `Your SecretaryHQ verification code is: 123456. Reply STOP to opt out.` (TCPA opt-out required).
- Booking routes (`book-appointment`, `book-with-scheduling`) now gate on `isValidPhone(args.phone)`. Invalid phone → route returns the ask-for-phone message; the LLM reads it, asks the caller verbally, then kicks into the OTP flow. Valid caller-ID phone skips verification entirely.
- 12 new tests in `agentTools.test.ts` (7 send-verification-code, 5 verify-phone-code), 7 in `telnyxSms.test.ts`, 2 book-appointment gate tests, 1 book-with-scheduling gate test.
- **System prompt TODO (Phase 3):** when `book-appointment` or `book-with-scheduling` returns "I'll need a good phone number" → call `send-verification-code(phone)` → read its `message` to the caller → on spoken code, call `verify-phone-code(phone, code)` → on success, retry the booking tool with the verified phone.

### April 12, 2026 Improvement Hardening
- Employee update route missing `AND tenant_id` in WHERE clause — cross-tenant employee updates were possible. Fixed by adding tenant_id scoping + assertRowAffected guard.
- Zero-row mutation guards added to employees, customers, appointments, tenants, knowledge, resources, services routes — all previously returned `{ success: true }` when UPDATE/DELETE affected 0 rows (silent no-op).
- Shared route helpers extracted to `src/routes/routeHelpers.ts` — eliminates duplicated validation/error/pagination boilerplate across 25 route modules.
- `nameUtils.ts` extended with `slugify()` (skill/service name normalization) and `buildDisplayName()` (employee name composition).

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
Phases 1–12 complete. Phase 13 (Production Readiness) in progress. 1,493 backend tests + 498 dashboard tests = 1,991 total passing (verified 2026-04-30 against real DB + dashboard, 2 documented skips). 19 Playwright e2e tests. 29 live QA tool-call tests (88 assertions). Zero TypeScript errors.

### Remaining Work

See `docs/TODO.md` for the unified task list. Key blockers: deploy dashboard, set DASHBOARD_URL, beta test with DynaTire.

### Railway Deployment Status (as of 2026-03-23)
- Backend live at `https://ai-sec-production.up.railway.app/`
- `railway.json` + `nixpacks.toml` configured (Node.js 20, Nixpacks builder)
- Single DB pool via `DATABASE_URL` (Supabase session-mode pooler)
- `FORCE ROW LEVEL SECURITY` migration applied to Supabase (20260323000000)
- Phone provisioning migration applied to Supabase (20260323000001)
- Graceful shutdown on SIGTERM/SIGINT
- All env vars configured in Railway (DB, JWT, OpenAI, Telnyx API key + SIP connection ID, Stripe keys + webhook secret, AGENT_SECRET, LIVEKIT_*, DEEPGRAM_API_KEY)
- Landing page at root URL, `/health` endpoint for monitoring
- Stripe webhook registered: `https://ai-sec-production.up.railway.app/billing/webhook`
- **Phone provisioning**: Automated via `POST /provisioning/activate` — searches Telnyx inventory, purchases the number, assigns it to SIP Connection `livekit-outbound` so calls route to the LiveKit agent
- `src/services/telnyxNumbers.ts` — Telnyx Numbers API client (search/order/assign/release)
- `src/routes/provisioning.ts` — activate/deactivate/status endpoints
- SuperAdmin dashboard has "Activate Phone" button with area code input
- `TELNYX_API_KEY` and `TELNYX_SIP_CONNECTION_ID=2945038451784812111` set in Railway
- Phone provisioned: `+1-630-937-9478` (Telnyx) — currently unreachable from PSTN, see `docs/TICKET_SUPPORT.md` (ticket #2850682)
- **Still needs**: DASHBOARD_URL env var on Railway backend (see `docs/TODO.md`); first live call to confirm carrier propagation

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

See `docs/TODO.md` for full backlog. Key post-launch features: automated phone provisioning, full billing system (Professional tier), business intelligence/ROI, personal resources, advanced coverage alerts.

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

**Analytics rebuilt:** Old version discarded. 6 metrics defined — 3 active from booking data (Busiest Hours, Return Rate, No-Show Pattern), 3 pending call log integration (LiveKit agent will write call records once the live-call path is validated).

**Logo:** "Secretary HQ" (space between words).

**Philosophy:** We show data. They manage their business. No warnings, no grades, no opinions. See UI_UX_DESIGN.md Design Philosophy section.

