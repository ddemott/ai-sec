## Review — 2026-05-27

### AIConfigView (dashboard/components/AIConfigView.tsx)

- **[high]** Persona/config surfaces are trust-sensitive because users are editing how the assistant speaks, and if loading, save, and fallback states are too subtle the page can make the AI feel less deterministic than it should → Strengthen field-level save feedback, loading continuity, and any fallback/default-state messaging so changes to the AI persona feel explicit and dependable.
- **[medium]** AI configuration views often drift into custom tabs, chips, and action controls that sit slightly outside the rest of the dashboard system → Keep configuration controls aligned with shared form and action primitives so the persona editor feels like part of the same product, not a special-case console.

### AIInsightsView (dashboard/components/AIInsightsView.tsx)

- **[medium]** This shell combines persona, knowledge, and analytics under one tab family, which is coherent, but users are still crossing from configuration tasks into observational/reporting tasks without much shell-level framing → Make the mode shift between “configure the AI” and “observe the AI” a little clearer so the mixed sub-tabs feel intentional rather than bundled.
- **[low]** The tab strip keeps the body scrollable underneath, which is practical, but when long knowledge-base content or analytics views scroll deeply it may be easy to lose orientation about which AI section is currently active → Strengthen active-tab persistence and section framing so the shell remains orienting during long vertical scrolls.

### AnalyticsView (dashboard/components/AnalyticsView.tsx)

- **[high]** The analytics cards still use red/amber/green return-rate and no-show framing that reads like business grading, which directly conflicts with the product rule to show data without warnings, grades, or opinions → Replace evaluative color semantics and helper copy with neutral operational descriptions that explain the metric without implying good or bad performance.
- **[medium]** Analytics pages often contain many placeholder, empty, and loading cards side by side, and if those states are not visually distinct users can mistake “no data yet” for broken widgets → Make empty, placeholder, and loading treatments more clearly separated so the dashboard communicates data maturity without confusion.

## Review — 2026-05-27

### AppointmentView (dashboard/components/AppointmentView.tsx)

- **[high]** Appointment management is one of the dashboard’s core operational surfaces, and if creation, selection, editing, and mobile-detail transitions are not tightly coordinated the page can quickly feel fragile under real front-desk use → Strengthen shell-level continuity between list, detail, and create states so operators always know whether they are browsing, editing, or creating a booking.
- **[medium]** Views like this often accrete custom filters, date controls, and side effects around shared booking primitives, which makes them especially prone to layout and state drift relative to the newer scheduler surfaces → Keep the main appointment shell aligned with the scheduler and other list-detail patterns so booking operations feel like one connected system.

### AppointmentListSidebar (dashboard/components/AppointmentListSidebar.tsx)

- **[medium]** Sidebars that carry dense appointment lists need especially strong empty, loading, and selection states, and otherwise users can lose confidence about whether a day is empty or the list simply has not caught up yet → Sharpen the distinction between no bookings, filtered-no-results, and loading states so the sidebar remains trustworthy during fast scheduling work.
- **[medium]** Appointment lists are often the first place where cancellation, lateness, or unassigned-work states show up, so if row summaries do not surface those differences clearly operators have to click into detail too often → Increase row-level state clarity so the list answers more operational questions before a detail panel is opened.

### AppointmentDetailPanel (dashboard/components/AppointmentDetailPanel.tsx)

- **[high]** This panel packs customer editing, assignment alignment checks, service selection, notes, navigation, and destructive actions into one dense editor, which can make routine booking edits feel more complicated than they should → Separate summary, scheduling, assignment, and customer-edit concerns more clearly so operators can scan the panel in functional chunks.
- **[medium]** The read-only summary card still uses narrative copy like “The AI has verified availability,” which drifts from neutral operational data into reassuring narration and can feel oddly interpretive for a detail surface → Replace the prose summary with direct factual fields about service, resource, employee, and timing so the panel stays informative without commentary.

## Review — 2026-05-27

### BusinessSettingsView (dashboard/components/BusinessSettingsView.tsx)

- **[high]** Business settings screens usually mix long-lived configuration with occasionally changed operational values, and if save scope and validation feedback are not explicit users can become unsure which changes are already live → Strengthen section-level save clarity and validation feedback so business configuration feels deliberate and dependable.
- **[medium]** Settings pages often drift into custom cards and action rows that sit just outside the rest of the dashboard’s primitive system, which makes them feel more like a separate admin tool than part of the product → Keep the settings surface aligned with shared card, input, and action primitives so it stays visually consistent with other owner-facing views.

### CRMIntegrationCard (dashboard/components/CRMIntegrationCard.tsx)

