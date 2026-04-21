# SecretaryHQ — Project Roadmap

## Completed Phases

### Phase 1: Foundation & TDD Setup
- SQL schema for tenants, resources, customers, appointments with atomic booking RPC
- TDD integration with automated local DB setup

### Phase 2: AI Tool Provider & Context
- Edge Function tools: `get_customer_context`, `check_availability`, `book_appointment`
- Modular (hexagonal) architecture with Zod validation and structured error logging

### Phase 3: Voice AI & Integration
- Vapi agent blueprint (`agent.json`, `tools.json`), Telnyx connectivity guide, warm-up pings for latency

### Phase 4: Async Logic & Background Workers
- n8n workflow blueprints for post-call summarization and calendar sync
- `call_transcripts` audit schema with Postgres-to-n8n triggers

### Phase 5: Dashboard & Management UI
- Outlook-style appointment calendar, searchable CRM with AI history, AI persona tuning

### Phase 6: Knowledge Base & RAG
- `tenant_docs` table with pgvector, ingestion engine (Deno script + dashboard PDF upload)
- `get_company_policy_answer` tool for grounding AI in business docs

### Phase 7: Advanced Scheduling & ROI
- Skill matrix, shift management (UI + DB enforcement), ROI analytics dashboard, calendar sync schema

### Phase 8: Security & Quality Hardening
- Full code review resolved 58 bugs across all severity levels
- JWT auth with expiry and auto-logout, standardized RLS via `withTenantClient()`, Zod validation at all API boundaries
- DST-safe shift checks, error boundaries, SessionContext, structured logging
- Tests passing (expanded to 1,894 total by Phase 13)

### Phase 9: Scale & Polish
- UUID standardization throughout, shared `scheduling.ts` and `getEmbedding.ts`
- Dead code cleanup, audit logging with before/after snapshots, soft deletes with partial indexes
- ARIA accessibility labels, customer timezone support, agent template with Mustache variables
- Route extraction: 25 focused modules under `src/routes/` with shared middleware layer (expanded with CRM integration routes, communications, reminders, versionHistory, tts)

### Phase 10: CRM & Dashboard Enhancements
- Unified CRM detail view with appointments, call summaries, transcripts, notes, and search
- Customer appointments API, appointment cancel API, employee attributes (first/last name, email, phone)

### Phase 11: Navigation & Vocabulary System
- 12 flat tabs consolidated to 5 grouped sections with sub-tabs
- 29 business types across 6 categories with 3-tier vocabulary fallback system
- Self-service registration (`POST /register`), onboarding flag, mobile bottom nav

### Phase 12: Scheduler, Assignments & Coverage Visibility
- **Setup Wizard**: 7-step repeatable guided setup (Services, Resources, Employees, Shifts, Assignments, Review, Go Live) with live coverage feedback, phone activation, re-entry logic, first-run vs return modes
- **Scheduler**: Staff swimlane view, resource columns view, appointment list view, date navigation, employee day focus panel, quick book panel (under 30 seconds)
- **Skill Relationship Map**: Interactive 3-column layout (Employees | Skills | Resources) with animated SVG connection lines, broken chain detection, coverage badges
- **Coverage Visibility**: `check_coverage_gaps()` Postgres function, coverage triggers, reusable coverage bar and badge components, `GET /coverage` and `GET /coverage/staffing` endpoints
- **RAG Normalization**: `shared/normalizeForEmbedding.ts` normalizes text before embedding into pgvector; integrated with ingestion, call summaries, customer notes, and query lookup; raw text preserved alongside normalized
- **Stripe Lite**: Solo ($129/mo), Growth ($279/mo), Professional ($449/mo) plans with Stripe Checkout, webhook handler, subscription gate middleware, onboarding integration

---

## Phase 13: UI/UX Polish & Production Readiness (Current)

