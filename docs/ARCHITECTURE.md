# SecretaryHQ SaaS — Architecture

**Last verified:** 2026-04-30 (25 route modules, 77 migrations, 10 voice-AI tools)

> **Migration shipped:** The voice-AI stack moved from Vapi + Supabase Edge Functions to LiveKit Agents + Fastify in commit `661d21d` (2026-04-27). Vapi account deleted; only Telnyx + LiveKit remain. See `docs/FRAMEWORK_MIGRATIONS.md` for the migration index. The remaining open swap is OpenAI TTS → xAI Grok native (NEEDS-REFACTORING.md item #9).

---

## 1. Overview

Multi-tenant AI receptionist SaaS for service businesses (tire shops, salons, auto shops, trades, fitness, food & beverage). HIPAA verticals are permanently excluded.

**Core loop:** Caller dials a tenant's Telnyx number → voice AI answers, identifies intent, checks the database (availability, customer history, skills, shifts, services, policies), books an appointment atomically, and syncs the result to the owner's dashboard + connected calendars + CRM.

**Layering:**
- **Edge**: Telnyx (PSTN + SIP) → LiveKit Cloud (orchestrator) → LiveKit agent worker on Railway (`ai-sec-agent`, runs STT via Deepgram, LLM via OpenAI, TTS via OpenAI pending swap to xAI Grok)
- **Tools**: 10 voice tools that run against the tenant's Postgres — Fastify (Node) at `/agent-tools/*`
- **API**: Fastify (25 route modules) on Railway — serves the dashboard, handles webhooks, runs async work inline
- **DB**: Postgres + pgvector on Supabase, 77 migrations, RLS on every tenant-scoped table
- **UI**: Next.js 14 (App Router) + Tailwind — to be deployed on Vercel

---

## 2. Directory Structure

```
/
├── src/                          Fastify backend (Node)
│   ├── index.ts                  Entry — registers 25 route modules
│   ├── middleware.ts             withHandler, tenantMiddleware, AppError, logEvent
│   ├── routes/                   25 route modules + routeHelpers.ts
│   ├── services/                 21 files (CRM clients + sync, calendar sync, OAuth, TTS, name/token utilities)
│   └── database/                 DB pool, withTenantClient()
├── dashboard/                    Next.js 14 App Router
│   ├── app/                      page.tsx (landing), dashboard/page.tsx (app shell), layout.tsx, globals.css
│   ├── components/               ~60 feature components + ui/ primitives
│   │   └── ui/                   Badge, Button, Card, ConfirmModal, FolderTabs, Input, Modal, Select, Toast, TimeInput, PhoneInput, CoverageBar
│   ├── lib/                      api.ts, SessionContext, ThemeContext, VocabularyContext, hooks, types
│   ├── e2e/                      19 Playwright tests
│   ├── server.js                 Custom HTTPS server (dev) + Railway deploy entry (prod)
│   └── 22 *.test.tsx files       Vitest + React Testing Library
├── supabase/
│   ├── functions/                Empty post-661d21d (former vapi-tools deleted with the Vapi rip-out)
│   ├── migrations/               77 SQL migrations
│   └── seed.sql                  Platform admin + DynaTire tenant
├── agent/                        LiveKit agent worker (Node) — deployed as Railway service `ai-sec-agent`
│   └── src/                      index.ts (entry), prompt.ts, toolsClient.ts, sessionContext.ts, tools.ts
├── shared/                       Cross-runtime code
│   ├── getEmbedding.ts           OpenAI text-embedding-3-small wrapper
│   ├── normalizeForEmbedding.ts  gpt-4o-mini normalization before pgvector storage
│   └── scheduling.ts             Core scheduling algorithm (shared between booking RPC caller and UI)
├── scripts/                      bootstrap, setup-db, seed-db, preflight-cloud, deploy, qa-live-test.py
├── docs/                         Architecture, deployment, UI/UX, TODO, migrations, bugs, plans
├── certs/                        Self-signed HTTPS certs for local dev
├── railway.json + nixpacks.toml  Backend deploy config
├── CLAUDE.md + README.md         Project overview + developer docs
└── .env.* + package.json         Config + deps
```

**Shipped in LiveKit migration (commit `661d21d`):**
- `agent/` — separate Node.js package for the LiveKit agent worker (deployed as Railway service `ai-sec-agent`)
- `src/routes/agentTools.ts` — 10 voice-AI tools (8 originals + 2 OTP helpers); replaced the deleted `supabase/functions/vapi-tools/`

---

## 3. Deployment Topology

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Caller (phone)                            │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ PSTN / SIP
                               ▼
                       ┌──────────────────┐
                       │  Telnyx (SIP)    │  +1 (630) 937-9478
                       └────────┬─────────┘
                                │ SIP trunk
                                ▼
                       ┌──────────────────┐
                       │  LiveKit Cloud   │
                       │ (SIP bridge +    │
                       │  orchestrator)   │
                       └────────┬─────────┘
                                │ WebSocket (room dispatch)
                                ▼
                      ┌────────────────────┐
                      │  Agent Worker      │  Railway: ai-sec-agent
                      │  (Node, LiveKit    │  worker AW_vPmGExrgTeGn
                      │   Agents SDK)      │
                      └─────────┬──────────┘
                                │ HTTP + x-agent-secret
                                ▼
                    ┌─────────────────────┐
                    │  Fastify Backend    │  ai-sec-production.up.railway.app
                    │  25 route modules   │  Railway (Nixpacks, Node 20)
                    └──────────┬──────────┘
                               │
          ┌────────────────────┼─────────────────────┐
          ▼                    ▼                     ▼
    ┌──────────┐        ┌────────────┐        ┌──────────────┐
    │ Postgres │        │  OpenAI /  │        │ Integrations │
    │ Supabase │        │  Deepgram /│        │ Google /     │
    │ + vector │        │  xAI Grok  │        │ Outlook /    │
    └──────────┘        └────────────┘        │ Jobber /     │
                                              │ HubSpot /    │
                                              │ Square / ST  │
                                              │ Stripe       │
                                              └──────────────┘
          ▲
          │
    ┌─────┴────────┐
    │  Dashboard   │  Vercel (pending) or Railway
    │  Next.js 14  │
    └──────────────┘
```

| Service | Platform | Region / URL | Deploy mechanism |
|---|---|---|---|
| Backend (Fastify) | Railway | `ai-sec-production.up.railway.app` | Nixpacks auto-deploy from `main` |
| Agent worker | Railway (service `ai-sec-agent`) | WebSocket long-runner, worker ID `AW_vPmGExrgTeGn`, registers with LiveKit under agent name `ai-secretary-agent` | Node.js package under `agent/` |
| Database | Supabase (managed Postgres + pgvector) | `sgibijfchvfuizudrmir` (us-west-2) | Migrations applied via `npm run db:migrate` |
| Dashboard | Railway | `dashboard-production-cee3.up.railway.app` | Next.js build via `dashboard/server.js` |
| Telephony | Telnyx | `+1 (630) 937-9478` | SIP Connection `livekit-outbound` (ID `2945038451784812111`); provisioned per tenant via `POST /provisioning/activate` |
| Voice orchestrator | LiveKit Cloud | `ai-secretary-nmlkkmgf.sip.livekit.cloud:5060` (SIP); WebSocket for agent | Dispatch rule `SDR_if97ky4Zf7e6` routes to agent name `ai-secretary-agent` |
| Stripe | Hosted | Webhook: `/billing/webhook` on Railway | Products + price IDs in Stripe dashboard |

**Graceful shutdown:** Backend handles `SIGTERM`/`SIGINT` (Railway sends these during deploys) — closes Fastify and drains the DB pool.

**Single DB pool:** Backend uses one pool via `DATABASE_URL`. No separate `api_user` pool — `FORCE ROW LEVEL SECURITY` on all 20 RLS-enabled tables enforces tenant isolation even as the `postgres` superuser (required for Supabase-managed Postgres).

---

## 4. Data Model

### 4.1 Core entities

```
┌─────────────┐     ┌──────────────┐    ┌──────────────┐
│  tenants    │◄────│    users     │    │  customers   │
│             │     │ (email, pw)  │    │ (per-tenant) │
└──────┬──────┘     └──────────────┘    └──────┬───────┘
       │                                        │
       │         ┌───────────────┐              │
       ├────────►│   employees   │              │
       │         └──────┬────────┘              │
       │                │                       │
       │         ┌──────▼──────────┐            │
       │         │employee_schedule│            │
       │         │ (date-based)    │            │
       │         └─────────────────┘            │
       │                                        │
       │         ┌───────────────┐              │
       ├────────►│   resources   │              │
       │         └──────┬────────┘              │
       │                │                       │
       │                ▼                       ▼
       │         ┌──────────────────────────────────┐
       │         │          appointments             │
       │         │ (start_time, end_time,           │
       │         │  resource_id, employee_id,       │
       │         │  customer_id, service_id,        │
       │         │  status, call_id)                │
       │         └──────────────────────────────────┘
       │
       │         ┌──────────────┐       ┌─────────────────┐
       ├────────►│   services   │───────│ service_employee│
       │         │ (duration,   │       │ (skill req)     │
       │         │  price)      │       └─────────────────┘
       │         └──────┬───────┘       ┌─────────────────┐
       │                │───────────────│ service_resource│
       │                                │ (capability)    │
       │         ┌───────────────┐      └─────────────────┘
       ├────────►│ tenant_skills │
       │         └───────────────┘
       │
       │         ┌─────────────────┐
       ├────────►│   tenant_docs   │  (pgvector knowledge base)
       │         │ (embedding,     │
       │         │  normalized)    │
       │         └─────────────────┘
       │
       │         ┌──────────────────┐   ┌──────────────────┐
       ├────────►│call_transcripts  │   │  call_summaries  │
       │         └──────────────────┘   └──────────────────┘
       │
       │         ┌──────────────────────────┐
       ├────────►│tenant_integration_settings│ (OAuth tokens per CRM/calendar)
       │         └──────────────────────────┘
       │         ┌────────────────────┐
       ├────────►│  entity_sync_map   │ (local↔external ID mapping)
       │         └────────────────────┘
       │
       │         ┌─────────────────────┐  ┌──────────────────┐
       └────────►│tenant_calendar_sett.│  │appointment_sync_m│
                 └─────────────────────┘  └──────────────────┘
```

### 4.2 Tables (20 RLS-enabled + 6 global)

**Tenant-scoped (RLS + FORCE RLS):**
`tenants`, `users`, `customers`, `employees`, `resources`, `services`, `appointments`, `service_employee`, `service_resource`, `tenant_skills`, `tenant_docs`, `employee_schedule`, `call_transcripts`, `call_summaries`, `tenant_integration_settings`, `entity_sync_map`, `tenant_calendar_settings`, `appointment_sync_map`, `reminder_schedules`, `unanswered_questions`.

**Global / platform:**
`business_templates` (vocabulary per business type), `audit_log`, `record_versions` (version history), `voice_sessions`, `consent_records`, `opt_out_records`.

**Legacy (unused in production):**
`employee_shifts` (weekly patterns, day_of_week 0-6) — replaced by `employee_schedule` in April 2026. No booking RPC or UI code references it.

### 4.3 Key columns

- All entity IDs are **UUID** (services + employees migrated from `SERIAL` in Phase 9).
- Every tenant-scoped row has `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`.
- Soft-deletable tables carry `is_deleted BOOLEAN DEFAULT false` + `deleted_at TIMESTAMPTZ` with partial indexes (e.g., `WHERE is_deleted = false`).
- `customers.phone` is stored in E.164 format (`+1...`). `normalizePhone()` rejects anything with < 10 digits.
- `appointments` has CHECK constraint `start_time < end_time`, indexes on `(tenant_id, start_time)` + `(resource_id, start_time)` for availability checks, and partial index on `call_id WHERE call_id IS NOT NULL` for back-reference to the originating call (LiveKit room ID; was Vapi call ID pre-`661d21d`).

### 4.4 Stored procedures (key RPCs)

| RPC | Purpose |
|---|---|
| `book_appointment_atomic(...)` | Legacy atomic booking — 7-layer constraint check + past-time rejection, business hours validation, fuzzy service matching. Used by dashboard QuickBook. |
| `book_with_scheduling_atomic(...)` | Production voice-AI booking path — uses `employee_schedule` for shift validation (date-based), night-shift support (cross-midnight), specific error codes (`TIMESLOT_OCCUPIED`, `NO_SKILLED_EMPLOYEE`, `EMPLOYEE_NOT_SCHEDULED`, `NO_AVAILABILITY`, `INVALID_PARAMS`). |
| `check_availability_with_tz(...)` | Timezone-aware availability check — queries `employee_schedule` for active employees + scans `appointments` for conflicts. |
| `get_effective_shifts(tenant_id, date)` | Returns entries from `employee_schedule` (date-based only). |
| `get_effective_shifts_bulk(tenant_id, start, end)` | Bulk variant — returns all employees' shifts in a date range. Used by scheduler for efficient loading. |
| `search_tenant_docs(tenant_id, query_embedding)` | Cosine similarity over `tenant_docs.embedding` (pgvector `<=>` operator). |
| `check_coverage_gaps(tenant_id)` | Returns list of services with missing coverage (no qualified employee or resource). |
| `link_orphaned_transcripts()` | Post-call cleanup — joins transcripts to summaries where `call_id` matches. Called from `dispatcher.handleCallEnded()`. |
| `set_tenant_context(uuid)` | Sets `app.current_tenant_id` session variable for RLS policy evaluation. Called by `withTenantClient()`. |
| `fn_audit_trigger()` | `SECURITY DEFINER` trigger — writes before/after snapshots to `audit_log` on INSERT/UPDATE/DELETE of appointments, customers, resources. |

---

## 5. Multi-Tenancy & Row-Level Security

### 5.1 The context variable

Every tenant-scoped table has RLS policies using `current_setting('app.current_tenant_id', true)::uuid`. Before any query that touches tenant data, the backend sets this session variable:

```ts
// src/database/withTenantClient.ts
await client.query(`SELECT set_tenant_context($1)`, [tenantId]);
// query runs here, RLS auto-filters
await client.query(`SELECT set_tenant_context(NULL)`);
client.release();
```

### 5.2 FORCE ROW LEVEL SECURITY

Supabase's managed Postgres doesn't let us create a separate `api_user` role. Without FORCE, the `postgres` superuser role bypasses RLS entirely. Migration `20260323000000_force_rls_single_pool.sql` applies `FORCE ROW LEVEL SECURITY` to all 20 RLS-enabled tables, which makes RLS apply even to superusers.

### 5.3 Admin bypass

Super-admin operations (cross-tenant queries, tenant listing, user registration) need to bypass RLS. Three tables (`tenants`, `users`, `business_templates`) carry an additional policy: **if `app.current_tenant_id` is unset, allow all rows**. Admin routes acquire a connection without calling `set_tenant_context()` — effectively running in admin mode.

### 5.4 Audit trigger

`fn_audit_trigger` is marked `SECURITY DEFINER` so it can insert into `audit_log` regardless of the caller's RLS context. This keeps the audit trail complete even during admin operations.

---

## 6. Voice Loop

### 6.1 Current flow (LiveKit Agents, shipped in `661d21d`)

1. **Inbound call** — Telnyx SIP trunk → LiveKit Cloud SIP inbound trunk.
2. **Room creation** — LiveKit dispatch rule `SDR_if97ky4Zf7e6` creates a room with metadata `{ tenant_id }` (agent name `ai-secretary-agent`).
3. **Agent worker** — Node.js worker (Railway service `ai-sec-agent`, worker `AW_vPmGExrgTeGn`) joins the room, runs `VoicePipelineAgent`.
4. **Conversation** — Deepgram Nova-3 (STT) → OpenAI GPT-4o-mini (LLM) → OpenAI TTS (TTS — pending swap to xAI Grok, see §6.2).
5. **Tool execution** — LLM issues tool calls → HTTP POST to `https://ai-sec-production.up.railway.app/agent-tools/*` with `x-agent-secret` header.
6. **Business logic** — Fastify route → `withTenantClient()` → Postgres RPCs and pgvector queries.
7. **Response** — JSON `{ success: true, result: ... }` or `{ success: false, error: ... }` with HTTP 200 — the LLM relays both shapes naturally.
8. **Call end** — LiveKit room close event → `src/routes/voice.ts` handles summary generation + embedding + `link_orphaned_transcripts()`.
9. **Post-call async** — Appointment mutations trigger fire-and-forget sync to Google/Outlook/CRMs from route handlers.

### 6.2 Open TTS swap (OpenAI TTS → xAI Grok)

Currently the agent uses `openai.TTS` at `agent/src/index.ts:122,150`. The pending swap replaces it with a custom `GrokTTS` class hitting `https://api.x.ai/v1/tts` directly from the agent worker. No proxy involved — the earlier Vapi-era TTS proxy at `src/routes/tts.ts` was deleted in `661d21d`. Estimate: 1–2 hours, validatable via LiveKit playground without PSTN dependency. Tracked as `NEEDS-REFACTORING.md` item #9.

---

## 7. Voice AI Tools Catalog

10 tools exposed to the LLM. Implemented in `src/routes/agentTools.ts` as 10 POST routes. Verified against code 2026-04-30.

### 7.1 Auth contract

- **Header:** `x-agent-secret: <AGENT_SECRET>` (must match the backend's env var, ≥32 chars). The shared `preHandler` at `src/routes/agentTools.ts:187` rejects anything else with `401` for any URL starting with `/agent-tools/`.
- **Tenant scoping:** every body carries `tenant_id` (UUID). These routes are exempt from `tenantMiddleware` because the agent worker isn't logged in as a tenant user; tenant enforcement is at the SQL/RPC layer via `withTenantClient(tenant_id)`.
- **Validation:** every body parsed with Zod (schemas at `src/routes/agentTools.ts:43-122`). Failures return `success: false` with the field paths.

### 7.2 Response envelope

Every route returns HTTP 200 with one of:

```json
{ "success": true, "result": <tool-specific> }
{ "success": false, "error": "<human-readable message>" }
```

200-on-failure is deliberate — the LLM paraphrases the `error` string conversationally for the caller, instead of the HTTP client throwing.

### 7.3 The 10 tools

| Route | Input (Zod) | Return shape | Backing logic |
|---|---|---|---|
| `POST /agent-tools/service-catalog` | `{ tenant_id }` | `{ services: [{ id, name, duration_minutes, price, description }] }` | `SELECT * FROM services WHERE is_deleted = false` |
| `POST /agent-tools/customer-context` | `{ tenant_id, phone }` | `{ customer, last_appointment, recent_calls }` (or `{ customer: null }` for new caller) | Caller phone lookup; routing to existing customer record + history |
| `POST /agent-tools/check-availability` | `{ tenant_id, resource_id, start_time, end_time }` | `{ available: boolean, conflicts?: [...] }` | `check_availability_with_tz()` RPC (timezone-aware) |
| `POST /agent-tools/policy-answer` | `{ tenant_id, question }` | `{ answer: string \| null, source_doc_ids: string[] }` | `search_tenant_docs()` RPC over pgvector + OpenAI embedding of the question |
| `POST /agent-tools/book-appointment` | `{ tenant_id, resource_id, start_time, end_time, phone, name?, description?, employee_id?, location?, call_id? }` | `{ appointment_id, status }` or `{ ask_for_phone: true, message }` | Legacy atomic booking — `book_appointment_atomic()` RPC. Gates on `isValidPhone(phone)` before the RPC. |
| `POST /agent-tools/scheduling-options` | `{ tenant_id, requirements: { serviceType, requiredResourceCapabilities?, requiredEmployeeSkills? }, window: { from, to } }` | `{ options: [{ start_time, end_time, resource_id, employee_id }, ...] }` | Pure algorithm in `shared/scheduling.ts:selectAssignments()` — no DB write |
| `POST /agent-tools/book-with-scheduling` | `{ tenant_id, requirements, window, phone, name?, description?, location?, call_id? }` | `{ appointment_id, status }` or `{ ask_for_phone: true, message }` or specific error code (TIMESLOT_OCCUPIED, NO_SKILLED_EMPLOYEE, EMPLOYEE_NOT_SCHEDULED, NO_AVAILABILITY) | **Production booking path** — `book_with_scheduling_atomic()` RPC with 7-layer validation. Gates on `isValidPhone(phone)`. |
| `POST /agent-tools/available-slots` | `{ tenant_id, service_type, date }` (date `YYYY-MM-DD`) | `{ slots: [{ start_time, end_time }, ...] }` | Consolidated slot aggregator, single query — replaces multi-round-trip discovery |
| `POST /agent-tools/send-verification-code` | `{ tenant_id, phone }` | `{ message: "I just sent a verification code to <phone>..." }` | OTP send via `telnyxSms.sendSms`. 6-digit code, 10-min TTL, bcrypt-hashed. Rate-limited 3/phone/hour, 100/tenant/day. |
| `POST /agent-tools/verify-phone-code` | `{ tenant_id, phone, code }` (code numeric) | `{ verified: boolean, message }` | Verifies hashed code from `phone_verifications` table. 5 attempts max per code. |

### 7.4 OTP flow integration

`book-appointment` and `book-with-scheduling` reject invalid/missing phones with `{ ask_for_phone: true, message: "..." }`. The agent prompt instructs the LLM:

1. Read the message to the caller (asks for a callback number).
2. On the spoken phone number, call `send-verification-code(phone)` and read its `message` to the caller.
3. On the spoken 6-digit code, call `verify-phone-code(phone, code)`.
4. On `verified: true`, retry the original booking tool with the verified phone.

Caller-ID phones that pass `isValidPhone()` skip the OTP loop entirely.

---

## 8. Phone Provisioning

### 8.1 Activation flow (`POST /provisioning/activate`)

1. Owner clicks "Activate Phone" in the setup wizard with an area code.
2. Backend calls **Telnyx Numbers API** to search inventory + purchase a number (`src/services/telnyxNumbers.ts`).
3. Backend assigns the number to SIP Connection `livekit-outbound` (ID `2945038451784812111`) so Telnyx routes inbound calls to LiveKit Cloud's SIP ingress.
4. LiveKit dispatch rule `SDR_if97ky4Zf7e6` (already configured at the project level, not per-tenant) routes inbound calls to a room with metadata `{ tenant_id }`. The agent worker `ai-sec-agent` picks up rooms with agent name `ai-secretary-agent`.
5. Tenant row updated: `inbound_phone`, `telnyx_phone_number_id`, `phone_status = 'active'`.

Rollback on failure — if step 3 fails, step 2's number is released. (No Vapi assistant creation step — that was retired with the LiveKit migration in `661d21d`.)

### 8.2 Deactivation flow (`POST /provisioning/deactivate`)

Releases the Telnyx number via the API and clears `telnyx_phone_number_id`, `inbound_phone`, `phone_status = 'deprovisioned'`. DB deactivation always succeeds even when the Telnyx release call fails (warning surfaced in the response).

---

## 9. Backend API (Fastify)

### 9.1 Route modules (25)

```
auth, tenants, appointments, customers, employees, shifts, resources,
services, mappings, skills, calendar, knowledge, analytics, vocabulary,
billing, provisioning, jobber, hubspot, square, servicetitan, voice,
communications, reminders, versionHistory, tts
```

`src/index.ts` is slim — imports each `register*Routes(app, pool, withTenantClient)` and wires them.

### 9.2 Middleware layer (`src/middleware.ts`)

- **`withHandler(fn)`** — Decorator wrapping every route handler. Catches thrown `AppError`, converts to consistent `{ success: false, error, details? }` response. Logs request + response with structured fields.
- **`tenantMiddleware`** — Validates tenant context from JWT, calls `withTenantClient` to ensure the tenant row still exists (triggers auto-logout on `TENANT_NOT_FOUND`).
- **`AppError`** — Typed error class with HTTP status + error code. Preferred over `throw new Error()`.
- **`requireAuth`** / **`requireTenantId`** — Per-route guards.
- **`logEvent(req, name, fields)`** / **`logWarning` / `logError`** — Structured JSON logging via Pino.

### 9.3 Request lifecycle

```
Request
  → CORS + helmet + rate-limit (all routes)
  → JWT verification (protected routes) → extract tenant_id
  → tenantMiddleware (tenant-scoped routes) → verify tenant exists
  → withHandler(handler)
    → handler body
      → withTenantClient(pool, tenantId, async (client) => {
          set_tenant_context(tenantId)
          await handler logic (SELECT/INSERT/UPDATE via client)
          set_tenant_context(NULL)
        })
      → Zod validation at boundaries
      → assertRowAffected() on UPDATE/DELETE
    → catches AppError / Error, formats response
  → Response
```

### 9.4 Validation & response conventions

- Every mutation validated by a Zod schema at the API boundary.
- Every response uses `{ success: boolean, ...payload | error }` envelope.
- Every UPDATE/DELETE uses `assertRowAffected()` — zero-row operations return 404, never silent success.
- All entity IDs validated by `requireValidUUID()`.
- Pagination via `parsePagination(req.query)` (default limit 50, max 200).

### 9.5 Shared route helpers (`src/routes/routeHelpers.ts`)

`sendValidationError`, `sendNotFound`, `sendSuccess`, `sendConflict`, `assertRowAffected`, `requireValidUUID`, `parseDateRange`, `parsePagination`.

### 9.6 Security stack

- `@fastify/helmet` — standard security headers.
- `@fastify/rate-limit` — 100 req/min globally, 5 req / 5 min on `/auth/login` + `/register`.
- CORS via `CORS_ORIGIN` env var (restrict to dashboard origin in production).
- HTTPS in dev via self-signed certs in `certs/`; platform TLS termination in production.
- Fail-fast env validation — server refuses to start if `DATABASE_URL`, `JWT_SECRET`, `OPENAI_API_KEY`, or `STRIPE_SECRET_KEY` are missing.

---

## 10. Authentication & Authorization

### 10.1 User auth flow

```
POST /register    { email, password, company_name, business_type }
                  → bcrypt hash → INSERT users + INSERT tenants
                  → returns { token, tenant_id, user_id }

POST /login       { email, password }  [rate-limited: 5/5min]
                  → SELECT user by email → bcrypt.compare
                  → jwt.sign({ tenant_id, user_id, email }, JWT_SECRET, expiresIn: 8h)
                  → returns { token }

POST /auth/refresh { token }  (token may be expiring)
                  → verifies signature (ignores expiry)
                  → re-signs with fresh 8h expiry
                  → returns { token }
```

Client keeps the token in `localStorage` and sends `Authorization: Bearer <jwt>` on every API call. On `401 TOKEN_EXPIRED`, client auto-calls `/auth/refresh`. On `401 TENANT_NOT_FOUND`, client force-logs-out (tenant was deleted).

Dashboard `SessionContext` watches token TTL and pre-emptively refreshes 10 minutes before expiry.

### 10.2 Tenant uniqueness

`users.email` is scoped per-tenant, not globally unique. The same email can register a second tenant without collision (BUG-002 fix, March 2026 review).

### 10.3 OAuth flows (integrations)

All 6 external integrations (Google Calendar, Outlook, Jobber, HubSpot, Square, ServiceTitan) use the same OAuth 2.0 pattern via `src/services/oauthCallbackFactory.ts`:

```
GET /{provider}/auth/start
  → Generate signed state JWT (contains tenant_id, csrf_nonce)
  → Redirect to provider authorize URL with state + PKCE

GET /{provider}/auth/callback?code=...&state=...
  → Verify state JWT signature (CSRF protection)
  → Exchange code for access + refresh token
  → Store tokens in tenant_integration_settings (RLS-scoped)
  → Redirect to dashboard
```

Token refresh is centralized in `src/services/tokenManagement.ts`:

```ts
async function getValidToken(tenantId, provider) {
  const settings = SELECT * FROM tenant_integration_settings WHERE ...
  if (expires_at - now < 5 min) {
    const fresh = await provider.refreshAccessToken(refresh_token)
    UPDATE tenant_integration_settings SET access_token = $1, expires_at = $2 ...
    return fresh.access_token
  }
  return settings.access_token
}
```

On persistent refresh failure (invalidated refresh token), the integration is marked `is_active = false` and surfaced in the dashboard as "Reconnect required."

### 10.4 Agent tool auth (post-migration)

`/agent-tools/*` routes bypass tenant middleware entirely. Auth via `x-agent-secret` header in a `preHandler` hook. The tenant_id comes from the request body (the agent gets it from LiveKit room metadata).

---

## 11. Scheduling Engine

### 11.1 Data model

`employee_schedule` is the single source of truth for staff availability:

```sql
CREATE TABLE employee_schedule (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  schedule_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,  -- may be < start_time (cross-midnight / night shift)
  ...
);
```

Date-based only — no weekly patterns, no overrides. Owners copy a week forward from the UI. `employee_shifts` (weekly patterns) still exists as a table but is never read by production code.

### 11.2 Effective shifts

`get_effective_shifts(tenant_id, date)` and `get_effective_shifts_bulk(tenant_id, start, end)` return rows from `employee_schedule` verbatim. Both the Working Hours editor (Back Office → My Team) and the Front Desk scheduler read from these RPCs.

### 11.3 Booking (7-layer check)

`book_with_scheduling_atomic()` runs all seven checks in a single transaction:

1. **Past-time rejection** — `start_time > now() AT TIME ZONE tenant.timezone` (BUG-059 fix).
2. **Business hours** — (soft rule, not enforced at DB level) — checked before RPC call.
3. **Resource availability** — no overlapping appointment on the same resource.
4. **Staff on shift** — `start_time` and `end_time` fall inside an `employee_schedule` window (date-based, DST-safe via `AT TIME ZONE`, night-shift aware).
5. **Staff expertise** — employee is in `service_employee` for the requested service (by skill_id).
6. **Resource capability** — resource is in `service_resource` for the requested service.
7. **Customer upsert** — if `customer_id IS NULL` and phone is provided, find-or-create.
8. **Auto end-time** — if `end_time IS NULL`, compute from `service.duration_minutes`.

Specific error codes: `TIMESLOT_OCCUPIED`, `NO_SKILLED_EMPLOYEE`, `EMPLOYEE_NOT_SCHEDULED`, `NO_AVAILABILITY`, `INVALID_PARAMS` (BUG-064).

### 11.4 Night shifts

`end_time < start_time` indicates cross-midnight. The shift is treated as two logical windows for overlap math — e.g. 22:00-06:00 against an appointment at 23:30 evaluates against window `[22:00, 24:00]`, and an appointment at 04:00 evaluates against `[00:00, 06:00]` on the following calendar day.

### 11.5 Scheduling algorithm (`shared/scheduling.ts`)

Shared between Node (tool runtime) and Deno (edge function). Takes the tenant, the service, and a date range → returns a list of viable (resource, employee, start, end) tuples. Uses `get_effective_shifts_bulk()` + single query for existing appointments → returns diagnostics object (`"no skilled employee on 4/23"`, `"all 3 bays busy 9-noon"`) so the LLM can explain **why** no slots exist.

---

## 12. Knowledge Base (RAG)

### 12.1 Storage

```sql
CREATE TABLE tenant_docs (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  source_file TEXT,
  text TEXT,              -- raw chunk
  normalized_text TEXT,   -- post gpt-4o-mini normalization (§12.3)
  embedding vector(1536),
  ...
);
```

### 12.2 Ingestion

1. Dashboard uploads PDF/DOCX/DOC/TXT/MD.
2. Server parses + chunks (paragraph-aware with overlap).
3. For each chunk: `text` → `normalizeForEmbedding()` → `normalized_text` → `text-embedding-3-small` → `embedding`.
4. INSERT into `tenant_docs`. Duplicate detection: delete existing chunks from the same `source_file` before re-ingesting.

### 12.3 Query normalization

Both ingestion and query paths pass text through `shared/normalizeForEmbedding.ts` (OpenAI GPT-4o-mini, temp 0.1, 15s abort). Normalization collapses synonyms, expands abbreviations, and strips presentation noise — dramatically improves cosine similarity hit rate.

### 12.4 Retrieval

The `get_company_policy_answer` tool:

1. Normalizes the caller's question.
2. Embeds the normalized query.
3. `search_tenant_docs(tenant_id, query_embedding)` returns top-k by cosine distance (`<=>` operator).
4. Top chunks are returned to the LLM as factual context.

Unanswered questions (no chunk above similarity threshold) are logged to `unanswered_questions` table → surfaced in the owner's dashboard as a badge + SMS notification.

### 12.5 Knowledge base questionnaire

`dashboard/lib/policyQuestions.ts` defines 40 policy Q&A pairs across 9 categories (cancellation, payment, service area, hours, warranty, etc.). Owners fill these in during onboarding; answers are stored as `tenant_docs` rows with `source_file = 'questionnaire'`.

---

## 13. Calendar Sync (Push-only)

Two providers, same orchestration layer.

| Provider | Service | Route | API |
|---|---|---|---|
| Google | `src/services/googleCalendar.ts` | `src/routes/calendar.ts` | `googleapis` SDK |
| Outlook | `src/services/outlookCalendar.ts` | `src/routes/calendar.ts` | Microsoft Graph API (raw fetch) |

### 13.1 OAuth + token management
Via `oauthCallbackFactory.ts` + `tokenManagement.ts` (§10.3). State param is a signed JWT (CSRF protection). Tokens never exposed to the frontend. Best-effort token revocation on disconnect.

### 13.2 Sync orchestrator

`src/services/calendarSync.ts` is provider-agnostic:

```ts
async function syncAppointment(tenantId, appointment, op: 'create'|'update'|'delete'|'cancel') {
  const providers = SELECT * FROM tenant_calendar_settings WHERE tenant_id = $1 AND is_active
  for (const p of providers) {
    try {
      const token = await getValidToken(tenantId, p.provider)
      await callProviderAPI(p.provider, token, appointment, op)
      UPDATE appointment_sync_map SET external_id = ..., last_synced_at = now()
    } catch (err) {
      logError(...); // fire-and-forget continues with other providers
    }
  }
}
```

Fires from the 4 appointment mutation points (create, update, delete, cancel). Calendar is **display-only** — no pull back. Calendar events don't become SecretaryHQ appointments.

---

## 14. CRM Sync (Bidirectional)

| Provider | Client | Sync | Route | API |
|---|---|---|---|---|
| Jobber | `jobberClient.ts` | `jobberSync.ts` | `jobber.ts` | GraphQL |
| HubSpot | `hubspotClient.ts` | `hubspotSync.ts` | `hubspot.ts` | REST v3 |
| Square | `squareClient.ts` | `squareSync.ts` | `square.ts` | REST v2 |
| ServiceTitan | `servicetitanClient.ts` | `servicetitanSync.ts` | `servicetitan.ts` | REST v2 |

### 14.1 Merge strategy

Timestamp-based merge. For each conflicting field, the row with the most recent `updated_at` wins. Non-conflicting fields merge via `COALESCE(local.field, external.field)`.

### 14.2 Push triggers

From 7 mutation points:

| Event | Calendar | Jobber | HubSpot | Square | ServiceTitan |
|---|---|---|---|---|---|
| Appointment create | ✓ | ✓ | ✓ | ✓ | ✓ |
| Appointment update | ✓ | ✓ | ✓ | ✓ | ✓ |
| Appointment delete | ✓ | ✓ | ✓ | ✓ | ✓ |
| Appointment cancel | ✓ | ✓ | ✓ | ✓ | ✓ |
| Customer create | — | ✓ | ✓ | ✓ | ✓ |
| Customer update | — | ✓ | ✓ | ✓ | ✓ |
| Customer delete | — | ✓ | ✓ | ✓ | ✓ |

`src/services/syncOrchestrator.ts` fans out. Each provider fails independently — one bad provider doesn't block the others.

### 14.3 Pull triggers

- **Webhook receivers**: `POST /jobber/webhook/:tenantId`, `POST /hubspot/webhook`, `POST /square/webhook`, `POST /servicetitan/webhook`. Webhook signatures verified per provider spec.
- **Periodic full sync**: `POST /{provider}/sync` — manual or cron-triggered full reconciliation.

### 14.4 Mapping

`entity_sync_map` stores `(tenant_id, local_entity_type, local_id, provider, external_id, last_synced_at, external_updated_at)`. Shared helpers in `src/services/syncMapHelpers.ts`.

---

## 15. Billing (Stripe Lite)

### 15.1 Plans

| Plan | Price | Capabilities |
|---|---|---|
| Solo | $129/mo | 1 employee, core features |
| Growth | $279/mo | Multi-employee, CRM integrations |
| Professional | $449/mo | (defined, not yet gated) |
| Enterprise | Custom | Not implemented |

### 15.2 Checkout flow

```
POST /billing/checkout { tenant_id, plan }
  → stripe.checkout.sessions.create({
      customer (or customer_email),
      line_items: [{ price: STRIPE_{PLAN}_PRICE_ID }],
      mode: 'subscription',
      success_url + cancel_url (uses DASHBOARD_URL)
    })
  → returns { checkout_url }

Client → redirects to checkout_url
```

### 15.3 Webhook (`POST /billing/webhook`)

Stripe-signed via `STRIPE_WEBHOOK_SECRET`. Handles three events:

| Event | Action |
|---|---|
| `checkout.session.completed` | `UPDATE tenants SET stripe_subscription_id, subscription_status = 'active', subscription_plan = $plan` |
| `invoice.payment_failed` | `UPDATE tenants SET subscription_status = 'past_due'` |
| `customer.subscription.deleted` | `UPDATE tenants SET subscription_status = 'canceled', stripe_subscription_id = NULL, subscription_plan = NULL` |

### 15.4 Subscription gate middleware

Tenant-scoped routes behind `subscriptionGateMiddleware` check `tenants.subscription_status`. If not in `('active', 'trialing')`, return **402 Payment Required** with upgrade URL. Exemptions: `/billing/*`, `/auth/*`, `/health`.

### 15.5 Status endpoint

`GET /billing/status` → `{ subscription_status, subscription_plan }` for the dashboard to decide what to gate.

---

## 16. Dashboard Architecture

### 16.1 Routing

Next.js 14 App Router:

- `/app/page.tsx` — Marketing landing page.
- `/app/dashboard/page.tsx` — App shell (single route, view-switching internally via tab state + URL query params).
- `/app/layout.tsx` — Wraps `SessionProvider`, `ThemeProvider`, `VocabularyProvider`, `ToastContainer`, `ErrorBoundary`.

### 16.2 Navigation — Front Desk / Back Office

```
Front Desk (daily operations)      Back Office (configuration)
├─ Schedule                        ├─ My Team (employees, skills, schedules)
├─ Customers (CRM)                 ├─ My Business (services, resources, hours, knowledge)
└─ Staffing Map                    └─ AI & Insights (analytics, knowledge Q&A, vocabulary)
```

Desktop: two top-level tabs with sub-views. Mobile: bottom nav + scrollable sub-tabs. Tab state synced to URL query params (`?tab=schedule`) — shareable links, browser back/forward works.

### 16.3 State management

Four React contexts in `dashboard/lib/`:

| Context | Purpose |
|---|---|
| `SessionContext` | JWT, current user, active tenant (via `useActiveTenantId()`), tenant list, `tenantsVersion` counter for cross-component sync |
| `ThemeContext` | 8 themes (light, dark, midnight, nord, sunset, forest, high-contrast, solarized) — swaps CSS custom properties in `app/globals.css` |
| `VocabularyContext` | 3-tier label fallback (`COALESCE(tenant_override, template_default, hardcoded)`) per business type. 29 types across 6 categories |
| `AppointmentDetailContext` | Holds selected appointment for cross-view access (list → detail panel) |

### 16.4 Component hierarchy

- `components/ui/` — 16 primitives (Button, Card, Input, Select, Modal, ConfirmModal, Toast, Badge, TimeInput, PhoneInput, FolderTabs, CoverageBar, CoverageStatusBadge, FeedbackButton)
- `components/scheduler/` — `NewSchedulerView`, `StaffRow`, `ResourceColumns`, `QuickBookPanel`, `EmployeeDayFocusPanel`, `StaffProfileCard`
- `components/SetupWizard/` — 7-step wizard + `WizardModeChooser` (solo vs team branching)
- `components/CRM/`, `components/employees/`, `components/services/`, etc. — List+Detail pane pattern (sidebar + detail right)

### 16.5 API client (`dashboard/lib/api.ts`)

Centralized namespace: `Api.appointments.create(...)`, `Api.customers.list(...)`, `Api.services.update(...)`, etc. Every call fully typed (no `Record<string, unknown>` return types). Shared `forceLogout()` + `checkAuthFailure()` handle 401.

### 16.6 Theming

Every component consumes CSS custom properties (`--bg`, `--fg`, `--accent`, `--border`, `--font-display`, `--font-body`) — never hardcoded colors. All 8 themes are dark variants (locked from March 24 2026 design session). Fonts: Bebas Neue (display) + DM Sans (body).

### 16.7 Test harness

Vitest + React Testing Library (jsdom). 22 test files, 465 tests. Contexts are provided by a shared `renderWithProviders()` helper. Happy + sad paths with 5W diagnostic comments (Who / What / When / Where / Why) — failure messages are self-debugging.

### 16.8 Dev server

`dashboard/server.js` — custom HTTPS server for local dev (self-signed certs from `certs/`), doubles as the Railway production entry when `NODE_ENV=production`.

---

## 17. Async Work (no n8n)

`n8n/` was removed. All async work runs inline in Fastify route handlers as fire-and-forget calls.

| Concern | Trigger point | Runs in |
|---|---|---|
| Post-call summary | LiveKit room close event → `POST /voice/session/end` | `src/routes/voice.ts` |
| Call summary embedding | After summary insert | `src/routes/voice.ts` (OpenAI embedding call) |
| Calendar sync | Appointment mutation routes | `src/services/calendarSync.ts` |
| CRM push | Appointment + customer mutation routes | `src/services/syncOrchestrator.ts` |
| CRM pull | `POST /{provider}/webhook` receivers | `src/routes/{provider}.ts` |
| SMS / reminders | Planned cron-based | `src/routes/reminders.ts` (stub; scheduler not yet wired) |
| Orphaned transcript linking | After call end | `link_orphaned_transcripts()` RPC from dispatcher |

All async work is **best-effort**. If a sync fails, the user-facing operation still succeeds. Failures are logged + surfaced in the dashboard (e.g., "Reconnect required").

---

## 18. Testing Strategy

### 18.1 Test pyramid

```
                  ╱╲
                 ╱19╲        Playwright e2e (full-stack, browser)
                ╱────╲
               ╱ 29   ╲      Live QA (scripts/qa-live-test.py — real `/agent-tools/*` Fastify routes)
              ╱────────╲
             ╱  2,022   ╲    Vitest unit + integration (real DB, real RLS)
            ╱────────────╲
```

### 18.2 Backend (`npm test` — 1,527 tests)

Vitest with `--fileParallelism=false` (tests share `test_db` on port 5433). Covers routes (happy + sad), services, scheduling, RLS enforcement, CRM sync clients, OAuth flows, voice-AI fixes, schema constraints, migration regressions, billing webhook handling, provisioning flows. Every test has 5W diagnostic comments (`// WHO: DynaTire caller | WHAT: ... | WHEN: ... | WHERE: ... | WHY: ...`).

### 18.3 Dashboard (`cd dashboard && npm test` — 465 tests, 22 files)

Vitest + React Testing Library (jsdom). Renders components with all 4 providers (Session, Theme, Vocabulary, AppointmentDetail). Tests interactions (click, keyboard, form submission), accessibility (role/tabIndex/aria attributes), and error states.

### 18.4 Edge functions (`deno task test --no-check`)

Deno's built-in test runner. Covers dispatcher + service layer in the edge function.

### 18.5 Playwright e2e (`cd dashboard && npx playwright test` — 19 tests)

7 critical-fix tests (regression gates on toast, validation, unsaved-changes warning, NaN guards) + 12-step functional audit (login → home → scheduler → CRM → calls → services → staff → AI → theme → URL nav).

### 18.6 Live QA (`scripts/qa-live-test.py` — 29 tool calls, 88 assertions)

Hits the live Supabase edge function with the 29 voice-AI tool scenarios. Verifies DB side effects directly. Used as the pre-deploy integration check.

### 18.7 Typecheck

`npx tsc --noEmit --noUnusedLocals --noUnusedParameters` — must be clean. Currently passes with 0 errors.

---

## 19. Observability

### 19.1 Structured logging

Pino under Fastify. Every request + response logs a structured JSON line. Domain events logged via `logEvent(req, name, fields)`:

```ts
logEvent(req, 'appointment_booked', {
  tenantId, customerId, appointmentId,
  serviceId, employeeId, startTime, source: 'voice'
})
```

Railway captures stdout/stderr. No aggregation pipeline yet (Datadog/Logtail/etc.) — planned but not started.

### 19.2 Audit log

`audit_log` table records before/after snapshots for every INSERT/UPDATE/DELETE on appointments, customers, and resources. Trigger `fn_audit_trigger` runs as `SECURITY DEFINER` to bypass RLS. Written atomically with the mutation — if the write fails, the log entry isn't created.

Surfaces in dashboard via `GET /versionHistory/:entity/:id`.

### 19.3 Record versions

`record_versions` table — parallel history system specific to entities that need UI diff/restore (services, employees, resources). Triggered from `src/routes/versionHistory.ts`.

### 19.4 Health endpoint

`GET /health` → `{ status: 'ok' }`. Railway uses this as the healthcheck.

### 19.5 Gaps

- No error rate dashboard.
- No latency percentile tracking.
- No alerting on Stripe webhook failure, OAuth token invalidation, or sync error spikes.

Planned once there's real call volume.

---

## 20. Error Handling & Retry

### 20.1 Error taxonomy

| Source | Type | Response |
|---|---|---|
| User input | Zod validation failure | 400 `{ error, details: [...zod issues] }` |
| Auth | Invalid / expired JWT | 401 `{ error: 'TOKEN_EXPIRED' }` → client refresh |
| Auth | Tenant deleted | 401 `{ error: 'TENANT_NOT_FOUND' }` → client force-logout |
| Billing | No active subscription | 402 `{ error: 'SUBSCRIPTION_REQUIRED', upgrade_url }` |
| Authorization | Wrong tenant | 403 `{ error: 'FORBIDDEN' }` |
| Not found | Zero-row UPDATE/DELETE | 404 `{ error: 'NOT_FOUND' }` (via `assertRowAffected()`) |
| Conflict | Booking clash | 409 `{ error: 'TIMESLOT_OCCUPIED' }` (RPC-specific codes) |
| Upstream | OpenAI/Deepgram timeout | 502 `{ error: 'UPSTREAM_TIMEOUT' }` |
| Server | Uncaught | 500 `{ error: 'INTERNAL_SERVER_ERROR' }` (details hidden in prod) |

### 20.2 Retry strategy

- **Token refresh**: automatic, 5-min buffer. On failure → mark integration inactive, no automatic retry.
- **CRM sync**: fire-and-forget, no retry. Failures logged + visible in dashboard.
- **Calendar sync**: same pattern.
- **Stripe webhook**: idempotent by design (Stripe retries on non-2xx).
- **Voice AI tool calls**: the LLM retries naturally (if the tool returns an error string, the LLM paraphrases and tries alternative tool or asks the caller).
- **OpenAI/Deepgram API calls**: AbortController timeouts (10s embeddings, 15s normalization) — no retry, surface as upstream error.

### 20.3 Destructive action safeguards

- Type-to-confirm modal for tenant deletion.
- `ConfirmModal` + `useConfirm()` hook for all destructive actions on the dashboard.
- `beforeunload` warning on dirty state in reorder + form edit flows.

---

## 21. Security Summary

- **Row Level Security** — enforced on 20 tenant-scoped tables with `FORCE ROW LEVEL SECURITY`. Context via `app.current_tenant_id`.
- **JWT Authentication** — 8h expiry, auto-refresh, auto-logout on tenant deletion. bcrypt password hashing.
- **Rate limiting** — 100 req/min global, 5 req / 5 min on auth endpoints.
- **Security headers** — `@fastify/helmet` (HSTS, CSP, X-Frame-Options, etc.).
- **CORS** — restricted to `CORS_ORIGIN` in production.
- **Input validation** — Zod at every API boundary. CHECK constraints on JSONB columns.
- **OAuth state** — signed JWT state param (CSRF protection) on every integration.
- **Secrets** — env vars only; never committed. Production validation fail-fast on missing required secrets.
- **Audit log** — immutable via `SECURITY DEFINER` trigger, cascaded delete from `tenants`.
- **Soft deletes** — `is_deleted` flag + partial indexes on appointments, customers, resources, employees.
- **HIPAA exclusion** — medical verticals permanently removed. No BAA, no ePHI handling, no compliance program.

---

## 22. Known Gaps / Future Work

- **Dashboard deployment** — Vercel or Railway; currently local-only.
- **LiveKit migration** — Phase 2+ pending LiveKit API Secret + WSS URL (`.claude/plans/federated-snacking-puffin.md`).
- **Communications/reminders** — routes + schemas exist, Telnyx SMS + nodemailer wiring pending.
- **Observability pipeline** — aggregation + alerting not started.
- **Soft-delete SELECT filters** — only 2 of 20 routes currently filter `is_deleted = false` on SELECTs.
- **Full billing system** — trial management, plan switching, call limits, Stripe portal. Post-launch.
- **Business intelligence / ROI analytics** — requires real booking volume. Post-launch.