- **[medium]** Integration cards are trust-sensitive because they represent an external system handshake, and if connecting, connected, syncing, and failed states are not unmistakable users can feel uncertain about the actual system-of-record status → Make provider state transitions and post-action outcomes more explicit so each CRM card communicates a clear integration lifecycle.
- **[medium]** These cards bundle provider-specific icons, buttons, and helper copy into one reusable pattern, which is good, but they still need strong consistency with shared primitives so each provider card does not feel like a slightly different mini-app → Tighten the card’s action hierarchy and state styling around shared button and badge patterns so all integrations feel uniform.

### CRMView (dashboard/components/CRMView.tsx)

- **[high]** This view combines search, list-detail navigation, appointment history, call summaries, and customer editing in one dense surface, and that makes it especially important that create, edit, and browse states remain unmistakable → Separate browsing, editing, and creating modes more clearly so front-desk users can move through customer operations without losing context.
- **[medium]** The reactivation and cancellation flows are operationally useful, but they can still read like warnings or exception banners if their copy and placement dominate the surrounding history view → Keep appointment-history state changes factual and task-oriented so CRM history remains informative without slipping into judgmental UI tone.

## Review — 2026-05-27

### DashboardHome (dashboard/components/DashboardHome.tsx)

- **[high]** Home dashboards are where users decide whether the system feels calm or chaotic, and if this surface mixes activity summaries, shortcuts, and first-run states without strong hierarchy it can quickly become cognitively noisy → Strengthen information hierarchy so today’s most important operational signals read clearly before lower-priority summary cards and shortcuts.
- **[medium]** Home views often accumulate role-specific cards and special-case banners over time, which can make the shell feel inconsistent across owners, admins, and front-desk staff → Keep role-based sections clearly partitioned so the page still feels like one coherent home view instead of stacked exceptions.

### ErrorBoundary (dashboard/components/ErrorBoundary.tsx)

- **[high]** Error boundaries are one of the few places where the product explicitly has to acknowledge failure, and if the fallback card is too generic users are left without a clear next step or confidence about what stayed safe → Make recovery actions and scope of failure much more explicit so the boundary reassures users about what they can retry, refresh, or safely ignore.
- **[medium]** Fallback UIs often end up visually detached from the rest of the app because they are built in isolation, which can make crashes feel more alarming than necessary → Keep the fallback layout and action styling aligned with the dashboard’s normal primitives so recovery still feels like part of the product.

### FirstRunTour (dashboard/components/FirstRunTour.tsx)

- **[medium]** The overview modal is a good lightweight onboarding choice, but it still behaves like a custom dialog without backdrop-close handling or stronger focus-management cues, which makes the very first post-setup experience feel slightly less polished than the shared modal system → Move the tour onto the shared modal primitive or bring its dismissal and focus behavior up to the same standard.
- **[medium]** Several tour cards depend on hover-only arrow reveal and descriptive text blocks, which works on desktop but gives less guidance on touch devices where hover never appears → Strengthen always-visible affordance cues so tapping into a destination feels equally obvious on touch and mouse-driven devices.

## Review — 2026-05-27

### BusinessTypeSection (dashboard/components/BusinessTypeSection.tsx)

- **[medium]** Business-type configuration has product-wide consequences, so if the explanation of what changes and what stays stable is not very explicit users can hesitate before making or reviewing the choice → Clarify the downstream effects of the selected business type so the section feels informative rather than mysterious.
- **[medium]** Sections like this often mix descriptive copy, selection controls, and persistence feedback in a small footprint, and without strong hierarchy it can be hard to tell whether the user is editing or just reviewing → Separate read-only summary from editable state more clearly so owners can understand the current business type at a glance.

### LoginView (dashboard/components/LoginView.tsx)

- **[high]** Login is the first trust checkpoint in the product, and if password visibility, loading, and auth-failure states are too subtle or too visually busy the entry experience can feel less dependable than it should → Strengthen loading and failed-login feedback while keeping the form hierarchy simple so the sign-in path feels calm and explicit.
- **[medium]** Authentication screens often grow custom inputs, toggles, and iconography that drift away from the rest of the dashboard’s primitives, which makes the first product interaction feel visually adjacent rather than integrated → Keep login controls tightly aligned with shared form and action treatments so the handoff into the app feels consistent.

### SetupProgressPill (dashboard/components/SetupProgressPill.tsx)

- **[medium]** The pill has better tooltip and URL-state behavior now, but it still disappears entirely on smaller screens with `hidden md:flex`, which means users most likely to benefit from a persistent setup nudge may lose it on tablet or compact laptop layouts → Preserve a compact-screen fallback so setup progress remains discoverable outside medium-plus viewports.
- **[low]** The richer tooltip is a real improvement, but it still depends on native hover/title behavior for most of its detail, which limits usefulness on touch devices and keeps the extra context mouse-first → Consider a tap-friendly disclosure or nearby inline cue so remaining-step detail is available without hover.

## Review — 2026-05-27

### BusinessTypePicker (dashboard/components/SetupWizard/BusinessTypePicker.tsx)

