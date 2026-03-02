# AI Secretary SaaS – Architecture

## 1. Overview
The system is a multi-tenant, **Edge-First / Serverless** AI Secretary built for ultra-low latency and high reliability. It follows a **Modular (Hexagonal) Architecture** to ensure technology swappability and long-term maintenance.

---

## 2. Core System Flow (The "Live" Voice Loop)
1.  **Inbound Call**: Caller → Telnyx → Voice Orchestrator (Vapi/Retell).
2.  **Warm-up Trigger**: Vapi sends a "Call Started" webhook to eliminate cold-starts.
3.  **Conversation**: Orchestrator (STT/TTS/VAD) ↔ LLM (Groq/Llama 3).
4.  **Tool Execution**: LLM → **Adapter Layer** (Edge Function).
5.  **Business Logic**: Adapter → **Core Service Layer**.
6.  **Data Persistence**: Core Service → **Repository Layer** (Postgres RPC).
7.  **Async Logic**: Postgres Trigger → n8n (Calendar Sync, SMS, Summarization).

---

## 3. Dashboard & Management UI (Phase 5)
The Dashboard provides business owners with transparency and control.

### 3.1 Tech Stack
- **Framework**: Next.js (React) + Tailwind CSS.
- **Auth**: Supabase Auth (JWT-based multi-tenancy).
- **Hosting**: Vercel (Edge-compatible).

### 3.2 Key Views & Features
- **ROI Analytics**: Dashboard showing calls answered, bookings made, and "Hours Saved."
- **CRM Viewer**: View customer history, notes, and AI-generated "Contextual Memories."
- **AI Tuner**: Live editor for the `system_prompt`, `voice_id`, and `working_hours`.
- **Call Explorer**: List of all calls with transcripts, sentiment analysis, and audio playback.
 - **Scheduling View**: Outlook-style calendar that surfaces not only raw appointment times but also the **effective load** on each resource (including prep/cleanup/admin and travel for mobile tenants) so operators can see slack at a glance.

---

## 4. Modular Architecture (Technology Insurance)
- **Adapter Layer**: Translates external JSON (Vapi/UI) to Domain objects.
- **Core Service Layer**: Pure business logic (TDD verified).
- **Repository Layer**: Data access (Postgres/Supabase).

---

## 5. Resiliency & Reliability
- **Atomic Bookings**: Postgres RPCs with `SERIALIZABLE` isolation.
- **Row Level Security (RLS)**: Enforced via `app.current_tenant_id` session variable.
- **Structured Logging**: (Future) Pino/Winston + Centralized Aggregator.

---

## 6. Data Storage Strategy (Source of Truth: Supabase)
- **Structured Data**: `tenants`, `resources`, `customers`, `appointments`.
- **Metadata**: JSONB `metadata` fields on core tables (e.g., customers, appointments) capture vertical-specific details like vehicle info, services, or special instructions without changing the base schema. This includes **per-service timing metadata** (prep/setup, base duration, cleanup/admin, travel) that the scheduler uses to compute effective booking blocks.
- **Contextual Memory**: `call_summaries` using **pgvector** for semantic recall.
- **Audit Logs**: `call_transcripts` with sentiment tracking.

## 7. Tenant Knowledge Base & RAG Layer
- **Tenant Knowledge Base (Planned)**: A `tenant_docs`-style table stores per-tenant business knowledge (hours, policies, services, FAQs) as small text chunks with embeddings (`vector(1536)`), sourced from PDFs, website copy, and manually entered notes.
- **Ingestion Pipeline**: PDFs and other artifacts are converted to text, chunked, and embedded via OpenAI `text-embedding-3-small`, either through a Deno script or n8n workflow, and written into the knowledge table under the correct `tenant_id` (protected by RLS).
- **Retrieval-Augmented Generation**: A dedicated Vapi tool (e.g., `get_company_policy_answer`) computes an embedding for the caller's question, retrieves the top-N knowledge chunks for that tenant using pgvector, and passes them plus the question into the LLM with a strict system prompt so answers are consistent and policy-correct.
- **Unified Memory View (Future)**: Over time, both `call_summaries` and tenant knowledge docs may be queried together so the secretary can combine "what happened with this customer" and "what the business policy says" in a single answer.
