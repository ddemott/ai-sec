import React from 'react';
import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

// QuickBookPanel now reads service ↔ employee + service ↔ resource
// mappings via useServiceMappings (which depends on useActiveTenantId).
// Stub the hook context + the mappings endpoints so legacy QuickBookPanel
// test cases keep working without provider wrapping. Tests that need
// custom Api.appointments behavior still vi.spyOn per-test below.
vi.mock('@/lib/SessionContext', () => ({
  useActiveTenantId: () => 'tenant-1',
}));

import { SchedulerDateNav } from './SchedulerDateNav';
import { Api } from '../../lib/api';

// Default the mappings list calls to empty arrays so unmocked tests don't
// crash on hook-mount fetch. Per-test overrides via vi.spyOn still work.
vi.spyOn(Api.mappings, 'listServiceEmployee').mockResolvedValue([]);
vi.spyOn(Api.mappings, 'listServiceResource').mockResolvedValue([]);
import { TimeGrid, formatHourLabel } from './TimeGrid';
import { AppointmentBlock, getEmployeeColor, getTimeSpan } from './AppointmentBlock';
import { StaffSwimLaneView } from './StaffSwimLaneView';
import { ResourceColumnsView } from './ResourceColumnsView';
import { AppointmentListView } from './AppointmentListView';
import { EmployeeDayFocusPanel } from './EmployeeDayFocusPanel';
import { QuickBookPanel } from './QuickBookPanel';
import type { SchedulerAppointment } from './useSchedulerData';

// --- Test Data Factories ---

function makeAppointment(overrides: Partial<SchedulerAppointment> = {}): SchedulerAppointment {
  return {
    appointment_id: 'appt-1',
    tenant_id: 'tenant-1',
    resource_id: 'res-1',
    customer_id: 'cust-1',
    employee_id: '1',
    start_time: '2026-03-19T09:00:00Z',
    end_time: '2026-03-19T10:00:00Z',
    description: 'Oil Change',
    status: 'scheduled',
    customers: { name: 'Alice Smith', phone: '+15550001111' },
    resources: { name: 'Bay 1' },
    ...overrides,
  };
}

const employees = [
  { employee_id: 'emp-1', name: 'Mike Jones' },
  { employee_id: 'emp-2', name: 'Steve Lee' },
];

const resources = [
  { resource_id: 'res-1', name: 'Bay 1' },
  { resource_id: 'res-2', name: 'Bay 2' },
];

afterEach(() => {
  vi.restoreAllMocks();
});

// --- SchedulerDateNav ---