- [ ] **UI/UX Flow Improvements**: Ongoing — finding issues through hands-on testing
- [x] **Vocabulary Wiring**: Done — 21 business-facing components use `useVocabulary()` hook
- [x] **Google Calendar Sync**: Done — OAuth flow, token refresh, auto-sync on appointment mutations
- [x] **Cloud Migration**: Done — Supabase project active, edge functions deployed and reachable
- [x] **Secrets Management**: Done — `OPENAI_API_KEY`, `DATABASE_URL`, `VAPI_SERVER_URL_SECRET` set in Supabase
- [x] **Vapi Agent**: Done — Agent configured with GPT-4o-mini LLM, Deepgram Nova-2 STT, Clara voice, pointing to production Edge Function
- [x] **Telephony Wiring**: Done — +1 (630) 397-0194 provisioned and operational for DynaTire
- [x] **n8n removed**: Done — all async work (post-call summaries, calendar sync, CRM sync) runs inline in Fastify route handlers. `n8n/` directory deleted.
- [x] **Outlook Sync**: Done — Microsoft Graph API, OAuth flow, token refresh, auto-sync on create/update/delete/cancel
- [x] **Token Refresh**: Done — 5-minute buffer proactive refresh for both Google and Outlook
- [x] **Call Summary Embeddings**: Done — generated inline after call summary creation (BUG-032)
- [x] **Live RAG Testing**: Done — Knowledge base questionnaire built (40 questions, 9 categories), POST /knowledge/add, PUT /knowledge/:id
- [x] **Live Shift Testing**: Done — Business hours validation and past-time rejection verified in production
- [x] **Scheduling Timezone Fix**: Done (2026-04-01) — BUG-059: `book_with_scheduling_atomic()` timezone regression fixed. Migration `20260401000000` applied to production.
- [x] **Voice AI Phone/Date/Employee Fixes**: Done (2026-04-01) — BUG-060/061/062: Phone validation, dynamic date prompt, service-to-skill mapping in Vapi assistant.
- [x] **Booking Error Handling**: Done (2026-04-01) — BUG-063/064: Specific error codes (TIMESLOT_OCCUPIED, NO_SKILLED_EMPLOYEE, EMPLOYEE_NOT_SCHEDULED) via migration `20260401000001`.
- [x] **OAuth Callback Refactoring**: Done (2026-04-01) — Generic `oauthCallbackFactory.ts` + shared `tokenManagement.ts` eliminate duplication across 4 CRM integrations.
- [x] **UI/UX Audit**: Done (2026-04-09) — 35 issues identified and resolved across Critical (7), High (13), Medium (15). ConfirmModal + useConfirm hook, Toast improvements, wizard step guards, keyboard accessibility, mobile responsiveness.
- [x] **Playwright E2E Testing**: Done (2026-04-09) — 19 Playwright tests covering 12-step functional audit across every major view.
- [x] **Front Desk Shift Bars**: Done (2026-04-09) — BUG-072 resolved, shift bars rendering correctly in NewSchedulerView.
- [x] **Scheduler View Tabs**: Done (2026-04-09) — Staff view now includes scheduler sub-tabs.
- [x] **5W Diagnostic Compliance**: Done (2026-04-09) — All 465 dashboard tests include 5W diagnostic context.
- [x] **UX/a11y Backlog**: Done (2026-04-20, commit `f9ffa8e`) — all 47 items from April 10-11 review resolved.
- [ ] **Deploy Dashboard**: Vercel or Railway. Set `DASHBOARD_URL` in Railway env vars.
- [ ] **Voice AI Migration (Vapi → LiveKit)**: Phase 2+ of the plan in `.claude/plans/federated-snacking-puffin.md`. Phase 1 complete. See `docs/FRAMEWORK_MIGRATIONS.md`.
- [ ] **Stripe Test Products**: Recreate 4 products (Solo/Growth/Professional/Enterprise) in Stripe test mode. Update Price IDs in `.env.production`. Live mode products already created.
- [ ] **Rotate Exposed Keys**: Supabase DB password, OpenAI API key, Supabase access token were exposed in chat. Regenerate all and update `.env.production`.
- [ ] **Beta Testing**: Real-world call tests with DynaTire

---

## Backlog

> Features that are valuable but not required for market launch. Prioritize after Phase 13 is shipped and DynaTire is live.

### UI/UX

#### Drag-and-Drop Reordering (Services, Employees, Resources)
- [ ] Service list reordering: Manager drags services into preferred order (e.g., workflow order). Requires `sort_order` column on `services` table. Applies to: Service Catalog, Skill Matrix, Staffing Map, Skill Relationship Map.
- [ ] Employee list reordering: Same pattern for employee display order across all views.
- [ ] Resource list reordering: Same pattern for resources.
- [ ] Skill Map column reordering: Drag-and-drop within Skill Relationship Map columns.
- [ ] Requires drag library (dnd-kit or react-beautiful-dnd). `sort_order` INTEGER column on employees, services, and resources tables.

