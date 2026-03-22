# AI Secretary SaaS

A multi-tenant AI reception platform for service businesses. An AI receptionist answers inbound calls, books appointments, answers policy questions via RAG, and syncs with the owner's dashboard — 24/7, no missed calls.

## 🚀 Quick Start (Local Development)

### 1. Bootstrap the Environment
Ensure Docker is running, then run:
```bash
npm run bootstrap
```
This installs dependencies, starts the database, applies all migrations, and seeds the initial data.

### 2. Trust the Backend Certificate
Because the backend uses HTTPS with self-signed certificates, you must trust it in your browser:
- Visit: [https://localhost:3000/health](https://localhost:3000/health)
- Click **Advanced** -> **Proceed to localhost (unsafe)**.
- You should see `{"status":"ok"}`.

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

## 🛠 Project Structure
- `/src` — Fastify backend (15 route modules under `src/routes/`, middleware layer)
- `/src/middleware.ts` — withHandler decorator, tenant middleware, structured logging
- `/dashboard` — Next.js 14 frontend (Front Desk / Back Office two-tab navigation)
- `/supabase/functions/vapi-tools` — Deno Edge Functions (voice AI tool handlers)
- `/supabase/migrations` — 54 SQL migrations
- `/shared` — Cross-runtime code (getEmbedding, scheduling, normalizer)
- `/scripts` — Automation (bootstrap, deploy, reset-seed, preflight, smoke tests)
- `/docs` — Architecture, plans, decisions, deployment guide, mockups

## 🛠 Infrastructure
- **Database**: PostgreSQL + pgvector (Docker, port 5433). All IDs are UUID.
- **Multi-tenancy**: Row Level Security on all tables. `withTenantClient()` enforces RLS.
- **Auth**: JWT (8h expiry), bcrypt password hashing, auto-logout on stale sessions.
- **Test Isolation**: Dedicated `test_db` with savepoint-based isolation.
- **Ports**: Backend (3000), Dashboard (3001), Postgres (5433).

## 🐘 Database Management
```bash
# Re-apply migrations + seed
./scripts/setup-db.sh

# Cloud deployment (with preflight check)
./scripts/preflight-cloud.sh "postgres://user:pass@host:5432/dbname"
./scripts/setup-db.sh "postgres://user:pass@host:5432/dbname"
```

## 🧪 Testing
- **612 tests passing** (244 backend + 368 dashboard) in ~20 seconds.
- Savepoint-based isolation — each test rolls back, no TRUNCATE overhead.
- 12 shared test helpers in `src/test-utils.ts` for DRY setup.
```bash
# Backend
npm test

# Dashboard
cd dashboard && npx vitest run

# Edge Functions
deno task test --no-check
```

## 🚀 Production Deployment
```bash
# 1. Copy and fill in environment variables
cp .env.production.example .env.production

# 2. Run the full deployment
./scripts/deploy-production.sh .env.production
```

See `docs/DEPLOYMENT.md` for detailed step-by-step guide.

## 📊 Key Features
- **29 business types** across 6 categories with per-type vocabulary
- **Outlook-style scheduler** — drag to create/resize/move shifts
- **Service Staffing Map** — per-service, per-hour employee availability heatmap
- **Unified CRM** — customer detail with appointments, call history, notes
- **Skill Relationship Map** — interactive 3-column employee → service → resource view
- **Two-layer knowledge** — database facts (zero hallucination) + RAG for policies
- **Contextual feedback** — in-app feedback button on every page
- **Theme system** — 8 themes with CSS custom properties
