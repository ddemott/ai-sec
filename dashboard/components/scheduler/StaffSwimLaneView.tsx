import React, { useState, useCallback, useRef } from 'react';
import { TimeGrid, SCHEDULER_START_HOUR, SCHEDULER_END_HOUR, LABEL_WIDTH } from './TimeGrid';
import { AppointmentBlock, getEmployeeColor } from './AppointmentBlock';
import type { SchedulerAppointment } from './useSchedulerData';

interface SwimLaneShift { id: number; start_time?: string; end_time?: string }
interface SwimLaneEmployee { id: string | number; name: string }

interface StaffSwimLaneViewProps {
  employees: SwimLaneEmployee[];
  appointmentsByEmployee: Map<string, SchedulerAppointment[]>;
  shiftsByEmployee: Map<string, SwimLaneShift[]>;
  onAppointmentClick?: (appointment: SchedulerAppointment) => void;
  onSlotClick?: (employeeId: string, hour: number) => void;
  onSlotDrag?: (employeeId: string, startHour: number, endHour: number) => void;
  onShiftDrag?: (employeeId: string, startHour: number, endHour: number) => void;
  onShiftDelete?: (shiftId: number) => void;
  onShiftResize?: (shiftId: number, startHour: number, endHour: number) => void;
  onEmployeeClick?: (employee: SwimLaneEmployee) => void;
  hourWidth?: number;
}

function parseShiftHours(shift: SwimLaneShift): { start: number; end: number } {
  const s = parseInt(shift.start_time?.split(':')[0] || '0', 10);
  const e = parseInt(shift.end_time?.split(':')[0] || '0', 10);
  return { start: s, end: e };
}

function isOnShift(shifts: SwimLaneShift[], hour: number): boolean {
  for (const shift of shifts) {
    const { start, end } = parseShiftHours(shift);
    if (hour >= start && hour < end) return true;
  }
  return false;
}

function findShiftAtHour(shifts: SwimLaneShift[], hour: number): SwimLaneShift | null {
  for (const shift of shifts) {
    const { start, end } = parseShiftHours(shift);
    if (hour >= start && hour < end) return shift;
  }
  return null;
}

// Is the mouse near the left or right edge of a shift at this hour?
function getEdge(shift: SwimLaneShift, hour: number): 'left' | 'right' | null {
  const { start, end } = parseShiftHours(shift);
  if (hour === start) return 'left';
  if (hour === end - 1) return 'right';
  return null;
}

type DragMode = 'create' | 'resize-left' | 'resize-right' | 'book';

interface DragState {
  employeeId: string;
  mode: DragMode;
  startHour: number;
  currentHour: number;
  shiftId?: number;        // for resize
  originalStart?: number;  // for resize
  originalEnd?: number;    // for resize
}

