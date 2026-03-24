import React from 'react';
import type { SchedulerAppointment } from './useSchedulerData';
import { SCHEDULER_START_HOUR, SCHEDULER_END_HOUR } from './TimeGrid';

interface AppointmentBlockProps {
  appointment: SchedulerAppointment;
  onClick?: (appointment: SchedulerAppointment) => void;
  colorClass?: string;
  hourWidth?: number;
}

const employeeColors = [
  'bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-amber-500',
  'bg-rose-500', 'bg-cyan-500', 'bg-fuchsia-500', 'bg-lime-500',
];

export function getEmployeeColor(employeeId: string | null, index?: number): string {
  if (!employeeId) return 'bg-gray-400';
  const idx = index ?? Math.abs(hashString(employeeId)) % employeeColors.length;
  return employeeColors[idx % employeeColors.length];
}

function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
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

export function getTimeSpan(startStr: string, endStr: string, startHour: number, endHour: number): { left: number; width: number } {
  const left = getTimePosition(startStr, startHour, endHour);
  const right = getTimePosition(endStr, startHour, endHour);
  return { left, width: Math.max(right - left, 0.02) }; // min 2% width
}

export const AppointmentBlock: React.FC<AppointmentBlockProps> = ({
  appointment,
  onClick,
  colorClass,
}) => {
  const { left, width } = getTimeSpan(
    appointment.start_time,
    appointment.end_time,
    SCHEDULER_START_HOUR,
    SCHEDULER_END_HOUR
  );
  const color = colorClass || getEmployeeColor(appointment.employee_id != null ? String(appointment.employee_id) : null);
  const customerName = appointment.customers?.name || 'Unknown';
  const isCanceled = appointment.status === 'canceled';

  return (
    <div
      className={`absolute top-1 bottom-1 rounded px-1.5 py-0.5 text-white text-xs font-bold truncate cursor-pointer hover:opacity-90 transition-opacity ${color} ${isCanceled ? 'opacity-40 line-through' : ''}`}
      style={{
        left: `${left * 100}%`,
        width: `${width * 100}%`,
      }}
      onClick={() => onClick?.(appointment)}
      title={`${customerName} — ${appointment.description}`}
      data-testid={`appointment-block-${appointment.id}`}
    >
      {customerName}
    </div>
  );
};
