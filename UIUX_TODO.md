# UIUX_TODO

> Single prioritized UI/UX action list. Sources: `/ux-audit` 2026-05-28, `/ux-expert` simplification + KB + landing reviews 2026-05-28, `docs/TODO.md` backlog, `ux-review-notes.md`, `docs/UI_UX_DESIGN.md`.
> Reference audit report: `scripts/ux-audit/reports/2026-05-28T0853/ux-audit.html`
> Legend: effort `[S]` <2h · `[M]` half-day · `[L]` >1 day

---

## P0 — Critical (fix before next beta customer)

### Onboarding & Wizard

- [ ] **[P0][M]** Add "What do callers ask?" step to setup wizard — between Step 6 Review and Step 7 Go Live; show 5–8 starter questions (hours, location, top service + price, cancellation, walk-ins); skip option available; saves to `policy-questionnaire` RAG table; full 40-question screen stays in Phone Assistant tab — `dashboard/components/SetupWizard/index.tsx` `dashboard/components/SetupWizard/SoloWizard.tsx` `dashboard/lib/policyQuestions.ts` — _source: KB placement advice_
- [ ] **[P0][M]** Add "AI Receptionist live/not live" status card on Home — owners have no signal whether phone is active after completing wizard — `dashboard/components/DashboardHome.tsx:141` `dashboard/components/SetupWizard/Step7GoLive.tsx` — _source: audit #1_
- [x] **[P0][S]** `SetupProgressPill` hidden on mobile — removed `hidden` class; pill now visible on all screen sizes — DONE 2026-05-28

### Navigation & IA

- [ ] **[P0][L]** Merge "My Business" + "My Team" + "Business Settings" into one "Setup" tab — three separate destinations for the same user question ("where do I configure my business?") is the single biggest confusion source for new owners — `dashboard/components/OutlookLayout.tsx` `dashboard/components/MyBusinessView.tsx` `dashboard/components/MyTeamView.tsx` `dashboard/components/BusinessSettingsView.tsx` — _source: /ux-expert simplification review_
- [x] **[P0][S]** Remove the 4 Quick Action cards from Home — duplicate nav, removed — DONE 2026-05-28

### Knowledge Base (before KB work starts)

- [x] **[P0][S]** Rename "Policy Questionnaire" → "Teach Your AI" — DONE 2026-05-28
- [x] **[P0][S]** Rename "Knowledge Base" heading → "What Your AI Knows" + "All Entries" → "Review Everything" — DONE 2026-05-28
- [x] **[P0][S]** KB: first accordion open by default + "Start here" banner for 0-entry users — DONE 2026-05-28

### Landing Page (before any customer sees it)

- [x] **[P0][S]** Landing demo link → replaced with "Call (630) 937-9478 — try it live" `tel:` link — DONE 2026-05-28
- [x] **[P0][S]** Enterprise Gmail → `sales@secretaryhq.com` — DONE 2026-05-28
- [x] **[P0][M]** Mobile nav hamburger added to landing page — hamburger button with CSS animate-to-X; dropdown reveals How It Works / Features / Pricing / Industries + CTAs; closes on anchor click — DONE 2026-05-28

### WCAG Accessibility

- [ ] **[P0][L]** Replace all `text-[10px]` informational text with `text-xs` (12px) — WCAG 2.1 AA minimum; 10px fails at normal browser zoom — `dashboard/components/DashboardHome.tsx:426,685,707,716` `dashboard/components/ShiftManagementView.tsx:347,472` `dashboard/components/ServiceAssignmentView.tsx:390,437` `dashboard/components/BusinessTypeSection.tsx:162,231` `dashboard/components/scheduler/NewSchedulerView.tsx` — _source: audit #2_

---

## P1 — High (high-impact, mostly small work)

### Knowledge Base — Quick Wins

