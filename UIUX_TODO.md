# UIUX_TODO

> Single prioritized UI/UX action list. Sources: `/ux-audit` 2026-05-28, `/ux-expert` simplification + KB + landing reviews 2026-05-28, `docs/TODO.md` backlog, `ux-review-notes.md`, `docs/UI_UX_DESIGN.md`.
> Reference audit report: `scripts/ux-audit/reports/2026-05-28T0853/ux-audit.html`
> Legend: effort `[S]` <2h · `[M]` half-day · `[L]` >1 day

---

## P0 — Critical (fix before next beta customer)

### Onboarding & Wizard

- [x] **[P0][M]** Add "What do callers ask?" step to setup wizard — `Step7CallerQuestions.tsx` inserted as step 7 (team) / step 3 (solo); 7 starter questions auto-save on blur to `policy-questionnaire`; old GoLive → step 8; SoloStep → 4 steps — DONE 2026-05-28
- [x] **[P0][M]** Add "AI Receptionist live/not live" status card on Home — DONE 2026-05-28 (`2d5f58a`)
- [x] **[P0][S]** `SetupProgressPill` hidden on mobile — removed `hidden` class; pill now visible on all screen sizes — DONE 2026-05-28

### Navigation & IA

- [~] **[P0][L]** Merge "My Business" + "My Team" + "Business Settings" into one "Setup" tab — **Phase 1 DONE 2026-06-03** (`a8eb438`). New `SetupView` hosts Services/Resources/Team/Working Days/Who Can Do What/Team Access/Business Settings as sub-tabs; orphaned MyBusinessView/MyTeamView deleted; legacy `?tab=` URLs redirect to `?tab=setup&subtab=…`. Verified: tsc clean, 762 unit, affected e2e green. **Phase 2 (open):** dedup the Calendar/CRM/Resources sections still shared between BusinessSettingsView and SettingsView, and reduce SettingsView to super-admin onboarding only. — _source: /ux-expert simplification review_
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

- [x] **[P0][L]** Replace all `text-[10px]` with `text-xs` (12px) — WCAG 2.1 AA minimum. 45 replacements across 25 files (25 files + 5 from `e9c65be` = all audit-listed files clean) — DONE 2026-05-28

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

- [x] **[P1][S]** "Team Access" sub-tab — resolved by the IA merge (2026-06-03, `a8eb438`). Per the decision to keep team config together, Team Access is now a sub-tab under the unified **Setup** tab (no longer a separate top-level destination). `dashboard/components/SetupView.tsx`
- [x] **[P1][M]** Remove duplicate services section from Business Settings — replaced with pointer card navigating to My Business → Services — DONE 2026-05-28 (`2179825`)
- [x] **[P1][M]** Solo operator "Working Days" uses a full team timeline — `SoloScheduleView` added: Mon–Sun grid with TimeInput pickers, writes via `expandWeekly` — DONE 2026-05-28 (`2179825`)

### Landing Page Copy

- [x] **[P1][S]** Unify CTA phrasing → "Start free trial" everywhere — DONE 2026-05-28
- [x] **[P1][S]** Replace hero stats pricing ($129) with "14 days free trial" — DONE 2026-05-28
- [x] **[P1][S]** Demo link replaced with live phone number CTA — DONE 2026-05-28

### Blocked

- [ ] **[P1]** **BLOCKED ON DALE REVIEW** Cluster A — neutral-language / no-grading across 8 surfaces: replace green/yellow/red threshold colors + grading copy with neutral factual states — see `docs/TODO.md:109` and memory `feedback-no-coverage-grading`. Do not re-apply unprompted. — _source: docs/TODO.md Cluster A_

---

## P2 — Medium (meaningful polish, each is one PR)

### Dashboard Home

- [x] **[P2][M]** Replace "This Week" 7-column mini-calendar with "next 3 days" row — heading → "Next 3 Days", `grid-cols-7` → `grid-cols-3 gap-4`, data load 7→3 days, appts shown 2→4, staff shown 2→3 — Done 2026-05-28.
- [x] **[P2][S]** Shrink greeting section — first name only + short date (no year, short month) — DONE 2026-05-28

