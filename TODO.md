# AI Secretary SaaS - Deployment TODO

## 1. Multi-Tenant Knowledge Base (RAG)
- [x] **Schema**: Create `tenant_docs` table with `pgvector` support.
- [x] **Edge Tool**: Implement `get_company_policy_answer` in Edge Functions.
- [x] **Ingestion Script**: Create `scripts/ingest-knowledge.ts` for PDF feeding.
- [x] **Dashboard UI**: Add "Knowledge Base" tab for document upload and management.
- [x] **Chunking**: Paragraph-aware overlapping chunks with configurable size (BUG-050).
- [x] **Deduplication**: Delete existing chunks before re-ingesting same source (BUG-051).
- [ ] **Live Testing**: Upload a real policy PDF and verify AI uses it during a call.

## 2. Advanced Scheduling (Shifts & Skills)
- [x] **Skill Matrix**: Create grid for matching staff skills to resource capabilities.
- [x] **Shift Schema**: Create `employee_shifts` table.
- [x] **Shift UI**: Add dashboard screen for managing employee working hours.
- [x] **Atomic Enforcement**: Update `book_appointment_atomic` to strictly enforce shift hours.
- [x] **DST Safety**: Shift validation uses `AT TIME ZONE` for correct DST handling (BUG-046).
- [x] **Auto End-Time**: `book_appointment_atomic` derives `end_time` from service `duration_minutes` (BUG-040).
- [x] **Shift Editing**: UI supports editing existing shifts, not just creating (BUG-047).
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
- [x] **n8n Trigger**: `notify_n8n_on_appointment` now uses `pg_net` when available, falls back to NOTICE (BUG-034).
- [ ] **Outlook Branch**: Implement Outlook calendar sync (currently empty) (BUG-033).
- [ ] **Token Refresh**: Add OAuth token refresh logic to Google/Outlook sync (BUG-033).
- [ ] **Call Summary Embeddings**: Generate embeddings in post-call summarizer n8n workflow (BUG-032).

## 5. Deployment & Go-Live
- [ ] **Cloud Migration**: Move from local Docker/Deno to a production Supabase project.
- [ ] **Secrets Management**: Set `OPENAI_API_KEY`, `DATABASE_URL`, and `VAPI_SERVER_URL_SECRET` in cloud secrets.
- [ ] **Vapi Agent**: Point the official Vapi Agent to the production Edge Function URL.
- [x] **Agent Template**: Templatize `agent.json` — replace hardcoded tenant ID and date (BUG-049).
- [ ] **Telephony**: Connect a real phone number via Telnyx or Vapi.
- [ ] **Beta Testing**: Conduct real-world call tests with PoC tenants (DynaTire).

## 6. Infrastructure & Stability (Completed March 2026)
- [x] **Database Persistence**: Resolved via Docker volumes.
- [x] **Test Isolation**: Created `test_db` for automated suites.
- [x] **Port Standardization**: Backend (3000), Dashboard (3001).
- [x] **Build Reliability**: Fixed CommonJS/ESM and Type errors.

## 7. Security & Quality Hardening (Completed March 2026)
- [x] **JWT Auth**: Token-based authentication with 8h expiry and auto-logout on 401 (BUG-012).
- [x] **RLS Enforcement**: All 15 tenant-scoped route modules use `withTenantClient()` with `api_user` role (BUG-007). Only super-admin and auth routes use the admin pool.
- [x] **Least-Privilege DB**: `api_user` downgraded from `ALL PRIVILEGES` to explicit grants (BUG-008).
- [x] **Form Validation**: Zod schemas for login, customer, and appointment creation (BUG-011).
- [x] **Error Boundaries**: React ErrorBoundary wraps all dashboard views (BUG-010).
- [x] **Dev Bypass Removed**: Production auth bypass button deleted (BUG-005).
- [x] **Per-Tenant Email**: Email uniqueness scoped to tenant, not global (BUG-002).
- [x] **RLS Consistency**: Standardized all policies on `app.current_tenant_id` (BUG-006).
- [x] **SessionContext**: Centralized auth state via React Context (BUG-045).
- [x] **Structured Logging**: Dashboard logger utility with JSON output and log levels (BUG-055).
- [x] **JSONB Constraints**: CHECK constraints on metadata columns (BUG-052).

