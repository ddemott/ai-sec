import React from 'react';
import { X, Clock, User } from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { shiftTimeToHour } from '../../lib/utils';
import type { SchedulerAppointment } from './useSchedulerData';
import { formatTime24to12, formatTimeFromISO } from '../../lib/utils';

interface FocusShift {
  start_time?: string;
  end_time?: string;
}

interface EmployeeDayFocusPanelProps {
  isOpen: boolean;
  onClose: () => void;
  employee: { employee_id: string; name: string } | null;
  appointments: SchedulerAppointment[];
  shifts: FocusShift[];
  onAppointmentClick?: (appointment: SchedulerAppointment, e: React.MouseEvent) => void;
}

export const EmployeeDayFocusPanel: React.FC<EmployeeDayFocusPanelProps> = ({
  isOpen,
  onClose,
  employee,
  appointments,
  shifts,
  onAppointmentClick,
}) => {
  if (!isOpen || !employee) return null;

  const sorted = [...appointments]
    .filter((a) => a.status !== 'canceled')
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

  // Calculate utilization
  const totalBooked = sorted.reduce((sum, a) => {
    return sum + (new Date(a.end_time).getTime() - new Date(a.start_time).getTime());
  }, 0);
  const totalBookedHours = totalBooked / 3600000;

  const totalShiftHours = shifts.reduce((sum, s) => {
    if (!s.start_time || !s.end_time) return sum;
    return sum + (shiftTimeToHour(s.end_time) - shiftTimeToHour(s.start_time));
  }, 0);

  const utilization =
    totalShiftHours > 0 ? Math.round((totalBookedHours / totalShiftHours) * 100) : 0;

  return (
    <div
      className="fixed inset-y-0 right-0 w-96 bg-white dark:bg-[#1a1a1a] shadow-2xl border-l border-gray-200 dark:border-gray-800 z-30 flex flex-col animate-in slide-in-from-right duration-200"
      data-testid="employee-day-focus-panel"
    >
      <header className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <User className="w-4 h-4" style={{ color: 'var(--accent-soft)' }} />
          <h3 className="font-bold text-gray-900 dark:text-gray-100">{employee.name}</h3>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close focus panel">
          <X className="w-4 h-4" />
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {/* Stats */}
        <div className="p-4 border-b border-gray-100 dark:border-gray-800">
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <div className="text-2xl font-display" data-testid="focus-appointment-count">
                {sorted.length}
              </div>
              <div className="text-xs text-gray-400 dark:text-gray-500 uppercase font-bold">
                Appointments
              </div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-display" data-testid="focus-booked-hours">
                {totalBookedHours.toFixed(1)}h
              </div>
              <div className="text-xs text-gray-400 dark:text-gray-500 uppercase font-bold">
                Booked
              </div>
            </div>
            <div className="text-center">
              <div
                className={`text-2xl font-bold ${utilization >= 80 ? 'text-green-600 dark:text-green-400' : utilization >= 50 ? 'text-yellow-600 dark:text-yellow-400' : 'text-gray-500'}`}
                data-testid="focus-utilization"
              >
                {utilization}%
              </div>
              <div className="text-xs text-gray-400 dark:text-gray-500 uppercase font-bold">
                Utilization
              </div>
            </div>
          </div>
        </div>

        {/* Shifts */}
        {shifts.length > 0 && (
          <div className="p-4 border-b border-gray-100 dark:border-gray-800">
            <h4 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase mb-2">
              Shifts
            </h4>
            <div className="space-y-1">
              {shifts.map((s, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300"
                >
                  <Clock className="w-3.5 h-3.5 text-gray-400" />
                  {formatTime24to12(s.start_time ?? '00:00')} —{' '}
                  {formatTime24to12(s.end_time ?? '00:00')}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Appointment timeline */}
        <div className="p-4">
          <h4 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase mb-3">
            Timeline
          </h4>
          {sorted.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 italic">No appointments today</p>
          ) : (
            <div className="space-y-2">
              {sorted.map((appt) => (
                <div
                  key={appt.appointment_id}
                  className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-[#222] cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                  onClick={(e) => onAppointmentClick?.(appt, e)}
                  data-testid={`focus-item-${appt.appointment_id}`}
                >
                  <div className="flex-shrink-0">
                    <div className="text-xs font-bold text-gray-900 dark:text-gray-100">
                      {formatTimeFromISO(appt.start_time)}
                    </div>
                    <div className="text-[10px] text-gray-400">
                      {formatTimeFromISO(appt.end_time)}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">
                      {appt.customers?.name || 'Unknown'}
                    </div>
                    <div className="text-xs text-gray-500 truncate">{appt.description}</div>
                  </div>
                  {appt.status === 'completed' && <Badge variant="success">Done</Badge>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