- **[medium]** Business-type selection is an early trust-building step, and if search, suggestion, and selected-state cues are too visually busy users can feel less certain than they should at the start of onboarding → Strengthen first-load guidance, no-results treatment, and selected-state clarity so the picker feels decisive instead of crowded.

### SoloStepHours (dashboard/components/SetupWizard/SoloStepHours.tsx)

- **[medium]** Hours setup steps often mix repetitive editing with bulk actions, and without strong changed-versus-saved feedback users can lose confidence in what schedule they have actually configured → Clarify copied-state, unsaved-change, and save-result feedback so the step feels dependable.

### SoloStepReview (dashboard/components/SetupWizard/SoloStepReview.tsx)

- **[high]** The finalized coverage summary still renders `full`, `partial`, and `uncovered` with green, yellow, and red pill styling, which turns the completion state into a grading surface and directly conflicts with the product rule against warnings, grades, or opinions → Reframe the final service summary as neutral connection or readiness facts and remove score-like color/status emphasis from the completion state.
- **[medium]** The “what we’ll set up for you” block is helpful, but the finalizing flow still hinges on a single primary action with limited pre-submit differentiation between missing setup and normal completion work → Make pre-finalization readiness and post-finalization outcome feedback more explicit so the last step feels conclusive rather than opaque.

## Review — 2026-05-27

### SoloWizard (dashboard/components/SetupWizard/SoloWizard.tsx)

- **[high]** Solo wizard shells quietly control trust across the whole onboarding experience, and if step memory, back/forward behavior, or shell loading are inconsistent users can feel the flow is fragile even when individual steps work → Strengthen progress continuity, step retention, and shell-level loading/error treatment so the solo flow feels dependable end to end.
- **[medium]** Long onboarding shells often end up re-implementing modal chrome, progress steps, and sticky action rows outside the shared primitive system, which makes them harder to keep aligned with the rest of the dashboard → Pull the shell closer to shared overlay and action patterns so onboarding feels like part of the main product, not a separate mini-app.

### Step7GoLive (dashboard/components/SetupWizard/Step7GoLive.tsx)

- **[high]** Go-live steps are the highest-stakes moment in onboarding, and if activation, blocked prerequisites, or failure recovery are not unmistakable users can hesitate right at the finish line → Differentiate ready, activating, activated, and blocked states much more clearly so the final action feels safe and conclusive.
- **[medium]** Phone activation views often drift into success or warning-heavy language because they represent real infrastructure actions, but this step still needs to stay factual rather than evaluative → Keep the activation copy and status styling operational and clear without slipping into alarm or celebration tones.

### StepAssignments (dashboard/components/SetupWizard/StepAssignments.tsx)

- **[medium]** Assignment setup gets visually dense quickly, and without clear unmapped, partially mapped, and saved-state cues users can struggle to tell what still needs attention → Make incomplete versus complete mapping states and save feedback more explicit so the step feels like a workflow instead of a puzzle.
- **[medium]** Employee and resource assignments are rendered as dense toggle chips with only color to communicate selection state, which weakens keyboard clarity and makes large service sets harder to scan accurately → Add stronger selected-state semantics and clearer grouping or hierarchy so mapping remains legible when many services and assignees are present.

## Review — 2026-05-27

### Step3Employees (dashboard/components/SetupWizard/StepEmployees.tsx)

- **[medium]** The employee rows use icon-only action buttons with `title` text but no visible labels or explicit `aria-label`s, which makes edit/delete controls less dependable for keyboard and assistive-tech users → Add `aria-label` text to each action button and promote destructive actions through the shared confirm pattern so team edits stay accessible and harder to misfire.
- **[medium]** The add-entry affordance and row actions rely on inline hover styling instead of the shared button treatment used elsewhere in the dashboard, so hover, focus, and disabled behavior can drift from the rest of the product → Rebuild the add and row action controls with dashboard UI primitives or shared utility classes so wizard interactions match the rest of the dark-theme system.

### Step2Resources (dashboard/components/SetupWizard/StepResources.tsx)

- **[medium]** Resource descriptions are truncated inside the list card with no obvious way to inspect the full text, which can make similarly named bays, chairs, or rooms hard to distinguish during setup → Preserve full descriptions via wrap, tooltip, or expandable detail so users can verify the right resource before editing or deleting it.
- **[medium]** Empty, loading, and save-error states are rendered as plain text in the same visual weight as normal content, so the step does not give much guidance when data is absent or a save fails → Upgrade these states into more intentional empty/error treatments with clearer next actions and stronger separation from the editable list.

### Step1Services (dashboard/components/SetupWizard/StepServices.tsx)

- **[medium]** The duration field handling is much safer now, but the step still relies on icon-only row actions plus inline hover styling, which weakens keyboard-focus visibility and creates another custom interaction surface inside a flow that should feel highly consistent → Move these controls onto shared button or icon-button primitives with visible focus treatment and built-in loading or disabled states.
- **[low]** The helper text about 15-minute rounding is useful, but it sits slightly detached from the validation and save flow, so users may still miss when their entered value will be normalized on save → Tie the rounding rule more directly to validation or preview feedback so duration normalization feels explicit rather than tucked away.

