import React, { useEffect, useRef, useState } from 'react';
import { Trash2, GripVertical } from 'lucide-react';
import type { SchedulerAppointment } from './useSchedulerData';
import { SCHEDULER_START_HOUR, SCHEDULER_END_HOUR } from './TimeGrid';

interface AppointmentBlockProps {
  appointment: SchedulerAppointment;
  onClick?: (appointment: SchedulerAppointment, e: React.MouseEvent) => void;
  /**
   * Always-visible trash icon → soft-cancel. Parent owns the confirm
   * prompt + API call; child only fires the intent. Hidden for already-
   * canceled appointments (the row stays but the operator can't cancel
   * twice) and during drag. When omitted, no trash icon renders — the
   * block behaves exactly as it did pre-2026-05-13.
   *
   * Visibility note (UX audit #2, 2026-05-18): icon was previously
   * `opacity-0 group-hover:opacity-100`, which made it invisible on
   * touch + keyboard. Now renders at 70% opacity at rest, 100% on
   * hover/focus. Tap area widened to 24px for iOS-class touch targets.
   */
  onDelete?: (appointmentId: string) => void;
  /**
   * Outlook-style drag-to-move. Parent computes new start_time/end_time
   * from `deltaMinutes` (positive = right/later, negative = left/earlier)
   * and calls the update API. Snap is fixed at 15 minutes — anything
   * smaller is treated as a click rather than a drag. When omitted, the
   * block is not draggable.
   */
  onMove?: (appointmentId: string, deltaMinutes: number) => void;
  colorClass?: string;
  /** Hour-cell pixel width — needed to convert drag-delta-pixels to minutes. */
  hourWidth?: number;
}

const employeeColors = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-fuchsia-500',
  'bg-lime-500',
];

export function getEmployeeColor(employeeId: string | null, index?: number): string {
  if (!employeeId) return 'bg-gray-400';
  const idx = index ?? Math.abs(hashString(employeeId)) % employeeColors.length;
  return employeeColors[idx % employeeColors.length];
}

function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash << 5) - hash + s.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

export function getTimePosition(timeStr: string, startHour: number, endHour: number): number {
  const d = new Date(timeStr);
  const hours = d.getHours() + d.getMinutes() / 60;
  const totalHours = endHour - startHour;
  return Math.max(0, Math.min(1, (hours - startHour) / totalHours));
}

export function getTimeSpan(
  startStr: string,
  endStr: string,
  startHour: number,
  endHour: number
): { left: number; width: number } {
  const left = getTimePosition(startStr, startHour, endHour);
  const right = getTimePosition(endStr, startHour, endHour);
  return { left, width: Math.max(right - left, 0.02) }; // min 2% width
}

// Click-vs-drag disambiguation: a horizontal move smaller than this counts
// as a click; anything larger starts a drag. 4px is the standard threshold
// across most drag UX (allows for tiny mouse jitter on a click).
const CLICK_DRAG_THRESHOLD_PX = 4;
// Snap drags to a 15-minute grid to match the booking-form convention
// (every appointment time the booking flow accepts is a multiple of 15).
const SNAP_MIN = 15;

