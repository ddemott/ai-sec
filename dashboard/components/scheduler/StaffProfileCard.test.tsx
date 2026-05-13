import React from 'react';
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { StaffProfileCard } from './StaffProfileCard';
import type { Employee } from '../../lib/types';

// Minimal fixture — the card only reads name + type from Employee.
const employee: Employee = {
  employee_id: 'emp-1',
  tenant_id: 't1',
  name: 'Carlos Rivera',
  is_active: true,
  type: 'employee',
  skills: [],
};

// JSDOM doesn't expose a constructable DOMRect; spread an object the card's
// positioning math can read. The values are arbitrary — we only assert
// rendering, not pixel placement.
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

function renderCard(props: Partial<React.ComponentProps<typeof StaffProfileCard>> = {}) {
  return render(
    <StaffProfileCard
      employee={employee}
      todayApptCount={2}
      todayHours={3.5}
      shiftStart="8am"
      shiftEnd="4pm"
      skills={['Oil Change']}
      anchorRect={anchorRect}
      onClose={vi.fn()}
      {...props}
    />
  );
}

describe('StaffProfileCard — Mark off action (front-desk audit P0 #2)', () => {
  test('does not render Mark off button when onMarkOff is omitted', () => {
    renderCard();
    expect(screen.queryByTestId('staff-card-mark-off')).not.toBeInTheDocument();
    // WHO: any caller without the new prop | WHAT: card omits Mark off action | WHEN: legacy consumers (no callback wired) | WHERE: StaffProfileCard | WHY: optional prop must not surface UI for callers that haven't opted in — protects existing usages from a sudden new affordance
  });

  test('does not render Mark off button when employee has no shift today', () => {
    renderCard({ shiftStart: null, shiftEnd: null, onMarkOff: vi.fn() });
    expect(screen.queryByTestId('staff-card-mark-off')).not.toBeInTheDocument();
    // WHO: front-desk operator | WHAT: button hidden because employee already has no shift | WHEN: viewing a day where the employee was never scheduled or already marked off | WHERE: StaffProfileCard | WHY: marking-off someone who has no shift is a no-op; surfacing the button would imply an action that does nothing
  });

  test('renders Mark off button with default label when shift exists and callback wired', () => {
    renderCard({ onMarkOff: vi.fn() });
    const btn = screen.getByTestId('staff-card-mark-off');
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent('Mark off today');
    expect(btn).toBeEnabled();
    // WHO: front-desk operator | WHAT: sees the Mark off action with default copy | WHEN: viewing today's schedule and clicking a working employee | WHERE: StaffProfileCard | WHY: default label "Mark off today" matches the audit's specified verbiage and the canonical use case
  });

  test('renders the parent-supplied label when markOffLabel is provided', () => {
    renderCard({ onMarkOff: vi.fn(), markOffLabel: 'Mark off Mon, May 11' });
    const btn = screen.getByTestId('staff-card-mark-off');
    expect(btn).toHaveTextContent('Mark off Mon, May 11');
    // WHO: front-desk operator viewing a non-today date | WHAT: button label reflects the actual viewed date | WHEN: scheduler shows tomorrow or a future day | WHERE: StaffProfileCard | WHY: a label hard-coded to "today" would lie when the operator is on a different date — parent owns the label so the card stays presentational
  });

  test('clicking Mark off invokes the parent callback', () => {
    const onMarkOff = vi.fn();
    renderCard({ onMarkOff });
    fireEvent.click(screen.getByTestId('staff-card-mark-off'));
    expect(onMarkOff).toHaveBeenCalledTimes(1);
    // WHO: front-desk operator | WHAT: click triggers the parent's confirm + API flow | WHEN: operator decides to take a sick employee off the board | WHERE: StaffProfileCard | WHY: the card emits intent only — parent owns the API call, confirm dialog, toast, and refresh; this test pins the contract that the click reaches the parent
  });

  test('button is disabled and shows progress copy while isMarkingOff is true', () => {
    const onMarkOff = vi.fn();
    renderCard({ onMarkOff, isMarkingOff: true });
    const btn = screen.getByTestId('staff-card-mark-off');
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent('Marking off…');
    fireEvent.click(btn);
    expect(onMarkOff).not.toHaveBeenCalled();
    // WHO: front-desk operator who has already confirmed | WHAT: button disabled, label shows progress, double-click ignored | WHEN: API call in flight | WHERE: StaffProfileCard | WHY: prevents duplicate writes if the operator clicks again while the first save is still pending — without this gate two is_off rows could be inserted on a slow network
  });
});
