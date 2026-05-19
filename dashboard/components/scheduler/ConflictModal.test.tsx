/**
 * Tests for ConflictModal — surfaces the existing appointment that's
 * blocking a slot the operator tried to book. Pre-2026-05-08 the dashboard
 * could only show a string toast ("Resource already booked"); this modal
 * shows WHO has the slot, on WHAT resource, with WHICH employee, at WHAT
 * time so the operator can decide what to do without leaving the screen.
 *
 * Coverage:
 *   - HAPPY render: full conflict block populates customer / employee /
 *     resource / time fields visibly.
 *   - HAPPY partial: missing fields don't crash the modal — still shows
 *     whatever's available.
 *   - WIRING: Pick-another-time button invokes onClose; View button (when
 *     wired) invokes onView with the conflict's appointment_id.
 *   - GUARD: when conflict is null the modal renders nothing (callers can
 *     wire `isOpen={conflict !== null}` without conditional render guards).
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';

import { ConflictModal } from './ConflictModal';

const baseConflict = {
  appointment_id: 'existing-1',
  start_time: '2026-05-10T14:00:00.000Z',
  end_time: '2026-05-10T14:30:00.000Z',
  customer_name: 'Alice Lee',
  employee_name: 'Mike Rivera',
  resource_name: 'Bay 1',
  description: 'Tire rotation',
};

describe('ConflictModal', () => {
  it('HAPPY: renders all populated fields when conflict has full details', () => {
    // WHO: front-desk operator who just tried to book a slot Mike already has
    // WHAT: modal title + customer name + employee + resource + description
    //        all visible so the operator can act on the info
    // WHEN: /appointments/create returned 409 with full conflict block
    // WHERE: ConflictModal — the dashboard's user-facing conflict UX
    // WHY: a string-only error ("Resource already booked") gives the
    //       operator no way to decide between "pick another time" and
    //       "ask Alice to reschedule"; showing the existing booking does
    render(<ConflictModal isOpen onClose={() => {}} conflict={baseConflict} />);
    expect(screen.getByText('That time is already booked')).toBeInTheDocument();
    expect(screen.getByText('Alice Lee')).toBeInTheDocument();
    expect(screen.getByText('Mike Rivera')).toBeInTheDocument();
    expect(screen.getByText('Bay 1')).toBeInTheDocument();
    expect(screen.getByText('Tire rotation')).toBeInTheDocument();
  });

  it('HAPPY: partial conflict (no employee, no description) still renders cleanly', () => {
    // WHO: unassigned-employee booking that hit a resource overlap
    // WHAT: modal omits the employee line and description footer but still
    //        shows time + customer + resource without empty placeholders
    // WHY: an INNER-JOIN style render that hid the whole row when one field
    //       was null would show a blank conflict block — worst possible UX
    render(
      <ConflictModal
        isOpen
        onClose={() => {}}
        conflict={{
          ...baseConflict,
          employee_name: null,
          description: null,
        }}
      />
    );
    expect(screen.getByText('Alice Lee')).toBeInTheDocument();
    expect(screen.getByText('Bay 1')).toBeInTheDocument();
    expect(screen.queryByText('Tire rotation')).not.toBeInTheDocument();
  });

  it('WIRING: Pick-another-time button invokes onClose', () => {
    // WHY: this is the most common path — operator sees the conflict, picks
    //       a different time on the form behind the modal. onClose hides
    //       the modal and leaves the form intact for re-submit.
    const onClose = vi.fn();
    render(<ConflictModal isOpen onClose={onClose} conflict={baseConflict} />);
    fireEvent.click(screen.getByTestId('conflict-modal-pick-another'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('WIRING: View button is hidden when onView is not provided', () => {
    // WHY: not every host of the modal wants the View navigation (e.g. a
    //       super-admin context where appointments aren't directly viewable
    //       in the current tenant). Make View opt-in so the host decides.
    render(<ConflictModal isOpen onClose={() => {}} conflict={baseConflict} />);
    expect(screen.queryByTestId('conflict-modal-view')).not.toBeInTheDocument();
  });

  it('WIRING: View button invokes onView with the conflict appointment_id', () => {
    const onView = vi.fn();
    render(<ConflictModal isOpen onClose={() => {}} conflict={baseConflict} onView={onView} />);
    fireEvent.click(screen.getByTestId('conflict-modal-view'));
    expect(onView).toHaveBeenCalledWith('existing-1');
  });

  it('GUARD: renders nothing when conflict is null (callers can wire isOpen unconditionally)', () => {
    // WHY: makes the host JSX simpler — `isOpen={conflict !== null}` plus
    //       `conflict={conflict}` is enough; no need for `{conflict && <Modal>}`
    //       dance. The component handles the null case internally.
    const { container } = render(<ConflictModal isOpen onClose={() => {}} conflict={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('HAPPY: renders next-available alternatives section when slots + handler provided', () => {
    // WHO: operator who hit a conflict; backend returned suggestions
    // WHAT: each suggested slot renders as a clickable button showing
    //        time + employee + resource
    // WHEN: /appointments/create returns 409 with non-empty next_available
    // WHERE: ConflictModal — new "Try one of these times instead" section
    // WHY: pre-fix the operator had to manually try other times until one
    //        worked. With suggestions, one click pre-fills the form.
    const onPick = vi.fn();
    render(
      <ConflictModal
        isOpen
        onClose={() => {}}
        conflict={baseConflict}
        nextAvailable={[
          {
            start_time: '2026-05-10T15:00:00.000Z',
            end_time: '2026-05-10T15:30:00.000Z',
            employee_id: 'emp-carlos',
            employee_name: 'Carlos',
            resource_id: 'res-truck1',
            resource_name: 'Truck 1',
            skill_count: 3,
          },
          {
            start_time: '2026-05-10T15:30:00.000Z',
            end_time: '2026-05-10T16:00:00.000Z',
            employee_id: 'emp-dana',
            employee_name: 'Dana',
            resource_id: 'res-truck1',
            resource_name: 'Truck 1',
            skill_count: 3,
          },
        ]}
        onPickAlternative={onPick}
      />
    );

    expect(screen.getByText(/Try one of these times instead/i)).toBeInTheDocument();
    expect(screen.getByText('Carlos')).toBeInTheDocument();
    expect(screen.getByText('Dana')).toBeInTheDocument();
  });

  it('WIRING: clicking an alternative invokes onPickAlternative and closes the modal', () => {
    // WHY: operator picks a suggested slot → host pre-fills form and the
    //        modal goes away so the form is usable again. Both the pick
    //        callback AND onClose must fire from one click.
    const onPick = vi.fn();
    const onClose = vi.fn();
    const slot = {
      start_time: '2026-05-10T15:00:00.000Z',
      end_time: '2026-05-10T15:30:00.000Z',
      employee_id: 'emp-carlos',
      employee_name: 'Carlos',
      resource_id: 'res-truck1',
      resource_name: 'Truck 1',
      skill_count: 3,
    };
    render(
      <ConflictModal
        isOpen
        onClose={onClose}
        conflict={baseConflict}
        nextAvailable={[slot]}
        onPickAlternative={onPick}
      />
    );

    fireEvent.click(screen.getByTestId(`conflict-modal-alt-${slot.start_time}`));
    expect(onPick).toHaveBeenCalledWith(slot);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('GUARD: alternatives section hidden when nextAvailable is empty', () => {
    // WHY: empty alternatives means backend found no free slots in the
    //        24h horizon. Don't render an empty header — the modal would
    //        look broken. The "Pick another time" button (which closes
    //        the modal so operator can try elsewhere) handles that case.
    render(
      <ConflictModal
        isOpen
        onClose={() => {}}
        conflict={baseConflict}
        nextAvailable={[]}
        onPickAlternative={vi.fn()}
      />
    );
    expect(screen.queryByText(/Try one of these times instead/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('conflict-modal-alternatives')).not.toBeInTheDocument();
  });

  it('GUARD: alternatives section hidden when onPickAlternative is not provided', () => {
    // WHY: a host that doesn't wire the callback can't usefully render
    //        clickable suggestions. Suppress the section rather than
    //        render dead-end buttons.
    render(
      <ConflictModal
        isOpen
        onClose={() => {}}
        conflict={baseConflict}
        nextAvailable={[
          {
            start_time: '2026-05-10T15:00:00.000Z',
            end_time: '2026-05-10T15:30:00.000Z',
            employee_id: 'e',
            employee_name: 'C',
            resource_id: 'r',
            resource_name: 'T',
            skill_count: 3,
          },
        ]}
      />
    );
    expect(screen.queryByText(/Try one of these times instead/i)).not.toBeInTheDocument();
  });
});
