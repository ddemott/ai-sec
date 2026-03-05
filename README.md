# AI Secretary SaaS – Project Journal

This repository contains a multi-tenant **AI Secretary SaaS** built with a **Serverless / Edge-First** architecture, starting with a proof of concept for **DynaTire** (a mobile tire repair business).

This README acts as a **living journal**:
- What we decided and why
- What has been built so far
- What comes next

For the high-level mission and product intent, see [docs/MISSION_STATEMENT.md](docs/MISSION_STATEMENT.md).

For the detailed technical plan, see [docs/PLAN.md](docs/PLAN.md).

For a deeper technical view of the architecture (Edge, Postgres, Orchestration), see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## 1. High-Level Vision

- Answer phone calls for small businesses with an AI that sounds human and "remembers" them.
- Collect the right information and **book/change/cancel appointments** instantly.
- **Zero-Scale Infrastructure**: Only pay when a call is happening.
- **Ultra-Low Latency**: Conversations that feel real-time and natural.

---

## 2. Tech Stack (Current Decisions)

- **Backend**: **Supabase Edge Functions (Deno)** for ultra-fast "Tool" logic.
- **Voice AI Orchestration**: **Vapi** or **Retell AI**.
- **Telephony**: **Telnyx** (connected via Orchestrator).
- **AI Models**:
  - LLM: **Groq (Llama 3)** for voice; **GPT-4o-mini** for summaries.
  - TTS: **Cartesia** or **Deepgram Aura**.
- **Storage**: **Supabase (Postgres + pgvector)**.
- **Testing**: **Vitest** for integration/schema/tool TDD.
- **Workflows**: **n8n** for async background sync.

---

## 3. Current Implementation Status

**Core Strategy Shift**
- Pivoted from a centralized Fastify server to an **Edge-First / Serverless** model.
- Decoupled high-latency external APIs from the voice conversation using n8n.

**Data Model & Storage (Phase 1 & 2 Complete)**
- **SQL Schema**: Tenants, Resources, Customers, Appointments, and Call Logs.
- **Atomic Booking**: Postgres RPC `book_appointment_atomic` handles race conditions.
- **AI Tools (Edge)**: `vapi-tools` implemented with `get_customer_context`, `check_availability`, and `book_appointment`.
- **TDD Compliance**: Verified with integration tests covering Happy and Sad paths.

**Smart Scheduling & Service Timing**
- **Service-Aware Durations**: Templates define not just base duration, but also **prep**, **cleanup/admin**, and (for mobile tenants) **travel time** per service type.
- **Effective Blocks**: The `book_appointment_atomic` RPC now expands requested service windows into full blocked intervals (prep + service + cleanup + travel) and stores those as `start_time`/`end_time`, so all overlap checks operate on the true occupied time.
- **Slack & Utilization Policies**: Per-tenant knobs (e.g., max daily utilization, minimum gaps, “keep one trailing slot open”) will layer on top of the effective blocks to ensure the system leaves room to move appointments forward and avoids over-packing the day.

**User Accounts & Owner Identity**
- Each tenant has at least one **owner user** stored in a `users` table.
- Users now store `first_name`, `last_name`, and `full_name`. Onboarding flows in the dashboard create owners with **separated first and last names** (and compose `full_name` consistently), avoiding brittle name parsing.
- These owner identities drive login and multi-tenant administration but are never exposed directly to callers.

**Tenant Knowledge & Company FAQs (Planned)**
- **Tenant-Scoped Knowledge Base**: A Supabase table (e.g., `tenant_docs`) will hold per-tenant business knowledge (hours, policies, FAQs) as chunked text with pgvector embeddings, sourced from PDFs and other artifacts, behind the same RLS boundaries as CRM and appointments.
- **RAG Answering Flow**: Vapi tools will answer questions like “What are your hours?” or “Do you do tire changes at 3 AM?” by embedding the question, retrieving the most relevant knowledge chunks for that tenant, and asking the LLM to respond strictly based on those snippets.

**Planning artifacts**
- [GEMINI.md](GEMINI.md) (Project journal & decisions).
- [docs/PLAN.md](docs/PLAN.md) (Updated multi-phase plan).

Next major step: **Phase 3 – Vapi Agent Integration & Live Voice**.

---

## 4. Key Design & Business Decisions (Chronological)

### 4.1 Product & Requirements
- Build an **AI Secretary** that sounds so human callers assume it's a person.
- Key requirements: Low latency, interruption handling, and "memory" of previous calls.

### 4.2 Architecture: Edge-First
- **Decision**: Use Supabase Edge Functions instead of a 24/7 VPS.
- **Why**: Zero idle costs and significantly lower tool latency.

### 4.3 Memory: Vector Search
- **Decision**: Store call transcripts using **pgvector**.
- **Impact**: The AI can perform a "semantic lookup" when a customer calls back, allowing it to remember personal details or previous issues.

### 4.4 Async Sync Layer
- **Decision**: All external integrations (Google/Outlook, SMS) are handled by **n8n** in the background.

### 4.5 Testing Mandate: Strict TDD
- **Decision**: Every feature must be backed by an automated test suite before completion.
- **Status**: Schema and AI Tools are 100% test-verified (Happy & Sad paths).

---

## 6. How to Run Locally (Current)

From the project root:

```bash
bash scripts/bootstrap.sh   # installs deps, starts docker pg, runs migrations
npm test                    # runs Vitest TDD suite for the backend (DB-backed tests auto-skip if Postgres is down)
cd dashboard && npm test    # runs Vitest suite for the dashboard
```

Notes on tests and Postgres:
- The backend Vitest suites under `src/` include **integration tests that talk directly to Postgres**.
- If Docker Postgres on port `5433` is not running, those DB-backed tests will **log a skip message and no longer fail the suite**; they execute fully once the database is up.

Important: For appointments to show up in the dashboard calendar, the **Edge tools**, the Fastify backend (`src/index.ts`), and the dashboard must all talk to the **same Postgres database** per environment. If you run both a local Docker Postgres and a Supabase project, make sure `DATABASE_URL` (for the backend) and your Supabase connection strings used by Vapi/n8n all point at the same instance; otherwise bookings may land in one DB while the calendar queries another.

---

## 7. Next Steps

The initial PoC through Phase 5 (tools, async layer, and dashboard) is complete. Upcoming work focuses on integrations, observability, and making the core more template-driven:

1. **Go Live & Telephony Wiring**
  - Configure the Vapi Agent with the current tenant persona and tool definitions.
  - Link Telnyx phone numbers to the Vapi agent for real inbound calls.
2. **Expand Async Workflows (n8n)**
  - Harden and monitor the existing post-call summarization worker.
  - Add calendar sync (Google/Outlook) and Owner SMS notifications driven by `appointments` webhooks.
  - Standardize how external calendar webhooks and internal tools hit the `/calendar/sync` HTTP endpoint as the single entry point for calendar updates.
3. **Template & Metadata System**
  - Introduce `metadata` fields on customers/appointments and drive intake questions from per-industry templates.
  - Ensure AI prompts and tools use this metadata instead of hard-coded vertical logic, including **per-service timing profiles** (prep, cleanup/admin, travel) that inform scheduling.
4. **Analytics & Observability**
  - Implement ROI analytics (answered calls vs. bookings) and a usage dashboard per tenant.
  - Add centralized logging/metrics for Edge Functions, Vapi tool calls, and n8n workflows.
