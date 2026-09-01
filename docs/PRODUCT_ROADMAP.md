# Secretary HQ — Product Roadmap

**Vision**: "Sounds Real. Books Smart. Never Misses a Call." — live in under 10 minutes.

This roadmap is organized in sequential **Passes**. Each pass builds on the last.
Pass 1 is the foundation (infra + billing + voice validation). Every subsequent pass
makes the product more user-friendly, more customizable, and harder to replicate.

Items tagged `(Dale)` = owner action, no code required.
Items tagged `(Code)` = engineering work.
Items tagged `(Both)` = both.

Dependencies are listed per task. A task with dependencies cannot start until all
of them are complete.

---

## PASS 1 — Foundation: Ready for First Paying Customer

**Goal**: System is operational, secure, billable, and validated on a real call.
**Target**: ~4 weeks
**Exit criteria**: One paying customer can sign up, get an AI receptionist, and be charged automatically. (Note: SMS confirmations/reminders stay OFF platform-wide until per-tenant 10DLC registration lands — see T-002. The confirmation path is validated in-app, but no text reaches a handset until the campaign is approved and `ENABLE_SMS` is flipped.)

---

### T-001: Security Credentials Rotation
**Priority**: CRITICAL — do immediately  
**Owner**: (Dale)  
**Effort**: 1 hour  
**Dependencies**: None  
**Subtasks**:
- [ ] T-001a: Rotate Railway team token (exposed 2026-06-12) — Railway → Team → Tokens → delete + reissue
- [ ] T-001b: Update any CI/local scripts using the old token
- [ ] T-001c: Rotate Supabase DB password (exposed 2026-07-11) — Supabase → Database → Reset password
- [ ] T-001d: Update `DATABASE_URL` on all Railway services + local `.env`
- [ ] T-001e: Redeploy backend and verify `/health` returns 200

---

