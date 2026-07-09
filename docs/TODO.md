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

- [x] **(Dale)** Enable **call transfer / REFER** on the Telnyx SIP Connection (`livekit-outbound`). ~~Until then `transfer_call` fails at runtime and the agent silently degrades to taking a message.~~ **RESOLVED 2026-07-07**: No toggle exists in Telnyx UI — FQDN connections support SIP REFER by default. Nothing to configure.
- [ ] **(Dale)** Confirm `TELNYX_API_KEY` + `TELNYX_SIP_CONNECTION_ID` are set on Railway (currently local `.env` only) — else blocked-caller-ID OTP + provisioning 503. Also confirm `TELNYX_PHONE_NUMBER=+16308229086`.
- [ ] **(Dale, use wife's phone)** **Live validation call** — do these steps together in one sitting:
  1. Set the **forward number** on the dashboard AI Persona → "Forward Calls to a Person" (`+1 608 217 5303`) before calling.
  2. Have wife call `+1 630-822-9086` (must use her phone — can't call from your cell and forward to it).
  3. Validate booking: appointment lands in `appointments` for tenant `d5e3c6a1` inside a real shift window.
  4. Validate transfer: say "talk to a person" → your cell rings + Calls tab shows the transcript.
  5. Validate dialog: agent asks preferred time, widens when none fit, never imposes a slot, recalls preferences across calls.
     (PSTN inbound itself already confirmed 2026-06-30; this closes the booking + transfer + preference legs.)

### 2. Billing — be able to take money

- [ ] **(Dale)** **Decide final tier pricing** before creating Stripe products — current placeholders ($129/$279) have not been validated. Research findings + cost model (2026-07-07):
  - **Variable cost per call (5-min avg):** Telnyx ~$0.03 + LiveKit ~$0.02–0.05 + Deepgram $0.02 + OpenAI LLM ~$0.001 + OpenAI TTS ~$0.02–0.09 = **~$0.09–0.17/call**
  - **Loss point:** an uncapped Solo tier at 1,000 calls costs $90–170 in variable cost alone — near-zero or negative margin at $129/mo
  - **Recommended Solo cap: ~300–400 calls/month** → variable cost ~$27–51, gross margin ~$78–102 on $129/mo
  - **Competitor benchmarks (verified July 2026):** Rosie AI $49/$149/$299 (250/1,000/2,000 min); Goodcall $79/$129/$249/agent (100/250/500 unique customers/mo); Signpost $199/$399/$749 (AI-only → hybrid human+AI)
  - **Key differentiator to keep:** include booking + call transfer at ALL tiers — competitors (Rosie, Goodcall) gate these to mid-tier. Lead with "full receptionist from day one."
  - **Suggested tier shape:** Solo ~$99–129/mo (1 location, ~300 calls/mo cap, full booking+transfer) · Growth ~$199–249/mo (multi-location or higher volume, Square CRM sync, analytics) · Pro ~$349+/mo (unlimited volume, priority support)
  - **Volume metering is NOT built yet** — tiers are flat subscriptions today; cap enforcement + usage meter is a P1 build item (see P2 section below). Go flat-rate for first customer, retrofit volume once real usage data exists.
- [ ] **(Dale)** **Stripe setup** — do these in order:
  1. **Open an LLC bank account** for Thinking Hammer LLC — required before Stripe can pay out. (Also listed under Legal §5 below.)
  2. **Connect bank account to Stripe** — add it in Stripe dashboard → Settings → Bank accounts & scheduling.
  3. **Create products + prices** in Stripe dashboard — Solo, Growth, Pro plans. Note the 3 price IDs.
  4. **Set 5 env vars on Railway**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SOLO_PRICE_ID`, `STRIPE_GROWTH_PRICE_ID`, `STRIPE_PRO_PRICE_ID`.
  5. **Register the webhook** in Stripe dashboard → `https://ai-sec-production.up.railway.app/billing/webhook` for 3 events: `checkout.session.completed`, `invoice.payment_failed`, `customer.subscription.deleted`.
  6. **Test-mode round-trip** (no real money): run `stripe listen --forward-to https://ai-sec-production.up.railway.app/billing/webhook`, trigger a test checkout, verify each event activates/revokes the tenant gate. (`./scripts/simulate.sh stripe` path-checks the wiring first.)
- [ ] **(Dale)** **Stripe Tax** (after round-trip verified): enable Stripe Tax in Stripe dashboard → Tax → Settings; register nexus for IL + customer states; set `STRIPE_AUTO_TAX=true` on Railway. (Code done — `automatic_tax` gated behind the flag.)

### 3. Deploy gate — protect main

- [x] ~~**(Dale)** Enable the **"Wait for CI"** toggle on the 3 Railway services~~ — **DONE 2026-07-09.** Enabled on all 3 (`ai-sec`, `ai-sec-agent`, `dashboard`) at Railway → Service → Settings → Source → "Wait for CI" ("Trigger deployments after all GitHub actions have completed successfully"). Railway stages settings edits — they only take effect after clicking **Deploy** on the "Apply N changes" banner. The Railway GitHub App already held `checks` + `commit statuses` read/write on all repos, so no permission grant was needed.
  - **Caveat:** this is **unversioned dashboard state** — `railway.json` has no field for it. If a service is ever recreated the toggle silently reverts, and nothing in the repo will tell you. Re-check after any service recreation.
  - **Caveat:** the setting waits on *all* GitHub Actions on the commit, not on the branch-protection required-checks list. Any future workflow that runs on `main` and can fail will also block deploys.
- [x] ~~**(Dale, code)** **Prove the gate** end-to-end~~ — **PROVEN 2026-07-09 (PR #227).** A deliberately-failing test made `Backend` red → `mergeStateStatus: BLOCKED` → `gh pr merge` **refused** with `the base branch policy prohibits the merge`. Deleting the test flipped all 4 checks green → `CLEAN` → merge allowed. Branch protection holds.
  - **Not tested, deliberately:** `gh pr merge --admin`. If `enforce_admins` didn't hold, that would merge a failing test to `main` and deploy broken code to Railway. The API reports `enforce_admins: true` — verified-by-config, not by experiment.
  - **This proves the MERGE gate only.** The **deploy** gate is still open: after #226 merged, Railway brought up the new backend at `19:27:03Z` while CI didn't go green until `19:31:27Z` — prod deployed ~4 min *ahead* of its checks. That is exactly what the "Wait for CI" toggle above closes. Branch protection stops a red PR from merging; nothing yet stops a merged commit from deploying before CI confirms it.

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

- [x] ~~**`/demo/start` per-IP limiter is a global bucket**~~ — **investigated 2026-07-08, NOT a bug.** A controlled 16-min quiet-window test returned 200, so the window resets normally; the persistent 429s were self-inflicted test traffic. A spoofed `X-Forwarded-For` has no effect because Railway overwrites it with the true client IP (correct, non-spoofable). No action.
- [x] ~~**(code)** **Telnyx webhook verifies a re-stringified body.**~~ **FIXED 2026-07-09.** `/communications/telnyx/status` now HMACs `req.rawBody` (the exact received bytes), like `billing.ts`/`square.ts`. Signature verification was also moved **before** payload parsing — previously an unsigned caller reached the parse path and the route's safety rested on the id/status guard firing first (the parser synthesizes `{}` for an empty body). Compare is now `timingSafeEqual`. The old happy-path test hardcoded `JSON.stringify(payload)` as the signed bytes, so it could never see the bug; replaced with a regression test that signs raw bytes whose key order + whitespace `JSON.stringify` would not reproduce (asserted non-equal, so the test has teeth — verified failing against the old code).
- [x] ~~**(code)** **`npm run prepare-commit` reports a false failure.**~~ **FIXED 2026-07-09.** Two independent causes, both of which kept the gate red on a pristine `main`:
  1. `run_or_skip` eval'd each configured command in the parent shell, so the `cd dashboard` chained into `checks`/`unitTests` leaked out and stranded every later step in the wrong directory (`Missing script: "verify:claude-md"`). Each command now runs in a subshell — `if (eval "$cmd")`.
  2. Step 4's `focusedTestScan` regex was `(\.only\(|\.skip\()`, which flagged every **conditional** skip (`test.skip(process.env.FOO !== '1', …)`, `ctx.skip()`) as if it were a focused test — 12 legitimate guards, so the step could never pass. Extracted to `scripts/focused-test-scan.sh`, which flags only `.only(` and skips/todos whose first argument is a **string literal** (i.e. a test disabled by name = dead code). Verified: silent on the clean tree, and still catches an injected `describe.only(...)` / `it.skip('name', …)`.
- [x] ~~**(code)** **Dashboard vitest exits nonzero with 0 failing tests.**~~ **FIXED 2026-07-09.** Surfaced by the now-working `prepare-commit` gate: `Tests 1012 passed` + `Errors 2 errors`. `useEntityList` / `useServiceMappings` in `dashboard/lib/hooks.ts` fetched from an effect with no cancellation, so an unmount mid-flight ran `setLoading(false)` after vitest tore down jsdom → React read a dead `window` → unhandled rejection. Only reproduced under full-suite load. Fixed with a `useIsMounted()` guard on every post-`await` setter; 5 regression tests in `dashboard/lib/hooks.test.tsx` that simulate teardown by deleting `globalThis.window` (verified failing without the guard). Lesson recorded in `docs/LESSONS_LEARNED.md`.
- [ ] **(Dale)** Verify **reminder delivery stats** in prod once Telnyx creds are confirmed on Railway.
- [ ] **(Dale/code)** **Pricing tiers (Pro/Enterprise)** positioning.

### Optional integrations — turn on per business need (code complete, need creds + a live round-trip)

- [ ] **(Dale)** **Google Calendar** — `GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL` + GCP OAuth app; prove a real round-trip via `calendarSync.ts` + `SYNC_TEST_RECORDER`.
- [ ] **(Dale)** **Outlook Calendar** — `OUTLOOK_CLIENT_ID/SECRET/CALLBACK_URL` + Azure app.
- [ ] **(Dale)** **Square CRM** — `SQUARE_CLIENT_ID/SECRET/CALLBACK_URL` + `SQUARE_WEBHOOK_SIGNATURE_KEY` + provider OAuth app (code no-ops safely until set).

---

## 🟢 P2 — Quality, scale & ops visibility

- [ ] **(code)** **Volume metering + tier cap enforcement** — do after first customer, once real usage data sets the bands. Data already exists (`voice_sessions` per tenant per month). Build: (1) monthly call counter endpoint; (2) per-plan limit config (Solo ~300–400 calls, Growth ~1,000, Pro unlimited); (3) dashboard usage meter + 80% warning banner; (4) soft cap enforcement. No Stripe Metered Billing needed — flat bands with a DB query. See pricing notes in §2 Billing above.
- [ ] **(Dale/code)** _(Optional)_ Repoint Railway `healthcheckPath` → `/ready` to gate deploy **promotion** on DB reachability (behavior change — could block promotion during a DB blip; your call).
- [ ] **(Dale)** **Alert rules** (optional, free) — PromQL rules + scrape config are fully written in `docs/ALERTS.md`. Code side is done. Remaining action: stand up a monitoring destination (Grafana Cloud free tier scraping `/metrics`, or set `BETTER_STACK_TOKEN` for log-pattern alerts — §4 of ALERTS.md). Nothing to code until a destination is chosen. (Paid vendors Sentry/Better Stack were **declined** 2026-07-02 — code keeps the no-op hooks.)
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
- [x] ~~**Wizard Phase B**~~ — reversed from "held" and **shipped 2026-07-05/06** (PRs #204–#208): draft-commit `SetupWizard` + `GoLivePanel` + E2E coverage, merged to main, no prod migration needed. Full writeup + lessons in `docs/RESOLVED.md`.
- [ ] **Wizard Phase B follow-ups** (explicitly deferred in the design doc, not bugs): abandoned-test-number reaper (a `phone_status='active'` DID with no `forwarded_from_phone` and no recent `voice_sessions`) — queryable, not built; auto forwarding-verification heuristic (SIP caller-ID match instead of asking the owner) — named, not built; real Telnyx porting API integration — deferred until a real port customer per YAGNI.
- [ ] **Dense-view decomposition** — track, don't piecemeal: `SettingsView`, `TenantEditPanel`, `CRMView`, `AppointmentView`, `DashboardHome`, `CustomerDetailPanel`, scheduler orchestration, `ShiftManagementView`, `ServiceAssignmentView`/`SkillAssignmentsView`/`SkillMatrixView`. Split each overloaded view into focused sub-components (no file over ~300 lines); sequence with C1+C2 to avoid duplicated churn.
  - _First slice DONE 2026-07-05 (PR #201):_ `VoiceCallsView` 1185→711, extracted `components/voice/` (`callFormatters`, `outcome`, `CallRows`, `MessagesInbox` — each <300 lines; also closed a swallowed-failure defect in the inbox).
  - _Second slice DONE 2026-07-06 (PR #211):_ `KnowledgeBaseView` 1143→408 (`components/knowledge/`), `AnalyticsView` 970→265 (`components/analytics/`), `ShiftManagementView` 960→402 (`components/shifts/`), `DashboardHome` 838→318 (`components/home/`), `ServiceAssignmentView` 816→395 (`components/services/`). 874 dashboard tests green.
  - _Third slice DONE 2026-07-06 (PR #212):_ `AppointmentDetailPanel` 605→248 + `CustomerDetailPanel` 606→124 + `CRMView` 719→288 + `useCustomerForm` hook; `AIConfigView` 673→240 + 5 aiconfig sub-components; `BusinessSettingsView` 612→195 + 4 settings sub-components; `TenantEditPanel` 531→255 + 2 admin sub-components; `AppointmentView` 768→300 + `AppointmentCalendar` + `useAppointmentCRUD`; `VoiceCallsView` 711→243 + `CallListPanel` + `CallDetailPanel`; `SchedulerView` 532→253 + `SchedulerToolbar` + `useSchedulerActions`. 874 dashboard tests green. (`CRMView` landed at 288 lines post-decompose — at the limit, no further split needed.)
  - _Fourth slice DONE 2026-07-07 (PR #217):_ `AnalyticsMetricsGrid` 575→69 (+ `CorePerformanceMetrics` / `EngagementRetentionMetrics` / `ServiceCohortMetrics`); `RecordHistoryModal` 636→282 (+ `VersionTimeline` + `FieldRestorePanel` + `recordHistoryHelpers`); `DeletedRecordsPanel` 455→227 (+ `DeletedRecordRow` + `CopyFieldsModal`); `EmployeeManagementView` (+ `EmployeeCard` + `EmployeeEditModal`); `ResourceManagerView` (+ `ResourceCard` + `ResourceEditModal`); `TeamAccessView` 346→232 (+ `InviteTeamMemberModal`); `BusinessTypeSection` 371→269 (+ `TemplatePreviewModal`); `OutlookLayout` 692→465 (+ `layout/TenantSwitcherDropdown` + `ProfileMenuDropdown` + `ThemeSelectorDropdown` + `MobileTabBar`); `CustomerSidebar` 335→301 (+ `crm/CustomerListItem`); `api.ts` namespaced → `Api.{resource}.{action}()`; `ToggleSwitch` shared primitive. 874/874 dashboard + 2324/2324 backend tests green.
  - _Fifth slice DONE 2026-07-07 (PR #218):_ `SkillMatrixView` 334→212 (+ `skills/SkillMatrix`). Also: 55 new dashboard tests for coverage hotspots (ThemeContext, VocabularyContext, TimeInput, logger, Toast, FeedbackButton) — 874→929 dashboard tests.
  - _Coverage batch 2 DONE 2026-07-07 (PR #219):_ 81 new dashboard tests targeting 0%-coverage views — `coverage.ts`, `VersionBadge`, `SkillManagementView`, `BillingView`, `KnowledgeSuggestions`, `MessagesInbox`, `CRMIntegrationCard` — 929→1010 dashboard tests. **Remaining:** `NewSchedulerView` (1582 — do with C1+C2 scheduler consolidation); other over-300 files are unavoidable coordination code (wizard state machines, layout shell, GoLivePanel).

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
