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

## Phase 7.5: Security & Quality Hardening (Complete ✅)
Full code review identified 58 bugs across all severity levels. All Critical, High, Medium, and Low bugs resolved.

- [x] **Auth**: JWT tokens with expiry, auto-logout on 401, dev bypass removed.
- [x] **RLS**: Standardized policies, Fastify enforces via `withTenantClient()`, least-privilege DB role.
- [x] **Validation**: Zod schemas at API boundaries, JSONB CHECK constraints, UUID assignment_id validation.
- [x] **Booking Engine**: DST-safe shift checks, auto end-time from service duration, customer upsert, service requirement enforcement.
- [x] **Dashboard**: Error boundaries, SessionContext, structured logging, Promise.allSettled, timezone maps, debounce guards.
- [x] **Data Integrity**: Name sync triggers, seed idempotency, metadata constraints, call_id indexing.
- [x] **Edge Functions**: Single-pass Zod validation, set_tenant_context error handling.
- [x] **Knowledge Base**: Paragraph-aware chunking with overlap, duplicate detection.
- [x] **Test Coverage**: 75 backend + 25 dashboard tests, all passing.

## Phase 8: Production Go-Live (Current 🚀)
- [x] **Agent Template**: Templatize `agent.json` with Mustache variables for tenant-specific deployment.
- [x] **n8n Plumbing**: `notify_n8n_on_appointment` now uses `pg_net` for real HTTP calls (falls back to NOTICE on local dev).
- [x] **Route Extraction**: Broke `index.ts` monolith into 13 focused route modules under `src/routes/`.
- [ ] **Cloud Migration**: Move from local Docker to managed Supabase.
- [ ] **Secrets Management**: Set `OPENAI_API_KEY`, `DATABASE_URL`, and `VAPI_SERVER_URL_SECRET` in cloud secrets.
- [ ] **Vapi Agent**: Point the official Vapi Agent to the production Edge Function URL.
- [ ] **Telephony Wiring**: Assign live phone numbers to Vapi Agents via Telnyx.
- [ ] **Database Webhooks**: Enable Supabase Database Webhooks to trigger the n8n sync workflow.
- [ ] **Outlook Sync**: Implement the empty Outlook calendar sync branch.
- [ ] **Token Refresh**: Add OAuth token refresh logic to Google/Outlook calendar sync.
- [ ] **Call Summary Embeddings**: Generate embeddings in post-call summarizer n8n workflow.
- [ ] **Beta Testing**: Conduct real-world call tests with PoC tenants (DynaTire).

## Phase 9: Scale & Polish (Complete ✅)
- [x] **ID Standardization**: Migrated services and employees from SERIAL to UUID. All assignment IDs are now UUID.
- [x] **Code Consolidation**: `shared/scheduling.ts` and `shared/getEmbedding.ts` used by both Node and Deno runtimes.
- [x] **Dead Code Cleanup**: Removed BookingService, Provider pattern, InMemoryBookingStorage, MockLlmProvider, and `/chat` endpoint.
- [x] **Audit Logging**: `audit_log` table with triggers on appointments, customers, and resources (before/after snapshots).
- [x] **Soft Deletes**: `is_deleted`/`deleted_at` columns with partial indexes on appointments, customers, resources, and employees.
- [x] **Accessibility**: ARIA labels (`role="dialog"`, `aria-modal`, `aria-invalid`, `aria-describedby`, `aria-busy`) across dashboard.
- [x] **Customer Timezone**: `check_availability_with_tz()` respects customer timezone in availability checks.
- [x] **Orphan Transcript Linking**: `link_orphaned_transcripts()` SQL function matches transcripts via call_id.
