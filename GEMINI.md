# GEMINI Developer Guide & Instructions — SecretaryHQ

Welcome to the developer and AI agent instructions manual for **SecretaryHQ**. This file is the canonical context file loaded by Gemini to understand the project architecture, operational workflows, building, testing, database conventions, and quality standards of this repository.

---

## 1. Project Overview

**SecretaryHQ** is a multi-tenant voice AI receptionist SaaS built for service-oriented businesses (such as tire shops, salons, auto repair, fitness studios, trades, and food & beverage).

### Core Features

- **Voice AI Reception** — Inbound call routing and handling via an extremely low-latency, human-like voice agent. Handles policy questions, books appointments, and captures call summaries/outcomes.
- **Atomic Booking** — Checks staff shifts, resource availability, and timeslots in a single transaction. Concurrent-call-safe via Postgres GiST exclusion constraints to prevent double-booking.
- **Two-Layer Knowledge** — Structured SQL lookups for concrete queries (pricing, calendar times) coupled with RAG over uploaded tenant documents for company policies (cancellation, service areas, payments).
- **Multi-Tenant Dashboard** — Web application where business owners configure services, staff schedule grids, AI persona, and view transcripts, CRM history, and analytics.

### Hard Exclusions

- **HIPAA verticals are permanently excluded** from this platform (no medical, dental, chiropractic, optometry, or veterinary). Any feature, file, or integration attempting to introduce HIPAA verticals must be deleted on sight.

---

## 2. Technical Stack & Architecture

```
Inbound Call
    │
Telnyx (Carrier & SIP Trunk) ──> LiveKit Cloud (SIP Ingress)
                                           │
                                 LiveKit Agent Worker (Node)
                                 ├── Deepgram (STT)
                                 ├── OpenAI GPT-4o-mini (LLM)
                                 └── xAI Grok (TTS / OpenAI Fallback)
                                           │
                                 Fastify Backend API (/agent-tools/*)
                                           │
                                 PostgreSQL + pgvector (Multi-Tenancy RLS)
                                           │
                                 Next.js 14 Dashboard
```

### Technology Matrix

- **Voice & AI Worker** (`/agent`): Deployed as `ai-sec-agent` on Railway. Powered by LiveKit Agents (Node SDK) using Deepgram Nova-3 for Speech-to-Text (STT), OpenAI GPT-4o-mini for LLM, and xAI Grok TTS (`ara` default voice) for Text-to-Speech (TTS). Fastify `/agent-tools/*` provides the tool runtime.
- **Backend API** (`/src`): Fastify v4 server handling JWT auth, business logic, RLS isolation context, integrations, and scheduler rules. Deployed as `ai-sec-backend` on Railway.
- **Frontend Dashboard** (`/dashboard`): Next.js 14 (App Router) + React 18, Styled with Tailwind CSS 3.4, icons via Lucide. Deployed as `dashboard-production-cee3` on Railway.
- **Database**: PostgreSQL + pgvector (handling vector embeddings) with Row Level Security (RLS) enabled on all 20 data tables.

---

## 3. Directory Layout

The directory structure of SecretaryHQ is modular:

```
/
├── src/                    Fastify Backend API
│   ├── index.ts            Main server entry registering 26 route modules
│   ├── middleware.ts       JWT preHandlers, withHandler, logging, tenant security guards
│   ├── routes/             Fastify route handlers + routeHelpers.ts (incl. agentTools.ts)
│   ├── services/           Calendar sync, CRM integrations, reminders, communications
│   └── database/           Database pool setup + RLS-scoped per-tenant client factory
├── agent/                  LiveKit Voice Agent Worker (Node)
│   ├── src/                Worker entry, prompts, session contexts, and 12 agent tools
│   └── scripts/            LiveKit worker simulation scripts
├── dashboard/              Next.js 14 Frontend Application
│   ├── app/                App Router page views
│   ├── components/         60+ reusable React UI components
│   ├── lib/                API clients, global SessionContext, hook definitions, TS types
│   └── e2e/                Playwright End-to-End integration suite
├── shared/                 Cross-runtime TypeScript (Shared between Fastify & Next.js)
│   └── (Includes phone/name normalizers, scheduling utilities, embedding helpers)
├── supabase/
│   ├── migrations/         133 migration scripts representing full DB schema
│   └── seed.sql            Platform Admin + Bella's Hair Studio default demo setup
├── scripts/                Automation bash/node scripts (bootstrap, rebuild, QA, simulate)
└── docs/                   Full specification docs (architecture, status, deployment, TODO)
```

