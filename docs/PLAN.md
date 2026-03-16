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
- [x] **Validation**: Zod schemas at API boundaries, JSONB CHECK constraints, assignment_id format validation.
- [x] **Booking Engine**: DST-safe shift checks, auto end-time from service duration, customer upsert, service requirement enforcement.
- [x] **Dashboard**: Error boundaries, SessionContext, structured logging, Promise.allSettled, timezone maps, debounce guards.
- [x] **Data Integrity**: Name sync triggers, seed idempotency, metadata constraints, call_id indexing.
- [x] **Edge Functions**: Single-pass Zod validation, set_tenant_context error handling.
- [x] **Knowledge Base**: Paragraph-aware chunking with overlap, duplicate detection.
- [x] **Test Coverage**: 75 backend + 25 dashboard tests, all passing.

## Phase 8: Production Go-Live (Current 🚀)
- [ ] **Cloud Migration**: Move from local Docker to managed Supabase.
- [ ] **Telephony Wiring**: Assign live phone numbers to Vapi Agents.
- [ ] **Agent Template**: Templatize `agent.json` (currently hardcoded to one tenant).
- [ ] **n8n Plumbing**: Replace placeholder triggers with real HTTP calls; activate Database Webhooks.
- [ ] **Outlook Sync**: Implement the empty Outlook calendar sync branch.
- [ ] **Route Extraction**: Break `index.ts` monolith into route modules for maintainability.
- [ ] **Beta Testing**: Conduct real-world call tests with PoC tenants (DynaTire).

## Phase 9: Scale & Polish (Future)
- [ ] **ID Standardization**: Migrate SERIAL PKs to UUID across all tables.
- [ ] **Code Consolidation**: Deduplicate scheduling logic and `getEmbedding()` between Node/Deno.
- [ ] **Dead Code Cleanup**: Wire or remove unused BookingService and Provider patterns.
- [ ] **Audit Logging**: Add audit trail with before/after snapshots.
- [ ] **Soft Deletes**: Add `is_deleted`/`deleted_at` to prevent accidental data loss.
- [ ] **Accessibility**: ARIA labels and WCAG compliance across dashboard.
- [ ] **Customer Timezone**: Respect customer timezone in availability checks.