## Review — 2026-05-27

### Step4Shifts (dashboard/components/SetupWizard/StepShifts.tsx)

- **[high]** The day toggle buttons only show abbreviated weekday text and color changes, so users have to infer whether a row is interactive, selected, or off, which is especially shaky for keyboard and assistive-tech use → Add explicit pressed or selected semantics, clearer on/off copy, and visible focus treatment so shift editing reads like a form instead of a color puzzle.
- **[medium]** Start and end time fields are rendered as raw time inputs without labels tied to each weekday row, so the schedule grid is harder to scan and less accessible once multiple days are enabled → Add programmatic labels for each day and time pair and tighten the row layout so each enabled shift reads as a complete, self-describing unit.

### WizardModeChooser (dashboard/components/SetupWizard/WizardModeChooser.tsx)

- **[high]** This overlay behaves like a modal but does not use the shared modal primitive or show focus containment, so keyboard users can drift behind the chooser and the first onboarding decision can feel brittle → Move it onto the shared modal primitive or add proper focus containment, initial focus, and dismissal behavior so the chooser feels dependable.
- **[medium]** The two mode cards depend on inline hover styling and a custom green accent that differs from the project accent system, which makes the entry point feel visually separate from the rest of the dark-theme dashboard → Replace the custom hover wiring with shared primitive states and align both choices to the established accent tokens so the chooser feels like part of the same product.

### WizardStepContent (dashboard/components/SetupWizard/WizardStepContent.tsx)

- **[medium]** The step router is a long switch that manually threads nearly every prop through every branch, which makes the wizard shell harder to extend and easier to break when one step contract changes → Introduce a step-to-component mapping or narrower per-step prop objects so each branch only receives the data it actually uses.
- **[low]** The default branch silently returns `null`, which would collapse the body without any recovery cue if an invalid step value slips through → Provide a small fallback state or invariant error surface so step-routing failures are visible during development and less confusing in production.

## Review — 2026-05-27

### Step6Review (dashboard/components/SetupWizard/StepReview.tsx)

- **[high]** The review step still presents coverage with `allCovered`, `partial`, and warning-style readiness framing, which turns the setup summary into a grading surface and conflicts with the project rule against warnings, grades, or opinions → Reframe the coverage summary as neutral operational facts, using plain counts and explicit missing links instead of readiness-scoring language.
- **[medium]** Coverage rows only show a compact badge, so users who land here with partial setup still have to infer what is actually missing for each service → Expand each uncovered row with the concrete gap type, like no employee assignment, no resource assignment, or no scheduled coverage, so the step supports correction instead of just status display.

### WizardWelcome (dashboard/components/SetupWizard/WizardWelcome.tsx)

- **[medium]** The welcome modal declares dialog semantics, but it still behaves like a custom overlay rather than a shared modal primitive, which leaves the very first onboarding surface more fragile than the rest of the product’s dialogs → Move it onto the shared modal component or add the same dismissal and focus-management behavior it guarantees.
- **[medium]** The promise of “10 minutes” and “6 quick questions” can drift from the actual seven-step wizard and variable setup effort, which risks undermining trust before the user even starts → Update the copy to describe the setup in more durable, product-accurate terms that stay true even as steps or data requirements evolve.

### SetupWizard (dashboard/components/SetupWizard/index.tsx)

- **[high]** The shell now surfaces a seed warning, which is good, but the auto-seed path still runs as background work during the first open and can leave users unclear about whether starter services or resources are still loading, failed, or ready to edit → Make seed progress and retry options more explicit in the shell so onboarding state feels visible rather than ambient.
- **[medium]** The shell still implements its own dialog chrome, progress chips, gating toasts, and body-scroll locking instead of leaning on shared modal or state primitives, which makes the most complex onboarding flow harder to keep consistent with the rest of the dashboard → Extract the repeated shell behavior onto shared primitives or wrapper helpers so focus, dismissal, action states, and theming stay aligned across onboarding surfaces.

## Review — 2026-05-27

### MyBusinessView (dashboard/components/MyBusinessView.tsx)

- **[high]** “My business” screens usually concentrate business identity, hours, contact, and operational defaults into one owner-facing form, and if section boundaries plus save scope are not obvious users can lose confidence about what changed where → Strengthen section-level save and validation feedback so owners can edit business settings without second-guessing what is already live.
- **[medium]** Owner-configuration pages often accumulate special-case cards and embedded setup helpers over time, which makes them feel heavier than the rest of the product unless hierarchy stays disciplined → Keep the page’s summary, editable settings, and helper content clearly partitioned so the screen stays scannable.

