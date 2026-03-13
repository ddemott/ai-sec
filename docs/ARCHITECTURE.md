# AI Secretary SaaS – Architecture

## 1. Overview
The system is a multi-tenant, **Edge-First / Serverless** AI Secretary built for ultra-low latency and high reliability. It follows a **Modular (Hexagonal) Architecture** to ensure technology swappability and long-term maintenance.

---

## 2. Core System Flow (The "Live" Voice Loop)
1.  **Inbound Call**: Caller → Telnyx → Voice Orchestrator (Vapi).
2.  **Warm-up Trigger**: Vapi sends a "Call Started" webhook to eliminate cold-starts.
3.  **Conversation**: Orchestrator (STT/TTS/VAD) ↔ LLM (Groq/Llama 3).
4.  **Tool Execution**: LLM → **Adapter Layer** (Supabase Edge Function).
5.  **Business Logic**: Adapter → **Core Service Layer** (TypeScript/Deno).
6.  **Data Persistence**: Core Service → **Repository Layer** (Postgres RPC).
7.  **Knowledge Retrieval**: Core Service → **RAG Layer** (pgvector search).
8.  **Async Logic**: Postgres Trigger → n8n (Calendar Sync, SMS, Summarization).

---

## 3. Dashboard & Management UI
The Dashboard provides business owners with transparency and control.

### 3.1 Tech Stack & Test Coverage
- **Framework**: Next.js (React) + Tailwind CSS.
- **Auth**: Application-level `users` table + backend `/login` endpoint.
- **Verification**: 100% Test Pass Rate across Vitest (UI) and Deno (Backend).

### 3.2 Key Views & Features
- **Business Analytics**: High-level metrics for call volume, booking conversion, and estimated revenue generated.
- **Knowledge Base**: Document management system for uploading PDFs and text to "train" the AI on business policies.
- **Staff Working Hours**: Interface for managing employee shifts (Day of Week + Time Ranges).
- **Skill & Capability Matrix**: Unified grid for matching staff expertise with physical resource (bay/chair) capabilities.
- **Outlook-style Calendar**: Multi-resource schedule view showing all confirmed appointments.
- **CRM Viewer**: Deep-dive into customer history, including AI-generated call summaries and sentiment.

---

## 4. Multi-Tenant Knowledge Base (RAG)
- **Data Storage**: A `tenant_docs` table stores business knowledge as text chunks with `vector(1536)` embeddings.
- **Ingestion**: PDFs and text files are parsed, chunked, and embedded via OpenAI `text-embedding-3-small`.
- **Retrieval**: The `get_company_policy_answer` tool performs semantic search to provide the AI with factual context during a call, grounding the LLM and preventing hallucinations.

---

## 5. Advanced Scheduling Engine
The scheduler ensures valid bookings by verifying three layers of constraints in a single atomic transaction:
1.  **Resource Availability**: Is the bay/chair free during this window?
2.  **Staff Expertise**: Does the assigned employee have the required skills for the service?
3.  **Staff Working Hours**: Is the employee currently on-shift according to the `employee_shifts` table?

---

## 6. Async Integration Layer (n8n)
- **Post-Call Processing**: Generates summaries and sentiment analysis.
- **Calendar Synchronization**: Bi-directional sync with Google Calendar and Outlook via the `tenant_calendar_settings` and `appointment_sync_map` tables.
- **Notifications**: Automated SMS/Email alerts to business owners upon new bookings.

---

## 7. Data Resiliency & Security
- **Atomic Bookings**: Postgres RPCs (`book_appointment_atomic`) with strict conflict resolution.
- **Row Level Security (RLS)**: Every table is isolated by `tenant_id`, ensuring businesses can never access each other's data.
- **Persistence**: Managed Supabase Postgres with Docker-backed local development.
