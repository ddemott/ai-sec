## Review — 2026-04-30

### AIConfigView (dashboard/components/AIConfigView.tsx)
- **[medium]** AI configuration surfaces often mix editable controls, generated defaults, and save actions in one dense screen, and without explicit load/save/error framing users can feel unsure whether changes actually stuck → Add clearer loading, dirty, and save-result states so the page feels dependable instead of quietly stateful.

### AIInsightsView (dashboard/components/AIInsightsView.tsx)
- **[medium]** Insight-heavy screens need strong section-level empty and unavailable states, especially when some AI-derived data is sparse or partially integrated → Differentiate no-data-yet, unavailable, and loaded states more clearly so missing insight content reads as intentional rather than broken.

### AnalyticsView (dashboard/components/AnalyticsView.tsx)
- **[high]** Analytics surfaces are trust-sensitive because they mix live metrics, placeholders, and sparse data windows, and without strong shell-state framing users can misread unfinished sections as product bugs → Separate live metrics, pending integrations, and empty data states more clearly so the page stays honest without feeling unfinished.

## Review — 2026-04-30

### AppointmentView (dashboard/components/AppointmentView.tsx)
- **[high]** List-detail appointment views tend to accumulate a lot of selection and refresh state at the shell level, and without explicit loading, empty-selection, and mutation-result treatment they can feel unpredictable under fast front-desk use → Strengthen shell-state handling for first load, selection reset, and post-mutation refresh so the screen feels stable while users move quickly.

### AppointmentListSidebar (dashboard/components/AppointmentListSidebar.tsx)
- **[medium]** Appointment sidebars need strong differentiation between empty schedules, filtered no-results, and active selection context, and compact rows can otherwise blur those states together → Add clearer no-results, no-appointments, and selected-row cues so the sidebar remains easy to scan.

### AppointmentDetailPanel (dashboard/components/AppointmentDetailPanel.tsx)
- **[medium]** Detail panels that combine status, customer context, and edit actions can feel risky if read-only information and mutation affordances are not clearly separated → Make read-only sections, editable controls, and save/error feedback more explicit so detail work feels trustworthy.

## Review — 2026-04-30

### BusinessSettingsView (dashboard/components/BusinessSettingsView.tsx)
- **[medium]** Business settings screens often mix long-lived configuration, defaults, and edit actions in one dense surface, and without strong save-state feedback users can be left unsure what actually changed → Strengthen dirty-state, save-result, and empty/default-state cues so the page feels controlled rather than form-heavy.

### CRMIntegrationCard (dashboard/components/CRMIntegrationCard.tsx)
- **[medium]** Integration cards need especially clear connected, reconnect-needed, syncing, and failed states, and compact cards can blur those statuses if they lean too heavily on small badges and button text → Differentiate integration health states more clearly so users can understand account status at a glance.

### CRMView (dashboard/components/CRMView.tsx)
- **[high]** CRM management views usually combine connection state, mapping context, and record management, and if loading, reconnect, or sync-result states are not explicit the whole screen can feel brittle during real troubleshooting → Clarify shell-state, reconnect-state, and sync-result feedback so the screen feels dependable during operational use.

## Review — 2026-04-30

### CustomerDetailPanel (dashboard/components/CustomerDetailPanel.tsx)
- **[medium]** Customer detail panels often carry contact context, history, and next actions in one vertical surface, and if read-only info, action areas, and sparse-history states are not clearly separated the panel can feel crowded → Strengthen section boundaries and empty-history/no-contact-state treatment so the panel remains easy to interpret.

### DashboardHome (dashboard/components/DashboardHome.tsx)
- **[medium]** Home dashboards set the tone for the whole product, and when loading, sparse tenant data, or unavailable summaries are not explicitly framed the screen can feel half-finished during first use → Add clearer first-load, no-data, and unavailable-summary treatment so the home screen feels intentional even when data is thin.

### DeletedRecordsPanel (dashboard/components/DeletedRecordsPanel.tsx)
- **[high]** Recovery surfaces need unusually strong feedback because users are judging risk as they act, and subtle restore/result states can make the whole flow feel unsafe → Make preview, restore confirmation, and restore-result feedback much more explicit so users understand exactly what is recoverable and what happened after they act.

## Review — 2026-04-30

### EmployeeManagementView (dashboard/components/EmployeeManagementView.tsx)
- **[medium]** Employee admin views often combine directory management, role details, and status changes in one dense screen, and without clear shell-state and mutation feedback they can feel busier than they need to → Strengthen empty, no-results, and save/delete-result states so the screen feels operational rather than crowded.

