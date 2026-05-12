# Secretary HQ

**AI receptionist for service businesses.** Answers calls 24/7, books appointments, answers policy questions, and syncs everything to the owner's dashboard. No missed calls, no hold music, no voicemail.

Built for tire shops, salons, auto repair, fitness studios, trades, and food & beverage businesses.

---

## Status

| | |
|---|---|
| **Phase** | 13 — Production Readiness |
| **Backend** | Live on Railway (`ai-sec-production.up.railway.app`) |
| **Dashboard** | Live on Railway (`dashboard-production-cee3.up.railway.app`); set `DASHBOARD_URL` on backend Railway service for Stripe/OAuth redirects |
| **Voice AI** | Migrated to LiveKit Agents (Telnyx → LiveKit Cloud → Deepgram/OpenAI). Awaiting first live call to confirm carrier propagation — see `docs/TICKET_SUPPORT.md` |
| **Phone** | Provisioned via Telnyx (`+1-630-937-9478`) — see `docs/TICKET_SUPPORT.md` for current LERG status |
| **Tests** | 2,486 passing (1,781 backend + 620 dashboard + 85 agent) + 0 skips, zero TypeScript errors |
| **E2e** | 71 Playwright tests + 29 live QA tool calls (88 assertions) |

See `docs/TODO.md` for remaining work and `docs/CURRENT_STATUS.md` for detailed session history.

---

## What It Does

- **Voice AI Reception** — Answers inbound calls with a low-latency, human-like voice. Greets callers, identifies intent, books appointments, answers policy questions, and handles rejections naturally.
- **Atomic Booking** — Checks staff shifts, expertise, resource capabilities, and timeslot availability in a single database transaction. DST-safe; concurrent-call-safe via GiST exclusion constraints on `(resource_id, time-range)` and `(employee_id, time-range)` so the find-then-insert race surfaces as `TIMESLOT_OCCUPIED` rather than a double-booking. Specific error codes (TIMESLOT_OCCUPIED, NO_SKILLED_EMPLOYEE, EMPLOYEE_NOT_SCHEDULED) drive the agent's spoken response.
- **Two-Layer Knowledge** — Database tool calls for facts (pricing, availability) with zero hallucination. RAG over uploaded documents (PDF/TXT/DOC/DOCX/MD) for policies (cancellation, service area, payment terms).
- **Multi-Tenant Dashboard** — Owners manage staff, resources, services, shifts, AI persona, and knowledge base. Vocabulary adapts per business type (Bays/Technicians for tire shops, Chairs/Stylists for salons).
- **Scheduler** — Staff swimlane view (24hr, zoom), resource columns, appointment list, calendar sub-view. Quick book panel for walk-ins. Employee day focus with utilisation stats.
- **CRM** — Searchable customer profiles with appointment history, call summaries, transcripts, and internal notes.
- **Calendar Sync** — Google Calendar and Outlook Calendar OAuth integration. Appointments auto-sync on create, update, delete, and cancel.
- **CRM Integrations** — Bidirectional sync with Jobber (GraphQL), HubSpot (REST v3), Square (REST v2), and ServiceTitan (REST v2). OAuth flows, webhook receivers, timestamp-based conflict resolution.
- **Coverage Visibility** — Gaps shown across scheduler, services list, skill map, and setup wizard.
- **Analytics** — Busiest hours, return rate, and no-show patterns from booking data.
- **Billing** — Stripe Checkout with subscription gate (Solo $129/mo, Growth $279/mo).

---

## Architecture

```
Inbound Call
    |
Telnyx (carrier + SIP trunk) --> LiveKit Cloud (SIP ingress)
                                          |
                                LiveKit Agent worker (Node)
                                — Deepgram (STT)
                                — OpenAI (LLM + TTS today; xAI Grok TTS Phase 4)
                                          |
                                Fastify /agent-tools/* (26 route modules)
                                          |
                                PostgreSQL + pgvector (RLS multi-tenancy)
                                          |
                                Next.js 14 Dashboard
```