- [x] **[P1][S]** KB: open first accordion by default — DONE 2026-05-28
- [x] **[P1][S]** KB: add progress bar to questionnaire — DONE 2026-05-28
- [x] **[P1][S]** KB: "Ingested X chunks" → plain English success message — DONE 2026-05-28
- [x] **[P1][S]** KB: rename "All Entries" → "Review Everything" — DONE 2026-05-28
- [x] **[P1][S]** KB: delete button opacity-40 always visible + min 44px touch target — DONE 2026-05-28
- [x] **[P1][S]** KB: upload helper text jargon replaced with plain English — DONE 2026-05-28
- [x] **[P1][S]** KB: 10-char minimum → 2 chars — DONE 2026-05-28

### Terminology Renames (cheap, high clarity)

- [x] **[P1][S]** Rename "AI Persona Tuning" → "Voice Settings" — DONE 2026-05-28
- [x] **[P1][S]** Rename "Service Assignments" → "Who Can Do What" + "Logins" → "Team Access" in sub-tab labels — DONE 2026-05-28
- [x] **[P1][S]** Update WizardWelcome copy — removed inaccurate "10 minutes / 6 quick questions" — DONE 2026-05-28

### Navigation & IA

- [ ] **[P1][S]** Move "Logins" (now "Team Access") sub-tab out of My Team → Settings/Profile — label renamed but tab still in My Team; full move deferred until IA merge — `dashboard/components/MyTeamView.tsx:79` `dashboard/components/TeamAccessView.tsx`
- [ ] **[P1][M]** Remove duplicate services section from Business Settings — services appear in BOTH My Business and Business Settings; same data, two surfaces creates doubt; keep only in My Business — `dashboard/components/BusinessSettingsView.tsx` `dashboard/components/MyBusinessView.tsx` — _source: /ux-expert simplification review_
- [ ] **[P1][M]** Solo operator "Working Days" uses a full team timeline — a baker/solo stylist should see a simple 7-row Mon–Sun form, not a scrollable timeline with zoom controls; add solo/small-team simplified path — `dashboard/components/ShiftManagementView.tsx` — _source: /ux-expert simplification review_

### Landing Page Copy

- [x] **[P1][S]** Unify CTA phrasing → "Start free trial" everywhere — DONE 2026-05-28
- [x] **[P1][S]** Replace hero stats pricing ($129) with "14 days free trial" — DONE 2026-05-28
- [x] **[P1][S]** Demo link replaced with live phone number CTA — DONE 2026-05-28

### Blocked

- [ ] **[P1]** **BLOCKED ON DALE REVIEW** Cluster A — neutral-language / no-grading across 8 surfaces: replace green/yellow/red threshold colors + grading copy with neutral factual states — see `docs/TODO.md:109` and memory `feedback-no-coverage-grading`. Do not re-apply unprompted. — _source: docs/TODO.md Cluster A_

---

## P2 — Medium (meaningful polish, each is one PR)

### Dashboard Home

- [ ] **[P2][M]** Replace "This Week" 7-column mini-calendar with "next 3 days" row — 7 compressed 80px columns with truncated content is dense but low-utility; 3 wider columns with readable text gives more value — `dashboard/components/DashboardHome.tsx:466-475` — _source: /ux-expert simplification review_
- [ ] **[P2][S]** Shrink greeting section — "Good morning, Dale" + full date occupies the highest F-pattern position on a screen opened 40×/day; reduce to first name + day only, or shift appointment count to lead — `dashboard/components/DashboardHome.tsx:215-225` — _source: /ux-expert simplification review_

### Knowledge Base

