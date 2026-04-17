# UX Review Notes

## Review — 2026-04-10

### LoginView (dashboard/components/LoginView.tsx)
- **[medium]** The login form uses custom `<input>` and submit `<button>` elements instead of the shared `Input` and `Button` primitives, so focus, disabled, and error treatments can drift from the rest of the dashboard → Rebuild the form controls with `dashboard/components/ui/Input` and `Button` to inherit consistent styling and states.
- **[medium]** The error banner is visually obvious but has no live-region semantics, so failed sign-ins are easy to miss for screen reader users → Add `role="alert"` or `aria-live="assertive"` to the error container.

### TenantCard (dashboard/components/TenantCard.tsx)
- **[high]** The tenant row is a clickable `<div>` with drag behavior but no button semantics, keyboard support, or selected-state announcement, which makes tenant switching inaccessible from the keyboard → Convert the row to a semantic button/listbox option pattern with `aria-selected`, keyboard handlers, and a separate drag handle.
- **[medium]** The drag grip is only visual and sits inside the click target, so users cannot tell what is draggable versus selectable and touch targets are easy to miss on dense lists → Split the grip into its own labelled drag handle element and keep selection on a separate control surface.

### TenantEditPanel (dashboard/components/TenantEditPanel.tsx)
- **[high]** The phone provisioning section uses `confirm()`, `alert()`, direct `document.getElementById(...)`, and raw buttons/inputs, which breaks the project’s shared modal conventions and creates inconsistent, harder-to-test interaction states → Replace this flow with shared `ConfirmModal`, `Input`, and `Button` primitives plus local React state for the area code field.
- **[medium]** The sticky header action bar can crowd or wrap awkwardly on smaller widths because both edit and delete actions stay inline next to a long title block → Add a small-screen stacked or wrapped action layout so the primary controls remain reachable without horizontal compression.
- **[low]** The provisioning states expose success/failure visually but do not announce status changes to assistive tech users → Add an `aria-live` status region for provisioning, activation failure, and deactivation results.

## Review — 2026-04-10

### AIConfigView (dashboard/components/AIConfigView.tsx)
- **[medium]** The large system-prompt textarea is hand-rolled while the surrounding screen otherwise leans on shared primitives, so focus styling and field affordances can diverge from the rest of the settings surfaces → Either extend the shared input primitives with a `Textarea` variant or wrap this field in a shared form primitive so long-form settings stay visually consistent.
- **[medium]** The template preview modal adds a second custom close button inside the modal header area even though the shared `Modal` already owns dismissal behavior, which creates duplicate affordances and inconsistent header structure → Use the modal’s built-in close pattern and move the preview title into the `title` prop instead of rendering a parallel header.
- **[low]** The voice cards behave like radio options but are rendered as generic clickable cards without an explicit radiogroup relationship, so assistive tech users do not get clear selection semantics → Expose the voice choices as a semantic radio group or add equivalent `role`, `aria-checked`, and keyboard navigation.

### MyBusinessView (dashboard/components/MyBusinessView.tsx)
- **[medium]** The sub-tab state is local-only, unlike the rest of the dashboard’s URL-synced tabs, so reloading or sharing the page loses context and feels inconsistent with other views → Sync the business sub-tab to query params the same way other dashboard tab sets already do.
- **[low]** The Setup Assistant trigger is a custom button embedded in the tab bar actions instead of the shared `Button` primitive, so hover, focus, and disabled behavior can drift from adjacent controls → Replace it with the shared `Button` component styled to match the tab bar action slot.

### TenantCreateForm (dashboard/components/TenantCreateForm.tsx)
- **[medium]** The owner credential grid stays two columns even at very small widths, which can make the modal feel cramped and force awkward field compression on phones → Collapse the credential rows to one column on narrow screens and restore two columns at the small or medium breakpoint.
- **[low]** The form depends entirely on placeholders for the owner fields, which makes scanning harder once users start typing and leaves weaker accessible labelling than the rest of the admin forms → Add explicit labels for the owner name, email, and password inputs instead of placeholder-only identification.

## Review — 2026-04-10

### DashboardHome (dashboard/components/DashboardHome.tsx)
- **[medium]** The week view quietly returns `null` when its data fails to load or comes back empty, so the home screen drops a major section with no explanation and creates a confusing blank gap → Show an intentional empty/supplementary state that explains there are no upcoming bookings or that week data is unavailable.
- **[low]** The quick-action tiles and week cards are custom clickable surfaces rather than consistently using shared button/card interaction patterns, which increases the risk of drift in focus and pressed states → Rebuild these actions on top of shared interactive primitives or standardize their keyboard/focus treatment in one reusable component.

