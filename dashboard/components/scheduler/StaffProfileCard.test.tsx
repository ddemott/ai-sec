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

describe('StaffProfileCard — accessibility + keyboard (Cluster C)', () => {
  test('HAPPY: has role=dialog and aria-label naming the employee', () => {
    // WHO: screen-reader user who opened the staff profile card
    // WHAT: card exposes role=dialog + aria-label "<name> — staff profile"
    // WHERE: StaffProfileCard outer div
    // WHY: without a dialog role the overlay is announced as generic content;
    //      without a label, screen readers cannot tell whose profile is open
    renderCard();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-label', 'Carlos Rivera — staff profile');
  });

  test('HAPPY: visible X close button fires onClose', () => {
    // WHO: keyboard user who wants to dismiss without clicking outside
    // WHAT: "Close staff profile" button is present and calls onClose when clicked
    // WHERE: StaffProfileCard header X button
    // WHY: anchored popovers have no backdrop; without a visible close affordance
    //      keyboard users can only dismiss via Escape
    const onClose = vi.fn();
    renderCard({ onClose });
    const closeBtn = screen.getByRole('button', { name: /close staff profile/i });
    expect(closeBtn).toBeInTheDocument();
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('HAPPY: Escape key fires onClose', () => {
    // WHO: keyboard user reviewing a staff card who wants to dismiss
    // WHAT: pressing Escape calls onClose once
    // WHERE: StaffProfileCard keydown listener
    // WHY: Escape-to-close is the universal keyboard dialog contract;
    //      the previous implementation already had this but focus management was missing
    const onClose = vi.fn();
    renderCard({ onClose });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('HAPPY: an outside pointer press fires onClose (through the shared useFocusTrap)', async () => {
    // WHO: operator who opens a staff card then clicks elsewhere on the schedule.
    // WHAT: a mousedown outside the card calls onClose exactly once.
    // WHERE: useFocusTrap's opt-in onOutsideDismiss listener (StaffProfileCard
    //        was migrated off its own hand-rolled outside-click effect).
    // WHY: the outside-dismiss listener is attached on the NEXT tick so the
    //      opening click can't self-close — the test flushes that tick, then
    //      presses outside.
    const onClose = vi.fn();
    renderCard({ onClose });
    // Flush the deferred (setTimeout 0) listener attach.
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('HAPPY: a pointer press INSIDE the card does NOT close it', async () => {
    // WHY: only outside presses dismiss — clicking the card body/controls must not.
    const onClose = vi.fn();
    renderCard({ onClose });
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });
});

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
