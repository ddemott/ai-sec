# AI Secretary SaaS

A multi-tenant AI reception platform for service businesses (tire shops, salons, auto repair, fitness studios, and more). An AI receptionist answers inbound calls 24/7, books appointments, answers policy questions via RAG, and syncs with the owner's dashboard — no missed calls.

## Quick Start

### 1. Bootstrap the Environment
Ensure Docker is running, then:
```bash
npm run bootstrap
```
This installs dependencies, starts the database, applies all migrations, and seeds initial data.

### 2. Trust the Backend Certificate
The backend uses HTTPS with self-signed certificates:
- Visit: [https://localhost:3000/health](https://localhost:3000/health)
- Click **Advanced** > **Proceed to localhost (unsafe)**
- You should see `{"status":"ok"}`

### 3. Start the Stack
```bash
npm start
```
- **Dashboard:** [https://localhost:3001](https://localhost:3001)
- **Backend API:** [https://localhost:3000](https://localhost:3000)

### 4. Sign In
- **Email:** `dale@ai-sec.com`
- **Password:** `password`

### 5. Load Demo Data (optional)
Reset the database with 3 realistic businesses:
```bash
./scripts/reset-and-seed.sh
```

| Email | Business | Password |
|-------|----------|----------|
| `dale@ai-sec.com` | Super Admin | `password` |
| `admin@dynatire.com` | DynaTire (tire shop) | `password` |
| `bella@bellashair.com` | Bella's Hair Studio (salon) | `password` |
| `owner@quickfixauto.com` | QuickFix Auto Repair | `password` |

## What It Does

- **Voice AI Reception**: Answers inbound calls with a low-latency, human-like voice via Vapi. Greets callers, identifies intent, and handles the conversation end-to-end.
- **Two-Layer Knowledge**: Database tool calls for facts (pricing, availability, booking) with zero hallucination. RAG over uploaded PDFs for policies (cancellation, service area, payment terms).
- **Atomic Booking**: Checks availability and books appointments instantly while respecting staff shifts, expertise, and resource capabilities. DST-safe, race-condition-proof.
- **Multi-Tenant Dashboard**: Owners manage staff, resources, services, AI persona, and knowledge base. Vocabulary adapts to business type (Bays/Technicians for tire shops, Chairs/Stylists for salons).
- **Scheduler**: Staff swimlane view, resource columns view, appointment list view. Quick book panel for walk-ins. Employee day focus with utilisation stats.
- **CRM**: Searchable customer profiles with appointment history, call summaries, transcripts, and internal notes.
- **Coverage Visibility**: Coverage gaps are visible throughout the UI — scheduler, services list, skill map, and setup wizard.
- **Analytics**: Call volume, booking conversion, and estimated revenue tracking.
- **Async Automation**: Post-call summarization, sentiment analysis, and Google Calendar sync via n8n workflows.

## Architecture at a Glance

- **Voice Pipeline**: Telnyx (telephony) > Vapi (orchestrator, STT/LLM/TTS) > Supabase Edge Function (Deno) > Postgres
- **Backend**: Fastify with 15 route modules under `src/routes/`, JWT auth, RLS enforcement via `withTenantClient()`
- **Dashboard**: Next.js 14 (App Router) + Tailwind CSS + TypeScript, 5 grouped navigation sections
- **Database**: PostgreSQL + pgvector, Row Level Security for multi-tenancy, atomic booking RPCs
- **Async Workers**: n8n workflows for post-call summaries, calendar sync, SMS notifications
- **Billing**: Stripe Checkout with subscription gate middleware (Solo $129/mo, Growth $279/mo, Professional $449/mo)

See `docs/ARCHITECTURE.md` for the full technical deep-dive.

## Project Structure

- `/src` — Fastify backend (15 route modules under `src/routes/`, middleware layer)
- `/src/middleware.ts` — withHandler decorator, tenant middleware, structured logging
- `/dashboard` — Next.js 14 frontend (Front Desk / Back Office two-tab navigation)
- `/supabase/functions/vapi-tools` — Deno Edge Functions (voice AI tool handlers)
- `/supabase/migrations` — 55 SQL migrations
- `/shared` — Cross-runtime code (getEmbedding, scheduling, normalizer)
- `/scripts` — Automation (bootstrap, deploy, reset-seed, preflight, smoke tests)
- `/docs` — Architecture, plans, decisions, deployment guide, mockups

## Infrastructure

- **Database**: PostgreSQL + pgvector (Docker, port 5433). All IDs are UUID.
- **Multi-tenancy**: Row Level Security on all tables. `withTenantClient()` enforces RLS.
- **Auth**: JWT (8h expiry), bcrypt password hashing, auto-logout on stale sessions.
- **Input Validation**: Zod schemas at API boundaries; CHECK constraints on JSONB metadata.
- **Least-Privilege DB**: `api_user` role has explicit per-table grants (not `ALL PRIVILEGES`).
- **Test Isolation**: Dedicated `test_db` with savepoint-based isolation.
- **Ports**: Backend (3000), Dashboard (3001), Postgres (5433).

## Database Management

```bash
# Re-apply migrations + seed
./scripts/setup-db.sh

# Cloud deployment (with preflight check)
./scripts/preflight-cloud.sh "postgres://user:pass@host:5432/dbname"
./scripts/setup-db.sh "postgres://user:pass@host:5432/dbname"
```

## Testing

**624 tests passing** (256 backend + 368 dashboard) in ~20 seconds. Savepoint-based isolation — each test rolls back, no TRUNCATE overhead. 12 shared test helpers in `src/test-utils.ts`.

```bash
# Backend
npm test

# Dashboard
cd dashboard && npx vitest run

# Edge Functions
deno task test --no-check
```

## Deployment

```bash
# 1. Copy and fill in environment variables
cp .env.production.example .env.production

# 2. Run the full deployment
./scripts/deploy-production.sh .env.production
```

See `docs/DEPLOYMENT.md` for the detailed step-by-step guide.

## Key Features

- **29 business types** across 6 categories with per-type vocabulary
- **Outlook-style scheduler** with three view modes and quick booking
- **Service Staffing Map** — per-service, per-hour employee availability heatmap
- **Unified CRM** — customer detail with appointments, call history, notes
- **Skill Relationship Map** — interactive 3-column employee > service > resource view
- **6-step setup wizard** — repeatable, re-enterable, with live coverage feedback
- **Two-layer knowledge** — database facts (zero hallucination) + RAG for policies
- **Contextual feedback** — in-app feedback button on every page
- **Theme system** — 8 themes with CSS custom properties
- **Stripe billing** — subscription gate with 3 plan tiers