### ErrorBoundary (dashboard/components/ErrorBoundary.tsx)
- **[medium]** If the fallback UI only reports a generic failure without a recovery path tailored to the dashboard shell, users can get stranded after a render crash → Make sure the boundary offers a clear retry/reset action and a route back to a safe dashboard view instead of only static error copy.
- **[low]** Error fallback screens are easy to neglect visually, and if this boundary is not using the same layout tokens as the rest of the app it will feel jarring exactly when trust is already shaky → Align the fallback surface with shared `Card`/`Button` styling and dark-theme variables so recovery states feel first-class.

### OutlookLayout (dashboard/components/OutlookLayout.tsx)
- **[medium]** The tenant switcher list in the sidebar uses a long scrollable stack of custom buttons without built-in filtering or stronger list semantics, which becomes harder to scan as tenant count grows → Add semantic listbox-style structure or lightweight keyboard filtering so switching tenants stays manageable in larger admin accounts.
- **[low]** Layout-level action buttons are implemented with bespoke class stacks in multiple places, which risks inconsistent hover/focus behavior across the shell chrome → Consolidate repeated shell action patterns into one shared sidebar/shell action primitive.

## Review — 2026-04-10

### BusinessSettingsView (dashboard/components/BusinessSettingsView.tsx)
- **[medium]** This settings surface still leans on several raw form controls and dense inline layout decisions, which makes it more likely to drift from the rest of the dashboard’s shared form behavior → Standardize the remaining fields on shared `Input`, `Select`, `Button`, and field-group patterns so validation, spacing, and focus treatment stay consistent.
- **[medium]** Numeric/business-rule fields packed into multi-column sections can become hard to scan on smaller widths, especially when labels and helper text compete for space → Add clearer responsive field grouping and stack narrow-screen layouts earlier so each setting remains readable without horizontal crowding.

### MyTeamView (dashboard/components/MyTeamView.tsx)
- **[medium]** The team sub-tab state is local-only even though the dashboard shell already treats tab state as URL-shareable in other places, so refreshes and direct links lose context → Sync the selected sub-tab to query params to match the rest of the app’s navigation model.
- **[low]** The four-team-view switch renders each panel through repeated conditional blocks, which is fine now but starts to get brittle as more team surfaces are added → Move the tab-to-component mapping into a single config object so the rendering path stays declarative and easier to extend.

### ProfileView (dashboard/components/ProfileView.tsx)
- **[low]** Profile screens are often a user’s fallback reference page, so if this one remains purely static with minimal state messaging it can feel under-specified compared with the rest of the dashboard chrome → Add clearer field grouping and consistent read-only value presentation using the same card and label patterns used in other settings views.
- **[low]** If the profile page lacks an explicit empty or unavailable-state treatment for missing user metadata, gaps can read like rendering mistakes instead of intentionally absent data → Render fallback copy for unset profile fields so incomplete accounts still feel polished.

## Review — 2026-04-10

### ResourceManagerView (dashboard/components/ResourceManagerView.tsx)
- **[medium]** Resource create/edit flows in this area still rely on dense custom form composition, which makes it easier for spacing, helper text, and validation states to drift away from other admin surfaces → Consolidate the remaining field layout on shared form-group patterns and primitives so resource editing behaves like the rest of the dashboard.
- **[medium]** Multi-card management screens like this can get visually heavy on smaller viewports when lists, forms, and side actions all compete for space → Tighten the mobile stacking strategy and ensure the primary add/edit controls remain visible without forcing users through long scroll jumps.

### ServiceAssignmentView (dashboard/components/ServiceAssignmentView.tsx)
- **[medium]** The service creation wizard uses a raw textarea inside an otherwise shared-primitives flow, so long-form input styling and focus treatment drift from the rest of the setup experience → Introduce a shared textarea/form primitive and use it here so multi-step creation keeps a consistent field language.
- **[medium]** Step 2 and Step 3 selection cards are visually clickable but do not clearly expose selection semantics beyond styling, which can make keyboard and assistive-tech navigation ambiguous → Treat these resource and employee pickers as explicit selectable option groups with stronger selected-state semantics and keyboard support.

### SkillManagementView (dashboard/components/SkillManagementView.tsx)
- **[high]** Deleting a skill still uses browser `confirm()` and `alert()`, which breaks the app’s established destructive-action pattern and creates a jarring native browser interruption → Replace the delete flow with the shared confirm modal and route failures through the existing inline/toast feedback system.
- **[low]** The trash action is hidden behind hover-only opacity, so keyboard and touch users can miss the delete affordance entirely → Keep the action discoverable on focus and touch layouts, not only on hover.

## Review — 2026-04-10

