# AI Secretary SaaS - Deployment TODO

## 1. Database Initialization (Prerequisite)
- [x] **Deploy Migrations**: Schema applied to main and test databases.
- [x] **Automated Setup Script**: `scripts/setup-db.sh` created for repeatable deployment.
- [x] **Seed Data**: Fully populated with DynaTire PoC and SuperAdmin accounts.

## 2. Vapi Agent Configuration (The "Multi-Tenant" Brain)
- [x] **Create Global Vapi Tools** (One-time setup)
  - [x] Add `get_customer_context` tool.
  - [x] Add `check_availability` tool.
  - [x] Add `book_appointment` tool.
- [x] **Configure the Base Agent**
  - [x] Set `serverUrl` and `serverUrlSecret` in `vapi/agent.json`.

## 3. SaaS Operations (How to Launch a New Client)
- [x] **Launch via Dashboard**
  - [x] Open SuperAdmin Dashboard.
  - [x] Click 🏢 (Launch New Business).
  - [x] **Verified**: Resource and appointment data now loading via port 3000.
- [ ] **Update Vapi Persona**
  - [ ] Create a new Agent in Vapi for the new client.
  - [ ] Paste the new `Tenant ID` and `Resource ID` into the System Prompt.
  - [ ] Attach the 3 global tools.

## 4. n8n Async Layer (Summaries & Sync)
- [/] **Setup n8n**
  - [x] Import `n8n/post_call_summarizer.json`.
  - [ ] **Attach to Supabase**: Enable Database Webhooks in Supabase Dashboard (Trigger on `appointments` insert).

## 5. Live Testing
- [ ] **Perform Test Call for a NEW Business**
  - [ ] Verify AI identifies itself as the new business name.
  - [ ] Verify booking appears in the specific tenant's view in the dashboard.

## 6. Resource & Employee Management
- [x] **Service Definitions**: Added `services` table and seeded data.
- [x] **Employee Skills**: Added `employees` table and skill mappings.
- [x] **ResourceManager UI**: Fixed port 3000 communication bug; now viewing live resources.
- [ ] **Scheduling Integration**: Wire up the "book_appointment" edge function to use the new service/employee mapping logic.
