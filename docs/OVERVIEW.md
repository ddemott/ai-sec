# AI Secretary SaaS – One-Page Overview

This is a high-level, human-readable overview of the AI Secretary SaaS for collaborators who want to understand **what it does** and **how it hangs together** without reading all of the detailed docs.

---

## What This System Does

- **Voice AI Reception**: Answers inbound calls with a low-latency, human-like voice (Vapi).
- **Grounding (RAG)**: Answers business-specific questions using a Knowledge Base built from uploaded PDFs.
- **Atomic Booking**: Checks availability and books appointments instantly while respecting staff shifts and expertise.
- **Performance Analytics**: Tracks call volume, booking conversion, and estimated revenue.
- **Multi-Tenant Dashboard**: Provides owners with a control center for staff, resources, and AI settings.

---

## Main Components & Verification

- **100% Test Pass Rate**: All core logic is verified across Vitest (UI) and Deno (Backend).
- **Postgres (Supabase)**: Single source of truth with Row-Level Security (RLS) for tenant isolation.
- **Supabase Edge Function (`vapi-tools`)**:
  - `getCustomerContext` – CRM history lookup.
  - `checkAvailability` – Multi-resource overlap checks.
  - `bookAppointment` – Shift-aware atomic booking.
  - `getCompanyPolicyAnswer` – Semantic search over business docs.
- **Fastify Backend (Helper API)**: Handles administrative tasks, document ingestion, and analytics.
- **Dashboard (Next.js)**: 
  - **Knowledge Base**: PDF/Text upload for RAG training.
  - **Shift Manager**: Employee working hours and availability.
  - **Skill Matrix**: Grid for matching staff expertise to resource capabilities.
  - **ROI Analytics**: Business performance monitoring.
- **Async Layer (n8n)**:
  - Post-call summarization and sentiment analysis.
  - Calendar Sync (Google/Outlook).

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

- **Backend (Jest)**: `npm test`
- **Dashboard (Vitest)**: `cd dashboard && npm test`
- **Edge Functions (Deno)**: `deno task test --no-check`

For a deeper dive, see:
- [docs/ARCHITECTURE.md](ARCHITECTURE.md) – Detailed architecture.
- [docs/PLAN.md](PLAN.md) – Development roadmap.
- [docs/HOW_TO_SETUP.md](HOW_TO_SETUP.md) – Step-by-step setup.