### AIInsightsView (dashboard/components/AIInsightsView.tsx)
- **[low]** The AI sub-tabs are structurally simple, but the screen swaps whole views with only local state and no URL persistence, so the navigation feels lighter-weight than the rest of the dashboard shell → Reuse the same query-param tab persistence pattern used elsewhere so analytics and persona views are linkable and reload-safe.
- **[low]** The content switch area does not expose a distinct labelled region for the active tab panel, which makes the tab-to-panel relationship less explicit for assistive tech if the underlying tab primitive is minimal → Ensure each tab maps to a named panel region with stable ids and `aria-labelledby` wiring.

### AnalyticsView (dashboard/components/AnalyticsView.tsx)
- **[medium]** The metric cards communicate rates through color-heavy mini charts and bars without equivalent text summaries for every visual cue, so users with low vision or color-contrast issues may lose meaning in the quick scan → Add short textual summaries or accessible labels for chart bars and status colors so the metrics are understandable without relying on hue.
- **[low]** Placeholder metrics render as faded cards, which can read visually disabled even though they are part of the intended product roadmap content → Differentiate “coming later” cards with explicit roadmap messaging rather than primarily opacity-based de-emphasis.

### AppointmentListSidebar (dashboard/components/AppointmentListSidebar.tsx)
- **[high]** The appointment rows are clickable `<div>` elements with no keyboard semantics or selected-state announcement, which makes the primary booking navigation inaccessible from the keyboard → Convert each row into a semantic button/option pattern with `aria-selected` and keyboard-friendly focus behavior.
- **[medium]** The search box is currently a presentational input with no state, filtering, or empty-state messaging, which creates the impression of a broken control → Either wire the search to actual filtering plus no-results feedback or remove it until the behavior exists.
- **[low]** The list pane can show sample-data messaging, rows, and controls but no explicit empty-state when there are simply zero appointments, so a blank list feels ambiguous → Add a clear empty-state block explaining that there are no bookings yet and offering the primary create action.

## Review — 2026-04-10

### AppointmentDetailPanel (dashboard/components/AppointmentDetailPanel.tsx)
- **[medium]** The appointment detail pane packs a lot of read-only metadata and edit actions into one column, which can become visually dense without stronger section boundaries on smaller screens → Increase separation between summary, customer, notes, and action groups so the detail panel remains scannable at mobile widths.
- **[low]** If destructive or state-changing actions inside the panel rely mainly on button color and placement, it is easy for fast-moving staff to misread them under pressure → Strengthen action labelling and grouping so edit, cancel, and delete intents are unmistakable.

### AppointmentView (dashboard/components/AppointmentView.tsx)
- **[medium]** This screen blends list, calendar, detail, mock-mode messaging, and multiple mutation flows in one large component, which makes loading and empty states harder to reason about consistently across the view → Break the major view states into more explicit subregions so users get clearer feedback when the calendar, list, or detail panel is empty, loading, or using sample data.
- **[medium]** Mobile behavior hides and shows major panes, but without very explicit transition cues it is easy to lose context when switching between list and detail/calendar views → Add clearer mobile breadcrumbs or contextual headings so users always know which pane they are in.

### CustomerDetailPanel (dashboard/components/CustomerDetailPanel.tsx)
- **[medium]** The panel mixes profile data, appointment history, call summaries, and edit/create flows in one tall surface, which can feel overwhelming without stronger sectional hierarchy → Tighten the visual grouping and headings so each customer concern reads as its own block rather than one continuous scroll.
- **[low]** Empty states like “No call history available” are present, but the broader panel still depends heavily on long scroll navigation, which makes important sections easy to miss on smaller screens → Consider lightweight in-panel navigation or clearer anchors so users can jump between profile, bookings, and call history more easily.

## Review — 2026-04-10

### CRMIntegrationCard (dashboard/components/CRMIntegrationCard.tsx)
- **[medium]** The card communicates provider state mostly through visual badges and button arrangements, but failed actions can still feel silent if nothing visible changes right away → Add explicit inline or toast feedback for connect, sync, and disconnect outcomes so operators know whether the click worked.
- **[low]** The connect CTA and connected-state action cluster use custom layout patterns that are slightly different from other admin cards, which can make integrations feel like a parallel UI system → Tighten these actions around the shared card/action patterns already used in the rest of settings surfaces.

### CRMView (dashboard/components/CRMView.tsx)
- **[medium]** The customer list/search/detail flow is powerful, but because list, detail, create, and edit states all live in one screen, it is easy for the active mode to become ambiguous on mobile → Strengthen mode cues so users can tell at a glance whether they are browsing, editing, or creating a customer.
- **[low]** The left pane search and quick actions compete for the same compact header space, which can get visually tight on smaller screens or with longer localized strings → Give the header controls a clearer responsive stacking rule so the pane stays calm under narrow widths.

