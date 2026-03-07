# AI Secretary SaaS - Deployment TODO

## 1. Database Initialization (Prerequisite)
- [x] **Deploy Migrations**: Pushed to Supabase `sgibijfchvfuizudrmir`.
- [x] **Dynamic Templating**: Industry templates updated with `{{business_name}}` logic.

## 2. Vapi Agent Configuration (The "Multi-Tenant" Brain)
- [x] **Create Global Vapi Tools** (One-time setup)
  - [x] Add `get_customer_context` tool.
  - [x] Add `check_availability` tool.
  - [x] Add `book_appointment` tool.
  - [x] **Security**: Ensure all 3 tools have `x-vapi-secret: 734987fcfcchsd82`.
- [x] **Configure the Base Agent**
  - [x] Set `serverUrl` and `serverUrlSecret` in `vapi/agent.json` to `https://sgibijfchvfuizudrmir.functions.supabase.co/vapi-tools` and `734987fcfcchsd82` (enforced by `src/vapiAgentConfig.test.ts`).
  - [ ] In the Vapi Dashboard, set the Agent's **Server URL** and **Server URL Secret** to match `vapi/agent.json` so the live agent uses the deployed tools.

## 3. SaaS Operations (How to Launch a New Client)
- [x] **Launch via Dashboard**
  - [x] Open SuperAdmin Dashboard.
  - [x] Click 🏢 (Launch New Business).
  - [x] Select Template (e.g., Salon, Auto Shop).
  - [x] **Copy the generated Tenant ID and Resource ID** from the dashboard.
- [ ] **Update Vapi Persona**
  - [ ] Create a new Agent in Vapi for the new client.
  - [ ] Paste the new `Tenant ID` and `Resource ID` into the System Prompt.
  - [ ] Attach the 3 global tools.

## 4. n8n Async Layer (Summaries & Sync)
- [ ] **Setup n8n**
  - [ ] Import `n8n/post_call_summarizer.json`.
  - [ ] **Attach to Supabase**: Enable Database Webhooks in Supabase Dashboard (Trigger on `appointments` insert).

## 5. Live Testing
- [ ] **Perform Test Call for a NEW Business**
  - [ ] Verify AI identifies itself as the new business name.
  - [ ] Verify booking appears in the specific tenant's view in the dashboard.

## 6. Template & Metadata System (Business-Agnostic Core)
- [x] **Add Flexible Metadata Fields**
  - [x] Add `metadata JSONB` to `appointments` and `customers` so vertical-specific details (vehicles, pets, services, etc.) can be stored without changing the core schema. **This is implemented in the current schema; remaining work in this section is about defining templates and wiring prompts/UX.**
- [ ] **Define Industry Playbooks / Templates**
  - [ ] For each template (e.g., Auto Shop, Salon, Dentist), define a config that lists required intake fields and questions (e.g., vehicle info, tire positions, customer presence, owner vs. non-owner).
  - [ ] Map each question to a key in `appointment.metadata` and/or `customer.metadata`.
- [ ] **Generate AI Prompts from Templates**
  - [ ] Update Vapi agent setup so the System Prompt is generated from the tenant’s selected template, including required questions and business rules.
  - [ ] Ensure the agent must collect all required fields from the caller before calling `book_appointment`.
- [ ] **Store Structured Answers, Not Just Free Text**
  - [ ] Persist answers (license plate, "customer must be present", "vehicle safely positioned", patch vs. replace intent, tire size) as structured metadata, while still writing a human-readable description.
- [ ] **Dashboard Support for Templates**
  - [ ] Allow SuperAdmin to choose an industry template when launching a new business.
  - [ ] Show key metadata fields for appointments in the dashboard (e.g., vehicle summary for auto shops) without hard-coding per-industry logic.
  - [x] Ensure that appointments are stored and enforced using the exact start and end times requested by the user, with no hidden prep/cleanup/travel buffers. **Core enforcement is now in `book_appointment_atomic`, which checks overlaps using the literal requested window and stores that as `start_time`/`end_time`.**

