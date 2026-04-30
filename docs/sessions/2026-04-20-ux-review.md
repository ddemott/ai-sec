## Review — 2026-04-20

### AIConfigView (dashboard/components/AIConfigView.tsx)
- **[medium]** AI configuration surfaces often mix defaults, generated content, and editable controls in one place, and without strong save/error/loading framing they can feel more fragile than they are → Add explicit shell-state and save-result treatment so users can tell when configuration is loading, changed, or failed to persist.

### AIInsightsView (dashboard/components/AIInsightsView.tsx)
- **[medium]** Insight-heavy views need clear section-level empty and unavailable states, especially when some AI data is still sparse or partially integrated → Differentiate no-data-yet, unavailable, and loaded states more clearly so missing insight content reads as intentional rather than broken.

### AnalyticsView (dashboard/components/AnalyticsView.tsx)
- **[high]** Analytics screens are trust-sensitive because they mix live metrics, placeholders, and sparse data windows, and without strong state framing users can misread unfinished sections as product bugs → Separate live metrics, pending integrations, and empty data states more clearly so the page stays honest without feeling unfinished.

## Review — 2026-04-20

### AppointmentView (dashboard/components/AppointmentView.tsx)
- **[high]** List-detail appointment views tend to accumulate a lot of selection and refresh state at the shell level, and without explicit loading, empty-selection, and mutation-result treatment they can feel unpredictable under fast front-desk use → Strengthen shell-state handling for first load, selection reset, and post-mutation refresh so the screen feels stable while users move quickly.

### AppointmentListSidebar (dashboard/components/AppointmentListSidebar.tsx)
- **[medium]** Appointment sidebars need strong differentiation between empty schedules, filtered no-results, and active selection context, and compact rows can otherwise blur those states together → Add clearer no-results, no-appointments, and selected-row cues so the sidebar remains easy to scan.

### AppointmentDetailPanel (dashboard/components/AppointmentDetailPanel.tsx)
- **[medium]** Detail panels that combine status, customer context, and edit actions can feel risky if read-only information and mutation affordances are not clearly separated → Make read-only sections, editable controls, and save/error feedback more explicit so detail work feels trustworthy.

## Review — 2026-04-20

### BusinessSettingsView (dashboard/components/BusinessSettingsView.tsx)
- **[medium]** Business settings screens often mix long-lived configuration, defaults, and edit actions in one dense surface, and without strong save-state feedback users can be left unsure what actually changed → Strengthen dirty-state, save-result, and empty/default-state cues so the page feels controlled rather than form-heavy.

### CRMIntegrationCard (dashboard/components/CRMIntegrationCard.tsx)
- **[medium]** Integration cards need especially clear connected, reconnect-needed, syncing, and failed states, and compact cards can blur those statuses if they lean too heavily on small badges and button text → Differentiate integration health states more clearly so users can understand account status at a glance.

### CRMView (dashboard/components/CRMView.tsx)
- **[high]** CRM management views usually combine connection state, mapping context, and record management, and if loading, reconnect, or sync-result states are not explicit the whole screen can feel brittle during real troubleshooting → Clarify shell-state, reconnect-state, and sync-result feedback so the screen feels dependable during operational use.

## Review — 2026-04-20

### CustomerDetailPanel (dashboard/components/CustomerDetailPanel.tsx)
- **[medium]** Customer detail panels often carry history, contact context, and action affordances in one vertical surface, and if read-only data, next actions, and sparse-history states are not clearly separated the panel can feel crowded → Strengthen section boundaries and empty-history/no-contact-state treatment so the panel remains easy to interpret.

### DashboardHome (dashboard/components/DashboardHome.tsx)
- **[medium]** Home dashboards set the tone for the whole product, and when loading, sparse tenant data, or unavailable summaries are not explicitly framed the screen can feel half-finished during first use → Add clearer first-load, no-data, and unavailable-summary treatment so the home screen feels intentional even when data is thin.

