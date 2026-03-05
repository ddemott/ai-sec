# AI Secretary SaaS – Project Context & Decisions

## Project Status
- **Current Phase**: **Multi-Tenant SaaS MVP Ready** (PoC + Dashboard complete).
- **Source Control**: Pushed to [github.com/ddemott/ai-sec](https://github.com/ddemott/ai-sec) (Private).
- **Ready for**: Live integration testing with real phone calls for the first production tenants.
- **Backend Strategy**: **Edge-First / Serverless** (Supabase Edge Functions + Postgres).
- **Dashboard Goal**: **SuperAdmin Multi-Tenant Management & Intervention** (Achieved).

## Key Architecture Decisions
1. **Zero-Scale Infrastructure**: Supabase Edge Functions + Postgres.
2. **Modular Layering**: Hexagonal architecture (Adapter/Service/Repository).
3. **Multi-Tenancy**: Secured via Postgres RLS and `api_user` role.
4. **Strict TDD**: **100% Test Pass Rate**. Backend, Edge, and Frontend are fully verified.
5. **Repeatability**: `start-all.sh` brings up the entire stack from scratch.
6. **Template + Metadata System**: Core models stay generic (tenants, customers, resources, appointments) while vertical-specific details are captured in JSONB `metadata` and driven by per-industry templates.

## Recent Progress
- **Edge Tools & Smart Scheduling**: Implemented `vapi-tools` (get_customer_context, check_availability, book_appointment) with Postgres `book_appointment_atomic` enforcing timing profiles (prep, base, cleanup, travel) per service.
- **Multi-Tenant Dashboard**: Built a SuperAdmin dashboard to launch new businesses from templates, manage tenants/resources, and view appointments/CRM across tenants.
- **Test Coverage**: Maintained high coverage on core logic (schema, tools, booking) and verified RLS isolation.
- **Local Stack**: `bootstrap` + `start-all` bring up Docker Postgres, backend, and dashboard for end-to-end local testing.
 - **User Accounts & Onboarding**: Extended the `users` table to store `first_name`, `last_name`, and `full_name`, and wired the Settings + SuperAdmin onboarding flows so each new business gets an owner account with separated names instead of a single opaque full name.

## Next Steps (Live)
1.  **Configure Base Vapi Agent**: In Vapi, set the Agent's **Server URL** to the deployed Supabase Edge Function (`/vapi-tools`) and configure the shared `x-vapi-secret`.
2.  **Per-Tenant Persona Wiring**: For each new tenant, create/update a Vapi Agent persona that injects the tenant's `tenant_id` and `resource_id` into the System Prompt and attaches the 3 global tools.
3.  **Async Layer (n8n)**: Run n8n (Cloud or self-hosted), import `n8n/post_call_summarizer.json`, and attach it to Supabase via Database Webhooks on `appointments` (or call logs) inserts.
4.  **Telephony**: Use Telnyx + Vapi to assign real phone numbers to the appropriate Vapi Agents.
5.  **Live Call Tests**: Place real calls for a test tenant, verify bookings land in the correct tenant's dashboard view, and confirm post-call summaries flow into the knowledge layer.
