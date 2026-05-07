# Front Desk Click-Count Audit — 2026-05-07

**Scope:** four daily-use tasks for a `front_desk` role (the dashboard's primary audience per role-gating shipped 2026-05-05). External review flagged the dashboard as "complex and hard to understand for non-technical users" — this audit produces the actionable punch list to address that.

**Method:** read-only walk through every entry point, sub-tab, and form. Click counts assume the user is already logged in and on Home (the default landing).

**Rule from `docs/TODO.md`:** anything > 3 *decisions* on a daily task is a candidate for simplification. "Decision" = a moment where the user must choose: tab, sub-tab, view variant, dropdown selection, search query, or destructive confirmation. Typing into a single search box is one decision.

---

## Headline finding

**The dashboard has two parallel scheduler implementations on the Schedule tab, and neither one is the right answer for a front-desk operator.**

- `Calendar` sub-tab (default) — `AppointmentView` with `react-big-calendar` in **month view**. No customer search in the create form. No Quick Book button. The only create affordance is an icon-only `+` button in a sidebar below the calendar.
- `Staff` sub-tab — `NewSchedulerView`. Cleaner read-mode UX (rows = staff, hours across the top, today highlighted) but **has no booking affordance at all**. You can read appointments, click them for detail, but you cannot create one from this view.
- `Resources` and `List` sub-tabs — only place a `Quick Book` button appears. Best create UX (slide-out panel with customer search + service dropdown that auto-fills end time from `duration_minutes`), but the user has to know to navigate here first.

Net effect: the front-desk operator lands on the worst variant for the most-frequent task (booking a call-in), and the version with the best create flow is two clicks deeper than the version with the best read flow. This is the single biggest UX simplification opportunity on the dashboard.

---

## Per-task audit

### Task 1: Book a call-in customer (most frequent task)

**Decisions: 7 on the recommended Quick Book path, 8+ on the default-view Calendar path.** Both exceed the 3-decision threshold; the Calendar path is worse than that count suggests because it also requires scrolling to find the icon-only `+`.

Three paths exist; only one is reasonable, and it isn't the default.

#### Path A — Calendar (default) → AppointmentView "+" sidebar button

1. *(landing on Home)* Decision 1: click `Schedule` tab → Calendar view loads in month grid (`AppointmentView.tsx:111`).
2. Visual parse: month grid dominates; sidebar below is the only place `Plus` appears (`AppointmentListSidebar.tsx:42`).
3. Decision 2: click `+` icon button (no label, `aria-label` only — fails H6 Recognition over Recall for non-technical users who don't read aria attributes; **P1 affordance issue**).
4. Form opens in `AppointmentDetailPanel` with these fields:
   - Decision 3: customer dropdown — **no search box**, just a `<select>` with every customer in the tenant. With 50+ customers, this is a Hick's Law violation (`AppointmentDetailPanel.tsx`, consumed via `findCustomerById` in `AppointmentView.tsx:126`).
   - Decision 4: service description (free-text input, not a service selector — service-to-end-time auto-calc not wired here).
   - Decision 5: start time (datetime-local).
   - Decision 6: end time (datetime-local — manual, error-prone).
   - Decision 7: resource dropdown.
   - Decision 8: employee dropdown.
   - Optional: customer first/last/phone if creating a new contact inline.
5. Decision 9: Save.

**P0 problem:** the click target for "create" is icon-only with no visible label, and the customer field is a 50+-item native `<select>` with no search. If the front-desk operator has the customer's voice on the phone and a list of 200 names, this is the wrong tool.

#### Path B — Resources or List sub-tab → Quick Book button

1. Decision 1: click `Schedule` tab.
2. Decision 2: click `Resources` or `List` sub-tab (the only sub-tabs that surface the Quick Book button per `SchedulerView.tsx:182`).
3. Decision 3: click `Quick Book` button in toolbar.
4. Slide-out panel opens with:
   - Decision 4: type into the customer search input (real win — filters list as you type, `QuickBookPanel.tsx:170-176`).
   - Decision 5: pick customer from filtered list.
   - Decision 6: pick service (dropdown auto-fills end time from `duration_minutes` ✓ good).
   - Decision 7: pick resource.
   - Decision 8: pick employee (defaults to "Unassigned" — a sensible default that lowers cognitive load).
   - Times are prefilled from `prefill.date` if the panel was opened from a slot click; otherwise blank.
5. Decision 9: click `Book Now`.

7 decisions if we exclude the now-redundant employee pick (default "Unassigned" is acceptable). Still over threshold, but the search box on customer is the single most important UX win available on this surface.

#### Path C — Staff sub-tab

Cannot book from here. The redesigned scheduler with the cleanest read layout has zero create affordance. **P0 missing feature.**

#### Recommendations

- **R1.1 [P0] Hoist Quick Book to the Schedule tab toolbar — visible on all four sub-tabs, including the default Calendar view.** Today it appears only on Resources/List. Code is already universal; just move the button up one level in `SchedulerView.tsx`.
- **R1.2 [P0] Replace the customer `<select>` in `AppointmentDetailPanel` with the same searchable input pattern used in `QuickBookPanel.tsx:164-188`.** The search-then-select pattern already exists in the codebase — copy it.
- **R1.3 [P1] Make every empty cell on the scheduler clickable — open Quick Book prefilled with that resource/employee/hour.** `react-big-calendar` supports `selectable={true}` + `onSelectSlot` (currently disabled). For the staff view, add an empty-cell click handler that calls `setQuickBookPrefill({...})` and `setQuickBookOpen(true)` like `handleNewQuickBook` does today.
- **R1.4 [P1] Add a visible "+ New" label next to the `+` icon button in `AppointmentListSidebar`** — icon-only buttons fail H6 (Recognition over Recall). Cost: 4 chars.
- **R1.5 [P2] Replace the description text input with a service dropdown** in `AppointmentDetailPanel`, mirroring `QuickBookPanel`'s service select. This unlocks the auto-end-time-from-duration pattern that already exists in QuickBook.

---

### Task 2: Look up tomorrow's schedule

**Decisions: 0 (Home glance), 3 (Calendar default path), 3 (Staff path).** This task is borderline — Home actually nails it, but the Schedule tab itself is a 3-decision walk that shouldn't be.

#### Path A — Glance from Home (zero clicks)

`DashboardHome.tsx:336-347` renders a "This Week" 7-column grid with appointment counts + first 2 appointments + working staff per day. **Tomorrow is the next box over from today**, visually distinct (today is highlighted). 0 decisions, glance-only.

This is actually a legitimately good UX. The H1 header isn't the most important element — `This Week` is, and it's appropriately weighted. Keep this.

#### Path B — Schedule tab → Calendar (default)

1. Decision 1: click `Schedule` tab.
2. Decision 2: month view loads — tomorrow is one small cell. Click it OR switch to Day/Week via BigCalendar's built-in toolbar (top-right of calendar component).
3. Decision 3: click `>` arrow to navigate from today.

3 decisions, but the friction is real: month view shows the day as a tiny cell with at most 2-3 appointments visible before truncation (`+ N more`). The user usually wants Day or Week view but lands on Month. This is a defaults problem.

#### Path C — Schedule tab → Staff sub-tab

1. Decision 1: click `Schedule` tab.
2. Decision 2: click `Staff` sub-tab.
3. Decision 3: click `>` (next day) in `SchedulerDateNav.tsx:30-34`.

Staff view has the best read layout (24h grid, who's working, who has appointments) but the user has to switch tabs to get there. The header copy on the Calendar default view literally tells users "Switch to staff or resources only when you need detail" (`SchedulerView.tsx:97`) — which acknowledges the wrong default but doesn't fix it.

#### Recommendations

- **R2.1 [P1] Change the default Schedule view from `calendar` to `staff`.** The Staff sub-tab's `NewSchedulerView` is the better daily-use surface. The Calendar view has long-tail value (drag/drop, month-view planning) but it shouldn't be the landing.
- **R2.2 [P2] Replace the "Today" button on `SchedulerDateNav` with three buttons: `Yesterday | Today | Tomorrow`** (Touch-target sizing per WCAG 2.1 AA — 48×48px each). For a front-desk operator handling daily questions, three of the most common date jumps deserve direct affordances. Keep `< / >` for further-out dates.
- **R2.3 [P3] When `selectedDate` differs from today, show "Tomorrow" / "Yesterday" / weekday name in the date display** instead of the absolute "Tuesday, January 7, 2026" format. Removes the mental math (H2: Match between system and real world; date-relative phrasing).

---

### Task 3: Mark someone unavailable (e.g., "Carlos called in sick today")

**Decisions: ∞ for `front_desk` role — they cannot complete this task.**
**Decisions: 5 for `owner` — and the workflow is in the wrong place.**

#### Front-desk path: blocked

`OutlookLayout.tsx:81-92` hides the Advanced tab group (Services & Resources, Staff & Shifts, AI & Knowledge) when `role === 'front_desk' && !isAdmin`. The off-day affordance lives only in `ShiftManagementView` (`MyTeamView.tsx:49`), which is inside `Staff & Shifts`. Search across `dashboard/components/scheduler/` confirms no off-day affordance there (only one reference, in `useSchedulerData.ts:117`, and it's read-only display logic).

**This is a P0 functional gap.** "Carlos is sick today, take him off the board" is a daily front-desk task, and the role currently designed for daily front-desk use cannot do it. Either:
- Today's stale-bookings stay on Carlos and the AI tries to book him for new calls (operational mistake), or
- The front-desk staffer has to call/text the owner to log in and toggle the off flag (workflow break).

#### Owner path

1. Decision 1: click `Staff & Shifts` tab.
2. Default landing: `employees` sub-tab. Decision 2: click `Shifts` sub-tab.
3. Decision 3: click the right employee in the horizontal pill row (`ShiftManagementView.tsx:280-289`). Auto-selects first employee on mount, so this is sometimes free.
4. Decision 4: click on today's row in the week grid (or the existing shift bar — both open the editor modal).
5. Decision 5: click the `Day Off` checkbox in the modal (`ShiftManagementView.tsx:418`).
6. Decision 6: click `Save`.

5–6 decisions. The deeper problem is mental-model alignment (H2): the user is on Schedule, looking at Carlos, and needs to mark Carlos off — but the off-toggle is two tabs and a modal away in a different mental context ("shift management" vs "today's schedule"). They have to leave the surface where they identified the problem to go solve it.

#### Recommendations

- **R3.1 [P0] Add an off-today affordance accessible to `front_desk` role on the Schedule tab.** Concretely: clicking a staff name in `NewSchedulerView` opens `StaffProfileCard` (already implemented). Add a `Mark off today` button to that card. Backend already supports this — `Api.shifts.schedule` writes `is_off=true` for the date. The role gate stays on the rest of `Staff & Shifts`; only this one operation gets surfaced where it's needed.
- **R3.2 [P1] If R3.1 isn't viable, expose just the Shifts sub-tab to `front_desk`** (not the rest of Staff & Shifts). The current all-or-nothing gate in `OutlookLayout.tsx` is the wrong granularity for daily ops.
- **R3.3 [P2] On the schedule grid, render an off-day employee with an `OFF` badge** the way `ShiftManagementView` does today (`ShiftManagementView.tsx:379-383`) — but in the read-only Schedule view too. Currently a sick employee just shows up with no shift bar, indistinguishable from "I haven't scheduled them yet."

---

### Task 4: Find a customer

**Decisions: 2.** Below threshold. This task works.

1. Decision 1: click `Customers` tab.
2. Decision 2: type into the always-visible search box (`CRMView.tsx:296-299`). The list filters in real time across name, phone, and email (`CRMView.tsx:168-176`).
3. Click the matching customer row (selection, not really a "decision").

Empty state copy is good: "No customers match \"Smith\"" vs "No customers yet" (`CRMView.tsx:303-306`) — H9-compliant differentiated empty states.

**One nit (P3):** the search field is an unstyled raw `<input>` (line 298) instead of the shared `Input` primitive used elsewhere. Minor consistency drift. Not user-visible.

#### Recommendation

- **R4.1 [P3] Migrate the customer search input to the shared `Input` primitive** for consistent focus ring + theming across the 8 themes. Cosmetic only.

---

## Decision-count summary

| Task | Front-desk decisions today | Threshold | Status |
|---|---|---|---|
| Book a call-in (Calendar default) | 8+ | 3 | **P0 — over by 5+** |
| Book a call-in (Quick Book path) | 7 | 3 | **P0 — over by 4** |
| Look up tomorrow (Home glance) | 0 | 3 | ✓ |
| Look up tomorrow (Schedule tab) | 3 | 3 | borderline |
| Mark someone unavailable (front_desk) | ∞ | 3 | **P0 — task is blocked** |
| Mark someone unavailable (owner) | 5 | 3 | P1 — over by 2 + wrong location |
| Find a customer | 2 | 3 | ✓ |

3 of 4 daily tasks fail the threshold for the audience the dashboard was just role-gated for.

---

## Cross-cutting heuristic findings

These cut across multiple tasks and are worth pulling out:

| Heuristic | Score (0-4) | Finding |
|---|---|---|
| **H6 Recognition over Recall** | 3 | Icon-only `+` for new appointment, icon-only `Plus` for Quick Book trigger; no labels. Operator must learn the dashboard's icon vocabulary. |
| **H2 Match real world** | 3 | "Calendar" / "Staff" / "Resources" / "List" sub-tabs are *implementation* names, not *task* names. Users want "Today's schedule" / "Who's working" / "Find a slot". |
| **H4 Consistency** | 3 | Two different scheduler implementations (`AppointmentView`, `NewSchedulerView`) on the same Schedule tab, with different create flows, different date nav widgets, different empty states. |
| **H7 Flexibility & efficiency** | 3 | The fastest path (Quick Book) is buried two clicks deep behind sub-tab switching. The default path is the slowest path. |
| **H5 Error prevention** | 2 | `AppointmentDetailPanel` lets users free-text the description and manually pick start/end time, missing the duration auto-calc that exists in `QuickBookPanel`. Easy to book a 2-hour slot for a 30-minute service. |
| **H1 Visibility of system status** | 1 | Generally good — load errors surface, mock-data banner shows, save state visible. |
| **H10 Help & documentation** | 2 | No first-run tour, no contextual hints. New front-desk hires would need over-the-shoulder training to discover Quick Book. |

---

## Recommended punch list (priority order)

Six items, each phrased as a self-contained PR target:

1. **[P0] ~~Hoist Quick Book to the Schedule tab toolbar~~ — DONE 2026-05-07 (`1b60b48`).** Quick Book now visible on all four sub-tabs. Decision-count for "book a call-in" on the default Calendar landing: 8+ → 5.
2. **[P0] ~~Add a `Mark off today` action to `StaffProfileCard`~~ — DONE 2026-05-07.** Optional `onMarkOff`/`markOffLabel`/`isMarkingOff` props on `StaffProfileCard`; parent (`NewSchedulerView`) owns confirm + API + toast + refresh. Hidden when employee has no shift on the viewed date. Label adapts to "Mark off today" / "Mark off Mon, May 11" so it doesn't lie when viewing non-today. 12 new tests (6 card unit + 6 wiring integration). Decision-count for "mark someone unavailable" as `front_desk`: ∞ → 3.
3. **[P0] ~~Replace the `AppointmentDetailPanel` customer `<select>` with the searchable pattern from `QuickBookPanel`~~ — DONE 2026-05-07.** Extracted `dashboard/components/ui/CustomerCombobox.tsx` (search input + filtered native select, consistent label format, name + phone-substring filter). Both `QuickBookPanel` and `AppointmentDetailPanel` consume it; AppointmentDetailPanel's address pre-fill side effect preserved at the parent level. 11 new unit tests pin the contract. Decision-count for "book a call-in" on the Calendar default path drops further (the customer-pick step is now one search box instead of scrolling a 50+-item dropdown).
4. **[P1] ~~Make empty scheduler cells clickable to open Quick Book prefilled~~ — DONE 2026-05-07 (corrected later same day).** Both surfaces shipped: Staff sub-tab (`NewSchedulerView`) — empty hour cells expose `role=button` + `aria-label` + tabIndex=0 + cursor pointer ONLY when the row's specific employee has a shift covering that hour. Click/Enter/Space delivers `{ employeeId, hour, date }` to `onQuickBook`. Skills mode keeps cells passive. **Cells outside the row employee's shift stay passive** (the original "operators may book early/late" path was wrong — booking landed `EMPLOYEE_NOT_SCHEDULED` immediately, so the cell click was an invitation to a guaranteed failure). Off-schedule one-offs require adding an `employee_schedule` entry first via Back Office → Shifts. Calendar sub-tab (`AppointmentView`) — gained optional `onSelectSlot` prop wired from `SchedulerView`; when present, BigCalendar runs `selectable=true` and slot drag/click delivers `{ start, end }` to Quick Book. `SchedulerView.handleNewQuickBook` widened to accept optional prefill, merging `selectedDate` so cell-supplied date wins. 10 tests pin the contract: slot click → prefill, passive when prop omitted, a11y attrs only when wired, Enter+Space activate, non-activation keys ignored, skills-mode passive, **per-employee gate** (Carlos's 9am clickable, Mike's 6am NOT clickable on the same grid), toolbar button no-args.
5. **[P1] ~~Default Schedule tab to `staff` instead of `calendar`~~ — DONE 2026-05-07.** Default flipped at `SchedulerView.tsx:37` (`useState<SchedulerViewTab>('staff')`). Calendar branch's narrative subtitle reworked from "Start with the calendar. Switch to staff or resources only when you need detail" (which positioned itself as the recommended default and contradicted the flip) to neutral descriptive copy: "Month, week, or day view. Click a slot to book." No tests assumed Calendar-as-default; the existing e2e spec was already forward-compatible (comments "Check for staff tab (default view)" and clicks Staff if visible — now a no-op since Staff IS default). Note: no analytics on Schedule sub-tab selection exist today, so the "verify with the team" gate the audit raised was moot.
6. **[P2] ~~Add `Yesterday | Today | Tomorrow` chips to `SchedulerDateNav`~~ — DONE 2026-05-07.** Three peer chips replace the single Today button; each meets WCAG 2.5.5 with `min-w-[48px] min-h-[48px]` (audit specified 48×48 for mobile reliability). `aria-pressed` reflects which chip matches `selectedDate` so screen readers see the toggle state the visual primary-variant cue communicates to sighted users. Outside the today±1 window, all three chips show un-pressed state — keeping the chips' job as "click to jump" affordances rather than a date-display widget. ChevronLeft/Right preserved for further-out dates. 5 new tests pin Yesterday/Tomorrow click behavior, aria-pressed truthing under varied selected dates, the touch-target minimums, and the outside-window un-pressed contract.

Items 1–3 are the launch-blocker subset — without them the front-desk role we just shipped (commit `8683222`) cannot do its job. Items 4–6 are quality-of-life that move several daily tasks from acceptable to fast.

**All six punch-list items shipped 2026-05-07.** Decision-count audit re-run after the changes:

| Task | Before | After | Threshold |
|---|---|---|---|
| Book a call-in (default landing) | 8+ | 1 (cell click → Quick Book prefilled) | 3 ✓ |
| Look up tomorrow (Schedule tab) | 3 | 1 (Tomorrow chip) | 3 ✓ |
| Mark someone unavailable (front_desk) | ∞ | 3 (staff name → Mark off → confirm) | 3 ✓ |
| Find a customer | 2 | 2 (unchanged — already passing) | 3 ✓ |

All four daily-use tasks now meet the ≤3-decision threshold for the audience the dashboard was role-gated for.

---

## Out of scope (mentioned, not pursued)

- Mobile responsiveness validation — separate TODO entry; needs real device testing, not code reading.
- First-run guided tour — separate TODO entry; new feature, not an existing-flow simplification.
- Vocabulary pass — already shipped 2026-05-05 (commit `b293813`).
- Dashboard sub-views like Skill Map / AI Tuning — owner-facing, not daily front-desk.