### DeletedRecordsPanel (dashboard/components/DeletedRecordsPanel.tsx)
- **[high]** Recovery surfaces need unusually strong feedback because users are judging risk as they act, and subtle restore/result states can make the whole flow feel unsafe → Make preview, restore confirmation, and restore-result feedback much more explicit so users understand exactly what is recoverable and what happened after they act.

## Review — 2026-04-20

### EmployeeManagementView (dashboard/components/EmployeeManagementView.tsx)
- **[medium]** Employee admin views often combine directory management, role details, and status changes in one dense screen, and without clear shell-state and mutation feedback they can feel busier than they need to → Strengthen empty, no-results, and save/delete-result states so the screen feels operational rather than crowded.

### ErrorBoundary (dashboard/components/ErrorBoundary.tsx)
- **[high]** Error boundaries are trust-critical recovery surfaces, and if the fallback is too minimal users can feel trapped the moment something breaks → Add clearer recovery actions, navigation options, and calm explanatory copy so failures feel recoverable instead of terminal.

### KnowledgeBaseView (dashboard/components/KnowledgeBaseView.tsx)
- **[medium]** Knowledge surfaces swing between sparse and dense states quickly, and without strong empty, search, and action-result framing users can struggle to tell whether content is missing, filtered out, or still loading → Strengthen no-content, no-results, and save/result feedback so the screen remains legible across those states.

## Review — 2026-04-20

### LoginView (dashboard/components/LoginView.tsx)
- **[medium]** Login screens need unusually clear loading and failure feedback because users have almost no context when something goes wrong, and a generic spinner or error can make the whole app feel unavailable → Differentiate invalid credentials, backend-unreachable, and in-flight login states more clearly so users know what to do next.

### MyBusinessView (dashboard/components/MyBusinessView.tsx)
- **[medium]** Business profile screens often mix stable settings with generated or suggested content, and without strong save-state framing users can lose track of what is editable versus merely informative → Clarify dirty-state, save-result, and informational-versus-editable sections so the screen feels controlled rather than dense.

### MyTeamView (dashboard/components/MyTeamView.tsx)
- **[medium]** Team pages often need to serve both first-run onboarding and ongoing management, and when those modes are not clearly separated the screen can feel awkward in sparse-team states → Add stronger no-team-yet, invite/add, and active-management framing so the view adapts more gracefully to team maturity.

## Review — 2026-04-20

### BusinessTypePicker (dashboard/components/SetupWizard/BusinessTypePicker.tsx)
- **[medium]** Business-type selection is an early trust-building moment, and when search, suggestions, and selected-state cues are too visually busy users can feel less certain than they should at the start of onboarding → Strengthen first-load guidance, no-results treatment, and selected-state clarity so the picker feels decisive instead of crowded.

### SoloStepHours (dashboard/components/SetupWizard/SoloStepHours.tsx)
- **[medium]** Hours setup steps often mix repetitive editing with bulk actions, and without strong changed-versus-saved feedback users can lose confidence in what schedule they have actually configured → Clarify copied-state, unsaved-change, and save-result feedback so the step feels dependable.

### SoloStepReview (dashboard/components/SetupWizard/SoloStepReview.tsx)
- **[high]** Review steps are where users decide whether they trust the setup enough to continue, and if ready, blocked, and partially complete states are not unmistakable the whole wizard can feel uncertain at the finish line → Strengthen readiness framing so users can tell exactly whether they are safe to proceed.

## Review — 2026-04-20

### SoloWizard (dashboard/components/SetupWizard/SoloWizard.tsx)
- **[high]** Solo wizard shells quietly control progress trust across the whole onboarding experience, and if step memory, back/forward behavior, or shell loading are inconsistent users can feel the flow is fragile even when individual steps work → Strengthen progress continuity, step retention, and shell-level loading/error treatment so the solo flow feels dependable end to end.