### Knowledge Base

- [x] **[P2][M]** KB: add completion milestone when questionnaire is 40/40 — accent card "Your AI is fully trained on your business" + signpost to Phone Assistant → Go Live — Done 2026-05-28.
- [x] **[P2][M]** KB: promote Custom Questions section — "+ Add your own question" button added near top; scrolls to `#custom-questions-section` anchor — Done 2026-05-28.
- [x] **[P2][M]** KB: Documents tab lists already-uploaded files — below upload zone: filename, chunk count, date, remove button (deletes all chunks for that file via `handleDeleteFile`) — Done 2026-05-28.
- [x] **[P2][M]** KB: rename auto-shop-biased categories — "Warranties & Guarantees" → "Your Guarantee", "Preparation & What to Expect" → "Before Your Visit" (neutral across all verticals) — Done 2026-05-28.

### Navigation & IA

- [x] **[P2][M]** Schedule: demote Lines + List to "More ▼" overflow dropdown — Staff + Calendar shown as primary; Resources + List in dropdown; overflow button highlights when either is active — Done 2026-05-28.
- [x] **[P2][M]** Move calendar + CRM integrations to "Connections" section — "CONNECTIONS" eyebrow header added above Calendar + 4 CRM cards; visually separates integrations from config sections above — Done 2026-05-28.
- [x] **[P2][M]** Add cross-link from wizard Step 7 "Go Live" to Phone Assistant — signpost added to active state: "To adjust voice, greeting, and AI behavior, open Phone Assistant from the top nav after closing this wizard." — Done 2026-05-28.

### Accessibility & Interaction

- [~] **[P2][M]** Cluster C — overlay Escape/focus-trap/backdrop: **behavior DONE** 2026-05-28 (verified 2026-06-03). All 8 surfaces have correct modal behavior via the shared `useFocusTrap` hook (5 import it directly: `FirstRunTour`, `WizardModeChooser`, `WizardWelcome`, `SetupWizard/index`, `EmployeeDayFocusPanel`; the other 3 — `AppointmentPopover`, `StaffProfileCard`, `SkillMapFixPanel` — got inline trap/role/X per docs/TODO.md:139). `useFocusTrap` IS the shared abstraction. The further migration onto the shared Modal *component* is a behavior-neutral DRY refactor with an 8-file blast radius and zero user-facing change — **deferred as low-value**; reopen only if Modal gains features these overlays need. — _source: docs/TODO.md Cluster C_
- [x] **[P2]** Cluster D — accessible action controls — Done 2026-05-28: StepEmployees/Services/Resources delete buttons now gated by ConfirmModal (useConfirm) + aria-label on edit+delete; SkillManagementView delete opacity-0→opacity-40 always-visible + aria-label; ResourceManagerView + AppointmentBlock already adequate.
- [x] **[P2]** Cluster E — empty/loading/no-results distinctness — Done 2026-05-28: AppointmentListSidebar empty state added; VoiceCallsView "No call history yet" + AI-live context + filter no-results; StepResources spinner replaces "Loading..." text; DeletedRecordsPanel "no matches for X" vs "no deleted records" split with Clear search button. EmployeeManagementView/MyTeamView/CustomerDetailPanel already adequate.
- [x] **[P2][S]** Add "Dismiss all" to error toast stack when > 2 stacked — DONE 2026-05-28 (`a619314`)
- [ ] **[P2]** Responsive fallbacks for wide matrices/maps: `SchedulerDateNav`, `ResourceColumnsView`, `SkillRelationshipMap` — _source: docs/TODO.md:143_

### Analytics

- [x] **[P2][M]** Replace evaluative colors in AnalyticsView — return-rate bar+text → `var(--accent-soft)` / `var(--text-primary)`; no-show day cells → `var(--bg-raised)` / `var(--text-primary)`; day label `text-[9px]` → `text-xs` — Done 2026-05-28.

### UI Polish

