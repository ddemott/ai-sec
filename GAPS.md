# SecretaryHQ — Gaps & Missing Pieces

**Deep dive analysis** — 2026-06-23 (main branch; post doc hygiene pass)

This document captures a comprehensive inventory of what the project is missing, from every angle. It is derived from live code (`src/`, `agent/`, `dashboard/`, `shared/`), schema (145 migrations), tests, CI, runtime behavior (mocks, env gates), and all key docs (TODO.md, BETH_GO_LIVE_TODO.md, STRATEGY.md, COMPETITOR_WEAKPOINTS.md, DEPLOYMENT.md, SECURITY.md, TEST_COVERAGE.md, RESOLVED.md, HANDOFF.md, etc.).

**Context**: Multi-tenant Voice AI Reception SaaS for service businesses (tire shops, salons, auto, trades, fitness, food & beverage). **HIPAA verticals are permanently excluded.** Strong foundation in voice (Telnyx + LiveKit), atomic booking, RLS multi-tenancy, dashboard, and recent shipments (live call-transfer + transcripts + summaries + outcomes + analytics + simulate harness + competitor CRM removal + data export/audit/RAG debugger + doc consistency hygiene).

Many items below are already tracked in `docs/TODO.md` (especially Phase 13 production wiring, `[prod]` silent-degrade risks, and BETH checklist). This file expands into unstated angles and provides a single "get to these things" reference. Use it alongside (not instead of) the active TODOs, simulate harness, and prepare-commit workflow.

**Update rule**: Refresh this file after major shipments or when a new class of gap surfaces. Cross-link back to specific files/lines and docs when possible.

---

## Executive Summary

The project is unusually mature for a solo-dev codebase. Core engine (booking RPCs + RLS + voice agent tools + recent call outcome plumbing) is production-grade. The remaining gaps are primarily:

- **Wiring & config** (silent mocks, missing prod envs, un-gated deploys).
- **Last-mile product** (customer self-service, billing UI, comms providers live, no-show depth).
- **Live validation** (PSTN inbound is the single biggest blocker for any real customer).
- **Ops visibility** (observability tokens, cost metering, load testing).
- **Business surface** (legal docs, support tooling, plan management).

Focus next sessions on the BETH checklist + all `[prod]` silent items + Stripe verification. That unblocks paid customers and makes everything else visible.

---

## 1. Production Readiness & Go-Live Blockers (Highest Risk)

From `docs/TODO.md` + `BETH_GO_LIVE_TODO.md` + source:

- **PSTN inbound path unverified** for the live number (`+1 630-866-1960` and test `+1 630-822-9086`). Different-carrier dial + `listRooms()` monitoring still required. Carrier propagation / recycled-DID issues diagnosed; Telnyx ticket escalated. Agent + LiveKit + Telnyx SIP config proven in isolation, but real voice is the blocker for Beth (tenant `d5e3c6a1...`) and any paying customer.
- **Telnyx REFER / call transfer not enabled** on the SIP Connection. `transfer_call` tool (shipped) degrades to "take a message" when `forward_phone` is set.
- **`[prod]` silent-degrade risks — code fixes shipped 2026-06-16/17** (boot warnings now fire for all of these; prod env vars still need to be set):
  - ~~Reminders/comms SMS → MockAdapter~~ — FIXED: `ProviderRegistry` defaults to Telnyx. Set `TELNYX_PHONE_NUMBER=+16308661960` on Railway.
  - Email → mock transporter without `EMAIL_USER`/`EMAIL_PASS` — boot warning fires; set Gmail app-password on Railway.
  - ~~Agent `BACKEND_URL` defaults to localhost~~ — FIXED: config validation now fails at startup if unset. Set `BACKEND_URL` on `ai-sec-agent`.
  - ~~`STRIPE_WEBHOOK_SECRET` empty → webhooks 400~~ — boot warning fires; set on Railway.
  - ~~`CORS_ORIGIN` unset reflects ANY origin~~ — boot warning fires; set on Railway.
  - ~~`DASHBOARD_URL` defaults to localhost~~ — boot warning fires; set on Railway.
- **Observability completely dark in prod**: `METRICS_TOKEN`, `BETTER_STACK_TOKEN` (backend + agent), `SENTRY_DSN` (backend + agent) not set on Railway. `/metrics` 404s; logs are stdout-only; no error grouping or alerts.
- **Railway deploy gated on CI green via GitHub** (progress 2026-06-15): branch protection applied on `main` requiring the 4 CI jobs (Backend, Dashboard, Agent, E2E) + PR + enforce admins. Auto-deploys from `main` now blocked on red CI. **Remaining**: Enable "Wait for CI" on Railway services. (See `docs/TODO.md` Production Wiring Checklist.)
- **Stripe never verified live** (test mode + CLI webhook replay outstanding per TODO). Checkout + 3-event webhook + `/billing/status` + `subscriptionGate` exist, but automatic tax missing, price IDs not on prod, no owner-facing flow.
- **Legal / insurance / ops (user actions)**: Bonterms ToS/Privacy/DPA, TCPA-compliant SMS opt-in language at booking time, E&O + Cyber Liability insurance, LLC bank account (Stripe payouts), S-Corp election later. No in-app customer support/ticketing.
- **Env/config surface risks**: Telnyx for provisioning/OTP; calendars and remaining CRM need their OAuth triples. No single "feature readiness" boot report beyond `envWarnings.ts`.

