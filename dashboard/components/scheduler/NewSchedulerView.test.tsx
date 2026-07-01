import React from 'react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock the hooks and API before importing the component
const mockRefreshStaticData = vi.fn();
const mockRefreshScheduler = vi.fn();

const mockEmployees = [
  {
    employee_id: 'emp-1',
    tenant_id: 't1',
    name: 'Mike Jones',
    skills: ['Oil Change', 'Tire Rotation'],
    is_active: true,
    type: 'employee' as const,
  },
  {
    employee_id: 'emp-2',
    tenant_id: 't1',
    name: 'Carlos Rivera',
    skills: ['Tire Rotation', 'Balancing'],
    is_active: true,
    type: 'employee' as const,
  },
  {
    employee_id: 'emp-3',
    tenant_id: 't1',
    name: 'Admin User',
    skills: [],
    is_active: true,
    type: 'user' as const,
  },
];

const mockServices = [
  { service_id: 'svc-1', tenant_id: 't1', name: 'Oil Change', duration_minutes: 30 },
  { service_id: 'svc-2', tenant_id: 't1', name: 'Tire Rotation', duration_minutes: 45 },
];

const mockAppointments = [
  {
    appointment_id: 'appt-1',
    tenant_id: 't1',
    resource_id: 'res-1',
    customer_id: 'cust-1',
    employee_id: 'emp-1',
    start_time: '2026-03-24T09:00:00Z',
    end_time: '2026-03-24T10:00:00Z',
    description: 'Oil Change',
    status: 'scheduled',
    customers: { name: 'Alice Smith', phone: '+15550001111' },
    resources: { name: 'Bay 1' },
  },
  {
    appointment_id: 'appt-2',
    tenant_id: 't1',
    resource_id: 'res-1',
    customer_id: 'cust-2',
    employee_id: 'emp-2',
    start_time: '2026-03-24T14:00:00Z',
    end_time: '2026-03-24T15:30:00Z',
    description: 'Tire Rotation',
    status: 'completed',
    customers: { name: 'Bob Johnson', phone: '+15550002222' },
    resources: { name: 'Bay 1' },
  },
  {
    appointment_id: 'appt-3',
    tenant_id: 't1',
    resource_id: 'res-2',
    customer_id: 'cust-3',
    employee_id: null,
    start_time: '2026-03-24T11:00:00Z',
    end_time: '2026-03-24T11:30:00Z',
    description: 'Quick Check',
    status: 'scheduled',
    customers: { name: 'Unassigned Customer', phone: '+15550003333' },
    resources: { name: 'Bay 2' },
  },
];

const mockShifts = [
  {
    id: 'shift-1',
    employee_id: 'emp-1',
    day_of_week: new Date().getDay(),
    start_time: '08:00:00',
    end_time: '16:00:00',
  },
  {
    id: 'shift-2',
    employee_id: 'emp-2',
    day_of_week: new Date().getDay(),
    start_time: '09:00:00',
    end_time: '17:00:00',
  },
];

// Build appointmentsByEmployee map
function buildApptMap() {
  const map = new Map();
  map.set('emp-1', [mockAppointments[0]]);
  map.set('emp-2', [mockAppointments[1]]);
  map.set('unassigned', [mockAppointments[2]]);
  return map;
}

function buildShiftsByEmployee() {
  return new Map([
    ['emp-1', [mockShifts[0]]],
    ['emp-2', [mockShifts[1]]],
  ]);
}

// Overridable mock state — tests can set these before render to simulate sad paths
let mockStaticDataOverride: ReturnType<typeof buildDefaultStaticData> | null = null;
let mockSchedulerDataOverride: ReturnType<typeof buildDefaultSchedulerData> | null = null;

function buildDefaultStaticData() {
  return {
    employees: mockEmployees,
    services: mockServices,
    customers: [],
    resources: [],
    skills: [],
    refresh: mockRefreshStaticData,
    loading: false,
    error: null,
  };
}

function buildDefaultSchedulerData() {
  return {
    appointments: mockAppointments,
    shifts: mockShifts,
    loading: false,
    error: null,
    appointmentsByEmployee: buildApptMap(),
    appointmentsByResource: new Map(),
    shiftsByEmployee: buildShiftsByEmployee(),
    refresh: mockRefreshScheduler,
  };
}

vi.mock('../../lib/hooks', () => ({
  useStaticData: () => mockStaticDataOverride || buildDefaultStaticData(),
}));

// Mock Api for service-employee mappings (used by Skills mode) and the
// Mark-off action (front-desk audit P0 #2). vi.hoisted lets per-test
// reset + override of the save-shift behavior so we can pin happy and
// sad paths independently.
const { mockApi, mockShowToast } = vi.hoisted(() => ({
  mockApi: {
    mappings: {
      listServiceEmployee: vi.fn(),
    },
    shifts: {
      schedule: {
        save: vi.fn(),
      },
    },
  },
  mockShowToast: vi.fn(),
}));

vi.mock('../../lib/api', () => ({ Api: mockApi }));
vi.mock('../ui/Toast', () => ({ showToast: mockShowToast, ToastContainer: () => null }));

vi.mock('../../lib/SessionContext', () => ({
  useActiveTenantId: () => 'tenant-1',
}));

vi.mock('./useSchedulerData', () => ({
  useSchedulerData: () => mockSchedulerDataOverride || buildDefaultSchedulerData(),
}));

// Must import after mocks
import NewSchedulerView from './NewSchedulerView';

beforeEach(() => {
  vi.clearAllMocks();
  mockStaticDataOverride = null;
  mockSchedulerDataOverride = null;
  // Default Api behavior — individual tests override (e.g. reject for sad paths).
  mockApi.mappings.listServiceEmployee.mockResolvedValue([
    { service_id: 'svc-1', employee_id: 'emp-1' }, // Mike → Oil Change
    { service_id: 'svc-2', employee_id: 'emp-1' }, // Mike → Tire Rotation
    { service_id: 'svc-2', employee_id: 'emp-2' }, // Carlos → Tire Rotation
    { service_id: 'svc-1', employee_id: 'emp-2' }, // Carlos → Oil Change
  ]);
  // Composite-PK shape after pilot #3 (2026-05-18) — the response row
  // returns (tenant_id, employee_id, shift_date) instead of a surrogate.
  mockApi.shifts.schedule.save.mockResolvedValue({
    override: { tenant_id: 't1', employee_id: 'emp-1', shift_date: '2026-05-22' },
  });
});