### MyTeamView (dashboard/components/MyTeamView.tsx)

- **[high]** Team management views usually blend roster maintenance, activation status, and invitation or setup progress, and if those states are not clearly separated the page can make staffing changes feel riskier than they should → Differentiate active team members, incomplete setup, and destructive actions much more clearly so staff management feels safe and operationally crisp.
- **[medium]** Dense team pages often bury key empty and post-action states, like no staff yet, invite sent, or save failed, under the main list chrome → Give those states more deliberate visibility so the page still communicates clearly before a full roster exists.

### ProfileView (dashboard/components/ProfileView.tsx)

- **[medium]** The profile screen is calm and readable, but the theme picker is a grid of custom buttons rather than a shared segmented or selection primitive, which makes a simple preferences surface rely on bespoke interaction treatment → Rebuild the theme choices around a shared selectable-control pattern so focus, selected state, and keyboard behavior stay consistent.
- **[low]** The “Security” card ends in a “coming soon” placeholder, which leaves dead space on a short profile page and can make the surface feel unfinished rather than intentionally minimal → Either replace the placeholder with concrete current account facts or collapse the section until there is a real user action to offer.

## Review — 2026-05-27

### SettingsView (dashboard/components/SettingsView.tsx)

- **[high]** This file still mixes business settings, calendar connection, CRM integration, resource management, and a separate super-admin onboarding flow into one component with divergent headers and state trees, which makes the screen harder to reason about and more likely to drift between roles → Split the owner settings surface and super-admin onboarding surface into dedicated view components so each role gets a clearer, more maintainable layout.
- **[medium]** The calendar connect buttons still rely on custom button or card styling and hover-only affordances instead of the shared button/card primitives, so focus, disabled, and loading behavior can differ from the rest of the dashboard right where users are linking external systems → Rebuild the provider connect cards from shared interactive primitives so connection states stay visually and behaviorally consistent.

### TenantCard (dashboard/components/TenantCard.tsx)

- **[medium]** The entire card is clickable and draggable at once, which can make keyboard access and pointer intent ambiguous when users are trying to select a tenant versus reorder it → Separate the reorder handle from the selection action with clearer semantics, keyboard support, and a more explicit selected-state treatment.
- **[medium]** The tenant id preview truncates to eight characters without any hover, copy, or full-value disclosure, which makes it less useful when operators need to verify similar tenants during admin work → Add an accessible full-id reveal or copy affordance so the identifier remains practical instead of decorative.

### TenantCreateForm (dashboard/components/TenantCreateForm.tsx)

- **[medium]** The owner credential inputs still rely on placeholder-only context inside the two-column grids, so labels disappear once fields are filled and the form becomes harder to scan or review before submission → Promote visible labels for first name, last name, email, and password so the admin form remains legible throughout data entry.
- **[low]** The component still sorts templates inline during render, which is small but unnecessary repeated work in a form that may rerender on every keystroke → Memoize or pre-sort the template options upstream so the form stays focused on presentation rather than data reshaping.

## Review — 2026-05-27

### CustomerDetailPanel (dashboard/components/CustomerDetailPanel.tsx)

- **[high]** Customer detail panels usually blend profile facts, communication context, booking history, and edit actions in one narrow surface, and if those modes are not clearly chunked operators have to work too hard to figure out whether they are reviewing or modifying the customer → Separate read-only summary, editable fields, and operational actions more clearly so the panel supports fast front-desk scanning.
- **[medium]** Customer panels often become the place where sparse or missing contact data is most visible, and without intentional empty-state treatment the surface can feel unfinished rather than simply incomplete → Give absent phone, email, address, and history fields more deliberate empty-state presentation so the panel stays trustworthy with partial data.

### DeletedRecordsPanel (dashboard/components/DeletedRecordsPanel.tsx)

- **[high]** This is a strong recovery surface, but it still combines expand or collapse, restore, history, and field-copy workflows inside a dense accordion list, which can make the panel feel operationally risky when users are trying to undo something quickly → Separate the recovery actions more clearly and surface the safest next step first so deleted-record recovery feels more controlled.
- **[medium]** Search, loading, empty, and restore-in-progress states all exist here, yet the panel still leans heavily on inline list chrome and icon buttons, which can make state changes harder to notice during fast recovery work → Strengthen asynchronous feedback and action labeling so operators can tell what is loading, what is restorable, and what just changed.

### RecordHistoryModal (dashboard/components/RecordHistoryModal.tsx)

- **[high]** History and restore flows are high-trust recovery surfaces, and if version timelines, restore outcomes, or the difference between viewing and reverting are not unmistakable the modal can make people nervous about touching old records → Strengthen the separation between inspect, compare, and restore actions, and give restore success or failure much clearer feedback.
- **[medium]** Dense change-history views still become scroll-heavy walls of metadata and timeline rows, which makes it hard to understand what materially changed between versions before drilling into field-by-field detail → Improve entry hierarchy and summarization so the modal highlights meaningful differences before raw audit detail.