| Layer | Tech |
|-------|------|
| **Voice** | Telnyx (carrier + SIP trunk), LiveKit Cloud (orchestrator), Deepgram Nova-3 (STT), OpenAI GPT-4o-mini (LLM), xAI Grok TTS (default voice `ara`; OpenAI TTS retained as `runFallback()` dead-air guard) |
| **Backend** | Fastify 4.x, 26 route modules, JWT auth via `registerJwtAuthHook` in `src/middleware.ts`, Zod validation, RLS via `withTenantClient()` (factory in `src/database/index.ts`) |
| **Frontend** | Next.js 14 (App Router), Tailwind CSS 3.4, TypeScript, Lucide icons |
| **Database** | PostgreSQL + pgvector, 106 migrations, Row Level Security, atomic booking RPCs with GiST exclusion constraints to close the find-then-insert race |
| **Agent runtime** | LiveKit Agents (Node) deployed on Railway as `ai-sec-agent`; tools at Fastify `/agent-tools/*` (10 routes) |
| **Async** | Inline in Fastify routes (post-call summaries, calendar sync, SMS) |
| **Billing** | Stripe Checkout, webhook (3 events), subscription gate middleware |
| **Security** | @fastify/helmet, @fastify/rate-limit, CORS restriction, bcrypt, FORCE RLS |

See `docs/ARCHITECTURE.md` for the full technical deep-dive.

---

## Quick Start

### Prerequisites
- Node.js 20+
- Docker (for local PostgreSQL)
- npm

### 1. Bootstrap (full local setup)
```bash
npm run bootstrap
```
Installs dependencies, starts Docker DB, applies all migrations, seeds demo data, and runs tests.

### 2. Database Only (migrations + seed separately)
```bash
# Apply schema migrations (works with any Postgres — local, Supabase, Railway)
npm run db:migrate                              # uses DATABASE_URL from .env
npm run db:migrate -- "postgres://user:pass@host:5432/db"  # explicit URL

# Seed demo data (platform admin + DynaTire tenant)
npm run db:seed                                 # uses DATABASE_URL from .env
npm run db:seed -- "postgres://user:pass@host:5432/db"     # explicit URL
```

