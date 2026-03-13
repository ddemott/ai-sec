# AI Secretary SaaS – Project Context & Decisions

## Project Status
- **Current Phase**: **Production-Ready Multi-Tenant SaaS** (RAG, Shifts, and Analytics integrated).
- **Source Control**: Pushed to [github.com/ddemott/ai-sec](https://github.com/ddemott/ai-sec) (Private).
- **Ready for**: Scaling to multiple businesses with unique policies and staff schedules.
- **Backend Strategy**: **Edge-First / Serverless** (Supabase Edge Functions + Postgres) with a local Fastify helper for ingestion and admin.
- **Dashboard Goal**: **Business Empowerment & Performance Monitoring** (Achieved).

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

## Next Steps (Live)
1.  **Configure Base Vapi Agent**: In Vapi, set the Agent's **Server URL** to the deployed Supabase Edge Function (`/vapi-tools`).
2.  **Attach n8n Webhooks**: Turn on Database Webhooks in Supabase to trigger n8n for summaries and calendar sync.
3.  **Live Call Tests**: Place real calls for a test tenant, verify bookings land in the dashboard, and confirm AI answers questions using the Knowledge Base.
4.  **Telephony Wiring**: Use Telnyx + Vapi to assign real phone numbers to the appropriate Vapi Agents.