describe('NewSchedulerView', () => {
  describe('Layout structure', () => {
    test('renders the main container', () => {
      render(<NewSchedulerView />);
      expect(screen.getByTestId('new-scheduler-view')).toBeInTheDocument();
    });

    test('renders the SCHEDULE title with font-display', () => {
      render(<NewSchedulerView />);
      const title = screen.getByText('Schedule');
      expect(title).toBeInTheDocument();
      expect(title.className).toContain('font-display');
    });

    test('renders the staff names panel', () => {
      render(<NewSchedulerView />);
      expect(screen.getByTestId('staff-names-panel')).toBeInTheDocument();
    });

    test('renders the hour header', () => {
      render(<NewSchedulerView />);
      expect(screen.getByTestId('hour-header')).toBeInTheDocument();
    });

    test('renders the scheduler grid', () => {
      render(<NewSchedulerView />);
      expect(screen.getByTestId('scheduler-grid')).toBeInTheDocument();
    });
  });

  describe('Staff names', () => {
    test('renders employee names (filters out user accounts)', () => {
      render(<NewSchedulerView />);
      expect(screen.getByTestId('staff-name-emp-1')).toBeInTheDocument();
      expect(screen.getByTestId('staff-name-emp-2')).toBeInTheDocument();
      expect(screen.getByText('Mike Jones')).toBeInTheDocument();
      expect(screen.getByText('Carlos Rivera')).toBeInTheDocument();
      // user account should be filtered out
      expect(screen.queryByText('Admin User')).not.toBeInTheDocument();
    });

    test('staff name click opens profile card', () => {
      render(<NewSchedulerView />);
      fireEvent.click(screen.getByTestId('staff-name-emp-1'));
      expect(screen.getByTestId('staff-profile-card')).toBeInTheDocument();
    });

    test('renders unassigned row when there are unassigned appointments', () => {
      render(<NewSchedulerView />);
      expect(screen.getByTestId('staff-name-unassigned')).toBeInTheDocument();
      expect(screen.getByText('Unassigned')).toBeInTheDocument();
    });
  });

  describe('24-hour day', () => {
    test('renders all 24 hour cells in the header', () => {
      render(<NewSchedulerView />);
      // Spot-check a few hour cells
      expect(screen.getByTestId('hour-cell-0')).toBeInTheDocument();
      expect(screen.getByTestId('hour-cell-12')).toBeInTheDocument();
      expect(screen.getByTestId('hour-cell-23')).toBeInTheDocument();
    });

    test('renders hour labels correctly', () => {
      render(<NewSchedulerView />);
      expect(screen.getByTestId('hour-cell-0')).toHaveTextContent('12am');
      expect(screen.getByTestId('hour-cell-8')).toHaveTextContent('8am');
      expect(screen.getByTestId('hour-cell-12')).toHaveTextContent('12pm');
      expect(screen.getByTestId('hour-cell-17')).toHaveTextContent('5pm');
      expect(screen.getByTestId('hour-cell-23')).toHaveTextContent('11pm');
    });
  });

  describe('Business hours shading', () => {
    // 2026-05-13: opacities bumped from 0.2/0.15 → 0.45/0.35 after the user
    // reported "can't see business hours very easily." The original values
    // were near-invisible on dark themes (rgba(0,0,0,0.15) on a near-black
    // surface). These tests pin the new, higher-contrast values so a future
    // regression to the old subtle values fails fast.
    test('hours outside business hours (8-17) have dark background', () => {
      render(<NewSchedulerView />);
      const earlyHour = screen.getByTestId('hour-cell-6');
      expect(earlyHour.style.background).toContain('rgba(0');
      expect(earlyHour.style.background).toContain('0.45)');

      const lateHour = screen.getByTestId('hour-cell-20');
      expect(lateHour.style.background).toContain('rgba(0');
      expect(lateHour.style.background).toContain('0.45)');
    });

    test('hours inside business hours have transparent background', () => {
      render(<NewSchedulerView />);
      const businessHour = screen.getByTestId('hour-cell-10');
      expect(businessHour.style.background).toBe('transparent');
    });

    test('slot cells also have business hours shading', () => {
      render(<NewSchedulerView />);
      const earlySlot = screen.getByTestId('slot-emp-1-5');
      expect(earlySlot.style.background).toContain('rgba(0');
      expect(earlySlot.style.background).toContain('0.35)');

      const businessSlot = screen.getByTestId('slot-emp-1-10');
      expect(businessSlot.style.background).toBe('transparent');
    });

    test('open/close boundary hours show an accent left-border in the header', () => {
      // WHY: pre-fix the only visual cue for the boundary was the shading
      // color change, which is subtle even at the bumped opacity. The
      // accent border gives a crisp at-a-glance edge between closed and
      // open hours. Pin the border-left so the boundary remains visible
      // through any future style sweep.
      render(<NewSchedulerView />);
      const openBoundary = screen.getByTestId('hour-cell-8'); // 8am, first open hour
      expect(openBoundary.style.borderLeft).toMatch(/2px solid/);

      const closeBoundary = screen.getByTestId('hour-cell-17'); // 5pm, first closed hour
      expect(closeBoundary.style.borderLeft).toMatch(/2px solid/);
    });
  });

  describe('Zoom controls', () => {
    test('renders zoom in/out buttons and percentage label', () => {
      render(<NewSchedulerView />);
      expect(screen.getByTestId('zoom-out')).toBeInTheDocument();
      expect(screen.getByTestId('zoom-in')).toBeInTheDocument();
      expect(screen.getByTestId('zoom-label')).toHaveTextContent('100%');
    });

    test('zoom in increases column width and updates percentage', () => {
      render(<NewSchedulerView />);
      const zoomIn = screen.getByTestId('zoom-in');
      fireEvent.click(zoomIn);
      // 72 + 16 = 88, 88/72*100 = 122%
      expect(screen.getByTestId('zoom-label')).toHaveTextContent('122%');
    });

    test('zoom out decreases column width and updates percentage', () => {
      render(<NewSchedulerView />);
      const zoomOut = screen.getByTestId('zoom-out');
      fireEvent.click(zoomOut);
      // 72 - 16 = 56, 56/72*100 = 78%
      expect(screen.getByTestId('zoom-label')).toHaveTextContent('78%');
    });

    test('zoom out is disabled at minimum', () => {
      render(<NewSchedulerView />);
      const zoomOut = screen.getByTestId('zoom-out');
      // Click enough times to reach minimum (72 -> 56 -> 40 -> 36 limit, but 40-16=24 < 36 so stops at 40)
      fireEvent.click(zoomOut); // 56
      fireEvent.click(zoomOut); // 40
      fireEvent.click(zoomOut); // 36 (min)
      expect(zoomOut).toBeDisabled();
    });

    test('zoom in is disabled at maximum', () => {
      render(<NewSchedulerView />);
      const zoomIn = screen.getByTestId('zoom-in');
      // Click enough times to reach maximum (72 -> 88 -> 104 -> 120 -> 136 -> 140 limit)
      fireEvent.click(zoomIn); // 88
      fireEvent.click(zoomIn); // 104
      fireEvent.click(zoomIn); // 120
      fireEvent.click(zoomIn); // 136
      fireEvent.click(zoomIn); // would be 152, clamped to 140
      expect(zoomIn).toBeDisabled();
    });
  });

  describe('Shift bars in Hours mode', () => {
    test('renders shift bars for employees with shifts', () => {
      render(<NewSchedulerView />);
      // emp-1 has a shift, so shift-bar should render inside their row
      const row1 = screen.getByTestId('scheduler-row-emp-1');
      expect(row1.querySelector('[data-testid="shift-bar-0"]')).toBeInTheDocument();
    });

    test('shift bars use a light-blue fill so the time label stays readable', () => {
      // Lightened from the solid mid-blue accent (Dale, 2026-07-01) so the
      // scheduled hours read clearly over the dark timeline.
      render(<NewSchedulerView />);
      const row1 = screen.getByTestId('scheduler-row-emp-1');
      const bar = row1.querySelector('[data-testid="shift-bar-0"]') as HTMLElement;
      expect(bar.style.background).toBe('rgb(147, 197, 253)'); // #93c5fd (blue-300)
    });

    test('shift bars are hidden in Skills mode', () => {
      render(<NewSchedulerView />);
      const row1 = screen.getByTestId('scheduler-row-emp-1');
      expect(row1.querySelector('[data-testid="shift-bar-0"]')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('view-mode-skills'));
      expect(row1.querySelector('[data-testid="shift-bar-0"]')).not.toBeInTheDocument();
    });
  });

  describe('Appointment blocks', () => {
    test('renders appointment blocks for assigned employees', () => {
      render(<NewSchedulerView />);
      expect(screen.getByTestId('appt-block-appt-1')).toBeInTheDocument();
      expect(screen.getByTestId('appt-block-appt-2')).toBeInTheDocument();
    });

    test('shows customer name on appointment block', () => {
      render(<NewSchedulerView />);
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
      expect(screen.getByText('Bob Johnson')).toBeInTheDocument();
    });

    test('appointment blocks are in the correct staff row', () => {
      render(<NewSchedulerView />);
      const row1 = screen.getByTestId('scheduler-row-emp-1');
      const row2 = screen.getByTestId('scheduler-row-emp-2');

      // Alice's appointment should be in Mike's row
      expect(row1.querySelector('[data-testid="appt-block-appt-1"]')).toBeInTheDocument();
      // Bob's appointment should be in Carlos's row
      expect(row2.querySelector('[data-testid="appt-block-appt-2"]')).toBeInTheDocument();
    });

    test('scheduled appointments use accent color (blue)', () => {
      render(<NewSchedulerView />);
      const block = screen.getByTestId('appt-block-appt-1');
      // scheduled status = accent color
      expect(block.style.background).toContain('var(--accent');
    });

    test('completed appointments use green color', () => {
      render(<NewSchedulerView />);
      const block = screen.getByTestId('appt-block-appt-2');
      expect(block.style.background).toContain('var(--green');
    });

    test('unassigned appointments render in the unassigned row', () => {
      render(<NewSchedulerView />);
      const unassignedRow = screen.getByTestId('scheduler-row-unassigned');
      expect(unassignedRow.querySelector('[data-testid="appt-block-appt-3"]')).toBeInTheDocument();
    });

    test('appointment block has title with customer name and service', () => {
      render(<NewSchedulerView />);
      const block = screen.getByTestId('appt-block-appt-1');
      expect(block.getAttribute('title')).toContain('Alice Smith');
      expect(block.getAttribute('title')).toContain('Oil Change');
    });
  });

  describe('Date navigation', () => {
    test('renders the date navigation component', () => {
      render(<NewSchedulerView />);
      expect(screen.getByTestId('scheduler-date-nav')).toBeInTheDocument();
    });
  });

  describe('Refresh', () => {
    test('renders refresh button', () => {
      render(<NewSchedulerView />);
      expect(screen.getByTestId('scheduler-refresh')).toBeInTheDocument();
    });

    test('clicking refresh calls both refresh functions', () => {
      render(<NewSchedulerView />);
      fireEvent.click(screen.getByTestId('scheduler-refresh'));
      expect(mockRefreshScheduler).toHaveBeenCalled();
      expect(mockRefreshStaticData).toHaveBeenCalled();
    });
  });

  describe('Quick Book trigger', () => {
    test('does NOT render the Quick Book button when onQuickBook is omitted', () => {
      // WHO: NewSchedulerView used standalone (no parent passing the callback)
      // WHAT: The Quick Book trigger should be hidden — the component must
      //       remain reusable without forcing a booking dependency.
      // WHEN: Test added 2026-05-07 with the Quick Book hoist (audit P0 #1)
      // WHERE: dashboard/components/scheduler/NewSchedulerView.tsx onQuickBook prop
      // WHY: Optional prop contract — only renders the button when wired.
      render(<NewSchedulerView />);
      expect(screen.queryByTestId('quick-book-trigger')).not.toBeInTheDocument();
    });

    test('renders the Quick Book button when onQuickBook is provided', () => {
      // WHO: SchedulerView passing handleNewQuickBook through to the staff sub-tab
      // WHAT: The button must surface in the toolbar so front-desk operators
      //       can book a call-in without switching sub-tabs.
      // WHEN: Audit P0 #1 — "hoist Quick Book to the Schedule tab toolbar"
      // WHERE: docs/sessions/2026-05-07-front-desk-audit.md punch list
      // WHY: Pre-2026-05-07 the button only existed on Resources/List sub-tabs,
      //      forcing front-desk to switch tabs before booking. Test pins the
      //      contract so a future refactor can't silently drop the button.
      const onQuickBook = vi.fn();
      render(<NewSchedulerView onQuickBook={onQuickBook} />);
      expect(screen.getByTestId('quick-book-trigger')).toBeInTheDocument();
    });

    test('clicking the Quick Book button invokes the callback', () => {
      // WHO: Front-desk operator with phone in hand
      // WHAT: Click → callback fires → parent SchedulerView opens the panel
      // WHEN: Daily call flow, the most-frequent front-desk task
      // WHERE: NewSchedulerView toolbar
      // WHY: Affordance without function is worse than no affordance —
      //      pin the click → handler wiring.
      const onQuickBook = vi.fn();
      render(<NewSchedulerView onQuickBook={onQuickBook} />);
      fireEvent.click(screen.getByTestId('quick-book-trigger'));
      expect(onQuickBook).toHaveBeenCalledTimes(1);
    });

    test('toolbar button click invokes onQuickBook with NO arguments', () => {
      // WHO: SchedulerView's parent merging selectedDate at the call site
      // WHAT: Toolbar button must NOT pass a synthetic MouseEvent through —
      //       parent's prefill handler reads { employeeId, hour, date }
      //       fields, and a leaked MouseEvent would land in date and break
      //       Date construction.
      // WHEN: Audit P1 #4 widened the prop signature; pin no-arg behavior.
      // WHERE: NewSchedulerView toolbar
      // WHY: Catch a future refactor that drops the `() => onQuickBook?.()`
      //      wrapper and exposes the raw onClick.
      const onQuickBook = vi.fn();
      render(<NewSchedulerView onQuickBook={onQuickBook} />);
      fireEvent.click(screen.getByTestId('quick-book-trigger'));
      expect(onQuickBook).toHaveBeenCalledWith();
    });
  });

  // --- Front-desk audit P1 #4: Empty-cell click → Quick Book prefilled ---
  describe('Empty-slot click → Quick Book prefill (audit P1 #4)', () => {
    test('clicking an empty hour cell on a staff row invokes onQuickBook with employeeId + hour + date', () => {
      const onQuickBook = vi.fn();
      render(<NewSchedulerView onQuickBook={onQuickBook} />);
      fireEvent.click(screen.getByTestId('slot-emp-1-10'));

      expect(onQuickBook).toHaveBeenCalledTimes(1);
      const call = onQuickBook.mock.calls[0][0];
      expect(call).toMatchObject({ employeeId: 'emp-1', hour: 10 });
      expect(call.date).toBeInstanceOf(Date);
      // WHO: front-desk operator who already knows "Mike at 10am" | WHAT: single click on the empty cell delivers all three prefill fields | WHEN: the operator's most-frequent booking pattern (staff-then-time, not customer-first) | WHERE: NewSchedulerView slot-click handler | WHY: this is the audit P1 #4 done-signal exactly — "clicking an empty 10am slot for Mike opens Quick Book with employeeId=Mike + hour=10 prefilled"; pinning the contract guards against a future refactor that drops one of the three fields and silently degrades the workflow
    });

    test('slot cells are NOT clickable (no role/cursor) when onQuickBook is omitted', () => {
      render(<NewSchedulerView />);
      const slot = screen.getByTestId('slot-emp-1-10');
      expect(slot).not.toHaveAttribute('role');
      expect(slot).not.toHaveAttribute('aria-label');
      expect(slot.className).not.toContain('cursor-pointer');
      // WHO: any standalone consumer of NewSchedulerView | WHAT: slot cells stay passive when no booking handler is wired | WHEN: a future surface uses NewSchedulerView in a read-only context (e.g. embedded in a printable schedule view) | WHERE: slot-click conditional render | WHY: a clickable cell with no handler is a broken affordance — the cursor change implies action, the action does nothing; gating role/cursor on the prop keeps the read-only mode honest
    });

    test('slot cells expose role=button + aria-label when onQuickBook is wired', () => {
      render(<NewSchedulerView onQuickBook={vi.fn()} />);
      const slot = screen.getByTestId('slot-emp-1-10');
      expect(slot).toHaveAttribute('role', 'button');
      expect(slot).toHaveAttribute('aria-label', expect.stringContaining('Mike Jones'));
      expect(slot.getAttribute('aria-label')).toMatch(/10am/i);
      expect(slot).toHaveAttribute('tabIndex', '0');
      // WHO: keyboard + screen-reader users | WHAT: slot cells announce "Book Mike Jones at 10am" with proper button semantics | WHEN: assistive tech navigates the grid | WHERE: NewSchedulerView slot a11y attributes | WHY: a sighted user sees the cursor change and figures it out; a keyboard user without role/aria-label/tabIndex literally cannot reach or understand the affordance — adding all three closes a WCAG 2.1 keyboard-accessibility gap that would otherwise ship blind
    });

    test('keyboard Enter on a slot cell fires onQuickBook with the same prefill', () => {
      const onQuickBook = vi.fn();
      render(<NewSchedulerView onQuickBook={onQuickBook} />);
      const slot = screen.getByTestId('slot-emp-2-14');
      fireEvent.keyDown(slot, { key: 'Enter' });

      expect(onQuickBook).toHaveBeenCalledTimes(1);
      expect(onQuickBook.mock.calls[0][0]).toMatchObject({ employeeId: 'emp-2', hour: 14 });
      // WHO: keyboard user (a11y, power user, screen-reader) | WHAT: Enter activates the slot exactly like a click | WHEN: navigating the grid via Tab + Enter | WHERE: NewSchedulerView slot keyDown handler | WHY: role=button without keyboard activation is a partial fix — the screen reader announces the affordance but pressing Enter does nothing; pin both Enter and Space (next test) so the keyboard path is fully equivalent to mouse
    });

    test('keyboard Space on a slot cell also fires onQuickBook (and prevents page scroll)', () => {
      const onQuickBook = vi.fn();
      render(<NewSchedulerView onQuickBook={onQuickBook} />);
      const slot = screen.getByTestId('slot-emp-1-10');
      const event = { key: ' ' };
      fireEvent.keyDown(slot, event);

      expect(onQuickBook).toHaveBeenCalledTimes(1);
      // WHO: keyboard user | WHAT: Space activates the slot | WHEN: WCAG-standard activation key for role=button elements | WHERE: NewSchedulerView slot keyDown handler | WHY: native <button> gets Space activation for free; we lose that by using <div role=button>, so we must wire Space explicitly; the handler also calls preventDefault to stop Space from scrolling the page beneath the panel that's about to open
    });

    test('non-activation keys (Tab, ArrowRight, etc.) do NOT fire onQuickBook', () => {
      const onQuickBook = vi.fn();
      render(<NewSchedulerView onQuickBook={onQuickBook} />);
      const slot = screen.getByTestId('slot-emp-1-10');
      fireEvent.keyDown(slot, { key: 'Tab' });
      fireEvent.keyDown(slot, { key: 'ArrowRight' });
      fireEvent.keyDown(slot, { key: 'a' });
      expect(onQuickBook).not.toHaveBeenCalled();
      // WHO: keyboard user navigating between cells | WHAT: only Enter and Space activate the slot — Tab moves focus, arrow keys browse, regular typing is ignored | WHEN: any keyboard-driven navigation pattern | WHERE: NewSchedulerView slot keyDown handler | WHY: a too-eager activation would intercept arrow-key navigation between adjacent slots and break the natural keyboard flow; pin the negative space so the handler stays narrowly scoped
    });

    test('slot click in skills mode is a no-op (cells stay passive)', () => {
      const onQuickBook = vi.fn();
      render(<NewSchedulerView onQuickBook={onQuickBook} />);
      // Switch to skills mode.
      fireEvent.click(screen.getByTestId('view-mode-skills'));

      const slot = screen.getByTestId('slot-emp-1-10');
      expect(slot).not.toHaveAttribute('role');
      fireEvent.click(slot);
      expect(onQuickBook).not.toHaveBeenCalled();
      // WHO: operator viewing the skill matrix instead of the hour grid | WHAT: cells become passive — clicking a skill bar position is meaningless for booking | WHEN: viewMode === 'skills' | WHERE: NewSchedulerView slot conditional gate | WHY: in skills mode the row's content is "what skills this employee covers across the day," not "is this hour booked"; surfacing a Book affordance there would let the operator click on what looks like a skill-color band and unintentionally open Quick Book — a UX trap
    });

    test("cells outside the row employee's shift are NOT clickable (per-employee gate)", () => {
      const onQuickBook = vi.fn();
      render(<NewSchedulerView onQuickBook={onQuickBook} />);
      // Mike (emp-1) works 8-16 in the fixture. Hour 6 is before his shift.
      const slot = screen.getByTestId('slot-emp-1-6');
      expect(slot).not.toHaveAttribute('role');
      expect(slot).not.toHaveAttribute('aria-label');
      expect(slot.className).not.toContain('cursor-pointer');
      fireEvent.click(slot);
      expect(onQuickBook).not.toHaveBeenCalled();
      // WHO: front-desk operator + the booking RPC's contract enforcement | WHAT: cells outside the employee's own shift become passive — not clickable, no role=button, no hover, click is a no-op | WHEN: any cell where this row's employee has no shift covering the hour on the viewed date | WHERE: NewSchedulerView slot click gate (`isEmployeeWorkingAt`) | WHY: original P1 #4 left these clickable with the rationale "operators may book early/late" — but the booking RPC immediately rejects with EMPLOYEE_NOT_SCHEDULED, so the click was an invitation to a guaranteed-failure path. The system's design contract is "book when employee+skill+resource+time align" — the UI must enforce the time half before the operator types in a customer name. Off-schedule one-offs require adding an employee_schedule entry first (Back Office → Shifts), then booking; this is the correct mental model rather than a "let it fail" fallback
    });

    test("cells inside the row employee's shift ARE clickable even on a row where another employee is also working", () => {
      // Carlos (emp-2) works 9-17 in the fixture. Hour 9 is inside his shift.
      const onQuickBook = vi.fn();
      render(<NewSchedulerView onQuickBook={onQuickBook} />);
      fireEvent.click(screen.getByTestId('slot-emp-2-9'));
      expect(onQuickBook).toHaveBeenCalledWith(
        expect.objectContaining({ employeeId: 'emp-2', hour: 9 })
      );
      // WHO: front-desk operator booking with Carlos specifically | WHAT: the gate is per-row, not global — Carlos's 9am cell is clickable because Carlos is on shift, regardless of whether Mike is | WHEN: shifts overlap or staggered; e.g., Mike 8-16, Carlos 9-17 | WHERE: NewSchedulerView per-row shift lookup | WHY: a global "any employee working" gate would falsely show Mike's row as clickable at 16:30 (because Carlos works until 17), even though Mike is gone — booking through that path lands EMPLOYEE_NOT_SCHEDULED on the specific Mike booking; the per-row gate matches the actual booking shape
    });
  });

  describe('Scroll sync', () => {
    test('staff panel and grid container refs are rendered', () => {
      render(<NewSchedulerView />);
      // Verify the elements exist that will be scroll-synced
      expect(screen.getByTestId('staff-names-panel')).toBeInTheDocument();
      expect(screen.getByTestId('scheduler-grid')).toBeInTheDocument();
      expect(screen.getByTestId('hour-header')).toBeInTheDocument();
    });
  });

  describe('CSS variable usage', () => {
    test('title uses font-display class', () => {
      render(<NewSchedulerView />);
      const title = screen.getByText('Schedule');
      expect(title.className).toContain('font-display');
    });

    test('staff names use font-body CSS variable', () => {
      render(<NewSchedulerView />);
      const nameCell = screen.getByTestId('staff-name-emp-1');
      const span = nameCell.querySelector<HTMLElement>('span:last-child');
      expect(span?.style.fontFamily).toContain('var(--font-body');
    });
  });

  // --- Item #4: Staff Quick Profile Card ---
  describe('Staff Quick Profile Card', () => {
    test('clicking staff name opens profile card with employee info', () => {
      render(<NewSchedulerView />);
      fireEvent.click(screen.getByTestId('staff-name-emp-1'));
      const card = screen.getByTestId('staff-profile-card');
      expect(card).toBeInTheDocument();
      expect(screen.getByTestId('staff-card-name')).toHaveTextContent('Mike Jones');
    });

    test('profile card shows avatar with initials', () => {
      render(<NewSchedulerView />);
      fireEvent.click(screen.getByTestId('staff-name-emp-1'));
      expect(screen.getByTestId('staff-avatar')).toHaveTextContent('MJ');
    });

    test('profile card shows today stats', () => {
      render(<NewSchedulerView />);
      fireEvent.click(screen.getByTestId('staff-name-emp-1'));
      const today = screen.getByTestId('staff-card-today');
      expect(today).toHaveTextContent('1 appts');
      expect(today).toHaveTextContent('hr');
    });

    test('profile card shows shift info', () => {
      render(<NewSchedulerView />);
      fireEvent.click(screen.getByTestId('staff-name-emp-1'));
      const shift = screen.getByTestId('staff-card-shift');
      expect(shift).toHaveTextContent('8am');
      expect(shift).toHaveTextContent('4pm');
    });

    test('profile card shows skills list', async () => {
      render(<NewSchedulerView />);
      fireEvent.click(screen.getByTestId('staff-name-emp-1'));
      expect(screen.getByTestId('staff-card-skills-label')).toHaveTextContent('Skills');
      // Skills come from async mappings fetch
      await waitFor(() => {
        const skillsList = screen.getByTestId('staff-card-skills-list');
        expect(skillsList).toBeInTheDocument();
        expect(skillsList.querySelectorAll('li')).toHaveLength(2);
      });
    });

    test('clicking same staff name again closes the card', () => {
      render(<NewSchedulerView />);
      fireEvent.click(screen.getByTestId('staff-name-emp-1'));
      expect(screen.getByTestId('staff-profile-card')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('staff-name-emp-1'));
      expect(screen.queryByTestId('staff-profile-card')).not.toBeInTheDocument();
    });

    test('clicking a different staff name switches the card', () => {
      render(<NewSchedulerView />);
      fireEvent.click(screen.getByTestId('staff-name-emp-1'));
      expect(screen.getByTestId('staff-card-name')).toHaveTextContent('Mike Jones');
      fireEvent.click(screen.getByTestId('staff-name-emp-2'));
      expect(screen.getByTestId('staff-card-name')).toHaveTextContent('Carlos Rivera');
    });

    test('profile card dismisses on outside click', async () => {
      render(<NewSchedulerView />);
      fireEvent.click(screen.getByTestId('staff-name-emp-1'));
      expect(screen.getByTestId('staff-profile-card')).toBeInTheDocument();

      // Wait for the setTimeout(0) in StaffProfileCard before outside listener is registered
      await new Promise((r) => setTimeout(r, 10));

      // Click outside the card
      fireEvent.mouseDown(document.body);
      expect(screen.queryByTestId('staff-profile-card')).not.toBeInTheDocument();
    });
  });

  // --- Front-desk audit P0 #2: Mark off today ---
  describe('Mark off today (front-desk audit P0 #2)', () => {
    function todayLocalISODate(): string {
      const now = new Date();
      const tzMs = now.getTimezoneOffset() * 60000;
      return new Date(now.getTime() - tzMs).toISOString().slice(0, 10);
    }

    test('Mark off button visible when staff card opens for an employee with a shift today', () => {
      render(<NewSchedulerView />);
      fireEvent.click(screen.getByTestId('staff-name-emp-1'));
      const btn = screen.getByTestId('staff-card-mark-off');
      expect(btn).toBeInTheDocument();
      expect(btn).toHaveTextContent('Mark off today');
      // WHO: front-desk operator handling a sick-call | WHAT: button surfaces on the staff profile card | WHEN: clicking an employee scheduled today | WHERE: NewSchedulerView → StaffProfileCard wiring | WHY: this is the audit P0 #2 affordance — the front-desk role currently cannot mark someone unavailable; the button must appear where the operator already lands when they identify the problem (clicking the staff name)
    });

    test('Mark off button hidden when employee has no shift today', () => {
      // Override scheduler data so emp-1 has no shifts.
      mockSchedulerDataOverride = {
        ...buildDefaultSchedulerData(),
        shiftsByEmployee: new Map([['emp-2', [mockShifts[1]]]]),
      };
      render(<NewSchedulerView />);
      fireEvent.click(screen.getByTestId('staff-name-emp-1'));
      expect(screen.getByTestId('staff-profile-card')).toBeInTheDocument();
      expect(screen.queryByTestId('staff-card-mark-off')).not.toBeInTheDocument();
      // WHO: front-desk operator | WHAT: button hidden when there's nothing to mark off | WHEN: clicking an employee with no shift on the viewed date | WHERE: NewSchedulerView | WHY: marking-off an unscheduled employee creates a row that has no operational effect — surfacing the button would imply an action that does nothing, violating H1 (visibility of system status)
    });

    test('clicking Mark off opens confirm modal with employee + day in copy', () => {
      render(<NewSchedulerView />);
      fireEvent.click(screen.getByTestId('staff-name-emp-1'));
      fireEvent.click(screen.getByTestId('staff-card-mark-off'));

      // ConfirmModal renders the message + Cancel/Mark off buttons. The
      // title "Mark off today" also matches the card button text, so we
      // assert via the message + button roles instead.
      expect(screen.getByText(/Mark Mike Jones off for today/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Mark off' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
      // WHO: front-desk operator | WHAT: confirm dialog names the employee + the day | WHEN: clicking Mark off, before any DB write | WHERE: NewSchedulerView's ConfirmModal wiring | WHY: H5 (error prevention) — destructive actions need explicit confirmation with the specific subject ("Mike Jones, today") so the operator can catch a wrong-employee click before it hits the DB
    });

    test('confirm fires Api.shifts.schedule.save with the right payload, then toasts + refreshes + closes', async () => {
      render(<NewSchedulerView />);
      fireEvent.click(screen.getByTestId('staff-name-emp-1'));
      fireEvent.click(screen.getByTestId('staff-card-mark-off'));
      fireEvent.click(screen.getByRole('button', { name: 'Mark off' }));

      await waitFor(() => {
        expect(mockApi.shifts.schedule.save).toHaveBeenCalledWith('tenant-1', {
          employee_id: 'emp-1',
          shift_date: todayLocalISODate(),
          is_off: true,
        });
      });

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith(
          expect.stringContaining('Mike Jones marked off for today'),
          'success'
        );
      });
      expect(mockRefreshScheduler).toHaveBeenCalled();
      expect(mockRefreshStaticData).toHaveBeenCalled();
      // The card closes after success.
      expect(screen.queryByTestId('staff-profile-card')).not.toBeInTheDocument();
      // WHO: front-desk operator confirming the action | WHAT: backend called with tenant-scoped is_off=true row, success toast, scheduler refreshed, card dismissed | WHEN: the operator commits the off-day | WHERE: NewSchedulerView handleMarkOffClick | WHY: pins the entire happy-path chain — payload shape (so a backend rename surfaces here), tenant scoping (so a future bug can't cross tenants), refresh (so the operator sees the change reflected without a manual reload), and card dismissal (so the next click doesn't re-trigger the same flow)
    });

    test('save failure surfaces an error toast and leaves the confirm modal open for retry', async () => {
      mockApi.shifts.schedule.save.mockRejectedValueOnce(new Error('network down'));

      render(<NewSchedulerView />);
      fireEvent.click(screen.getByTestId('staff-name-emp-1'));
      fireEvent.click(screen.getByTestId('staff-card-mark-off'));
      fireEvent.click(screen.getByRole('button', { name: 'Mark off' }));

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith(
          expect.stringContaining('Failed to mark off'),
          'error'
        );
      });
      expect(mockRefreshScheduler).not.toHaveBeenCalled();
      // Confirm modal still open so the operator can retry without re-navigating.
      expect(screen.getByRole('button', { name: 'Mark off' })).toBeInTheDocument();
      // WHO: front-desk operator on a flaky network | WHAT: error surfaces clearly, no false success state, modal stays open for retry | WHEN: backend or network rejects the save | WHERE: NewSchedulerView handleMarkOffClick catch branch | WHY: a silent failure here would leave the operator believing the employee was off-the-board when the AI is still booking them — the failure mode the audit explicitly cites as the operational risk; the modal staying open lets the operator retry without losing context
    });

    test('Cancel in confirm modal dismisses without calling the API', () => {
      render(<NewSchedulerView />);
      fireEvent.click(screen.getByTestId('staff-name-emp-1'));
      fireEvent.click(screen.getByTestId('staff-card-mark-off'));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(mockApi.shifts.schedule.save).not.toHaveBeenCalled();
      expect(mockRefreshScheduler).not.toHaveBeenCalled();
      // Card remains open so the operator can read it again or click another action.
      expect(screen.getByTestId('staff-profile-card')).toBeInTheDocument();
      // WHO: front-desk operator who realized they clicked the wrong employee | WHAT: cancel exits cleanly with no side effects | WHEN: in the confirm step, before commit | WHERE: NewSchedulerView ConfirmModal onClose | WHY: confirms the bail-out path — H3 (user control and freedom) requires a clearly-marked exit from any commitment dialog, with zero side effects when taken
    });
  });

  // --- Item #5: Skills View Toggle ---
  describe('Skills View Toggle', () => {
    test('renders Hours/Skills toggle buttons', () => {
      render(<NewSchedulerView />);
      expect(screen.getByTestId('view-mode-toggle')).toBeInTheDocument();
      expect(screen.getByTestId('view-mode-hours')).toBeInTheDocument();
      expect(screen.getByTestId('view-mode-skills')).toBeInTheDocument();
    });

    test('Hours mode is active by default', () => {
      render(<NewSchedulerView />);
      const hoursBtn = screen.getByTestId('view-mode-hours');
      expect(hoursBtn.style.background).toContain('var(--accent');
    });

    test('clicking Skills switches to skills mode', () => {
      render(<NewSchedulerView />);
      fireEvent.click(screen.getByTestId('view-mode-skills'));
      const skillsBtn = screen.getByTestId('view-mode-skills');
      expect(skillsBtn.style.background).toContain('var(--accent');
    });

    test('skills mode shows skill bars for employees with skills', async () => {
      render(<NewSchedulerView />);
      fireEvent.click(screen.getByTestId('view-mode-skills'));
      // Wait for mappings to load (async fetch)
      await waitFor(() => {
        // Mike has 2 service assignments
        expect(screen.getByTestId('skill-bar-emp-1-0')).toBeInTheDocument();
        expect(screen.getByTestId('skill-bar-emp-1-1')).toBeInTheDocument();
        // Carlos has 2 service assignments
        expect(screen.getByTestId('skill-bar-emp-2-0')).toBeInTheDocument();
        expect(screen.getByTestId('skill-bar-emp-2-1')).toBeInTheDocument();
      });
    });

    test('skills mode hides appointment blocks', () => {
      render(<NewSchedulerView />);
      // In hours mode, appointment blocks are visible
      expect(screen.getByTestId('appt-block-appt-1')).toBeInTheDocument();

      // Switch to skills mode
      fireEvent.click(screen.getByTestId('view-mode-skills'));
      expect(screen.queryByTestId('appt-block-appt-1')).not.toBeInTheDocument();
    });

    test('switching back to hours mode shows appointment blocks again', () => {
      render(<NewSchedulerView />);
      fireEvent.click(screen.getByTestId('view-mode-skills'));
      expect(screen.queryByTestId('appt-block-appt-1')).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId('view-mode-hours'));
      expect(screen.getByTestId('appt-block-appt-1')).toBeInTheDocument();
    });

    test('skills mode hides unassigned row', () => {
      render(<NewSchedulerView />);
      expect(screen.getByTestId('scheduler-row-unassigned')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('view-mode-skills'));
      expect(screen.queryByTestId('scheduler-row-unassigned')).not.toBeInTheDocument();
    });
  });

  // --- Item #6: Drag to Reorder Staff Rows ---
  describe('Drag to Reorder Staff Rows', () => {
    test('each staff row has a drag handle', () => {
      render(<NewSchedulerView />);
      expect(screen.getByTestId('drag-handle-emp-1')).toBeInTheDocument();
      expect(screen.getByTestId('drag-handle-emp-2')).toBeInTheDocument();
    });

    test('staff name cells are draggable', () => {
      render(<NewSchedulerView />);
      const nameCell = screen.getByTestId('staff-name-emp-1');
      expect(nameCell.getAttribute('draggable')).toBe('true');
    });

    test('save/discard buttons do not appear initially', () => {
      render(<NewSchedulerView />);
      expect(screen.queryByTestId('reorder-controls')).not.toBeInTheDocument();
    });

    test('dragging triggers reorder and shows save/discard', () => {
      render(<NewSchedulerView />);
      const firstRow = screen.getByTestId('staff-name-emp-1');
      const secondRow = screen.getByTestId('staff-name-emp-2');

      // Simulate drag sequence
      fireEvent.dragStart(firstRow);
      fireEvent.dragOver(secondRow);
      fireEvent.dragEnd(firstRow);

      // Save/discard should appear
      expect(screen.getByTestId('reorder-controls')).toBeInTheDocument();
      expect(screen.getByTestId('save-order')).toBeInTheDocument();
      expect(screen.getByTestId('discard-order')).toBeInTheDocument();
    });

    test('discard button reverts order and hides controls', () => {
      render(<NewSchedulerView />);
      const firstRow = screen.getByTestId('staff-name-emp-1');
      const secondRow = screen.getByTestId('staff-name-emp-2');

      // Trigger a reorder
      fireEvent.dragStart(firstRow);
      fireEvent.dragOver(secondRow);
      fireEvent.dragEnd(firstRow);

      expect(screen.getByTestId('reorder-controls')).toBeInTheDocument();

      // Click discard
      fireEvent.click(screen.getByTestId('discard-order'));
      expect(screen.queryByTestId('reorder-controls')).not.toBeInTheDocument();
    });

    test('save button persists order and hides controls', () => {
      render(<NewSchedulerView />);
      const firstRow = screen.getByTestId('staff-name-emp-1');
      const secondRow = screen.getByTestId('staff-name-emp-2');

      // Trigger a reorder
      fireEvent.dragStart(firstRow);
      fireEvent.dragOver(secondRow);
      fireEvent.dragEnd(firstRow);

      expect(screen.getByTestId('reorder-controls')).toBeInTheDocument();

      // Click save
      fireEvent.click(screen.getByTestId('save-order'));
      expect(screen.queryByTestId('reorder-controls')).not.toBeInTheDocument();
    });

    test('save persists order to localStorage', () => {
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
      render(<NewSchedulerView />);
      const firstRow = screen.getByTestId('staff-name-emp-1');
      const secondRow = screen.getByTestId('staff-name-emp-2');

      fireEvent.dragStart(firstRow);
      fireEvent.dragOver(secondRow);
      fireEvent.dragEnd(firstRow);
      fireEvent.click(screen.getByTestId('save-order'));

      expect(setItemSpy).toHaveBeenCalledWith('scheduler-staff-order-tenant-1', expect.any(String));
      setItemSpy.mockRestore();
    });

    test('discard does not persist to localStorage', () => {
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
      render(<NewSchedulerView />);
      const firstRow = screen.getByTestId('staff-name-emp-1');
      const secondRow = screen.getByTestId('staff-name-emp-2');

      fireEvent.dragStart(firstRow);
      fireEvent.dragOver(secondRow);
      fireEvent.dragEnd(firstRow);
      fireEvent.click(screen.getByTestId('discard-order'));

      expect(setItemSpy).not.toHaveBeenCalled();
      setItemSpy.mockRestore();
    });

    test('drag handle has grip dots icon', () => {
      render(<NewSchedulerView />);
      const handle = screen.getByTestId('drag-handle-emp-1');
      const svg = handle.querySelector('svg');
      expect(svg).toBeInTheDocument();
      // Grip dots has 6 circles
      const circles = svg?.querySelectorAll('circle');
      expect(circles?.length).toBe(6);
    });
  });

  // --- Sad path tests ---
  describe('Sad paths', () => {
    describe('Empty employees list', () => {
      test('renders without crashing when there are no employees', () => {
        mockStaticDataOverride = {
          employees: [],
          services: mockServices,
          customers: [],
          resources: [],
          skills: [],
          refresh: mockRefreshStaticData,
          loading: false,
          error: null,
        };
        mockSchedulerDataOverride = {
          appointments: [],
          shifts: [],
          loading: false,
          appointmentsByEmployee: new Map(),
          appointmentsByResource: new Map(),
          shiftsByEmployee: new Map(),
          error: null,
          refresh: mockRefreshScheduler,
        };

        render(<NewSchedulerView />);
        expect(screen.getByTestId('new-scheduler-view')).toBeInTheDocument();
        // Shows empty state instead of grid
        expect(screen.getByTestId('scheduler-empty')).toBeInTheDocument();
        expect(screen.getByText('No staff to display')).toBeInTheDocument();
        // No staff rows rendered
        expect(screen.queryByTestId('staff-name-emp-1')).not.toBeInTheDocument();
        expect(screen.queryByTestId('staff-name-emp-2')).not.toBeInTheDocument();
      });
    });

    describe('Empty appointments list', () => {
      test('renders normally with no appointments displayed', () => {
        mockSchedulerDataOverride = {
          appointments: [],
          shifts: mockShifts,
          loading: false,
          error: null,
          appointmentsByEmployee: new Map(),
          appointmentsByResource: new Map(),
          shiftsByEmployee: buildShiftsByEmployee(),
          refresh: mockRefreshScheduler,
        };

        render(<NewSchedulerView />);
        expect(screen.getByTestId('new-scheduler-view')).toBeInTheDocument();
        // Staff rows still render
        expect(screen.getByTestId('staff-name-emp-1')).toBeInTheDocument();
        expect(screen.getByTestId('staff-name-emp-2')).toBeInTheDocument();
        // No appointment blocks
        expect(screen.queryByTestId('appt-block-appt-1')).not.toBeInTheDocument();
        expect(screen.queryByTestId('appt-block-appt-2')).not.toBeInTheDocument();
        // No unassigned row (no unassigned appointments)
        expect(screen.queryByTestId('staff-name-unassigned')).not.toBeInTheDocument();
      });
    });

    describe('Employee with no shifts', () => {
      test('employee still appears in the scheduler even without shifts', () => {
        mockSchedulerDataOverride = {
          appointments: mockAppointments,
          shifts: [],
          loading: false,
          appointmentsByEmployee: buildApptMap(),
          appointmentsByResource: new Map(),
          shiftsByEmployee: new Map(), // no shifts for any employee
          error: null,
          refresh: mockRefreshScheduler,
        };

        render(<NewSchedulerView />);
        // Both employees still appear
        expect(screen.getByTestId('staff-name-emp-1')).toBeInTheDocument();
        expect(screen.getByTestId('staff-name-emp-2')).toBeInTheDocument();
        expect(screen.getByTestId('scheduler-row-emp-1')).toBeInTheDocument();
        expect(screen.getByTestId('scheduler-row-emp-2')).toBeInTheDocument();
        // No shift bars rendered
        const row1 = screen.getByTestId('scheduler-row-emp-1');
        expect(row1.querySelector('[data-testid="shift-bar-0"]')).not.toBeInTheDocument();
      });
    });

    describe('Appointment with invalid times', () => {
      test('does not crash when appointment has empty string start_time or end_time', () => {
        const badAppointments = [
          {
            appointment_id: 'appt-bad-1',
            tenant_id: 't1',
            resource_id: 'res-1',
            customer_id: 'cust-1',
            employee_id: 'emp-1',
            start_time: '', // empty string
            end_time: '',
            description: 'Broken Appointment',
            status: 'scheduled',
            customers: { name: 'Bad Data', phone: '' },
            resources: { name: 'Bay 1' },
          },
        ];

        const badApptMap = new Map();
        badApptMap.set('emp-1', badAppointments);

        mockSchedulerDataOverride = {
          appointments: badAppointments,
          shifts: mockShifts,
          loading: false,
          error: null,
          appointmentsByEmployee: badApptMap,
          appointmentsByResource: new Map(),
          shiftsByEmployee: buildShiftsByEmployee(),
          refresh: mockRefreshScheduler,
        };

        // Should not throw — empty string passed to new Date() gives Invalid Date,
        // but toFractionalHour returns NaN which results in NaN positioning (renders offscreen, no crash)
        render(<NewSchedulerView />);
        expect(screen.getByTestId('new-scheduler-view')).toBeInTheDocument();
        expect(screen.getByTestId('appt-block-appt-bad-1')).toBeInTheDocument();
      });
    });

    describe('Zoom boundary limits', () => {
      test('zoom does not go below minimum (36px) even with many clicks', () => {
        render(<NewSchedulerView />);
        const zoomOut = screen.getByTestId('zoom-out');
        // Click zoom out 10 times (way past minimum)
        for (let i = 0; i < 10; i++) {
          fireEvent.click(zoomOut);
        }
        // Should be at minimum: 36/72*100 = 50%
        expect(screen.getByTestId('zoom-label')).toHaveTextContent('50%');
        expect(zoomOut).toBeDisabled();
      });

      test('zoom does not go above maximum (140px) even with many clicks', () => {
        render(<NewSchedulerView />);
        const zoomIn = screen.getByTestId('zoom-in');
        // Click zoom in 10 times (way past maximum)
        for (let i = 0; i < 10; i++) {
          fireEvent.click(zoomIn);
        }
        // Should be at maximum: 140/72*100 = 194%
        expect(screen.getByTestId('zoom-label')).toHaveTextContent('194%');
        expect(zoomIn).toBeDisabled();
      });

      test('zoom out then zoom in returns to original value', () => {
        render(<NewSchedulerView />);
        expect(screen.getByTestId('zoom-label')).toHaveTextContent('100%');
        fireEvent.click(screen.getByTestId('zoom-out'));
        expect(screen.getByTestId('zoom-label')).toHaveTextContent('78%');
        fireEvent.click(screen.getByTestId('zoom-in'));
        expect(screen.getByTestId('zoom-label')).toHaveTextContent('100%');
      });
    });

    describe('Loading state', () => {
      test('refresh icon has animate-spin class while loading', () => {
        mockSchedulerDataOverride = {
          appointments: [],
          shifts: [],
          loading: true,
          appointmentsByEmployee: new Map(),
          appointmentsByResource: new Map(),
          shiftsByEmployee: new Map(),
          error: null,
          refresh: mockRefreshScheduler,
        };

        render(<NewSchedulerView />);
        const refreshBtn = screen.getByTestId('scheduler-refresh');
        const svg = refreshBtn.querySelector('svg');
        expect(svg?.classList.contains('animate-spin')).toBe(true);
      });

      test('refresh icon does not have animate-spin when not loading', () => {
        render(<NewSchedulerView />);
        const refreshBtn = screen.getByTestId('scheduler-refresh');
        const svg = refreshBtn.querySelector('svg');
        expect(svg?.classList.contains('animate-spin')).toBe(false);
      });

      test('component still renders structural elements while loading', () => {
        mockSchedulerDataOverride = {
          appointments: [],
          shifts: [],
          loading: true,
          appointmentsByEmployee: new Map(),
          appointmentsByResource: new Map(),
          shiftsByEmployee: new Map(),
          error: null,
          refresh: mockRefreshScheduler,
        };

        render(<NewSchedulerView />);
        expect(screen.getByTestId('new-scheduler-view')).toBeInTheDocument();
        expect(screen.getByTestId('staff-names-panel')).toBeInTheDocument();
        expect(screen.getByTestId('hour-header')).toBeInTheDocument();
        expect(screen.getByTestId('scheduler-grid')).toBeInTheDocument();
        expect(screen.getByText('Schedule')).toBeInTheDocument();
      });
    });
  });
});
