# AI Secretary SaaS – Project Context & Decisions

## Project Status
- **Current Phase**: **Multi-Tenant SaaS MVP Ready** (PoC + Dashboard complete).
- **Source Control**: Pushed to [github.com/ddemott/ai-sec](https://github.com/ddemott/ai-sec) (Private).
- **Ready for**: Live integration testing with real phone calls for the first production tenants.
- **Backend Strategy**: **Edge-First / Serverless** (Supabase Edge Functions + Postgres) with a small local Fastify helper for admin and debugging.
- **Dashboard Goal**: **SuperAdmin Multi-Tenant Management & Intervention** (Achieved).

## Key Architecture Decisions
1. **Zero-Scale Infrastructure**: Supabase Edge Functions + Postgres.
2. **Modular Layering**: Hexagonal architecture (Adapter/Service/Repository).
3. **Multi-Tenancy**: Secured via Postgres RLS and `api_user` role.
4. **Strict TDD**: **100% Test Pass Rate**. All tests pass (backend, dashboard, edge logic). AppointmentView and dashboard calendar logic are fully verified. DB-backed tests are resilient to Postgres being temporarily offline.
5. **Repeatability**: `start-all.sh` brings up the entire stack from scratch; `npm test` (backend) and `cd dashboard && npm test` (frontend) validate end-to-end behavior.
6. **Template + Metadata System**: Core models stay generic (tenants, customers, resources, appointments) while vertical-specific details are captured in JSONB `metadata` and driven by per-industry templates.

## Recent Progress
- **Edge Tools & Scheduling**: Implemented `vapi-tools` (get_customer_context, check_availability, book_appointment) with Postgres `book_appointment_atomic` enforcing simple overlap checks on the literal requested service window (no implicit prep/cleanup/travel buffers).
- **Multi-Tenant Dashboard**: Built a SuperAdmin dashboard to launch new businesses from templates, manage tenants/resources, and view appointments/CRM across tenants.
- **Test Coverage**: Maintained high coverage on core logic (schema, tools, booking) and verified RLS isolation.
### Service Catalog Integration (March 2026)
### Employee & Skills Mapping (March 2026)
- Added `employees` table for per-tenant employee definitions and skills/capabilities.
- Added mapping tables for assigning services to employees (skills) and resources (capacity units).
- Implemented repository CRUD for employees and service mappings, with robust Deno tests.
- All new code is covered by tests; employee and mapping flows are ready for selector-driven booking and dashboard UI integration.

## Dashboard Scheduling & Management (March 2026)
- Employee Management UI: Add/edit employees, assign skills/capabilities.
- Service Assignment UI: Map services to employees and resources for robust scheduling.
- All new screens are covered by tests and documented.

### Resource & Calendar Management UI (March 2026)
- New dashboard tab for resource management (wrench icon).
- Tenant owners and superadmins can view, add, edit, and delete resources.
- CRUD operations are wired to backend endpoints.
- UI is live and ready for integration testing.
- Appointment and resource type management will be expanded in future iterations.

### Infrastructure & UI Stability (March 2026)
- **Database Persistence**: Resolved issue where data was lost on container restart by adding a persistent Docker volume (`ai-sec-db-data`) to `docker-compose.yml`.
- **Test Sandbox Isolation**: Fixed a critical bug where automated edge function tests were wiping the main `postgres` database. Created a dedicated `test_db` and updated `scripts/bootstrap.sh` and Deno test suites to use it.
- **Service & Staff Management**: Implemented a comprehensive "Service Catalog" and "Staff & Expertise" UI. Added many-to-many mapping logic to allow assigning multiple services to resources and employees.
- **Backend Port Conflict**: Moved backend from port 3001 to 3000 to resolve a conflict with the Dashboard server.
- **Build System Fixes**: Corrected `src/index.ts` to support CommonJS build output (replaced `import.meta` with `__dirname`) and added `@types/bcrypt` devDependency.


## Next Steps (Live)
1.  **Configure Base Vapi Agent**: In Vapi, set the Agent's **Server URL** to the deployed Supabase Edge Function (`/vapi-tools`) and configure the shared `x-vapi-secret`.
2.  **Per-Tenant Persona Wiring**: For each new tenant, create/update a Vapi Agent persona that injects the tenant's `tenant_id` and `resource_id` into the System Prompt and attaches the 3 global tools.
3.  **Async Layer (n8n)**: Run n8n (Cloud or self-hosted), import `n8n/post_call_summarizer.json`, and attach it to Supabase via Database Webhooks on `appointments` (or call logs) inserts.
4.  **Telephony**: Use Telnyx + Vapi to assign real phone numbers to the appropriate Vapi Agents.
5.  **Live Call Tests**: Place real calls for a test tenant, verify bookings land in the correct tenant's dashboard view, and confirm post-call summaries flow into the knowledge layer.
6.  **Operational Checklists**: Use `TODO.md` and `docs/HOW_TO_SETUP.md` as the canonical deployment and wiring checklists for Supabase, Vapi, Telnyx, n8n, and the dashboard.
