import React from 'react';
import { Appointment } from '../lib/types';
import { Button } from './ui/Button';
import {
  RefreshCw,
  ChevronRight,
  Search,
  Plus
} from 'lucide-react';
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
    <section className={`w-full md:w-80 flex flex-col bg-gray-50 dark:bg-[#1a1a1a] border-r border-gray-200 dark:border-gray-800 ${showDetailOnMobile ? 'hidden md:flex' : 'flex'}`}>
      <header className="p-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1a1a1a] sticky top-0 z-10">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">{`${bookingLabel}s`}</h2>
          <div className="flex space-x-1">
              <Button onClick={onStartNew} size="sm" className="p-1.5">
                <Plus className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={onRefresh} className="p-1.5">
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
          </div>
        </div>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400 dark:text-gray-500" />
          <input type="text" placeholder="Search bookings..." className="w-full pl-9 pr-4 py-2 bg-gray-100 dark:bg-[#222] border-none rounded-md text-sm outline-none dark:text-gray-200" />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
        {usingMockData && (
          <div className="p-3 m-2 text-xs text-yellow-800 dark:text-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
            Showing sample data. Log in to see real appointments.
          </div>
        )}
        {appointments.map((apt) => (
          <div
            key={apt.id}
            onClick={() => onSelectAppointment(apt)}
            className={`p-4 border-b border-gray-100 dark:border-gray-800 cursor-pointer transition flex justify-between items-start
              ${selectedAppointment?.id === apt.id ? 'bg-white dark:bg-[#2a2a2a] border-l-4 border-l-blue-600 dark:border-l-blue-400 shadow-sm' : 'hover:bg-gray-100 dark:hover:bg-[#222]'}`}
          >
            <div>
              <p className={`text-sm font-semibold ${selectedAppointment?.id === apt.id ? 'text-blue-600 dark:text-blue-400' : 'text-gray-900 dark:text-gray-100'}`}>
                {apt.customers?.name || 'Unknown'}
              </p>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-tighter mt-1 truncate max-w-[180px]">
                {apt.description}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {(() => {
                  const { start } = getServiceBaseTimes(apt as Appointment)
                  return `${format(start, 'MMM d')} at ${format(start, 'p')}`
                })()}
              </p>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 mt-1" />
          </div>
        ))}
      </div>
    </section>
  );
}