### DeletedRecordsPanel (dashboard/components/DeletedRecordsPanel.tsx)
- **[medium]** The expanded last-known-data section switches to a two-column key/value grid even when space is tight, which can get cramped and hard to read on narrow screens → Collapse the recovered-data layout to one column earlier so long values stay legible.
- **[low]** The panel imports a `Filter` icon that is not used anywhere, which is a small but clear sign of dead UI intent hanging around → Remove the unused import or complete the missing filter behavior so the file matches the rendered experience.

## Review — 2026-04-10

### EmployeeManagementView (dashboard/components/EmployeeManagementView.tsx)
- **[medium]** Employee management combines roster browsing, editing, assignments, and scheduling-adjacent actions in one broad surface, which can make the current task feel unclear without stronger mode separation → Sharpen the distinction between browse, edit, and assign states so staff know whether they are changing a record or just inspecting it.
- **[medium]** Dense personnel forms tend to sprawl quickly on smaller screens, and this view risks that same compression when profile fields, skills, and controls all stack together → Tighten the responsive grouping so the most important identity and availability fields stay easy to scan first.

### KnowledgeBaseView (dashboard/components/KnowledgeBaseView.tsx)
- **[medium]** This view carries a lot of responsibility, questionnaire setup, document ingestion, upload feedback, and search, so it can feel like multiple tools stitched into one page without stronger hierarchy → Increase the separation between questionnaire, uploads, and library/search areas so each workflow has a clearer starting point.
- **[low]** Upload-heavy screens depend on trust, and if progress, success, or failure messages are easy to miss among the rest of the page chrome users can feel uncertain about what happened → Keep upload/result messaging pinned close to the upload action and visually distinct from the surrounding content.

### RecordHistoryModal (dashboard/components/RecordHistoryModal.tsx)
- **[high]** This is still a hand-rolled modal with custom backdrop and controls instead of the shared modal primitive, so it risks inconsistent focus management, dismissal behavior, and accessibility compared with the rest of the dashboard → Rebuild it on top of the shared `Modal` component and keep the history/restore content inside that standardized shell.
- **[medium]** The version timeline can get cognitively dense fast because metadata, badges, diffs, and restore affordances all sit in the same vertical rhythm → Add stronger grouping or progressive disclosure so the most important change information is readable before users dive into raw field details.

## Review — 2026-04-10

### SchedulerView (dashboard/components/SchedulerView.tsx)
- **[medium]** Scheduler screens carry a lot of parallel context, views, filters, date controls, and booking surfaces, so they become hard to orient in quickly if the current mode is not strongly signposted → Keep the active scheduler mode and date range visually anchored so users always know what slice of the schedule they are editing.
- **[medium]** Dense schedule tools can feel especially fragile on smaller screens when controls stack above a large interactive canvas → Make sure the mobile and tablet layout prioritizes the minimum control set needed before the grid so the core schedule remains usable without excessive scrolling.

### BusinessTypePicker (dashboard/components/SetupWizard/BusinessTypePicker.tsx)
- **[medium]** This picker mixes search, presets, and selection in a modal-like chooser, which can get cognitively busy without a very clear primary selection path → Emphasize the main “pick a template” action and visually down-rank secondary helper content so first-time setup stays fast.
- **[low]** Search-heavy selection UIs can feel uncertain when there are no exact matches unless the empty state is very explicit → Make sure no-results feedback clearly explains what happened and whether the user should broaden the search or choose a nearby template.

### SoloStepHours (dashboard/components/SetupWizard/SoloStepHours.tsx)
- **[medium]** The per-day rows rely on small icon-only copy/remove buttons and compact time inputs, which can get fiddly for touch users during onboarding → Increase the tap target clarity for row actions and keep the time-edit controls easy to hit on smaller devices.
- **[low]** The flash feedback after copy actions is helpful, but it is purely visual and transient, so some users may miss what changed → Pair the visual flash with a short status message or clearer persistent cue about which days were updated.

## Review — 2026-04-10

### SoloStepReview (dashboard/components/SetupWizard/SoloStepReview.tsx)
- **[medium]** Review steps work best when they clearly separate “looks good” from “needs attention,” and if this screen mixes confirmations and warnings too closely it can slow down the final onboarding check → Strengthen the visual distinction between ready sections and missing/incomplete sections so the user knows exactly what to fix before going live.
- **[low]** Summary-heavy review screens can become repetitive if every section uses the same visual weight, making the truly important missing items easier to overlook → Give incomplete or blocking items stronger hierarchy than informational recap content.

