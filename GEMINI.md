# AI Secretary SaaS – Project Context & Decisions

## Project Status
- **Current Phase**: **Phase 8 (Go-Live)** — All development, security hardening, and polish phases complete.
- **Source Control**: Pushed to [github.com/ddemott/ai-sec](https://github.com/ddemott/ai-sec) (Private).
- **Ready for**: Cloud migration and beta testing with DynaTire.
- **Backend Strategy**: **Edge-First / Serverless** (Supabase Edge Functions + Postgres) with a **modularized Fastify backend** (14 route modules under `src/routes/` with `withTenantClient()` RLS enforcement) for management API.
- **Dashboard Goal**: **Business Empowerment & Performance Monitoring** (Achieved).
- **Quality**: 58 bugs from March 2026 code review resolved. 100 backend + 38 dashboard tests = 138 total passing. JWT auth, RLS on all routes, least-privilege DB role.

## Key Architecture Decisions
1. **Zero-Scale Infrastructure**: Supabase Edge Functions + Postgres.
2. **Modular Layering**: Hexagonal architecture (Adapter/Service/Repository).
3. **Multi-Tenancy**: Secured via Postgres RLS and `api_user` role.
4. **Strict TDD**: **100% Test Pass Rate**. All tests pass (backend, dashboard, edge logic).
5. **RAG Knowledge Base**: Uses `pgvector` to store business-specific PDFs and docs. AI answers are grounded in these documents to prevent hallucinations.
6. **Shift-Aware Atomic Booking**: The Postgres `book_appointment_atomic` function now verifies employee shifts, ensuring no "out-of-hours" bookings occur at the database level.

## Recent Progress (March 2026)
- **RAG Infrastructure**: Implemented `tenant_docs` table, `get_company_policy_answer` edge tool, and a dashboard upload UI.
- **Employee Shift Management**: Added shift scheduling for staff and updated the booking engine to enforce these constraints.
- **Analytics View**: Built a performance dashboard showing call volume, conversion rates, and estimated revenue.
- **Skill & Capability Matrix**: Created a unified grid for matching staff expertise with physical resource capabilities.
- **Calendar Sync Blueprint**: Added schema and n8n workflows for Google/Outlook integration.
- **Unified CRM Detail View**: Customer detail pane now shows upcoming/past appointments, enhanced call summaries with transcript data, and inline cancel flow.
- **New API Endpoints**: `GET /customers/:id/appointments`, `POST /appointments/:id/cancel`, enhanced `/call-summaries` with transcript JOINs.
- **Employee Attributes**: Added first_name, last_name, email, phone columns to employees table.
- **Shared Compiled JS**: `shared/getEmbedding.js`, `shared/scheduling.js`, `dashboard/lib/constants.js` committed for cross-runtime use.
- **Navigation Restructure**: 12 flat tabs consolidated to 5 grouped sections with sub-tab navigation (Schedule, Customers, My Team, My Business, AI & Insights).
- **Vocabulary System**: 20 business types with per-type UI labels (resource/employee/booking), tenant-level overrides, GET /vocabulary endpoint.
- **Self-Service Registration**: POST /register public endpoint creates tenant + user + applies template defaults.
- **Onboarding Flag**: `onboarding_completed` boolean on tenants table for wizard detection.

## Next Steps (Live)
1.  **Configure Base Vapi Agent**: In Vapi, set the Agent's **Server URL** to the deployed Supabase Edge Function (`/vapi-tools`).
2.  **Attach n8n Webhooks**: Turn on Database Webhooks in Supabase to trigger n8n for summaries and calendar sync.
3.  **Live Call Tests**: Place real calls for a test tenant, verify bookings land in the dashboard, and confirm AI answers questions using the Knowledge Base.
4.  **Telephony Wiring**: Use Telnyx + Vapi to assign real phone numbers to the appropriate Vapi Agents.
