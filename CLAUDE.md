# SecretaryHQ — Multi-Tenant Voice AI Reception SaaS

## Project Overview

Multi-tenant AI receptionist for service businesses (tire shops, salons, auto shops, trades, fitness, food & beverage).

**HIPAA verticals are permanently excluded** (medical, dental, chiropractic, optometry, veterinary).

Completed phases live in `RESOLVED.md`. Current tasks in `docs/TODO.md`. Full cross-angle gap inventory (what's missing from every direction) lives in root `GAPS.md` (created 2026-06-15). Framework-migration history (Vapi → LiveKit, Edge Functions → Fastify, OpenAI TTS → xAI Grok) in `docs/FRAMEWORK_MIGRATIONS.md`. Historical session notes archived in `docs/CURRENT_STATUS_ARCHIVED_2026-05-15.md`.

## Architecture

- **Voice**: Telnyx → LiveKit Cloud → LiveKit Agent (Node) → Deepgram (STT) + OpenAI (LLM) + xAI Grok (TTS) → Fastify `/agent-tools/*`
- **Backend**: Fastify (27 route modules under `src/routes/`) → Postgres (Railway)
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
- **Voice stack**: Telnyx + LiveKit Cloud + Deepgram Nova-3 + OpenAI GPT-4o-mini + xAI Grok TTS (default voice `ara`; OpenAI TTS retained as fallback). Voice + delivery (speed, soft) are **per-tenant** via `tenants.tts_voice/tts_speed/tts_soft` (NULL = `XAI_TTS_*` env default), set on the dashboard Phone Assistant → AI Persona page
- **Testing**: Vitest (backend + dashboard), Playwright (e2e), `scripts/simulate.sh` (on-demand system harness: `status` health board, `tools` agent-tools journey, `call` browser voice test — see Development)

## Key Directories

Items below capture hidden context — things you can't grep for. Everything else (flat service files, type definitions, doc tree) is derivable from the filesystem.

- `/src` — Fastify backend (slim `index.ts` + 27 route modules)
- `/src/routes/routeHelpers.ts` — `sendValidationError`, `sendNotFound`, `sendSuccess`, `sendConflict`, `assertRowAffected`, `requireValidUUID`, `parseDateRange`, `parsePagination`
- `/src/services/communications/` — CommunicationService + email/sms/appointment services + Handlebars templates + ProviderRegistry (Telnyx + Mock). Consent-gated.
- `/src/services/reminders/` — ReminderService schedules; reminderProcessor delivers via CommunicationService; reminderRepository handles DB.
- `/src/database/index.ts` — Canonical pool (lazy singleton w/ deadlock-prevention timeouts: `statement_timeout=30000`, `lock_timeout=10000`, `idle_in_transaction_session_timeout=60000`, `max=10`, `connectionTimeoutMillis=5000`). The first three are Postgres server-side GUCs (`options` string); `connectionTimeoutMillis` is the client-side checkout cap — added 2026-05-21 so a request that can't get a pool slot under load fails fast (→ error → `errors_total`) instead of hanging forever. `createWithTenantClient(pool)` returns the per-request RLS-scoped helper injected into routes.
- `/src/workers/reminderScheduler.ts` — 60s tick, batches up to 100. Runs in prod or when `ENABLE_REMINDER_SCHEDULER=true`.
- `/src/templates/` — 5 industry YAML bundles (automotive_v1, salon_v1, mobile_tire_v1, auto_bays_v1, ai_platform_v1). No HIPAA verticals.
- `/shared` — Pure cross-runtime TypeScript modules (no Node/Next/framework deps) intended to be consumed from both the Fastify backend (`../shared/...` from `src/`) and the Next.js dashboard (`../../shared/...` from `dashboard/lib/`). Residents: `getEmbedding.ts`, `normalizeForEmbedding.ts`, `scheduling.ts`, `voiceCrm.ts` (2026-05), `appointmentValidation.ts` (2026-05, 15-min increment + duration rules), `phone.ts` (2026-05-27: normalizePhone + formatPhone + isValidPhone), `name.ts` (2026-05-27: splitName, joinName, buildDisplayName, slugify), and `questionBank.ts` (2026-06-19: POLICY_QUESTIONS/POLICY_CATEGORIES + `resolveQuestions({customs})` for onboarding website-import; moved out of `dashboard/lib/policyQuestions.ts` — now a thin re-export — to kill a brittle backend→dashboard runtime import). These were extracted to kill duplication between backend CRM sync / agent tools and dashboard forms/comboboxes.
- `/src/middleware.ts` — `withHandler`, `tenantMiddleware`, `registerJwtAuthHook`, `generateToken`, `AppError`, `requireTenantId`, `requireAuth`, `requireSuperAdmin`, `logEvent/Warning/Error`. JWT preHandler (PUBLIC_ROUTES bypass + password-rotation check) lives here. `tenantMiddleware` enforces tenant isolation in two layers: (1) any non-public, non-tenant-exempt request with no authenticated session (`req.auth`) is rejected 401 before any tenant resolution — a user-supplied `tenant_id` is a selector within the JWT's permitted tenants, never a substitute for auth (added 2026-05-21 after an anonymous `?tenant_id=<uuid>` was found to return that tenant's data read+write+delete with zero auth; the 2026-05-06 guard only fired when a jwtTenant already existed); (2) for authenticated callers, any user-supplied `tenant_id` (query or body) not matching the JWT's is rejected 403 unless super-admin (added 2026-05-06). `requireTenantId` trusts only the middleware-validated `req.tenantId` (no body fallback). Use `requireSuperAdmin` (not `requireAuth`) on `/tenants/*` and other cross-tenant admin operations.
- `/agent` — LiveKit Agents worker (Node). Modules: `index`, `prompt`, `toolsClient`, `sessionContext`, `tools` (12 tools), `transferClient` (live SIP cold-transfer to a human via REFER), `transcript` (TranscriptRecorder → call transcript), `callOutcome` (CallOutcomeTracker → booked/transferred + appointment_id for the call→appointment link), `callSummary` (bounded/failsafe post-call OpenAI summary), `fallback` (OpenAI TTS dead-air guard). `agent/scripts/sim-*.mjs` are the simulation helpers (LiveKit dispatch + browser-call).
- `/dashboard` — Next.js (components/, lib/, app/). Landing at `/`, dashboard at `/dashboard`.
- `/supabase/migrations` — 140 SQL migrations (incl. 20260619 fix_rls_gaps + 20260618 ai_cost_events + ai_cost_events_rls + 20260616 customer_messages + 20260615 preferences_default_true + 20260612 knowledge_suggestion + comms history + voice styles + forward phone). **`supabase/baseline.sql` is a generated pg_dump snapshot — regenerate with `npm run db:baseline` after any schema migration** (the schema-alignment guard fails CI when a migration-created table/column is missing from it).
- `/scripts` — `simulate.sh` (system simulation/health harness; subcommands: `status`, `ci`, `tools`, `stripe`, `rag`, `call`; node helpers in `agent/scripts/sim-*.mjs` for LiveKit + `scripts/sim-tools.mjs` + `scripts/sim-stripe.mjs`), `verify-claude-md.ts` drift detector