**Status**: Phase 13 in progress. Core is wired; the gaps are config + live validation + gates.

---

## 2. Core Product / Receptionist Feature Gaps

Voice booking + context + policy RAG + preferences + transfer (recently completed) are solid. Missing receptionist table stakes:

- **No customer self-service at all**. No public booking widget/embed, customer portal or login, reschedule/cancel links in SMS/email, "manage my appointments" flow, or web callback request. Intake is voice-only + staff dashboard. (Confirmed by searches across code and docs.)
- **No waitlist, callback queue, or "call me back" tooling** beyond `transfer_call`. NULL `forward_phone` just takes a message.
- **No-show / follow-up automation is thin**. Reminders exist (60s poll scheduler, retry columns, `GET /reminders/delivery-stats`, some UI). No auto no-show marking from external calendars, predictive scoring, auto-rebook offers, or waitlist promotion. Cancellations supported via API/UI; voice "cancel" flows limited.
- **Call recordings absent from product**. `voice_sessions` now captures transcripts (`transcript.ts`), summaries (`callSummary.ts`), outcomes (`callOutcome.ts`), and `appointment_id` links (all recently wired). No audio storage, dashboard playback, redaction, or retention policy. (Upstream LiveKit/Telnyx recording possible but unwired.)
- **Limited multi-party / warm transfer**. Cold SIP REFER only.
- **Shallow "book for someone else" / family / group support**. Basic `CustomerContext` + notes exist; no advanced corporate or recurring profiles.
- **No rich media during calls** (e.g., photo of tire damage for auto shops).
- **Outcome classification is good** (`callClassify.ts`: booked / no_availability / wrong_service / price / message / info + abandoned) but not yet driving automations (e.g., price-sensitive follow-up SMS).

**Agent tools** (`agent/src/tools.ts` — 19 tools as of 2026-06-26):