- [ ] **[P2][M]** KB: add completion milestone when questionnaire is 40/40 — nothing happens when finished; show "Your AI is fully trained" with next step (activate phone number) — `dashboard/components/KnowledgeBaseView.tsx` — _source: KB review #12_
- [ ] **[P2][M]** KB: promote Custom Questions section — buried below 9 closed accordions; most owners won't scroll to find it; move to visible card near top or add floating "Add a custom question" button — `dashboard/components/KnowledgeBaseView.tsx:678` — _source: KB review #13_
- [ ] **[P2][M]** KB: Documents tab should list already-uploaded files — currently only shows upload zone; owner who uploaded 3 PDFs last week must go to "All Entries" to see them; show filename + date + delete button in this tab — `dashboard/components/KnowledgeBaseView.tsx:687-728` — _source: KB review #14_
- [ ] **[P2][M]** KB: rename auto-shop-biased categories to business-neutral language — "Warranties & Guarantees" and "Preparation & What to Expect" don't fit bakery/salon/HVAC; rename to "Your Guarantee" / "Before and After" or filter by business type — `dashboard/lib/policyQuestions.ts:8-18` — _source: KB review #10_

### Navigation & IA

- [ ] **[P2][M]** Schedule: demote "Lines" and "List" views to overflow dropdown — Staff 60% / Calendar 20% / Lines 15% / List 5% usage; all four shown equally misleads new users; keep Staff + Calendar primary — `dashboard/components/SchedulerView.tsx` — _source: /ux-expert simplification review_
- [ ] **[P2][M]** Move calendar + CRM integrations to a distinct "Connections" section — currently buried: profile icon → Business Settings → scroll; integrations are a different concept from business configuration — `dashboard/components/BusinessSettingsView.tsx` — _source: /ux-expert simplification review_
- [ ] **[P2][M]** Add cross-link from wizard Step 7 "Go Live" directly to Phone Assistant AI config — new users look in "My Business" first; the handoff from wizard to ongoing config needs a signpost — `dashboard/components/SetupWizard/Step7GoLive.tsx` `dashboard/components/OutlookLayout.tsx` — _source: audit #N1_

### Accessibility & Interaction

- [ ] **[P2][M]** Cluster C — migrate custom overlays onto shared Modal primitive (Escape, focus trap, backdrop close): `WizardModeChooser`, `WizardWelcome`, `FirstRunTour`, `SetupWizard/index`, `AppointmentPopover`, `StaffProfileCard`, `EmployeeDayFocusPanel`, `SkillMapFixPanel` — _source: docs/TODO.md Cluster C_
- [ ] **[P2]** Cluster D — accessible action controls: replace icon-only / hover-only buttons with `aria-label` + visible focus; route destructive actions through shared confirm: `StepEmployees`, `StepServices`, `StepResources`, `SkillManagementView`, `ResourceManagerView`, `AppointmentBlock` — _source: docs/TODO.md Cluster D_
- [ ] **[P2]** Cluster E — empty/loading/no-results distinctness: `AppointmentListSidebar`, `VoiceCallsView`, `Step2Resources`, `EmployeeManagementView`, `MyTeamView`, `CustomerDetailPanel`, `DeletedRecordsPanel` — _source: docs/TODO.md Cluster E_
- [ ] **[P2][S]** Add "Dismiss all" to error toast stack when > 2 stacked — `dashboard/components/ui/Toast.tsx` — _source: audit #H4_
- [ ] **[P2]** Responsive fallbacks for wide matrices/maps: `SchedulerDateNav`, `ResourceColumnsView`, `SkillRelationshipMap` — _source: docs/TODO.md:143_

### Analytics

- [ ] **[P2][M]** Replace evaluative colors in AnalyticsView — red/amber/green return-rate framing grades the business; use neutral operational colors — `dashboard/components/AnalyticsView.tsx` — _source: audit #H6_

### UI Polish

- [ ] **[P2][S]** Add "Keyboard shortcuts" item to profile dropdown — `?` key trigger is completely undiscoverable without it — `dashboard/components/OutlookLayout.tsx:530-565` — _source: audit #10_
- [ ] **[P2][M]** Add color swatches to theme selector — 8 themes listed by name only; picking requires trial and error — `dashboard/components/OutlookLayout.tsx:330-350` — _source: audit #H5_
- [ ] **[P2]** Dense-view chunking: `SettingsView` (split owner vs super-admin), `TenantEditPanel` (provisioning vs AI-config), `CRMView`, `AppointmentView`, `CustomerDetailPanel`, `ShiftManagementView` changed-vs-saved — sequence with C1+C2 — _source: docs/TODO.md:142_

