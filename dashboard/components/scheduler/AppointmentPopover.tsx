import React, { useEffect, useRef } from 'react';
import { Clock, User, MapPin, Wrench, Calendar } from 'lucide-react';
import { formatPhone } from '../../lib/phone';
import type { SchedulerAppointment } from './useSchedulerData';

export interface AppointmentPopoverProps {
  appointment: SchedulerAppointment;
  employeeName: string | null;
  resourceName: string | null;
  anchorRect: DOMRect;
  onClose: () => void;
  onOpenDetails?: (appointmentId: string) => void;
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
}: AppointmentPopoverProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
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
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const cardWidth = 280;
  const cardEstHeight = 220;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;

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
      className="fixed z-50 rounded-lg shadow-xl"
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
            onClick={() => onOpenDetails(appointment.id)}
            className="w-full px-4 py-2.5 text-xs font-bold text-left flex items-center gap-2 transition-colors hover:brightness-125"
            style={{ color: 'var(--accent, #3b82f6)' }}
            data-testid="appointment-popover-details"
          >
            <Calendar className="w-3.5 h-3.5" />
            Open Details
          </button>
        </>
      )}
    </div>
  );
}
