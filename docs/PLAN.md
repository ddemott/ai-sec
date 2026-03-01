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
- [x] **CRM & Notes Management**:
    - [x] **Customer Profiles**: Searchable list and detail view.
    - [x] **Edit Mode**: Update internal notes and contact info.
- [x] **AI Persona Tuning**: Live updates for System Prompt and Voice ID.
- [x] **Responsive Design**: Mobile-first bottom navigation and touch-friendly controls.

## Future Phases (Post-PoC)
- [ ] **ROI Analytics**: View calls Answered vs. Appointments Booked.
- [ ] **Centralized Observability**: Pino/Winston logging to Axiom/Datadog.
- [ ] **Usage Dashboard**: Monitor Vapi/Groq costs per tenant.
