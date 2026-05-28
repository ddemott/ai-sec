# UIUX_TODO

> Single prioritized UI/UX action list. Sources: `/ux-audit` run 2026-05-28T0853, `docs/TODO.md` UX backlog, `ux-review-notes.md`, `docs/UI_UX_DESIGN.md`.
> Reference audit report: `scripts/ux-audit/reports/2026-05-28T0853/ux-audit.html`

---

## P0 — Critical (breaks product or WCAG)

- [ ] **[P0][L]** Replace all `text-[10px]` informational text with `text-xs` (12px) — WCAG 2.1 AA violation across 18+ files — `dashboard/components/DashboardHome.tsx:426,685,707,716` `dashboard/components/ShiftManagementView.tsx:347,472` `dashboard/components/ServiceAssignmentView.tsx:390,437` `dashboard/components/BusinessTypeSection.tsx:162,231` `dashboard/components/scheduler/NewSchedulerView.tsx` — _source: audit #2_
- [ ] **[P0][M]** Add "AI Receptionist live/not live" status card on Home — owners have no signal whether phone is active after completing wizard — `dashboard/components/DashboardHome.tsx:141` `dashboard/components/SetupWizard/Step7GoLive.tsx` — _source: audit #1_
- [ ] **[P0][S]** `SetupProgressPill` hidden on mobile (`hidden md:flex`) — new owners on phones have zero path back to wizard — `dashboard/components/SetupProgressPill.tsx` `dashboard/components/OutlookLayout.tsx:411` — _source: audit #3, docs/TODO.md:132_

---

## P1 — High (user-facing friction or bug)

- [x] **[P1][S]** `LoginView` doesn't store `userRole` in localStorage — front-desk users see owner tabs until re-register — `dashboard/components/LoginView.tsx:38` — _source: audit #5_ — **DONE 2026-05-28**
- [x] **[P1][S]** Shift delete button `opacity-0 group-hover` — invisible on iPad/touch, owners can't delete shifts on tablet — `dashboard/components/scheduler/StaffSwimLaneView.tsx:417-428` — _source: audit #8, docs/TODO.md Cluster D_ — **DONE 2026-05-28**
- [x] **[P1][S]** `NewSchedulerView` hour slots lack `min-h-[44px]` — touch targets collapse below 44px on empty days — `dashboard/components/scheduler/NewSchedulerView.tsx:1105-1160` — _source: audit #6_ — **DONE 2026-05-28**
- [x] **[P1][S]** `QuickBookPanel` uses `bg-white dark:bg-[#1a1a1a]` — breaks on Forest, Sunset, Nord, Crimson, Discord, Midnight themes — `dashboard/components/scheduler/QuickBookPanel.tsx:249` — _source: audit #4_ — **DONE 2026-05-28**
- [x] **[P1][S]** `EmployeeDayFocusPanel` same hardcoded-bg pattern + fixed `w-96` clips on phones < 384px — `dashboard/components/scheduler/EmployeeDayFocusPanel.tsx:53` — _source: audit #DS1, #D3_ — **DONE 2026-05-28**
- [x] **[P1][S]** Add empty state + "Add manually" CTA to Customers tab — new owners see blank list with no guidance — `dashboard/components/CRMView.tsx` — _source: audit #7_ — **DONE 2026-05-28**
- [x] **[P1][S]** Replace red/yellow/green coverage pills in `SoloStepReview` with neutral factual labels — violates no-grading product rule — `dashboard/components/SetupWizard/SoloStepReview.tsx` `dashboard/components/ui/CoverageStatusBadge.tsx` — _source: audit #9, ux-review-notes.md_ — **DONE 2026-05-28**
- [x] **[P1][S]** Show tenant timezone label next to time inputs in QuickBook — front-desk in different tz creates wrong-hour bookings — `dashboard/components/scheduler/QuickBookPanel.tsx:170` — _source: audit #F2_ — **DONE 2026-05-28**
- [x] **[P1][S]** `CustomerCombobox` hardcodes `bg-gray-50 dark:bg-[#222]` — replace with `var(--bg-raised)` / `var(--border)` — `dashboard/components/ui/CustomerCombobox.tsx:117,125` — _source: audit #DS2_ — **DONE 2026-05-28**
- [x] **[P1][M]** Knowledge Base field save: persist saved + timestamp indicator (not just 2s badge); surface error on slow connection — `dashboard/components/KnowledgeBaseView.tsx:50-80` — _source: audit #F3_ — **DONE 2026-05-28**
- [ ] **[P1]** **BLOCKED ON DALE REVIEW** Cluster A — neutral-language / no-grading (8 surfaces): rename grading tokens → neutral connection/availability state, drop green/yellow/red threshold colors, factual copy everywhere — see `docs/TODO.md:109` and memory `feedback-no-coverage-grading`. Do not re-apply unprompted. — _source: docs/TODO.md Cluster A_

---

## P2 — Medium (polish, consistency, heuristics)