export const StaffSwimLaneView: React.FC<StaffSwimLaneViewProps> = ({
  employees,
  appointmentsByEmployee,
  shiftsByEmployee,
  onAppointmentClick,
  onSlotClick,
  onSlotDrag,
  onShiftDrag,
  onShiftDelete,
  onShiftResize,
  onEmployeeClick,
  hourWidth = 60,
}) => {
  const hourCount = SCHEDULER_END_HOUR - SCHEDULER_START_HOUR;
  const hours = Array.from({ length: hourCount }, (_, i) => SCHEDULER_START_HOUR + i);
  const totalWidth = LABEL_WIDTH + hourCount * hourWidth;

  const [drag, setDrag] = useState<DragState | null>(null);
  const [selectedLane, setSelectedLane] = useState<string | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const didDrag = useRef(false);

  const handleMouseDown = useCallback((employeeId: string, hour: number, empShifts: SwimLaneShift[]) => {
    const existingShift = findShiftAtHour(empShifts, hour);

    let mode: DragMode;
    let shiftId: number | undefined;
    let originalStart: number | undefined;
    let originalEnd: number | undefined;

    if (existingShift) {
      const edge = getEdge(existingShift, hour);
      const { start, end } = parseShiftHours(existingShift);
      if (edge === 'left') {
        mode = 'resize-left';
        shiftId = existingShift.id;
        originalStart = start;
        originalEnd = end;
      } else if (edge === 'right') {
        mode = 'resize-right';
        shiftId = existingShift.id;
        originalStart = start;
        originalEnd = end;
      } else {
        // Middle of shift → book appointment on this shift
        mode = 'book';
      }
    } else {
      // Empty space → create new shift
      mode = 'create';
    }

    const state: DragState = { employeeId, mode, startHour: hour, currentHour: hour, shiftId, originalStart, originalEnd };
    dragRef.current = state;
    didDrag.current = false;
    setDrag(state);
    setSelectedLane(employeeId);
  }, []);

  const handleMouseEnter = useCallback((employeeId: string, hour: number) => {
    if (!dragRef.current || dragRef.current.employeeId !== employeeId) return;
    if (hour !== dragRef.current.currentHour) {
      didDrag.current = true;
      const updated = { ...dragRef.current, currentHour: hour };
      dragRef.current = updated;
      setDrag(updated);
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    if (!dragRef.current) return;
    const d = dragRef.current;
    const minH = Math.min(d.startHour, d.currentHour);
    const maxH = Math.max(d.startHour, d.currentHour) + 1;

    if (d.mode === 'create') {
      // Create new shift
      if (onShiftDrag) onShiftDrag(d.employeeId, minH, maxH);
    } else if (d.mode === 'resize-left' && d.shiftId != null && d.originalEnd != null) {
      // Resize left edge — new start is currentHour, end stays
      const newStart = Math.min(d.currentHour, d.originalEnd - 1);
      if (onShiftResize && (newStart !== d.originalStart)) {
        onShiftResize(d.shiftId, newStart, d.originalEnd);
      }
    } else if (d.mode === 'resize-right' && d.shiftId != null && d.originalStart != null) {
      // Resize right edge — start stays, new end is currentHour + 1
      const newEnd = Math.max(d.currentHour + 1, d.originalStart + 1);
      if (onShiftResize && (newEnd !== d.originalEnd)) {
        onShiftResize(d.shiftId, d.originalStart, newEnd);
      }
    } else if (d.mode === 'book') {
      // Book appointment on shift
      if (didDrag.current && onSlotDrag) {
        onSlotDrag(d.employeeId, minH, maxH);
      } else if (onSlotClick) {
        onSlotClick(d.employeeId, d.startHour);
      }
    }

    dragRef.current = null;
    didDrag.current = false;
    setDrag(null);
  }, [onSlotClick, onSlotDrag, onShiftDrag, onShiftResize]);

  const handleMouseLeaveView = useCallback(() => {
    if (dragRef.current) {
      dragRef.current = null;
      didDrag.current = false;
      setDrag(null);
    }
  }, []);

  // Compute visual shift range during resize drag
  function getVisualShift(empId: string, shift: SwimLaneShift): { start: number; end: number } {
    const { start, end } = parseShiftHours(shift);
    if (!drag || drag.employeeId !== empId || drag.shiftId !== shift.id) {
      return { start, end };
    }
    // Adjust based on drag mode
    if (drag.mode === 'resize-left') {
      return { start: Math.min(drag.currentHour, end - 1), end };
    }
    if (drag.mode === 'resize-right') {
      return { start, end: Math.max(drag.currentHour + 1, start + 1) };
    }
    return { start, end };
  }

  // Get drag overlay for new shift creation
  function getCreateDragRange(empId: string): { start: number; end: number } | null {
    if (!drag || drag.employeeId !== empId || drag.mode !== 'create') return null;
    const minH = Math.min(drag.startHour, drag.currentHour);
    const maxH = Math.max(drag.startHour, drag.currentHour);
    return { start: minH, end: maxH };
  }

  // Get cursor based on position
  function getCursor(empShifts: SwimLaneShift[], hour: number, isUnassigned: boolean): string {
    if (isUnassigned) return 'default';
    const shift = findShiftAtHour(empShifts, hour);
    if (shift) {
      const edge = getEdge(shift, hour);
      if (edge) return 'col-resize';
      return 'crosshair'; // Book appointment
    }
    return 'cell'; // Create shift
  }

  function renderRow(
    empId: string,
    empName: string,
    empAppointments: SchedulerAppointment[],
    empShifts: SwimLaneShift[],
    colorClass: string,
    isUnassigned: boolean,
    onClick?: () => void
  ) {
    const isSelected = selectedLane === empId;
    const createRange = getCreateDragRange(empId);

    return (
      <div
        className={`flex border-b transition-colors ${
          isSelected
            ? 'border-blue-200 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-950/10'
            : 'border-gray-100 dark:border-gray-800'
        }`}
        style={{ minWidth: totalWidth }}
        data-testid={`swimlane-row-${empId}`}
      >
        {/* Employee label */}
        <div
          className={`p-2 border-r flex items-center gap-2 shrink-0 transition-colors ${
            isSelected
              ? 'border-blue-200 dark:border-blue-800 bg-blue-100/50 dark:bg-blue-900/20'
              : 'border-gray-200 dark:border-gray-800'
          } ${!isUnassigned ? 'cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-950/20' : ''}`}
          style={{ width: LABEL_WIDTH }}
          onClick={() => {
            setSelectedLane(prev => prev === empId ? null : empId);
            onClick?.();
          }}
        >
          <div className={`w-3 h-3 rounded-full ${colorClass} ${isSelected ? 'ring-2 ring-blue-400' : ''}`} />
          <span className={`text-sm font-bold truncate ${
            isUnassigned ? 'text-gray-500 dark:text-gray-400 italic'
            : isSelected ? 'text-blue-700 dark:text-blue-300'
            : 'text-gray-900 dark:text-gray-100'
          }`}>
            {empName}
          </span>
        </div>

        {/* Hour cells + overlays */}
        <div className="relative flex" style={{ width: hourCount * hourWidth }}>
          {/* Hour cell backgrounds */}
          {hours.map((hour) => {
            const onShift = isUnassigned || isOnShift(empShifts, hour);
            const isCreateDrag = createRange && hour >= createRange.start && hour <= createRange.end;
            const cursor = getCursor(empShifts, hour, isUnassigned);

            return (
              <div
                key={hour}
                className={`border-r border-gray-100 dark:border-gray-800 last:border-r-0 min-h-[48px] shrink-0 select-none ${
                  isCreateDrag
                    ? 'bg-green-200/60 dark:bg-green-700/30'
                    : onShift
                    ? 'bg-white dark:bg-[#1a1a1a] hover:bg-blue-50/50 dark:hover:bg-blue-950/10'
                    : 'off-shift-hatching'
                }`}
                style={{ width: hourWidth, cursor }}
                onMouseDown={(e) => {
                  if (!isUnassigned) {
                    e.preventDefault();
                    handleMouseDown(empId, hour, empShifts);
                  }
                }}
                onMouseEnter={() => {
                  if (!isUnassigned) handleMouseEnter(empId, hour);
                }}
                onMouseUp={() => {
                  if (!isUnassigned) handleMouseUp();
                }}
                data-testid={`slot-${empId}-${hour}`}
              />
            );
          })}

          {/* Shift blocks (Outlook-style solid bars with resize handles) */}
          {!isUnassigned && empShifts.map((shift, idx) => {
            const vis = getVisualShift(empId, shift);
            if (vis.end <= SCHEDULER_START_HOUR || vis.start >= SCHEDULER_END_HOUR) return null;
            const clampedStart = Math.max(vis.start, SCHEDULER_START_HOUR);
            const clampedEnd = Math.min(vis.end, SCHEDULER_END_HOUR);
            const isResizing = drag?.shiftId === shift.id;

            return (
              <div
                key={`shift-bar-${idx}`}
                className={`absolute top-0.5 bottom-0.5 rounded border z-[1] group/shift transition-colors ${
                  isResizing
                    ? 'bg-green-300/80 dark:bg-green-700/50 border-green-500 dark:border-green-400 shadow-md'
                    : 'bg-green-100/70 dark:bg-green-900/30 border-green-300/60 dark:border-green-700/40 hover:bg-green-200/80 dark:hover:bg-green-800/40 hover:border-green-400 dark:hover:border-green-500'
                }`}
                style={{
                  left: (clampedStart - SCHEDULER_START_HOUR) * hourWidth,
                  width: (clampedEnd - clampedStart) * hourWidth,
                }}
              >
                {/* Time label */}
                <span className={`absolute left-2 top-1 text-[10px] font-semibold ${
                  isResizing ? 'text-green-800 dark:text-green-200' : 'text-green-700/80 dark:text-green-400/60'
                }`}>
                  {formatHour(clampedStart)} – {formatHour(clampedEnd)}
                </span>

                {/* Delete button */}
                {onShiftDelete && !isResizing && (
                  <button
                    className="absolute right-1 top-1 text-[10px] font-bold text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 opacity-0 group-hover/shift:opacity-100 transition-opacity bg-white/90 dark:bg-black/50 rounded px-1.5 py-0.5"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete shift ${formatHour(clampedStart)} – ${formatHour(clampedEnd)}?`)) {
                        onShiftDelete(shift.id);
                      }
                    }}
                  >
                    ✕ Delete
                  </button>
                )}

                {/* Left resize handle — wide grab zone, visual indicator on hover */}
                <div
                  className="absolute -left-1 top-0 bottom-0 w-4 cursor-col-resize z-20 group/lhandle"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const { start, end } = parseShiftHours(shift);
                    const state: DragState = {
                      employeeId: empId, mode: 'resize-left', startHour: start, currentHour: start,
                      shiftId: shift.id, originalStart: start, originalEnd: end,
                    };
                    dragRef.current = state;
                    didDrag.current = false;
                    setDrag(state);
                  }}
                >
                  <div className="absolute left-1 top-1 bottom-1 w-1 rounded-full bg-green-500/0 group-hover/lhandle:bg-green-500/60 transition-colors" />
                </div>

                {/* Right resize handle — wide grab zone, visual indicator on hover */}
                <div
                  className="absolute -right-1 top-0 bottom-0 w-4 cursor-col-resize z-20 group/rhandle"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const { start, end } = parseShiftHours(shift);
                    const state: DragState = {
                      employeeId: empId, mode: 'resize-right', startHour: end - 1, currentHour: end - 1,
                      shiftId: shift.id, originalStart: start, originalEnd: end,
                    };
                    dragRef.current = state;
                    didDrag.current = false;
                    setDrag(state);
                  }}
                >
                  <div className="absolute right-1 top-1 bottom-1 w-1 rounded-full bg-green-500/0 group-hover/rhandle:bg-green-500/60 transition-colors" />
                </div>
              </div>
            );
          })}

          {/* New shift creation overlay (only during create drag) */}
          {createRange && (
            <div
              className="absolute top-1 bottom-1 rounded-lg border-2 border-dashed border-green-500 bg-green-400/20 dark:bg-green-500/20 pointer-events-none z-10 flex items-center justify-center"
              style={{
                left: (createRange.start - SCHEDULER_START_HOUR) * hourWidth + 2,
                width: (createRange.end - createRange.start + 1) * hourWidth - 4,
              }}
            >
              <span className="text-xs font-bold text-green-700 dark:text-green-300 bg-white/80 dark:bg-black/40 px-2 py-0.5 rounded">
                New: {formatHour(createRange.start)} – {formatHour(createRange.end + 1)}
              </span>
            </div>
          )}

          {/* Appointment blocks overlaid on top */}
          {empAppointments.map((appt) => (
            <AppointmentBlock
              key={appt.id}
              appointment={appt}
              onClick={onAppointmentClick}
              colorClass={colorClass}
              hourWidth={hourWidth}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className="overflow-x-auto"
      data-testid="staff-swimlane-view"
      onMouseLeave={handleMouseLeaveView}
      onMouseUp={handleMouseUp}
    >
      <TimeGrid hourWidth={hourWidth} />
      {employees.map((emp, empIdx) => {
        const empId = String(emp.id);
        const empAppointments = appointmentsByEmployee.get(empId) || [];
        const empShifts = shiftsByEmployee.get(empId) || [];
        const colorClass = getEmployeeColor(empId, empIdx);
        return (
          <React.Fragment key={empId}>
            {renderRow(empId, emp.name, empAppointments, empShifts, colorClass, false, () => onEmployeeClick?.(emp))}
          </React.Fragment>
        );
      })}

      {/* Unassigned row */}
      {(() => {
        const unassigned = appointmentsByEmployee.get('unassigned') || [];
        if (unassigned.length === 0) return null;
        return renderRow('unassigned', 'Unassigned', unassigned, [], 'bg-gray-400', true);
      })()}

      <style>{`
        .off-shift-hatching {
          background: repeating-linear-gradient(
            -45deg,
            transparent,
            transparent 4px,
            rgba(0,0,0,0.04) 4px,
            rgba(0,0,0,0.04) 8px
          );
        }
        @media (prefers-color-scheme: dark) {
          .off-shift-hatching {
            background: repeating-linear-gradient(
              -45deg,
              transparent,
              transparent 4px,
              rgba(255,255,255,0.04) 4px,
              rgba(255,255,255,0.04) 8px
            );
          }
        }
      `}</style>
    </div>
  );
};

function formatHour(h: number): string {
  if (h === 0 || h === 24) return '12am';
  if (h === 12) return '12pm';
  if (h < 12) return `${h}am`;
  return `${h - 12}pm`;
}