### T-002: Enable SMS — 10DLC Registration + Gating Flip
**Priority**: CRITICAL  
**Owner**: (Dale + Code)  
**Effort**: 6-12 hours code/ops + 1-3 weeks carrier approval (out of our hands)  
**Dependencies**: None  
**Context**: SMS is **OFF by design**, not broken. The reminder/confirmation code exists and works in-app, but `ENABLE_SMS` defaults to `false` (see `agent/src/configSchema.ts`) because the sending number is not 10DLC-registered — until it is, carriers silently drop everything and Telnyx reports false success. This is a registration + gating task, not a bug hunt.  
**Subtasks**:
- [ ] T-002a: Register a 10DLC brand for the business with Telnyx (EIN, business details)
- [ ] T-002b: Create + submit a 10DLC campaign (use case: appointment reminders/confirmations, informational — sample messages, opt-in/opt-out language)
- [ ] T-002c: Associate the sending `TELNYX_PHONE_NUMBER` with the approved campaign
- [ ] T-002d: Verify `TELNYX_API_KEY` and `TELNYX_PHONE_NUMBER` on Railway are valid + owned by the registered brand
- [ ] T-002e: Once the campaign is approved, flip `ENABLE_SMS=true` on Railway (nothing else changes — the code is already wired)
- [ ] T-002f: Flip `ENABLE_PHONE_VERIFICATION=true` too (it is gated on `ENABLE_SMS` — a code that can't be delivered is not a gate)
- [ ] T-002g: Send a test SMS end-to-end and confirm carrier delivery receipt (not just Telnyx-accepted)
- [ ] T-002h: Add loud error logging on SMS failure (not silent `status='failed'`)
- [ ] T-002i: Verify one full reminder cycle end-to-end (appointment → reminder → SMS → delivery receipt)

---

### T-003: Live Voice Validation Call
**Priority**: CRITICAL  
**Owner**: (Dale)  
**Effort**: 30 min call + 1 hour follow-up  
**Dependencies**: None (SMS validation deferred — see T-002; production calls take a message for escalation, not a live transfer — see `docs/SECRETARYHQ_FEATURES.md`)  
**Subtasks**:
- [ ] T-003a: Set forward number on dashboard (Phone Assistant → `+1 608-217-5303`)
- [ ] T-003b: Wife calls `+1 630-822-9086` (not your phone)
- [ ] T-003c: Validate booking — appointment lands in DB for correct tenant + time
- [ ] T-003d: Validate escalation — say "talk to a person" / "it's urgent" → a message is taken and the urgent flag is set (there is NO live human transfer on the question-tree flow today; SIP REFER plumbing exists in code but is not exposed on production calls)
- [ ] T-003e: Validate SMS confirmation path in-app (message row written) — actual handset delivery is blocked until T-002 (10DLC) lands, so do not expect a text yet
- [ ] T-003f: Validate dialog — agent natural, asks preferred time, no forced slots
- [ ] T-003g: Log findings (any repeated questions, weird phrasing, dead air) to `CALL_FIX_PLAN.md`

---

### T-004: Stripe Test-Mode Wiring
**Priority**: CRITICAL  
**Owner**: (Dale)  
**Effort**: 2 hours  
**Dependencies**: None (runs in parallel)  
**Subtasks**:
- [ ] T-004a: Decide final tier pricing (research: $99-129 Solo / $199-249 Growth / $349+ Pro)
- [ ] T-004b: Create 3 Stripe products + prices in **TEST mode** — note price IDs
- [ ] T-004c: Register webhook endpoint in Stripe TEST mode:
  - URL: `https://secretary-hq-production.up.railway.app/billing/webhook`
  - Events: `checkout.session.completed`, `invoice.payment_failed`, `customer.subscription.deleted`
  - Copy signing secret (`whsec_...`)
- [ ] T-004d: Set 5 env vars on Railway: `STRIPE_WEBHOOK_SECRET`, `STRIPE_SOLO_PRICE_ID`, `STRIPE_GROWTH_PRICE_ID`, `STRIPE_PRO_PRICE_ID`, `STRIPE_AUTO_TAX`
- [ ] T-004e: Test round-trip — trigger test checkout, verify webhook fires, verify gate activates
- [ ] T-004f: Run `./scripts/simulate.sh stripe` and confirm clean

---

### T-005: Stripe Live-Mode & Bank Account
**Priority**: CRITICAL  
**Owner**: (Dale)  
**Effort**: 4 hours  
**Dependencies**: T-004 (test mode must pass first)  
**Subtasks**:
- [ ] T-005a: Open LLC bank account for Thinking Hammer (required for Stripe payouts)
- [ ] T-005b: Connect bank account to Stripe (Settings → Bank accounts & scheduling)
- [ ] T-005c: Enable Stripe Tax (Tax → Settings → register IL nexus + customer states)
- [ ] T-005d: Recreate 3 products + prices in **LIVE mode** — new price IDs
- [ ] T-005e: Register webhook in **LIVE mode** (same URL, same 3 events) — copy new `whsec_live_...`
- [ ] T-005f: Swap all 5 Railway env vars to live values
- [ ] T-005g: Verify live webhook receives events

---

### T-006: Add Monitoring & Alerting
**Priority**: HIGH  
**Owner**: (Code)  
**Effort**: 6-10 hours  
**Dependencies**: None  
**Subtasks**:
- [ ] T-006a: Choose observability platform (Better Stack recommended — already used for logs)
- [ ] T-006b: Instrument key metrics: call start/end, outcomes, turn latency, SMS success/fail, reminder success/fail, booking success/fail, webhook receipts
- [ ] T-006c: Configure alert rules:
  - `reminder_batch_failed > 3 in 10 min` → page (this is what caught the 13-day outage)
  - `sms_failure_rate > 5%` → warning
  - `call_rejection_rate > 2%` → investigate
  - `turn_latency_p95 > 3000ms` → warning
  - `webhook_signature_failures > 0 in 1h` → page
- [ ] T-006d: Build ops status dashboard (calls, reminders, SMS, Stripe, agent uptime)
- [ ] T-006e: Test alerts — trigger each one manually, verify notification fires

---

### T-007: Fix E2E Test Flakiness
**Priority**: HIGH  
**Owner**: (Code)  
**Effort**: 4-6 hours  
**Dependencies**: None  
**Subtasks**:
- [ ] T-007a: Reproduce `SetupWizard > shows success state` failure (1115ms on CI)
- [ ] T-007b: Reproduce `customer-preferences-config.spec.ts` reload failure
- [ ] T-007c: Fix each: replace timing assertions with explicit `waitFor()` on actual state
- [ ] T-007d: Run each test 20× consecutively — zero flakes required
- [ ] T-007e: Confirm 3 consecutive CI green runs

---

### T-008: Validate New Intake Trees (As a Customer)
**Priority**: HIGH  
**Owner**: (Both)  
**Effort**: 2-3 hours  
**Dependencies**: None  
**Subtasks**:
- [ ] T-008a: Register as new tenant (`https://www.secretaryhq.com` — not local)
- [ ] T-008b: Pick `Catering` as business type — verify it appears in picker
- [ ] T-008c: Complete 7-step setup wizard
- [ ] T-008d: Check agent Checklist tab — `catering_intake` block must appear
- [ ] T-008e: Query DB: `SELECT checklist_preset_id FROM tenants` → must be `catering_front_desk`
- [ ] T-008f: Run simulator: `SIM_TRACE=1 npx tsx agent/scripts/sim-questiontree.ts` for catering
- [ ] T-008g: Repeat spot-check for 3 other verticals (e.g., plumber, salon, real_estate)

---

### T-009: Volume Metering & Tier Caps
**Priority**: HIGH  
**Owner**: (Code)  
**Effort**: 8-12 hours  
**Dependencies**: T-004 (prices must be finalized before caps make sense)  
**Subtasks**:
- [ ] T-009a: Add columns to `tenants`: `subscription_tier`, `calls_this_month`, `month_reset_date`
- [ ] T-009b: Increment `calls_this_month` on `start_voice_session()` in agent worker
- [ ] T-009c: Enforce tier cap before answering — reject over-limit calls gracefully ("Your plan limit has been reached")
- [ ] T-009d: Auto-reset counter monthly (cron job or on-read comparison with `month_reset_date`)
- [ ] T-009e: Webhook: on `checkout.session.completed` → set `subscription_tier` from price_id
- [ ] T-009f: Webhook: on `customer.subscription.deleted` → clear tier
- [ ] T-009g: Tests — simulate 300+ calls on Solo tier, verify call 301 is rejected; upgrade and verify it succeeds

---

### T-010: Schedule Pattern Adoption (Existing Tenants)
**Priority**: MEDIUM  
**Owner**: (Code)  
**Effort**: 2-4 hours  
**Dependencies**: None  
**Context**: The `20260820000000_employee_schedule_pattern` migration deliberately does **NO BACKFILL** — inventing a weekly rule from existing dated rows is exactly the "row archaeology" the `employee_schedule_pattern` table was created to end. Legacy tenants safely use the now-clamped derived fallback (`CURRENT_DATE + 14`) until they next re-save their hours, at which point `expandWeeklyToSchedule` writes the declared rule. This task is about driving that re-save, NOT scripting a guess.  
**Subtasks**:
- [ ] T-010a: Write a read-only script to find tenants with NO `employee_schedule_pattern` rows (still on the derived fallback)
- [ ] T-010b: Confirm the clamped fallback is working for them (no far-future unbookability — the bug the clamp already fixes)
- [ ] T-010c: Prompt those owners to re-save their hours in the wizard (in-app nudge / email) so the declared rule is written the correct way
- [ ] T-010d: For Thinking Hammer specifically, re-save hours in the dashboard and verify a pattern row is written by `expandWeeklyToSchedule`
- [ ] T-010e: Verify new extends use the declared rule once present, and the clamped fallback until then

---

### T-011: Verify Cost Tracking Ledger
**Priority**: MEDIUM  
**Owner**: (Code)  
**Effort**: 2-3 hours  
**Dependencies**: None  
**Subtasks**:
- [ ] T-011a: Confirm `aiCost/index.ts` tracks all 4 legs: GPT-4.1-mini LLM, Deepgram Aura TTS, Deepgram Nova-3 STT, 4o-mini summary
- [ ] T-011b: Pull 5 real prod calls and verify ledger cost ~$0.05-0.10/call
- [ ] T-011c: Compare against provider invoices (Deepgram + OpenAI) — within 5%

---

### T-012: Deployment Checklist & Automation
**Priority**: MEDIUM  
**Owner**: (Code)  
**Effort**: 3-4 hours  
**Dependencies**: None  
**Subtasks**:
- [ ] T-012a: Write `docs/DEPLOYMENT_CHECKLIST.md` (pre-merge, post-merge, data migrations, post-deploy steps)
- [ ] T-012b: Add GitHub Action: CLAUDE.md drift check + no secrets in code
- [ ] T-012c: Document the 3 known gotchas (Railway "Wait for CI" unversioned, migrations order, SKIPPED is terminal)

---

### T-013: Full Customer Onboarding Walk-Through
**Priority**: MEDIUM  
**Owner**: (Dale)  
**Effort**: 3-4 hours  
**Dependencies**: T-003 (live call must work), T-008 (intake trees validated)  
**Subtasks**:
- [ ] T-013a: Register as new tenant (use real email, real phone)
- [ ] T-013b: Complete all 7 wizard steps (services, employees, resources, shifts, persona, knowledge base, phone activation)
- [ ] T-013c: Make a real test call
- [ ] T-013d: Check transcript, booking, SMS, CRM record
- [ ] T-013e: Document friction points + UX bugs → feed directly into PASS 2

---

### T-014: Dead Code Removal
**Priority**: LOW  
**Owner**: (Code)  
**Effort**: 2-3 hours  
**Dependencies**: T-001 through T-013 complete (don't remove until features are stable)  
**Subtasks**:
- [ ] T-014a: Delete `ReminderProcessor` (unused parallel implementation)
- [ ] T-014b: Remove commented-out debug code
- [ ] T-014c: Remove any unused route stubs

---

### PASS 1 — Exit Criteria
- [ ] First paying customer can sign up, complete setup, and get AI reception
- [ ] SMS confirmation/reminder path validated in-app (actual handset delivery gated on T-002 / 10DLC)
- [ ] Call booking works end-to-end; escalation takes a message + urgent flag (no live transfer on the question-tree flow today)
- [ ] Stripe charges and subscription gate enforced
- [ ] Monitoring alerts before anyone notices an outage
- [ ] CI is green and stable (no flaky gates)

---

---

## PASS 2 — UX & Customization: Self-Service & Delightful

**Goal**: Any business owner can set up Secretary HQ in under 10 minutes without assistance. The product should feel polished, intuitive, and personal — not like enterprise software.
**Target**: ~6 weeks after PASS 1
**Exit criteria**: NPS > 40 from first 10 customers. Setup time < 10 min measured on a fresh account.

---

### T-101: Redesign Onboarding Wizard (Guided, Opinionated)
**Priority**: CRITICAL for PASS 2  
**Owner**: (Code)  
**Effort**: 20-30 hours  
**Dependencies**: T-013 (walk-through findings from PASS 1)  
**Subtasks**:
- [ ] T-101a: Audit current 7-step wizard for friction (from T-013 findings)
- [ ] T-101b: Redesign flow — fewer steps, smarter defaults, inline help text
- [ ] T-101c: Add "Quick Setup" path (under 5 min, skip optional steps) vs "Full Setup" (all 7 steps)
- [ ] T-101d: Auto-detect business type from website scan (already seeded, but surface to user clearly)
- [ ] T-101e: Add in-wizard preview ("Here's what your AI receptionist will say on first call")
- [ ] T-101f: Progress persistence — wizard saves state, owner can return later
- [ ] T-101g: Phone number provisioning in-wizard (currently separate step)
- [ ] T-101h: E2E test the new wizard flow (automated)

---

### T-102: AI Persona Customization (Richer Controls)
**Priority**: HIGH  
**Owner**: (Code)  
**Effort**: 10-16 hours  
**Dependencies**: T-003 (voice must work before persona is worth polishing)  
**Subtasks**:
- [ ] T-102a: Expand voice picker (show voice names + audio preview clips — "Click to hear")
- [ ] T-102b: Add greeting script editor (free-form, with variable tokens like `{{business_name}}`, `{{owner_first_name}}`)
- [ ] T-102c: Add personality dial (formal ↔ casual ↔ friendly — maps to system prompt tone)
- [ ] T-102d: Add "live preview" — owner can call the agent right from the dashboard to hear changes
- [ ] T-102e: Save persona changes without redeploy (already hot-reloaded from DB, verify this works)
- [ ] T-102f: Show persona diff ("Changed: greeting, voice") on save confirmation

---

### T-103: Knowledge Base Builder (Self-Service)
**Priority**: HIGH  
**Owner**: (Code)  
**Effort**: 12-18 hours  
**Dependencies**: None  
**Subtasks**:
- [ ] T-103a: Redesign the Q&A editor — make adding a new policy pair a one-click action
- [ ] T-103b: Add categories/tags to Q&A pairs (Pricing, Hours, Policies, Services, Location)
- [ ] T-103c: Add "test this answer" — type a question, see what the AI says
- [ ] T-103d: Add suggested Q&A pairs (based on business type, pre-populated)
- [ ] T-103e: Improve document upload UX — drag & drop zone, show processing status, confirm indexed
- [ ] T-103f: Add knowledge base preview — "What would the agent say if asked: ______?"
- [ ] T-103g: Show which Q&A pairs get hit most often (analytics)

---

### T-104: Dashboard UX Polish Pass
**Priority**: HIGH  
**Owner**: (Code)  
**Effort**: 16-24 hours  
**Dependencies**: T-013 (walk-through friction findings)  
**Subtasks**:
- [ ] T-104a: Unified inbox — calls, messages, bookings in one chronological feed (not 3 separate tabs)
- [ ] T-104b: Mobile-responsive dashboard (currently desktop-only; critical for owners on their phones)
- [ ] T-104c: Better call transcript viewer — searchable, highlights key events (booked, transferred, message taken)
- [ ] T-104d: Quick actions from transcript (e.g., "Confirm booking", "Call back", "Add to CRM")
- [ ] T-104e: Notification system — in-app alerts for missed calls, new bookings, failed reminders
- [ ] T-104f: Theme picker visible from all pages (currently buried)
- [ ] T-104g: Empty state screens — helpful, not blank (e.g., "No calls yet. Make a test call!")
- [ ] T-104h: Loading states and skeleton screens (no more blank flashes during data load)

---

### T-105: Business Type Vocabulary & Customization
**Priority**: HIGH  
**Owner**: (Code)  
**Effort**: 8-12 hours  
**Dependencies**: T-008 (intake trees validated)  
**Subtasks**:
- [ ] T-105a: Let owners override vocabulary ("Appointments" → "Consultations", "Staff" → "Stylists")
- [ ] T-105b: Show a preview of how the vocabulary changes the dashboard ("Here's what your dashboard looks like with 'Consultations'")
- [ ] T-105c: Extend vocabulary per business type (currently only 29 types covered, add edge cases)
- [ ] T-105d: Allow custom service categories (instead of just the defaults)

---

### T-106: Scheduler UX Improvements
**Priority**: MEDIUM  
**Owner**: (Code)  
**Effort**: 12-16 hours  
**Dependencies**: None  
**Subtasks**:
- [ ] T-106a: Drag-and-drop appointment rescheduling on the swimlane view
- [ ] T-106b: Conflict indicators — show overlapping appointments visually before they happen
- [ ] T-106c: Recurring appointments UI (agent already supports, dashboard doesn't show them well)
- [ ] T-106d: Staff availability at-a-glance (green/yellow/red per day on month view)
- [ ] T-106e: Quick book modal improvements (smarter time suggestions, show next available slot)
- [ ] T-106f: Cancellation flow with optional reason + auto-SMS to customer

---

### T-107: Customer-Facing Booking Page (Self-Service Link)
**Priority**: MEDIUM  
**Owner**: (Code)  
**Effort**: 16-24 hours  
**Dependencies**: T-005 (billing must be wired — this is a paid feature)  
**Subtasks**:
- [ ] T-107a: Generate a public booking URL per tenant (e.g., `secretaryhq.com/book/my-business`)
- [ ] T-107b: Booking page shows: available services, staff, time slots (same availability as AI agent)
- [ ] T-107c: Customer picks service → employee → time → enters name/phone → books
- [ ] T-107d: Confirmation SMS sent after booking
- [ ] T-107e: Reschedule/cancel link in confirmation SMS
- [ ] T-107f: Owner can embed booking page as iframe on their own website
- [ ] T-107g: Booking page respects the same rules as the AI agent (no double-bookings, skill checks)

---

### T-108: SMS & Reminder Customization
**Priority**: MEDIUM  
**Owner**: (Code)  
**Effort**: 6-10 hours  
**Dependencies**: T-002 (SMS must be working first)  
**Subtasks**:
- [ ] T-108a: Allow owners to edit reminder message templates (with variable tokens)
- [ ] T-108b: Allow owners to set reminder timing (e.g., 24h, 2h, 1h before — currently hardcoded)
- [ ] T-108c: Add email reminders as alternative/fallback to SMS
- [ ] T-108d: Preview reminder messages before saving ("Here's what your customer will receive")
- [ ] T-108e: Show reminder send history in Calls tab (per appointment)

---

### T-109: Owner Mobile Experience (PWA)
**Priority**: MEDIUM  
**Owner**: (Code)  
**Effort**: 8-12 hours  
**Dependencies**: T-104 (mobile-responsive dashboard must be done first)  
**Subtasks**:
- [ ] T-109a: Add PWA manifest + service worker to dashboard
- [ ] T-109b: Add "Add to Home Screen" prompt for mobile visitors
- [ ] T-109c: Push notifications for new calls, bookings, failed reminders (requires PWA)
- [ ] T-109d: Mobile-optimized call transcript view (swipe gestures, larger tap targets)
- [ ] T-109e: Offline support for reading (not editing) recent calls and appointments

---

### T-110: In-App Onboarding Checklist (Post-Signup)
**Priority**: MEDIUM  
**Owner**: (Code)  
**Effort**: 4-6 hours  
**Dependencies**: T-101 (wizard redesign first)  
**Subtasks**:
- [ ] T-110a: Add sticky "Getting Started" widget (top-right, dismissable)
- [ ] T-110b: Checklist items: Add services ✓ / Add staff ✓ / Set hours ✓ / Make test call ✓ / Go live ✓
- [ ] T-110c: Each item deep-links to the relevant step
- [ ] T-110d: Disappears automatically when all 5 items are complete
- [ ] T-110e: Show completion % in the header until setup is done

---

### PASS 2 — Exit Criteria
- [ ] New customer completes setup in < 10 minutes unassisted
- [ ] Owner can customize AI persona, greeting, knowledge base without help
- [ ] Dashboard is usable on mobile
- [ ] Booking page live (customers can self-book without calling)
- [ ] NPS > 40 after 10 customers

---

---

## PASS 3 — Growth: Scale, Integrations & Analytics

**Goal**: Remove friction to acquiring more customers. Make Secretary HQ sticky through integrations, data, and multi-location support.
**Target**: ~8 weeks after PASS 2
**Exit criteria**: 50+ active tenants. Churn < 5%/month. At least one "power user" on Pro tier.

---

### T-201: Advanced Analytics Dashboard
**Priority**: HIGH  
**Owner**: (Code)  
**Effort**: 16-24 hours  
**Dependencies**: T-006 (monitoring first, so we have the data)  
**Subtasks**:
- [ ] T-201a: Call analytics — busiest hours heatmap, call duration P50/P95, outcome breakdown (booked/transferred/message/error)
- [ ] T-201b: Booking analytics — no-show rate, cancellation rate, most booked services, most booked staff
- [ ] T-201c: Customer analytics — return rate, average spend, top customers
- [ ] T-201d: Revenue analytics — bookings vs. available slots (utilization rate), estimated revenue per month
- [ ] T-201e: AI cost per call — show owners their cost transparency (builds trust)
- [ ] T-201f: Exportable reports (CSV, PDF) — owners can share with accountant or investors
- [ ] T-201g: Weekly email summary sent to owner automatically

---

### T-202: Multi-Location Support
**Priority**: HIGH  
**Owner**: (Code)  
**Effort**: 30-40 hours  
**Dependencies**: T-009 (volume metering), T-005 (billing)  
**Subtasks**:
- [ ] T-202a: Data model: `locations` table (each tenant can have N locations)
- [ ] T-202b: Each location has its own phone number, staff, resources, services
- [ ] T-202c: Dashboard: location switcher in the header
- [ ] T-202d: AI agent: routes call to correct location's config based on which number was called
- [ ] T-202e: Analytics: per-location + rolled-up view
- [ ] T-202f: Billing: Growth tier gets multi-location; Solo is single-location
- [ ] T-202g: Migration for existing single-location tenants (wrap in a `locations` row)

---

### T-203: Team Management (Multiple Users Per Tenant)
**Priority**: HIGH  
**Owner**: (Code)  
**Effort**: 20-28 hours  
**Dependencies**: None  
**Subtasks**:
- [ ] T-203a: Data model: `tenant_users` (many users per tenant, each with a role)
- [ ] T-203b: Roles: `owner` (full access), `manager` (no billing/cancellation), `receptionist` (read-only calls + booking)
- [ ] T-203c: Invite flow — owner emails invite link, new user signs up and lands in tenant context
- [ ] T-203d: User management page — view, remove, change role
- [ ] T-203e: RLS updates — all queries scoped to tenant, not just user
- [ ] T-203f: Audit log — show who did what (booked, cancelled, changed config)

---

### T-204: Zapier & Webhook Integration
**Priority**: MEDIUM  
**Owner**: (Code)  
**Effort**: 12-18 hours  
**Dependencies**: None (build when customers ask)  
**Subtasks**:
- [ ] T-204a: Outbound webhooks — owner registers a URL, we POST on: new booking, cancelled booking, call completed, message taken
- [ ] T-204b: Zapier app — trigger on same events (official Zapier app = marketplace distribution)
- [ ] T-204c: Dashboard: webhook URL manager (add, test, delete, see delivery history)
- [ ] T-204d: Retry logic — 3 retries with exponential backoff for failed deliveries
- [ ] T-204e: Payload documentation (what fields are in each webhook event)

---

### T-205: Additional CRM Integrations
**Priority**: MEDIUM  
**Owner**: (Code)  
**Effort**: Per integration (~8-12 hours each)  
**Dependencies**: T-204 (webhooks first — some CRMs can be served via Zapier)  
**Subtasks**:
- [ ] T-205a: HubSpot — sync customers + calls (popular with service businesses)
- [ ] T-205b: Jobber — popular with trades (HVAC, plumber, locksmith)
- [ ] T-205c: ServiceTitan — popular with larger trades
- [ ] T-205d: Mindbody — popular with fitness/wellness (yoga studio, spa)
- [ ] T-205e: Acuity Scheduling — popular with salons, photographers

---

### T-206: Google Business Profile Integration
**Priority**: MEDIUM  
**Owner**: (Code)  
**Effort**: 10-14 hours  
**Dependencies**: None  
**Subtasks**:
- [ ] T-206a: OAuth with Google Business API
- [ ] T-206b: Pull hours, services, address from Google profile → seed knowledge base automatically
- [ ] T-206c: Push appointment reviews request after call (with consent)
- [ ] T-206d: Show "Click to Call" button on Google Maps listing — routed through Secretary HQ

---

### T-207: Payment Collection on Calls (Deposits)
**Priority**: MEDIUM  
**Owner**: (Code)  
**Effort**: 20-28 hours  
**Dependencies**: T-005 (Stripe live first)  
**Subtasks**:
- [ ] T-207a: After booking, agent offers: "Would you like to secure your appointment with a deposit?"
- [ ] T-207b: Send payment link via SMS (Stripe Payment Link)
- [ ] T-207c: Appointment marked `deposit_paid` after payment
- [ ] T-207d: Dashboard shows deposit status per appointment
- [ ] T-207e: Refund flow on cancellation (partial or full, owner-configurable)
- [ ] T-207f: Pricing: this is a Pro-tier feature

---

### T-208: Demo / Trial Mode
**Priority**: HIGH  
**Owner**: (Code)  
**Effort**: 8-12 hours  
**Dependencies**: T-101 (wizard redesign)  
**Subtasks**:
- [ ] T-208a: "Try it free — no credit card" signup (14-day trial, no billing required)
- [ ] T-208b: Trial has a shared demo phone number (one number, multi-tenant routing)
- [ ] T-208c: Trial limitations: 20 calls max, no SMS, watermarked transcripts
- [ ] T-208d: Trial-to-paid conversion flow — prominent upgrade banner, pre-filled billing
- [ ] T-208e: Trial expiry email sequence (day 7, day 12, day 14)
- [ ] T-208f: Conversion analytics — what % of trial users convert, at what step they drop off

---

### PASS 3 — Exit Criteria
- [ ] 50+ active tenants
- [ ] Multi-location working for at least 1 customer
- [ ] At least 1 Zapier integration live in marketplace
- [ ] Trial mode converts at > 20%
- [ ] Churn < 5%/month

---

---

## PASS 4 — Moat: Enterprise, White-Label & Advanced AI

**Goal**: Become defensible. Add capabilities competitors can't easily replicate — white-label for agencies, enterprise multi-tenant, custom AI training, and voice-first features.
**Target**: ~12 weeks after PASS 3
**Exit criteria**: At least 1 agency reseller. At least 1 enterprise customer (> $1,000/month).

---

### T-301: White-Label / Reseller Program
**Priority**: HIGH  
**Owner**: (Both)  
**Effort**: 40-60 hours  
**Dependencies**: T-203 (team management), T-202 (multi-location)  
**Subtasks**:
- [ ] T-301a: Agency dashboard — one login manages N client tenants
- [ ] T-301b: Custom branding (logo, colors, domain) per reseller
- [ ] T-301c: Reseller billing — agency pays wholesale rate, marks up to client
- [ ] T-301d: Client isolation — clients see their own dashboard, never the agency view
- [ ] T-301e: Reseller onboarding — provision new client in < 5 min from agency dashboard
- [ ] T-301f: Revenue share model (if applicable)

---

### T-302: Public API
**Priority**: MEDIUM  
**Owner**: (Code)  
**Effort**: 24-32 hours  
**Dependencies**: T-204 (webhooks — they share the auth model)  
**Subtasks**:
- [ ] T-302a: API key management (generate, rotate, revoke)
- [ ] T-302b: REST API endpoints: GET/POST appointments, GET customers, GET calls, GET transcripts
- [ ] T-302c: Rate limiting per API key
- [ ] T-302d: API documentation (OpenAPI spec + developer portal)
- [ ] T-302e: Sandbox mode (test API key, no real calls or charges)

---

### T-303: Advanced AI Voice Features
**Priority**: MEDIUM  
**Owner**: (Code)  
**Effort**: 20-30 hours  
**Dependencies**: T-003 (voice must be stable)  
**Subtasks**:
- [ ] T-303a: Call recording + consent disclosure ("This call may be recorded...")
- [ ] T-303b: Custom wake words ("Hi, this is [custom name] at [business]")
- [ ] T-303c: Multi-language support (Spanish first, given service business demographics)
- [ ] T-303d: Voice cloning (owner records 5 sentences → AI uses their voice)
- [ ] T-303e: Sentiment analysis on transcripts — flag upset callers for owner follow-up
- [ ] T-303f: Smart hold music / on-hold messages (instead of silence during transfer)

---

### T-304: Enterprise Features
**Priority**: MEDIUM  
**Owner**: (Code)  
**Effort**: 30-40 hours  
**Dependencies**: T-203 (team management), T-202 (multi-location)  
**Subtasks**:
- [ ] T-304a: SSO (SAML 2.0 / Google Workspace)
- [ ] T-304b: Custom data retention policies
- [ ] T-304c: Security/compliance hardening for enterprise (SOC 2-style audit logs, encryption-at-rest attestation, data-processing addendum) — **explicitly NON-HIPAA**: HIPAA verticals (dentist, chiropractor, vet-clinic) and PHI scope are permanently excluded from this product (no BAA), per `20260321000000_remove_hipaa_templates.sql` and project policy
- [ ] T-304d: SLA guarantees (99.9% uptime, documented)
- [ ] T-304e: Dedicated support channel (Slack shared channel or dedicated email)
- [ ] T-304f: Custom AI training (fine-tune on tenant's call history)

---

### T-305: Marketplace / App Store
**Priority**: LOW  
**Owner**: (Both)  
**Effort**: 30-40 hours  
**Dependencies**: T-302 (public API), T-204 (webhooks)  
**Subtasks**:
- [ ] T-305a: Integration marketplace in dashboard ("Connect your tools")
- [ ] T-305b: Certified integrations: Square, Google Calendar, Outlook, HubSpot, Jobber, Zapier
- [ ] T-305c: One-click install for each integration
- [ ] T-305d: Integration health dashboard (status, last sync, error count)

---

### PASS 4 — Exit Criteria
- [ ] At least 1 agency reseller managing 5+ client tenants
- [ ] Public API live with at least 3 third-party apps built on it
- [ ] Multi-language (Spanish) working on live calls
- [ ] At least 1 enterprise customer paying > $1,000/month

---

---

## DEPENDENCY GRAPH (Full System)

```
PASS 1 FOUNDATION
├── T-001 (Creds Rotation) ──────────────────────────────── independent, do first
├── T-002 (SMS Enable / 10DLC) ──────────────────────────── independent (carrier approval gated)
├── T-003 (Live Voice Call) ─── T-013 (Walk-Through) ─────── independent
├── T-004 (Stripe Test) ──────────────────────────────────── independent
│     └── T-005 (Stripe Live) ─── T-009 (Volume Metering)
├── T-006 (Monitoring) ──────────────────────────────────── independent
├── T-007 (E2E Fix) ─────────────────────────────────────── independent
├── T-008 (Intake Trees Test) ───────────────────────────── independent
├── T-010 (Schedule Adoption) ───────────────────────────── independent
├── T-011 (Cost Tracking) ───────────────────────────────── independent
├── T-012 (Deploy Checklist) ────────────────────────────── independent
└── T-014 (Dead Code) ────────────────────────────── after everything else

PASS 2 UX
├── T-101 (Wizard Redesign) ─── depends on T-013
├── T-102 (Persona Controls) ── depends on T-003
├── T-103 (Knowledge Base UX) ─ independent
├── T-104 (Dashboard UX) ────── depends on T-013
├── T-105 (Vocabulary) ───────── depends on T-008
├── T-106 (Scheduler UX) ────── independent
├── T-107 (Booking Page) ────── depends on T-005
├── T-108 (SMS Customization) ─ depends on T-002
├── T-109 (PWA) ─────────────── depends on T-104
└── T-110 (Onboarding Checklist) depends on T-101

PASS 3 GROWTH
├── T-201 (Analytics) ─────────── depends on T-006
├── T-202 (Multi-Location) ────── depends on T-009, T-005
├── T-203 (Team Management) ───── independent
├── T-204 (Webhooks) ──────────── independent
├── T-205 (CRM Integrations) ──── depends on T-204
├── T-206 (Google Business) ───── independent
├── T-207 (Deposit Payments) ──── depends on T-005
└── T-208 (Demo/Trial Mode) ───── depends on T-101

PASS 4 MOAT
├── T-301 (White-Label) ───────── depends on T-203, T-202
├── T-302 (Public API) ────────── depends on T-204
├── T-303 (Advanced Voice) ────── depends on T-003 stable
├── T-304 (Enterprise) ────────── depends on T-203, T-202
└── T-305 (Marketplace) ────────── depends on T-302, T-204
```

---

## SUMMARY — TASK COUNTS BY PASS

| Pass | Tasks | Subtasks | Owner | Est. Weeks |
|------|-------|----------|-------|-----------|
| PASS 1 — Foundation | 14 | 58 | Mixed | ~4 weeks |
| PASS 2 — UX | 10 | 57 | Code + Dale | ~6 weeks |
| PASS 3 — Growth | 8 | 45 | Code + Dale | ~8 weeks |
| PASS 4 — Moat | 5 | 25 | Code + Both | ~12 weeks |
| **Total** | **37** | **185** | | **~30 weeks** |

---

## CURRENT STATUS

- **PASS 1**: In progress. Vertical intake trees (T-008 code) merged to main.
- **PASS 2+**: Not started. Waiting for PASS 1 completion.

---

*Last updated: 2026-09-01*
*Next review: After PASS 1 exit criteria are met*
