import React, { useState, useCallback, useRef } from 'react';
import { TimeGrid, SCHEDULER_START_HOUR, SCHEDULER_END_HOUR, LABEL_WIDTH } from './TimeGrid';
import { AppointmentBlock, getEmployeeColor } from './AppointmentBlock';
import type { SchedulerAppointment } from './useSchedulerData';

interface StaffSwimLaneViewProps {
  employees: any[];
  appointmentsByEmployee: Map<string, SchedulerAppointment[]>;
  shiftsByEmployee: Map<string, any[]>;
  onAppointmentClick?: (appointment: SchedulerAppointment) => void;
  onSlotClick?: (employeeId: string, hour: number) => void;
  onSlotDrag?: (employeeId: string, startHour: number, endHour: number) => void;
  onShiftDrag?: (employeeId: string, startHour: number, endHour: number) => void;
  onEmployeeClick?: (employee: any) => void;
  hourWidth?: number;
}

function isOnShift(shifts: any[], hour: number): boolean {
  if (!shifts || shifts.length === 0) return false;
  for (const shift of shifts) {
    const startParts = shift.start_time?.split(':');
    const endParts = shift.end_time?.split(':');
    if (!startParts || !endParts) continue;
    const startH = parseInt(startParts[0], 10);
    const endH = parseInt(endParts[0], 10);
    if (hour >= startH && hour < endH) return true;
  }
  return false;
}

interface DragState {
  employeeId: string;
  startHour: number;
  currentHour: number;
  mode: 'appointment' | 'shift'; // what are we creating?
}

export const StaffSwimLaneView: React.FC<StaffSwimLaneViewProps> = ({
  employees,
  appointmentsByEmployee,
  shiftsByEmployee,
  onAppointmentClick,
  onSlotClick,
  onSlotDrag,
  onShiftDrag,
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

  const handleMouseDown = useCallback((employeeId: string, hour: number, onShift: boolean) => {
    const mode = onShift ? 'appointment' : 'shift';
    const state: DragState = { employeeId, startHour: hour, currentHour: hour, mode };
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
    const { employeeId, startHour, currentHour, mode } = dragRef.current;
    const minH = Math.min(startHour, currentHour);
    const maxH = Math.max(startHour, currentHour) + 1; // +1 because end is exclusive

    if (mode === 'shift') {
      // Creating a shift
      if (onShiftDrag) {
        onShiftDrag(employeeId, minH, maxH);
      }
    } else {
      // Creating an appointment
      if (didDrag.current && onSlotDrag) {
        onSlotDrag(employeeId, minH, maxH);
      } else if (onSlotClick) {
        onSlotClick(employeeId, startHour);
      }
    }

    dragRef.current = null;
    didDrag.current = false;
    setDrag(null);
  }, [onSlotClick, onSlotDrag, onShiftDrag]);

  const handleMouseLeaveView = useCallback(() => {
    if (dragRef.current) {
      dragRef.current = null;
      didDrag.current = false;
      setDrag(null);
    }
  }, []);

  function getDragRange(empId: string): { start: number; end: number; mode: 'appointment' | 'shift' } | null {
    if (!drag || drag.employeeId !== empId) return null;
    const minH = Math.min(drag.startHour, drag.currentHour);
    const maxH = Math.max(drag.startHour, drag.currentHour);
    return { start: minH, end: maxH, mode: drag.mode };
  }

  function renderRow(
    empId: string,
    empName: string,
    empAppointments: SchedulerAppointment[],
    empShifts: any[],
    colorClass: string,
    isUnassigned: boolean,
    onClick?: () => void
  ) {
    const isSelected = selectedLane === empId;
    const dragRange = getDragRange(empId);

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

        {/* Hour cells + appointment overlay */}
        <div className="relative flex" style={{ width: hourCount * hourWidth }}>
          {/* Hour cell backgrounds */}
          {hours.map((hour) => {
            const onShift = isUnassigned || isOnShift(empShifts, hour);
            const isDragSelected = dragRange && hour >= dragRange.start && hour <= dragRange.end;

            return (
              <div
                key={hour}
                className={`border-r border-gray-100 dark:border-gray-800 last:border-r-0 min-h-[48px] shrink-0 select-none ${
                  isDragSelected
                    ? dragRange?.mode === 'shift'
                      ? 'bg-green-200/60 dark:bg-green-700/30'
                      : 'bg-blue-200/60 dark:bg-blue-700/30'
                    : onShift
                    ? 'bg-white dark:bg-[#1a1a1a] cursor-crosshair hover:bg-blue-50/50 dark:hover:bg-blue-950/10'
                    : 'off-shift-hatching cursor-cell'
                }`}
                style={{ width: hourWidth }}
                onMouseDown={(e) => {
                  if (!isUnassigned) {
                    e.preventDefault();
                    handleMouseDown(empId, hour, onShift);
                  }
                }}
                onMouseEnter={() => {
                  if (!isUnassigned) {
                    handleMouseEnter(empId, hour);
                  }
                }}
                onMouseUp={() => {
                  if (!isUnassigned) {
                    handleMouseUp();
                  }
                }}
                data-testid={`slot-${empId}-${hour}`}
              />
            );
          })}

          {/* Drag selection overlay bar */}
          {dragRange && (
            <div
              className={`absolute top-1 bottom-1 rounded-lg border-2 pointer-events-none z-10 flex items-center justify-center ${
                dragRange.mode === 'shift'
                  ? 'border-green-500 bg-green-400/20 dark:bg-green-500/20'
                  : 'border-blue-500 bg-blue-400/20 dark:bg-blue-500/20'
              }`}
              style={{
                left: (dragRange.start - SCHEDULER_START_HOUR) * hourWidth + 2,
                width: (dragRange.end - dragRange.start + 1) * hourWidth - 4,
              }}
            >
              <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                dragRange.mode === 'shift'
                  ? 'text-green-700 dark:text-green-300 bg-white/80 dark:bg-black/40'
                  : 'text-blue-700 dark:text-blue-300 bg-white/80 dark:bg-black/40'
              }`}>
                {dragRange.mode === 'shift' ? 'Shift: ' : ''}{formatHour(dragRange.start)} – {formatHour(dragRange.end + 1)}
              </span>
            </div>
          )}

          {/* Appointment blocks overlaid */}
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