## 8. Remaining Technical Debt
These are known issues from the March 2026 code review (see BUGS.md for details).

### Pre-Production (should fix before go-live)
- [x] **Route Extraction**: Break `src/index.ts` monolith into 15 route modules including vocabulary and billing (BUG-017).
- [x] **ID Standardization**: Migrated services and employees from SERIAL to UUID (BUG-015).
- [x] **Customer Timezone**: `check_availability_with_tz()` function respects customer timezone (BUG-031).
- [x] **Orphan Transcript Linking**: `link_orphaned_transcripts()` SQL function matches via call_id (BUG-030).
- [x] **Accessibility**: ARIA labels on nav, modals, inputs, buttons, and error messages (BUG-039).

### Post-Launch (can defer)
- [x] **Code Dedup**: Shared `scheduling.ts` in `shared/` — both Node and Deno re-export from it (BUG-016).
- [x] **Code Dedup**: Shared `getEmbedding.ts` in `shared/` — both Node and Deno use `createGetEmbedding()` (BUG-024).
- [x] **Dead Code**: Removed BookingService, Provider pattern, InMemoryBookingStorage, MockLlmProvider, and `/chat` endpoint (BUG-018, BUG-019).
- [x] **Audit Logging**: `audit_log` table with triggers on appointments, customers, resources (BUG-037).
- [x] **Soft Deletes**: `is_deleted`/`deleted_at` columns on appointments, customers, resources, employees (BUG-038).

## 9. CRM & Dashboard Enhancements (Completed March 2026)
- [x] **Unified CRM Detail View**: Customer detail pane shows upcoming/past appointments with cancel capability, enhanced call summaries with transcript data, and internal notes.
- [x] **Customer Appointment Endpoint**: `GET /customers/:id/appointments` returns appointments with resource/employee names.
- [x] **Appointment Cancel Endpoint**: `POST /appointments/:id/cancel` soft-cancels by updating status (not deleting).
- [x] **Enhanced Call Summaries**: `/call-summaries` JOINs `call_transcripts` for timestamps and transcript availability.
- [x] **CRM Search**: Customer list search bar wired up (filters by name, phone, email).
- [x] **API Client Methods**: `Api.customers.appointments()` and `Api.appointments.cancel()` added.
- [x] **Employee Attributes**: Migration adds first_name, last_name, email, phone columns to employees table.
- [x] **Shared JS Artifacts**: Compiled `shared/getEmbedding.js`, `shared/scheduling.js`, `dashboard/lib/constants.js` committed for deployment.

## 10. Navigation & Vocabulary System (Completed March 2026)
- [x] **Navigation Restructure**: 12 flat tabs consolidated to 5 grouped sections (Schedule, Customers, My Team, My Business, AI & Insights) with sub-tab navigation.
- [x] **Composite Views**: MyTeamView (Employees/Shifts/Skills), MyBusinessView (Services/Resources/Knowledge), AIInsightsView (AI Persona/Analytics).
- [x] **Business Templates**: Expanded from 4 to 20 types with vocabulary labels and example services per type.
- [x] **Vocabulary System**: resource_label, resource_plural, employee_label, employee_plural, booking_label on business_templates + nullable overrides on tenants.
- [x] **GET /vocabulary Endpoint**: 3-tier fallback (tenant override > template default > hardcoded fallback).
- [x] **POST /register Endpoint**: Public self-service tenant + user creation with Zod validation and JWT response.
- [x] **Onboarding Flag**: onboarding_completed boolean on tenants table for wizard detection.
- [x] **Mobile Navigation**: Bottom nav updated to show all 5 sections (was 4 of 12).
- [x] **Api.vocabulary.get()**: Dashboard API client method for resolved vocabulary labels.
- [x] **seed.sql Fix**: ON CONFLICT (tenant_id, email) for per-tenant email uniqueness.
- [x] **Test Coverage**: 229 backend tests + 369 dashboard tests = 598 total, all passing.

## 11. Scheduler, Assignments & Coverage Visibility (Phase 12 — Complete)
> Ship-blocking. The owner needs to see who's doing what, assign people to services, and know where the gaps are — without learning the dashboard tab by tab.

### 11A. Repeatable Setup Wizard
Not just onboarding — the primary configuration tool for non-technical owners. Re-enter anytime via "Setup Assistant" button.

