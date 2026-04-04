import React, { useState, useCallback, useRef, useEffect } from 'react';
import { TimeGrid, SCHEDULER_START_HOUR, SCHEDULER_END_HOUR, LABEL_WIDTH } from './TimeGrid';
import { AppointmentBlock, getEmployeeColor } from './AppointmentBlock';
import type { SchedulerAppointment } from './useSchedulerData';
import { formatHour } from '../../lib/utils';

interface SwimLaneShift { id: string; start_time?: string; end_time?: string }
interface SwimLaneEmployee { id: string | number; name: string }

interface StaffSwimLaneViewProps {
  employees: SwimLaneEmployee[];
  appointmentsByEmployee: Map<string, SchedulerAppointment[]>;
  shiftsByEmployee: Map<string, SwimLaneShift[]>;
  onAppointmentClick?: (appointment: SchedulerAppointment) => void;
  onShiftDrag?: (employeeId: string, startHour: number, endHour: number) => void;
  onShiftDelete?: (shiftId: string) => void;
  onShiftResize?: (shiftId: string, startHour: number, endHour: number) => void;
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

type DragMode = 'create' | 'resize-left' | 'resize-right' | 'move';

interface DragState {
  employeeId: string;
  mode: DragMode;
  startHour: number;
  currentHour: number;
  shiftId?: string;
  originalStart?: number;
  originalEnd?: number;
  grabOffset?: number; // for move: which hour within the shift was grabbed
}

export const StaffSwimLaneView: React.FC<StaffSwimLaneViewProps> = ({
  employees,
  appointmentsByEmployee,
  shiftsByEmployee,
  onAppointmentClick,
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
  const containerRef = useRef<HTMLDivElement>(null);

  // Convert pixel X position to hour number
  const xToHour = useCallback((clientX: number): number => {
    if (!containerRef.current) return SCHEDULER_START_HOUR;
    const rect = containerRef.current.getBoundingClientRect();
    const scrollLeft = containerRef.current.scrollLeft;
    const x = clientX - rect.left + scrollLeft - LABEL_WIDTH;
    const hour = Math.floor(x / hourWidth) + SCHEDULER_START_HOUR;
    return Math.max(SCHEDULER_START_HOUR, Math.min(hour, SCHEDULER_END_HOUR - 1));
  }, [hourWidth]);

  // Global mousemove during drag — works even when mouse is over shift bars/handles
  useEffect(() => {
    if (!drag) return;

    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const hour = xToHour(e.clientX);
      if (hour !== dragRef.current.currentHour) {
        didDrag.current = true;
        const updated = { ...dragRef.current, currentHour: hour };
        dragRef.current = updated;
        setDrag(updated);
      }
    };

    const handleGlobalMouseUp = () => {
      if (!dragRef.current) return;
      finishDrag();
    };

    document.addEventListener('mousemove', handleGlobalMouseMove);
    document.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, xToHour]);

  const finishDrag = useCallback(() => {
    if (!dragRef.current) return;
    const d = dragRef.current;
    const minH = Math.min(d.startHour, d.currentHour);
    const maxH = Math.max(d.startHour, d.currentHour) + 1;

    if (d.mode === 'create') {
      if (onShiftDrag) onShiftDrag(d.employeeId, minH, maxH);
    } else if (d.mode === 'resize-left' && d.shiftId != null && d.originalEnd != null) {
      const newStart = Math.min(d.currentHour, d.originalEnd - 1);
      if (onShiftResize && newStart !== d.originalStart) {
        onShiftResize(d.shiftId, newStart, d.originalEnd);
      }
    } else if (d.mode === 'resize-right' && d.shiftId != null && d.originalStart != null) {
      const newEnd = Math.max(d.currentHour + 1, d.originalStart + 1);
      if (onShiftResize && newEnd !== d.originalEnd) {
        onShiftResize(d.shiftId, d.originalStart, newEnd);
      }
    } else if (d.mode === 'move' && d.shiftId != null && d.originalStart != null && d.originalEnd != null && d.grabOffset != null) {
      // Move: shift the entire block by the drag delta
      const duration = d.originalEnd - d.originalStart;
      const newStart = d.currentHour - d.grabOffset;
      const clampedStart = Math.max(SCHEDULER_START_HOUR, Math.min(newStart, SCHEDULER_END_HOUR - duration));
      const newEnd = clampedStart + duration;
      if (onShiftResize && (clampedStart !== d.originalStart || newEnd !== d.originalEnd)) {
        onShiftResize(d.shiftId, clampedStart, newEnd);
      }
    }

    dragRef.current = null;
    didDrag.current = false;
    setDrag(null);
  }, [onShiftDrag, onShiftResize]);

  const startDrag = useCallback((employeeId: string, hour: number, empShifts: SwimLaneShift[], mode?: DragMode, shift?: SwimLaneShift) => {
    let dragMode: DragMode = mode || 'create';
    let shiftId: string | undefined;
    let originalStart: number | undefined;
    let originalEnd: number | undefined;
    let grabOffset: number | undefined;

    if (shift && (dragMode === 'resize-left' || dragMode === 'resize-right' || dragMode === 'move')) {
      const { start, end } = parseShiftHours(shift);
      shiftId = shift.id;
      originalStart = start;
      originalEnd = end;
      if (dragMode === 'move') {
        grabOffset = hour - start; // how far into the shift the user grabbed
      }
    } else if (!mode) {
      // Auto-detect: empty space = create, inside shift = move
      const existingShift = findShiftAtHour(empShifts, hour);
      if (existingShift) {
        dragMode = 'move';
        const { start, end } = parseShiftHours(existingShift);
        shiftId = existingShift.id;
        originalStart = start;
        originalEnd = end;
        grabOffset = hour - start;
      } else {
        dragMode = 'create';
      }
    }

    const state: DragState = { employeeId, mode: dragMode, startHour: hour, currentHour: hour, shiftId, originalStart, originalEnd, grabOffset };
    dragRef.current = state;
    didDrag.current = false;
    setDrag(state);
    setSelectedLane(employeeId);
  }, []);

  // Compute visual shift during resize or move
  function getVisualShift(empId: string, shift: SwimLaneShift): { start: number; end: number } {
    const { start, end } = parseShiftHours(shift);
    if (!drag || drag.employeeId !== empId || drag.shiftId !== shift.id) return { start, end };
    if (drag.mode === 'resize-left') return { start: Math.min(drag.currentHour, end - 1), end };
    if (drag.mode === 'resize-right') return { start, end: Math.max(drag.currentHour + 1, start + 1) };
    if (drag.mode === 'move' && drag.grabOffset != null) {
      const duration = end - start;
      const newStart = drag.currentHour - drag.grabOffset;
      const clamped = Math.max(SCHEDULER_START_HOUR, Math.min(newStart, SCHEDULER_END_HOUR - duration));
      return { start: clamped, end: clamped + duration };
    }
    return { start, end };
  }

  // Create drag overlay
  function getCreateRange(empId: string): { start: number; end: number } | null {
    if (!drag || drag.employeeId !== empId || drag.mode !== 'create') return null;
    return { start: Math.min(drag.startHour, drag.currentHour), end: Math.max(drag.startHour, drag.currentHour) };
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
    const createRange = getCreateRange(empId);

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

        {/* Hour cells */}
        <div className="relative flex" style={{ width: hourCount * hourWidth }}>
          {hours.map((hour) => {
            const onShift = isUnassigned || isOnShift(empShifts, hour);
            const isCreateDrag = createRange && hour >= createRange.start && hour <= createRange.end;
            const isDragging = drag?.employeeId === empId;

            return (
              <div
                key={hour}
                className={`border-r border-gray-100 dark:border-gray-800 last:border-r-0 min-h-[48px] shrink-0 select-none ${
                  isCreateDrag
                    ? 'bg-green-200/60 dark:bg-green-700/30'
                    : onShift
                    ? 'bg-white dark:bg-[#1a1a1a]'
                    : 'off-shift-hatching'
                } ${!isUnassigned && !isDragging ? (onShift ? 'hover:bg-blue-50/50 dark:hover:bg-blue-950/10 cursor-crosshair' : 'cursor-cell') : ''}`}
                style={{ width: hourWidth }}
                onMouseDown={(e) => {
                  if (!isUnassigned) {
                    e.preventDefault();
                    startDrag(empId, hour, empShifts);
                  }
                }}
                data-testid={`slot-${empId}-${hour}`}
              />
            );
          })}

          {/* Shift blocks */}
          {!isUnassigned && empShifts.map((shift, idx) => {
            const vis = getVisualShift(empId, shift);
            if (vis.end <= SCHEDULER_START_HOUR || vis.start >= SCHEDULER_END_HOUR) return null;
            const cs = Math.max(vis.start, SCHEDULER_START_HOUR);
            const ce = Math.min(vis.end, SCHEDULER_END_HOUR);
            const isDragging = drag?.shiftId === shift.id;
            const isMoving = isDragging && drag?.mode === 'move';

            return (
              <div
                key={`shift-${idx}`}
                className={`absolute top-0.5 bottom-0.5 rounded border z-[2] group/shift transition-colors ${
                  isMoving
                    ? 'bg-green-300/90 dark:bg-green-600/60 border-green-500 dark:border-green-400 shadow-lg cursor-grabbing'
                    : isDragging
                    ? 'bg-green-300/80 dark:bg-green-700/50 border-green-500 dark:border-green-400 shadow-md'
                    : 'bg-green-100/70 dark:bg-green-900/30 border-green-300/60 dark:border-green-700/40 hover:bg-green-200/80 dark:hover:bg-green-800/40 hover:border-green-400 dark:hover:border-green-500 cursor-grab'
                }`}
                style={{
                  left: (cs - SCHEDULER_START_HOUR) * hourWidth,
                  width: (ce - cs) * hourWidth,
                  pointerEvents: isDragging ? 'none' : 'auto',
                }}
                onMouseDown={(e) => {
                  // Click inside shift = move the shift
                  e.preventDefault();
                  e.stopPropagation();
                  const hour = xToHour(e.clientX);
                  startDrag(empId, hour, empShifts, 'move', shift);
                }}
              >
                {/* Time label */}
                <span className={`absolute left-2 top-1 text-[10px] font-semibold pointer-events-none ${
                  isDragging ? 'text-green-800 dark:text-green-200' : 'text-green-700/80 dark:text-green-400/60'
                }`}>
                  {formatHour(cs)} – {formatHour(ce)}
                </span>

                {/* Delete button */}
                {onShiftDelete && !isDragging && (
                  <button
                    className="absolute right-1 top-1 text-[10px] font-bold text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 opacity-0 group-hover/shift:opacity-100 transition-opacity bg-white/90 dark:bg-black/50 rounded px-1.5 py-0.5 z-20"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      if (confirm(`Delete shift ${formatHour(cs)} – ${formatHour(ce)}?`)) {
                        onShiftDelete(shift.id);
                      }
                    }}
                  >
                    ✕ Delete
                  </button>
                )}

                {/* Left resize handle */}
                <div
                  className="absolute -left-2 top-0 bottom-0 w-5 cursor-col-resize z-10 group/lh"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    startDrag(empId, vis.start, empShifts, 'resize-left', shift);
                  }}
                >
                  <div className="absolute left-2 top-1 bottom-1 w-1 rounded-full bg-green-500/0 group-hover/lh:bg-green-500/70 transition-colors" />
                </div>

                {/* Right resize handle */}
                <div
                  className="absolute -right-2 top-0 bottom-0 w-5 cursor-col-resize z-10 group/rh"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    startDrag(empId, vis.end - 1, empShifts, 'resize-right', shift);
                  }}
                >
                  <div className="absolute right-2 top-1 bottom-1 w-1 rounded-full bg-green-500/0 group-hover/rh:bg-green-500/70 transition-colors" />
                </div>
              </div>
            );
          })}

          {/* New shift creation overlay */}
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

          {/* Appointment blocks */}
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
      ref={containerRef}
      className="overflow-x-auto"
      data-testid="staff-swimlane-view"
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