### ErrorBoundary (dashboard/components/ErrorBoundary.tsx)
- **[high]** Error boundaries are trust-critical recovery surfaces, and if the fallback is too minimal users can feel trapped the moment something breaks → Add clearer recovery actions, navigation options, and calm explanatory copy so failures feel recoverable instead of terminal.

### KnowledgeBaseView (dashboard/components/KnowledgeBaseView.tsx)
- **[medium]** Knowledge surfaces swing between sparse and dense states quickly, and without strong empty, search, and action-result framing users can struggle to tell whether content is missing, filtered out, or still loading → Strengthen no-content, no-results, and save/result feedback so the screen remains legible across those states.

## Review — 2026-04-30

### LoginView (dashboard/components/LoginView.tsx)
- **[medium]** Login is a no-context surface, so generic loading or failure feedback can make the entire product feel unavailable even when the problem is narrow → Differentiate invalid credentials, backend-unreachable, and in-flight login states more clearly so users know what to do next.

### MyBusinessView (dashboard/components/MyBusinessView.tsx)
- **[medium]** Business profile screens often mix stable settings with generated or suggested content, and without strong save-state framing users can lose track of what is editable versus merely informative → Clarify dirty-state, save-result, and informational-versus-editable sections so the screen feels controlled rather than dense.

### MyTeamView (dashboard/components/MyTeamView.tsx)
- **[medium]** Team pages often need to serve both first-run onboarding and ongoing management, and when those modes are not clearly separated the screen can feel awkward in sparse-team states → Add stronger no-team-yet, invite/add, and active-management framing so the view adapts more gracefully to team maturity.

## Review — 2026-04-30

### BusinessTypePicker (dashboard/components/SetupWizard/BusinessTypePicker.tsx)
- **[medium]** Business-type selection is an early trust-building step, and if search, suggestions, and selected-state cues are too visually busy users can feel less certain than they should at the start of onboarding → Strengthen first-load guidance, no-results treatment, and selected-state clarity so the picker feels decisive instead of crowded.

### SoloStepHours (dashboard/components/SetupWizard/SoloStepHours.tsx)
- **[medium]** Hours setup steps often mix repetitive editing with bulk actions, and without strong changed-versus-saved feedback users can lose confidence in what schedule they have actually configured → Clarify copied-state, unsaved-change, and save-result feedback so the step feels dependable.

### SoloStepReview (dashboard/components/SetupWizard/SoloStepReview.tsx)
- **[high]** Review steps are where users decide whether they trust the setup enough to continue, and if ready, blocked, and partially complete states are not unmistakable the whole wizard can feel uncertain at the finish line → Strengthen readiness framing so users can tell exactly whether they are safe to proceed.

## Review — 2026-04-30

### OutlookLayout (dashboard/components/OutlookLayout.tsx)
- **[medium]** Layout shells quietly shape every downstream interaction, and if focus transitions, tab state, or smaller-viewport behavior are weak the entire app can feel less stable than the underlying screens really are → Strengthen focus visibility, active-tab clarity, and narrow-layout behavior so the shell feels dependable as the app’s main scaffold.

### ProfileView (dashboard/components/ProfileView.tsx)
- **[low]** Profile screens are usually simple, but they can still feel oddly passive if it is not clear what is informational versus editable or what happens after a change → Clarify whether fields are read-only or editable and make save/result messaging more explicit so the screen feels intentional.

### RecordHistoryModal (dashboard/components/RecordHistoryModal.tsx)
- **[high]** History and restore modals are high-trust surfaces, and if focus handling, comparison state, or restore-result feedback are subtle users can lose confidence quickly → Strengthen modal focus behavior, comparison-state clarity, and restore-result feedback so the history flow feels safe and understandable.

## Review — 2026-04-30

### ResourceManagerView (dashboard/components/ResourceManagerView.tsx)
- **[medium]** Resource management screens can feel busier than they are when capabilities, availability, and edit actions sit together without strong state separation → Clarify empty, editing, and mutation-result states so the screen feels operational rather than crowded.

### SchedulerView (dashboard/components/SchedulerView.tsx)
- **[high]** Scheduler shell views set expectations for every downstream interaction, and if mode-switching, loading, or empty-day states are not explicit the entire scheduler can feel unstable before users even reach details → Strengthen top-level shell-state treatment so the scheduler reads as intentionally dense rather than half-loaded.

### ServiceAssignmentView (dashboard/components/ServiceAssignmentView.tsx)
- **[medium]** Assignment mapping screens become visually heavy fast, and without clear first-run, unmapped, and partial-coverage cues users can struggle to tell whether they are looking at setup gaps or filtered data → Make incomplete versus complete assignment states more explicit so the mapping step feels actionable.

