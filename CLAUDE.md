# AI Secretary - Multi-Tenant Voice AI Reception SaaS

## Project Overview
Multi-tenant AI receptionist platform for service businesses (tire shops, salons, auto shops, clinics). Handles inbound calls via voice AI, books appointments, answers policy questions via RAG, and syncs with external calendars.

## Architecture
- **Voice AI**: Telnyx (telephony) -> Vapi (orchestrator, STT/LLM/TTS) -> Supabase Edge Function (Deno)
- **Backend API**: Node.js / Fastify (src/index.ts) -> Postgres
- **Dashboard**: Next.js 14 (App Router) + Tailwind CSS + TypeScript
- **Database**: Postgres with pgvector, RLS multi-tenancy, atomic booking RPCs
- **Async Workers**: n8n (post-call summaries, calendar sync, SMS)
- **Auth**: bcrypt-based app-level login (no JWT yet)

## Key Directories
- `/src` - Fastify backend (REST API, auth, CRUD endpoints)
- `/dashboard` - Next.js frontend (components/, lib/, app/)
- `/supabase/functions/vapi-tools` - Deno Edge Functions (voice AI tool handlers)
- `/supabase/migrations` - 33 SQL migrations (schema, RLS, RPCs)
- `/supabase/seed.sql` - Seed data (platform admin + DynaTire tenant)
- `/scripts` - Automation (knowledge ingestion)
- `/vapi` - Vapi agent config and tool definitions
- `/n8n` - Workflow blueprints (calendar sync, post-call summarizer)
- `/docs` - Architecture, setup, plans, and reference docs
- `/certs` - Self-signed HTTPS certificates for local dev

## Tech Stack
- **Backend**: Fastify 4.x, bcrypt, zod, pg (Node PostgreSQL driver)
- **Frontend**: Next.js 14, React 18, Tailwind CSS 3.4, Lucide icons, react-big-calendar
- **Edge Functions**: Deno, Supabase Edge Functions, Pino logger
- **Database**: PostgreSQL + pgvector (ankane/pgvector Docker image)
- **Testing**: Vitest (dashboard), Jest (backend), Deno test (edge functions)
- **Voice**: Vapi, Telnyx, Groq/Llama 3, Deepgram Nova-2, Cartesia TTS

## Development
- Bootstrap: `npm run bootstrap` (installs deps, starts DB, applies migrations, seeds)
- Start: `npm start` (Dashboard: https://localhost:3001, Backend: https://localhost:3000)
- Test backend: `npm test`
- Test dashboard: `cd dashboard && npm test`
- Test edge functions: `deno task test --no-check`
- Login: dale@ai-sec.com / password
- Super-admin tenant: `00000000-0000-0000-0000-000000000000`
- PoC tenant (DynaTire): `f234e471-0e60-4163-86c9-93cfd9338e3a`
- Docker DB on port 5433

## Database Key Details
- RLS on all tenant-scoped tables using `app.current_tenant_id` context variable
- `book_appointment_atomic()` RPC: 3-layer constraint check (resource, employee, shift)
- `search_tenant_docs()` RPC: cosine similarity over pgvector embeddings
- Polymorphic assignment: `p_assignment_id` can be INTEGER (employee) or UUID (user)
- Mixed ID types: services/employees use SERIAL, resources/users use UUID

## Code Conventions
- Dashboard components follow List+Detail pane pattern (sidebar list, detail right)
- UI primitives in `dashboard/components/ui/` (Button, Card, Input, Select, Modal, Badge)
- API client centralized in `dashboard/lib/api.ts` with namespaced `Api.{resource}.{action}()`
- Deno service layer: Service -> Dispatcher -> Repository pattern
- Fastify: monolithic index.ts (needs refactoring into route modules)

## Known Issues (as of March 2026)
- Shift timezone bug in book_appointment_atomic (UTC conversion can cause day-of-week mismatch)
- users.email is globally unique instead of per-tenant
- RLS context variable inconsistency (app.current_tenant_id vs request.jwt.claim.tenant_id)
- Dev bypass button in dashboard page.tsx (must remove before production)
- Undefined variables: setDraftEvent in AppointmentView, handleEditFormChange in CRMView
- Fastify index.ts is 800+ line monolith with no RLS enforcement
- Scheduling logic duplicated between src/core/scheduling.ts and supabase/.../core/scheduling.ts

## Project Status
Phase 8 (Go-Live). All 7 development phases complete. Remaining: cloud migration, Vapi server URL config, Telnyx phone assignment, n8n webhook plumbing, beta testing with DynaTire.
