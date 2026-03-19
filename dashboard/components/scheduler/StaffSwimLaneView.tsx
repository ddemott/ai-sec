import React from 'react';
import { TimeGrid, SCHEDULER_START_HOUR, SCHEDULER_END_HOUR, LABEL_WIDTH } from './TimeGrid';
import { AppointmentBlock, getEmployeeColor } from './AppointmentBlock';
import type { SchedulerAppointment } from './useSchedulerData';

interface StaffSwimLaneViewProps {
  employees: any[];
  appointmentsByEmployee: Map<string, SchedulerAppointment[]>;
  shiftsByEmployee: Map<string, any[]>;
  onAppointmentClick?: (appointment: SchedulerAppointment) => void;
  onSlotClick?: (employeeId: string, hour: number) => void;
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

export const StaffSwimLaneView: React.FC<StaffSwimLaneViewProps> = ({
  employees,
  appointmentsByEmployee,
  shiftsByEmployee,
  onAppointmentClick,
  onSlotClick,
  onEmployeeClick,
  hourWidth = 60,
}) => {
  const hourCount = SCHEDULER_END_HOUR - SCHEDULER_START_HOUR;
  const hours = Array.from({ length: hourCount }, (_, i) => SCHEDULER_START_HOUR + i);
  const totalWidth = LABEL_WIDTH + hourCount * hourWidth;

  function renderRow(empId: string, empName: string, empAppointments: SchedulerAppointment[], empShifts: any[], colorClass: string, isUnassigned: boolean, onClick?: () => void) {
    return (
      <div
        className="flex border-b border-gray-100 dark:border-gray-800"
        style={{ minWidth: totalWidth }}
        data-testid={`swimlane-row-${empId}`}
      >
        {/* Employee label */}
        <div
          className={`p-2 border-r border-gray-200 dark:border-gray-800 flex items-center gap-2 shrink-0 ${!isUnassigned ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900' : ''} transition`}
          style={{ width: LABEL_WIDTH }}
          onClick={onClick}
        >
          <div className={`w-3 h-3 rounded-full ${colorClass}`} />
          <span className={`text-sm font-bold truncate ${isUnassigned ? 'text-gray-500 dark:text-gray-400 italic' : 'text-gray-900 dark:text-gray-100'}`}>
            {empName}
          </span>
        </div>

        {/* Hour cells + appointment overlay */}
        <div className="relative flex" style={{ width: hourCount * hourWidth }}>
          {/* Hour cell backgrounds */}
          {hours.map((hour) => {
            const onShift = isUnassigned || isOnShift(empShifts, hour);
            return (
              <div
                key={hour}
                className={`border-r border-gray-100 dark:border-gray-800 last:border-r-0 min-h-[48px] shrink-0 ${
                  onShift
                    ? 'bg-white dark:bg-[#1a1a1a] cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-950/20'
                    : 'off-shift-hatching'
                }`}
                style={{ width: hourWidth }}
                onClick={() => onShift && !isUnassigned && onSlotClick?.(empId, hour)}
                data-testid={`slot-${empId}-${hour}`}
              />
            );
          })}

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
    <div className="overflow-x-auto" data-testid="staff-swimlane-view">
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