#### Landing Page
- [ ] Design reference: LandingPage.html from March 18 session. Dark industrial aesthetic, Bebas Neue / DM Sans fonts.
- [ ] Hero with live phone mockup, $126K missed call stat, competitor comparison, pricing cards, 8 categories.
- [ ] Separate project from the app. Build before public launch.

#### Sign-Up Page (6-step progressive reveal)
- [ ] Design reference: SignUpPage.html from March 18 session.
- [ ] Flow: Category > Type > Specialty > Size > Services > Account.
- [ ] Routes to: SoloWizard (team_size=1) or SetupWizard (team_size>1).
- [ ] Build after solo wizard and pricing are implemented.

### Infrastructure

#### Automated Phone Provisioning
Manual phone provisioning (10 min per customer in Telnyx/Vapi dashboards) works for the first 10-20 customers. Automate when manual onboarding becomes the bottleneck.

- [ ] `src/services/telnyx.ts` — search numbers by area code, purchase, configure SIP trunk via Telnyx REST API.
- [ ] Vapi agent auto-creation from `vapi/agent.template.json` with tenant vocabulary, system prompt, voice ID, and Edge Function URL injected.
- [ ] Area code wizard step (Step 10 of onboarding) — owner picks area code, selects from available numbers.
- [ ] `POST /tenants/provision-phone` — orchestrates Telnyx purchase + SIP trunk + Vapi agent atomically. Rolls back if any step fails.
- [ ] Tenant schema: `phone_number`, `vapi_agent_id`, `telnyx_trunk_id`.
- [ ] Confirmation screen with "Call it right now" CTA.
- [ ] Suggest nearby area codes if requested code has no availability.
- [ ] Env vars: `TELNYX_API_KEY`, `VAPI_API_KEY`.

#### Platform Adapter Architecture (Analysis Required)

> Status: Under consideration. Large architectural change requiring serious analysis. The goal is to make the platform agnostic — able to swap databases, sync with external CRMs, integrate with multiple calendar providers, and support add-on plugins without touching core business logic.

**Current Coupling Map:**

| Layer | Currently Coupled To |
|-------|---------------------|
| Data Access | PostgreSQL (raw SQL in 15 route files, pgvector, RLS, PL/pgSQL functions, 50+ migrations) |
| Voice AI | Vapi (webhook format, tool definitions) |
| Telephony | Telnyx (SIP trunk config, planned provisioning API) |
| Embeddings | OpenAI (`text-embedding-3-small`) |
| LLM | OpenAI (GPT-4o-mini for voice + normalization) |
| Calendar Sync | Google Calendar + Outlook (inline in Fastify, no n8n) |
| Payments | Stripe (direct API in `src/routes/billing.ts`) |
| Auth | bcrypt + JWT (hardcoded, no OAuth/SSO) |

**Proposed Architecture:** Plugin/Integration Registry with TypeScript contracts (`IDataStore`, `ICalendarSync`, `ICrmSync`, `IEmbeddingProvider`) and swappable adapter implementations per provider.

**Proposed Interface Contracts:**

```typescript
interface Integration {
  id: string;
  name: string;
  type: 'calendar' | 'crm' | 'sms' | 'embedding' | 'payment' | 'database';
  configure(tenantId: string, config: Record<string, string>): Promise<void>;
  isConfigured(tenantId: string): Promise<boolean>;
}

interface ICalendarSync extends Integration {
  syncAppointment(tenantId: string, appointment: Appointment): Promise<string>;
  deleteEvent(tenantId: string, externalId: string): Promise<void>;
  getFreeBusy(tenantId: string, start: Date, end: Date): Promise<BusySlot[]>;
}

interface ICrmSync extends Integration {
  syncCustomer(tenantId: string, customer: Customer): Promise<string>;
  importContacts(tenantId: string): Promise<Customer[]>;
  syncCallSummary(tenantId: string, summary: CallSummary): Promise<void>;
}

interface IDataStore {
  getTenant(id: string): Promise<Tenant | null>;
  createTenant(data: CreateTenantInput): Promise<Tenant>;
  listCustomers(tenantId: string, opts: PaginationOpts): Promise<Customer[]>;
  bookAppointment(tenantId: string, data: BookAppointmentInput): Promise<BookingResult>;
  // ... etc for all entity types
}

interface IEmbeddingProvider {
  embed(text: string): Promise<number[]>;
  dimensions: number;
}
```

**Database Abstraction Challenges:**