## Review — 2026-05-27

### AppointmentBlock (dashboard/components/scheduler/AppointmentBlock.tsx)

- **[medium]** Drag-to-move is mouse-driven only here, with no parallel keyboard affordance or visible fallback control for repositioning appointments, so a core scheduler interaction remains harder to discover and inaccessible for non-pointer users → Add a keyboard-accessible move pathway or explicit secondary action so appointment rescheduling is not locked behind horizontal drag.
- **[medium]** Narrow appointments collapse to a dot renderer plus tooltip or title text, which preserves density but makes same-day high-volume schedules harder to scan for customer identity at a glance → Add a compact inline label strategy or alternate overflow treatment for short appointments so dense days stay legible without forcing hover.

### AppointmentListView (dashboard/components/scheduler/AppointmentListView.tsx)

- **[high]** Gap warnings are shown as amber alert rows between appointments, which reads like the system is evaluating schedule quality rather than simply showing data and drifts from the product rule against warnings or opinions → Reframe long gaps as neutral schedule intervals or timeline separators so the list stays descriptive instead of judgmental.
- **[medium]** Completed appointments get a badge, but scheduled rows have no equivalent status treatment and canceled appointments disappear entirely, so the list view loses state consistency across the appointment lifecycle → Normalize status presentation across visible rows and give operators an intentional way to include or inspect canceled appointments when needed.

### AppointmentPopover (dashboard/components/scheduler/AppointmentPopover.tsx)

- **[medium]** The popover restores focus on close and handles Escape, but it still behaves like a lightweight dialog without any focus trap or explicit close control inside the card, which can leave keyboard users uncertain about how to exit once action buttons are present → Add a visible close affordance and tighten dialog-style keyboard behavior so the richer popover remains predictable as more actions accumulate.
- **[medium]** Edit and cancel actions are still custom-styled inline buttons rather than shared primitives, which makes one of the highest-frequency scheduler action surfaces more likely to drift in spacing, focus, and disabled behavior → Rebuild the action row with shared button primitives so appointment quick actions stay aligned with the rest of the dashboard system.

## Review — 2026-05-27

### ConflictModal (dashboard/components/scheduler/ConflictModal.tsx)

- **[medium]** The conflict modal gives useful context, but the suggested alternatives are still rendered as a flat list of buttons with dense inline metadata, which becomes harder to scan when several near-identical slots are returned → Group or visually separate time, employee, and resource details more clearly so operators can compare fallback slots quickly under booking pressure.
- **[medium]** The primary action text is always “Pick another time,” even when next-available suggestions are already on screen, so the footer does not fully acknowledge the richer recovery path the modal provides → Adjust the footer copy and hierarchy when alternatives exist so the escape path and the suggestion path feel coordinated instead of parallel.

### EmployeeDayFocusPanel (dashboard/components/scheduler/EmployeeDayFocusPanel.tsx)

- **[high]** The utilization number is still color-graded with green, yellow, and gray thresholds, which turns a factual staffing summary into an implicit performance signal and conflicts with the product rule against warnings, grades, or opinions → Present booked hours and shift coverage as neutral operational data, and remove threshold-based color judgment from the panel.
- **[medium]** The slide-in panel still does not show explicit dialog or landmark semantics, so keyboard and assistive-tech users get a visually obvious focus surface without equivalent structural cues → Add an appropriate complementary or dialog role, labeled heading association, and clearer focus entry behavior so the panel is as navigable as it is visible.

### SchedulerDateNav (dashboard/components/scheduler/SchedulerDateNav.tsx)

- **[medium]** The control has better touch targets and timezone-aware shortcuts now, but five 48px buttons plus a long-form date label can still crowd one horizontal row on narrower laptops or tablets → Add a responsive stacked or wrapped layout that preserves clear date context without forcing the chips and title to compete for space.
- **[low]** Yesterday, Today, and Tomorrow are strong shortcuts, but there is still no obvious direct jump from this control to a broader date picker or calendar view, so operators working beyond a ±1 day window may still have to hunt elsewhere in the scheduler shell → Pair the shortcut chips with a more explicit longer-range date affordance nearby so quick jumps and arbitrary jumps feel like one navigation system.

## Review — 2026-05-27

### NewSchedulerView (dashboard/components/scheduler/NewSchedulerView.tsx)

- **[high]** The new scheduler shell concentrates multiple dense subviews, overlays, and booking interactions into one orchestrating surface, which raises the risk that loading, selection, and overlay state changes feel fragile when operators are moving quickly → Strengthen shell-level empty, loading, and error continuity and keep cross-panel state transitions visibly coordinated so the scheduler feels dependable under rapid interaction.
- **[medium]** As the hub for multiple scheduler modes, this component is likely carrying a lot of routing and orchestration responsibility itself rather than delegating to smaller shells, which makes consistency drift more likely across subviews → Keep the top-level scheduler focused on mode switching and shared state, and push presentation-specific behavior down into narrower view components.