### Landing Page

- [ ] **[P2][S]** Add annual pricing toggle — monthly-only pricing feels less committed; "Save 20% annually" toggle increases perceived value — `dashboard/app/page.tsx:764-835` — _source: landing review #6_
- [ ] **[P2][S]** Remove duplicate "Smart Booking" feature card — it and "Every Booking, Double-Checked" say the same thing; the wide checklist card is better; cut the standalone one — `dashboard/app/page.tsx:712-716` — _source: landing review #10_
- [ ] **[P2][S]** Rename "Built for" bar — "Auto Shops / Hair Salons" mimics a "trusted by" logo bar but isn't; rename to "Works great for:" — `dashboard/app/page.tsx:601-614` — _source: landing review #9_
- [ ] **[P2][S]** Fix footer Privacy / Terms / Contact links — all link to `#`; remove or build placeholder pages; Privacy and Terms carry legal weight — `dashboard/app/page.tsx:895-897` — _source: landing review #11_

---

## P3 — Low / Backlog

- [x] **[P1][S]** iPad: shift delete button bumped to min-h-[44px] — DONE 2026-05-28
- [ ] **[P2][S]** iPad: "Add customer" button in CRMView empty state uses `size="sm"` (40px) — just below 44px minimum; change to `size="md"` — `dashboard/components/CRMView.tsx` — _source: iPad review of completed items_
- [ ] **[P3][S]** KB: add "show unanswered only" toggle — owners finishing remaining questions must open every accordion to find them; toggle or sort unanswered categories to top — `dashboard/components/KnowledgeBaseView.tsx` — _source: KB review #16_
- [ ] **[P3][S]** Add empty-state context to Calls tab — explain calls appear once AI is live — `dashboard/components/VoiceCallsView.tsx` — _source: audit #F5_
- [ ] **[P3][M]** Migrate `FirstRunTour` to shared Modal primitive — no Escape handling or focus trap — `dashboard/components/FirstRunTour.tsx` — _source: audit #DS4_
- [ ] **[P3][M]** Self-host landing page fonts via `next/font` — `fonts.googleapis.com` is GDPR risk + Core Web Vitals hit — `dashboard/app/page.tsx` — _source: audit #DS3_
- [ ] **[P3][S]** Normalize brand name capitalization — "SECRETARY HQ" (nav/footer), "Secretary HQ" (register page); pick one — `dashboard/app/page.tsx:499,894` `dashboard/app/register/page.tsx` — _source: landing review #14_
- [ ] **[P3][S]** Verify meta title, description, favicon — missing = blank tab label + no SEO — `dashboard/app/layout.tsx` — _source: landing review #15_
- [ ] **[P3][S]** Normalize section eyebrow copy case on landing page — one section uses title case, all others uppercase — `dashboard/app/page.tsx:621` — _source: landing review #13_
- [ ] **[P3]** B4 — Reconsider sub-tab URL persistence (verify usage first) — `dashboard/app/dashboard/page.tsx` — _source: docs/TODO.md:98_
- [ ] **[P3][L]** SetupWizard Phase B — full draft-state wizard: hold all data in local state, commit only on Done, discard on dismiss — `dashboard/components/SetupWizard/useWizardCrud.ts` + all Step*.tsx — open fresh branch; coordinate with Cluster C — _source: docs/TODO.md:137_
- [ ] **[P3]** E1 — Demo mode (sample data via session flag, no real account) — `dashboard/app/demo` — _source: docs/TODO.md:99_

---

## Completed