| Feature | Postgres-specific | Abstraction Difficulty |
|---------|------------------|-----------------------|
| pgvector | `vector(1536)`, `<=>` cosine distance | Very High (needs vector DB adapter) |
| Row Level Security | `CREATE POLICY` | Medium (application-level WHERE) |
| `jsonb` columns | `jsonb_set()`, `->` operator | Medium |
| PL/pgSQL functions | `book_appointment_atomic()`, `check_coverage_gaps()` | High (rewrite as service functions) |
| `ON CONFLICT` / `RETURNING *` | Postgres upsert syntax | Medium |

**Recommendation:** Extract all SQL into a Data Access Layer (repository pattern), keep Postgres as primary adapter, build a second adapter only when a specific customer/scale requirement demands it. For RAG, use a dedicated vector DB alongside relational DB rather than making pgvector portable.

**Database Schema (when ready):**

```sql
CREATE TABLE tenant_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  integration_type TEXT NOT NULL,
  provider TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, integration_type, provider)
);
```

**Priority Order:**

| Priority | Adapter | Effort |
|----------|---------|--------|
| 1 | ~~Calendar Sync (Google + Outlook)~~ | Done |
| 2 | ~~CRM Sync (Jobber, HubSpot, Square, ServiceTitan)~~ | Done |
| 3 | Embedding Provider (OpenAI > Cohere/local) | 1-2 days |
| 4 | SMS/Notifications (Telnyx > Twilio) | 1 week |
| 5 | Payment Provider (Stripe > Square) | 1-2 weeks |
| 6 | Data Access Layer (PostgreSQL abstraction) | 4-8 weeks |
| 7 | ~~Voice AI Provider (Vapi > alternatives)~~ **ACTIVE** — migrating to LiveKit Agents, see `docs/FRAMEWORK_MIGRATIONS.md` | 8-12 days |

**What NOT to abstract:** Auth (add OAuth/SSO as feature, not adapter), frontend framework (Next.js/React), Edge Functions runtime (Deno/Supabase).

**Next step:** Calendar Sync (Google + Outlook) and CRM Sync (Jobber, HubSpot, Square, ServiceTitan) adapters are all done. Shared OAuth/token infrastructure in `oauthCallbackFactory.ts` and `tokenManagement.ts`. Next adapter to build would be Embedding Provider or SMS/Notifications.

### Integrations

#### Multi-Business Phone Routing
- [ ] **One number, multiple businesses**: Caller dials one number, AI routes to the right context based on intent.
- [ ] **Option A (simple)**: Two separate tenants, two numbers, two Vapi agents. Works today.
- [ ] **Option B (elegant)**: Single tenant with "divisions" — each has its own service catalog, knowledge base, and AI persona. Requires new routing layer and multi-division data model.
- [ ] Decision not yet made. Revisit when deployment is live and real routing needs emerge.

#### Combo/Package Bookings
- [ ] Two chained sequential queries for multi-skill bookings, both must pass before acceptance.
- [ ] Wrapped in a single PostgreSQL transaction with `SELECT FOR UPDATE` row-level locking.
- [ ] Clarify whether `book_appointment_atomic` already handles this or needs extension.

### Business Features

#### Full Billing System (Stripe)
Extends Stripe Lite (Phase 12) with trial management, plan switching, call limits, and self-service billing portal. Build when customer volume justifies complexity.

**Platform Cost Model:** ~$12-36/mo per tenant (Telnyx ~$5-15, Vapi ~$5-15, OpenAI ~$2-5, Supabase ~$0.50-1). Call limits protect margin.

- [ ] Plan picker UI in onboarding wizard (replace direct Checkout redirect).
- [ ] Stripe Elements card form embedded in dashboard (instead of Checkout redirect).
- [ ] 14-day free trial: `trial_ends_at` on tenants, reminder SMS/email 3 days before expiry.
- [ ] Call limit enforcement: track monthly call count per tenant, graceful AI response at limit, upgrade prompt.
- [ ] Billing portal: Stripe Customer Portal for self-service plan changes and invoice history.
- [ ] Plan upgrade/downgrade flow in dashboard settings.
- [ ] `STRIPE_PUBLISHABLE_KEY` for client-side Stripe Elements.

#### Business Intelligence & Employee ROI
Retention feature. Build when booking data is sufficient for meaningful recommendations.