### QuickBookPanel (dashboard/components/scheduler/QuickBookPanel.tsx)

- **[high]** Quick-book flows are high-pressure by nature, and this panel packs multiple dependent booking fields into a tight side panel without much room for progressive explanation or recovery, which can make validation and dependency changes feel abrupt → Strengthen inline state transitions for employee, service, and resource dependencies, loading, and submit failure so fast booking feels reliable rather than brittle.
- **[medium]** As another slide-in scheduler surface, this panel still risks duplicating custom close, spacing, and action-row behavior instead of inheriting a shared drawer or modal pattern → Align it with the same shell conventions used by other scheduler overlays so operators do not have to relearn panel behavior across booking tasks.

### ResourceColumnsView (dashboard/components/scheduler/ResourceColumnsView.tsx)

- **[high]** Coverage bars still classify empty hourly slots as `gap`, which turns a neutral resource calendar into evaluative language and conflicts with the product rule against warnings or opinions → Rename and restyle empty resource time as neutral availability or open time so the view reports state without implying a problem.
- **[medium]** The view uses a wide horizontal matrix with a fixed label column and per-hour columns, which is efficient on desktop but likely to become cumbersome on smaller laptops or tablets when many resources are configured → Add a responsive fallback, like condensed labels or alternate stacked presentation, so resource scheduling remains usable before the table spills into constant side-scrolling.

## Review — 2026-05-27

### StaffProfileCard (dashboard/components/scheduler/StaffProfileCard.tsx)

- **[medium]** This popover acts like a focused detail panel with an actionable staffing control, but it still has no explicit dialog semantics or visible close affordance beyond outside click and Escape, which makes keyboard use less self-explanatory once the card is open → Add a visible close control and appropriate dialog or label semantics so the card remains predictable as an actionable overlay.
- **[medium]** The compact “Today” summary is useful, but it still needs clearer context about how booked work relates to scheduled time so the card answers an operational question instead of just showing small stats → Add a clearer relationship between booked time and shift span so the profile card tells a more useful story at a glance.

### StaffSwimLaneView (dashboard/components/scheduler/StaffSwimLaneView.tsx)

- **[medium]** Shift creation, move, resize, delete, and appointment dragging all share the same horizontal row surface, which gives power users a lot of control but also creates a crowded interaction model where affordances can be hard to discover or easy to mis-trigger → Separate the visual cues for shift editing versus appointment editing more clearly so operators can tell at a glance which layer they are manipulating.
- **[medium]** Destructive shift deletion is still hidden behind a hover-only inline action inside each shift block, which is difficult for touch users and easy to miss in a dense lane layout → Surface a more durable delete affordance or route deletion through a clearer contextual action pattern that works beyond hover.

### TimeGrid (dashboard/components/scheduler/TimeGrid.tsx)

- **[medium]** The scheduler’s background grid is doing a lot of heavy lifting for orientation, and the current hour-label strip remains visually subtle once appointments, shifts, and overlays stack on top of it → Differentiate hour boundaries, label hierarchy, and interactive overlays more clearly so the grid stays readable during long scheduling sessions.
- **[low]** The exported defaults cover a full 24-hour day, but the component itself still offers no built-in cues for when a consuming view has scrolled far from “business hours” or hidden relevant context off-screen → Pair the grid with stronger contextual cues in its consuming views about what slice of the day is currently in frame.

## Review — 2026-05-27

### SkillRelationshipMap (dashboard/components/skill-map/SkillRelationshipMap.tsx)

- **[high]** The footer still summarizes coverage with `full`, `partial`, and `uncovered` counts plus success, warning, and danger color language, which turns a structural relationship map into an evaluative grading surface and conflicts with the product rule against warnings or opinions → Reframe the footer and broken-chain language as neutral connection state, like fully linked, partially linked, and missing links, without score-like emphasis.
- **[medium]** Linking mode, broken-chain fixing, node selection, and disconnect-on-line-click all coexist in one canvas, which gives the map power but also creates a lot of interaction modes to remember at once → Make the current mode and next valid action more explicit near the banner or selection state so operators do not have to mentally track which click will select, connect, fix, or disconnect.
- **[medium]** The three-column map plus connection layer is visually compelling on wide screens, but it is likely to become cramped and scroll-heavy on narrower laptops when the node lists grow → Add a more deliberate responsive fallback or progressive disclosure strategy so the map remains readable before it turns into a dense horizontally scrolling diagram.

### SkillMapNode (dashboard/components/skill-map/SkillMapNode.tsx)