- [x] **[P1][S]** `LoginView` missing `userRole` localStorage write — front-desk users got owner tabs — `LoginView.tsx:38` — DONE 2026-05-28
- [x] **[P1][S]** Shift delete button hover-only — invisible on iPad — `StaffSwimLaneView.tsx:417` — DONE 2026-05-28
- [x] **[P1][S]** Scheduler hour slots no `min-h-[44px]` — touch targets too small — `NewSchedulerView.tsx:1105` — DONE 2026-05-28
- [x] **[P1][S]** QuickBookPanel hardcoded `bg-white` — broke on 6 themes — `QuickBookPanel.tsx:249` — DONE 2026-05-28
- [x] **[P1][S]** EmployeeDayFocusPanel hardcoded bg + fixed `w-96` — clipped on phones — `EmployeeDayFocusPanel.tsx:53` — DONE 2026-05-28
- [x] **[P1][S]** Customers tab empty state had no CTA — `CRMView.tsx` — DONE 2026-05-28
- [x] **[P1][S]** SoloStepReview red/yellow/green coverage pills — violates no-grading rule — `SoloStepReview.tsx` — DONE 2026-05-28
- [x] **[P1][S]** QuickBook timezone label missing — `QuickBookPanel.tsx:170` — DONE 2026-05-28
- [x] **[P1][S]** CustomerCombobox hardcoded colors — broke themes — `CustomerCombobox.tsx:117` — DONE 2026-05-28
- [x] **[P1][M]** KB save indicator faded after 2s with no trace — `KnowledgeBaseView.tsx:50` — DONE 2026-05-28
- [x] **[P1][S]** Register page auto-selected first business type — `register/page.tsx` — DONE 2026-05-28
- [x] **[P1][S]** Scheduler hour label center-aligned — appeared offset from shift bar — `NewSchedulerView.tsx` — DONE 2026-05-28

---

## Pending UX Reviews (surfaces not yet audited)

These screens have had NO dedicated UX review. Each should be reviewed before shipping to beta customers.

