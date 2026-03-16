# AI Secretary SaaS – Architecture

## 1. Overview
The system is a multi-tenant, **Edge-First / Serverless** AI Secretary built for ultra-low latency and high reliability. The backend follows a **Route Module Architecture** — 13 focused route files under `src/routes/` registered by a slim `src/index.ts` entry point. Shared business logic lives in `shared/` for cross-runtime reuse (Node and Deno).

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

### 3.1 Tech Stack
- **Framework**: Next.js (React) + Tailwind CSS.
- **State Management**: `SessionProvider` React Context for auth/session; `useStaticData` hook for shared tenant data.
- **Auth**: JWT-based authentication (8h expiry) via `/login` endpoint. Auto-logout on 401. Tokens stored in localStorage and sent as `Authorization: Bearer` headers.
- **Error Handling**: React `ErrorBoundary` wraps all views. Structured JSON logging via `createLogger()` utility.
- **Testing**: Vitest + React Testing Library (jsdom environment). 25+ tests across smoke, appointment, CRM, settings, and component suites.

### 3.2 Key Views & Features
- **Business Analytics**: High-level metrics for call volume, booking conversion, and estimated revenue generated.
- **Knowledge Base**: Document management system for uploading PDFs and text to "train" the AI on business policies.
- **Staff Working Hours**: Interface for managing employee shifts (Day of Week + Time Ranges) with create/edit support.
- **Skill & Capability Matrix**: Unified grid for matching staff expertise with physical resource (bay/chair) capabilities. Debounce guard prevents duplicate requests.
- **Outlook-style Calendar**: Multi-resource schedule view showing all confirmed appointments.
- **CRM Viewer**: Deep-dive into customer history, including AI-generated call summaries and sentiment.

---

## 4. Backend API (Fastify)
The Fastify backend serves as the management API for the dashboard and administrative tasks. Routes are organized into 13 modules under `src/routes/` (auth, tenants, appointments, customers, employees, shifts, resources, services, mappings, skills, calendar, knowledge, analytics).

### 4.1 Security
- **RLS Enforcement**: Critical routes use `withTenantClient()` which acquires a connection from `apiPool` (the `api_user` role), calls `set_tenant_context()`, and releases after the query. This ensures all data access goes through Postgres Row-Level Security.
- **Least Privilege**: The `api_user` role has explicit `SELECT, INSERT, UPDATE, DELETE` grants per table (not `ALL PRIVILEGES`).
- **Input Validation**: Zod schemas validate login, customer creation, and appointment creation at the API boundary.
- **JWT Auth**: `/login` returns a signed JWT. Protected routes verify the token and extract tenant context.

### 4.2 Testing
- **Framework**: Vitest with `--fileParallelism=false` (tests share a database).
- **Test Database**: Dedicated `test_db` on port 5433, isolated from development data.
- **Coverage**: 75+ tests across critical-bugs, high-bugs, medium-bugs, low-bugs, schema, RLS, customer, tools, scheduling, and index suites.

---

## 5. Multi-Tenant Knowledge Base (RAG)
- **Data Storage**: A `tenant_docs` table stores business knowledge as text chunks with `vector(1536)` embeddings.
- **Ingestion**: PDFs and text files are parsed, chunked (paragraph-aware with overlap), and embedded via OpenAI `text-embedding-3-small`. Duplicate detection deletes existing chunks before re-ingesting.
- **Retrieval**: The `get_company_policy_answer` tool performs semantic search to provide the AI with factual context during a call, grounding the LLM and preventing hallucinations.

---

## 6. Advanced Scheduling Engine
The scheduler ensures valid bookings by verifying multiple layers of constraints in a single atomic transaction (`book_appointment_atomic`):
1.  **Resource Availability**: Is the bay/chair free during this window?
2.  **Staff Expertise**: Does the assigned employee have the required skills for the service?
3.  **Resource Capabilities**: Does the resource have the required capabilities for the service?
4.  **Staff Working Hours**: Is the employee currently on-shift? (DST-safe via `AT TIME ZONE`.)
5.  **Auto End-Time**: When `end_time` is NULL, derives it from `service.duration_minutes`.
6.  **Customer Upsert**: When `customer_id` is NULL but phone is provided, auto-creates or finds the customer.
7.  **Assignment Validation**: Validates `assignment_id` as UUID (all entity IDs are now UUID after SERIAL→UUID migration).

---

## 7. Async Integration Layer (n8n)
- **Post-Call Processing**: Generates summaries and sentiment analysis.
- **Calendar Synchronization**: Bi-directional sync with Google Calendar and Outlook via the `tenant_calendar_settings` and `appointment_sync_map` tables.
- **Notifications**: Automated SMS/Email alerts to business owners upon new bookings.
- **Trigger**: The Postgres trigger (`notify_n8n_on_appointment`) uses `pg_net` for real HTTP calls to the tenant's n8n webhook URL. Falls back to `RAISE NOTICE` on local dev without `pg_net`.

---

## 8. Data Resiliency & Security
- **Atomic Bookings**: Postgres RPCs (`book_appointment_atomic`) with strict conflict resolution and multi-layer validation.
- **Row Level Security (RLS)**: Every table is isolated by `tenant_id`. All RLS policies standardized on `app.current_tenant_id`. Backend enforces RLS via `withTenantClient()`.
- **JWT Authentication**: 8-hour token expiry with auto-logout. No more plain localStorage sessions.
- **Input Validation**: Zod at API boundaries; CHECK constraints on JSONB metadata columns.
- **Name Sync**: Database triggers keep `full_name` ↔ `first_name`/`last_name` in sync on both users and customers tables.
- **Persistence**: Managed Supabase Postgres with Docker-backed local development.
- **Audit Logging**: `audit_log` table with triggers on appointments, customers, and resources capturing before/after snapshots.
- **Soft Deletes**: `is_deleted`/`deleted_at` columns with partial indexes on key tables (appointments, customers, resources, employees) to prevent accidental data loss while maintaining query performance.