- [ ] **[P2][S]** Add "Keyboard shortcuts" item to profile dropdown — `?` trigger is completely invisible without it — `dashboard/components/OutlookLayout.tsx:530-565` — _source: audit #10, #H7_
- [ ] **[P2][M]** Replace evaluative colors (red/amber/green) in `AnalyticsView` with neutral operational colors — violates no-grading rule — `dashboard/components/AnalyticsView.tsx` — _source: audit #H6, ux-review-notes.md_
- [ ] **[P2][S]** Add "Dismiss all" to error toast stack when > 2 stacked — `dashboard/components/ui/Toast.tsx` — _source: audit #H4_
- [ ] **[P2][M]** Add color swatches to theme selector in nav bar — 8 themes by name only, requires trial-and-error — `dashboard/components/OutlookLayout.tsx:330-350` — _source: audit #H5_
- [ ] **[P2][M]** Cluster C — migrate custom overlays onto shared Modal primitive (Escape, focus trap, backdrop close): `WizardModeChooser`, `WizardWelcome`, `FirstRunTour`, `SetupWizard/index`, `scheduler/AppointmentPopover`, `scheduler/StaffProfileCard`, `scheduler/EmployeeDayFocusPanel`, `skill-map/SkillMapFixPanel` — _source: docs/TODO.md Cluster C_
- [ ] **[P2]** Cluster D — accessible action controls: replace icon-only / hover-only buttons with `aria-label` + visible focus; route destructive actions through shared confirm: `StepEmployees`, `StepServices`, `StepResources`, `SkillManagementView`, `ResourceManagerView`, `AppointmentBlock` (no keyboard move path) — _source: docs/TODO.md Cluster D_
- [ ] **[P2]** Cluster E — empty / loading / filtered-no-results distinctness: `AppointmentListSidebar`, `KnowledgeBaseView`, `VoiceCallsView`, `Step2Resources`, `EmployeeManagementView`, `MyTeamView`, `CustomerDetailPanel`, `DeletedRecordsPanel` — _source: docs/TODO.md Cluster E_
- [ ] **[P2][S]** `WizardWelcome` copy: "10 minutes / 6 quick questions" doesn't match actual 7-step wizard — reword to durable, accurate terms — `dashboard/components/SetupWizard/WizardWelcome.tsx` — _source: docs/TODO.md:130_
- [ ] **[P2][M]** "Phone Assistant" tab name: add cross-link from wizard Step 7 directly to AI config page — new users look in "My Business" first — `dashboard/components/OutlookLayout.tsx:ADVANCED_TABS` `dashboard/components/SetupWizard/Step7GoLive.tsx` — _source: audit #N1_
- [ ] **[P2][M]** C1+C2 — Schedule: consolidate 4 sub-views → 2 (Day/Month), unify 3 separate headers — `dashboard/components/SchedulerView.tsx` — _source: docs/TODO.md:99_
- [ ] **[P2]** Dense-view chunking: `SettingsView` (split owner vs super-admin), `TenantEditPanel` (separate provisioning from AI-config), `CRMView`, `AppointmentView`, `DashboardHome` hierarchy, `CustomerDetailPanel`, `ShiftManagementView` changed-vs-saved, `ServiceAssignmentView` / `SkillAssignmentsView` / `SkillMatrixView` completion cues — sequence with C1+C2 — _source: docs/TODO.md:142_
- [ ] **[P2]** Responsive fallbacks for wide matrices/maps: `SchedulerDateNav`, `ResourceColumnsView`, `SkillRelationshipMap`, `OutlookLayout` — _source: docs/TODO.md:143_

---

## P3 — Low / Backlog

- [ ] **[P3][M]** Migrate `FirstRunTour` to shared Modal primitive — no Escape handling or focus trap today — `dashboard/components/FirstRunTour.tsx` — _source: audit #DS4, docs/TODO.md Cluster C_
- [ ] **[P3][M]** Self-host landing page fonts via `next/font` — currently loads from `fonts.googleapis.com` (GDPR + perf risk) — `dashboard/app/page.tsx` — _source: audit #DS3_
- [ ] **[P3][S]** Add empty-state message to Calls tab — explain calls appear after AI is live — `dashboard/components/VoiceCallsView.tsx` — _source: audit #F5_
- [ ] **[P3]** B4 — Reconsider sub-tab URL persistence (verify usage first) — `dashboard/app/dashboard/page.tsx` — _source: docs/TODO.md:98_
- [ ] **[P3][L]** SetupWizard Phase B — hold all wizard data in local state, commit to DB only on Done click, discard on dismiss — `dashboard/components/SetupWizard/useWizardCrud.ts` + all Step*.tsx + VocabularyProvider override — open in fresh branch; coordinate with Cluster C Modal migration — _source: docs/TODO.md:137_
- [ ] **[P3]** E1 — Threaded demo-mode (sample data via session flag) — `dashboard/app/demo` — _source: docs/TODO.md:99_

---

## Cross-references

- Full audit report with before/after wireframes: `scripts/ux-audit/reports/2026-05-28T0853/ux-audit.html`
- Audit checklist (same findings, compact): `scripts/ux-audit/reports/2026-05-28T0853/TODO-2026-05-28T0853.md`
- Product-wide task list: `docs/TODO.md`
- UX review notes (2026-05-27 pass): `ux-review-notes.md`
- Design decisions (non-negotiable): `docs/UI_UX_DESIGN.md`
- No-grading rule: `docs/DESIGN_HANDOFF.md:284` + memory `feedback-no-coverage-grading`