---

## 4. Key Building & Running Commands

Before running shell commands that modify the filesystem, provide a brief explanation of what the command does.

| Command                      | Scope / Context | Description                                                                                                |
| :--------------------------- | :-------------- | :--------------------------------------------------------------------------------------------------------- |
| **`npm run bootstrap`**      | Root            | Installs dependencies, sets up local Docker DB, runs migrations + seed, runs backend unit tests.           |
| **`npm start`**              | Root            | Starts all services (Dashboard on `https://localhost:4000`, Fastify API on `https://localhost:4001`).      |
| **`npm run db:migrate`**     | Root            | Runs `scripts/setup-db.sh` to apply pending database schema migrations.                                    |
| **`npm run db:seed`**        | Root            | Applies `supabase/seed.sql` to initialize local DB with demo tenants and admins.                           |
| **`npm run db:rebuild`**     | Root            | Resets local DB: drops public schema, re-applies all migrations, and runs seed. Add `--yes` for quiet run. |
| **`npm test`**               | Root            | Runs backend unit/integration tests with Vitest (no parallelization).                                      |
| **`npm run checks`**         | Root            | Runs full linting, formatting, and TypeScript compilation gates (Root + Dashboard).                        |
| **`npm run pre-pr`**         | Root            | Runs checks + tests locally to prepare a PR.                                                               |
| **`npm run prepare-commit`** | Root            | Automated gate suite ensuring code quality, test passes, and MD drift check before committing.             |
| **`npm run dev`**            | `dashboard/`    | Spins up Next.js dev server.                                                                               |
| **`npx vitest run`**         | `dashboard/`    | Runs React/Frontend component unit tests.                                                                  |
| **`npx playwright test`**    | `dashboard/`    | Runs playwright E2E. Use `--grep "<pattern>"` to target specific flows.                                    |

---

## 5. Development Workflow & Git Best Practices

- **Branching Strategy:** Work only on short-lived feature branches created off `main`. Use prefixes: `feat/`, `fix/`, `test/`, `refactor/`, `docs/`, `chore/`. Create branches using:
  ```bash
  npm run create-branch feat/your-branch-name
  ```
- **Checklist Tracking:** Copy `docs/BRANCH_CHECKLIST.md` to `.BRANCH_CHECKLIST.md` in the workspace root to check off tasks locally during development. Keep it up to date.
- **Staging & Commits:** Never run blanket commands like `git add .` or `git add -A`. Stage only files modified in the specific task. Ensure commit messages strictly follow **Conventional Commits**:
  ```
  feat(auth): add OAuth flow handler
  fix(booking): prevent double-booking timeslot race condition
  ```
- **Documentation Alignment:** If code/conventions drift, update relevant documentation. Ensure `npm run verify:claude-md` passes before committing, as it is a hard gate in CI.
- **Stale Binary Caveat:** Backend changes in `src/` require **both** `npm run build` and a server restart to take effect. If you run `vitest` unit tests directly, they load from source files immediately, while E2E tests run against the built/running JS binary in `dist/`. If you forget to build, tests may pass locally but fail in E2E.

---

## 6. Database Conventions (The Standard)

### Table & Column Naming

- **Plural, snake_case** for table names (e.g., `customers`, `appointments`, `employee_schedule`).
- **Lowercase snake_case** for all column names (e.g., `tenant_id`, `start_time`).
- **Composite or Natural Keys** are preferred for junction tables or tables where uniqueness is derived naturally from 1-2 stable columns.
- **Surrogate Keys** (`UUID`) are reserved for tables with complex lifecycles or those exposed in external systems and URLs.

### PK Column Standard

- **Every single-column PK must be named `<table_singular>_id`** (e.g., `customers.customer_id`, `appointments.appointment_id`, `reminder_schedules.reminder_schedule_id`), **never bare `id`**.
  - _Why:_ JOIN symmetry. Allows writing `JOIN customers USING (customer_id)` and prevents column name clashes when performing wildcard SELECTs across joins.
- **Junction tables:** Composite PKs (e.g. `(service_id, employee_id)`). No surrogate surrogate PK.
- **1:1 Extension tables:** Reuses the parent's PK as its own PK (which doubles as the FK) to enforce a strict "at-most-one" invariant.
- **Audit/Event logs:** Use `SERIAL PRIMARY KEY` for the log row's sequential id, but use `UUID` for any FK pointing at a domain entity.
- **TypeScript matching:** Use `string` for UUIDs, and `number` for SERIAL types.

### Wire / API Boundaries