### SoloWizard (dashboard/components/SetupWizard/SoloWizard.tsx)
- **[medium]** Multi-step onboarding shells can feel disorienting if the user does not always know what changed after hitting next or back, especially once content heights vary a lot → Keep the current step title, progress, and navigation context pinned clearly so orientation survives step-to-step jumps.
- **[medium]** When wizard state, scrolling, and navigation controls all live in one component, it is easy for mobile users to lose the primary action below the fold → Make sure next/back controls stay reachable without long scroll travel on shorter screens.

### Step7GoLive (dashboard/components/SetupWizard/Step7GoLive.tsx)
- **[medium]** The activation state handling is clear, but this final step becomes the emotional peak of onboarding, so failures need especially strong recovery guidance, not just an error message → Add a clearer next-step hint after failure, such as retry guidance or where to activate later, directly inside the failure state.
- **[low]** The success state shows the number well, but the screen could do a better job of reinforcing the immediate follow-up action users should take → Make the “test this number now” instruction more prominent so the final step feels complete and actionable.

## Review — 2026-04-10

### StepAssignments (dashboard/components/SetupWizard/StepAssignments.tsx)
- **[medium]** Assignment steps are conceptually dense because users are mapping relationships, not just entering records, so they need especially clear affordances for what is connected versus still missing → Make the assigned/unassigned state more immediately legible so users can understand coverage without reading every row.
- **[medium]** Relationship-mapping screens can become intimidating if the “why this matters” context is buried below the controls → Keep a short, plain-language explanation near the top about how assignments affect booking behavior so first-time setup feels less abstract.

### StepEmployees (dashboard/components/SetupWizard/StepEmployees.tsx)
- **[medium]** The employee list rows rely on small icon-only edit/delete actions, which can be fiddly during onboarding and less clear for keyboard or touch users → Increase action clarity with stronger labels or larger hit areas so editing roster entries feels confident and obvious.
- **[low]** Empty-state and add-state flows are present, but the transition from list mode into edit mode can still feel abrupt when the inline form appears below the list → Add a stronger visual handoff into editing so users immediately notice where the form opened.

### StepResources (dashboard/components/SetupWizard/StepResources.tsx)
- **[medium]** Resource rows mirror the same small icon-only edit/delete pattern, which keeps the UI compact but at the cost of touch friendliness and affordance clarity → Increase the action targets or pair icons with clearer labels so setup is less error-prone on smaller devices.
- **[low]** Long descriptions are truncated in the list, which helps density, but users may not realize important detail is being hidden → Provide a clearer way to reveal full resource descriptions when needed, especially before editing.

## Review — 2026-04-11

### StepServices (dashboard/components/SetupWizard/StepServices.tsx)
- **[medium]** Service setup rows compress duration, pricing, and edit actions into a tight list format, which can make each service hard to scan quickly during onboarding → Increase row hierarchy so the name, duration, and key booking details are easier to distinguish at a glance.
- **[low]** Icon-only edit and delete actions keep the list compact but reduce affordance clarity for newer users setting up services for the first time → Strengthen the action labels or hit areas so row actions are easier to recognize without guessing.

### StepShifts (dashboard/components/SetupWizard/StepShifts.tsx)
- **[medium]** Shift setup is one of the more error-prone onboarding steps, and if the working-hours explanation is too subtle users may not understand how this step affects booking availability → Keep the connection between shift coverage and real appointment availability very explicit near the controls.
- **[medium]** Per-day scheduling rows can become repetitive and visually dense, especially once multiple employees or exceptions are involved → Add stronger row grouping or summary cues so users can spot gaps and overlaps without reading every input.

### WizardModeChooser (dashboard/components/SetupWizard/WizardModeChooser.tsx)
- **[high]** This chooser is a hand-rolled modal overlay with no shared modal primitive, no Escape handling, and no explicit dialog semantics, which risks inconsistent accessibility and keyboard behavior at the very start of onboarding → Rebuild it on the shared `Modal` component or add full dialog semantics, focus management, and Escape support.
- **[low]** The two mode cards depend heavily on hover styling for affordance, which is less helpful on touch devices where this first choice needs to feel instantly tappable → Make the default resting state more obviously selectable without relying on hover transitions.

## Review — 2026-04-11

### WizardStepContent (dashboard/components/SetupWizard/WizardStepContent.tsx)
- **[low]** This file is structurally simple, but central step switchers are easy places for wizard drift when labels, ordering, or available steps change over time → Keep the step-to-component mapping explicit and easy to scan so onboarding flow changes do not silently desync the rendered step order.
- **[low]** If unsupported or unexpected step values fall through silently, the wizard can feel broken instead of intentionally guarded → Make sure invalid step cases render a clear fallback state rather than an empty panel.

