# TODO — SecretaryHQ (single backlog)

**This is the one and only backlog.** Consolidated 2026-07-05 from the former
`GAPS.md`, `IMPROVEMENT_IDEAS.md`, `IMPROVEMENTS_TODO.md`, and
`AIASSISTANT_GO_LIVE_TODO.md` (all deleted; their done items + analysis archived
verbatim in `docs/RESOLVED.md` under the 2026-07-05 entry).

Items are ordered by what should be done first. Ownership tags:
`(Dale)` = user/ops action, no code · `(code)` = codeable now · `(blocked)` = waiting on an external gate ·
**untagged** = deferred code work (the P3 / UX / doc-hygiene sections — no per-item owner because nothing there is scheduled).

**Not backlogs (left as reusable procedure/reference, do not fold here):**
`docs/BRANCH_CHECKLIST.md`, `docs/CODING_STANDARDS.md`, `docs/DEPLOYMENT.md`,
`docs/DEVELOPMENT_WORKFLOW.md`, `docs/ALERTS.md`. Completed work + history: `docs/RESOLVED.md`.
Voice/Telnyx go-live ops detail + incident recovery: `docs/RUNBOOK.md` §7.

---

## 🔴 P0 — Launch blockers (clear before the first paying customer)

Ordered: the product must answer + transfer + book on a real call, then take money,
then be gated/insured. Most of this is your action, not code — the code is shipped.

### 1. Voice path — make a real call work end-to-end

_Post-live voice enhancements (recording disclaimer, etc.) live in **🎙️ Voice — Phase 2** at the bottom of this file._

- [ ] **(Dale)** Enable **call transfer / REFER** on the Telnyx SIP Connection (`livekit-outbound`). Until then `transfer_call` fails at runtime and the agent silently degrades to taking a message. (Detail: `docs/RUNBOOK.md` §7c.)
- [ ] **(Dale)** Set the **forward number** on the dashboard AI Persona → "Forward Calls to a Person" (your cell `+1 608 217 5303`). NULL = agent takes a message instead of transferring.
- [ ] **(Dale)** Confirm `TELNYX_API_KEY` + `TELNYX_SIP_CONNECTION_ID` are set on Railway (currently local `.env` only) — else blocked-caller-ID OTP + provisioning 503. Also confirm `TELNYX_PHONE_NUMBER=+16308229086`.
- [ ] **(Dale, blocked on a 2nd phone)** **Live validation call** from a different carrier → `+1 630-822-9086`: (a) booking lands in `appointments` for tenant `d5e3c6a1` inside a real shift window; (b) "talk to a person" rings your cell + the Calls tab shows the transcript; (c) confirm natural dialog — asks preferred time, widens when none fit, never imposes a slot, recalls preferences across calls. (PSTN inbound itself already confirmed 2026-06-30; this closes the booking + transfer + preference legs.)

### 2. Billing — be able to take money

