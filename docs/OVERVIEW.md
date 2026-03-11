# AI Secretary SaaS – One-Page Overview

This is a high-level, human-readable overview of the AI Secretary SaaS for collaborators who want to understand **what it does** and **how it hangs together** without reading all of the detailed docs.

---

## What This System Does

- Answers inbound calls for appointment-driven businesses (e.g., mobile tire, salons, auto shops).
- Speaks with a low-latency, human-like voice via a voice AI orchestrator (Vapi).
- Books, reschedules, and cancels appointments in an internal calendar.
- Maintains per-tenant CRM and call history so the AI can "remember" callers.
- Exposes a multi-tenant dashboard for owners and a SuperAdmin.

---


## Main Components & Test Coverage

- **All tests pass:** backend, dashboard, edge logic. AppointmentView and dashboard calendar logic are fully verified.
- **Postgres (Supabase)** – Single source of truth for:
  - Tenants, resources (bays/trucks/chairs), customers, appointments.
  - Call summaries (for memory) and audit tables.
  - Row-Level Security (RLS) enforces tenant isolation.
- **Supabase Edge Function – `vapi-tools`**
  - Deno function that receives **Vapi tool calls** (HTTP POST with `x-vapi-secret`).
  - Dispatches to `AISecretaryService` methods:
    - `getCustomerContext` – look up customer + recent summaries.
    - `checkAvailability` – overlap checks for a resource/time window.
    - `bookAppointment` – atomic booking via Postgres RPC.
  - Uses a `PostgresRepository` to talk to the DB with tenant context set.
- **Fastify Backend (Helper API)**
  - Lives in `src/index.ts`.
  - Provides:
    - `/login` – authenticates against `authenticate_user(...)` in Postgres and returns `tenant_id`/`user_id`.
    - `/tenants`, `/tenants/create`, `/tenants/:id` – SuperAdmin tenant management.
    - `/appointments` and related admin endpoints.
  - Used primarily by the dashboard; does **not** handle live calls.
- **Dashboard (Next.js, `dashboard/`)**
  - Multi-tenant management UI for owners and SuperAdmin.
  - Key views:
    - Appointment calendar + editor (with confirmation modal and multi-resource support).
    - CRM/customer detail view.
    - Settings (AI persona, business metadata, resources).
    - SuperAdmin launchpad to create/delete tenants from templates.
  - Talks to the Fastify backend, which in turn talks to the same Postgres DB.
- **Async / Background (n8n)**
  - Handles latency-tolerant work:
    - Post-call summarization + embeddings into `call_summaries`.
    - Planned: calendar sync (Google/Outlook), owner SMS notifications, tenant knowledge ingestion.

## Runtime Surfaces

- **Live Calls**
  - Telnyx → Vapi (voice orchestration) → Supabase Edge Function (`/vapi-tools`) → Postgres.
- **Owner / Staff UI**
  - Browser → Vercel-hosted (or local) Next.js dashboard → Fastify backend → Postgres.
- **Async Workflows**
  - Supabase Database Webhooks → n8n workflows → Postgres (and external APIs like OpenAI, calendars, SMS).

All three surfaces share the **same database per environment**, so bookings and CRM stay consistent.

---

## Data & Multi-Tenancy

- Multi-tenancy is modeled explicitly in the schema (`tenants`, `resources`, `customers`, `appointments`).
- RLS and a `set_tenant_context(...)` helper ensure that:
  - Edge tools run in the correct tenant context.
  - Dashboard users only see their own data.
- Vertical-specific details (vehicle info, services, policies) are stored in JSONB `metadata` fields and/or future `tenant_docs` tables, keeping the core schema generic.
- Resources (stylists, bays, rooms, trucks) and employees (stylists, technicians, clinicians) can declare capabilities/skills and be managed per-tenant via admin screens so owners can adapt as people, equipment, and services change.

---

## Typical Call Flow (Happy Path)

1. Caller dials a Telnyx number for a tenant (e.g., DynaTire).
2. Telnyx forwards the call to Vapi; Vapi runs STT/LLM/TTS.
3. The LLM decides to use a tool:
   - `get_customer_context` to see if this is a returning caller.
   - `check_availability` to propose appointment times.
   - `book_appointment` once the caller confirms.
4. Vapi calls the Supabase Edge Function (`/vapi-tools`) with a JSON payload describing the tool call.
5. The Edge function:
   - Validates and logs the request.
   - Calls into `AISecretaryService` which uses `PostgresRepository`.
   - Executes `book_appointment_atomic(...)` in Postgres.
6. The result (success/slot conflict/etc.) flows back up to the LLM, which responds naturally to the caller.
7. Separately, a DB webhook can trigger n8n to summarize the call and update analytics.

---

## Local Dev & Testing (Very Short)

- **Backend tests**: from repo root

  ```bash
  npm test
  ```

  - DB-backed cases talk directly to Postgres at `localhost:5433` and auto-skip if the DB is down.

- **Dashboard tests**:

  ```bash
  cd dashboard
  npm test
  ```

- **Edge + Schema tests (Deno)**:

  ```bash
  deno task test
  ```

  Requires Postgres reachable at `DATABASE_URL` (same schema/migrations as Supabase).

For a deeper dive, see:
- [README.md](../README.md) – Project journal & current status.
- [docs/ARCHITECTURE.md](ARCHITECTURE.md) – Detailed architecture.
- [docs/HOW_TO_SETUP.md](HOW_TO_SETUP.md) – Step-by-step setup.
- [docs/N8N_WORKFLOWS.md](N8N_WORKFLOWS.md) – Async workflow designs.
