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
