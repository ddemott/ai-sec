import React from 'react';
import { TimeGrid, SCHEDULER_START_HOUR, SCHEDULER_END_HOUR } from './TimeGrid';
import { AppointmentBlock, getEmployeeColor } from './AppointmentBlock';
import type { SchedulerAppointment } from './useSchedulerData';

interface StaffSwimLaneViewProps {
  employees: any[];
  appointmentsByEmployee: Map<string, SchedulerAppointment[]>;
  shiftsByEmployee: Map<string, any[]>;
  onAppointmentClick?: (appointment: SchedulerAppointment) => void;
  onSlotClick?: (employeeId: string, hour: number) => void;
  onEmployeeClick?: (employee: any) => void;
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
}) => {
  const hourCount = SCHEDULER_END_HOUR - SCHEDULER_START_HOUR;
  const hours = Array.from({ length: hourCount }, (_, i) => SCHEDULER_START_HOUR + i);

  return (
    <div className="overflow-x-auto" data-testid="staff-swimlane-view">
      <TimeGrid />
      {employees.map((emp, empIdx) => {
        const empId = String(emp.id);
        const empAppointments = appointmentsByEmployee.get(empId) || [];
        const empShifts = shiftsByEmployee.get(empId) || [];
        const colorClass = getEmployeeColor(empId, empIdx);

        return (
          <div
            key={empId}
            className="grid border-b border-gray-100 dark:border-gray-800"
            style={{ gridTemplateColumns: `180px repeat(${hourCount}, 1fr)` }}
            data-testid={`swimlane-row-${empId}`}
          >
            {/* Employee label */}
            <div
              className="p-2 border-r border-gray-200 dark:border-gray-800 flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900 transition"
              onClick={() => onEmployeeClick?.(emp)}
            >
              <div className={`w-3 h-3 rounded-full ${colorClass}`} />
              <span className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">
                {emp.name}
              </span>
            </div>

            {/* Hour cells */}
            {hours.map((hour) => {
              const onShift = isOnShift(empShifts, hour);
              return (
                <div
                  key={hour}
                  className={`relative border-r border-gray-100 dark:border-gray-800 last:border-r-0 min-h-[48px] ${
                    onShift
                      ? 'bg-white dark:bg-[#1a1a1a] cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-950/20'
                      : 'off-shift-hatching'
                  }`}
                  onClick={() => onShift && onSlotClick?.(empId, hour)}
                  data-testid={`slot-${empId}-${hour}`}
                />
              );
            })}

            {/* Appointment overlay - positioned absolutely over the hour cells */}
            <div
              className="relative col-start-2 -mt-[48px] min-h-[48px] pointer-events-none"
              style={{ gridColumn: `2 / ${hourCount + 2}` }}
            >
              <div className="relative w-full h-full pointer-events-auto">
                {empAppointments.map((appt) => (
                  <AppointmentBlock
                    key={appt.id}
                    appointment={appt}
                    onClick={onAppointmentClick}
                    colorClass={colorClass}
                  />
                ))}
              </div>
            </div>
          </div>
        );
      })}

      {/* Unassigned row */}
      {(() => {
        const unassigned = appointmentsByEmployee.get('unassigned') || [];
        if (unassigned.length === 0) return null;
        return (
          <div
            className="grid border-b border-gray-100 dark:border-gray-800"
            style={{ gridTemplateColumns: `180px repeat(${hourCount}, 1fr)` }}
            data-testid="swimlane-row-unassigned"
          >
            <div className="p-2 border-r border-gray-200 dark:border-gray-800 flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-gray-400" />
              <span className="text-sm font-bold text-gray-500 dark:text-gray-400 italic">Unassigned</span>
            </div>
            {hours.map((hour) => (
              <div key={hour} className="relative border-r border-gray-100 dark:border-gray-800 last:border-r-0 min-h-[48px] bg-white dark:bg-[#1a1a1a]" />
            ))}
            <div
              className="relative col-start-2 -mt-[48px] min-h-[48px] pointer-events-none"
              style={{ gridColumn: `2 / ${hourCount + 2}` }}
            >
              <div className="relative w-full h-full pointer-events-auto">
                {unassigned.map((appt) => (
                  <AppointmentBlock key={appt.id} appointment={appt} onClick={onAppointmentClick} />
                ))}
              </div>
            </div>
          </div>
        );
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
