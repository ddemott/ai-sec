import React from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Clock, User, Wrench } from 'lucide-react';

/**
 * Shape of the `conflict` block surfaced by /appointments/create when the
 * RPC rejects with TIMESLOT_OCCUPIED. Mirrors the AppointmentConflict type
 * in src/services/conflictLookup.ts on the backend.
 */
export interface BookingConflict {
  appointment_id: string;
  start_time: string;
  end_time: string;
  customer_name: string | null;
  employee_name: string | null;
  resource_name: string | null;
  description: string | null;
}

/**
 * Shape of the `next_available` slot suggestions returned alongside a
 * conflict response. Mirrors AvailableSlot from src/services/
 * availabilitySearch.ts on the backend.
 */
export interface AvailableAlternative {
  start_time: string;
  end_time: string;
  employee_id: string;
  employee_name: string;
  resource_id: string;
  resource_name: string;
  skill_count: number;
}

interface ConflictModalProps {
  isOpen: boolean;
  onClose: () => void;
  conflict: BookingConflict | null;
  /** Optional: navigate to the conflicting appointment (e.g. switch to
   *  Calendar sub-tab and select). When omitted, the View button is hidden. */
  onView?: (appointmentId: string) => void;
  /** Optional: next-available slot suggestions surfaced from the booking
   *  response. When provided AND non-empty, the modal renders a "Try
   *  another time" section the operator can click through. */
  nextAvailable?: AvailableAlternative[];
  /** Called when the operator picks one of the next-available slots —
   *  the host pre-fills the form with the suggested time + employee +
   *  resource and closes the modal so the operator can submit again. */
  onPickAlternative?: (slot: AvailableAlternative) => void;
}

/**
 * Format an ISO timestamp as a short local-time string for the header
 * (e.g. "2:00–2:30 PM"). Falls back to the raw ISO if parsing fails so
 * the modal never renders blank.
 */
function formatRange(start: string, end: string): string {
  try {
    const s = new Date(start);
    const e = new Date(end);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return `${start} – ${end}`;
    const fmt = (d: Date) =>
      d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return `${fmt(s)} – ${fmt(e)}`;
  } catch {
    return `${start} – ${end}`;
  }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

/**
 * Modal shown when a booking attempt fails because the slot is already
 * taken by another appointment. Surfaces the conflicting appointment's
 * customer / employee / resource / time so the operator can decide whether
 * to pick a different time, or follow up with the existing customer to
 * reschedule. Replaces the prior plain-string toast UX where the operator
 * only saw "Resource already booked".
 */
export function ConflictModal({
  isOpen,
  onClose,
  conflict,
  onView,
  nextAvailable,
  onPickAlternative,
}: ConflictModalProps) {
  if (!conflict) return null;
  const alternatives = nextAvailable ?? [];
  const showAlternatives = alternatives.length > 0 && !!onPickAlternative;
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="That time is already booked"
      footer={
        <div className="flex gap-2 justify-end">
          {onView && (
            <Button
              variant="ghost"
              onClick={() => onView(conflict.appointment_id)}
              data-testid="conflict-modal-view"
            >
              View appointment
            </Button>
          )}
          <Button
            variant="primary"
            onClick={onClose}
            data-testid="conflict-modal-pick-another"
          >
            Pick another time
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm" style={{ color: 'var(--text-primary)' }}>
        <p style={{ color: 'var(--text-secondary)' }}>
          The slot you picked is taken. Here&rsquo;s what&rsquo;s on the books for that time:
        </p>
        <dl className="space-y-2 rounded-md border p-3" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}>
          <div className="flex items-start gap-2">
            <Clock className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--text-secondary)' }} />
            <div>
              <dt className="sr-only">Time</dt>
              <dd>
                <span className="font-medium">{formatDate(conflict.start_time)}</span>
                <span className="mx-1.5" style={{ color: 'var(--text-secondary)' }}>·</span>
                <span>{formatRange(conflict.start_time, conflict.end_time)}</span>
              </dd>
            </div>
          </div>
          {conflict.customer_name && (
            <div className="flex items-start gap-2">
              <User className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--text-secondary)' }} />
              <div>
                <dt className="sr-only">Customer</dt>
                <dd className="font-medium">{conflict.customer_name}</dd>
              </div>
            </div>
          )}
          {(conflict.employee_name || conflict.resource_name) && (
            <div className="flex items-start gap-2">
              <Wrench className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--text-secondary)' }} />
              <div className="space-y-0.5">
                <dt className="sr-only">Assignment</dt>
                {conflict.employee_name && <dd>{conflict.employee_name}</dd>}
                {conflict.resource_name && (
                  <dd style={{ color: 'var(--text-secondary)' }}>{conflict.resource_name}</dd>
                )}
              </div>
            </div>
          )}
          {conflict.description && (
            <div className="pl-6 text-xs italic" style={{ color: 'var(--text-secondary)' }}>
              {conflict.description}
            </div>
          )}
        </dl>

        {showAlternatives && (
          <div className="pt-2" data-testid="conflict-modal-alternatives">
            <p className="mb-2 font-medium" style={{ color: 'var(--text-primary)' }}>
              Try one of these times instead:
            </p>
            <ul className="space-y-1">
              {alternatives.map((slot) => (
                <li key={`${slot.start_time}-${slot.employee_id}`}>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 rounded-md border text-sm hover:bg-[var(--surface-3)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]"
                    style={{
                      borderColor: 'var(--border)',
                      background: 'var(--surface-2)',
                      color: 'var(--text-primary)',
                    }}
                    onClick={() => {
                      onPickAlternative(slot);
                      onClose();
                    }}
                    data-testid={`conflict-modal-alt-${slot.start_time}`}
                  >
                    <span className="font-medium">{formatRange(slot.start_time, slot.end_time)}</span>
                    <span className="mx-1.5" style={{ color: 'var(--text-secondary)' }}>·</span>
                    <span>{slot.employee_name}</span>
                    <span className="mx-1.5" style={{ color: 'var(--text-secondary)' }}>·</span>
                    <span style={{ color: 'var(--text-secondary)' }}>{slot.resource_name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
