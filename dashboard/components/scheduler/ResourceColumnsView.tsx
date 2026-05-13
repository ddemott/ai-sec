import React from 'react';
import { CoverageBar } from '../ui/CoverageBar';
import type { HourSlot } from '../ui/CoverageBar';
import { AppointmentBlock } from './AppointmentBlock';
import { SCHEDULER_START_HOUR, SCHEDULER_END_HOUR, LABEL_WIDTH, formatHourLabel } from './TimeGrid';
import type { SchedulerAppointment } from './useSchedulerData';

interface ResourceColumnsViewProps {
  resources: { resource_id: string; name: string }[];
  appointmentsByResource: Map<string, SchedulerAppointment[]>;
  shiftsByEmployee: Map<string, { start_time?: string; end_time?: string }[]>;
  employees: { employee_id: string; name: string }[];
  onAppointmentClick?: (appointment: SchedulerAppointment, e: React.MouseEvent) => void;
  hourWidth?: number;
}

function buildCoverageSlots(
  _resourceId: string,
  appointments: SchedulerAppointment[],
  startHour: number,
  endHour: number
): HourSlot[] {
  const slots: HourSlot[] = [];
  for (let h = startHour; h < endHour; h++) {
    const bookedInHour = appointments.filter((a) => {
      const startH = new Date(a.start_time).getHours();
      const endH = new Date(a.end_time).getHours() + (new Date(a.end_time).getMinutes() > 0 ? 1 : 0);
      return h >= startH && h < endH && a.status !== 'canceled';
    });
    slots.push({
      hour: h,
      status: bookedInHour.length > 0 ? 'covered' : 'gap',
    });
  }
  return slots;
}

export const ResourceColumnsView: React.FC<ResourceColumnsViewProps> = ({
  resources,
  appointmentsByResource,
  onAppointmentClick,
  hourWidth = 60,
}) => {
  if (resources.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 dark:text-gray-600 italic" data-testid="resource-columns-empty">
        No resources configured
      </div>
    );
  }

  const hourCount = SCHEDULER_END_HOUR - SCHEDULER_START_HOUR;
  const hours = Array.from({ length: hourCount }, (_, i) => SCHEDULER_START_HOUR + i);
  const totalWidth = LABEL_WIDTH + hourCount * hourWidth;

  return (
    <div className="overflow-x-auto" data-testid="resource-columns-view">
      {/* Hour axis header */}
      <div className="flex border-b border-gray-200 dark:border-gray-800" style={{ minWidth: totalWidth }}>
        <div
          className="p-2 text-xs font-bold text-gray-400 dark:text-gray-500 uppercase border-r border-gray-200 dark:border-gray-800 shrink-0"
          style={{ width: LABEL_WIDTH }}
        />
        {hours.map((h) => (
          <div
            key={h}
            className="p-2 text-xs font-bold text-gray-400 dark:text-gray-500 text-center border-r border-gray-100 dark:border-gray-800 last:border-r-0 shrink-0"
            style={{ width: hourWidth }}
          >
            {formatHourLabel(h)}
          </div>
        ))}
      </div>

      {resources.map((resource) => {
        const resId = String(resource.resource_id);
        const resAppointments = appointmentsByResource.get(resId) || [];
        const coverageSlots = buildCoverageSlots(resId, resAppointments, SCHEDULER_START_HOUR, SCHEDULER_END_HOUR);

        return (
          <div key={resId} className="border-b border-gray-100 dark:border-gray-800" style={{ minWidth: totalWidth }} data-testid={`resource-column-${resId}`}>
            <div className="flex">
              <div
                className="p-3 border-r border-gray-200 dark:border-gray-800 shrink-0"
                style={{ width: LABEL_WIDTH }}
              >
                <div className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{resource.name}</div>
                <CoverageBar slots={coverageSlots} height={16} showHourLabels={false} className="mt-2" />
              </div>
              <div className="relative min-h-[64px]" style={{ width: hourCount * hourWidth }}>
                {resAppointments.map((appt) => (
                  <AppointmentBlock key={appt.appointment_id} appointment={appt} onClick={onAppointmentClick} hourWidth={hourWidth} />
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