### SetupWizard (dashboard/components/SetupWizard/index.tsx)
- **[medium]** Setup shells do a lot of orchestration, and without very strong progress and state persistence cues users can feel anxious about losing work while moving between steps → Keep progress, save state, and current mode highly visible throughout the flow so onboarding feels safe and recoverable.
- **[medium]** Wizard layouts with mixed sidebars, progress chrome, and variable-height content can become unwieldy on shorter laptop screens → Ensure the primary next-step action and current-step context remain visible without requiring long vertical scrolling.

### ShiftManagementView (dashboard/components/ShiftManagementView.tsx)
- **[medium]** The timeline is information-rich and nicely interactive, but the interaction density means first-time users still need strong orientation help to avoid accidental edits or deletes → Add clearer affordance cues around click-to-schedule, click-to-edit, and delete behaviors so the canvas feels powerful rather than fragile.
- **[low]** The delete affordance appears inside the shift bar itself, which is efficient but easy to miss or mis-tap when the shift block is narrow → Consider a slightly safer action reveal pattern for very short shifts so destructive actions are less cramped.

## Review — 2026-04-11

### SkillMatrixView (dashboard/components/SkillMatrixView.tsx)
- **[medium]** Matrix-style editing tools are powerful but cognitively heavy, and without very strong row/column orientation aids users can lose track of which relationship they are changing → Reinforce headers, sticky context, or hover/focus highlights so the current row and column stay obvious during edits.
- **[low]** Dense grid interactions often rely on color changes alone to communicate assigned versus unassigned states, which can be hard to parse quickly or accessibly → Pair the visual state with clearer iconography or text cues so assignment status is not carried only by fill color.

### VoiceCallsView (dashboard/components/VoiceCallsView.tsx)
- **[medium]** This screen mixes live activity, historical call records, filters, and transcript detail, so the current mode can feel unclear without stronger separation between “active operations” and “history review” contexts → Make the boundary between live calls and historical browsing more explicit so users know whether they are monitoring now or reviewing the past.
- **[low]** Polling-heavy operational views can feel stale or unreliable if freshness is not obvious in the UI → Surface a clearer last-updated cue near the live-call controls so users know how current the panel is.

### AppointmentBlock (dashboard/components/scheduler/AppointmentBlock.tsx)
- **[high]** Each appointment block is a clickable `<div>` with no keyboard semantics, so one of the scheduler’s core interaction points is inaccessible to keyboard users → Convert the block into a semantic button or add `role="button"`, tab focus, and Enter/Space keyboard handling.
- **[medium]** The block title relies on color and truncation to communicate state, which makes canceled or short appointments harder to understand at a glance when space is tight → Add a more explicit compact status cue or richer tooltip text so narrow blocks still communicate enough context.

## Review — 2026-04-11

### SuperAdminDashboard (dashboard/components/SuperAdminDashboard.tsx)
- **[medium]** This screen combines tenant browsing, creation, reordering, deletion, and detail editing, so operators can easily lose track of which mode they are in without stronger state cues → Make create, reorder, and destructive modes more visually distinct so the admin panel feels safer under quick switching.
- **[medium]** Long tenant lists paired with a dense detail pane create a lot of competing attention in one layout, especially on narrower laptop screens → Tighten the responsive collapse behavior so the active tenant context stays obvious when space gets constrained.

### AppointmentListView (dashboard/components/scheduler/AppointmentListView.tsx)
- **[medium]** List views are valuable because they flatten scheduler complexity, but they need especially clear grouping and sorting cues to stay easier than the calendar itself → Reinforce the active sort/grouping logic so users know why appointments appear in the order they do.
- **[low]** Dense appointment rows can blend together when status, customer, resource, and time all share the same visual weight → Increase hierarchy between the most important fields so scanning the list is faster during busy scheduling moments.

### EmployeeDayFocusPanel (dashboard/components/scheduler/EmployeeDayFocusPanel.tsx)
- **[high]** The timeline rows are clickable `<div>` elements with no keyboard semantics, so a key scheduler detail interaction is inaccessible to keyboard users → Convert each timeline row to a semantic button or add `role="button"`, focusability, and Enter/Space handling.
- **[low]** The side panel uses strong visual stats, but the utilization color thresholding still does a lot of meaning-carrying work by hue alone → Add a short textual descriptor alongside the percentage so the utilization signal is understandable without depending on color.

## Review — 2026-04-11

### NewSchedulerView (dashboard/components/scheduler/NewSchedulerView.tsx)
- **[high]** The staff rows are draggable, clickable `div` buttons that combine selection and drag behavior in one surface, which makes keyboard use ambiguous and raises the risk of accidental reorder or profile opens → Split the row into a semantic button for profile/open behavior plus a dedicated drag handle with clearer reorder instructions and keyboard-safe semantics.
- **[medium]** The hours and skills mode toggles, zoom controls, and reorder save/discard actions all sit in one dense toolbar that will wrap awkwardly on narrower laptop widths, making the scheduler feel harder to orient in under pressure → Reflow the toolbar into clearer control groups with a predictable small-screen wrap order so date, mode, and row-order actions stay easy to find.