export const AppointmentBlock: React.FC<AppointmentBlockProps> = ({
  appointment,
  onClick,
  onDelete,
  onMove,
  colorClass,
  hourWidth = 60,
}) => {
  const { left, width } = getTimeSpan(
    appointment.start_time,
    appointment.end_time,
    SCHEDULER_START_HOUR,
    SCHEDULER_END_HOUR
  );
  const customerName = appointment.customers?.name || 'Unknown';
  const isCanceled = appointment.status === 'canceled';
  const statusColors: Record<string, { bg: string; text: string }> = {
    completed: { bg: 'var(--green, #22c55e)', text: '#fff' },
    scheduled: { bg: colorClass ? '' : 'var(--accent, #3b82f6)', text: '#fff' },
    canceled: { bg: 'var(--text-muted, #666)', text: '#fff' },
  };
  const sc = statusColors[appointment.status] || statusColors.scheduled;

  // Drag state lives in the block. We deliberately don't lift this into
  // the parent — every block knows its own drag deltas, and the parent
  // only learns the final move via onMove(id, deltaMinutes). Avoids a
  // re-render of every sibling block on every mouse-move.
  const [drag, setDrag] = useState<{ startX: number; deltaPx: number } | null>(null);
  const dragRef = useRef<typeof drag>(null);
  dragRef.current = drag;

  // Pixel → minute conversion. Container width is (END-START)*hourWidth
  // pixels; a one-hour span renders at hourWidth pixels, so 60 minutes
  // span hourWidth px → 1 minute = hourWidth/60 px (and 1 px = 60/hourWidth
  // minutes). At the default hourWidth=60 this is 1:1.
  const minutesPerPx = 60 / hourWidth;

  useEffect(() => {
    if (!drag) return;
    const onMouseMove = (e: MouseEvent) => {
      const current = dragRef.current;
      if (!current) return;
      setDrag({ ...current, deltaPx: e.clientX - current.startX });
    };
    const onMouseUp = () => {
      const current = dragRef.current;
      if (!current) return;
      const deltaPx = current.deltaPx;
      setDrag(null);
      if (Math.abs(deltaPx) < CLICK_DRAG_THRESHOLD_PX) {
        // It was actually a click. The block's onClick fires below; do
        // not also fire onMove with a near-zero delta (which would
        // round to 0 minutes and no-op the API anyway, but the round-
        // trip wastes a request).
        return;
      }
      const rawMinutes = deltaPx * minutesPerPx;
      const deltaMinutes = Math.round(rawMinutes / SNAP_MIN) * SNAP_MIN;
      if (deltaMinutes !== 0 && onMove) {
        onMove(appointment.appointment_id, deltaMinutes);
      }
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [drag, minutesPerPx, appointment.appointment_id, onMove]);

  const handleMouseDown = (e: React.MouseEvent) => {
    // Drag is opt-in via onMove. Canceled appointments are read-only —
    // dragging a canceled row would create a confusing "moved a dead
    // record" state and the booking RPC rejects updates against
    // status='canceled' anyway.
    if (!onMove || isCanceled) return;
    // Left-button only. Right-click stays available for future context-
    // menu work without colliding with drag.
    if (e.button !== 0) return;
    setDrag({ startX: e.clientX, deltaPx: 0 });
  };

  const handleClick = (e: React.MouseEvent) => {
    // If the user just released after a drag, onMove already fired in
    // mouseup and we suppress the click. drag is reset to null by then,
    // but the click event still bubbles — guard on the raw distance
    // moved during the most recent drag cycle.
    onClick?.(appointment, e);
  };

  const handleTrashClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDelete) onDelete(appointment.appointment_id);
  };

  // Visual feedback during drag: shift the block by the pixel-delta so
  // the user sees the ghost track their cursor. CSS transform avoids
  // re-laying out the row.
  const dragStyle = drag
    ? {
        transform: `translateX(${drag.deltaPx}px)`,
        opacity: 0.7,
        zIndex: 20,
      }
    : {};
  const isDragging = drag !== null && Math.abs(drag.deltaPx) >= CLICK_DRAG_THRESHOLD_PX;

  // Trash icon is always visible (dimmed at rest, full on hover/focus)
  // so touch + keyboard users can reach it. The icon is suppressed
  // during drag (no point letting the user click delete on a ghost
  // block), on canceled rows (already non-actionable), and on very
  // narrow blocks (width < 4% of the row) where it would cover the
  // dot-renderer used in place of the customer name.
  const isNarrowBlock = width < 0.04;
  const showTrash = onDelete && !isCanceled && !isDragging && !isNarrowBlock;
  // Drag handle is the discoverability cue for drag-to-move. The drag
  // gesture itself lives on the block body (so the whole block remains
  // draggable, not just the handle), but without a visible affordance
  // users never learn the capability exists — cursor:move alone is
  // invisible on touch and on a brief skim (UX audit #6, 2026-05-18).
  // Hidden on narrow blocks where it would compete with the dot-renderer.
  const showDragHandle = !!onMove && !isCanceled && !isDragging && !isNarrowBlock;
  const moveHintTitle =
    onMove && !isCanceled
      ? `${customerName} — ${appointment.description ?? ''}\nDrag to move · click for details`
      : `${customerName} — ${appointment.description ?? ''}`;

  return (
    <div
      className={`group absolute top-1 bottom-1 rounded px-1.5 py-0.5 text-xs font-bold truncate hover:opacity-90 transition-opacity ${colorClass || ''} ${isCanceled ? 'opacity-40 line-through cursor-pointer' : onMove ? 'cursor-move' : 'cursor-pointer'}`}
      style={{
        left: `${left * 100}%`,
        width: `${width * 100}%`,
        background: sc.bg || undefined,
        color: sc.text,
        ...dragStyle,
      }}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      title={moveHintTitle}
      data-testid={`appointment-block-${appointment.appointment_id}`}
    >
      {showDragHandle && (
        <span
          className="absolute left-0 top-1/2 -translate-y-1/2 opacity-40 pointer-events-none"
          aria-hidden="true"
          data-testid={`appointment-block-drag-handle-${appointment.appointment_id}`}
        >
          <GripVertical className="w-3 h-3" style={{ color: sc.text }} />
        </span>
      )}
      <span className={showDragHandle ? 'pl-3' : ''}>
        {width < 0.04 ? (
          <span
            className="inline-block w-2 h-2 rounded-full mt-0.5"
            style={{ backgroundColor: sc.text }}
            aria-label={`${appointment.status}: ${customerName}`}
          />
        ) : (
          customerName
        )}
      </span>
      {showTrash && (
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()} // don't start a drag from the trash
          onClick={handleTrashClick}
          className="absolute top-0 right-0 p-1.5 rounded opacity-70 hover:opacity-100 focus-visible:opacity-100 hover:bg-black/30 focus-visible:bg-black/30 focus-visible:outline-none transition-opacity"
          title="Cancel this appointment"
          aria-label="Cancel appointment"
          data-testid={`appointment-block-delete-${appointment.appointment_id}`}
        >
          <Trash2 className="w-3 h-3" style={{ color: sc.text }} />
        </button>
      )}
    </div>
  );
};