describe('SchedulerDateNav', () => {
  test('renders the selected date', () => {
    const date = new Date(2026, 2, 19); // March 19, 2026
    render(<SchedulerDateNav selectedDate={date} onDateChange={() => {}} />);
    expect(screen.getByTestId('scheduler-date-display')).toHaveTextContent('March 19, 2026');
    // WHO: receptionist | WHAT: view selected date | WHEN: scheduler loads | WHERE: SchedulerDateNav | WHY: wrong date display causes bookings on wrong day
  });

  test('calls onDateChange with previous day on prev click', () => {
    const date = new Date(2026, 2, 19);
    const onChange = vi.fn();
    render(<SchedulerDateNav selectedDate={date} onDateChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Previous day'));
    expect(onChange).toHaveBeenCalledWith(expect.any(Date));
    const newDate = onChange.mock.calls[0][0] as Date;
    expect(newDate.getDate()).toBe(18);
    // WHO: receptionist | WHAT: navigate to previous day | WHEN: prev arrow clicked | WHERE: SchedulerDateNav | WHY: broken nav traps user on one day, cannot review past schedule
  });

  test('calls onDateChange with next day on next click', () => {
    const date = new Date(2026, 2, 19);
    const onChange = vi.fn();
    render(<SchedulerDateNav selectedDate={date} onDateChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Next day'));
    const newDate = onChange.mock.calls[0][0] as Date;
    expect(newDate.getDate()).toBe(20);
    // WHO: receptionist | WHAT: navigate to next day | WHEN: next arrow clicked | WHERE: SchedulerDateNav | WHY: cannot plan tomorrow's schedule if forward nav fails
  });

  test('Today button navigates to today', () => {
    const date = new Date(2026, 2, 19);
    const onChange = vi.fn();
    render(<SchedulerDateNav selectedDate={date} onDateChange={onChange} />);
    fireEvent.click(screen.getByText('Today'));
    const newDate = onChange.mock.calls[0][0] as Date;
    const today = new Date();
    expect(newDate.getDate()).toBe(today.getDate());
    // WHO: receptionist | WHAT: jump to today | WHEN: Today button clicked after browsing other dates | WHERE: SchedulerDateNav | WHY: user gets lost in past/future dates and cannot return to current day
  });

  // --- Front-desk audit P2 #6: Yesterday | Today | Tomorrow chips ---
  test('Yesterday chip navigates to yesterday', () => {
    const date = new Date(2026, 2, 19);
    const onChange = vi.fn();
    render(<SchedulerDateNav selectedDate={date} onDateChange={onChange} />);
    fireEvent.click(screen.getByTestId('date-chip-yesterday'));
    const newDate = onChange.mock.calls[0][0] as Date;
    const expected = new Date();
    expected.setDate(expected.getDate() - 1);
    expect(newDate.getDate()).toBe(expected.getDate());
    expect(newDate.getMonth()).toBe(expected.getMonth());
    expect(newDate.getFullYear()).toBe(expected.getFullYear());
    // WHO: front-desk operator answering "what was yesterday?" | WHAT: one-click jump to yesterday's schedule | WHEN: customer asks about an appointment from the prior day | WHERE: SchedulerDateNav Yesterday chip | WHY: pre-fix this required either ChevronLeft tap (twice if currently on tomorrow) or mental math on the calendar; the audit cited this as a P2 polish that turns a 2-3-decision navigation into a 1-decision affordance
  });

  test('Tomorrow chip navigates to tomorrow', () => {
    const date = new Date(2026, 2, 19);
    const onChange = vi.fn();
    render(<SchedulerDateNav selectedDate={date} onDateChange={onChange} />);
    fireEvent.click(screen.getByTestId('date-chip-tomorrow'));
    const newDate = onChange.mock.calls[0][0] as Date;
    const expected = new Date();
    expected.setDate(expected.getDate() + 1);
    expect(newDate.getDate()).toBe(expected.getDate());
    expect(newDate.getMonth()).toBe(expected.getMonth());
    expect(newDate.getFullYear()).toBe(expected.getFullYear());
    // WHO: front-desk operator preparing for tomorrow's load | WHAT: one-click jump to tomorrow's schedule | WHEN: end-of-day prep, "what's the morning look like?" | WHERE: SchedulerDateNav Tomorrow chip | WHY: tomorrow is the second-most-frequent date jump after today; surfacing it as a peer chip removes the implicit hierarchy where "Today" was a button but "Tomorrow" required arrow-tapping
  });

  test('chip aria-pressed reflects which chip matches the selected date', () => {
    // Selected date IS today.
    const today = new Date();
    const onChange = vi.fn();
    const { rerender } = render(<SchedulerDateNav selectedDate={today} onDateChange={onChange} />);
    expect(screen.getByTestId('date-chip-today')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('date-chip-yesterday')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('date-chip-tomorrow')).toHaveAttribute('aria-pressed', 'false');

    // Now selected date IS tomorrow.
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    rerender(<SchedulerDateNav selectedDate={tomorrow} onDateChange={onChange} />);
    expect(screen.getByTestId('date-chip-tomorrow')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('date-chip-today')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('date-chip-yesterday')).toHaveAttribute('aria-pressed', 'false');
    // WHO: screen-reader user navigating the date chips | WHAT: aria-pressed announces which day is currently selected | WHEN: assistive tech focus lands on the chip group | WHERE: SchedulerDateNav aria-pressed wiring | WHY: the visual variant=primary cue that sighted users see is invisible to screen readers; aria-pressed is the canonical ARIA pattern for toggle-style chips and lets a blind operator know "I'm currently on Today" vs "I'm currently on Tomorrow" without trial-and-error
  });

  test('chips meet WCAG 2.5.5 minimum 48×48 touch-target sizing', () => {
    const date = new Date();
    render(<SchedulerDateNav selectedDate={date} onDateChange={() => {}} />);
    for (const testId of ['date-chip-yesterday', 'date-chip-today', 'date-chip-tomorrow']) {
      const chip = screen.getByTestId(testId);
      expect(chip.className).toContain('min-w-[48px]');
      expect(chip.className).toContain('min-h-[48px]');
    }
    // WHO: mobile front-desk users (tire shop / salon owners checking schedules between customers per the audit) | WHAT: chip touch targets meet the WCAG 2.1 AA minimum | WHEN: assistive-tech audits or mobile QA | WHERE: SchedulerDateNav chip className | WHY: the audit explicitly called out 48×48 (R2.2); pinning the className guards against a future refactor that strips the minimum-size utility classes — a chip below 44×44 is a real-world tap-failure on phones, not a theoretical concern
  });

  test('outside the today/yesterday/tomorrow window, no chip is aria-pressed', () => {
    const date = new Date(2026, 2, 19); // Far past from real-world "today"
    render(<SchedulerDateNav selectedDate={date} onDateChange={() => {}} />);
    expect(screen.getByTestId('date-chip-yesterday')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('date-chip-today')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('date-chip-tomorrow')).toHaveAttribute('aria-pressed', 'false');
    // WHO: operator browsing a date several days out via the Chevron arrows | WHAT: all three chips show un-pressed state | WHEN: selectedDate is more than ±1 day from today | WHERE: SchedulerDateNav active-chip detection | WHY: a chip showing "pressed" while the user is on an unrelated date would be a lie; the chips' job is to advertise "click here to jump to X" — they're not a date-display widget
  });

  // --- Tenant-timezone-aware behavior (docs/TODO.md P2, closed 2026-05-13) ---

  test('with tenantTimezone, Today chip computes against tenant calendar — not browser calendar', () => {
    // WHO: super-admin in some other browser TZ reviewing a Chicago tenant's
    //      schedule. Real-world: at the time this test runs in CI/local, the
    //      browser's getDate() vs. Chicago's calendar date may or may not
    //      agree. The aria-pressed state must reflect Chicago's calendar
    //      regardless.
    // WHAT: when selectedDate is a noon-UTC anchor for "today in Chicago",
    //       the Today chip's aria-pressed is true.
    // WHEN: any cross-TZ admin session.
    // WHERE: SchedulerDateNav's tenantTimezone-aware branch.
    // WHY: pin that the TZ branch actually fires when the prop is provided.
    //      A regression that ignored the prop would still pass the prop-less
    //      tests above but fail this one — surfaces the wiring break loud.
    const now = new Date();
    const tz = 'America/Chicago';
    const todayParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const y = Number(todayParts.find(p => p.type === 'year')?.value);
    const m = Number(todayParts.find(p => p.type === 'month')?.value);
    const d = Number(todayParts.find(p => p.type === 'day')?.value);
    const todayInTz = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)); // noon UTC anchor
    render(<SchedulerDateNav selectedDate={todayInTz} onDateChange={() => {}} tenantTimezone={tz} />);
    expect(screen.getByTestId('date-chip-today')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('date-chip-yesterday')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('date-chip-tomorrow')).toHaveAttribute('aria-pressed', 'false');
  });

  test('with tenantTimezone, Tomorrow chip uses TZ-aware noon-UTC anchor for onChange', () => {
    // WHO: operator clicking Tomorrow on a tenant in Asia/Tokyo while their
    //      browser is in UTC. Without the TZ-aware path, clicking "Tomorrow"
    //      would set selectedDate to browser-local-tomorrow — which might be
    //      tomorrow OR two-days-ahead in Tokyo depending on time of day.
    // WHAT: clicking the Tomorrow chip fires onDateChange with a Date whose
    //       Tokyo calendar tuple matches tomorrow-in-Tokyo.
    // WHEN: forward-of-UTC tenants under any admin browser TZ.
    // WHERE: SchedulerDateNav's tomorrow target computation.
    // WHY: pins the FORWARD-zone branch of the TZ-aware path. Catches a
    //      regression where the +24h math accidentally subtracts.
    const onChange = vi.fn();
    const tz = 'Asia/Tokyo';
    render(<SchedulerDateNav selectedDate={new Date('2000-01-01T00:00:00Z')} onDateChange={onChange} tenantTimezone={tz} />);
    fireEvent.click(screen.getByTestId('date-chip-tomorrow'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const passed = onChange.mock.calls[0][0] as Date;

    // Compute tomorrow-in-Tokyo independently of the helper, then assert the
    // dispatched Date matches.
    const tomorrowInstant = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(tomorrowInstant);
    const y = Number(parts.find(p => p.type === 'year')?.value);
    const m = Number(parts.find(p => p.type === 'month')?.value);
    const d = Number(parts.find(p => p.type === 'day')?.value);

    expect(passed.getUTCFullYear()).toBe(y);
    expect(passed.getUTCMonth()).toBe(m - 1);
    expect(passed.getUTCDate()).toBe(d);
    expect(passed.getUTCHours()).toBe(12); // noon-UTC anchor
  });

  test('without tenantTimezone, falls back to legacy browser-TZ behavior (backwards compat)', () => {
    // WHO: any caller that doesn't yet pass tenantTimezone — including the
    //      ~500 existing scheduler tests that predate this prop.
    // WHAT: omit the prop entirely, click Today, assert the legacy
    //       startOfDay(new Date()) shape is preserved (00:00 in browser TZ).
    // WHEN: the prop-load race during SchedulerView's first render, while
    //       useTenantTimezone() is still resolving the fetch.
    // WHERE: SchedulerDateNav's else-branch of the tenantTimezone gate.
    // WHY: pin the backwards-compatibility contract. If a refactor removes
    //      the legacy branch (because "tenantTimezone is always present"),
    //      the first-render flash would show no chip pressed — UX regression.
    const onChange = vi.fn();
    render(<SchedulerDateNav selectedDate={new Date()} onDateChange={onChange} />);
    fireEvent.click(screen.getByTestId('date-chip-today'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const passed = onChange.mock.calls[0][0] as Date;
    // Legacy: hours/minutes/seconds zeroed (startOfDay), date matches browser today
    expect(passed.getHours()).toBe(0);
    expect(passed.getMinutes()).toBe(0);
    expect(passed.getSeconds()).toBe(0);
    expect(passed.getDate()).toBe(new Date().getDate());
  });
});

// --- TimeGrid ---

describe('TimeGrid', () => {
  test('renders hour labels from startHour to endHour', () => {
    render(<TimeGrid startHour={7} endHour={10} />);
    expect(screen.getByText('7 AM')).toBeInTheDocument();
    expect(screen.getByText('8 AM')).toBeInTheDocument();
    expect(screen.getByText('9 AM')).toBeInTheDocument();
    // WHO: receptionist | WHAT: view custom hour range | WHEN: scheduler renders with startHour/endHour props | WHERE: TimeGrid | WHY: missing hour labels make it impossible to place appointments at correct times
  });

  test('renders default hours (7am to 8pm)', () => {
    render(<TimeGrid />);
    expect(screen.getByText('7 AM')).toBeInTheDocument();
    expect(screen.getByText('12 PM')).toBeInTheDocument();
    expect(screen.getByText('7 PM')).toBeInTheDocument();
    // WHO: receptionist | WHAT: view default business hours grid | WHEN: no custom hours specified | WHERE: TimeGrid | WHY: default grid must cover full business day or early/late appointments are invisible
  });

  test('formatHourLabel handles noon and midnight', () => {
    expect(formatHourLabel(0)).toBe('12 AM');
    expect(formatHourLabel(12)).toBe('12 PM');
    expect(formatHourLabel(15)).toBe('3 PM');
    // WHO: receptionist | WHAT: read AM/PM labels for edge-case hours | WHEN: grid renders noon or midnight columns | WHERE: TimeGrid (formatHourLabel) | WHY: wrong label at noon/midnight causes 12-hour confusion and misbooked times
  });
});

// --- AppointmentBlock ---

describe('AppointmentBlock', () => {
  test('renders customer name', () => {
    const appt = makeAppointment();
    render(
      <div style={{ position: 'relative', width: 800, height: 50 }}>
        <AppointmentBlock appointment={appt} />
      </div>
    );
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    // WHO: receptionist | WHAT: see customer name on appointment block | WHEN: appointment renders in swimlane | WHERE: AppointmentBlock | WHY: unnamed blocks force receptionist to click each one to identify customers
  });

  test('applies canceled styling', () => {
    const appt = makeAppointment({ status: 'canceled' });
    render(
      <div style={{ position: 'relative', width: 800, height: 50 }}>
        <AppointmentBlock appointment={appt} />
      </div>
    );
    const block = screen.getByTestId('appointment-block-appt-1');
    expect(block.className).toContain('opacity-40');
    expect(block.className).toContain('line-through');
    // WHO: receptionist | WHAT: visually distinguish canceled appointments | WHEN: appointment status is canceled | WHERE: AppointmentBlock | WHY: without visual diff, staff may prepare for canceled appointments wasting time and resources
  });

  test('calls onClick when clicked', () => {
    const appt = makeAppointment();
    const onClick = vi.fn();
    render(
      <div style={{ position: 'relative', width: 800, height: 50 }}>
        <AppointmentBlock appointment={appt} onClick={onClick} />
      </div>
    );
    fireEvent.click(screen.getByText('Alice Smith'));
    expect(onClick).toHaveBeenCalledWith(appt, expect.any(Object));
    // WHO: receptionist | WHAT: click appointment to view details | WHEN: appointment block clicked | WHERE: AppointmentBlock
    // WHY: onClick receives (appointment, mouseEvent) — unclickable blocks prevent viewing or editing appointment details
  });

  test('getEmployeeColor returns gray for null employee', () => {
    expect(getEmployeeColor(null)).toBe('bg-gray-400');
    // WHO: receptionist | WHAT: see neutral color for unassigned appointments | WHEN: employee_id is null | WHERE: AppointmentBlock (getEmployeeColor) | WHY: crash or missing color on unassigned blocks hides walk-in appointments
  });

  test('getTimeSpan calculates correct position', () => {
    const { left, width } = getTimeSpan(
      '2026-03-19T09:00:00',
      '2026-03-19T10:00:00',
      7, 20
    );
    // 9am is 2 hours into the 13-hour range (7-20), so left ≈ 0.154
    expect(left).toBeCloseTo(2 / 13, 1);
    // 1 hour out of 13-hour range, so width ≈ 0.077
    expect(width).toBeCloseTo(1 / 13, 1);
    // WHO: receptionist | WHAT: see appointment block at correct horizontal position | WHEN: appointment has start/end times | WHERE: AppointmentBlock (getTimeSpan) | WHY: wrong positioning makes appointments appear at wrong times, causing scheduling confusion
  });
});

// --- StaffSwimLaneView ---

describe('StaffSwimLaneView', () => {
  test('renders a row for each employee', () => {
    const apptMap = new Map<string, SchedulerAppointment[]>();
    apptMap.set('1', []);
    apptMap.set('2', []);
    apptMap.set('unassigned', []);
    const shiftMap = new Map<string, { id: string; start_time: string; end_time: string; day_of_week: number }[]>();
    shiftMap.set('1', []);
    shiftMap.set('2', []);

    render(
      <StaffSwimLaneView
        employees={employees}
        appointmentsByEmployee={apptMap}
        shiftsByEmployee={shiftMap}
      />
    );
    expect(screen.getByTestId('swimlane-row-emp-1')).toBeInTheDocument();
    expect(screen.getByTestId('swimlane-row-emp-2')).toBeInTheDocument();
    expect(screen.getByText('Mike Jones')).toBeInTheDocument();
    expect(screen.getByText('Steve Lee')).toBeInTheDocument();
    // WHO: admin | WHAT: see all staff in swimlane rows | WHEN: scheduler loads with employees | WHERE: StaffSwimLaneView | WHY: missing employee rows hide their appointments and shifts entirely
  });

  test('renders unassigned row when there are unassigned appointments', () => {
    const apptMap = new Map<string, SchedulerAppointment[]>();
    apptMap.set('1', []);
    apptMap.set('2', []);
    apptMap.set('unassigned', [makeAppointment({ employee_id: null })]);
    const shiftMap = new Map<string, { id: string; start_time: string; end_time: string; day_of_week: number }[]>();

    render(
      <StaffSwimLaneView
        employees={employees}
        appointmentsByEmployee={apptMap}
        shiftsByEmployee={shiftMap}
      />
    );
    expect(screen.getByTestId('swimlane-row-unassigned')).toBeInTheDocument();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
    // WHO: receptionist | WHAT: see unassigned appointments row | WHEN: appointments exist without employee_id | WHERE: StaffSwimLaneView | WHY: unassigned bookings (e.g., voice AI walk-ins) become invisible without this row
  });

  test('calls onEmployeeClick when employee label is clicked', () => {
    const apptMap = new Map<string, SchedulerAppointment[]>();
    apptMap.set('1', []);
    apptMap.set('2', []);
    apptMap.set('unassigned', []);
    const shiftMap = new Map<string, { id: string; start_time: string; end_time: string; day_of_week: number }[]>();
    const onEmployeeClick = vi.fn();

    render(
      <StaffSwimLaneView
        employees={employees}
        appointmentsByEmployee={apptMap}
        shiftsByEmployee={shiftMap}
        onEmployeeClick={onEmployeeClick}
      />
    );
    fireEvent.click(screen.getByText('Mike Jones'));
    expect(onEmployeeClick).toHaveBeenCalledWith(employees[0]);
    // WHO: admin | WHAT: click employee name to open day focus | WHEN: employee label clicked | WHERE: StaffSwimLaneView | WHY: without this, admin cannot drill into individual staff utilization or reassign work
  });

  test('clicking on-shift cell initiates move (no onSlotClick — replaced with shift move)', () => {
    const apptMap = new Map<string, SchedulerAppointment[]>();
    apptMap.set('1', []);
    apptMap.set('2', []);
    apptMap.set('unassigned', []);
    const shiftMap = new Map<string, { id: string; start_time: string; end_time: string; day_of_week: number }[]>();
    shiftMap.set('1', [{ id: 'shift-1', start_time: '09:00', end_time: '17:00', day_of_week: 4 }]);
    shiftMap.set('2', []);
    const onShiftResize = vi.fn();

    render(
      <StaffSwimLaneView
        employees={employees}
        appointmentsByEmployee={apptMap}
        shiftsByEmployee={shiftMap}
        onShiftResize={onShiftResize}
      />
    );
    // Click on an on-shift cell starts a move — same position = no change, so onShiftResize not called
    const slot = screen.getByTestId('slot-emp-1-10');
    fireEvent.mouseDown(slot);
    fireEvent.mouseUp(slot);
    // No resize called because shift didn't actually move
    expect(onShiftResize).not.toHaveBeenCalled();
    // WHO: admin | WHAT: click-release on existing shift cell without dragging | WHEN: mouseDown+mouseUp on same on-shift slot | WHERE: StaffSwimLaneView | WHY: accidental clicks should not resize shifts, preventing unintended schedule changes
  });

  test('calls onShiftDrag when clicking on off-shift (hatched) cell', () => {
    const apptMap = new Map<string, SchedulerAppointment[]>();
    apptMap.set('1', []);
    apptMap.set('2', []);
    apptMap.set('unassigned', []);
    const shiftMap = new Map<string, { id: string; start_time: string; end_time: string; day_of_week: number }[]>();
    shiftMap.set('1', [{ id: 'shift-2', start_time: '12:00', end_time: '17:00', day_of_week: 4 }]);
    shiftMap.set('2', []);
    const onShiftDrag = vi.fn();

    render(
      <StaffSwimLaneView
        employees={employees}
        appointmentsByEmployee={apptMap}
        shiftsByEmployee={shiftMap}
        onShiftDrag={onShiftDrag}
      />
    );
    // Single click on off-shift cell creates a 1-hour shift
    fireEvent.mouseDown(screen.getByTestId('slot-emp-1-8'));
    fireEvent.mouseUp(screen.getByTestId('slot-emp-1-8'));
    expect(onShiftDrag).toHaveBeenCalledWith('emp-1', 8, 9);
    // WHO: admin | WHAT: create new shift by clicking off-shift cell | WHEN: click on hatched (unscheduled) time slot | WHERE: StaffSwimLaneView | WHY: allows quick shift creation without opening a separate form
  });
});

// --- ResourceColumnsView ---

describe('ResourceColumnsView', () => {
  test('renders empty state when no resources', () => {
    const apptMap = new Map<string, SchedulerAppointment[]>();
    render(
      <ResourceColumnsView
        resources={[]}
        appointmentsByResource={apptMap}
        shiftsByEmployee={new Map()}
        employees={[]}
      />
    );
    expect(screen.getByTestId('resource-columns-empty')).toBeInTheDocument();
    // WHO: admin | WHAT: see empty state when no resources configured | WHEN: tenant has zero resources | WHERE: ResourceColumnsView | WHY: blank screen without empty state confuses new users during onboarding
  });

  test('renders a column for each resource', () => {
    const apptMap = new Map<string, SchedulerAppointment[]>();
    apptMap.set('res-1', []);
    apptMap.set('res-2', []);

    render(
      <ResourceColumnsView
        resources={resources}
        appointmentsByResource={apptMap}
        shiftsByEmployee={new Map()}
        employees={[]}
      />
    );
    expect(screen.getByText('Bay 1')).toBeInTheDocument();
    expect(screen.getByText('Bay 2')).toBeInTheDocument();
    // WHO: receptionist | WHAT: see all resource columns | WHEN: resources exist for tenant | WHERE: ResourceColumnsView | WHY: missing columns hide resource availability, leading to double-bookings
  });

  test('shows appointment in the correct resource column', () => {
    const appt = makeAppointment();
    const apptMap = new Map<string, SchedulerAppointment[]>();
    apptMap.set('res-1', [appt]);
    apptMap.set('res-2', []);

    render(
      <ResourceColumnsView
        resources={resources}
        appointmentsByResource={apptMap}
        shiftsByEmployee={new Map()}
        employees={[]}
      />
    );
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    // WHO: receptionist | WHAT: see appointment under correct resource | WHEN: appointment has resource_id | WHERE: ResourceColumnsView | WHY: appointment in wrong column causes staff to prepare wrong bay/station
  });
});

// --- AppointmentListView ---

describe('AppointmentListView', () => {
  test('renders empty state when no appointments', () => {
    render(
      <AppointmentListView
        appointments={[]}
        employees={employees}
        resources={resources}
      />
    );
    expect(screen.getByTestId('appointment-list-empty')).toBeInTheDocument();
    // WHO: receptionist | WHAT: see empty state for no appointments | WHEN: day has zero bookings | WHERE: AppointmentListView | WHY: blank list without messaging makes receptionist think data failed to load
  });

  test('renders appointments in chronological order', () => {
    const appts = [
      makeAppointment({ appointment_id: 'a2', start_time: '2026-03-19T14:00:00Z', end_time: '2026-03-19T15:00:00Z', customers: { name: 'Bob' } }),
      makeAppointment({ appointment_id: 'a1', start_time: '2026-03-19T09:00:00Z', end_time: '2026-03-19T10:00:00Z', customers: { name: 'Alice' } }),
    ];

    render(
      <AppointmentListView
        appointments={appts}
        employees={employees}
        resources={resources}
      />
    );
    const items = screen.getAllByText(/Alice|Bob/);
    expect(items[0]).toHaveTextContent('Alice');
    expect(items[1]).toHaveTextContent('Bob');
    // WHO: receptionist | WHAT: view appointments sorted by time | WHEN: multiple appointments on same day | WHERE: AppointmentListView | WHY: out-of-order list causes receptionist to miss upcoming appointments or prep in wrong sequence
  });

  test('shows gap warning for gaps > 1 hour', () => {
    const appts = [
      makeAppointment({ appointment_id: 'a1', start_time: '2026-03-19T09:00:00Z', end_time: '2026-03-19T10:00:00Z' }),
      makeAppointment({ appointment_id: 'a2', start_time: '2026-03-19T13:00:00Z', end_time: '2026-03-19T14:00:00Z' }),
    ];

    render(
      <AppointmentListView
        appointments={appts}
        employees={employees}
        resources={resources}
      />
    );
    expect(screen.getByTestId('gap-warning-1')).toBeInTheDocument();
    expect(screen.getByTestId('gap-warning-1')).toHaveTextContent('3h 0m gap');
    // WHO: admin | WHAT: see gap warnings between appointments | WHEN: gap exceeds 1 hour | WHERE: AppointmentListView | WHY: hidden gaps mean lost revenue opportunities that admin cannot identify and fill
  });

  test('hides canceled appointments', () => {
    const appts = [
      makeAppointment({ appointment_id: 'a1', status: 'canceled', customers: { name: 'Canceled Guy' } }),
      makeAppointment({ appointment_id: 'a2', customers: { name: 'Active Alice' } }),
    ];

    render(
      <AppointmentListView
        appointments={appts}
        employees={employees}
        resources={resources}
      />
    );
    expect(screen.queryByText('Canceled Guy')).not.toBeInTheDocument();
    expect(screen.getByText('Active Alice')).toBeInTheDocument();
    // WHO: receptionist | WHAT: filter out canceled appointments from list | WHEN: mix of active and canceled bookings | WHERE: AppointmentListView | WHY: showing canceled items clutters the list and may cause staff to prepare for no-shows
  });

  test('calls onAppointmentClick when item is clicked', () => {
    const appt = makeAppointment();
    const onClick = vi.fn();

    render(
      <AppointmentListView
        appointments={[appt]}
        employees={employees}
        resources={resources}
        onAppointmentClick={onClick}
      />
    );
    fireEvent.click(screen.getByTestId('list-item-appt-1'));
    expect(onClick).toHaveBeenCalledWith(appt, expect.any(Object));
    // WHO: receptionist | WHAT: click appointment in list to view details | WHEN: list item clicked | WHERE: AppointmentListView
    // WHY: onAppointmentClick receives (appointment, mouseEvent) — unclickable list items prevent viewing customer info or editing the booking
  });
});

// --- EmployeeDayFocusPanel ---

describe('EmployeeDayFocusPanel', () => {
  test('renders nothing when not open', () => {
    const { container } = render(
      <EmployeeDayFocusPanel
        isOpen={false}
        onClose={() => {}}
        employee={employees[0]}
        appointments={[]}
        shifts={[]}
      />
    );
    expect(container.innerHTML).toBe('');
    // WHO: receptionist | WHAT: hide focus panel when closed | WHEN: isOpen is false | WHERE: EmployeeDayFocusPanel | WHY: rendering closed panel wastes screen space and confuses layout
  });

  test('renders employee name when open', () => {
    render(
      <EmployeeDayFocusPanel
        isOpen={true}
        onClose={() => {}}
        employee={employees[0]}
        appointments={[]}
        shifts={[]}
      />
    );
    expect(screen.getByText('Mike Jones')).toBeInTheDocument();
    // WHO: admin | WHAT: see employee name in focus panel | WHEN: panel opened for a specific employee | WHERE: EmployeeDayFocusPanel | WHY: without name, admin cannot confirm which employee's schedule they are reviewing
  });

  test('shows appointment count and utilization stats', () => {
    const appts = [
      makeAppointment({ start_time: '2026-03-19T09:00:00Z', end_time: '2026-03-19T10:00:00Z' }),
      makeAppointment({ appointment_id: 'appt-2', start_time: '2026-03-19T11:00:00Z', end_time: '2026-03-19T12:00:00Z' }),
    ];
    const shifts = [{ start_time: '09:00', end_time: '17:00' }];

    render(
      <EmployeeDayFocusPanel
        isOpen={true}
        onClose={() => {}}
        employee={employees[0]}
        appointments={appts}
        shifts={shifts}
      />
    );
    expect(screen.getByTestId('focus-appointment-count')).toHaveTextContent('2');
    expect(screen.getByTestId('focus-booked-hours')).toHaveTextContent('2.0h');
    expect(screen.getByTestId('focus-utilization')).toHaveTextContent('25%');
    // WHO: admin | WHAT: view utilization stats (count, hours, percentage) | WHEN: employee has appointments and shifts | WHERE: EmployeeDayFocusPanel | WHY: wrong utilization math leads admin to over- or under-staff shifts
  });

  test('calls onClose when X is clicked', () => {
    const onClose = vi.fn();
    render(
      <EmployeeDayFocusPanel
        isOpen={true}
        onClose={onClose}
        employee={employees[0]}
        appointments={[]}
        shifts={[]}
      />
    );
    fireEvent.click(screen.getByLabelText('Close focus panel'));
    expect(onClose).toHaveBeenCalled();
    // WHO: admin | WHAT: close focus panel via X button | WHEN: admin done reviewing employee | WHERE: EmployeeDayFocusPanel | WHY: unclosable panel blocks scheduler view and forces page reload
  });
});

// --- QuickBookPanel ---

describe('QuickBookPanel', () => {
  test('renders nothing when not open', () => {
    const { container } = render(
      <QuickBookPanel
        isOpen={false}
        onClose={() => {}}
        tenantId="t1"
        customers={[]}
        employees={[]}
        resources={[]}
        services={[]}
        onBooked={() => {}}
      />
    );
    expect(container.innerHTML).toBe('');
    // WHO: receptionist | WHAT: hide quick book panel when closed | WHEN: isOpen is false | WHERE: QuickBookPanel | WHY: visible closed panel overlaps scheduler and wastes screen real estate
  });

  test('renders Quick Book heading when open', () => {
    render(
      <QuickBookPanel
        isOpen={true}
        onClose={() => {}}
        tenantId="t1"
        customers={[{ customer_id: 'c1', name: 'Alice', phone: '555-0001' }]}
        employees={employees}
        resources={resources}
        services={[{ service_id: 'svc-1', name: 'Oil Change', duration_minutes: 30 }]}
        onBooked={() => {}}
      />
    );
    expect(screen.getByText('Quick Book')).toBeInTheDocument();
    // WHO: receptionist | WHAT: see Quick Book heading when panel opens | WHEN: panel opened from scheduler | WHERE: QuickBookPanel | WHY: missing heading leaves receptionist unsure which panel action they triggered
  });

  test('calls onClose when X is clicked', () => {
    const onClose = vi.fn();
    render(
      <QuickBookPanel
        isOpen={true}
        onClose={onClose}
        tenantId="t1"
        customers={[]}
        employees={[]}
        resources={resources}
        services={[]}
        onBooked={() => {}}
      />
    );
    fireEvent.click(screen.getByLabelText('Close quick book'));
    expect(onClose).toHaveBeenCalled();
    // WHO: receptionist | WHAT: close quick book panel via X button | WHEN: receptionist cancels booking | WHERE: QuickBookPanel | WHY: unclosable panel blocks the scheduler and forces page reload to dismiss
  });

  test('Book Now button is disabled when no customer selected', () => {
    render(
      <QuickBookPanel
        isOpen={true}
        onClose={() => {}}
        tenantId="t1"
        customers={[]}
        employees={[]}
        resources={resources}
        services={[]}
        onBooked={() => {}}
      />
    );
    const btn = screen.getByTestId('quick-book-confirm');
    expect(btn).toBeDisabled();
    // WHO: receptionist | WHAT: prevent booking without customer | WHEN: no customer selected in form | WHERE: QuickBookPanel | WHY: submitting without customer creates orphaned appointments with no contact info
  });

  test('rejects end time before start time and does not book', async () => {
    const createSpy = vi.spyOn(Api.appointments, 'create').mockResolvedValue({ success: true, appointment_id: 'appt-123' } as Awaited<ReturnType<typeof Api.appointments.create>>);

    render(
      <QuickBookPanel
        isOpen={true}
        onClose={() => {}}
        tenantId="t1"
        customers={[{ customer_id: 'c1', name: 'Alice', phone: '555-0001' }]}
        employees={employees}
        resources={resources}
        services={[]}
        onBooked={() => {}}
      />
    );

    fireEvent.change(screen.getByTestId('quick-book-customer'), { target: { value: 'c1' } });
    fireEvent.change(screen.getByTestId('quick-book-resource'), { target: { value: 'res-1' } });
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2026-05-01T10:00' } });
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '2026-05-01T09:00' } });
    fireEvent.click(screen.getByTestId('quick-book-confirm'));

    expect(await screen.findByText('End time must be after start time')).toBeInTheDocument();
    expect(createSpy).not.toHaveBeenCalled();
    // WHO: receptionist | WHAT: block swapped start/end times | WHEN: quick book submit | WHERE: QuickBookPanel | WHY: reversed times would create a nonsense appointment and confuse the schedule
  });

  test('rejects an appointment longer than 12 hours and does not book', async () => {
    const createSpy = vi.spyOn(Api.appointments, 'create').mockResolvedValue({ success: true, appointment_id: 'appt-456' } as Awaited<ReturnType<typeof Api.appointments.create>>);

    render(
      <QuickBookPanel
        isOpen={true}
        onClose={() => {}}
        tenantId="t1"
        customers={[{ customer_id: 'c1', name: 'Alice', phone: '555-0001' }]}
        employees={employees}
        resources={resources}
        services={[]}
        onBooked={() => {}}
      />
    );

    fireEvent.change(screen.getByTestId('quick-book-customer'), { target: { value: 'c1' } });
    fireEvent.change(screen.getByTestId('quick-book-resource'), { target: { value: 'res-1' } });
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2026-05-01T10:00' } });
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '2026-05-02T09:00' } });
    fireEvent.click(screen.getByTestId('quick-book-confirm'));

    expect(await screen.findByText('Appointment duration cannot exceed 12 hours')).toBeInTheDocument();
    expect(createSpy).not.toHaveBeenCalled();
    // WHO: receptionist | WHAT: block accidental 23-hour booking | WHEN: quick book submit | WHERE: QuickBookPanel | WHY: absurd durations are almost always a start/end mix-up and should fail fast
  });
});