### Step7GoLive (dashboard/components/SetupWizard/Step7GoLive.tsx)
- **[high]** Go-live steps are the highest-stakes moment in onboarding, and if activation, blocked prerequisites, or failure recovery are not unmistakable users can hesitate right at the finish line → Differentiate ready, activating, activated, and blocked states much more clearly so the final action feels safe and conclusive.

### StepAssignments (dashboard/components/SetupWizard/StepAssignments.tsx)
- **[medium]** Assignment setup gets visually dense quickly, and without clear unmapped, partially mapped, and saved-state cues users can struggle to tell what still needs attention → Make incomplete versus complete mapping states and save feedback more explicit so the step feels like a workflow instead of a puzzle.

## Review — 2026-04-20

### ResourceManagerView (dashboard/components/ResourceManagerView.tsx)
- **[medium]** Resource management screens can feel busier than they are when capabilities, availability, and edit actions sit together without strong state separation → Clarify empty, editing, and mutation-result states so the screen feels operational rather than crowded.

### SchedulerView (dashboard/components/SchedulerView.tsx)
- **[high]** Scheduler shell views set expectations for every downstream interaction, and if mode-switching, loading, or empty-day states are not explicit the entire scheduler can feel unstable before users even reach details → Strengthen top-level shell-state treatment so the scheduler reads as intentionally dense rather than half-loaded.

### ServiceAssignmentView (dashboard/components/ServiceAssignmentView.tsx)
- **[medium]** Assignment mapping screens become visually heavy fast, and without clear first-run, unmapped, and partial-coverage cues users can struggle to tell whether they are looking at setup gaps or filtered data → Make incomplete versus complete assignment states more explicit so the mapping step feels actionable.

## Review — 2026-04-20

### StepEmployees (dashboard/components/SetupWizard/StepEmployees.tsx)
- **[medium]** Employee setup steps can feel heavier than they need to when first-run guidance, edit actions, and sparse-state management all share one surface without clear hierarchy → Strengthen first-run guidance, row-state clarity, and add/edit/result feedback so the step feels like progressive setup instead of admin overhead.

### StepResources (dashboard/components/SetupWizard/StepResources.tsx)
- **[medium]** Resource setup is often repetitive by nature, and without clear distinction between scaffolding new resources and refining existing ones the step can feel muddy → Clarify first-run, existing-resource edit, and action-result states so users can tell what mode they are in.

### StepServices (dashboard/components/SetupWizard/StepServices.tsx)
- **[high]** Service definition is foundational for the rest of onboarding, and if incomplete duration/coverage information is not clearly surfaced users can proceed with weak downstream setup without realizing it → Strengthen incomplete-service, saved-service, and readiness cues so users understand when the step is truly in good shape to continue.

## Review — 2026-04-20

### OutlookLayout (dashboard/components/OutlookLayout.tsx)
- **[medium]** Layout shells quietly shape every downstream interaction, and if focus transitions, tab state, or smaller-viewport behavior are weak the entire app can feel less stable than the underlying screens really are → Strengthen focus visibility, active-tab clarity, and narrow-layout behavior so the shell feels dependable as the app’s main scaffold.

### ProfileView (dashboard/components/ProfileView.tsx)
- **[low]** Profile screens are usually simple, but they can still feel oddly passive if it is not clear what is informational versus editable or what happens after a change → Clarify whether fields are read-only or editable and make save/result messaging more explicit so the screen feels intentional.

### RecordHistoryModal (dashboard/components/RecordHistoryModal.tsx)
- **[high]** History and restore modals are high-trust surfaces, and if focus handling, comparison state, or restore-result feedback are subtle users can lose confidence quickly → Strengthen modal focus behavior, comparison-state clarity, and restore-result feedback so the history flow feels safe and understandable.

### StepShifts (dashboard/components/SetupWizard/StepShifts.tsx)
- **[high]** Shift setup is easy to get subtly wrong, and if copied hours, off-day states, or empty schedules are not unmistakable users can leave onboarding with broken staffing assumptions → Strengthen first-run, copied-state, and off-day feedback so users can tell exactly what schedule coverage they have configured.

