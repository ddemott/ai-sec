# AI Secretary SaaS – Project Plan

## Phase 1: Foundation & TDD Setup (Complete ✅)
- [x] **SQL Schema with Tests**: `tenants`, `resources`, `customers`, `appointments`.
- [x] **Atomic Booking**: Postgres RPC handles race conditions.
- [x] **TDD Integration**: Automated local DB setup via `scripts/setup-db.sh`.

## Phase 2: AI Tool Provider & Context (Complete ✅)
- [x] **AI Tools (Edge)**: `get_customer_context`, `check_availability`, `book_appointment`.
- [x] **Architecture Refactor**: Modular (Hexagonal) architecture.
- [x] **Hardening**: Zod validation and detailed error logging.

## Phase 3: Voice AI & Integration (Complete ✅)
- [x] **Vapi Agent Blueprint**: `vapi/agent.json` and `vapi/tools.json`.
- [x] **Connectivity Guide**: `vapi/TELNYX_SETUP.md`.
- [x] **Latency Optimization**: Implemented Warm-up Pings.

## Phase 4: Async Logic & Background Workers (Complete ✅)
- [x] **n8n Workflow Blueprint**: `docs/N8N_WORKFLOWS.md`.
- [x] **Summarization**: Post-call summarizer via OpenAI and Supabase.
- [x] **Audit Schema**: `call_transcripts` and Postgres-to-n8n triggers.

## Phase 5: Dashboard & Management UI (Complete ✅)
- [x] **Appointment Management**: Outlook-Style UI with full calendar features.
- [x] **CRM & Notes**: Searchable customer profiles with AI history.
- [x] **AI Persona Tuning**: Live updates for System Prompt and Voice ID.

## Phase 6: Knowledge Base & RAG (Complete ✅)
- [x] **Semantic Schema**: `tenant_docs` table with `pgvector` support.
- [x] **Ingestion Engine**: Deno script and Dashboard UI for PDF uploads.
- [x] **Policy Q&A**: `get_company_policy_answer` tool for grounding AI in business docs.

## Phase 7: Advanced Scheduling & ROI (Complete ✅)
- [x] **Skill Matrix**: Grid for matching staff expertise to resource capabilities.
- [x] **Shift Management**: Full UI and DB enforcement for employee working hours.
- [x] **ROI Analytics**: Dashboard showing call conversion and estimated revenue.
- [x] **Calendar Sync**: Schema and n8n blueprint for Google/Outlook integration.

## Phase 7.5: Security & Quality Hardening (Complete ✅)
Full code review identified 58 bugs across all severity levels. All resolved.

- [x] **Auth**: JWT tokens with expiry, auto-logout on 401, dev bypass removed.
- [x] **RLS**: Standardized policies, all route modules enforce via `withTenantClient()`.
- [x] **Validation**: Zod schemas at API boundaries, JSONB CHECK constraints, UUID validation.
- [x] **Booking Engine**: DST-safe shift checks, auto end-time, customer upsert, service enforcement.
- [x] **Dashboard**: Error boundaries, SessionContext, structured logging, debounce guards.
- [x] **Test Coverage**: 100 backend + 38 dashboard = 138 total, all passing.

## Phase 8: Production Go-Live (Current 🚀)
- [x] **Agent Template**: Templatize `agent.json` with Mustache variables.
- [x] **n8n Plumbing**: `notify_n8n_on_appointment` uses `pg_net` for real HTTP calls.
- [x] **Route Extraction**: 15 focused route modules under `src/routes/`.
- [ ] **Cloud Migration**: Move from local Docker to managed Supabase.
- [ ] **Secrets Management**: Set `OPENAI_API_KEY`, `DATABASE_URL`, `VAPI_SERVER_URL_SECRET`.
- [ ] **Vapi Agent**: Point official Vapi Agent to production Edge Function URL.
- [ ] **Telephony Wiring**: Assign live phone numbers to Vapi Agents via Telnyx.
- [ ] **Database Webhooks**: Enable Supabase webhooks to trigger n8n.
- [ ] **Outlook Sync**: Implement empty Outlook calendar sync branch.
- [ ] **Token Refresh**: Add OAuth token refresh logic to Google/Outlook sync.
- [ ] **Beta Testing**: Real-world call tests with DynaTire.