### QuickBookPanel (dashboard/components/scheduler/QuickBookPanel.tsx)
- **[medium]** The customer search field and customer picker are still raw `input` and `select` elements while the rest of the panel uses shared primitives, so focus, validation, and dark-theme behavior can drift inside a high-speed booking flow → Rebuild both controls with shared `Input` and `Select` primitives, or extract a reusable searchable customer picker that matches the rest of the scheduler UI.
- **[medium]** Booking failures render in a plain styled box without live-region semantics, so quick-book errors can be easy to miss for assistive-tech users during a time-sensitive action → Add `role="alert"` or an `aria-live="assertive"` region for booking errors so failures announce immediately.

### ResourceColumnsView (dashboard/components/scheduler/ResourceColumnsView.tsx)
- **[medium]** Resource rows rely on a color-only `CoverageBar` strip under each label, so availability meaning is easy to miss or misread without stronger textual reinforcement → Add a compact coverage summary or legend text per row so users can understand gaps versus covered hours without depending entirely on color.
- **[low]** The view only shows a blank "No resources configured" message when the resource list is empty, but it does not give the scheduler user a next step from inside the screen → Add a more explicit empty-state hint or CTA that points back to resource setup so the dead end feels intentional and recoverable.

## Review — 2026-04-11

### SchedulerDateNav (dashboard/components/scheduler/SchedulerDateNav.tsx)
- **[low]** The date navigator shows a long-form date label but gives no compact fallback treatment, so toolbar space gets tight quickly on smaller scheduler widths when combined with other controls → Add a responsive shorter date format or allow the label to collapse at narrower breakpoints while keeping the full date available via tooltip or accessible label.
- **[low]** The Today action changes button styling when active, but the current selected date is not announced as a live update anywhere when users jump day to day → Add a polite `aria-live` status on the date display or its container so date changes are announced for keyboard and screen-reader users.

### StaffProfileCard (dashboard/components/scheduler/StaffProfileCard.tsx)
- **[medium]** The floating profile card is positioned manually and behaves like a popover, but it does not expose dialog/popover semantics or a labelled relationship back to the triggering staff row → Add explicit popover/dialog semantics, an accessible label, and trigger-to-card `aria` wiring so the scheduler’s profile preview is understandable to assistive tech.
- **[low]** The card estimates its own height with a fixed constant, which can cause awkward clipping or off-screen placement when the skills list grows beyond the assumed size → Measure the rendered card or clamp long skill lists so positioning stays reliable for employees with many assigned services.

### StaffSwimLaneView (dashboard/components/scheduler/StaffSwimLaneView.tsx)
- **[high]** Core shift actions still depend on mouse-only drag, resize handles, and a browser `confirm()` dialog for deletion, leaving key scheduler editing paths inaccessible or inconsistent with the app’s shared destructive-action pattern → Add keyboard-accessible shift actions and replace the native confirm flow with the shared confirmation modal used elsewhere in the dashboard.
- **[medium]** Shift creation, move, and resize states are communicated mainly through color overlays inside a dense grid, which makes it hard to understand the current edit mode quickly, especially in dark themes → Add clearer inline mode cues such as temporary labels, focus outlines, or helper text so users can tell whether they are creating, moving, or resizing a shift without decoding only color changes.

## Review — 2026-04-11

### TimeGrid (dashboard/components/scheduler/TimeGrid.tsx)
- **[low]** The header row is visually clear but the empty left label cell has no accessible description, so the relationship between the fixed name column and hour columns is less explicit for assistive tech → Add a descriptive header label or hidden text that clarifies the first column is for staff/resource names.
- **[low]** Hour labels always render in the same density regardless of available width, which can make the header feel cramped when embedded in narrower scheduler layouts → Add a responsive compact label mode or allow alternate hour-step labelling when the parent view reduces horizontal space.

### SkillMapColumn (dashboard/components/skill-map/SkillMapColumn.tsx)
- **[low]** The column count badge is purely visual and not tied to the column heading semantics, so assistive-tech users may not get the same quick summary of list size → Include the count in the heading label or expose it through accessible text so the column summary is announced together.
- **[low]** The three-column layout has a fixed `min-w-[200px]`, which can force awkward horizontal squeeze before the broader skill map can adapt for smaller screens → Add clearer small-screen stacking or overflow rules so the map columns degrade more gracefully on narrow viewports.