### WizardModeChooser (dashboard/components/SetupWizard/WizardModeChooser.tsx)
- **[medium]** Mode-chooser steps are decision points, and if the consequences of solo versus team setup are not framed clearly enough users can make the choice without confidence → Clarify the fit and consequences of each mode so the decision feels informed rather than arbitrary.

### WizardStepContent (dashboard/components/SetupWizard/WizardStepContent.tsx)
- **[medium]** Shared step-shell components set the pacing and trust for the whole wizard, and if blocked, loading, or progression cues are too subtle the flow can feel inconsistent from step to step → Strengthen shared blocked, loading, and progression treatment so each step feels like part of one coherent setup system.

## Review — 2026-04-20

### SuperAdminDashboard (dashboard/components/SuperAdminDashboard.tsx)
- **[high]** Super-admin surfaces combine high-impact actions with broad system visibility, and if activation, tenant state, and destructive actions are not clearly tiered the screen can feel riskier than it needs to → Strengthen action hierarchy, state clarity, and action-result feedback so global operations feel controlled and deliberate.

### TenantCard (dashboard/components/TenantCard.tsx)
- **[medium]** Tenant cards are at-a-glance operational surfaces, and compact layouts can blur provisioning, active, and problem states when they lean too heavily on small badges or terse labels → Differentiate tenant-health states more clearly so the cards stay scannable without drilling in.

### TenantCreateForm (dashboard/components/TenantCreateForm.tsx)
- **[medium]** Tenant creation is a trust-sensitive form flow, and if required fields, defaults, or validation problems are not explicit users can hesitate before submitting or miss what is wrong → Strengthen required-field guidance, inline validation visibility, and post-submit feedback so creation feels predictable.

### TenantEditPanel (dashboard/components/TenantEditPanel.tsx)
- **[medium]** Edit panels need very clear dirty, saving, and cancel/discard states, and subtle feedback can leave users unsure what has actually changed → Make dirty-state and save-result cues more obvious so tenant edits feel controlled rather than fragile.

## Review — 2026-04-20

### ShiftManagementView (dashboard/components/ShiftManagementView.tsx)
- **[high]** Shift management is a high-consequence scheduling surface, and if copied hours, exceptions, or current coverage cues are not explicit users can make subtle staffing mistakes without noticing → Strengthen copied-state, override/off-day, and save-result feedback so the schedule users see is unambiguous.

### SkillManagementView (dashboard/components/SkillManagementView.tsx)
- **[medium]** Skill admin screens sit between simple CRUD and operational setup, and if create/edit/delete flows share one dense panel without strong empty and confirmation feedback the screen can feel brittle → Clarify empty-state guidance, mutation feedback, and destructive-action affordances so skill editing feels safe and straightforward.

### SkillMatrixView (dashboard/components/SkillMatrixView.tsx)
- **[medium]** Matrix-style views become visually dense quickly, and without strong legend, partial-state, or no-data treatment users can struggle to tell whether the grid is incomplete, filtered, or genuinely sparse → Add clearer matrix-state framing so empty intersections, missing skills, and partial coverage are easier to interpret at a glance.

## Review — 2026-04-20

### AppointmentBlock (dashboard/components/scheduler/AppointmentBlock.tsx)
- **[medium]** Dense appointment blocks live at the heart of scheduling, and if status, ownership, or truncated-content cues are too subtle users can miss important differences while scanning quickly → Strengthen compact-state hierarchy so status and truncation remain obvious even in the smallest block states.

### AppointmentListView (dashboard/components/scheduler/AppointmentListView.tsx)
- **[medium]** Scheduler list views need clear differentiation between empty days, filtered no-results, and warning states, and compact rows can otherwise blur those contexts together → Add stronger no-results, sparse-day, and warning-state treatment so the list reads intentionally under fast front-desk use.

