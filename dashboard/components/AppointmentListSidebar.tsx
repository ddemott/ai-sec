import React from 'react';
import { type Appointment } from '../lib/types';
import { Button } from './ui/Button';
import { RefreshCw, ChevronRight, Plus } from 'lucide-react';
import { format } from 'date-fns';

interface AppointmentListSidebarProps {
  appointments: Appointment[];
  selectedAppointment: Appointment | null;
  loading: boolean;
  usingMockData: boolean;
  showDetailOnMobile: boolean;
  bookingLabel: string;
  onSelectAppointment: (apt: Appointment) => void;
  onRefresh: () => void;
  onStartNew: () => void;
  getServiceBaseTimes: (appointment: Appointment) => { start: Date; end: Date };
}

export function AppointmentListSidebar({
  appointments,
  selectedAppointment,
  loading,
  usingMockData,
  showDetailOnMobile,
  bookingLabel,
  onSelectAppointment,
  onRefresh,
  onStartNew,
  getServiceBaseTimes,
}: AppointmentListSidebarProps) {
  return (
    <section
      className={`w-full md:w-80 flex flex-col ${showDetailOnMobile ? 'hidden md:flex' : 'flex'}`}
      style={{ backgroundColor: 'var(--bg-raised)', borderRight: '1px solid var(--border-soft)' }}
    >
      <header
        className="p-4 sticky top-0 z-10"
        style={{
          borderBottom: '1px solid var(--border-soft)',
          backgroundColor: 'var(--bg-surface)',
        }}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">{`${bookingLabel}s`}</h2>
          <div className="flex space-x-1">
            <Button
              onClick={onStartNew}
              size="sm"
              className="p-1.5"
              data-testid="new-appointment-btn"
            >
              <Plus className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={onRefresh} className="p-1.5">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
        {/* Search removed: was non-functional placeholder */}
      </header>

      <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
        {usingMockData && (
          <div className="p-3 m-2 text-xs text-yellow-800 dark:text-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
            Showing sample data. Log in to see real appointments.
          </div>
        )}
        {appointments.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <ChevronRight
              className="w-8 h-8 mb-3 opacity-20"
              style={{ color: 'var(--text-muted)' }}
            />
            <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
              No {bookingLabel.toLowerCase()}s
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              Book one to get started
            </p>
          </div>
        )}
        {appointments.map((apt) => (
          <div
            key={apt.appointment_id}
            onClick={() => onSelectAppointment(apt)}
            className={`p-4 cursor-pointer transition flex justify-between items-start
              ${selectedAppointment?.appointment_id === apt.appointment_id ? 'border-l-4 shadow-sm' : ''}`}
            style={{
              borderBottom: '1px solid var(--border-soft)',
              ...(selectedAppointment?.appointment_id === apt.appointment_id
                ? { backgroundColor: 'var(--bg-surface)', borderLeftColor: 'var(--accent)' }
                : {}),
            }}
          >
            <div>
              <p
                className="text-sm font-semibold"
                style={{
                  color:
                    selectedAppointment?.appointment_id === apt.appointment_id
                      ? 'var(--accent-soft)'
                      : 'var(--text-primary)',
                }}
              >
                {apt.customers?.name || 'Unknown'}
              </p>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-tighter mt-1 truncate max-w-[180px]">
                {apt.description}
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                {(() => {
                  const { start } = getServiceBaseTimes(apt);
                  return `${format(start, 'MMM d')} at ${format(start, 'p')}`;
                })()}
              </p>
            </div>
            <ChevronRight className="w-4 h-4 mt-1" style={{ color: 'var(--text-muted)' }} />
          </div>
        ))}
      </div>
    </section>
  );
}
