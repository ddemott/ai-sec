# AI Secretary SaaS – Project Plan

## Phase 1: Foundation & TDD Setup (Complete ✅)
- [x] **SQL Schema with Tests**: `tenants`, `resources`, `customers`, `appointments`.
- [x] **Atomic Booking**: Postgres RPC handles race conditions.
- [x] **TDD Integration**: Automated local DB setup via `scripts/setup-db.sh`.

## Phase 2: AI Tool Provider & Context (Complete ✅)
- [x] **AI Tools (Edge)**: `get_customer_context`, `check_availability`, `book_appointment`.
- [x] **Architecture Refactor**: Modular (Hexagonal) architecture.
- [x] **Hardening**: Zod validation and detailed error logging.

## Phase 3: Voice AI & Integration (Complete ✅)
- [x] **Vapi Agent Blueprint**: `vapi/agent.json` and `vapi/tools.json`.
- [x] **Connectivity Guide**: `vapi/TELNYX_SETUP.md`.
- [x] **Latency Optimization**: Implemented Warm-up Pings.

## Phase 4: Async Logic & Background Workers (Complete ✅)
- [x] **n8n Workflow Blueprint**: `docs/N8N_WORKFLOWS.md`.
- [x] **Summarization**: Post-call summarizer via OpenAI and Supabase.
- [x] **Audit Schema**: `call_transcripts` and Postgres-to-n8n triggers.

## Phase 5: Dashboard & Management UI (Complete ✅)
- [x] **Appointment Management**: Outlook-Style UI with full calendar features.
- [x] **CRM & Notes**: Searchable customer profiles with AI history.
- [x] **AI Persona Tuning**: Live updates for System Prompt and Voice ID.

## Phase 6: Knowledge Base & RAG (Complete ✅)
- [x] **Semantic Schema**: `tenant_docs` table with `pgvector` support.
- [x] **Ingestion Engine**: Deno script and Dashboard UI for PDF uploads.
- [x] **Policy Q&A**: `get_company_policy_answer` tool for grounding AI in business docs.

## Phase 7: Advanced Scheduling & ROI (Complete ✅)
- [x] **Skill Matrix**: Grid for matching staff expertise to resource capabilities.
- [x] **Shift Management**: Full UI and DB enforcement for employee working hours.
- [x] **ROI Analytics**: Dashboard showing call conversion and estimated revenue.
- [x] **Calendar Sync**: Schema and n8n blueprint for Google/Outlook integration.

## Phase 8: Production Go-Live (Current 🚀)
- [ ] **Cloud Migration**: Move from local Docker to managed Supabase.
- [ ] **Telephony Wiring**: Assign live phone numbers to Vapi Agents.
- [ ] **n8n Plumbing**: Activate Database Webhooks for live sync and summaries.
- [ ] **Beta Testing**: Conduct real-world call tests with PoC tenants (DynaTire).