- [ ] **(Dale)** **Stripe test-mode round-trip** (`stripe listen`, no real money): checkout → webhook signature verifies → `checkout.session.completed` activates the tenant gate → `invoice.payment_failed` handled → `customer.subscription.deleted` revokes → plan gating (Solo/Growth/Pro) enforces. Set the 5 Stripe env vars on Railway (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SOLO/GROWTH/PRO_PRICE_ID`) + register the webhook at `/billing/webhook` (3 events). (`./scripts/simulate.sh stripe` path-checks the wiring; the live round-trip needs real keys + the CLI.)
- [ ] **(Dale)** **Stripe Tax**: enable Stripe Tax in the dashboard, register nexus (IL + customer states), set `STRIPE_AUTO_TAX=true` on Railway. (Code done — `automatic_tax` gated behind the flag.)

### 3. Deploy gate — protect main

- [ ] **(Dale)** Enable the **"Wait for CI"** toggle on the 3 Railway services (branch protection already blocks red merges; this closes the deploy-side gap).
- [ ] **(Dale, code)** **Prove the gate** end-to-end: open a deliberate-fail PR → confirm it's blocked → fix → confirm green unblocks.

### 4. Security housekeeping

- [ ] **(Dale)** **Rotate the Railway team token** created 2026-06-12 — it was pasted into a Claude session. Burn + reissue.

### 5. Legal / business (long lead time — start early)

- [ ] **(Dale)** Open an **LLC bank account** for Thinking Hammer LLC (required before Stripe payouts).
- [ ] **(Dale)** Publish + link **legal docs** — Bonterms SaaS ToS + Privacy Policy + DPA (free, lawyer-drafted).
- [ ] **(Dale)** Add **TCPA-compliant SMS opt-in** consent language at booking time — required before any confirmation texts.
- [ ] **(Dale)** **E&O insurance** before the first paying customer (~$800–1,200/yr; Next/Hiscox).
- [ ] **(Dale)** **Cyber Liability insurance** before the first paying customer (often bundled with E&O).

---

## 🟠 Legal-hold — built, DO NOT merge/enable without sign-off

Both erase PII irreversibly (kill-switched off / inert until enabled). Branches deleted in the 2026-06-23 cleanup; restorable from the PR pages.

- [ ] **(blocked — legal)** **PR #68** — `POST /customers/:id/purge` owner-gated single-customer GDPR/CCPA erasure (typed phone confirmation, atomic anonymize-in-place + audit_log PII redact, kill-switch `ENABLE_CUSTOMER_PURGE`; 8 tests).
- [ ] **(blocked — legal)** **PR #69** — disabled-by-default automated retention/purge worker (`ENABLE_RETENTION_WORKER` + explicit `RETENTION_DAYS`, no default window, per-tenant-failure-isolated; 9 tests). Broader-PII scope (`voice_sessions`/transcripts/appointment descriptions) is a deliberate follow-up.

---

## 🟡 P1 — Customer success & trust (non-blocking, do after P0)

- [ ] **(Dale)** Verify **reminder delivery stats** in prod once Telnyx creds are confirmed on Railway.
- [ ] **(Dale/code)** **Pricing tiers (Pro/Enterprise)** positioning.

### Optional integrations — turn on per business need (code complete, need creds + a live round-trip)

- [ ] **(Dale)** **Google Calendar** — `GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL` + GCP OAuth app; prove a real round-trip via `calendarSync.ts` + `SYNC_TEST_RECORDER`.
- [ ] **(Dale)** **Outlook Calendar** — `OUTLOOK_CLIENT_ID/SECRET/CALLBACK_URL` + Azure app.
- [ ] **(Dale)** **Square CRM** — `SQUARE_CLIENT_ID/SECRET/CALLBACK_URL` + `SQUARE_WEBHOOK_SIGNATURE_KEY` + provider OAuth app (code no-ops safely until set).

---

## 🟢 P2 — Quality, scale & ops visibility

- [ ] **(Dale/code)** _(Optional)_ Repoint Railway `healthcheckPath` → `/ready` to gate deploy **promotion** on DB reachability (behavior change — could block promotion during a DB blip; your call).
- [ ] **(code)** **Alert rules** (optional, free) — PromQL rules are written + ready in `docs/ALERTS.md` (error-rate, http-5xx, p95, booking-failure, pool-waiting). Wire them off the free `/metrics` + `/ready` signals (Grafana Cloud free tier or Railway-native) if/when a paging path is stood up. Low priority. (Paid vendors Sentry/Better Stack were **declined** 2026-07-02 — code keeps the no-op hooks.)
- [ ] **(code)** **Website-scan re-scan scheduler** — periodic re-scan of stale KB. Deferred: needs a `last_scanned` column/migration + is a cost/product call.

---

## 🔵 P3 — Moat & expansion (deferred until a customer asks — build principle: no integrations on spec)

- [ ] **Square CRM deeper reads** — pull open jobs into voice context; real external OAuth + Stripe + live CRM round-trips in CI (recorder-only today).
- [ ] **Extended self-service** — public portal/login (manage all appointments); waitlist / callback-queue tool; no-show auto-marking + auto-rebook.
- [ ] **Voice enhancements** — post-call "how did we do?" SMS/NPS link; multi-language; real-time owner listen-in / barge.
- [ ] **Product expansion** — booking widget/embed; granular RBAC beyond owner/front_desk; white-label / reseller theming; public API; PDF + analytics export (CSV export shipped #189); SSO/SAML; international numbers (US-centric today); multi-DID per tenant.
- [ ] **Schedule sub-view consolidation (C1+C2)** — merge the 4 scheduler sub-views (calendar/staff/resources/list) → 2 (calendar Day/Month + Team/Resources) with one unified header. `dashboard/components/SchedulerView.tsx`. (large/UX; from the former IMPROVEMENT_IDEAS.) **Open — needs a UX design pass with Dale before build** (it changes the scheduler layout; brainstorm the target shape first).
- [ ] **Threaded demo mode (E1)** — replace the static `/demo` page with a session flag (`isDemoMode`) injecting read-only sample data into the live dashboard shell (stays in sync with real UI automatically). (large.)
- [ ] **Future CRM/platform candidates** (build-deferred per the `docs/STRATEGY.md` vendor heuristic — "how does this vendor make money?") — QuickBooks/Xero, Toast, Apple Calendar (safe infra/transaction partners); Microsoft Teams (notify-only); Vagaro/Mindbody, Acuity/Calendly (competitor-ish → shallow read or import-only).

---

## 🎨 UX backlog (separate workstream — `/ux-expert` audits)

- [ ] **(Dale — BLOCKER)** Review live scheduling **coloring/grading** so Cluster A neutral-language work can proceed (de-grade slices were reverted 2026-05-20; do not re-apply unprompted).
- [ ] **Cluster A — neutral-language / no-grading** (8 surfaces, blocked on the Dale review): `StepReview`, `SkillRelationshipMap`/`SkillMapNode`, `ResourceColumnsView`, `AppointmentListView`, `EmployeeDayFocusPanel`, `AnalyticsView`, `AppointmentDetailPanel`. (Violates the "no percentage/letter grading" product rule.)
- [ ] **Wizard Phase B** — ⏸️ **HELD 2026-07-05 (recommend NOT building yet).** Full draft-commit model: hold services/resources/employees/shifts/mappings in local state, pre-fill from the matching YAML template, commit to DB only on Step-7 Done, discard on dismiss. ~5K-line infra across `useWizardCrud.ts` + every `Step*.tsx`; needs `VocabularyProvider` to accept an `overrideTemplate`. Preserve the auto-seed-rollback contract in `SetupWizard.backToPicker.test.tsx`. **Why held:** the live-DB flow already works, Phase A fixed the visible re-pick bug, and the rewrite forces a temp-id→real-id layer + commit/rollback engine + a **backend coverage-dry-run contract change** (Step-6 coverage is a server RPC over DB rows that won't exist in draft mode) + duplicating it all into SoloWizard — high risk to core onboarding for a UX-purity gain no customer has asked for (cuts against YAGNI / "working flat beats a dormant abstraction"). If revived, use a backend dry-run endpoint for coverage. (Was also the last open `/improve` proposal + IMPROVEMENT_IDEAS P2.5.)
- [ ] **Dense-view decomposition** — track, don't piecemeal: `SettingsView`, `TenantEditPanel`, `CRMView`, `AppointmentView`, `DashboardHome`, `CustomerDetailPanel`, scheduler orchestration, `ShiftManagementView`, `ServiceAssignmentView`/`SkillAssignmentsView`/`SkillMatrixView`. Split each overloaded view into focused sub-components (no file over ~300 lines); sequence with C1+C2 to avoid duplicated churn.
  - _First slice DONE 2026-07-05 (PR #201):_ `VoiceCallsView` 1185→711, extracted `components/voice/` (`callFormatters`, `outcome`, `CallRows`, `MessagesInbox` — each <300 lines; also closed a swallowed-failure defect in the inbox). **Remaining largest targets:** `KnowledgeBaseView` (1143), `AnalyticsView` (970), `ShiftManagementView` (960), `DashboardHome` (838), `ServiceAssignmentView` (816). (`NewSchedulerView` 1582 — do with C1+C2.)

### Un-audited surfaces — `[REVIEW]` before beta

Each screen below has had NO dedicated UX review (owner-judgment items). Most already had a copy/a11y **partial fix** landed 2026-07-03, plus a **correctness/a11y defect batch 2026-07-05 (PR #200)** — swallowed server-failures (Shift/Resource/Employee/SuperAdmin/BusinessSettings handlers), a cross-tenant config-leak in AIConfigView, and dead controls (details in git / RESOLVED). What remains on each is the **owner-judgment layout/flow call**.

- [ ] **[REVIEW]** `AIConfigView` — "Voice Settings"; raw system-prompt ("the Brain") exposed to non-technical owners; dirty-save `warning` variant.
- [ ] **[REVIEW]** `AnalyticsView` — full layout, empty states, date-range controls, metric usefulness; no-show/"abandoned" semantics.
- [ ] **[REVIEW]** `VoiceCallsView` — list layout, transcript/summary rendering (badges/filters/vocab already aligned + a11y done).
- [ ] **[REVIEW]** `AppointmentView` + `AppointmentDetailPanel` + `AppointmentListSidebar` — 3-panel/high-density flow, mobile, status-change communication.
- [ ] **[REVIEW]** `CRMView` + `CustomerDetailPanel` — search UX, how AI call summaries surface.
- [ ] **[REVIEW]** `ProfileView` — password-change discoverability, "My Profile" vs "Business Settings" boundary.
- [ ] **[REVIEW]** `BusinessSettingsView` — what belongs here vs Setup / AI Persona.
- [ ] **[REVIEW]** `SettingsView` — owner vs super-admin split, overlap with BusinessSettingsView.
- [ ] **[REVIEW]** `EmployeeManagementView` — per-card skill-assignment model, deactivated-staff surfacing.
- [ ] **[REVIEW]** `ShiftManagementView` — team-size-conditional paths, copy-week discoverability.
- [ ] **[REVIEW]** `ResourceManagerView` — zero-resource empty state, mapping-checkbox model, "capabilities" meaning.
- [ ] **[REVIEW]** `ServiceAssignmentView` — is the 3-step wizard right, no-assignment case, cancel/exit flow.
- [ ] **[REVIEW]** `SkillMatrixView` + `SkillAssignmentsView` + `SkillRelationshipMap` — grid legibility at scale, does the map earn its keep, both-views-necessary.
- [ ] **[REVIEW]** `DeletedRecordsPanel` + `RecordHistoryModal` — discoverability, restore/copy-fields flow, version-history comprehensibility (copy-target is customers-only today).
- [ ] **[REVIEW]** `/register` — field order, post-signup first-run experience.
- [ ] **[REVIEW]** `LoginView` + `/forgot-password` + `/reset-password` — forgot→email→reset live proof, error-copy quality, mobile.
- [ ] **[REVIEW]** `SuperAdminDashboard` + `TenantCard`/`TenantCreateForm`/`TenantEditPanel` — admin-interface usability / onboarding friction (Dale-facing).
- [ ] **[REVIEW]** `FirstRunTour` — post-wizard overlay tour content/flow/copy (behavior already correct).

---

## 🧹 Doc hygiene (mechanical, ongoing — low priority)

- [ ] Continue count-drift passes (route modules / migrations / test numbers) after any new route or migration; keep secondary docs synced.
- [ ] Trim remaining historical narrative from active docs into `RESOLVED.md` when it goes cold.

---

## 🎙️ Voice — Phase 2 (after live, needs agent code + redeploy)

- [ ] Recording disclaimer → deterministic verbatim greeting (Illinois 2-party consent). Needs a `tenants.greeting` column + tenant-config route + `agent/src/index.ts` greeting line (currently hardcoded).
- [x] ~~`get_my_appointments` transfer-fallback string~~ — DONE 2026-07-05 (PR #198): the no-caller-ID fallbacks in `get_my_appointments`/cancel/reschedule now capability-gate the transfer offer (offer a message only when transfer is unwired).