- [x] **[P2][S]** Add "Keyboard shortcuts" item to profile dropdown — wired via `onShowShortcuts` prop to existing `shortcutsHelpOpen` state in dashboard/page.tsx — DONE 2026-05-28
- [x] **[P2][M]** Add color swatches to theme selector — `<select>` replaced with swatch button + 4×2 grid dropdown; each swatch shows bg+accent strip; active theme highlighted with accent ring — Done 2026-05-28.
- [ ] **[P2]** Dense-view chunking: `SettingsView` (split owner vs super-admin), `TenantEditPanel` (provisioning vs AI-config), `CRMView`, `AppointmentView`, `CustomerDetailPanel`, `ShiftManagementView` changed-vs-saved — sequence with C1+C2 — _source: docs/TODO.md:142_

### Landing Page

- [x] **[P2][S]** Add annual pricing toggle — Monthly/Annual toggle; annual prices 20% off (Solo $103, Growth $223, Pro $359); JS swaps price-num spans; annual note shown — DONE 2026-05-28
- [x] **[P2][S]** Remove duplicate "Smart Booking" feature card — feat-tile removed; "Every Booking, Double-Checked" wide card remains — DONE 2026-05-28
- [x] **[P2][S]** Rename "Built for" bar → "Works great for:" — already done (line 664). Verified 2026-05-28.
- [x] **[P2][S]** Fix footer Privacy / Terms / Contact links — links now `/privacy`, `/terms`, `mailto:` (not `#`). Note: `/privacy` and `/terms` routes don't exist yet (404) — page creation is a separate task. Verified 2026-05-28.

---

## P3 — Low / Backlog

- [x] **[P1][S]** iPad: shift delete button bumped to min-h-[44px] — DONE 2026-05-28
- [x] **[P2][S]** iPad: "Add customer" button in CRMView empty state → `size="md"` (44px touch target) — DONE 2026-05-28
- [x] **[P3][S]** KB: add "show unanswered only" toggle — DONE (verified 2026-06-03). `KnowledgeBaseView.tsx:443` `showUnansweredOnly` state + toggle button (line 799/815) + filter (line 832/843).
- [x] **[P3][S]** Add empty-state context to Calls tab — DONE (verified 2026-06-03). `VoiceCallsView.tsx:351` "Calls appear here once your AI phone line is active".
- [x] **[P3][M]** Migrate `FirstRunTour` to shared Modal primitive — STALE, behavior already correct (verified 2026-06-03). `FirstRunTour.tsx` uses `useFocusTrap` (trap + Escape, line 39) + `role="dialog"` + `aria-modal` + `aria-labelledby` + backdrop + close button. The "no Escape/focus trap" premise is no longer true (Cluster C, 2026-05-28). Remaining migration to the shared Modal *component* is a behavior-neutral DRY refactor — deferred as low-value (see P2 Cluster C).
- [x] **[P3][M]** Self-host landing page fonts via `next/font` — DONE (verified 2026-06-03). `layout.tsx:2` already imports `Bebas_Neue, DM_Sans, JetBrains_Mono` from `next/font/google`, which self-hosts at build time (no runtime `fonts.googleapis.com` request → GDPR + CWV concern already resolved). No googleapis fetch remains in page.tsx.
- [x] **[P3][S]** Normalize brand name capitalization — NOT A DEFECT (verified 2026-06-03). Nav + footer logo are both literal "SECRETARY HQ" rendered in Bebas Neue (`var(--ff-display)`, an inherently all-caps display font) — intentional logo styling. Prose uses correctly-cased proper noun "Secretary HQ". Register page renders no brand string at all. Rendered output is consistent; the audit flagged source casing but missed the display font. No change.
- [x] **[P3][S]** Verify meta title, description, favicon — DONE (verified 2026-06-03). `layout.tsx:30` title "Secretary HQ" + :31 description; `dashboard/app/favicon.ico` present.
- [x] **[P3][S]** Normalize section eyebrow copy case — NOT A DEFECT (verified 2026-06-03). Both `.hero-eyebrow` and `.section-eyebrow` carry `text-transform: uppercase` (page.tsx CSS lines 116, 230), so every eyebrow renders uppercase uniformly regardless of source-text casing; `.problem-card-eyebrow` uses the all-caps display font. Rendered output is consistent. No change.
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