- [ ] **[REVIEW]** `AIConfigView` — "Voice Settings" screen (system prompt textarea, first message, voice selector); raw prompt editing exposed directly to non-technical owners; textarea labeled "System Instructions (The 'Brain')" is developer language; also: save button state logic uses `warning` variant when dirty — `dashboard/components/AIConfigView.tsx`
- [ ] **[REVIEW]** `AnalyticsView` — call stats, booking rates, no-show rates; flagged in ux-review-notes.md for evaluative colors; no dedicated review of the full layout, empty states, date-range controls, or whether the metrics shown are actually useful to a tire shop owner — `dashboard/components/AnalyticsView.tsx`
- [ ] **[REVIEW]** `VoiceCallsView` — active calls + call history list/detail; no review of the list layout, outcome badge legibility, transcript/summary display, filter UX, or what "abandoned" means to an owner — `dashboard/components/VoiceCallsView.tsx`
- [ ] **[REVIEW]** `AppointmentView` + `AppointmentDetailPanel` + `AppointmentListSidebar` — the full appointment management flow (list, select, edit, cancel, reactivate); flagged in ux-review-notes.md as high-density; no full dedicated review of the 3-panel layout, mobile behavior, or how status changes are communicated — `dashboard/components/AppointmentView.tsx` `dashboard/components/AppointmentDetailPanel.tsx` `dashboard/components/AppointmentListSidebar.tsx`
- [ ] **[REVIEW]** `CRMView` + `CustomerDetailPanel` — customer list + detail panel; basic empty state added; no review of search behavior, customer history display, appointment history panel, edit flow, delete/restore flow, or how the AI's call summaries surface — `dashboard/components/CRMView.tsx` `dashboard/components/CustomerDetailPanel.tsx`
- [ ] **[REVIEW]** `ProfileView` — user's own profile (name, email, password change); 3 cards; no review of whether the password-change flow is discoverable, what "My Profile" vs "Business Settings" boundary means to an owner, or whether role is shown/editable here — `dashboard/components/ProfileView.tsx`
- [ ] **[REVIEW]** `BusinessSettingsView` — currently a grab-bag (business type, services, schedule for solo ops, CRM integrations, calendar sync, onboarding re-entry); needs review of what stays here after the P0 IA merge, and what moves to the new Setup tab — `dashboard/components/BusinessSettingsView.tsx`
- [ ] **[REVIEW]** `SettingsView` — super-admin and owner settings (resource management, CRM config, calendar); partially overlaps with BusinessSettingsView; needs review of what the split is, who sees what, and whether the page makes sense for both roles — `dashboard/components/SettingsView.tsx`
- [ ] **[REVIEW]** `EmployeeManagementView` — add/edit/delete employees, service skill assignments per employee; no review of the add-employee form, skill-assignment UX inside the employee card, or how deactivated employees surface — `dashboard/components/EmployeeManagementView.tsx`
- [ ] **[REVIEW]** `ShiftManagementView` — weekly timeline grid with zoom, employee selector, shift creation/deletion, copy-week; already flagged for solo-operator simplification; needs full review of the team-size-conditional paths and the copy-week affordance discoverability — `dashboard/components/ShiftManagementView.tsx`
- [ ] **[REVIEW]** `ResourceManagerView` — add/edit/delete bays/stations/chairs; no review of what happens with zero resources, the service-mapping checkboxes inside the resource card, or what "capabilities" means to an owner — `dashboard/components/ResourceManagerView.tsx`
- [ ] **[REVIEW]** `ServiceAssignmentView` — 3-step wizard for creating services + assigning staff + assigning resources; no review of whether 3 steps is correct, what happens when a service is created with no assignments, or how the wizard exit/cancel flow works — `dashboard/components/ServiceAssignmentView.tsx`
- [ ] **[REVIEW]** `SkillMatrixView` + `SkillAssignmentsView` + `SkillRelationshipMap` — the "Service Assignments" / "Who Can Do What" grid and node-map; no dedicated review of the grid legibility at scale, what the map teaches an owner vs what it confuses, or whether both views are necessary — `dashboard/components/SkillMatrixView.tsx` `dashboard/components/SkillAssignmentsView.tsx` `dashboard/components/skill-map/SkillRelationshipMap.tsx`
- [ ] **[REVIEW]** `DeletedRecordsPanel` + `RecordHistoryModal` — soft-deleted records + version history; probably never seen by most owners; no review of discoverability, how to restore, or whether the version history UI is comprehensible — `dashboard/components/DeletedRecordsPanel.tsx` `dashboard/components/RecordHistoryModal.tsx`
- [ ] **[REVIEW]** `/register` page — self-serve signup; partially fixed (blank defaults, business type forced pick); no full review of the overall form flow, field order, error handling, post-signup first experience — `dashboard/app/register/page.tsx`
- [ ] **[REVIEW]** `LoginView` + `/forgot-password` + `/reset-password` — authentication screens; no review of the forgot-password flow end-to-end, error message quality, or mobile behavior — `dashboard/components/LoginView.tsx` `dashboard/app/forgot-password/page.tsx` `dashboard/app/reset-password/page.tsx`
- [ ] **[REVIEW]** `SuperAdminDashboard` + `TenantCard` + `TenantCreateForm` + `TenantEditPanel` — the platform admin interface; no review; used by Dale not customers, but if it's painful to use it slows customer onboarding — `dashboard/components/SuperAdminDashboard.tsx`
- [ ] **[REVIEW]** `FirstRunTour` — the overlay tour shown after setup wizard completes; no dedicated review; flagged for Modal migration but no content/flow review — `dashboard/components/FirstRunTour.tsx`

---

## Cross-references

- Full audit with wireframes: `scripts/ux-audit/reports/2026-05-28T0853/ux-audit.html`
- Product-wide task list: `docs/TODO.md`
- Prior UX notes: `ux-review-notes.md`
- Design decisions (non-negotiable): `docs/UI_UX_DESIGN.md`
- No-grading rule: `docs/DESIGN_HANDOFF.md:284` + memory `feedback-no-coverage-grading`
