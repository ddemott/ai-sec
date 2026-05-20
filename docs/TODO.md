# TODO

**Status at a Glance** (as of 2026-05-19)

- **Voice / Telnyx**: `+1-630-937-9478` unreachable from PSTN. LERG ticket open. Zero inbound CDRs. Blocks all live voice validation and DynaTire beta.
- **Env vars**: `DASHBOARD_URL` + `SENTRY_DSN` not yet set on Railway (user action).
- **Browser validation**: Role gating + invite flow needs real-browser testing.
- **UX audit pass 2 (2026-05-19)**: `ux-review-notes.md` at repo root catalogs trust/consistency/empty-state findings across ~30 dashboard components. **Triaged 2026-05-20** into P0–P3 clusters (see UX audit pass 2 section); fixes not yet started. File still untracked.

Everything else complete or tracked below.

---

## In-flight markers

- **IN FLIGHT (external)**: Waiting on vendor/third party.
- **IN FLIGHT (user)**: Needs action from Dale.
- **IN FLIGHT (prod-apply)**: Code shipped; needs production DB/Infra apply.
- **IN FLIGHT (validation pending)**: Code + tests done; needs live condition (PSTN call, etc.).

---

## Phase 13 – Blocking Launch

- [ ] **IN FLIGHT (external)** Telnyx PSTN ticket for `+1-630-937-9478` (see `TICKET_SUPPORT.md`)
- [ ] **IN FLIGHT (user)** Set `DASHBOARD_URL=https://dashboard-production-cee3.up.railway.app` on Railway `ai-sec` service
- [ ] **IN FLIGHT (user)** Set `SENTRY_DSN` on Railway backend + agent (dashboard Sentry already wired client+server, just needs DSN)
- [ ] **IN FLIGHT (validation pending)** Browser-verify role gating + invite flow

Closed: prod migrations apply (36 applied 2026-05-17 → version `20260514000000`); first-run guided tour (`20838a4`).

---

## Voice Validation (blocked on Telnyx)

- [ ] Call transcript + summary flow end-to-end
- [ ] Expanded live QA suite (`scripts/qa-live-test.py`)
- [ ] Reminder delivery monitoring dashboard
- [ ] Add coverage for OTP + all 5 booking error codes in live QA

---

## Non-blocking / Polish

