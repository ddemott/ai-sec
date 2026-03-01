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
- **Contextual Memory**: `call_summaries` using **pgvector** for semantic recall.
- **Audit Logs**: `call_transcripts` with sentiment tracking.