## Review — 2026-04-30

### SoloWizard (dashboard/components/SetupWizard/SoloWizard.tsx)
- **[high]** Solo wizard shells quietly control progress trust across the whole onboarding experience, and if step memory, back/forward behavior, or shell loading are inconsistent users can feel the flow is fragile even when individual steps work → Strengthen progress continuity, step retention, and shell-level loading/error treatment so the solo flow feels dependable end to end.

### Step7GoLive (dashboard/components/SetupWizard/Step7GoLive.tsx)
- **[high]** Go-live steps are the highest-stakes moment in onboarding, and if activation, blocked prerequisites, or failure recovery are not unmistakable users can hesitate right at the finish line → Differentiate ready, activating, activated, and blocked states much more clearly so the final action feels safe and conclusive.

### StepAssignments (dashboard/components/SetupWizard/StepAssignments.tsx)
- **[medium]** Assignment setup gets visually dense quickly, and without clear unmapped, partially mapped, and saved-state cues users can struggle to tell what still needs attention → Make incomplete versus complete mapping states and save feedback more explicit so the step feels like a workflow instead of a puzzle.

## Review — 2026-04-30

### StepEmployees (dashboard/components/SetupWizard/StepEmployees.tsx)
- **[medium]** Employee setup steps can feel heavier than they need to when first-run guidance, edit actions, and sparse-state management all share one surface without clear hierarchy → Strengthen first-run guidance, row-state clarity, and add/edit/result feedback so the step feels like progressive setup instead of admin overhead.

### StepResources (dashboard/components/SetupWizard/StepResources.tsx)
- **[medium]** Resource setup is often repetitive by nature, and without clear distinction between scaffolding new resources and refining existing ones the step can feel muddy → Clarify first-run, existing-resource edit, and action-result states so users can tell what mode they are in.

### StepServices (dashboard/components/SetupWizard/StepServices.tsx)
- **[high]** Service definition is foundational for the rest of onboarding, and if incomplete duration or coverage information is not clearly surfaced users can proceed with weak downstream setup without realizing it → Strengthen incomplete-service, saved-service, and readiness cues so users understand when the step is truly in good shape to continue.

### StepShifts (dashboard/components/SetupWizard/StepShifts.tsx)
- **[high]** Shift setup is easy to get subtly wrong, and if copied hours, off-day states, or empty schedules are not unmistakable users can leave onboarding with broken staffing assumptions → Strengthen first-run, copied-state, and off-day feedback so users can tell exactly what schedule coverage they have configured.

### WizardModeChooser (dashboard/components/SetupWizard/WizardModeChooser.tsx)
- **[medium]** Mode-chooser steps are decision points, and if the consequences of solo versus team setup are not framed clearly enough users can make the choice without confidence → Clarify the fit and consequences of each mode so the decision feels informed rather than arbitrary.

### WizardStepContent (dashboard/components/SetupWizard/WizardStepContent.tsx)
- **[medium]** Shared step-shell components set the pacing and trust for the whole wizard, and if blocked, loading, or progression cues are too subtle the flow can feel inconsistent from step to step → Strengthen shared blocked, loading, and progression treatment so each step feels like part of one coherent setup system.

## Review — 2026-04-30

### ShiftManagementView (dashboard/components/ShiftManagementView.tsx)
- **[high]** Shift management is a high-consequence scheduling surface, and if copied hours, exceptions, or current coverage cues are not explicit users can make subtle staffing mistakes without noticing → Strengthen copied-state, override/off-day, and save-result feedback so the schedule users see is unambiguous.

### SkillManagementView (dashboard/components/SkillManagementView.tsx)
- **[medium]** Skill admin screens sit between simple CRUD and operational setup, and if create/edit/delete flows share one dense panel without strong empty and confirmation feedback the screen can feel brittle → Clarify empty-state guidance, mutation feedback, and destructive-action affordances so skill editing feels safe and straightforward.

### SkillMatrixView (dashboard/components/SkillMatrixView.tsx)
- **[medium]** Matrix-style views become visually dense quickly, and without strong legend, partial-state, or no-data treatment users can struggle to tell whether the grid is incomplete, filtered, or genuinely sparse → Add clearer matrix-state framing so empty intersections, missing skills, and partial coverage are easier to interpret at a glance.

### VoiceCallsView (dashboard/components/VoiceCallsView.tsx)
- **[medium]** Voice activity screens mix live polling, historical sessions, and sparse-state troubleshooting, and right now the empty/history filter/load-more flow can easily read like partial failure instead of intentional state → Differentiate loading, no-calls-yet, filtered-no-results, and fetch-failure states more clearly so the surface feels operational rather than half-loaded.

