import React from 'react';
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AppointmentPopover } from './AppointmentPopover';
import type { SchedulerAppointment } from './useSchedulerData';

function makeAppt(overrides: Partial<SchedulerAppointment> = {}): SchedulerAppointment {
  return {
    appointment_id: 'appt-1',
    tenant_id: 't-1',
    resource_id: 'r-1',
    customer_id: 'c-1',
    employee_id: 'e-1',
    start_time: '2026-07-01T14:00:00Z',
    end_time: '2026-07-01T15:00:00Z',
    description: 'Tire Mount',
    status: 'scheduled',
    customers: { id: 'c-1', name: 'Alice', phone: '+15555550001' },
    resources: { id: 'r-1', name: 'Bay 1' },
    ...overrides,
  } as unknown as SchedulerAppointment;
}

const anchorRect = {
  top: 100,
  bottom: 130,
  left: 50,
  right: 200,
  width: 150,
  height: 30,
  x: 50,
  y: 100,
  toJSON: () => ({}),
} as DOMRect;

function renderPopover(props: Partial<React.ComponentProps<typeof AppointmentPopover>> = {}) {
  return render(
    <AppointmentPopover
      appointment={props.appointment ?? makeAppt()}
      employeeName="Mike"
      resourceName="Bay 1"
      anchorRect={anchorRect}
      onClose={vi.fn()}
      {...props}
    />
  );
}

describe('AppointmentPopover — Edit + Cancel actions', () => {
  test('renders neither Edit nor Cancel button when callbacks are omitted', () => {
    renderPopover();
    expect(screen.queryByTestId('appointment-popover-edit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('appointment-popover-cancel')).not.toBeInTheDocument();
    // WHO: any caller before the 2026-05-07 wiring (the popover used to be read-only) | WHAT: backward-compat — no buttons surface unless the parent opts in | WHEN: callers that haven't migrated yet | WHERE: AppointmentPopover conditional render | WHY: pin the optional-prop contract so a future caller adding only one of the callbacks gets exactly the button it wants — and so legacy renders don't suddenly grow new affordances
  });

  test('renders Edit button when onEdit wired; click invokes with appointment id', () => {
    const onEdit = vi.fn();
    renderPopover({ onEdit });
    const btn = screen.getByTestId('appointment-popover-edit');
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent('Edit');
    fireEvent.click(btn);
    expect(onEdit).toHaveBeenCalledWith('appt-1');
    // WHO: front-desk operator who clicked an appointment from Resources / List / Staff sub-tabs | WHAT: Edit button delivers the appointment id to the parent | WHEN: any view where the popover renders | WHERE: AppointmentPopover Edit button click handler | WHY: closes the cross-view edit gap — pre-fix the popover was read-only and the operator had to navigate to the Calendar sub-tab and click the appointment again before being able to edit; now Edit works from any view via the same id-delivery contract
  });

  test('renders Cancel button when onCancel wired; click invokes with appointment id', () => {
    const onCancel = vi.fn();
    renderPopover({ onCancel });
    const btn = screen.getByTestId('appointment-popover-cancel');
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent('Cancel');
    fireEvent.click(btn);
    expect(onCancel).toHaveBeenCalledWith('appt-1');
    // WHO: front-desk operator canceling an appointment from any view | WHAT: Cancel button delivers the appointment id; parent owns the API call (Api.appointments.cancel) + confirm dialog + refresh | WHEN: any view where the popover renders | WHERE: AppointmentPopover Cancel button click handler | WHY: matches the Edit path's id-delivery shape so the parent's handlers stay symmetric; keeps the popover presentational (no API or confirm logic in the popover itself)
  });

  test('hides BOTH Edit and Cancel buttons when the appointment is already canceled', () => {
    const onEdit = vi.fn();
    const onCancel = vi.fn();
    renderPopover({
      appointment: makeAppt({ status: 'canceled' }),
      onEdit,
      onCancel,
    });
    expect(screen.queryByTestId('appointment-popover-edit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('appointment-popover-cancel')).not.toBeInTheDocument();
    // WHO: front-desk operator viewing a canceled appointment for context | WHAT: action buttons disappear — no edit, no second cancel | WHEN: popover opens for a row with status='canceled' | WHERE: AppointmentPopover status guard | WHY: editing or re-canceling a canceled row would either fail at the RPC layer or be a no-op; surfacing the buttons would let the operator click and then see an error toast. The status badge in the header already communicates "Canceled" — the right move is to drop the no-op affordances rather than show + reject
  });

  test('Edit-only wiring renders the Edit button alone (no Cancel)', () => {
    const onEdit = vi.fn();
    renderPopover({ onEdit });
    expect(screen.getByTestId('appointment-popover-edit')).toBeInTheDocument();
    expect(screen.queryByTestId('appointment-popover-cancel')).not.toBeInTheDocument();
    // WHO: a future consumer that wants to allow edits but not cancellations (e.g., a read-mostly admin view) | WHAT: each button's render is gated by its own callback prop | WHEN: caller opts into one button at a time | WHERE: AppointmentPopover individual button conditionals | WHY: a single onActions prop bundling both would force callers to either provide both or write a no-op stub; per-prop gating is more honest about what's available — the consumer's prop choice matches the operator's available actions
  });
});