### AppointmentPopover (dashboard/components/scheduler/AppointmentPopover.tsx)
- **[high]** Scheduler popovers are high-frequency detail surfaces, and if focus handling, close behavior, or action/result feedback are weak they undermine trust in the whole scheduler → Strengthen focus/close behavior and action-state clarity so the popover feels like a dependable scheduler extension rather than a fragile overlay.

## Review — 2026-04-20

### EmployeeDayFocusPanel (dashboard/components/scheduler/EmployeeDayFocusPanel.tsx)
- **[medium]** Focus panels only help when they make state clearer than the main scheduler, and if no-selection, empty-day, or no-shift states are too subtle the panel can feel like dead space → Strengthen no-selection, no-shifts, and no-appointments states so the panel stays informative instead of going blank.

### NewSchedulerView (dashboard/components/scheduler/NewSchedulerView.tsx)
- **[high]** The scheduler shell sets trust for the whole feature, and if top-level loading, mode-switching, or empty-day states are not explicit the interface can feel unstable before users even interact with details → Clarify top-level loading, mode-switch, and empty-day shells so the scheduler reads as intentionally dense rather than half-loaded.

### QuickBookPanel (dashboard/components/scheduler/QuickBookPanel.tsx)
- **[medium]** Quick-book panels are speed surfaces, and subtle search failures, missing prerequisites, or booking-result states can make them feel unreliable very quickly → Strengthen no-results, blocked-prerequisite, and booking-result feedback so the panel stays fast without becoming opaque.

## Review — 2026-04-20

### ResourceColumnsView (dashboard/components/scheduler/ResourceColumnsView.tsx)
- **[medium]** Resource-column schedulers can become visually confusing when empty resources, low-coverage stretches, and actual appointment gaps all look too similar → Strengthen empty-resource, unavailable-resource, and sparse-schedule treatment so the columns are easier to interpret at a glance.

### SchedulerDateNav (dashboard/components/scheduler/SchedulerDateNav.tsx)
- **[low]** Date-nav components seem simple, but if today-state, loading-state, or current-context cues are too subtle users can lose orientation while moving quickly through the scheduler → Make today, loading, and active-range cues more explicit so the nav anchors the rest of the scheduler more confidently.

### StaffProfileCard (dashboard/components/scheduler/StaffProfileCard.tsx)
- **[medium]** Read-only profile cards only help if they feel more legible than the dense scheduler beneath them, and weak focus/close behavior or overly compact sections can make them feel fragile → Strengthen focus management, close affordance clarity, and section hierarchy so the card feels like a reliable companion surface.

## Review — 2026-04-20

### SetupWizard/index.tsx (dashboard/components/SetupWizard/index.tsx)
- **[medium]** Wizard entry components shape the first impression of onboarding, and if initial loading, mode selection, or progress continuity are not clearly framed the whole setup flow can start with uncertainty → Strengthen initial shell-state, entry guidance, and mode/progress continuity so setup feels coherent from the first screen.

### VoiceCallsView (dashboard/components/VoiceCallsView.tsx)
- **[medium]** Voice activity screens often mix sparse histories, live-ish status cues, and operational troubleshooting, and without strong loading/no-calls/error framing they can feel half-loaded even when they are simply empty → Differentiate loading, no-calls-yet, and failed-fetch states more clearly so the surface feels intentional.

### StaffSwimLaneView (dashboard/components/scheduler/StaffSwimLaneView.tsx)
- **[high]** Shift editing inside swimlanes appears heavily mouse-driven, and if drag, resize, and delete affordances are not backed by clearer non-pointer cues the scheduler becomes harder to trust and harder to use accessibly → Strengthen keyboard-accessible shift actions, drag-state clarity, and delete confirmation patterns so lane editing feels robust.

