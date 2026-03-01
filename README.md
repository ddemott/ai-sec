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
npm test                    # runs Vitest TDD suite
```

---

## 7. Next Steps

1. Configure the **Vapi Agent** with DynaTire persona and tool definitions.
2. Link the **Telnyx phone number** to the Vapi agent.
3. Implement the **post-call summarization** worker in n8n.
4. Add **Owner SMS** notifications when a job is booked.
