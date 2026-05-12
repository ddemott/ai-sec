import React, { useEffect, useRef } from 'react';
import { Clock, User, MapPin, Wrench, Calendar, Edit, Trash2 } from 'lucide-react';
import { formatPhone } from '../../lib/phone';
import type { SchedulerAppointment } from './useSchedulerData';

export interface AppointmentPopoverProps {
  appointment: SchedulerAppointment;
  employeeName: string | null;
  resourceName: string | null;
  anchorRect: DOMRect;
  onClose: () => void;
  onOpenDetails?: (appointmentId: string) => void;
  /** When provided, renders an "Edit" button. Parent owns navigation —
      typically switches to the Calendar sub-tab and pre-selects the
      appointment in edit mode. */
  onEdit?: (appointmentId: string) => void;
  /** When provided, renders a "Cancel" button. Parent owns the API call
      (soft-cancel via `Api.appointments.cancel`), confirm dialog, and
      data refresh. Hidden when the appointment is already canceled. */
  onCancel?: (appointmentId: string) => void;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function AppointmentPopover({
  appointment,
  employeeName,
  resourceName,
  anchorRect,
  onClose,
  onOpenDetails,
  onEdit,
  onCancel,
}: AppointmentPopoverProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;

    function handleClick(e: MouseEvent) {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick);
    }, 0);
    document.addEventListener('keydown', handleKeyDown);

    // Focus the popover when it opens
    requestAnimationFrame(() => {
      cardRef.current?.focus();
    });

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
      // Restore focus to the element that opened the popover
      if (previousFocusRef.current && document.body.contains(previousFocusRef.current)) {
        previousFocusRef.current.focus();
      }
    };
  }, [onClose]);

  const cardWidth = 280;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;

  // Use measured height when available, fallback to estimate for initial render
  const cardEstHeight = cardRef.current?.offsetHeight || 220;

  const spaceBelow = viewportHeight - anchorRect.bottom;
  const positionAbove = spaceBelow < cardEstHeight && anchorRect.top > cardEstHeight;

  const top = positionAbove
    ? anchorRect.top - cardEstHeight - 4
    : anchorRect.bottom + 4;
  const left = Math.min(Math.max(8, anchorRect.left), viewportWidth - cardWidth - 8);

  const customerName = appointment.customers?.name || 'Unknown';
  const customerPhone = appointment.customers?.phone || null;
  const statusLabel = appointment.status === 'canceled' ? 'Canceled' : appointment.status === 'completed' ? 'Completed' : 'Scheduled';
  const statusColor = appointment.status === 'canceled' ? 'var(--red, #ef4444)' : appointment.status === 'completed' ? 'var(--green, #22c55e)' : 'var(--accent, #3b82f6)';

  return (
    <div
      ref={cardRef}
      data-testid="appointment-popover"
      role="dialog"
      aria-label={`Appointment details: ${appointment.description || 'Appointment'}`}
      tabIndex={-1}
      className="fixed z-50 rounded-lg shadow-xl outline-none"
      style={{
        top,
        left,
        width: cardWidth,
        background: 'var(--bg-raised, #2a2a2a)',
        border: '1px solid var(--border-soft, #444)',
        fontFamily: 'var(--font-body, "DM Sans", sans-serif)',
        color: 'var(--text-primary, #fff)',
      }}
    >
      {/* Header: service + status */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>
            {appointment.description || 'Appointment'}
          </div>
          <span
            className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full shrink-0 ml-2"
            style={{ background: statusColor, color: '#fff', opacity: 0.9 }}
          >
            {statusLabel}
          </span>
        </div>
      </div>

      <div style={{ height: 1, background: 'var(--border-soft, #333)', margin: '0 16px' }} />

      {/* Details */}
      <div className="px-4 py-3 flex flex-col gap-2">
        {/* Customer */}
        <div className="flex items-center gap-2 text-xs">
          <User className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-muted, #888)' }} />
          <span style={{ color: 'var(--text-secondary, #aaa)' }}>
            {customerName}
            {customerPhone && <span className="ml-1 opacity-70">{formatPhone(customerPhone)}</span>}
          </span>
        </div>

        {/* Time */}
        <div className="flex items-center gap-2 text-xs">
          <Clock className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-muted, #888)' }} />
          <span style={{ color: 'var(--text-secondary, #aaa)' }}>
            {formatDate(appointment.start_time)} &middot; {formatTime(appointment.start_time)} – {formatTime(appointment.end_time)}
          </span>
        </div>

        {/* Employee */}
        {employeeName && (
          <div className="flex items-center gap-2 text-xs">
            <Wrench className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-muted, #888)' }} />
            <span style={{ color: 'var(--text-secondary, #aaa)' }}>{employeeName}</span>
          </div>
        )}

        {/* Resource */}
        {resourceName && (
          <div className="flex items-center gap-2 text-xs">
            <MapPin className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-muted, #888)' }} />
            <span style={{ color: 'var(--text-secondary, #aaa)' }}>{resourceName}</span>
          </div>
        )}

        {/* Location */}
        {appointment.location && (
          <div className="flex items-center gap-2 text-xs">
            <MapPin className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-muted, #888)' }} />
            <span className="truncate" style={{ color: 'var(--text-secondary, #aaa)' }}>{appointment.location}</span>
          </div>
        )}
      </div>

      {/* Open Details link */}
      {onOpenDetails && (
        <>
          <div style={{ height: 1, background: 'var(--border-soft, #333)', margin: '0 16px' }} />
          <button
            onClick={() => onOpenDetails(appointment.appointment_id)}
            className="w-full px-4 py-2.5 text-xs font-bold text-left flex items-center gap-2 transition-colors hover:brightness-125"
            style={{ color: 'var(--accent, #3b82f6)' }}
            data-testid="appointment-popover-details"
          >
            <Calendar className="w-3.5 h-3.5" />
            Open Details
          </button>
        </>
      )}

      {/* Edit + Cancel actions — available from any view (Resources / List /
          Staff / Calendar). Pre-fix the popover was read-only, forcing the
          operator to navigate to the Calendar sub-tab and click the
          appointment again before editing or canceling. The "Cancel"
          button hits the soft-cancel endpoint (status='canceled') so the
          row stays in the DB and re-clicks don't 404. */}
      {(onEdit || onCancel) && appointment.status !== 'canceled' && (
        <>
          <div style={{ height: 1, background: 'var(--border-soft, #333)', margin: '0 16px' }} />
          <div className="flex gap-2 px-4 py-3">
            {onEdit && (
              <button
                onClick={() => onEdit(appointment.appointment_id)}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded text-xs font-bold transition-colors hover:brightness-125"
                style={{
                  background: 'var(--accent-muted, rgba(59,130,246,0.15))',
                  color: 'var(--accent, #3b82f6)',
                  border: '1px solid var(--accent-muted, rgba(59,130,246,0.3))',
                }}
                data-testid="appointment-popover-edit"
              >
                <Edit className="w-3.5 h-3.5" />
                Edit
              </button>
            )}
            {onCancel && (
              <button
                onClick={() => onCancel(appointment.appointment_id)}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded text-xs font-bold transition-colors hover:brightness-125"
                style={{
                  background: 'var(--danger-muted, rgba(239,68,68,0.12))',
                  color: 'var(--danger, #ef4444)',
                  border: '1px solid var(--danger-muted, rgba(239,68,68,0.3))',
                }}
                data-testid="appointment-popover-cancel"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Cancel
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