## Phase 9: Scale & Polish (Complete ✅)
- [x] **ID Standardization**: Migrated to UUID throughout.
- [x] **Code Consolidation**: `shared/scheduling.ts` and `shared/getEmbedding.ts`.
- [x] **Dead Code Cleanup**: Removed BookingService, Provider pattern, MockLlmProvider.
- [x] **Audit Logging**: `audit_log` table with before/after snapshots.
- [x] **Soft Deletes**: `is_deleted`/`deleted_at` with partial indexes.
- [x] **Accessibility**: ARIA labels across dashboard.
- [x] **Customer Timezone**: `check_availability_with_tz()` respects customer timezone.

## Phase 10: CRM & Dashboard Enhancements (Complete ✅)
- [x] **Unified CRM Detail View**: Appointments, call summaries, transcripts, notes, search.
- [x] **Customer Appointments API**: `GET /customers/:id/appointments` with JOINs.
- [x] **Appointment Cancel API**: `POST /appointments/:id/cancel` soft-cancels.
- [x] **Employee Attributes**: first_name, last_name, email, phone on employees table.

## Phase 11: Navigation & Vocabulary System (Complete ✅)
- [x] **Navigation Restructure**: 12 flat tabs → 5 grouped sections with sub-tabs.
- [x] **Composite Views**: MyTeamView, MyBusinessView, AIInsightsView wrappers.
- [x] **Business Templates**: 20 types across 6 categories with vocabulary + example services.
- [x] **Vocabulary System**: 3-tier fallback (tenant override → template default → hardcoded).
- [x] **GET /vocabulary**: Resolves labels via COALESCE chain.
- [x] **Self-Service Registration**: POST /register creates tenant + user + JWT.
- [x] **Onboarding Flag**: `onboarding_completed` boolean on tenants table.
- [x] **Mobile Navigation**: Bottom nav updated to 5 sections.

## Phase 12: Scheduler, Assignments & Coverage Visibility (Next 🚀)

> **Ship-blocking.** The owner needs to see who's doing what, assign people to services, and know where the gaps are — without learning the dashboard tab by tab. A repeatable wizard is the entry point; the scheduler and skill map are where they live day-to-day.

### 12A: Repeatable Setup Wizard

Not just onboarding — this is the **primary configuration tool** for non-technical owners. Re-enter anytime from the dashboard via a "Setup Assistant" button. Each step validates and shows live coverage status so the owner sees the impact of their changes in real time.

| Step | What it does | Coverage feedback |
|---|---|---|
| 1. Services | Add/edit service catalog (name, duration, price) | — |
| 2. Resources | Add bays/chairs/stations (vocabulary-aware) | — |
| 3. Employees | Add staff members | — |
| 4. Shifts | Set working hours per employee (day toggles + time pickers) | Shows hours covered per day |
| 5. Assignments | Assign employees to services, services to resources | Shows coverage status per service as assignments are made |
| 6. Review | Coverage summary: what's fully covered, what has gaps, what's broken | Full/Partial/Uncovered badges, broken chain warnings, "You're ready" or "Fix these first" |

- [ ] **Wizard Shell Component**: Progress indicator, step navigation, back/forward, "Setup Assistant" re-entry button on dashboard sidebar.
- [ ] **Step 1 — Services**: Service CRUD within wizard context. Pre-populated from template on first run.
- [ ] **Step 2 — Resources**: Resource CRUD within wizard context. Vocabulary-aware labels.
- [ ] **Step 3 — Employees**: Employee CRUD within wizard context.
- [ ] **Step 4 — Shifts**: Shift editor per employee. Day toggles + time pickers. Shows total hours covered.
- [ ] **Step 5 — Assignments**: Assign employees → services and services → resources. Live coverage badges update as assignments are made. Broken chain warnings inline.
- [ ] **Step 6 — Review**: Coverage summary dashboard. Lists every service with Full/Partial/Uncovered/Inactive badge. Broken chains listed with "Fix now" links back to Step 5. "You're ready to go live" or "Fix these issues first" message.
- [ ] **Re-Entry Logic**: Wizard detects existing data and pre-fills. Owner can jump to any step. Changes save immediately (not batched to the end).
- [ ] **First-Run vs Return**: First run shows welcome copy and template defaults. Return visits show current state with "what changed" hints.

### 12B: Scheduler Views

Three views answering three questions: "Who's doing what?" (swimlanes), "Are my bays full?" (resource columns), "What's next?" (list). Coverage gaps visible in all three.