- [x] **Wizard Shell Component**: Progress indicator, step navigation, back/forward, "Setup Assistant" re-entry button on dashboard sidebar.
- [x] **Step 1 — Services**: Service CRUD within wizard context. Pre-populated from template on first run.
- [x] **Step 2 — Resources**: Resource CRUD within wizard context. Vocabulary-aware labels.
- [x] **Step 3 — Employees**: Employee CRUD within wizard context.
- [x] **Step 4 — Shifts**: Shift editor per employee. Day toggles + time pickers. Shows total hours covered.
- [x] **Step 5 — Assignments**: Assign employees → services and services → resources. Live coverage badges update as assignments are made. Broken chain warnings inline.
- [x] **Step 6 — Review**: Coverage summary. Every service listed with Full/Partial/Uncovered/Inactive badge. Broken chains with "Fix now" links back to Step 5. "You're ready" or "Fix these first" message.
- [x] **Re-Entry Logic**: Wizard detects existing data and pre-fills. Owner can jump to any step. Changes save immediately.
- [x] **First-Run vs Return**: First run shows welcome copy and template defaults. Return visits show current state.

### 11B. Scheduler Views
Three views: "Who's doing what?" (swimlanes), "Are my bays full?" (resource columns), "What's next?" (list). Coverage gaps visible in all three.

- [x] **Staff Swimlane View (Default)**: Employee rows × hourly columns. Appointment blocks coloured by employee. Hatching for off-shift. Click empty slot → Quick Book. Click employee pill → Day Focus.
- [x] **Resource Columns View**: Bay/station columns with coverage bar at top. Red zones for gaps.
- [x] **Appointment List View**: Chronological list. Coverage gap warnings inline.
- [x] **View Switcher**: Tab bar above schedule.
- [x] **Date Navigation**: Previous/next day, week picker, "Today" button.
- [x] **Employee Day Focus Panel**: Click employee pill → full day timeline, booked/available/off-shift slots, utilisation bar + stats, skills at bottom.
- [x] **Quick Book Panel**: Single-screen walk-in booking. Customer search, service selector (filtered to skills), resource selector (filtered to available), time slot, notes, confirm. Under 30 seconds.

### 11C. Skill Relationship Map
Interactive 3-column mind map: "Who can do what, where?" Broken chains and gaps visible immediately.

- [x] **3-Column Layout**: Employees | Skills/Services | Resources. Click employee → skills light up. Click skill → resources light up.
- [x] **Connection Lines**: Animated SVG lines between columns.
- [x] **Broken Chain Detection**: Amber dashed lines when chain is incomplete. "Fix now" action opens Add Service dialog.
- [x] **Coverage Badges on Skills**: Full (green), Partial (amber), Uncovered (red), Inactive (grey).
- [x] **Reset Button**: Clear all selections.

### 11D. Coverage Visibility (Baked In)
Not a separate feature — coverage status is visible wherever the owner is already looking.

- [x] **`check_coverage_gaps()` Postgres Function**: Returns `covered_hours[]`, `gap_hours[]`, `uncovered_services[]` for a tenant and date range.
- [x] **Coverage Triggers**: Fire on shift INSERT/UPDATE/DELETE, skill_matrix INSERT/DELETE, and at booking time (pre-flight).
- [x] **Coverage Bar Component**: Reusable colour-coded bar. Red zones = gaps. Used in scheduler resource columns.
- [x] **Coverage Status Badge Component**: Reusable badge (Full/Partial/Uncovered/Inactive). Used in services list, skill map, and wizard.
- [x] **`GET /coverage` Endpoint**: Returns coverage status for all services for a given date range.

### 11E. RAG Normalization Layer
> Search quality. Raw conversational text produces inconsistent embeddings. A normalization step before embedding reduces text to its semantic core so vector search reliably matches across phrasings.

Example: "I think Suzy is great and would prefer to work with her" → normalized to "Sally prefers Suzy". Four weeks later: "I like Suzy. Let's go with her" → "Sally likes Suzy" — close enough for cosine similarity to match.

