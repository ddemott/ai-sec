# AI Secretary SaaS – Project Plan

## Phase 1: Foundation & TDD Setup (Complete ✅)
- [x] **SQL Schema with Tests**: `tenants`, `resources`, `customers`, `appointments`.
- [x] **Atomic Booking**: Postgres RPC handles race conditions.
- [x] **TDD Integration**: Automated local DB setup via `scripts/bootstrap.sh`.

## Phase 2: AI Tool Provider & Context (Complete ✅)
- [x] **AI Tools (Edge)**: `get_customer_context`, `check_availability`, `book_appointment`.
- [x] **Architecture Refactor**: Modular (Hexagonal) architecture with Dependency Inversion.
- [x] **Hardening**: Zod validation and detailed error logging.

## Phase 3: Voice AI & Integration (Complete ✅)
- [x] **Vapi Agent Blueprint**: `vapi/agent.json` and `vapi/tools.json`.
- [x] **Connectivity Guide**: `vapi/TELNYX_SETUP.md`.
- [x] **Latency Optimization**: Implemented Warm-up Pings.

## Phase 4: Async Logic & Background Workers (Complete ✅)
- [x] **n8n Workflow Blueprint**: `docs/N8N_WORKFLOWS.md`.
- [x] **Soft Reservations**: 60-second locks to prevent collision.
- [x] **Audit Schema**: `call_transcripts` and Postgres-to-n8n triggers.

## Phase 5: Dashboard & Management UI (Complete ✅)
- [x] **Multi-Tenant Security**: RLS policies active and verified.
- [x] **Dashboard Scaffold**: Next.js (App Router) + Tailwind + Vitest.
- [x] **Appointment Management**:
    - [x] **Outlook-Style UI**: Three-pane responsive layout.
    - [x] **Calendar Features**: List, Search, Reschedule, Cancel.
    - [x] **Excellent test coverage:** All tests pass for AppointmentView, dashboard calendar, and booking flows.
- [x] **CRM & Notes Management**:
    - [x] **Customer Profiles**: Searchable list and detail view.
    - [x] **Edit Mode**: Update internal notes and contact info.
- [x] **AI Persona Tuning**: Live updates for System Prompt and Voice ID.
- [x] **Responsive Design**: Mobile-first bottom navigation and touch-friendly controls.

## Future Phases (Post-PoC)
- [ ] **Calendar & CRM Integrations**: First-class sync with Google/Outlook calendars and optional CRMs (HubSpot/Pipedrive), driven by tenant-level settings.
- [ ] **Template & Metadata System**: Per-industry intake playbooks that write structured data into JSONB `metadata` on customers/appointments while keeping the core schema generic, including **service timing profiles** (prep, base duration, cleanup/admin, travel) that drive smart scheduling.
- [ ] **ROI Analytics**: View calls Answered vs. Appointments Booked.
- [ ] **Centralized Observability**: Pino/Winston logging to Axiom/Datadog.
- [ ] **Usage Dashboard**: Monitor Vapi/Groq costs per tenant.

### Knowledge Base & RAG Layer
- [ ] **Tenant Knowledge Schema**: Add a `tenant_docs` (or similar) table keyed by `tenant_id` with fields for `title`, `section`, `content`, `source`, and `embedding vector(1536)` to store hours, policies, and FAQs per business.
- [ ] **PDF / Content Ingestion**: Build a repeatable path (Deno script or n8n workflow) to extract text from PDFs, chunk it, generate embeddings (`text-embedding-3-small`), and populate the tenant knowledge table.
- [ ] **Policy Q&A Tooling**: Expose a Vapi tool (e.g., `get_company_policy_answer`) that performs tenant-scoped semantic search over this table and feeds the retrieved snippets plus the caller's question into the LLM for consistent answers to "What are your hours?", "Do you work at 3 AM?", etc.
- [ ] **Dashboard Management (Future)**: Allow owners to upload/update their knowledge artifacts (PDFs, FAQs) and see what content the AI is using to answer company questions.

### Smart Scheduling & Slack Policies
- Encode per-tenant scheduling policies such as max daily utilization, minimum gaps between effective appointments, and “keep at least one trailing slot open” so the system avoids over-packing days.
- Ensure availability tools and the Vapi agent only offer times that respect these timing profiles and policies, leaving room for admin work and future schedule adjustments.

### Resource, Skills & Employee Management
- [ ] **Resource Typing & Capabilities**: Evolve `resources` so tenants can declare types (e.g., STYLIST, BAY, ROOM, TRUCK) and per-resource capabilities (e.g., `alignment`, `color`, `massage`) without schema changes.
- [ ] **Employee Skills & Mapping**: Add an employee/technician model (or extend `users`) that captures per-person skills and maps employees to resources where appropriate (e.g., stylist ↔ chair, technician ↔ bay).
- [ ] **Service Catalog per Tenant**: Allow tenants to define a catalog of services with durations, timing profiles, and required resource capabilities/employee skills.
- [ ] **Admin CRUD UI**: Build per-tenant admin screens to Create/Read/Update/Delete resources, employees, skills, and services so owners can react to real-world changes (staff turnover, training, new equipment).
- [ ] **Template-Aware Defaults**: For each vertical template (salon, auto shop, clinic, etc.), ship sensible defaults for resource types, skills, and services that can be overridden per tenant.