## Review — 2026-04-30

### SetupWizard/index.tsx (dashboard/components/SetupWizard/index.tsx)
- **[medium]** Wizard entry components shape the first impression of onboarding, and if initial loading, mode selection, or progress continuity are not clearly framed the whole setup flow can start with uncertainty → Strengthen initial shell-state, entry guidance, and mode/progress continuity so setup feels coherent from the first screen.

### SuperAdminDashboard (dashboard/components/SuperAdminDashboard.tsx)
- **[high]** Super-admin surfaces combine high-impact actions with broad system visibility, and if activation, tenant state, and destructive actions are not clearly tiered the screen can feel riskier than it needs to → Strengthen action hierarchy, state clarity, and action-result feedback so global operations feel controlled and deliberate.

### TenantCard (dashboard/components/TenantCard.tsx)
- **[medium]** Tenant cards are at-a-glance operational surfaces, and compact layouts can blur provisioning, active, and problem states when they lean too heavily on small badges or terse labels → Differentiate tenant-health states more clearly so the cards stay scannable without drilling in.

### TenantCreateForm (dashboard/components/TenantCreateForm.tsx)
- **[medium]** Tenant creation is a trust-sensitive form flow, and if required fields, defaults, or validation problems are not explicit users can hesitate before submitting or miss what is wrong → Strengthen required-field guidance, inline validation visibility, and post-submit feedback so creation feels predictable.

### TenantEditPanel (dashboard/components/TenantEditPanel.tsx)
- **[medium]** Edit panels need very clear dirty, saving, and cancel/discard states, and subtle feedback can leave users unsure what has actually changed → Make dirty-state and save-result cues more obvious so tenant edits feel controlled rather than fragile.

## Review — 2026-04-30

### AppointmentBlock (dashboard/components/scheduler/AppointmentBlock.tsx)
- **[medium]** Dense appointment blocks live at the heart of scheduling, and if status, ownership, or truncated-content cues are too subtle users can miss important differences while scanning quickly → Strengthen compact-state hierarchy so status and truncation remain obvious even in the smallest block states.

### AppointmentListView (dashboard/components/scheduler/AppointmentListView.tsx)
- **[medium]** Scheduler list views need clear differentiation between empty days, filtered no-results, and warning states, and compact rows can otherwise blur those contexts together → Add stronger no-results, sparse-day, and warning-state treatment so the list reads intentionally under fast front-desk use.

### AppointmentPopover (dashboard/components/scheduler/AppointmentPopover.tsx)
- **[high]** Scheduler popovers are high-frequency detail surfaces, and if focus handling, close behavior, or action/result feedback are weak they undermine trust in the whole scheduler → Strengthen focus/close behavior and action-state clarity so the popover feels like a dependable scheduler extension rather than a fragile overlay.

### EmployeeDayFocusPanel (dashboard/components/scheduler/EmployeeDayFocusPanel.tsx)
- **[medium]** Focus panels only help when they make state clearer than the main scheduler, and if no-selection, empty-day, or no-shift states are too subtle the panel can feel like dead space → Strengthen no-selection, no-shifts, and no-appointments states so the panel stays informative instead of going blank.

### NewSchedulerView (dashboard/components/scheduler/NewSchedulerView.tsx)
- **[high]** The scheduler shell sets trust for the whole feature, and if top-level loading, mode-switching, or empty-day states are not explicit the interface can feel unstable before users even interact with details → Clarify top-level loading, mode-switch, and empty-day shells so the scheduler reads as intentionally dense rather than half-loaded.

### QuickBookPanel (dashboard/components/scheduler/QuickBookPanel.tsx)
- **[medium]** Quick-book panels are speed surfaces, and subtle search failures, missing prerequisites, or booking-result states can make them feel unreliable very quickly → Strengthen no-results, blocked-prerequisite, and booking-result feedback so the panel stays fast without becoming opaque.

## Review — 2026-04-30

### ResourceColumnsView (dashboard/components/scheduler/ResourceColumnsView.tsx)
- **[medium]** Resource-column schedulers can become visually confusing when empty resources, low-coverage stretches, and genuine appointment gaps all look too similar → Strengthen empty-resource, unavailable-resource, and sparse-schedule treatment so the columns are easier to interpret at a glance.

### SchedulerDateNav (dashboard/components/scheduler/SchedulerDateNav.tsx)
- **[low]** Date-nav components seem simple, but if today-state, loading-state, or current-context cues are too subtle users can lose orientation while moving quickly through the scheduler → Make today, loading, and active-range cues more explicit so the nav anchors the rest of the scheduler more confidently.