- [x] **Normalization Function**: `shared/normalizeForEmbedding.ts` — takes raw text + context (customer name, etc.), returns normalized statement via LLM call.
- [x] **Integration with Ingestion**: Knowledge base ingestion normalizes before embedding each chunk.
- [x] **Integration with Call Summaries**: Post-call summarizer normalizes key details before embedding.
- [x] **Integration with Customer Notes**: Notes saved via dashboard normalized before embedding.
- [x] **Query Normalization**: Search queries normalized before embedding for lookup.
- [x] **Raw Text Preservation**: Both `raw_text` and `normalized_text` stored. Raw for display, normalized for search.
- [x] **Schema Update**: Add `normalized_text` column to `tenant_docs` and `call_summaries` tables.

### 11F. Stripe Lite (Two Plans)
> You can't collect money without this. Minimal Stripe — two prices, one webhook, one gate. No plan picker UI, no trial logic, no call limits, no billing portal.

| Plan | Price | Target |
|---|---|---|
| Solo | $29/mo | Solo operators, small shops (1–2 staff) |
| Growth | $59/mo | Small teams (3–5 staff) |

Both plans include all features. No feature gating between tiers at launch.

- [ ] **Stripe Products**: Create Solo ($29/mo) and Growth ($59/mo) as recurring products in Stripe dashboard. Save Price IDs.
- [ ] **Tenant Schema Migration**: Add `stripe_customer_id`, `stripe_subscription_id`, `subscription_status` (active/past_due/canceled/unpaid), `plan_id` (solo/growth) to tenants table.
- [ ] **Checkout Route**: `POST /billing/checkout` — creates Stripe Checkout session for the tenant's plan, returns redirect URL.
- [ ] **Webhook Route**: `POST /billing/webhook` — handles `checkout.session.completed` (set active), `invoice.payment_failed` (set past_due), `customer.subscription.deleted` (set canceled). Verifies webhook signature.
- [ ] **Subscription Gate Middleware**: Check `subscription_status` on authenticated requests. If not `active`, return 402. Dashboard shows "Update your payment to continue." AI stops answering.
- [ ] **Onboarding Integration**: After registration, redirect to Stripe Checkout. On success redirect, mark tenant active and continue to setup wizard.
- [ ] **Env Vars**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SOLO_PRICE_ID`, `STRIPE_GROWTH_PRICE_ID`.

---

## Backlog

> Features that are valuable but not required for market launch. Preserved here so nothing is lost. Prioritize after Phase 12 is shipped and DynaTire is live.

### Automated Phone Provisioning
Manual phone provisioning (10 min per customer in Telnyx/Vapi dashboards) works for the first 10–20 customers. Automate when manual onboarding becomes the bottleneck.

- [ ] **Telnyx Service**: `src/services/telnyx.ts` — search numbers by area code, purchase, configure SIP trunk.
- [ ] **Vapi Agent Auto-Creation**: Create agent from `vapi/agent.template.json` with tenant config injected.
- [ ] **Area Code Wizard Step**: Step 10 of onboarding — owner picks area code, selects from available numbers.
- [ ] **Provisioning Route**: `POST /tenants/provision-phone` — atomic Telnyx + Vapi setup with rollback.
- [ ] **Tenant Schema**: `phone_number`, `vapi_agent_id`, `telnyx_trunk_id`.
- [ ] **Confirmation Screen**: "Call it right now" CTA.
- [ ] **Area Code Fallback**: Suggest nearby area codes if none available.
- [ ] **Env Vars**: `TELNYX_API_KEY`, `VAPI_API_KEY`.

### Full Billing System (Stripe)
Extends Stripe Lite (11F) with trial management, a third tier, plan switching, call limits, and self-service billing portal. Build when customer volume justifies complexity.

| Plan | Price | Calls/mo | Staff | Resources |
|---|---|---|---|---|
| Professional | $99/mo | Unlimited | Unlimited | Unlimited |

Platform cost: ~$12–36/mo per tenant. Call limits protect margin.

- [ ] **Professional Tier**: $99/mo product in Stripe + `STRIPE_PRO_PRICE_ID`.
- [ ] **Plan Picker UI**: In onboarding wizard, replace direct Checkout redirect.
- [ ] **Stripe Elements**: Embedded card form in dashboard (instead of Checkout redirect).
- [ ] **14-Day Trial**: `trial_ends_at` + reminder SMS/email 3 days before.
- [ ] **Call Limit Enforcement**: Track monthly calls, graceful AI response at limit.
- [ ] **Billing Portal**: Stripe Customer Portal for self-service plan changes.
- [ ] **Plan Upgrade/Downgrade**: Flow in dashboard settings.
- [ ] **Env Vars**: `STRIPE_PUBLISHABLE_KEY` for client-side Stripe Elements.

### Business Intelligence & Employee ROI
Retention feature — not needed for launch. Build when booking data is sufficient for meaningful recommendations.

- [ ] **Employee Efficiency**: Utilisation %, revenue/hr, skills used vs idle, thresholds (>85% near capacity, 50–85% healthy, <50% underutilised).
- [ ] **Service ROI**: Bookings/mo, revenue/hr, single-point-of-failure detection, ROI signals (Strong/Review/Poor/Remove).
- [ ] **Recommendations Engine**: Ranked action items — broken chains, cross-training, pricing, capacity warnings.
- [ ] **Materialized Views**: `employee_roi_metrics`, `service_roi_metrics` (refreshed nightly).
- [ ] **API Endpoints**: `GET /analytics/employees`, `/services`, `/recommendations`.
- [ ] **BI Dashboard**: 3 sub-tabs in AI & Insights, period selector, expandable rows, action buttons.

### Personal Resources & Unified Booking Model
Only needed when onboarding businesses with mobile techs or service writers at non-fixed stations.

- [ ] **Schema**: `is_personal` boolean on `resources` table.
- [ ] **Resource Manager UI**: Hide personal resources from bay/chair list.
- [ ] **Employee Setup**: "Fixed station?" → No → auto-create personal resource.
- [ ] **Skill Map**: Personal resources show clean green chain, "personal" label.
- [ ] **Coverage Logic**: Personal resource availability = employee availability.
- [ ] **Dashboard Alert**: "Sarah W. has no resource assigned — [Create Sarah's Desk]".

### Advanced Coverage Alerts
Visual coverage in Phase 12 covers the dashboard. These are the automated notification and AI behaviour extensions.

- [ ] **Owner SMS Alerts**: Telnyx SMS for critical gaps, deduplicated within 24 hours.
- [ ] **AI Behaviour Change**: Offer alternative times when booking into a gap.
- [ ] **Missed Revenue Tracking**: "This week you missed $240 due to coverage gaps."
- [ ] **Nightly Coverage Job**: Check next 7 days, surface new gaps.
- [ ] **Dashboard Alert Banner**: Critical gap notification with action buttons (Reassign / Call customers / Dismiss).

### Skill Map Drag-and-Drop Reorder
- [ ] **Drag-and-drop reordering** of employees, services, and resources within the Skill Relationship Map columns. Requires `sort_order` column on employees, services, and resources tables + drag library (dnd-kit or react-beautiful-dnd). Polish feature — map works without it.

---

### Platform Adapter Architecture (Analysis Required)

> **Status: Under consideration.** This is a large architectural change that requires serious analysis before implementation. The goal is to make the platform agnostic and extensible — able to swap databases, sync with external CRMs, integrate with multiple calendar providers, and support add-on plugins without touching core business logic. Preserved here with full detail for future planning.

#### Problem Statement
The application is currently tightly coupled to specific providers. Every route file contains raw PostgreSQL-specific SQL. Calendar sync is Google-only. There's no external CRM integration. Embedding generation is hardcoded to OpenAI. If any of these need to change at scale, it requires rewriting core code.

#### Current Coupling Map

| Layer | Currently Coupled To | Specific Dependencies |
|-------|---------------------|----------------------|
| Data Access | PostgreSQL | Raw SQL in 15 route files, pgvector for RAG, RLS for multi-tenancy, PL/pgSQL functions (`book_appointment_atomic`, `check_coverage_gaps`), `jsonb`, `AT TIME ZONE`, `gen_random_uuid()`, 50+ migrations |
| Voice AI | Vapi | Edge function expects Vapi webhook format, Vapi tool definitions in `vapi/tools.json` |
| Telephony | Telnyx | SIP trunk config, planned phone provisioning API |
| Embeddings | OpenAI | `text-embedding-3-small` in `shared/getEmbedding.ts` |
| LLM | OpenAI/Groq | GPT-4o-mini for normalization, Groq/Llama 3 for voice conversation |
| Calendar Sync | Google Calendar | n8n workflow, `tenant_calendar_settings` table |
| Payments | Stripe | Direct Stripe API in `src/routes/billing.ts` |
| SMS | Telnyx | Planned for owner notifications |
| Auth | bcrypt + JWT | Hardcoded in `src/routes/auth.ts`, no OAuth/SSO |
| CRM | Built-in only | No external CRM sync capability |

#### Proposed Architecture: Plugin/Integration Registry

```
Business Logic (routes, services)
       │
       ▼
 ┌─────────────┐
 │  Interface   │  ← TypeScript contracts (IDataStore, ICalendarSync, ICrmSync, etc.)
 │  (Contract)  │
 └──────┬──────┘
        │
 ┌──────┴──────┐
 │  Adapter    │  ← Swappable implementations per provider
 │  Registry   │
 └─────────────┘
        │
   ┌────┼────────────────────────────────────┐
   │    │    Database Adapters               │
   │    ├── PostgresAdapter (current)        │
   │    ├── MySQLAdapter (future)            │
   │    ├── MSSQLAdapter (future)            │
   │    └── OracleAdapter (future)           │
   │                                         │
   │         Calendar Adapters               │
   │    ├── GoogleCalendarAdapter            │
   │    ├── OutlookCalendarAdapter           │
   │    └── iCalAdapter (future)             │
   │                                         │
   │         CRM Adapters                    │
   │    ├── InternalCrmAdapter (current)     │
   │    ├── SalesforceAdapter (future)       │
   │    ├── HubSpotAdapter (future)          │
   │    └── ZohoCrmAdapter (future)          │
   │                                         │
   │         Embedding Adapters              │
   │    ├── OpenAIEmbeddingAdapter (current) │
   │    ├── CohereAdapter (future)           │
   │    └── LocalModelAdapter (future)       │
   │                                         │
   │         Payment Adapters                │
   │    ├── StripeAdapter (current)          │
   │    └── SquareAdapter (future)           │
   │                                         │
   │         SMS/Notification Adapters       │
   │    ├── TelnyxSmsAdapter (current)       │
   │    ├── TwilioAdapter (future)           │
   │    └── SendGridEmailAdapter (future)    │
   └─────────────────────────────────────────┘