### TimeGrid (dashboard/components/scheduler/TimeGrid.tsx)
- **[low]** Time-grid headers seem simple, but if hour context is too visually lightweight or not sticky enough relative to scrolling content users can lose orientation during longer scheduler scans → Strengthen hour-header context and anchoring so the grid remains easy to read while navigating horizontally.

## Review — 2026-04-20

### SkillMapColumn (dashboard/components/skill-map/SkillMapColumn.tsx)
- **[medium]** Graph columns need stronger empty-lane framing than ordinary lists, and without it sparse skill-map states can read like missing data or failed rendering → Add explicit empty-lane treatment so users can tell when a column is intentionally empty.

### SkillMapConnections (dashboard/components/skill-map/SkillMapConnections.tsx)
- **[medium]** Connection layers are visually expressive but can become opaque when there are no lines, broken refs, or mid-layout transitions, because the absence of edges has no explanation → Add lightweight no-connections and graph-stabilizing treatment so silent emptiness does not feel like a rendering fault.

### SkillMapFixPanel (dashboard/components/skill-map/SkillMapFixPanel.tsx)
- **[medium]** Fix panels are high-intent repair flows, and if assignment failures or no-eligible-target states only surface through tiny text or console errors the panel feels unreliable → Strengthen inline error, empty, and success feedback so the repair workflow feels trustworthy.

### SkillMapNode (dashboard/components/skill-map/SkillMapNode.tsx)
- **[medium]** Node cards carry dense micro-interactions, and raw icon actions plus overlapping broken/linking states can become hard to parse, especially for keyboard users → Strengthen focus, action clarity, and state hierarchy so link mode and broken-state actions remain obvious in dense maps.

### SkillRelationshipMap (dashboard/components/skill-map/SkillRelationshipMap.tsx)
- **[high]** The overall graph experience is visually strong, but without stronger keyboard guidance, top-level empty/error states, and clearer structural wayfinding it can still feel mouse-dependent and fragile under sparse data → Add keyboard-oriented guidance plus explicit empty/error shells so the map remains understandable beyond ideal loaded states.

## Review — 2026-04-21

### SettingsView (dashboard/components/SettingsView.tsx)
- **[high]** The calendar connect actions are raw `<button>` elements with hover-only icon reveal and no shared loading treatment (`dashboard/components/SettingsView.tsx:233-258`), which breaks the project’s primitive-reuse pattern and gives keyboard users less state feedback than the rest of the dashboard → Replace these with the shared `Button` primitive and keep provider-specific styling as decoration inside the button body so loading, focus, and disabled states stay consistent.
- **[medium]** Resource create/update failures only hit `console.error` (`dashboard/components/SettingsView.tsx:139-164`), so the list can silently fail while the UI keeps looking healthy → Surface those failures inline or via toast and preserve the attempted form state so users understand that nothing changed.

### SetupWizard (dashboard/components/SetupWizard.tsx)
- **[low]** This file is only a one-line re-export (`dashboard/components/SetupWizard.tsx:1`) while the real component entry already lives at `dashboard/components/SetupWizard/index.tsx`, which adds one more place to hunt when tracing imports → Either remove the wrapper if nothing depends on the flat path anymore or leave a short comment explaining that the alias exists intentionally for import stability.

### StepReview (dashboard/components/SetupWizard/StepReview.tsx)
- **[medium]** The summary cards are locked to `grid-cols-3` with no small-screen fallback (`dashboard/components/SetupWizard/StepReview.tsx:22-34`), so the final review step will stay cramped on narrower viewports right when users are checking readiness → Switch to a stacked or two-column breakpoint pattern before three columns so the review state remains scannable on tablet and small laptop widths.
- **[high]** When services exist but coverage data is empty after loading, the component renders no coverage section and no explanation (`dashboard/components/SetupWizard/StepReview.tsx:38-57`), which makes the final step look half-loaded instead of intentionally incomplete → Add an explicit unavailable/error-empty state for “services exist but coverage could not be calculated yet” so users know whether to retry, go back, or continue cautiously.
