import React from 'react';
import { Clock, AlertTriangle, User, Wrench } from 'lucide-react';
import { Badge } from '../ui/Badge';
import type { SchedulerAppointment } from './useSchedulerData';
import { formatTimeFromISO } from '../../lib/utils';

interface SchedulerEmployee { employee_id: string; name: string }
interface SchedulerResource { resource_id: string; name: string }

interface AppointmentListViewProps {
  appointments: SchedulerAppointment[];
  employees: SchedulerEmployee[];
  resources: SchedulerResource[];
  onAppointmentClick?: (appointment: SchedulerAppointment, e: React.MouseEvent) => void;
}


function getGapMinutes(endStr: string, startStr: string): number {
  return (new Date(startStr).getTime() - new Date(endStr).getTime()) / 60000;
}

export const AppointmentListView: React.FC<AppointmentListViewProps> = ({
  appointments,
  employees,
  resources,
  onAppointmentClick,
}) => {
  const sorted = [...appointments]
    .filter((a) => a.status !== 'canceled')
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-400 dark:text-gray-600 italic" data-testid="appointment-list-empty">
        <Clock className="w-10 h-10 mb-3 opacity-30" />
        No appointments scheduled for this day
      </div>
    );
  }

  const findEmployee = (id: string | null) => {
    if (!id) return null;
    return employees.find((e) => String(e.employee_id) === String(id));
  };

  const findResource = (id: string) => {
    return resources.find((r) => String(r.resource_id) === String(id));
  };

  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-800" data-testid="appointment-list-view">
      {sorted.map((appt, idx) => {
        const employee = findEmployee(appt.employee_id != null ? String(appt.employee_id) : null);
        const resource = findResource(appt.resource_id);

        // Check for gap before this appointment
        let gapWarning: React.ReactNode = null;
        if (idx > 0) {
          const prevEnd = sorted[idx - 1].end_time;
          const gap = getGapMinutes(prevEnd, appt.start_time);
          if (gap > 60) {
            gapWarning = (
              <div className="flex items-center gap-2 px-4 py-2 bg-yellow-50 dark:bg-yellow-950/20 text-yellow-700 dark:text-yellow-400 text-xs font-medium" data-testid={`gap-warning-${idx}`}>
                <AlertTriangle className="w-3.5 h-3.5" />
                {Math.round(gap / 60)}h {Math.round(gap % 60)}m gap
              </div>
            );
          }
        }

        return (
          <React.Fragment key={appt.appointment_id}>
            {gapWarning}
            <div
              role="button"
              tabIndex={0}
              className="flex items-center gap-4 p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900 transition focus-visible:ring-2 focus-visible:ring-inset"
              style={{ ['--tw-ring-color' as string]: 'var(--accent)' }}
              onClick={(e) => onAppointmentClick?.(appt, e)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAppointmentClick?.(appt, e as unknown as React.MouseEvent); } }}
              data-testid={`list-item-${appt.appointment_id}`}
            >
              {/* Time */}
              <div className="w-24 flex-shrink-0">
                <div className="text-sm font-bold text-gray-900 dark:text-gray-100">{formatTimeFromISO(appt.start_time)}</div>
                <div className="text-xs text-gray-400 dark:text-gray-500">{formatTimeFromISO(appt.end_time)}</div>
              </div>

              {/* Details */}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">
                  {appt.customers?.name || 'Unknown Customer'}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                  {appt.description}
                </div>
              </div>

              {/* Assignments */}
              <div className="flex items-center gap-3 flex-shrink-0">
                {employee && (
                  <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                    <User className="w-3.5 h-3.5" />
                    <span className="truncate max-w-[100px]" title={employee.name}>{employee.name}</span>
                  </div>
                )}
                {resource && (
                  <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                    <Wrench className="w-3.5 h-3.5" />
                    <span className="truncate max-w-[100px]" title={resource.name}>{resource.name}</span>
                  </div>
                )}
              </div>

              {/* Status */}
              {appt.status === 'completed' && <Badge variant="success">Done</Badge>}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
};