```

#### Proposed Interface Contracts

```typescript
// Integration base
interface Integration {
  id: string;
  name: string;
  type: 'calendar' | 'crm' | 'sms' | 'embedding' | 'payment' | 'database';
  configure(tenantId: string, config: Record<string, string>): Promise<void>;
  isConfigured(tenantId: string): Promise<boolean>;
}

// Calendar sync adapter
interface ICalendarSync extends Integration {
  type: 'calendar';
  syncAppointment(tenantId: string, appointment: Appointment): Promise<string>; // returns external event ID
  deleteEvent(tenantId: string, externalId: string): Promise<void>;
  getFreeBusy(tenantId: string, start: Date, end: Date): Promise<BusySlot[]>;
}

// CRM sync adapter
interface ICrmSync extends Integration {
  type: 'crm';
  syncCustomer(tenantId: string, customer: Customer): Promise<string>; // returns external contact ID
  importContacts(tenantId: string): Promise<Customer[]>;
  syncCallSummary(tenantId: string, summary: CallSummary): Promise<void>;
}

// Data access adapter (the big one)
interface IDataStore {
  // Tenant operations
  getTenant(id: string): Promise<Tenant | null>;
  createTenant(data: CreateTenantInput): Promise<Tenant>;

  // Customer operations
  listCustomers(tenantId: string, opts: PaginationOpts): Promise<Customer[]>;
  createCustomer(tenantId: string, data: CreateCustomerInput): Promise<Customer>;
  updateCustomer(id: string, tenantId: string, data: UpdateCustomerInput): Promise<void>;
  deleteCustomer(id: string, tenantId: string): Promise<void>;

