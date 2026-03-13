# AI Secretary SaaS - Deployment TODO

## 1. Multi-Tenant Knowledge Base (RAG)
- [x] **Schema**: Create `tenant_docs` table with `pgvector` support.
- [x] **Edge Tool**: Implement `get_company_policy_answer` in Edge Functions.
- [x] **Ingestion Script**: Create `scripts/ingest-knowledge.ts` for PDF feeding.
- [x] **Dashboard UI**: Add "Knowledge Base" tab for document upload and management.
- [ ] **Live Testing**: Upload a real policy PDF and verify AI uses it during a call.

## 2. Advanced Scheduling (Shifts & Skills)
- [x] **Skill Matrix**: Create grid for matching staff skills to resource capabilities.
- [x] **Shift Schema**: Create `employee_shifts` table.
- [x] **Shift UI**: Add dashboard screen for managing employee working hours.
- [x] **Atomic Enforcement**: Update `book_appointment_atomic` to strictly enforce shift hours.
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

## 5. Deployment & Go-Live
- [ ] **Cloud Migration**: Move from local Docker/Deno to a production Supabase project.
- [ ] **Secrets Management**: Set `OPENAI_API_KEY`, `DATABASE_URL`, and `VAPI_SERVER_URL_SECRET` in cloud secrets.
- [ ] **Vapi Agent**: Point the official Vapi Agent to the production Edge Function URL.
- [ ] **Telephony**: Connect a real phone number via Telnyx or Vapi.

## 6. Infrastructure & Stability (Completed March 2026)
- [x] **Database Persistence**: Resolved via Docker volumes.
- [x] **Test Isolation**: Created `test_db` for automated suites.
- [x] **Port Standardization**: Backend (3000), Dashboard (3001).
- [x] **Build Reliability**: Fixed CommonJS/ESM and Type errors.