- **[medium]** Coverage still renders through score-like node states and broken-chain accents, which introduces grading semantics directly inside each node and keeps the map drifting toward judgment instead of neutral relationship data → Replace coverage wording and badge styling with neutral connection-state language that describes linkage without scoring it.
- **[medium]** Each node can be selected, linked, fixed, and connected through small inline affordances in a compact card, which gives expert users power but creates a fairly dense action model for first-time operators → Separate primary node selection from secondary link or fix actions more clearly so the next available action is easier to read at a glance.

### SkillMapConnections (dashboard/components/skill-map/SkillMapConnections.tsx)

- **[medium]** The connection layer is visually central to the map, but when many lines overlap the relationships can quickly become hard to trace without stronger hover or selection emphasis → Increase selected-path contrast and de-emphasize unrelated lines more aggressively so the active relationship remains readable in dense graphs.
- **[low]** SVG-style connection layers can be beautiful on large canvases but tend to lose clarity on smaller screens or at high density if line routing is too literal → Add more deliberate overlap handling or responsive simplification so the connection layer remains interpretable before it becomes decorative noise.

## Review — 2026-05-27

### SuperAdminDashboard (dashboard/components/SuperAdminDashboard.tsx)

- **[high]** The business search field is still rendered as a styled input with placeholder text but no active filtering logic or no-results handling, which creates a false affordance in one of the busiest admin views → Either wire the search box to actual tenant filtering with result and no-match states, or remove it until the interaction is complete so the sidebar does not promise work it cannot do.
- **[medium]** Reorder-save actions still use custom inline buttons and an amber bar that sit outside the shared action patterns used elsewhere, so a high-risk admin action ends up with inconsistent hierarchy and affordance quality → Rebuild the reorder banner with shared button treatments and clearer saved or unsaved messaging so drag-and-drop state feels deliberate.

### TenantEditPanel (dashboard/components/TenantEditPanel.tsx)

- **[high]** Phone activation, deactivation, global tenant attributes, and AI prompt editing still live in one long panel with mixed risk levels and no sectional save boundaries, which makes the tenant detail view feel dense and raises the chance of accidental cross-area edits → Break the panel into clearer operational sections with tighter action scope, especially separating provisioning controls from long-form AI configuration edits.
- **[medium]** The optional area-code input for phone activation is still a raw inline input plus adjacent action button instead of a shared field primitive, so it loses the consistent labeling, validation, and focus behavior used across the rest of the dashboard → Replace it with the shared input component and keep activation feedback closer to the field so this provisioning flow matches the rest of the admin UI.

### SetupWizard (dashboard/components/SetupWizard.tsx)

- **[low]** This file is still a pure alias re-export of `./SetupWizard/index`, which is easy to miss during review and increases the chance of path-based confusion because both wrapper and implementation look like distinct components in the tree → Either document the alias purpose clearly or collapse to one canonical export path so onboarding code is easier to trace and dedupe.

## Review — 2026-05-27

### KnowledgeBaseView (dashboard/components/KnowledgeBaseView.tsx)

- **[high]** The questionnaire tab still uses success and danger iconography for autosave status and combines preset policy answers, custom Q&A authoring, document uploads, and freeform entries inside one shell, which makes a factual knowledge-maintenance surface feel more reactive and state-heavy than it needs to → Simplify cross-tab feedback and keep save-state language neutral so owners can focus on content quality instead of UI status interpretation.
- **[medium]** The view does a lot well, but it still mixes first-use empty states, filtered-no-results states, and per-tab content models in a way that can blur whether the tenant lacks knowledge, the current tab is empty, or a search/filter simply returned nothing → Differentiate those empty-state cases more clearly so the knowledge base stays trustworthy as content types multiply.

### OutlookLayout (dashboard/components/OutlookLayout.tsx)

- **[medium]** Layout shells that manage panes, resizing, tenant-switch controls, and profile menus can easily become invisible infrastructure, and when their responsive transitions are not obvious users can lose track of where detail content or admin context went on smaller viewports → Make pane-collapse and active-detail transitions more explicit so the shell preserves orientation as the viewport changes.
- **[medium]** This custom shell spans primary navigation, advanced navigation, admin tenant switching, live badges, and account menus, so it still risks drifting from other list-detail layouts in spacing and keyboard traversal if not kept tightly disciplined → Normalize its interaction and spacing rules against the rest of the dashboard’s shell patterns so it feels like a coherent app frame instead of an accumulation of special cases.

### ResourceManagerView (dashboard/components/ResourceManagerView.tsx)

- **[high]** This view still asks users to understand both resource inventory and service-to-resource support mappings in the same surface, but unsupported versus partially configured states can blur together once many cards are present → Make mapping completeness much more explicit at the card level so operators can immediately see which resources are actually ready for booking.
- **[medium]** Resource cards still open an edit modal on click while also functioning as summary tiles, which makes the interaction a little implicit and easy to miss for users who treat cards as read-only summaries → Add a clearer edit affordance or secondary action so the path from browsing resources to modifying one feels more intentional.