### SkillMapConnections (dashboard/components/skill-map/SkillMapConnections.tsx)
- **[medium]** Connection deletion relies on clicking invisible SVG hit areas and a tiny floating disconnect popup, which makes one of the map’s core actions hard to discover and nearly impossible from the keyboard → Add a keyboard-reachable disconnect affordance tied to selected nodes or expose the same action through a visible side-panel control.
- **[medium]** Broken versus highlighted relationship states are communicated mostly through stroke color and dash style, which is subtle inside a dense map and easy to miss in dark themes → Add a clearer legend or paired textual state cue so users can distinguish broken, highlighted, and normal links without decoding line styling alone.

## Review — 2026-04-11

### SkillMapFixPanel (dashboard/components/skill-map/SkillMapFixPanel.tsx)
- **[medium]** Fix actions fail silently in the UI because assignment errors only log to the console, leaving users unsure whether a broken chain was actually repaired → Surface assignment failures through inline or toast feedback so repair attempts have explicit success and failure states.
- **[low]** The close control is a raw text button with only an `✕`, which makes the panel’s dismissal affordance less consistent than the rest of the dashboard’s shared button/icon patterns → Replace it with a labelled shared button or icon button so the repair panel matches the app’s established affordances.

### SkillMapNode (dashboard/components/skill-map/SkillMapNode.tsx)
- **[medium]** Node selection relies heavily on visual treatment and iconography, but the node itself does not clearly expose option/button semantics for keyboard traversal across the map → Add explicit interactive semantics and keyboard handling so users can move through and select nodes without relying on pointer interaction.
- **[low]** Dense labels and badges inside the node can become visually cramped as names grow longer, especially once the three-column map narrows on smaller screens → Tighten truncation and overflow behavior so long names stay readable without destabilizing the map layout.

### SkillRelationshipMap (dashboard/components/skill-map/SkillRelationshipMap.tsx)
- **[medium]** This screen combines selection, highlighting, broken-chain repair, and disconnect flows in one dense visual surface, so the current interaction mode can be hard to read without stronger guidance → Add clearer mode cues or helper copy near the top so users know whether they are exploring, connecting, or fixing broken chains.
- **[medium]** The map depends on horizontal space and visual spatial memory, which can become fragile on narrower laptop widths when all three columns and connection overlays compete for room → Strengthen small-screen overflow and focus behavior so the active node and related connections remain understandable when the canvas compresses.

## Review — 2026-04-16

### AppointmentPopover (dashboard/components/scheduler/AppointmentPopover.tsx)
- **[high]** The popover closes on outside click and Escape, but it never receives focus, exposes no dialog semantics, and offers no focus return path, so keyboard users can land in an overlay that screen readers do not recognize and that focus can slip behind → Treat the popover as a non-modal dialog (`role="dialog"`, `aria-label`/`aria-labelledby`), move focus into it when opened, and restore focus to the triggering appointment block on close.
- **[medium]** The component estimates its height with a hard-coded `220px` value before positioning, so longer customer/location content can still push it offscreen on smaller viewports even though the scheduler otherwise handles dense layouts carefully → Measure the rendered popover after mount and clamp both vertical position and max-height dynamically instead of relying on a fixed height guess.

## Review — 2026-04-17

### AnalyticsView (dashboard/components/AnalyticsView.tsx)
- **[medium]** The view fetches analytics data on mount but only exposes a generic error branch, with no matching loading skeleton or empty-state treatment while the dashboard waits for metrics → Add an explicit loading state with the same card/grid structure as the loaded layout, plus a deliberate empty-data state so the page does not jump from blank to populated.

### AIConfigView (dashboard/components/AIConfigView.tsx)
- **[high]** The settings screen still imports `MOCK_TENANT`, which suggests configuration sections can render against placeholder business data instead of live tenant context, making it easy for admins to edit a screen that is visually detached from the actual business they manage → Replace the mock tenant dependency with real session-backed tenant context and show a clear loading/error state until that data is available.
- **[medium]** The long stacked settings sections rely on plain headings and spacing only, with no sticky action area or summary of unsaved changes, so operators have to scroll hunt to confirm what is editable and whether save actions apply to the current section → Add a persistent save/status bar or per-section action affordances using existing dashboard primitives so configuration work stays anchored on long forms.

### AIInsightsView (dashboard/components/AIInsightsView.tsx)
- **[medium]** The component is effectively a tab shell around `FolderTabBar`, but it does not surface any loading, empty, or unavailable states for the underlying insight panels, which makes the area feel unfinished when one tab has no data or a disabled feature → Add per-tab empty/unavailable messaging and loading placeholders so each insight category communicates whether data is still loading, intentionally absent, or not yet configured.