- [ ] **Staff Swimlane View (Default)**: Employee rows × hourly columns. Appointment blocks coloured by employee. Hatching for off-shift periods. Click empty slot → Quick Book. Click employee pill → Day Focus panel.
- [ ] **Resource Columns View**: Bay/station columns. Appointment blocks within each resource. Coverage bar at top of each column — red zones for gaps. Best for capacity planning.
- [ ] **Appointment List View**: Chronological list of all appointments. Coverage gap warnings appear inline between appointments. Fastest for front desk scanning.
- [ ] **View Switcher**: Tab bar above schedule to toggle between the three views.
- [ ] **Date Navigation**: Previous/next day, week picker, "Today" button.
- [ ] **Employee Day Focus Panel**: Click any employee pill → slides in from right. Full day timeline (hourly rows), booked slots (coloured blocks, clickable), available slots (dashed green, click to quick-book), off-shift (hatching), utilisation bar + stats header, skills at bottom.
- [ ] **Quick Book Panel**: Single-screen walk-in booking. Customer search (CRM lookup + "+ New"), service selector (filtered to employee's skills), resource selector (filtered to available + compatible), time slot (pre-selected, adjustable), notes, confirm button. Target: under 30 seconds.

### 12C: Skill Relationship Map

Interactive 3-column mind map that answers: "Who can do what, where?" Broken chains and coverage gaps are immediately visible.

- [ ] **3-Column Layout**: Employees | Skills/Services | Resources. Click employee → their skills light up, others grey out. Click skill → compatible resources light up.
- [ ] **Connection Lines**: Animated SVG lines between columns showing active relationships.
- [ ] **Broken Chain Detection**: Amber dashed lines when employee has skill + resource exists but no matching service in catalog. "Fix now" action opens Add Service dialog pre-filled.
- [ ] **Coverage Badges on Skills**: Full (green), Partial (amber), Uncovered (red), Inactive (grey) — shows at a glance which services need attention.
- [ ] **Reset Button**: Clear all selections, return to default state.

### 12D: Coverage Visibility (Baked In)

Not a separate feature — coverage status is visible wherever the owner is already looking. No separate alerts page, no SMS notifications, no revenue estimates. Just visual indicators.

| Where | What shows |
|---|---|
| Scheduler (all views) | Coverage bar with red zones for gaps. Click gap → which services are uncovered. |
| Services list | Coverage status badge per service (Full/Partial/Uncovered/Inactive). |
| Skill Relationship Map | Coverage badges on skill nodes. Broken chains in amber. |
| Setup Wizard Step 5 | Live coverage badges update as assignments are made. |
| Setup Wizard Step 6 | Full coverage summary with fix links. |

- [ ] **`check_coverage_gaps()` Postgres Function**: `check_coverage_gaps(tenant_id, date_range)` returns `covered_hours[]`, `gap_hours[]`, `uncovered_services[]`.
- [ ] **Coverage Triggers**: Fire on shift INSERT/UPDATE/DELETE, skill_matrix INSERT/DELETE, and at booking time (pre-flight check).
- [ ] **Coverage Bar Component**: Reusable colour-coded bar. Red zones = gaps. Used in scheduler resource columns view.
- [ ] **Coverage Status Badge Component**: Reusable badge (Full/Partial/Uncovered/Inactive). Used in services list, skill map, and wizard.
- [ ] **`GET /coverage` Endpoint**: Returns coverage status for all services for a given date range. Powers the dashboard coverage indicators.

### 12E: RAG Normalization Layer

> **Search quality.** Raw conversational text produces inconsistent embeddings. "I think Suzy is great and would prefer to work with her" and "I like Suzy — let's go with her" should match. A normalization step before embedding reduces the text to its semantic core so that vector search reliably finds related content across different phrasings.

Before any text is embedded into pgvector, it passes through an LLM normalization step that extracts the core factual statement. This applies to customer notes, call summary details, and any free-text stored for RAG retrieval.

**How it works:**
```
Raw input:  "I think Suzy is great and would prefer to work with her"
    ↓ LLM normalization (system prompt: extract core fact, strip filler)
Normalized: "Sally prefers Suzy"
    ↓ embed normalized text
Vector:     [0.12, -0.34, ...]  → stored in pgvector

4 weeks later:
Raw input:  "I like Suzy. Let's go with her"
    ↓ LLM normalization
Normalized: "Sally likes Suzy"
    ↓ embed → cosine similarity search
Match:      "Sally prefers Suzy" (high similarity)
```

The raw text is always preserved alongside the normalized version. Search queries are also normalized before embedding so the query vector matches the stored vectors.

**Normalization rules** (system prompt for the LLM):
- Extract the core factual statement — strip filler, hedging, and conversational noise
- Include the subject (who) and object (who/what) explicitly — don't use pronouns
- Use present tense, active voice
- Keep it to one sentence
- Preserve names, dates, and specific details
- For preferences: "[Person] prefers [thing]"
- For complaints: "[Person] reports [issue]"
- For requests: "[Person] requests [action]"

- [ ] **Normalization Function**: `shared/normalizeForEmbedding.ts` — takes raw text + context (customer name, etc.), returns normalized statement via LLM call.
- [ ] **Integration with Ingestion**: Knowledge base ingestion pipeline calls normalize before embedding each chunk.
- [ ] **Integration with Call Summaries**: Post-call summarizer normalizes key details before embedding.
- [ ] **Integration with Customer Notes**: Notes saved via dashboard are normalized before embedding.
- [ ] **Query Normalization**: Search queries passed through the same normalization before embedding for lookup.
- [ ] **Raw Text Preservation**: Both `raw_text` and `normalized_text` stored. Raw for display, normalized for search.
- [ ] **Schema Update**: Add `normalized_text` column to `tenant_docs` and `call_summaries` tables.

### 12F: Stripe Lite (Two Plans)

> **You can't collect money without this.** Minimal Stripe integration — two prices created in the Stripe dashboard, one webhook to track payment status, one gate to enforce it. No plan picker UI, no trial logic, no call limits, no billing portal.

**Launch pricing:**
| Plan | Price | Target |
|---|---|---|
| Solo | $29/mo | Solo operators, small shops (1–2 staff) |
| Growth | $59/mo | Small teams (3–5 staff) |

Both plans include all features. No feature gating between tiers at launch. Professional tier ($99/mo, unlimited) deferred to backlog.

**How it works:**
1. Owner signs up → you create a Stripe Checkout session for the right price
2. Stripe redirects back on success → webhook fires → `subscription_status` set to `active`
3. If payment fails or subscription cancels → webhook fires → status updated → AI stops answering, dashboard shows "Update payment" prompt
4. That's it. No card form in the dashboard. No plan switching UI. No trial. Stripe handles everything.

- [ ] **Stripe Products**: Create Solo ($29/mo) and Growth ($59/mo) as recurring products in Stripe dashboard. Save Price IDs.
- [ ] **Tenant Schema Migration**: Add `stripe_customer_id`, `stripe_subscription_id`, `subscription_status` (active/past_due/canceled/unpaid), `plan_id` (solo/growth) to tenants table.
- [ ] **Checkout Route**: `POST /billing/checkout` — creates Stripe Checkout session for the tenant's plan, returns redirect URL. Accepts `plan_id` parameter.
- [ ] **Webhook Route**: `POST /billing/webhook` — handles `checkout.session.completed` (set active), `invoice.payment_failed` (set past_due), `customer.subscription.deleted` (set canceled). Verifies webhook signature.
- [ ] **Subscription Gate Middleware**: Check `subscription_status` on authenticated requests. If not `active`, return 402 and dashboard shows "Update your payment to continue" prompt. AI stops answering calls for that tenant.
- [ ] **Onboarding Integration**: After registration, redirect to Stripe Checkout. On success redirect, mark tenant as active and continue to setup wizard.
- [ ] **Environment Variables**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SOLO_PRICE_ID`, `STRIPE_GROWTH_PRICE_ID`.

---

## Backlog

> Features that are valuable but not required for market launch. Prioritize after Phase 12 is shipped and DynaTire is live. Ideas are preserved here so nothing is lost.

### Automated Phone Provisioning
Manual phone provisioning (10 min per customer in Telnyx/Vapi dashboards) works for the first 10–20 customers. Automate when manual onboarding becomes the bottleneck.

- [ ] `src/services/telnyx.ts` — search numbers by area code, purchase, configure SIP trunk via Telnyx REST API.
- [ ] Vapi agent auto-creation from `vapi/agent.template.json` with tenant vocabulary, system prompt, voice ID, and Edge Function URL injected.
- [ ] Area code wizard step (Step 10 of onboarding) — owner picks area code, selects from available numbers.
- [ ] `POST /tenants/provision-phone` — orchestrates Telnyx purchase + SIP trunk + Vapi agent atomically. Rolls back if any step fails.
- [ ] Tenant schema: `phone_number`, `vapi_agent_id`, `telnyx_trunk_id`.
- [ ] Confirmation screen with "Call it right now" CTA.
- [ ] Suggest nearby area codes if requested code has no availability.
- [ ] Env vars: `TELNYX_API_KEY`, `VAPI_API_KEY`.

### Full Billing System (Stripe)
Extends Stripe Lite (12F) with trial management, a third pricing tier, plan switching, call limits, and self-service billing portal. Build when customer volume justifies the complexity.

**Additional tier:**
| Plan | Price | Calls/mo | Staff | Resources |
|---|---|---|---|---|
| Professional | $99/mo | Unlimited | Unlimited | Unlimited |

**Platform Cost Model:** ~$12–36/mo per tenant (Telnyx ~$5–15, Vapi ~$5–15, OpenAI ~$2–5, Supabase ~$0.50–1). Call limits protect margin.

- [ ] Professional tier ($99/mo) product in Stripe + `STRIPE_PRO_PRICE_ID`.
- [ ] Plan picker UI in onboarding wizard (replace direct Checkout redirect).
- [ ] Stripe Elements card form embedded in dashboard (instead of Checkout redirect).
- [ ] 14-day free trial: `trial_ends_at` on tenants, reminder SMS/email 3 days before expiry.
- [ ] Call limit enforcement: track monthly call count per tenant, graceful AI response at limit, upgrade prompt.
- [ ] Billing portal: Stripe Customer Portal for self-service plan changes and invoice history.
- [ ] Plan upgrade/downgrade flow in dashboard settings.
- [ ] `STRIPE_PUBLISHABLE_KEY` for client-side Stripe Elements.

### Business Intelligence & Employee ROI
Retention feature — not needed for launch. Build when you have enough booking data to make recommendations meaningful.

- [ ] Employee efficiency: utilisation %, revenue/hr, skills used vs idle.
- [ ] Service ROI: bookings/mo, revenue/hr, single-point-of-failure detection.
- [ ] Recommendations engine: ranked action items with revenue impact estimates.
- [ ] Materialized views: `employee_roi_metrics`, `service_roi_metrics` (refreshed nightly).
- [ ] `GET /analytics/employees`, `GET /analytics/services`, `GET /analytics/recommendations`.
- [ ] BI tab in AI & Insights section (3 sub-tabs).
- [ ] Period selector: 7 days, 30 days, 90 days, 12 months.

### Personal Resources & Unified Booking Model
Only needed when onboarding businesses with mobile techs or service writers who don't work at fixed stations. DynaTire may not need this day one.

- [ ] `is_personal` boolean on `resources` table.
- [ ] Hide personal resources from bay/chair resource manager UI.
- [ ] Employee setup: "Does this person work at a fixed station?" → No → auto-create personal resource.
- [ ] Skill map: personal resources show clean green chain (not warning).
- [ ] Coverage logic: personal resource availability = employee availability.
- [ ] Dashboard alert: "Sarah W. has no resource assigned — [Create Sarah's Desk]".

### Advanced Coverage Alerts
The visual coverage indicators in Phase 12D cover the dashboard experience. These are the automated notification and AI behaviour extensions — build when owners ask for them.

- [ ] Owner SMS alerts for critical gaps (Telnyx SMS, deduplicated within 24 hours).
- [ ] AI behaviour change: offer alternative times when booking into a gap.
- [ ] Missed revenue tracking: "This week you missed $240 due to coverage gaps."
- [ ] Nightly coverage check job for next 7 days.
- [ ] Dashboard notification banner for critical gaps with action buttons (Reassign / Call customers / Dismiss).

## HIPAA Exclusion Policy

The following verticals are explicitly excluded from onboarding until a formal HIPAA compliance program is in place with legal counsel:

- Medical Clinics
- Dental Offices
- Chiropractic practices
- Optometry
- Veterinary (gray area — pending legal review)

**Reason**: HIPAA requires a Business Associate Agreement (BAA), specific data handling and encryption standards, audit trail requirements, breach notification procedures, and significant legal liability. The fine exposure far outweighs the revenue opportunity at this stage.

**In the UI**: These business types appear greyed out in the sign-up flow with "Coming soon — compliance in progress." They are removed from active onboarding entirely. No medical business should be able to complete registration.
