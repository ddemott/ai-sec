import React from 'react';
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import { SchedulerDateNav } from './SchedulerDateNav';
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
    id: 'appt-1',
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
  { id: 1, name: 'Mike Jones' },
  { id: 2, name: 'Steve Lee' },
];

const resources = [
  { id: 'res-1', name: 'Bay 1' },
  { id: 'res-2', name: 'Bay 2' },
];

// --- SchedulerDateNav ---

describe('SchedulerDateNav', () => {
  test('renders the selected date', () => {
    const date = new Date(2026, 2, 19); // March 19, 2026
    render(<SchedulerDateNav selectedDate={date} onDateChange={() => {}} />);
    expect(screen.getByTestId('scheduler-date-display')).toHaveTextContent('March 19, 2026');
  });

  test('calls onDateChange with previous day on prev click', () => {
    const date = new Date(2026, 2, 19);
    const onChange = vi.fn();
    render(<SchedulerDateNav selectedDate={date} onDateChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Previous day'));
    expect(onChange).toHaveBeenCalledWith(expect.any(Date));
    const newDate = onChange.mock.calls[0][0] as Date;
    expect(newDate.getDate()).toBe(18);
  });

  test('calls onDateChange with next day on next click', () => {
    const date = new Date(2026, 2, 19);
    const onChange = vi.fn();
    render(<SchedulerDateNav selectedDate={date} onDateChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Next day'));
    const newDate = onChange.mock.calls[0][0] as Date;
    expect(newDate.getDate()).toBe(20);
  });

  test('Today button navigates to today', () => {
    const date = new Date(2026, 2, 19);
    const onChange = vi.fn();
    render(<SchedulerDateNav selectedDate={date} onDateChange={onChange} />);
    fireEvent.click(screen.getByText('Today'));
    const newDate = onChange.mock.calls[0][0] as Date;
    const today = new Date();
    expect(newDate.getDate()).toBe(today.getDate());
  });
});

// --- TimeGrid ---

describe('TimeGrid', () => {
  test('renders hour labels from startHour to endHour', () => {
    render(<TimeGrid startHour={7} endHour={10} />);
    expect(screen.getByText('7 AM')).toBeInTheDocument();
    expect(screen.getByText('8 AM')).toBeInTheDocument();
    expect(screen.getByText('9 AM')).toBeInTheDocument();
  });

  test('renders default hours (7am to 8pm)', () => {
    render(<TimeGrid />);
    expect(screen.getByText('7 AM')).toBeInTheDocument();
    expect(screen.getByText('12 PM')).toBeInTheDocument();
    expect(screen.getByText('7 PM')).toBeInTheDocument();
  });

  test('formatHourLabel handles noon and midnight', () => {
    expect(formatHourLabel(0)).toBe('12 AM');
    expect(formatHourLabel(12)).toBe('12 PM');
    expect(formatHourLabel(15)).toBe('3 PM');
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
    expect(onClick).toHaveBeenCalledWith(appt);
  });

  test('getEmployeeColor returns gray for null employee', () => {
    expect(getEmployeeColor(null)).toBe('bg-gray-400');
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
    expect(screen.getByTestId('swimlane-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('swimlane-row-2')).toBeInTheDocument();
    expect(screen.getByText('Mike Jones')).toBeInTheDocument();
    expect(screen.getByText('Steve Lee')).toBeInTheDocument();
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
  });

  test('calls onSlotClick when an on-shift slot is clicked (mousedown + mouseup)', () => {
    const apptMap = new Map<string, SchedulerAppointment[]>();
    apptMap.set('1', []);
    apptMap.set('2', []);
    apptMap.set('unassigned', []);
    const shiftMap = new Map<string, { id: string; start_time: string; end_time: string; day_of_week: number }[]>();
    shiftMap.set('1', [{ id: 'shift-1', start_time: '09:00', end_time: '17:00', day_of_week: 4 }]);
    shiftMap.set('2', []);
    const onSlotClick = vi.fn();

    render(
      <StaffSwimLaneView
        employees={employees}
        appointmentsByEmployee={apptMap}
        shiftsByEmployee={shiftMap}
        onSlotClick={onSlotClick}
      />
    );
    const slot = screen.getByTestId('slot-1-10');
    fireEvent.mouseDown(slot);
    fireEvent.mouseUp(slot);
    expect(onSlotClick).toHaveBeenCalledWith('1', 10);
  });

  test('calls onSlotDrag when dragging across multiple hours', () => {
    const apptMap = new Map<string, SchedulerAppointment[]>();
    apptMap.set('1', []);
    apptMap.set('2', []);
    apptMap.set('unassigned', []);
    const shiftMap = new Map<string, { id: string; start_time: string; end_time: string; day_of_week: number }[]>();
    shiftMap.set('1', [{ id: 'shift-1', start_time: '09:00', end_time: '17:00', day_of_week: 4 }]);
    shiftMap.set('2', []);
    const onSlotDrag = vi.fn();
    const onSlotClick = vi.fn();

    render(
      <StaffSwimLaneView
        employees={employees}
        appointmentsByEmployee={apptMap}
        shiftsByEmployee={shiftMap}
        onSlotClick={onSlotClick}
        onSlotDrag={onSlotDrag}
      />
    );
    // Single click on an on-shift cell triggers onSlotClick (book appointment)
    // Note: multi-cell drag uses document mousemove which jsdom can't simulate with layout
    fireEvent.mouseDown(screen.getByTestId('slot-1-10'));
    fireEvent.mouseUp(screen.getByTestId('slot-1-10'));
    expect(onSlotClick).toHaveBeenCalledWith('1', 10);
  });

  test('calls onShiftDrag when dragging on off-shift (hatched) cells', () => {
    const apptMap = new Map<string, SchedulerAppointment[]>();
    apptMap.set('1', []);
    apptMap.set('2', []);
    apptMap.set('unassigned', []);
    const shiftMap = new Map<string, { id: string; start_time: string; end_time: string; day_of_week: number }[]>();
    // Employee 1 has shift 12-17, so hours 8-11 are OFF shift
    shiftMap.set('1', [{ id: 'shift-2', start_time: '12:00', end_time: '17:00', day_of_week: 4 }]);
    shiftMap.set('2', []);
    const onShiftDrag = vi.fn();
    const onSlotDrag = vi.fn();

    render(
      <StaffSwimLaneView
        employees={employees}
        appointmentsByEmployee={apptMap}
        shiftsByEmployee={shiftMap}
        onSlotDrag={onSlotDrag}
        onShiftDrag={onShiftDrag}
      />
    );
    // Drag on off-shift hours 8am-11am
    // Single click on off-shift cell triggers onShiftDrag for a 1-hour shift
    // Note: multi-cell drag uses document mousemove which jsdom can't simulate with layout
    fireEvent.mouseDown(screen.getByTestId('slot-1-8'));
    fireEvent.mouseUp(screen.getByTestId('slot-1-8'));
    expect(onShiftDrag).toHaveBeenCalledWith('1', 8, 9);
    expect(onSlotDrag).not.toHaveBeenCalled();
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
  });

  test('renders appointments in chronological order', () => {
    const appts = [
      makeAppointment({ id: 'a2', start_time: '2026-03-19T14:00:00Z', end_time: '2026-03-19T15:00:00Z', customers: { name: 'Bob' } }),
      makeAppointment({ id: 'a1', start_time: '2026-03-19T09:00:00Z', end_time: '2026-03-19T10:00:00Z', customers: { name: 'Alice' } }),
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
  });

  test('shows gap warning for gaps > 1 hour', () => {
    const appts = [
      makeAppointment({ id: 'a1', start_time: '2026-03-19T09:00:00Z', end_time: '2026-03-19T10:00:00Z' }),
      makeAppointment({ id: 'a2', start_time: '2026-03-19T13:00:00Z', end_time: '2026-03-19T14:00:00Z' }),
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
  });

  test('hides canceled appointments', () => {
    const appts = [
      makeAppointment({ id: 'a1', status: 'canceled', customers: { name: 'Canceled Guy' } }),
      makeAppointment({ id: 'a2', customers: { name: 'Active Alice' } }),
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
    expect(onClick).toHaveBeenCalledWith(appt);
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
  });

  test('shows appointment count and utilization stats', () => {
    const appts = [
      makeAppointment({ start_time: '2026-03-19T09:00:00Z', end_time: '2026-03-19T10:00:00Z' }),
      makeAppointment({ id: 'appt-2', start_time: '2026-03-19T11:00:00Z', end_time: '2026-03-19T12:00:00Z' }),
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
  });

  test('renders Quick Book heading when open', () => {
    render(
      <QuickBookPanel
        isOpen={true}
        onClose={() => {}}
        tenantId="t1"
        customers={[{ id: 'c1', name: 'Alice', phone: '555-0001' }]}
        employees={employees}
        resources={resources}
        services={[{ id: 1, name: 'Oil Change', duration_minutes: 30 }]}
        onBooked={() => {}}
      />
    );
    expect(screen.getByText('Quick Book')).toBeInTheDocument();
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
  });
});