- [ ] Pricing tiers (Pro/Enterprise) positioning
- [ ] Continue `src/index.ts` extraction / cleanup
- [ ] Finish broader CRM sync structure extraction (NEEDS-REFACTORING #10)

Closed: `pw.txt` decision (`ac61161` — deleted, NEEDS-REFACTORING #14 closed); dashboard Sentry integration (`c3e679e` — `@sentry/nextjs` server+client wired); `docs/README.md` (2026-05-15).

## UX backlog (from 2026-05-16 `/ux-expert` audit)

Closed items in `RESOLVED.md` under 2026-05-16 + 2026-05-17.

Open:
- [ ] **B4** Reconsider sub-tab URL persistence (verify usage first)
- [ ] **C1 + C2** Schedule: 4 sub-views → 2 (Day/Month), unify the 3 separate headers
- [ ] **E1** Threaded demo-mode (sample data via session flag, obsoletes static `/demo`)

## UX audit pass 2 (2026-05-19)

Source: `ux-review-notes.md` at repo root — ~60 findings across ~30 dashboard files, severity-tagged. **Triaged 2026-05-20** into the clusters below (themes, not 30 per-file tickets — most `[high]`s collapse into a few shared fix-shapes).

**Doc fate decided:** `ux-review-notes.md` stays the source of truth. Strike through (`~~…~~`) findings there as they close; a cluster only graduates to `RESOLVED.md` once every finding in it is struck. No per-file issue split — overkill at this scale.

### P0 — verified rule violations + real defects (small, concrete)

- [ ] **Cluster A — neutral-language / no-grading** (8 surfaces). Violates the explicit product rule "no percentages, no warnings, no opinions" (`docs/DESIGN_HANDOFF.md:284`, `docs/UI_UX_DESIGN.md:30`). Same fix shape everywhere: rename grading tokens → neutral connection/availability state, drop green/yellow/red threshold colors, factual copy.
  - `SoloStepReview.tsx` + `StepReview.tsx` — `allCovered`/`partial` + green/yellow/red readiness badges
  - `skill-map/SkillRelationshipMap.tsx` + `SkillMapNode.tsx` — footer `full`/`partial`/`uncovered` + warning/danger colors
  - `scheduler/ResourceColumnsView.tsx` — empty slots classed as `gap`
  - `scheduler/AppointmentListView.tsx` — long gaps as amber alert rows
  - `scheduler/EmployeeDayFocusPanel.tsx` — utilization color-graded green/yellow/gray
  - `AnalyticsView.tsx` — keep summaries neutral, no implicit scoring
  - (related medium) `AppointmentDetailPanel.tsx` — alignment-blocked message reads as warning banner; make factual
- [ ] **Cluster B — verified defects** (3 sites, independent fixes)
  - `SetupWizard/StepServices.tsx:149` — `parseInt(e.target.value) || 0` silently collapses a cleared/invalid duration to `0`. Keep raw input state separate; validate before save.
  - `SuperAdminDashboard.tsx` — business-search input has no state/filter/empty-search logic (false affordance in a busy admin view). Wire it to tenant filtering w/ no-match state, or remove until real.
  - `SetupWizard/index.tsx:101` — template seeding is a sequential `await Api.services.create` loop; mid-loop failure (catch at :116 only `console.warn`s) leaves setup half-seeded with no UI status or retry. Surface seeding status + reconcile/retry the starter-data path.

### P1 — a11y + shared-primitive consistency (cluster fixes)

- [ ] **Cluster C — overlay/dialog focus management.** Move custom overlays onto the shared Modal primitive (Escape/backdrop close, focus trap, initial focus, visible close affordance): `WizardModeChooser` (high — no focus trap), `WizardWelcome`, `FirstRunTour`, `SetupWizard/index` shell, `scheduler/AppointmentPopover`, `scheduler/StaffProfileCard`, `scheduler/EmployeeDayFocusPanel` (dialog/landmark role), `skill-map/SkillMapFixPanel` (bare `✕`).
- [ ] **Cluster D — accessible action controls.** Replace icon-only / hover-only action buttons with shared button/icon-button primitives + `aria-label` + visible focus; route destructive actions through the shared confirm: `SetupWizard/StepEmployees`, `StepServices`, `StepResources`, `SkillManagementView`, `scheduler/StaffSwimLaneView` (hover-only delete), `ResourceManagerView`, `scheduler/AppointmentBlock` (no keyboard move path).
- [ ] **Cluster E — empty / loading / filtered-no-results distinctness.** Make "no data yet" vs "no matches" vs "still loading" visually distinct (recurring medium): `AppointmentListSidebar`, `KnowledgeBaseView`, `VoiceCallsView`, `Step2Resources`, `EmployeeManagementView`, `MyTeamView`, `CustomerDetailPanel` empty fields, `DeletedRecordsPanel`.

### P2 — copy / trust polish

- [ ] `SetupWizard/WizardWelcome.tsx` — "10 minutes / 6 quick questions" copy drifts from the actual 7-step wizard; reword to durable, accurate terms.
- [ ] `SkillMatrixView.tsx` footer + `Step7GoLive.tsx` — drop persuasive/reassurance phrasing; state what changes factually.
- [ ] `SetupProgressPill.tsx` — `hidden md:flex` drops the pill on tablet/compact; add a compact fallback.
- [ ] `ProfileView.tsx` — "Security" card "coming soon" placeholder; replace with real account facts or collapse.

### P3 — large structural decomposition (defer; medium-high effort, vague-per-finding)

- [ ] Dense-view chunking / shell-continuity `[high]`s — track but don't action piecemeal: `SettingsView` (split owner vs super-admin), `TenantEditPanel` (separate provisioning from AI-config), `CRMView`, `AppointmentView`, `DashboardHome` hierarchy, `CustomerDetailPanel`, `DeletedRecordsPanel`, `RecordHistoryModal`, `NewSchedulerView` / `SchedulerView` orchestration overlap, `ShiftManagementView` changed-vs-saved, `ServiceAssignmentView` / `SkillAssignmentsView` / `SkillMatrixView` completion cues. Several overlap with **C1+C2** (scheduler consolidation) above — sequence with that work.
- [ ] Responsive fallbacks for wide matrices/maps (medium): `SchedulerDateNav`, `ResourceColumnsView`, `SkillRelationshipMap`, `OutlookLayout`.

## Tooling cleanup (remaining ESLint promotions)

Most of the 2026-05-17 lint adoption already promoted to `error`. Still at `warn`:

- [ ] `@typescript-eslint/no-explicit-any` + `no-unsafe-*` family (~1100 sites — batch-N cleanup ongoing)
- [ ] `@typescript-eslint/no-misused-promises`
- [ ] `@typescript-eslint/await-thenable`
- [ ] `@typescript-eslint/unbound-method` (heavy in tests — may stay warn forever)

Closed: `consistent-type-imports`, `no-unused-vars`, `no-floating-promises`, `require-await`, `restrict-template-expressions`, `no-unnecessary-type-assertion`, `no-base-to-string`, `ban-types`, `prefer-promise-reject-errors` (all promoted to error 2026-05-17/18); Prettier format sweep across all three projects (`79b227c`).

## Documentation

(empty)

---

**Archived detailed history**: See `CURRENT_STATUS_ARCHIVED_2026-05-15.md` for previous session notes and long-form status.