- `get_customer_context`: CRM lookup + history + preferences (called early when caller ID present).
- `find_caller_by_name`: name-first CRM lookup for forwarded lines (caller ID is not the caller's own number); returns matching contacts + phone on file to confirm. Empty list = new caller.
- `get_service_catalog`: list services with duration/price.
- `get_available_slots`: open times for a service_type on a YYYY-MM-DD (tenant TZ).
- `get_scheduling_options`: (resource, employee) combos in a window + capability/skill filters.
- `check_availability`: exact resource+start/end check (noted as SLOW; prompt auto-injects filler).
- `book_appointment`: specific slot (requires verified phone; wires `call_id` and records outcome for voice_sessions link).
- `book_with_scheduling`: window + requirements → auto-pick + book (preferred for "next available").
- `get_company_policy_answer`: RAG over tenant_docs (uses query expansion + pgvector).
- `send_verification_code` + `verify_phone_code`: Telnyx SMS OTP for blocked-CID bookings.
- `identify_caller`: upsert customer by phone+name (non-booking capture).
- `save_customer_preference`: durable facts (preferred_stylist etc.) for future calls.
- `transfer_call`: SIP REFER to `tenants.forward_phone` (or message fallback); records outcome.
- `take_message`: collect caller name + message + optional callback phone, persist to `customer_messages`, SMS-notify owner. (Added 2026-06-16.)
- `get_my_appointments`: list caller's upcoming scheduled appointments by phone (server-injected — LLM never supplies it). Returns service_name + employee_name for natural voice ("your Oil Change with Mike"). (Added 2026-06-16.)
- `cancel_appointment`: cancel caller's own appointment by UUID; phone ownership gate at backend — LLM can never cancel another caller's booking. (Added 2026-06-16.)
- `reschedule_appointment`: move appointment to new start/end; same phone ownership gate; backend validates future time + non-overlap via GiST exclusion. (Backend endpoint + reminder reschedule added 2026-06-18.)
- `capture_job_inquiry`: record a work/job inquiry (company, contract vs full-time, rate, onsite/remote, etc.) after intake and email it to the owner. (Added 2026-06-25.)

Current vs. desired for a complete receptionist:

- Have: book, lookup, policy, basic transfer, preference capture, cancel, reschedule, my-appointments, take message.
- Missing (lower priority): `page_owner_via_sms`, `get_detailed_customer_history` (beyond short context), real-time "is my tech running late?" status, warm transfer.

**Customer Self-Service Action Links (P1 highest-leverage gap — repeatedly surfaces in strategy as support reducer)**

Current state (confirmed 2026-06-15):

- All notifications are one-way. SMS bodies in `src/services/communications/smsService.ts:204-210`:
  - Confirmation: `✅ Confirmed: ${service} with ${staff} on ${dateTime}. Reply STOP to opt out.`
  - Reminder: `🔔 Reminder: ... Reply STOP...`
  - Cancellation: `❌ Cancelled...`
- No URLs, no "tap to change", no "reply YES to confirm change".
- `appointmentService.ts:139-213` builds the data but passes only service/staff/datetime; no action links generated.
- Auth'd routes exist: `POST /appointments/:id/cancel` and `/reactivate` (`src/routes/appointments.ts:341-438`), but they require full tenant JWT + `withTenantClient`.
- No unauthenticated or token-gated customer paths. Emails have password-reset style links (`systemEmail.ts`) but nothing for appointments.
- `AppointmentData` interface (in communications/types) lacks any link fields.

Minimal viable design (actionable spec):

- Generate short-lived, single-use or short-expiry signed tokens (JWT with `appointment_id`, `action: 'cancel'|'reschedule'|'view'`, `tenant_id`, `exp`, signed by existing JWT_SECRET or dedicated secret).
- Or opaque DB-backed tokens in a new small `appointment_action_tokens` table (appointment_id, action, token_hash, expires_at, used_at, one-time).
- New route file or extension: e.g. unauthenticated-but-validated `POST /self-service/appointments/:appointment_id/cancel?token=...` (or better, a small dedicated router mounted without tenantMiddleware for these).
  - Validate token matches appointment + tenant.
  - Call the existing cancel logic (or share the RPC/service).
  - Return simple success page (or redirect to a "your appointment was cancelled" branded static with rebook CTA).
- Extend `AppointmentData` + email/SMS templates (both Handlebars in emailTemplates + the applySMSTemplate switch) to accept `actionLinks?: { rescheduleUrl?: string; cancelUrl?: string; manageUrl?: string }`.
- In `appointmentService.ts` (and callers in reminders + appointment creation paths), after booking, generate the links using `DASHBOARD_URL` + `/self/...` + token and pass them down.
- For SMS: use a URL shortener (or just full URL; keep total < 160 chars — possible with terse copy + one primary link e.g. "Change: https://.../a/123?tk=abc123").
- Dashboard: on AppointmentDetailPanel or list, button "Send customer self-service links" (or auto-include on all confirmations going forward). Show which links were sent.
- Edge cases: token expiry (clear error + "call us"), concurrent staff change (409 + explanation), already-cancelled (idempotent or informative), rate-limit the self-service actions.
- Persistence: on success, write to `communications_history` + perhaps bump a `customer_action_via_self_service` metric.
- DB impact: minimal (new optional column on appointments? or pure token table). Existing soft-delete/cascade already handles cleanup.
- Tests: new integration test for token redemption (no auth header), E2E for "owner books → customer gets SMS with link → link cancels", negative cases (expired, wrong tenant, double use).
- Comms consent: self-service actions should still respect opt-out (don't send links to opted-out).

Why this is big: Turns the AI from "booker only" into full lifecycle receptionist. Directly attacks competitor weakness "receptionist is rigid / half-baked". Reduces owner phone time dramatically. Easy to A/B (include links or not).

Risk of ignoring: Customers treat the AI as a one-way black box; every change becomes a support ticket or live transfer, eroding the "set it and forget it" promise.

---

**Next-level voice tools that pair well with self-service** (after links exist): agent can offer "I can text you a link to reschedule yourself" instead of always doing it live.

---

## 3. Integrations Maturity

- **CRM**: Only Square remains (strategic removal of Jobber/HubSpot/ServiceTitan — they bundle competing AI receptionists; see `docs/STRATEGY.md` and `COMPETITOR_WEAKPOINTS.md`). Full `src/services/crm/` (client + sync + status + disconnect + webhook + scaffold). Tested via `SYNC_TEST_RECORDER`. No deep bidirectional reads (pull open jobs/tickets into voice context).
- **Calendar**: Google + Outlook fully coded (`googleCalendar.ts`, `outlookCalendar.ts`, `calendarSync.ts`, OAuth factory, mutation-driven sync) but entirely env-gated (`GOOGLE_*` / `OUTLOOK_*`) and unproven in production. No per-tenant calendar view or live conflict surface beyond the internal scheduler grid.
- **Communications (SMS/Email)**: Routes + history (`communications_history` table + `GET /communications/history`) + consent + opt-out + delivery receipts + per-tenant rate limiting + retry policy all wired. ProviderRegistry defaults to Telnyx (see silent-degrade section). Email is nodemailer-only (no SendGrid/etc.). Templates are basic Handlebars.
  - **Actionability gap** (ties directly to self-service): Current SMS (smsService.ts applySMSTemplate) are 1-2 sentences with only STOP. No "tap here to reschedule", no deep links, no structured replies parsed back into the system. Reminders are scheduled in `reminderScheduler.ts` (polling) + `scheduleForAppointment.ts`; delivery stats added recently but no owner drill-down into specific failed deliveries beyond aggregate.
  - Reliability: retryPolicy + rate limiter good on paper; live behavior unknown until providers are set (mock always "succeeds"). No bounce / complaint handling beyond basic opt-out.
- **Provisioning/Phone**: Excellent — `/provisioning/activate` does search → purchase → assign to SIP connection and writes tenant fields. Telnyx + LiveKit plumbing mature. No porting, vanity numbers, or easy multi-number support.
- **No payments processing** for the business's own customers (intentional per strategy).
- **No accounting** (QuickBooks/Xero), no marketing automation, no inventory sync.
- OAuth state (JWT) and webhook HMAC/raw-body verification are strong (SECURITY.md).

---

## 4. Billing & Monetization

Backend (`src/routes/billing.ts`):

- `POST /billing/checkout` (customer create/upsert + Stripe session with metadata).
- `POST /billing/webhook` (handles `checkout.session.completed`, `invoice.payment_failed`, `customer.subscription.deleted`).
- `GET /billing/status`.
- `subscriptionGate` middleware (returns 402 for non-active tenants except super-admin + exempt paths like `/billing`, `/health`, auth).

Tiers (Solo/Growth/Pro) + price ID env vars exist.

**Missing** (current state confirmed via grep + file reads 2026-06-15):

- Zero in-app management UI inside the authenticated dashboard (no Billing tab/subview, no `BillingView.tsx` or equivalent, nothing in `My Business` / `SettingsView.tsx` / `ProfileView.tsx` beyond the landing page price cards and a `?billing=success` URL stamp in `dashboard/app/dashboard/page.tsx:98`).
- `dashboard/lib/api.ts:784-791` has a tiny namespaced stub:
  ```ts
  billing: {
    checkout: (tenantId: string, plan: 'solo' | 'growth') => ...  // note: no 'professional'
    status: () => apiFetch<...>(`/billing/status`)
  }
  ```
  Only used for post-Stripe redirect UX on the shell page; no polling, no plan cards, no upgrade CTAs in the main app.
- Backend `src/routes/billing.ts` is complete for the happy path (customer upsert, metadata-driven plan, 3 webhook events, subscriptionGate) but `automatic_tax` is never passed to `checkout.sessions.create`.
- No owner-visible current plan, usage against plan limits, invoices, or "manage billing" button (the Stripe Customer Portal URL is never generated or shown).
- Never run against real Stripe (test-mode + `stripe listen` + full round-trip) per TODO.md.

**Concrete owner billing experience that is needed**:

- A "Billing" section (or card in My Business / Settings) that shows `subscription_status` + `subscription_plan` (from the status endpoint), current period, price, next bill.
- Plan comparison or upgrade buttons that call the existing `/billing/checkout` and redirect to the returned `url` (Stripe Checkout).
- "Manage payment method / invoices" button that creates and redirects to a Stripe Billing Portal session (one extra Stripe API call: `stripe.billingPortal.sessions.create({ customer, return_url })` — very little code).
- On success/cancel redirects (already partially handled), refresh status and show toast ("Thanks! Your plan is now active").
- Surface subscription gate errors nicely in UI (currently only 402 on API calls).
- Metered add-ons later (see Cost section below).
- Suggested quick win: implement the Stripe Customer Portal integration first (2-3 backend lines + one dashboard button + status polling). It gives invoices, payment methods, plan change, cancel for free without building all the UI yourself. Still need the "current plan" display + upgrade path to paid plans from Solo.

This is P0 for any revenue. Without it, the backend billing code is write-only for the platform owner.

---

**Usage / Cost Metering tie-in** (see also Reliability section): No way today for an owner to see "you had 87 calls last month, AI spend was ~$X". The `subscriptionGate` only knows static plan; nothing is metered or shown.

---

## 5. Onboarding, Knowledge & Setup

- Wizard (solo + team modes), 30 business templates (now in seed + `business_templates` table), vocabulary system, first-run tour, setup progress pill, and `/demo` ephemeral tenant are strong.
- **Website scan onboarding**: Core fetch + LLM extract + `knowledge_suggestion` staging + dedicated Step 7 (`Step7WebsiteScan.tsx`) + prefill of later policy questions step shipped 2026-06-12. Advanced per-question review UI with badges, full E2E coverage, simulate harness extension, cost/rate-limit guardrails, and docs updates still pending.
- Knowledge base: File upload, `knowledgeIngestion.ts` (chunking + embeddings), pgvector RAG via `/agent-tools/policy-answer` + `shared/expandQueryForEmbedding.ts` (recent accuracy win). `simulate rag` harness reports 100% hit-rate on known seeds. Missing: periodic re-scan, source citations shown to caller, admin "explain this answer" debugger.
- Policy questions: Static bank + tenant customs.
- No "import from existing calendar/CRM" step beyond the website scan.

---

## 6. Dashboard, UX & Staff Features

Strong primitives (`EmptyState`, focus-trap Modal, Toast, Badge, etc.), role gating (owner vs front_desk snaps back), `?tab=` / `?subtab=` URL sync, mobile responsive spec, guided tour, setup pill.

**Gaps** (many already in UX backlog / TODO.md):

- No billing/plan management surface.
- Calls tab now shows real transcripts + outcomes + appointment deep-links (recent).
- Analytics (`AnalyticsView.tsx`): Real data from `/analytics/stats` + calls + conversion + abandonment + "Why Callers Reached Out" + reminder delivery stats (recent work). Still surface-level; lacks a true "ask anything over my transcripts" owner copilot.
- Scheduler: Mature (single source `employee_schedule`, atomic RPCs with 5 specific error codes, overrides, quick-book). Pending items include full sub-view consolidation and neutral language on any remaining "grading" UI.
- Wizard: Draft-state Phase B (hold services/employees/shifts/etc. in local state until final "Done"; discard on dismiss) still open (large).
- CRM + CustomerDetail: Functional + internal notes + history. No deep synthesis of "what this customer has said on calls."
- No bulk operations (CSV import/export, mass actions).
- No visual "coverage gaps" or utilization heatmaps beyond existing scheduler bars.
- "Active call" badge exists; deeper live monitoring/barge does not.

Neutral-language rule ("no percentages/warnings/opinions") partially applied after UX audits.

---

## 7. Voice AI & Reliability Specifics

Prompt system (tenant persona override via `{{ }}` placeholders, customer preferences, availability discipline, "Technical glitches" recovery section) + post-call classify/summary/transcript + graceful fallback all present and recently hardened (`agent/src/` modules: `prompt.ts`, `callClassify.ts`, `callSummary.ts`, `transcript.ts`, `callOutcome.ts`, `transferClient.ts`, `fallback.ts`).

**Known issues**:

- Occasional filler phrases ("Absolutely!", etc.) still slip through.
- Agent resilience: Outer try/catch + fallback shipped; "speak filler before slow tools" (getAvailableSlots etc.) and idempotent-read retry still open (P3 items).
- Single LiveKit agent worker per tenant (no automatic scaling for high-volume shops).
- No multi-language or accent surface (English primary; per-tenant `tts_voice` (OpenAI ids: shimmer/nova/...) / `tts_speed` via `tenants` columns; legacy `tts_soft`/`tts_cheerful` columns are inert Grok-only artifacts).
- No real-time owner listen-in or coaching during calls.

---

## 8. Reliability, Ops, Scaling & Cost Control

- DB pool well-tuned (`max=10`, `connectionTimeoutMillis=5000` fail-fast, server-side GUC timeouts, RLS via `withTenantClient`).
- Load testing of the booking path (concurrent calls until pool exhaustion or latency cliff) deferred (explicit note in TODO).
- Reminders: Pure polling worker (`src/workers/reminderScheduler.ts`, 60s tick, batch ≤100). Not event-driven or queue-backed.
- **AI cost blind spot (historical at time of writing)**: Per-call spend (OpenAI GPT-4o-mini + embeddings + summaries + Grok TTS + Deepgram) was completely untracked per-tenant or globally at one point. (AI cost metering via `ai_cost_events` + /analytics/ai-cost has since shipped; see CLAUDE.md and recent PRs. Legacy 'xai' provider rows may exist in the table from before the 2026-06-25 removal.)
  - Instrumentation points included (and former Grok TTS calls were in the now-deleted `agent/src/grokTTS.ts`).
  - Proposed data model (additive, low risk):
    - New table `tenant_usage` or daily aggregates `tenant_daily_usage (tenant_id, date, calls: int, llm_tokens: bigint, tts_chars: bigint, stt_seconds: int, embedding_calls: int, estimated_cost_usd: numeric)`.
    - Or simpler start: append to `voice_sessions` a `cost_usd` column + `models_used` json (populated in the `voice-session-end` handler).
    - Prometheus counters already exist in `src/services/metrics.ts` — extend with cost labels or a separate `ai_cost_usd_total{tenant, provider}`.
  - Exposure: owner dashboard "Usage this month" card (calls + est. AI cost), soft cap warnings ("approaching plan"), hard cap optional (return "busy" or fall back to cheaper model).
  - Tie to billing: later, report usage to Stripe as metered billing items on the subscription.
  - Owner-visible in P1 cluster below.
- No horizontal scaling story for agent workers or backend under concurrent voice load.
- Soft-reservation purge + GiST exclusion constraints + atomic booking RPCs provide good race safety.
- No chaos/failure-injection harness beyond `scripts/simulate.sh`.

---

## 9. Security, Privacy & Compliance (Non-HIPAA)

**Very strong** (SECURITY.md + 2026-05-21 hardening pass):

- RLS + `FORCE ROW LEVEL SECURITY` on all tenant-scoped tables.
- `tenantMiddleware` (401 on unauthenticated non-public requests; 403 on cross-tenant override under JWT).
- JWT (8h) with `password_changed_at` revocation.
- Webhook signature verification (raw body, HMAC) for Stripe + all providers.
- Agent secret with `timingSafeEqual` + `AGENT_SECRET_OLD` rotation support.
- `subscriptionGate`, class-22 input errors mapped to 400 (not 500 + error metric), 39 isolation probes run in every CI build.
- Consent / opt-out records + per-tenant SMS rate limiting.

**Gaps** (with concrete "what good looks like"):

- No tenant-visible audit log ("who changed what when"). The `audit_log` table + trigger exists (SECURITY DEFINER to bypass RLS) but is platform-only; no owner-facing "Activity" or "History" view for their own data changes (customers, appointments, KB, config).
- No full-tenant data export (portability / GDPR "right to portability").
  - Should cover: tenants row (sanitized), all customers + notes + preferences, appointments (with links to calls), voice_sessions (transcripts, summaries, outcomes, caller_phone), tenant_docs (KB), employees/resources/services/shifts (config), communications_history, consent/opt-out records, reminder_schedules.
  - Format: single downloadable ZIP of JSONL/CSV + manifest, or NDJSON stream. Triggered from dashboard (owner self-serve) or super-admin.
  - New route sketch: `GET /export/tenant-data` (auth'd, streams or returns signed URL to object storage). Background job recommended for large tenants.
- No explicit "right to be forgotten" flow beyond soft-delete + cascades (voice transcripts/summaries/notes remain).
  - Current soft-delete (`versionHistory.ts`, `deleted_customers_view`, restore RPC) is good for accidents but not for "erase my data".
  - Need a hard-purge path (GDPR/CCPA style) that: (a) redacts/anonymizes voice_sessions (null phone + transcript), (b) deletes or anonymizes customer notes/preferences, (c) keeps aggregate analytics if desired, (d) writes to audit.
  - UI: "Delete all my customer data" (with confirmation + export-first) in Settings or Customers.
- No automated data retention / purge policy (old calls, transcripts, recordings).
  - No worker or cron that purges `voice_sessions` + transcripts/summaries older than N days (configurable per tenant? or global 1-2 years).
  - Same for communication_history, old soft-deleted rows.
- Call audio (if ever captured upstream) has zero retention/redaction/consent workflow. (LiveKit has Egress recording capability; Telnyx can record on the trunk. Nothing in the product wires storage (S3/Supabase Storage), playback in Calls tab, or per-call consent flag.)
- TCPA SMS consent language not yet required at booking time (legal TODO). The consent system exists (`consentService.ts`, opt-out records, `communications/consent` routes) but the AI booking path does not surface or require explicit "I consent to SMS reminders" before the first confirmation SMS.
- Account lock is SQL-only (no UI for `password_changed_at` bump).
- CORS still permissive by default in source.
- No per-worker agent identity (single global secret).
- Local test DB uses superuser (bypasses RLS); prod trusts Supabase managed role + FORCE.

---

## 10. Analytics, Insights & Intelligence

Major recent progress (2026-06-12): `/analytics/stats`, call volume/conversion/abandonment from `voice_sessions`, outcome classification wired into shutdown, transcripts + summaries + appointment links, reminder delivery stats, "Why Callers Reached Out" panel.

**Still light**:

- No cohort, CLV, first-time-fix rate, or service-specific deep abandonment analysis.
- No owner "ask anything" copilot over their own call transcripts + KB + appointments.
- Prometheus metrics (`booking_attempts_total`, `tool_calls_total`, `errors_total`, HTTP histograms, etc.) exist in `src/services/metrics.ts` but are token-gated ops-only.
- No A/B testing surface for prompts/greetings per tenant.

---

## 11. Testing & QA

**Excellent for solo project** (~1910 backend + 716 dashboard + 91 agent unit tests; ~146 Playwright E2E covering major workflows; all green on recent runs). Strong 5W comments, real-DB isolation, `SYNC_TEST_RECORDER` for sync contract, drift detectors.

- `scripts/simulate.sh` (status, tools journey that flags `[dev]` gaps, rag eval at 100%, browser call dispatch) is a standout recent addition.
- E2E covers booking races, wizard-to-first-booking, role gating, mobile, tenant delete cascade, analytics, comms history, cancel/restore, etc.

**Gaps**:

- Live PSTN voice end-to-end (the Beth blocker; one E2E skip is voice calls).
- Real external OAuth + Stripe + live CRM paths (orchestration only via recorder).
- RAG eval is manual/on-demand (costs money, non-deterministic).
- No property-based or sustained load tests.
- Low coverage pockets remain (reminder processor/repository, some comms adapters, certain dashboard primitives).
- Full multi-step wizard still mostly unit-tested (E2E cost is high).

---

## 12. DevOps, Deployment, CI/CD

- All three Railway services (ai-sec backend, ai-sec-agent, dashboard) deploy exclusively from `main` (verified via Railway GraphQL).
- Nixpacks + `railway.json`. Full portable workflow kit (`PORTABLE_DEVELOPMENT_WORKFLOW.md`, hooks, `prepare-commit.sh`, `pre-pr`, `checks`, branch creator).
- CI (`.github/workflows/ci.yml`): backend (pgvector service + forced DB tests), dashboard (typecheck + vitest), agent, e2e (Playwright). First all-green achieved recently.
- Health endpoints: shallow `/health`, deep `/ready` (pool saturation + DB ping; 503 on unreachable).
- Backend changes require explicit `npm run build` + restart (documented).

**Major gaps**:

- Railway deploys **not gated** on CI green (P0).
- Env var drift produces silent production failure modes (mocks, localhost URLs).
- No canary / blue-green / feature flags.
- Observability tokens not set → no metrics, no log aggregation, no Sentry in prod.
- No automated "feature readiness" report at boot.

---

## 13. Documentation & Process

**Outstanding** self-documentation hygiene:

- `CLAUDE.md` (living spec with key directories, DB conventions, build principles, "test it or delete it").
- `docs/TODO.md` (active queue with `[prod]`/`[dev]` tags, simulate harness results).
- `RESOLVED.md`, `HANDOFF.md`, `SECURITY.md`, `TEST_COVERAGE.md`, `DEPLOYMENT.md`, `BETA_ONBOARDING.md`, `STRATEGY.md`, `COMPETITOR_WEAKPOINTS.md`, diagrams, session archives.
- Drift detectors (`npm run verify:claude-md`, `verify:schema`), AGENTS.md mechanical refactor rules, 5W test comments, prepare-commit.

**Gaps**:

- Limited _public/user-facing_ documentation (owner admin guides, "how to read the analytics", telephony troubleshooting playbook).
- Some older docs (e.g., DEPLOYMENT) have stale references to removed components (edge functions).
- No runbook for common prod incidents ("agent silent", "reminders not sending", "Stripe webhook 400").

---

## 14. Business / Legal / GTM / Ops

- Strong strategy (receptionist wedge first, then optional ops; cross-platform; no seat tax; attack platform-bundler weaknesses; focus non-trades verticals where incumbents don't bundle receptionists).
- No in-product support/ticketing system for customers (internal `TICKET_SUPPORT.md` only for Telnyx).
- No usage-based alerts for owners ("47 calls this week — approaching plan limits").
- Pricing tiers well-documented in strategy but not productized in the dashboard UI.
- No public marketing/landing site beyond minimal static assets + demo.
- No partner/affiliate/reseller program.
- Solo-founder concentration risk (bus factor 1).

---

## 15. Scalability, Performance & Cost

- Known limits: pool `max=10` + single agent worker per tenant. Never load-tested under realistic concurrent voice load.
- AI spend (OpenAI + former xAI + Deepgram per call) is invisible and uncapped. (Note: ai_cost_events metering has been added since this inventory was first written.)
- RAG is pure pgvector cosine + expansion; no hybrid search, reranking, or response caching.
- No CDN/edge story for dashboard or static KB.
- Reminder scheduler is simple polling.
- No read replicas or advanced connection strategies.

---

## 16. Additional "Table Stakes" or Future-Proofing Gaps

- International numbers / multi-country support (Telnyx capable; code and templates are US-centric).
- White-label / reseller dashboard theming.
- Granular RBAC beyond owner/front_desk.
- Public API surface for power users or external integrators (current endpoints are internal + agent-tools + dashboard).
- SSO/SAML (currently password + magic-link invites only).
- Rich exports (CSV/PDF of calls, appointments, customers, analytics).
- Smart proactive suggestions ("your Saturdays are empty — want to promote them to callers?").
- Voice biometrics or "known caller" shortcuts.
- Post-call SMS "how did we do?" review link or NPS.
- Payments for the tenant's own customers (explicitly out of scope for now per strategy).

---

## Prioritized Action Clusters (Rough Order)

**P0 — Unblock any real customer / Beth go-live**

- Complete BETH checklist (different-carrier PSTN test + Telnyx REFER enable + forward_phone set on dashboard).
- Set remaining Railway env vars (TELNYX*PHONE_NUMBER, DASHBOARD_URL, CORS_ORIGIN, STRIPE*\* vars, EMAIL_USER/PASS, BACKEND_URL on agent) — code fixes shipped, boot warns on missing.
- Set Railway observability tokens + basic alerts (`errors_total`, booking failures, pool waiting, etc.).
- Gate Railway deploys on CI green (branch protection or Railway "wait for CI").
- Stripe live verification (test keys + CLI replay + full owner checkout → webhook → status → gate).
- Legal docs (Bonterms) + TCPA language + basic insurance.

**P1 — Customer success & trust**

- Customer self-service (detailed design above). Entry points: `src/services/communications/{smsService.ts, appointmentService.ts, emailTemplates.ts}`, `src/routes/appointments.ts` (add token-gated handlers or new `selfService.ts` route), `dashboard/lib/api.ts`, new or extended components in `AppointmentDetailPanel.tsx` or a new `SelfServiceLinks.tsx`. Add `?token=` handling that bypasses normal auth for these actions only. Start with cancel link (easiest).
- Live comms providers: Telnyx is default (SMS + provisioning + SIP for LiveKit). ProviderRegistry + direct telnyxSms paths wired. Set TELNYX\_\* creds on Railway. (See `TELEPHONY_PROVIDER` for any override, though none planned.)
- Billing UI for owners (current plan, upgrade buttons, invoices). See expanded Billing section. Start with Stripe Customer Portal session creation (quick) + status display. Entry: `src/routes/billing.ts` + `dashboard/components/` (new card or Settings subsection) + api.ts extension (add `createPortalSession`).
- Richer outcome-driven automations (follow-up on "price" or "no_availability" calls). Wire `callClassify.ts` results into reminder or post-call comms paths.
- Owner-facing cost/usage meter (calls + AI spend). See Cost subsection. Instrument the 5-6 points listed; surface in Analytics or new Usage card.
- Full calendar sync live (Google/Outlook) for at least one tenant. Env vars + OAuth app setup + prove a real sync round-trip (use the existing `calendarSync.ts` + test recorder pattern).

**P2 — Quality, scale & defensibility**

- Agent latency fillers + resilience items.
- Load test booking path + define scaling knobs (pool size, worker count).
- Data export + retention/purge policy + visible audit log for owners.
- Website-scan polish + E2E + RAG gating.
- Calendar sync proven + exposed.
- Deeper analytics / owner copilot over transcripts.
- Multi-language / voice style surface if demand appears.

**P3 — Moat & expansion**

- Safe-partner CRM depth (Square or future non-bundling platforms).
- Public booking widget / embed (when strategy says it's time).
- White-label / reseller.
- Public API.

---

## How to Use This Document

1. Treat `docs/TODO.md` as the living execution queue (it has the `[prod]` tags, simulate results, and concrete next steps).
2. Use this `GAPS.md` for "did we miss an entire category?" thinking before planning a phase.
3. Before any customer onboarding, walk the P0 cluster above + run `./scripts/simulate.sh status --deep && ./scripts/simulate.sh tools`.
4. After shipping something big (e.g., billing UI, self-service links), add a dated section here and move closed items to RESOLVED.md style notes.

**Ship = merge to main via PR + prod DB migration apply (if any) + Railway deploy from main + live validation with simulate + real call if voice-related.**

This file was generated from a full-repo deep dive on 2026-06-15 and expanded same-day with deeper design specs on self-service (full token + template + route sketch), billing (API surface + Stripe Portal quick win), AI cost instrumentation points, data export/retention requirements, and comms actionability. It will decay if not maintained — run the drift detectors (`npm run verify:claude-md`) after touching related code/docs and update this file (add dated "Expanded" or "Closed" notes).

**Inconsistencies spotted during expansion (low-hanging polish)**:

- `dashboard/lib/api.ts` billing.checkout only types `'solo' | 'growth'` while backend + envs support 'professional'.
- Landing page has full price cards + features; the logged-in app has almost none of that surface for existing tenants to upgrade.
- No "professional" plan handling in some client paths.

---

**Next step for the reader**: Open `docs/TODO.md` and `docs/BETH_GO_LIVE_TODO.md`, pick the top unblocked item from the P0 cluster, create a feature branch, and start executing. The simulate harness will tell you immediately when a link is wired.