- [ ] Employee efficiency: utilisation %, revenue/hr, skills used vs idle, thresholds (>85% near capacity, 50-85% healthy, <50% underutilised).
- [ ] Service ROI: bookings/mo, revenue/hr, single-point-of-failure detection, ROI signals (Strong/Review/Poor/Remove).
- [ ] Recommendations engine: ranked action items with revenue impact estimates — broken chains, cross-training, pricing, capacity warnings.
- [ ] Materialized views: `employee_roi_metrics`, `service_roi_metrics` (refreshed nightly).
- [ ] API endpoints: `GET /analytics/employees`, `/services`, `/recommendations`.
- [ ] BI tab in AI & Insights section (3 sub-tabs), period selector (7d/30d/90d/12mo).

#### Personal Resources & Unified Booking Model
Only needed when onboarding businesses with mobile techs or service writers at non-fixed stations.

- [ ] `is_personal` boolean on `resources` table.
- [ ] Hide personal resources from bay/chair resource manager UI.
- [ ] Employee setup: "Does this person work at a fixed station?" > No > auto-create personal resource.
- [ ] Skill map: personal resources show clean green chain (not warning), "personal" label.
- [ ] Coverage logic: personal resource availability = employee availability.
- [ ] Dashboard alert: "Sarah W. has no resource assigned — [Create Sarah's Desk]".

#### Advanced Coverage Alerts
Visual coverage in Phase 12 covers the dashboard. These are automated notification and AI behaviour extensions.

- [ ] Owner SMS alerts for critical gaps (Telnyx SMS, deduplicated within 24 hours).
- [ ] AI behaviour change: offer alternative times when booking into a gap.
- [ ] Missed revenue tracking: "This week you missed $240 due to coverage gaps."
- [ ] Nightly coverage check job for next 7 days.
- [ ] Dashboard notification banner for critical gaps with action buttons (Reassign / Call customers / Dismiss).

#### 8 Industry Categories (Financial Services, IT Services)
- [ ] Expand from 6 to 8 categories. Don't show empty categories until templates exist.
- [ ] Define default services, vocabulary labels, and templates for Financial Services and IT Services.

#### Enterprise Tier ($1,200+/mo)
- [ ] Multi-location, white label, dedicated support. Not yet technically defined.
- [ ] Requires: parent/child tenant relationships, cross-tenant reporting, shared billing, multi-location dashboard, custom domain support, branding overrides.
- [ ] Build when enterprise prospect appears. Don't build speculatively.

### Architecture

#### Query Routing Normalization
- [ ] GPT-4o-mini call before every caller question (~150ms, temp 0.1). Returns `{ normalized, route: "database" | "rag" | "booking" }`. Main LLM never makes routing decisions. Falls back to "rag" on failure.
- [ ] Distinct from embedding normalization (`shared/normalizeForEmbedding.ts`): this routes incoming caller questions in real time, while embedding normalization preprocesses stored text for pgvector.
- [ ] Build after beta testing reveals routing accuracy issues.

#### Travel Buffer
- [ ] `buffer_minutes` field for mobile businesses (time between appointments for driving).
- [ ] Open question: goes on employee or tenant table? Different employees might need different buffers.
- [ ] Solo wizard: None / 15 / 30 / 45 / 60 min picker. DynaTire default: 30 min.
- [ ] Update `book_appointment_atomic` and `check_availability` to enforce buffer.

#### Zero-Duration Services (Fee-Only)
- [ ] Duration of 0 is a valid service entry (e.g., Tire Disposal, Environmental Fee). No time slot allocated.
- [ ] Open question: how does the booking engine handle this? Options: (a) cannot be booked standalone — add-on only, (b) 1-minute minimum, (c) line item on invoice only.
- [ ] Update `book_appointment_atomic` and `check_coverage_gaps()` once decision is made.

#### Solo Wizard Branching
- [ ] `team_size = 1` > SoloWizard (3 steps: services + availability + review). `team_size > 1` > SetupWizard (7 steps).
- [ ] Auto-created on solo completion: 1 employee (the owner), 1 personal resource, all services assigned.
- [ ] Design reference: SoloWizard.html mockup from March 18 session.

---

## HIPAA Exclusion Policy

Medical verticals (medical clinics, dental offices, chiropractic, optometry, veterinary) are permanently excluded from the platform. These business types do not appear anywhere in the UI — no tiles, no placeholders, no mention. HIPAA compliance requires a BAA, specialized data handling, audit trails, and breach notification procedures. The liability exposure far outweighs the revenue opportunity. If this changes in the future, it will require a formal legal program before any code changes.