## 7. Calendar Integrations
- [ ] **Decide Supported Calendar Providers**
  - [ ] Confirm initial scope (e.g., Outlook / Microsoft 365, Google Calendar).
- [ ] **OAuth & Auth Storage**
  - [ ] Implement OAuth flow in the dashboard for connecting a business calendar.
  - [ ] Store provider, account, and refresh tokens securely in Supabase (per tenant).
- [ ] **Availability & Booking Sync**
  - [ ] Extend `check_availability` / booking logic to read busy/free times from external calendars.
  - [ ] Extend `book_appointment` to create/update/cancel events on external calendars.
  - [ ] Implement conflict handling (double-booking prevention, time zones).
- [ ] **Webhooks / Polling**
  - [ ] Set up provider webhooks or polling to keep Supabase `appointments` in sync when external events change.
  - [ ] Update n8n flows to react to external calendar changes.
  - [ ] Standardize on a single internal endpoint (e.g., `POST /calendar/sync`) that both n8n and external calendar providers can call, so all calendar updates pass through the same policy and validation layer.

## 8. Analytics & Observability
- [ ] **ROI Analytics**
  - [ ] Define metrics (calls answered, appointments booked, conversion rate) and build a tenant-level dashboard view.
- [ ] **Usage & Cost Monitoring**
  - [ ] Track Vapi/LLM usage per tenant for transparency and billing.
- [ ] **Centralized Logging**
  - [ ] Ship structured logs from Edge Functions and n8n (e.g., to Axiom/Datadog) and create basic alerts for failures (booking errors, webhook failures, calendar sync policy violations).

## 9. Backlog: External CRM Sync (Future)
- [ ] **Revisit External CRM Idea**
  - [ ] Decide if and when to sync to third-party CRMs (e.g., HubSpot / Pipedrive) instead of relying only on the internal Supabase CRM.
  - [ ] Define a minimal scope: which customer fields, preferences, and appointment events should be mirrored vs. remain internal-only.
  - [ ] Design n8n / tool-based sync flows so external CRMs are optional add-ons, not required for the core product.

## 10. Tenant Knowledge Base & FAQ RAG
- [ ] **Schema & Security**
  - [ ] Add a `tenant_docs` (or similarly named) table with `tenant_id`, `title`, `section`, `content`, `source`, and `embedding vector(1536)`, protected by the same RLS model as other tenant data.
- [ ] **PDF / Content Ingestion**
  - [ ] Create a repeatable ingestion path (script or n8n workflow) to pull text from tenant-provided PDFs and web copy, chunk it, embed it via `text-embedding-3-small`, and insert/update rows in `tenant_docs`.
- [ ] **Vapi Tool Integration**
  - [ ] Implement a Vapi tool (e.g., `get_company_policy_answer`) that performs tenant-scoped vector search over `tenant_docs` and returns a small set of snippets plus guidance so the LLM can answer company questions consistently.
- [ ] **Dashboard UX (Future)**
  - [ ] Add a simple knowledge management view where owners can upload documents, review indexed snippets, and quickly answer "what will the AI say if someone asks about our hours or policies?".

## 11. Resource Types & Multi-Calendar Management (Backlog)
- [ ] **Flexible Resource Modeling**
  - [ ] Evolve `resources` so different templates (mobile, salon, auto shop, clinic) can declare resource types (e.g., trucks, stylists, bays, clinicians) and any type-specific metadata.
- [ ] **Per-Resource Calendar Views**
  - [ ] Support viewing the calendar per resource (one calendar per truck/stylist/bay) and, where appropriate, combined capacity views for the whole tenant.
- [ ] **Resource Management UI**
  - [ ] Add a dashboard screen for owners to add, edit, activate/deactivate resources (e.g., "Add Truck", "Add Stylist") instead of relying on seed data only.
- [ ] **Template-Aware Behavior**
  - [ ] Let templates define how resources are selected or auto-assigned (customer picks specific stylist vs. system chooses any free bay/truck) so booking behavior matches the business type.