### StaffProfileCard (dashboard/components/scheduler/StaffProfileCard.tsx)
- **[medium]** Read-only profile cards only help if they feel more legible than the dense scheduler beneath them, and weak focus/close behavior or overly compact sections can make them feel fragile → Strengthen focus management, close affordance clarity, and section hierarchy so the card feels like a reliable companion surface.

### StaffSwimLaneView (dashboard/components/scheduler/StaffSwimLaneView.tsx)
- **[high]** Shift editing inside swimlanes appears heavily mouse-driven, and if drag, resize, and delete affordances are not backed by clearer non-pointer cues the scheduler becomes harder to trust and harder to use accessibly → Strengthen keyboard-accessible shift actions, drag-state clarity, and delete confirmation patterns so lane editing feels robust.

### TimeGrid (dashboard/components/scheduler/TimeGrid.tsx)
- **[low]** Time-grid headers seem simple, but if hour context is too visually lightweight or not sticky enough relative to scrolling content users can lose orientation during longer scheduler scans → Strengthen hour-header context and anchoring so the grid remains easy to read while navigating horizontally.

## Review — 2026-04-30

### SkillMapColumn (dashboard/components/skill-map/SkillMapColumn.tsx)
- **[medium]** Column shells in graph UIs need explicit empty-state treatment, and without it blank lanes can read like failed rendering or incomplete data rather than intentional sparsity → Add clearer empty-lane messaging so users can tell when a column genuinely has no nodes.

### SkillMapConnections (dashboard/components/skill-map/SkillMapConnections.tsx)
- **[medium]** Connection overlays are visually strong when populated, but without a no-connections or fallback state the map can feel silently incomplete whenever nothing is drawable → Add lightweight no-connection or graph-stabilizing treatment so absent lines read as intentional, not broken.

### SkillMapFixPanel (dashboard/components/skill-map/SkillMapFixPanel.tsx)
- **[medium]** Repair panels need unusually clear success, failure, and no-eligible-option feedback because users are already addressing a broken state → Strengthen inline error/success and empty-option messaging so the repair flow feels trustworthy instead of dead-ended.

### SkillMapNode (dashboard/components/skill-map/SkillMapNode.tsx)
- **[medium]** Dense node cards can bury their most important actions when icon-only controls, fix affordances, and selection states all compete in a small surface → Make link/fix actions and selected or broken-state cues more explicit so node actions stay discoverable under visual density.

### SkillRelationshipMap (dashboard/components/skill-map/SkillRelationshipMap.tsx)
- **[high]** The overall map experience is visually strong, but the interaction model still depends heavily on pointer behavior, tiny affordances, and sparse-state interpretation, which makes the feature harder to trust as the graph gets dense or empty → Add stronger keyboard-operable structure plus clearer top-level empty/loading guidance so the map remains understandable beyond mouse-driven exploration.

## Review — 2026-05-01

### SettingsView (dashboard/components/SettingsView.tsx)
- **[medium]** The calendar connection cards are hand-rolled `<button>` elements with inline hover mutation instead of the shared Button/Card primitives, which makes this settings surface more likely to drift in focus styling, disabled treatment, and theme behavior than similar actions elsewhere → Rebuild the Google and Outlook connect affordances with the shared UI primitives and CSS-variable styling so they inherit consistent keyboard, loading, and theme behavior.
- **[medium]** Resource create and toggle failures fall back to `console.error` with no user-facing error state, so a failed save or status change can look like the click simply did nothing → Surface inline or toast error feedback for resource mutations and preserve the pending state long enough for operators to tell whether the action succeeded.

### SetupWizard.tsx (dashboard/components/SetupWizard.tsx)
- **[low]** This file is only a one-line re-export of `./SetupWizard/index`, which leaves two parallel component entry paths to maintain and review for the same shell → Collapse to one canonical import path or add a clear convention so future edits and review passes do not treat this alias as a separate UX surface.

### StepReview (dashboard/components/SetupWizard/StepReview.tsx)
- **[high]** When services exist but `coverageData` is still empty after loading, the review step drops the entire coverage section and status message, which makes a high-stakes final check feel incomplete instead of clearly blocked or unavailable → Add an explicit no-coverage-yet state that explains whether assignments were not checked, coverage could not be calculated, or setup is still incomplete.
- **[medium]** The review step hardcodes `gray` and `dark:bg-[#222]` colors instead of leaning on the theme CSS variables used elsewhere, so this summary screen is more likely to look off-brand or inconsistent across the project’s eight dark themes → Move these surfaces onto the shared theme tokens so the final setup review stays visually consistent with the rest of the dashboard.