## Development

**Primary reference for this project**: See `docs/DEVELOPMENT_WORKFLOW.md`.

**For a reusable, project-agnostic version** that can be copied and adapted to other codebases, see the files at the root:

- `PORTABLE_DEVELOPMENT_WORKFLOW.md`
- `workflow.config.json`

These two files are designed so another project can read them and implement the exact same development, testing, documentation, and commit processes.

Quick commands:

- Bootstrap: `npm run bootstrap` (deps + DB + migrations + seed + tests)
- Migrate: `npm run db:migrate [-- "postgres://..."]`
- Seed: `npm run db:seed [-- "postgres://..."]`
- Rebuild from scratch: `npm run db:rebuild [-- --yes]` (DROP SCHEMA public + apply all migrations + seed). End-to-end validation of the migration chain. Refuses non-localhost URLs unless `--force`; refuses without confirmation unless `--yes`.
- Start: `npm start` (Dashboard https://localhost:4000, Backend https://localhost:4001)
- Test: `npm test` (backend), `cd dashboard && npm test`, `cd dashboard && npx playwright test` (e2e)
- Simulate / health-check any time: `./scripts/simulate.sh status --env prod|local [--deep]` (HTTP board for backend/dashboard/agent; `--deep` dispatch-tests the LiveKit agent worker; also reports build staleness), `npm run status` (same as above), `./scripts/simulate.sh ci [--watch]` (GitHub Actions CI job stages + conclusions for the 4 CI jobs + local build freshness / src-vs-dist delta), `npm run ci:status`, `npm run ci:watch`. `./scripts/simulate.sh tools [--env local] [--tenant <id>]` (realistic agent-tools journey — provisions an ephemeral `/demo/start` tenant, books, recalls a preference, maps unwired `[dev]` links as GAPs), `./scripts/simulate.sh rag [--env local]` (RAG accuracy eval — seeds a known KB, asks paraphrased questions via `/agent-tools/policy-answer`, reports a retrieval hit-rate; real OpenAI embeddings, on-demand not CI), `./scripts/simulate.sh call --tenant <id>` (dispatch agent + print a browser join URL to talk to it with a mic, no phone). Tiers: status=systems up · ci=CI+build state · tools=brain works · stripe=billing wired · rag=answers accurate · call=voice works. Only real PSTN inbound can't be simulated.
- Quality gates: `npm run checks` (format + lint + typecheck), `npm run pre-pr`
- Heavy pre-commit automation: `npm run prepare-commit` (runs checks + tests + drift detector + more)
- Create feature branch (recommended): `npm run create-branch feat/my-work` or `bash scripts/create-feature-branch.sh feat/my-work`
- Verify docs drift: `npm run verify:claude-md`

Logins (all `/ password`):

- `admin@secretaryhq.com` — platform super-admin on tenant `00000000-0000-0000-0000-000000000000`
- `daledemott@gmail.com` — Thinking Hammer LLC owner on tenant `d5e3c6a1-7b9f-4e2a-bf30-8c11a5d8e9f0` (Dale's real business; intentionally separate from his super-admin identity so platform rights don't bleed into business workspace)
- `bella@bellashair.com` — Bella's Hair Studio owner on tenant `b3e1aaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee` (salon demo tenant; DynaTire PoC was removed 2026-06-03 after the customer declined the service)
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
- **ID convention** — domain entity tables (`tenants`, `customers`, `appointments`, `employees`, `resources`, `services`, `skills`, `users`, `voice_sessions`, `record_versions`) use `UUID PRIMARY KEY DEFAULT gen_random_uuid()`. Append-only audit / event tables (`reminder_schedules`, `consent_records`, `opt_out_records`, similar) use `SERIAL PRIMARY KEY` for the row's own id, but `UUID` for every FK column pointing at a domain entity. Mental rule: if an id is referenced from outside its own table, it's UUID; if it's only ever an internal sequence number, it's SERIAL. TS types must match — `string` for UUID columns, `number` for SERIAL. Polymorphic assignment uses `p_assignment_id` UUID. Origin of the rule: 2026-05-11 found `ReminderSchedule.appointment_id` typed `number` against a UUID FK column — every INSERT would have crashed against real Postgres, but 24 mocked unit tests hid it. This class of type/DB shape drift continues to be actively hunted (e.g. May 2026 removal of a stale duplicate `ReminderSchedule` definition inside `src/services/reminders/types.ts` that was missing the retry columns; and normalization of the last camelCase holdout `OptOutRecord` to snake_case).
- **PK column-name convention** — every single-column PK is named `<table_singular>_id`, never bare `id`. So `customers.customer_id`, `appointments.appointment_id`, `reminder_schedules.reminder_schedule_id`. The benefit is JOIN symmetry: `appointments.customer_id = customers.customer_id` lets you write `JOIN customers USING (customer_id)`, and a `SELECT *` across joined tables produces unambiguous column names (no aliasing needed). Sub-rules: (a) junction tables (`service_employee`, `service_resource`) keep composite PKs `(left_id, right_id)` — no surrogate `<junction>_id` added; the composite IS the identity. (a2) 1:1 extension tables (`tenant_calendar_settings`, `appointment_sync_map`) reuse the parent's PK as their own (`<parent>_id UUID PRIMARY KEY REFERENCES <parent>(<parent>_id) ON DELETE CASCADE`) — same "relationship IS the identity" reasoning, and the PK-as-FK enforces "at most one row per parent" at the PK level. (b) When a FK is _role-based_ and can't share its target's PK name (e.g. `audit_log.created_by_user_id` vs `audit_log.edited_by_user_id` both pointing at `users.user_id`), the FK is named `<role>_<table>_id`, keeping the `_<table>_id` suffix so the column name still tells you the referenced table. Symmetric `USING` is available only on the unambiguous columns; the role-based ones use explicit `ON`. (c) Abbreviations are forbidden — `voice_session_id` not `vs_id`, `reminder_schedule_id` not `rs_id`. Self-derivability beats brevity. Origin: 2026-05-11 conversation locking the standard down after the reminder-bug surface area review surfaced the asymmetric `<table>.id` vs `<other>.<table>_id` shape across the schema. Migrations to apply this rule land table-by-table as pilot work proves the pattern; each migration is `ALTER TABLE <name> RENAME COLUMN id TO <name_singular>_id`.
- **In-memory / non-DB identifier convention (2026-05-27 addition)** — The same bias toward descriptive `_id` names applies to TypeScript shapes that represent entity-like objects even when they are not direct DB rows (e.g. `CustomerNote` stored inside `customers.metadata.notes` JSON, lightweight DTOs, API responses that look like rows). Use `note_id`, `document_id`, etc. **Carve-out**: bare `id` is acceptable only for purely local/ephemeral UI state that is never persisted, never sent over the wire as a primary key, and has no meaning outside a single render (tab identifiers like `'schedule' | 'customers'`, theme keys, wizard step tokens, local `Map` keys for answers, etc.). When in doubt, prefer the `_id` form. This was the last open item from the great 2026-05 PK/naming retrofit (history in `RESOLVED.md`). The concrete pilot was `CustomerNote.id → note_id` (one interface + one React `key=` usage; typechecks + greps clean).
- **Composite / natural keys preferred when the natural key is short and stable.** When designing a table — new or being retrofitted — ask first: "what would make a row natural-keyed?" If the answer is 1-2 stable columns (e.g. `(tenant_id, slug)` for `business_templates`, `(service_id, employee_id)` for junctions), use that composite as the PK directly — no surrogate UUID. The key carries meaning the surrogate doesn't: it tells the reader what makes a row unique, and the schema enforces it at the PK level rather than a separate UNIQUE constraint. Use a surrogate `<table>_id UUID` only when (a) the natural key is 3+ columns, (b) any part of it is mutable, or (c) the row needs a portable identifier in URLs / external systems. **Retrofit cadence:** one table per day, same pilot pattern as the 2026-04→05 PK rename. Each retrofit lands as its own migration (drop surrogate, switch PK to composite, rewrite every FK, update TS types, run full e2e), CI-green per commit before moving to the next. Origin: 2026-05-18 — Dale's reflection that scattered surrogate UUIDs across the schema lost the natural-uniqueness intent. Every NEW table from this point on must justify its surrogate UUID before adding one; every EXISTING surrogate-PK table is on the retrofit queue.

## Build Principles

Durable rules-of-engagement that override "build for the future":

- **Test it or delete it.** Code that can't be exercised against a real external surface (real CRM, real provider API, real billing event) doesn't ship. Mocked-API tests prove the mock works, not the integration. Origin: deleted 21 dormant CRM adapters 2026-05-02 (none had ever touched a real CRM; two were HIPAA-vertical violations).
- **Build for real customers, not the imagined Pro tier.** No provider integrations, billing tiers, dashboard sections, or service layers because we _might_ need them. Wait for a beta customer or sales call that names the need.
- **Working flat code beats a dormant abstraction.** When a "shared interface" or "registry" exists alongside the working flat-file equivalent, the flat files are the source of truth. Extract a shared shape after the third or fourth real consumer asks for it.
- **HIPAA verticals are permanently excluded.** Medical, dental, chiropractic, optometry, veterinary. Anything that surfaces them gets deleted on sight.
- **DB starts bare-bones, tests own their data, DB ends bare-bones.** The seed (`supabase/seed.sql`) seeds ONLY what an empty business needs to exist: tenants + owner users + Bella's Hair Studio business-shape configuration (services/employees/resources/shifts). No customers, no appointments, no transactional rows. Every test that needs transactional data **creates it in `beforeAll` and deletes it in `afterAll`** — `feedback_test_isolation.md` is the standing rule. Playwright's `globalSetup` runs `scripts/rebuild-db.sh --yes` once per suite (DROP SCHEMA + apply `supabase/baseline.sql` + seed) so every E2E invocation starts from an identical, validated state. A test failure is provably the code or the test, never "the previous test left a stray row." Origin: 2026-05-18 — seed had accumulated 17 stale appointments + 12 stale customers across `db:seed` re-runs, masking real bugs.
- **Backend code changes require BOTH a rebuild AND a restart to take effect.** Two separate steps, both mandatory: (1) `npm run build` recompiles `src/*.ts` → `dist/*.js`; (2) killing and re-launching `node dist/src/index.js` swaps the running process onto the freshly compiled JS. Skipping either is a silent no-op — restart-only re-runs the stale `dist/`; build-only updates the bytes on disk but the in-memory process keeps the OLD code. Use `npm start` (does both) or surgical `kill $(lsof -ti :4001) && npm run build && node dist/src/index.js &`. Unit tests (`vitest`) DO pick up source changes immediately because they import directly from `src/`, so green unit tests + a stale-binary backend will produce a "false-green source layer / red E2E layer" mismatch that looks like flake but is actually the binary lagging the source. Origin: 2026-05-18 — multi-row INSERT fix landed in `src/`, ran clean through `vitest`, but the E2E suite kept hitting the original deadlock because neither rebuild nor restart had happened in 24 hours. Watch for `ps -eo etime,cmd | grep dist/src/index` to spot a backend that's been running longer than the most recent `src/` mtime suggests.

## Code Conventions

**Dashboard**

- Single primary nav bar: Primary tabs (Home, Schedule, Customers, Calls) always visible; Advanced tabs (My Business, My Team, Phone Assistant) shown for owners/admins only. Front-desk-only users see Primary tabs only and are snapped back to Home if they hit a restricted tab via a stale URL.
- Components: List+Detail pane pattern (sidebar list, detail right). Large views split into sub-components.
- UI primitives in `dashboard/components/ui/` — Button (`isLoading`), Card, Input, Select, Modal (Escape/backdrop close), Badge, Toast (5s err/warn, 3s success/info, max 5), `ConfirmModal` + `useConfirm()` for destructive actions.
- API client: `dashboard/lib/api.ts` with namespaced `Api.{resource}.{action}()`, fully typed returns. Shared `forceLogout()` + `checkAuthFailure()`.
- Entity types: `dashboard/lib/types.ts`.
- Session: `SessionContext` + `useActiveTenantId()`. No `overrideTenantId` prop drilling.
- `useFormState<T>()` for form state + dirty tracking.
- Tab state synced to URL (`?tab=schedule`).
- **Zero TypeScript errors** (`npx tsc --noEmit`).

**Backend**

- Slim `index.ts` registers 27 route modules. Tenant-scoped routes use `withTenantClient()` for RLS.
- All mutations: Zod-validated, response shape `{ success, error?, details? }`, `assertRowAffected()` returns 404 on zero-row UPDATE/DELETE (never silent success).
- Production env validation: refuses to start without `DATABASE_URL`, `JWT_SECRET`, `OPENAI_API_KEY`, `STRIPE_SECRET_KEY`.
- Graceful shutdown on SIGTERM/SIGINT (closes Fastify + drains pool — required for Railway).
- Fetch timeouts on OpenAI calls (10s embeddings, 15s normalization) via AbortController.

**Agent tools**

- `/agent-tools/*` responses: `{ success: true, result }` or `{ success: false, error }` at status 200 — LLM relays both shapes naturally. Auth via `x-agent-secret` header.
- `SYNC_TEST_RECORDER=1` (off by default) flips on an in-memory ring buffer in `syncOrchestrator.ts` that records every appointment + customer sync dispatch (provider, action, tenantId, entityId, ts). Exposed via `GET /agent-tools/_test/sync-events` (read) and `DELETE /agent-tools/_test/sync-events` (clear), both gated by the env var AND the existing agent-secret. Used exclusively by `dashboard/e2e/calendar-sync.spec.ts` to assert the orchestration contract without real Google/Outlook/CRM credentials. Strict opt-in — anything other than the literal string `"1"` keeps it disabled, so a stray prod request can't enumerate sync activity.

**Observability**

- Health: `GET /health` is shallow liveness (process up; `{status, started_at}`, no DB — E2E stale-binary check depends on this shape). `GET /ready` (added 2026-05-21) is deep readiness — pings the DB and reports pool saturation (`pool.{total,idle,waiting}`); 503 when DB unreachable. Both are PUBLIC + tenant-exempt + metrics-skipped. `/ready` is a monitoring/alert signal (curl/scrape, page on 503 or sustained `waiting>0`); it does NOT gate live traffic unless Railway's healthcheck path is repointed to it.
- Pino → stdout (Railway live-tail) + Better Stack (when `BETTER_STACK_TOKEN` is set). Per-request enrichment: `service`, `env`, `tenant_id`, `call_id`. `logEvent`/`logWarning`/`logError` helpers in `middleware.ts` add structured fields. `withHandler`'s unhandled-error branch routes through `logError` (so unknown route errors — incl. pool-checkout timeouts — increment `errors_total` and reach Sentry; pre-2026-05-21 it used a raw `req.log.error` that did neither).
- Prometheus-style metrics at `GET /metrics`, gated by `METRICS_TOKEN` env var (returns 404 when unset, 401 on missing/wrong Bearer). In-process registry in `src/services/metrics.ts` — no external deps, hard cap at 1000 series per metric (overflow funnels to `overflow="true"`). Pre-declared metrics: `http_requests_total{route,method,status}` + `http_request_duration_ms` (histogram, same labels), `booking_attempts_total{outcome,source}`, `tool_calls_total{tool,outcome}`, `sync_dispatches_total{provider,entity,action}`, `errors_total{event}`. Auto-emitted by Fastify `onResponse` hook (HTTP) and inside `logError` (errors); domain counters wired into appointments + agentTools + syncOrchestrator.

**Tests**

- All tests cover happy + sad paths with 5W diagnostic comments (WHO/WHAT/WHEN/WHERE/WHY).
- Mock helpers in `src/services/test-utils-mock.ts`.

## Known Issues

- OpenAI API quota needs monitoring (GPT-4o-mini for LLM + embeddings).
- Voice AI filler phrases ("Absolutely!", "Great!") still slip through occasionally despite prompt engineering.

## Project Status

**Phase 13 (Production Readiness) in progress.** ~1,770 backend + 747 dashboard + 141 agent tests passing (verified 2026-06-12 against real test_db / vitest; backend count dropped from ~2,028 after the 2026-06-12 removal of the Jobber/HubSpot/ServiceTitan CRM integrations). 26 Playwright e2e specs (~212 tests) incl. `analytics.spec.ts`; CI runs them on every PR. Zero TS errors across backend / agent / dashboard. **Shipped + deployed to main this session (2026-06-12):** live call-transfer + transcript capture, the `scripts/simulate.sh` system harness, the `baseline.sql` drift fix + guard, gap #1 (call outcome + appointment link + post-call summary), gap #2 (real call analytics: `/analytics/stats` + `/analytics/calls` + dashboard panels). **On branch `feat/remove-competitor-crms` (unmerged):** the competitor-CRM removal. Coverage breakdown in `docs/TEST_COVERAGE.md`; security posture in `docs/SECURITY.md`; Railway + Sentry + Better Stack setup in `docs/DEPLOYMENT.md`. Session handoff: `HANDOFF.md`.

**All 3 Railway services (ai-sec backend, ai-sec-agent, dashboard) deploy from `main`** (verified 2026-06-12 via Railway GraphQL — each service's latest deployment `meta.branch = "main"`). **Shipping = MERGE to main via PR**, not a branch push. A `git push` to a feature branch deploys NOTHING. Earlier features (greeting #5, call-logging #6) reached prod because their PRs were merged. GitHub branch protection on `main` now gates merges (and thus Railway deploys from `main`) behind green CI (all 4 jobs: Backend, Dashboard, Agent, E2E). The protection rule was applied 2026-06-15 via the updated recommendations in `.github/BRANCH_PROTECTION.md` (require PR + exact 4 status checks + enforce admins + conversation resolution + no direct pushes). Railway "Wait for CI" toggle still needs to be enabled on the 3 services for full defense-in-depth. Wait for green CI (use `npm run ci:status`) before merging. Apply prod DB migrations BEFORE the merge.

Remaining blockers: PSTN inbound path unverified — different-carrier call to `+1 630-822-9086` (LiveKit trunk `ST_aUM3GuCuc9wL`) while watching `listRooms()`; `+1 630-866-1960` is a dead recycled DID. Live call-transfer (`transfer_call`) additionally needs **call transfer / REFER enabled on the Telnyx SIP Connection**. `DASHBOARD_URL` + `SENTRY_DSN` on Railway, prod migrations apply (incl. `20260611000000_tenant_forward_phone`). See `docs/BETH_GO_LIVE_TODO.md` + `docs/TODO.md`.

## Production

- Backend: `https://ai-sec-production.up.railway.app/` (`/health` endpoint)
- Phone: **`+1 630-866-1960`** (Telnyx, tenant Thinking Hammer LLC `d5e3c6a1-…`; bought + routed 2026-06-02; Telnyx id `2973794140900296302`). Old `+1-630-937-9478` is dead (order deleted). Provisioning via `POST /provisioning/activate` (search → purchase → assign to SIP Connection `livekit-outbound`).
- Stripe webhook: `https://ai-sec-production.up.railway.app/billing/webhook` (3 events).
- Full Railway env-var list, deploy commands, and observability setup in `docs/DEPLOYMENT.md`.