### 3. Trust the Backend Certificate
The backend uses HTTPS with self-signed certificates:
- Visit [https://localhost:4001/health](https://localhost:4001/health)
- Click **Advanced** > **Proceed to localhost**
- You should see `{"status":"ok"}`

### 4. Start
```bash
npm start
```
| Service | URL |
|---------|-----|
| Dashboard | https://localhost:4000 |
| Backend API | https://localhost:4001 |

### 5. Sign In

Default credentials are created by the seed script. See `supabase/seed.sql` for details.

---

## Project Structure

```
/
├── src/                    Fastify backend
│   ├── index.ts            Entry point (26 route registrations)
│   ├── middleware.ts        withHandler, tenant middleware, structured logging
│   ├── routes/             26 route modules + shared routeHelpers.ts (incl. agentTools.ts for the LiveKit agent)
│   ├── services/           CRM sync, calendar sync, token management, telnyxNumbers + telnyxSms
│   └── database/           DatabaseService interface + Postgres implementation
├── agent/                  LiveKit Agents worker (Node) — Deepgram STT + OpenAI LLM/TTS
│   └── src/                Worker entry, session context, prompt, tool client
├── dashboard/              Next.js 14 frontend
│   ├── components/         60+ components (scheduler, CRM, settings, wizard)
│   ├── lib/                API client, hooks, types, SessionContext
│   └── e2e/                Playwright tests
├── supabase/
│   ├── migrations/         83 SQL migrations
│   └── seed.sql            Platform admin + DynaTire demo tenant
├── shared/                 Cross-runtime code (embeddings, scheduling)
├── scripts/                Automation (bootstrap, setup-db, seed-db, deploy, QA)
└── docs/                   Architecture, plans, deployment, design, TODO
```

---

## Testing

```bash
npm test                              # Backend (1,479 tests)
cd dashboard && npx vitest run        # Dashboard (498 tests)
cd dashboard && npx playwright test   # E2e (19 Playwright tests)
python scripts/qa-live-test.py        # Live QA (29 tool calls, 88 assertions)
```

### Coverage

| Area | Tests |
|------|-------|
| Backend routes (25 modules) | ~700 |
| Backend services (16 files) | ~450 |
| Middleware, scheduling, constants | ~100 |
| CRM sync (4 providers + shared helpers) | ~240 |
| Dashboard components + views | 465 |
| Playwright e2e | 19 |
| Live QA (production edge function) | 29 calls / 88 assertions |

### Test Philosophy

Every test covers both happy and sad paths. Sad paths include **5W diagnostic context** (Who, What, When, Where, Why) so failures are immediately debuggable:

```typescript
it('should reject country-code-only "+1" (BUG-060 root cause)', () => {
  // WHO: DynaTire caller | WHAT: Vapi sent only "+1" as phone
  // WHEN: April 1 2026 test call | WHERE: dispatcher.ts handleCallStarted
  // WHY: Vapi sometimes sends partial caller ID before full number resolves
  expect(normalizePhone('+1')).toBeNull();
});
```

---

## Infrastructure

| Concern | Implementation |
|---------|---------------|
| **Multi-tenancy** | Row Level Security on all tables, `FORCE ROW LEVEL SECURITY` enforced |
| **Auth** | JWT (8h expiry), bcrypt, auto-logout on 401, token refresh endpoint |
| **Security** | Helmet headers, rate limiting (100 req/min, 5/5min on login), CORS |
| **Validation** | Zod schemas at API boundaries, CHECK constraints on JSONB |
| **Deadlock prevention** | Pool timeouts (statement 30s, lock 10s, idle-txn 60s), sequential test execution |
| **Mutation safety** | `assertRowAffected()` guard on all UPDATE/DELETE — zero-row ops return 404 |
| **CRM sync** | Shared `syncMapHelpers.ts`, timestamp-based merge, `withSyncContext()` for version tracking |

---

## Deployment

Backend is live on Railway. Dashboard deployment pending.

```bash
cp .env.production.example .env.production   # Fill in env vars
./scripts/deploy-production.sh .env.production
```

See `docs/DEPLOYMENT.md` for the step-by-step guide.

---

## Key Features

| Feature | Details |
|---------|---------|
| 29 business types | 6 categories with per-type vocabulary |
| Scheduler | Staff swimlanes, resource columns, list view, calendar, quick book |
| Skill relationship map | Interactive 3-column employee > service > resource view |
| 7-step setup wizard | Repeatable, re-enterable, live coverage feedback, phone activation |
| 8 themes | Light, dark, midnight, nord, sunset, forest, high-contrast, solarized |
| Stripe billing | Solo ($129/mo) + Growth ($279/mo), subscription gate |
| Calendar sync | Google + Outlook, OAuth, auto-sync on all mutations |
| CRM integrations | Jobber + HubSpot + Square + ServiceTitan, bidirectional sync |
| Knowledge base | 40 policy Q&A pairs, document upload, RAG via pgvector |
| Contextual feedback | In-app feedback button on every page |
| Playwright e2e | 19 tests covering critical fixes and functional audit |

---

## Documentation

| Doc | Purpose |
|-----|---------|
| `CLAUDE.md` | Developer conventions, code patterns, project context |
| `docs/TODO.md` | Unified task list — all remaining work |
| `docs/ARCHITECTURE.md` | Full technical architecture deep-dive |
| `docs/DIAGRAMS.md` | Mermaid diagrams (deployment, voice flow, booking, OAuth, etc.) |
| `docs/DEPLOYMENT.md` | Step-by-step deployment guide |
| `docs/CURRENT_STATUS.md` | Current-state snapshot — what's working, what's broken |
| `docs/DESIGN_HANDOFF.md` | Visual brand system + design decisions (frozen — March 24 session) |
| `docs/UI_UX_DESIGN.md` | Living design brief — interaction design + UX principles |
| `docs/PLAN.md` | Historical phases (1-12) + post-launch backlog |
| `docs/BUGS.md` | Historical bug tracker (72 bugs + 47 UX items, all resolved) |
| `docs/FRAMEWORK_MIGRATIONS.md` | Migration index — Vapi→LiveKit (shipped), Edge→Fastify (shipped), OpenAI TTS→Grok (pending) |
| `NEEDS-REFACTORING.md` | Code-cleanup backlog — dormant layers, dead code, conventions to enforce |
| `docs/IMPROVEMENT_IDEAS.md` | Curated review-phase backlog (~160 tasks, 10 phases, 2026-04-10/11) |

---

## License

Proprietary. All rights reserved.