- All API responses must maintain `snake_case` JSON fields end-to-end. Do not convert keys to camelCase.

---

## 7. Multi-Tenant Row Level Security (RLS)

RLS is strictly enforced on all 20 multi-tenant tables.

- **How it works:** Queries are automatically isolation-constrained by the database using `app.current_tenant_id`.
- **Backend Query Layer:** Avoid querying the raw pool directly for tenant-specific routes. Instead, instantiate the RLS-wrapped DB client helper in your route using `withTenantClient()` injected into the request:
  ```typescript
  const db = req.withTenantClient();
  const customer = await db.query('SELECT * FROM customers WHERE customer_id = $1', [id]);
  ```
- **Authentication & RLS Isolation:**
  1.  `tenantMiddleware` rejects any unauthenticated requests with a `401 Unauthorized` before tenant resolution is evaluated.
  2.  For authenticated requests, any user-supplied `tenant_id` (body or query) is compared against the JWT payload's authorized tenants list. Any mismatch is instantly blocked with a `403 Forbidden` (except for platform super-admins).

---

## 8. Development & Coding Principles

- **Test it or delete it:** We do not write "speculative" or "just-in-case" code. Integrations with external services must be fully testable against a real test harness.
- **Working flat code beats speculative abstractions:** Do not abstract interfaces too early. Keep code direct, readable, and flat. Extract shared functions or classes once three or more distinct consumers exist.
- **Tests own their own data:** The SQL seed script (`supabase/seed.sql`) is kept strictly minimal—only basic business templates, tenants, and configuration rows exist. Tests must create their mock/transactional data in `beforeAll()` / `beforeEach()` and wipe it in `afterAll()` / `afterEach()` to avoid state pollution.
- **Failures and 5W context:** Every unit, integration, or E2E test must include a **5W comment block** (Who, What, When, Where, Why) documenting real-world bugs or context behind assertions:
  ```typescript
  // WHO: DynaTire Caller | WHAT: Sent only "+1" as phone
  // WHEN: April 1 2026 call | WHERE: dispatcher.ts handleCallStarted
  // WHY: Vapi sends partial caller ID before full resolution
  expect(normalizePhone('+1')).toBeNull();
  ```
- **Test Fixtures ID Standard:** All UUID parameters in test files or mock data must be UUID-shaped string literals (e.g., `'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'`), never simple integers or short strings like `'1'`. This prevents `parseInt` bugs from escaping in-memory test mocks.

---

## 9. Observability & Health Indicators

- **Shallow Liveness:** `GET /health` reports simple process status (`{ status: "ok", started_at }`). It is public, fast, and does not hit the DB pool.
- **Deep Readiness:** `GET /ready` checks DB connectivity and reports pool status (`pool.total`, `pool.idle`, `pool.waiting`). Responds with `503 Service Unavailable` if database is unresponsive.
- **Metrics:** `GET /metrics` exposes Prometheus-compatible metrics, gated by the `METRICS_TOKEN` Bearer header. Under the hood, this monitors HTTP routes, duration histograms, tool invocation counts, and CRM sync dispatches.
- **Structured Logging:** All application events route through Pino. Enriched request payloads automatically inject `service`, `env`, `tenant_id`, and `call_id` where applicable.

---

## 10. Voice Agent & Tools Mechanics

- **SIP Triggering:** When an inbound call lands on Telnyx, the LiveKit SIP ingress triggers a Node worker instance under `/agent`. The tenant's identity is resolved from incoming SIP metadata.
- **Grok Voice Persona:** Deployed on LiveKit Cloud, using OpenAI for tools execution and `xAI Grok TTS` for the voice (`ara` model) with per-tenant speed and soft characteristics fetched from `tenants.tts_voice`.
- **Agent Tool Gating:** Agent tools exposed at `/agent-tools/*` require an `x-agent-secret` header. Success/failure states are transmitted as `{ success: true, result }` or `{ success: false, error }` with a HTTP 200 status so the LLM handles both results gracefully.
- **Local Simulation Testing:** The repository includes a robust local simulation suite in `./scripts/simulate.sh`:
  - `./scripts/simulate.sh status` — System health board across local backend, agent, and dashboard.
  - `./scripts/simulate.sh tools` — Simulates a real user-to-agent tool transaction journey.
  - `./scripts/simulate.sh rag` — Accuracy verification script querying the Fastify policy vector engine.
  - `./scripts/simulate.sh call` — Launches the LiveKit worker locally and generates a browser URL so you can talk to the voice assistant directly from your microphone.