  // Appointment operations
  listAppointments(tenantId: string, dateRange: DateRange): Promise<Appointment[]>;
  bookAppointment(tenantId: string, data: BookAppointmentInput): Promise<BookingResult>;
  updateAppointment(id: string, tenantId: string, data: UpdateAppointmentInput): Promise<void>;
  cancelAppointment(id: string, tenantId: string): Promise<void>;

  // ... etc for all entity types
}

// Embedding adapter
interface IEmbeddingProvider {
  embed(text: string): Promise<number[]>;
  dimensions: number; // e.g., 1536 for OpenAI
}
```

#### Database Abstraction: Challenges & Trade-offs

This is the hardest piece. Current Postgres-specific features that would need abstraction:

| Feature | Postgres-specific | ANSI SQL equivalent | Difficulty |
|---------|------------------|--------------------|----|
| pgvector (RAG embeddings) | `vector(1536)`, `<=>` cosine distance | None — requires a vector DB adapter (Pinecone, Weaviate) | Very High |
| Row Level Security | `CREATE POLICY ... USING (tenant_id = ...)` | Application-level WHERE clause filtering | Medium |
| `jsonb` columns | `metadata jsonb`, `jsonb_set()`, `->` operator | JSON string column + application-level parsing | Medium |
| PL/pgSQL functions | `book_appointment_atomic()`, `check_coverage_gaps()` | Rewrite as application-level service functions | High |
| `gen_random_uuid()` | Postgres built-in | `UUID()` (MySQL), `NEWID()` (MSSQL), `SYS_GUID()` (Oracle) | Low |
| `AT TIME ZONE` | Postgres timezone conversion | Database-specific equivalents exist | Low |
| `COALESCE` | ANSI SQL standard | Works everywhere | None |
| `ON CONFLICT DO NOTHING/UPDATE` | Postgres upsert | `INSERT IGNORE` (MySQL), `MERGE` (MSSQL/Oracle) | Medium |
| `RETURNING *` | Postgres-specific | Not available in MySQL — requires separate SELECT | Medium |
| Triggers | `CREATE TRIGGER` | Syntax varies by DB | Medium |
| `pg_net` (HTTP from DB) | Postgres extension | Not available — move to application layer | Medium |

**Recommendation**: If a database switch is ever needed, the most practical path is:
1. Extract all SQL into a Data Access Layer (repository pattern) — one file per entity
2. Keep Postgres as the primary adapter
3. Build a second adapter only when a specific customer/scale requirement demands it
4. For RAG, use a dedicated vector DB (Pinecone/Weaviate) alongside the relational DB rather than trying to make pgvector work everywhere

#### Database Schema: Integration Registry

When ready to implement, this table would store per-tenant integration configs:

```sql
CREATE TABLE tenant_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  integration_type TEXT NOT NULL, -- 'calendar', 'crm', 'sms', 'embedding'
  provider TEXT NOT NULL, -- 'google', 'outlook', 'salesforce', 'hubspot'
  config JSONB NOT NULL DEFAULT '{}', -- encrypted API keys, OAuth tokens, etc.
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, integration_type, provider)
);
```

#### Priority Order (when ready to implement)

| Priority | Adapter | Reason | Effort |
|----------|---------|--------|--------|
| 1 | Calendar Sync (Google + Outlook) | Already planned, natural adapter point, high customer demand | 1-2 weeks |
| 2 | CRM Sync (HubSpot, Salesforce) | Doesn't exist yet, build as adapter from day one | 2-3 weeks |
| 3 | Embedding Provider (OpenAI → Cohere/local) | Small change, `shared/getEmbedding.ts` already isolated | 1-2 days |
| 4 | SMS/Notifications (Telnyx → Twilio) | Small change, not yet built | 1 week |
| 5 | Payment Provider (Stripe → Square) | Stripe is dominant, low priority to switch | 1-2 weeks |
| 6 | Data Access Layer (PostgreSQL abstraction) | Massive effort, only when scale demands it | 4-8 weeks |
| 7 | Voice AI Provider (Vapi → alternatives) | Vapi works well, very niche market | 2-4 weeks |

#### What NOT to abstract

- **Auth** — bcrypt+JWT is standard. Add OAuth/SSO as a feature, not an adapter.
- **Frontend framework** — Next.js/React. No reason to abstract.
- **Edge Functions runtime** — Deno/Supabase. Tied to deployment, not business logic.

#### Next Step When Ready
Start with Priority 1 (Calendar Sync adapter). Build the `ICalendarSync` interface, implement `GoogleCalendarAdapter` and `OutlookCalendarAdapter`, create `tenant_integrations` table, and add a Settings UI for configuring integrations per tenant. This proves the pattern without touching the database layer.
