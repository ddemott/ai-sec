# AI Secretary SaaS – One-Page Overview

This is a high-level, human-readable overview of the AI Secretary SaaS for collaborators who want to understand **what it does** and **how it hangs together** without reading all of the detailed docs.

---

## What This System Does

- **Voice AI Reception**: Answers inbound calls with a low-latency, human-like voice (Vapi).
- **Grounding (RAG)**: Answers business-specific questions using a Knowledge Base built from uploaded PDFs.
- **Atomic Booking**: Checks availability and books appointments instantly while respecting staff shifts, expertise, and resource capabilities.
- **Performance Analytics**: Tracks call volume, booking conversion, and estimated revenue.
- **Multi-Tenant Dashboard**: Provides owners with a control center for staff, resources, and AI settings.

---

## Main Components & Verification

- **598 Tests Passing**: 229 backend + 369 dashboard tests verified via Vitest.
- **Postgres (Supabase)**: Single source of truth with Row-Level Security (RLS) for tenant isolation.
- **Supabase Edge Function (`vapi-tools`)**:
  - `getCustomerContext` – CRM history lookup.
  - `checkAvailability` – Multi-resource overlap checks.
  - `bookAppointment` – Shift-aware atomic booking with auto end-time calculation.
  - `getCompanyPolicyAnswer` – Semantic search over business docs with RAG normalization.
- **Fastify Backend (Management API)**: JWT-authenticated, RLS-enforced routes (15 modules under `src/routes/`) including billing, coverage, vocabulary, registration, and all CRUD operations.
- **Dashboard (Next.js)**:
  - **Dashboard Home**: At-a-glance stats, coverage alerts, today's appointments, quick actions.
  - **Scheduler**: Staff swimlanes, resource columns, appointment list, quick book, employee day focus.
  - **Skill Relationship Map**: Interactive 3-column mind map (employees → skills → resources) with click-to-connect.
  - **Setup Wizard**: 6-step repeatable guided setup with live coverage feedback.
  - **Coverage Visibility**: Status badges and coverage bars throughout the UI.
  - **Service Staffing Map**: GET /coverage/staffing endpoint with ServiceCoverageView showing staff-to-service coverage.
  - **Vocabulary System**: Business-type-aware labels (Truck/Technician for tire shops, Chair/Stylist for salons).
  - **Theme System**: 8 themes (light, dark, midnight, nord, sunset, forest, high-contrast, solarized).
  - **Stripe Lite**: Checkout integration for Solo ($129/mo) and Growth ($279/mo) plans.
- **Async Layer (n8n)**:
  - Post-call summarization and sentiment analysis.
  - Calendar Sync (Google; Outlook planned).

## Runtime Surfaces

- **Live Voice Loop**: Telnyx → Vapi → Supabase Edge Function → Postgres.
- **Management UI**: Next.js Dashboard → Fastify Backend → Postgres.
- **Automation**: Supabase Webhooks → n8n → External APIs (Calendars, SMS, OpenAI).

---

## Data & Multi-Tenancy

- **Multi-Tenancy**: Built into the core schema; RLS ensures no data leakage between businesses.
- **Dynamic Config**: System prompts, voices, and pricing models are configurable per-tenant.
- **Semantic Memory**: `pgvector` powers both customer history recall and the business knowledge base.

---

## Security

- **JWT Authentication**: 8-hour token expiry, auto-logout on 401.
- **RLS Enforcement**: Fastify uses `withTenantClient()` to enforce row-level security on every query.
- **Input Validation**: Zod schemas at API boundaries; CHECK constraints on JSONB metadata.
- **Least-Privilege DB**: `api_user` role has explicit per-table grants (not `ALL PRIVILEGES`).

---

## Typical Call Flow

1. Caller dials the business number (e.g., DynaTire).
2. Vapi runs the voice loop; LLM identifies a question about "Cancellation Policy."
3. Vapi calls the Edge Function tool `get_company_policy_answer`.
4. Edge Function searches `tenant_docs` via semantic vector search.
5. AI reads the relevant policy snippet back to the caller.
6. Caller books an appointment; AI verifies the technician is on-shift and the bay is free.
7. Postgres writes the booking; Webhook triggers n8n to sync the owner's Google Calendar.

---

## Local Dev & Testing

```bash
# Backend tests (Vitest)
npx vitest run src/ --fileParallelism=false

# Dashboard tests (Vitest)
cd dashboard && npx vitest run

# Edge Functions (Deno)
export DATABASE_URL=postgres://postgres:postgres@localhost:5433/test_db
deno task test --no-check
```

For a deeper dive, see:
- [docs/ARCHITECTURE.md](ARCHITECTURE.md) – Detailed architecture.
- [docs/PLAN.md](PLAN.md) – Development roadmap.
- [docs/HOW_TO_SETUP.md](HOW_TO_SETUP.md) – Step-by-step setup.
