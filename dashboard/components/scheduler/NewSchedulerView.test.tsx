import React from 'react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock the hooks and API before importing the component
const mockRefreshStaticData = vi.fn();
const mockRefreshScheduler = vi.fn();

const mockEmployees = [
  { id: 'emp-1', tenant_id: 't1', name: 'Mike Jones', skills: ['Oil Change', 'Tire Rotation'], is_active: true, type: 'employee' as const },
  { id: 'emp-2', tenant_id: 't1', name: 'Carlos Rivera', skills: ['Tire Rotation', 'Balancing'], is_active: true, type: 'employee' as const },
  { id: 'emp-3', tenant_id: 't1', name: 'Admin User', skills: [], is_active: true, type: 'user' as const },
];

const mockServices = [
  { id: 'svc-1', tenant_id: 't1', name: 'Oil Change', duration_minutes: 30 },
  { id: 'svc-2', tenant_id: 't1', name: 'Tire Rotation', duration_minutes: 45 },
];

const mockAppointments = [
  {
    id: 'appt-1',
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
    id: 'appt-2',
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
    id: 'appt-3',
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
  { id: 'shift-1', employee_id: 'emp-1', day_of_week: new Date().getDay(), start_time: '08:00:00', end_time: '16:00:00' },
  { id: 'shift-2', employee_id: 'emp-2', day_of_week: new Date().getDay(), start_time: '09:00:00', end_time: '17:00:00' },
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
    appointmentsByEmployee: buildApptMap(),
    appointmentsByResource: new Map(),
    shiftsByEmployee: buildShiftsByEmployee(),
    refresh: mockRefreshScheduler,
  };
}

vi.mock('../../lib/hooks', () => ({
  useStaticData: () => mockStaticDataOverride || buildDefaultStaticData(),
}));

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
    test('hours outside business hours (8-17) have dark background', () => {
      render(<NewSchedulerView />);
      // Hour 6 is outside business hours (before 8am)
      const earlyHour = screen.getByTestId('hour-cell-6');
      expect(earlyHour.style.background).toContain('rgba(0');
      expect(earlyHour.style.background).toContain('0.28)');

      // Hour 20 is outside business hours (after 5pm)
      const lateHour = screen.getByTestId('hour-cell-20');
      expect(lateHour.style.background).toContain('rgba(0');
      expect(lateHour.style.background).toContain('0.28)');
    });

    test('hours inside business hours have transparent background', () => {
      render(<NewSchedulerView />);
      const businessHour = screen.getByTestId('hour-cell-10');
      expect(businessHour.style.background).toBe('transparent');
    });

    test('slot cells also have business hours shading', () => {
      render(<NewSchedulerView />);
      // A slot outside business hours
      const earlySlot = screen.getByTestId('slot-emp-1-5');
      expect(earlySlot.style.background).toContain('rgba(0');
      expect(earlySlot.style.background).toContain('0.28)');

      // A slot inside business hours
      const businessSlot = screen.getByTestId('slot-emp-1-10');
      expect(businessSlot.style.background).toBe('transparent');
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

    test('shift bars use accent-muted background', () => {
      render(<NewSchedulerView />);
      const row1 = screen.getByTestId('scheduler-row-emp-1');
      const bar = row1.querySelector('[data-testid="shift-bar-0"]') as HTMLElement;
      expect(bar.style.background).toContain('var(--accent-muted');
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
      const span = nameCell.querySelector('span:last-child') as HTMLElement | null;
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

    test('profile card shows skills list', () => {
      render(<NewSchedulerView />);
      fireEvent.click(screen.getByTestId('staff-name-emp-1'));
      expect(screen.getByTestId('staff-card-skills-label')).toHaveTextContent('Skills');
      const skillsList = screen.getByTestId('staff-card-skills-list');
      expect(skillsList).toBeInTheDocument();
      expect(skillsList.querySelectorAll('li')).toHaveLength(2);
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
      await new Promise(r => setTimeout(r, 10));

      // Click outside the card
      fireEvent.mouseDown(document.body);
      expect(screen.queryByTestId('staff-profile-card')).not.toBeInTheDocument();
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

    test('skills mode shows skill bars for employees with skills', () => {
      render(<NewSchedulerView />);
      fireEvent.click(screen.getByTestId('view-mode-skills'));
      // Mike has 2 skills
      expect(screen.getByTestId('skill-bar-emp-1-0')).toBeInTheDocument();
      expect(screen.getByTestId('skill-bar-emp-1-1')).toBeInTheDocument();
      // Carlos has 2 skills
      expect(screen.getByTestId('skill-bar-emp-2-0')).toBeInTheDocument();
      expect(screen.getByTestId('skill-bar-emp-2-1')).toBeInTheDocument();
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

      expect(setItemSpy).toHaveBeenCalledWith(
        'scheduler-staff-order-tenant-1',
        expect.any(String)
      );
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
          refresh: mockRefreshScheduler,
        };

        render(<NewSchedulerView />);
        expect(screen.getByTestId('new-scheduler-view')).toBeInTheDocument();
        expect(screen.getByTestId('scheduler-grid')).toBeInTheDocument();
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
            id: 'appt-bad-1',
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
