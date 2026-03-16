# AI Secretary SaaS - Deployment TODO

## 1. Multi-Tenant Knowledge Base (RAG)
- [x] **Schema**: Create `tenant_docs` table with `pgvector` support.
- [x] **Edge Tool**: Implement `get_company_policy_answer` in Edge Functions.
- [x] **Ingestion Script**: Create `scripts/ingest-knowledge.ts` for PDF feeding.
- [x] **Dashboard UI**: Add "Knowledge Base" tab for document upload and management.
- [x] **Chunking**: Paragraph-aware overlapping chunks with configurable size (BUG-050).
- [x] **Deduplication**: Delete existing chunks before re-ingesting same source (BUG-051).
- [ ] **Live Testing**: Upload a real policy PDF and verify AI uses it during a call.

## 2. Advanced Scheduling (Shifts & Skills)
- [x] **Skill Matrix**: Create grid for matching staff skills to resource capabilities.
- [x] **Shift Schema**: Create `employee_shifts` table.
- [x] **Shift UI**: Add dashboard screen for managing employee working hours.
- [x] **Atomic Enforcement**: Update `book_appointment_atomic` to strictly enforce shift hours.
- [x] **DST Safety**: Shift validation uses `AT TIME ZONE` for correct DST handling (BUG-046).
- [x] **Auto End-Time**: `book_appointment_atomic` derives `end_time` from service `duration_minutes` (BUG-040).
- [x] **Shift Editing**: UI supports editing existing shifts, not just creating (BUG-047).
- [ ] **Live Testing**: Attempt to book an appointment "out-of-hours" and verify AI rejection.

## 3. Business Analytics
- [x] **Backend API**: Create `/analytics/stats` endpoint.
- [x] **Frontend View**: Build performance dashboard with conversion funnel and activity feed.
- [x] **Revenue Logic**: Add pricing to services for revenue estimation.

## 4. Calendar Sync (Async Layer)
- [x] **Schema**: Create `tenant_calendar_settings` and `sync_map`.
- [x] **n8n Blueprint**: Create `n8n/calendar_sync.json` for Google/Outlook.
- [x] **Dashboard UI**: Add "Calendar Sync" section to Settings.
- [ ] **Plumbing**: Enable Supabase Database Webhooks to trigger the n8n sync workflow.
- [x] **n8n Trigger**: `notify_n8n_on_appointment` now uses `pg_net` when available, falls back to NOTICE (BUG-034).
- [ ] **Outlook Branch**: Implement Outlook calendar sync (currently empty) (BUG-033).
- [ ] **Token Refresh**: Add OAuth token refresh logic to Google/Outlook sync (BUG-033).
- [ ] **Call Summary Embeddings**: Generate embeddings in post-call summarizer n8n workflow (BUG-032).

## 5. Deployment & Go-Live
- [ ] **Cloud Migration**: Move from local Docker/Deno to a production Supabase project.
- [ ] **Secrets Management**: Set `OPENAI_API_KEY`, `DATABASE_URL`, and `VAPI_SERVER_URL_SECRET` in cloud secrets.
- [ ] **Vapi Agent**: Point the official Vapi Agent to the production Edge Function URL.
- [x] **Agent Template**: Templatize `agent.json` — replace hardcoded tenant ID and date (BUG-049).
- [ ] **Telephony**: Connect a real phone number via Telnyx or Vapi.
- [ ] **Beta Testing**: Conduct real-world call tests with PoC tenants (DynaTire).

## 6. Infrastructure & Stability (Completed March 2026)
- [x] **Database Persistence**: Resolved via Docker volumes.
- [x] **Test Isolation**: Created `test_db` for automated suites.
- [x] **Port Standardization**: Backend (3000), Dashboard (3001).
- [x] **Build Reliability**: Fixed CommonJS/ESM and Type errors.

## 7. Security & Quality Hardening (Completed March 2026)
- [x] **JWT Auth**: Token-based authentication with 8h expiry and auto-logout on 401 (BUG-012).
- [x] **RLS Enforcement**: Fastify routes use `withTenantClient()` with `api_user` role (BUG-007).
- [x] **Least-Privilege DB**: `api_user` downgraded from `ALL PRIVILEGES` to explicit grants (BUG-008).
- [x] **Form Validation**: Zod schemas for login, customer, and appointment creation (BUG-011).
- [x] **Error Boundaries**: React ErrorBoundary wraps all dashboard views (BUG-010).
- [x] **Dev Bypass Removed**: Production auth bypass button deleted (BUG-005).
- [x] **Per-Tenant Email**: Email uniqueness scoped to tenant, not global (BUG-002).
- [x] **RLS Consistency**: Standardized all policies on `app.current_tenant_id` (BUG-006).
- [x] **SessionContext**: Centralized auth state via React Context (BUG-045).
- [x] **Structured Logging**: Dashboard logger utility with JSON output and log levels (BUG-055).
- [x] **JSONB Constraints**: CHECK constraints on metadata columns (BUG-052).

## 8. Remaining Technical Debt
These are known issues from the March 2026 code review (see BUGS.md for details).

### Pre-Production (should fix before go-live)
- [x] **Route Extraction**: Break `src/index.ts` monolith into 13 route modules (BUG-017).
- [x] **ID Standardization**: Migrated services and employees from SERIAL to UUID (BUG-015).
- [x] **Customer Timezone**: `check_availability_with_tz()` function respects customer timezone (BUG-031).
- [x] **Orphan Transcript Linking**: `link_orphaned_transcripts()` SQL function matches via call_id (BUG-030).
- [x] **Accessibility**: ARIA labels on nav, modals, inputs, buttons, and error messages (BUG-039).

### Post-Launch (can defer)
- [x] **Code Dedup**: Shared `scheduling.ts` in `shared/` — both Node and Deno re-export from it (BUG-016).
- [x] **Code Dedup**: Shared `getEmbedding.ts` in `shared/` — both Node and Deno use `createGetEmbedding()` (BUG-024).
- [x] **Dead Code**: Removed BookingService, Provider pattern, InMemoryBookingStorage, MockLlmProvider, and `/chat` endpoint (BUG-018, BUG-019).
- [x] **Audit Logging**: `audit_log` table with triggers on appointments, customers, resources (BUG-037).
- [x] **Soft Deletes**: `is_deleted`/`deleted_at` columns on appointments, customers, resources, employees (BUG-038).
