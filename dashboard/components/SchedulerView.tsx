import React, { useState, useCallback, useMemo } from 'react';
import { Users, Columns3, List, Calendar, RefreshCw, Plus, ZoomIn, ZoomOut } from 'lucide-react';
import { useStaticData } from '../lib/hooks'
import { useActiveTenantId } from '../lib/SessionContext';
import { useVocabulary } from '@/lib/VocabularyContext';
import { useSchedulerData } from './scheduler/useSchedulerData';
import type { SchedulerAppointment } from './scheduler/useSchedulerData';
import { SchedulerDateNav } from './scheduler/SchedulerDateNav';
import { ResourceColumnsView } from './scheduler/ResourceColumnsView';
import { AppointmentListView } from './scheduler/AppointmentListView';
import { QuickBookPanel } from './scheduler/QuickBookPanel';
import { EmployeeDayFocusPanel } from './scheduler/EmployeeDayFocusPanel';
import NewSchedulerView from './scheduler/NewSchedulerView';
import { Button } from './ui/Button';
import AppointmentView from './AppointmentView';

export type SchedulerViewTab = 'staff' | 'resources' | 'list' | 'calendar';

export default function SchedulerView() {
  const tenantId = useActiveTenantId();
  const vocab = useVocabulary();

  const viewTabs: { key: SchedulerViewTab; label: string; icon: React.ElementType }[] = [
    { key: 'staff', label: vocab.employee_plural, icon: Users },
    { key: 'resources', label: vocab.resource_plural, icon: Columns3 },
    { key: 'list', label: 'List', icon: List },
    { key: 'calendar', label: 'Calendar', icon: Calendar },
  ];
  const { customers, resources, employees: allStaff, services, shifts, refresh: refreshStaticData } = useStaticData(tenantId);
  // Only show actual employees in the scheduler, not user accounts (owners/admins)
  const employees = useMemo(() =>
    allStaff.filter(e => e.type !== 'user'),
    [allStaff]
  );

  const [activeView, setActiveView] = useState<SchedulerViewTab>('staff');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  // Zoom: column width in px per hour
  const ZOOM_LEVELS = [40, 60, 90, 120, 180];
  const [zoomIndex, setZoomIndex] = useState(1); // default 60px
  const hourWidth = ZOOM_LEVELS[zoomIndex];

  // QuickBook panel state
  const [quickBookOpen, setQuickBookOpen] = useState(false);
  const [quickBookPrefill, setQuickBookPrefill] = useState<{
    employeeId?: string;
    resourceId?: string;
    hour?: number;
    date?: Date;
  }>({});

  // Employee focus panel state
  const [focusEmployee, setFocusEmployee] = useState<{ id: string | number; name: string } | null>(null);

  const {
    appointments,
    loading,
    appointmentsByEmployee,
    appointmentsByResource,
    shiftsByEmployee,
    refresh: refreshScheduler,
  } = useSchedulerData(tenantId, selectedDate, employees, resources, shifts);

  const handleRefresh = useCallback(() => {
    refreshScheduler();
    refreshStaticData();
  }, [refreshScheduler, refreshStaticData]);

  const handleAppointmentClick = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (_appt: SchedulerAppointment) => {
      // For now, clicking an appointment in scheduler views is a no-op
      // The Calendar tab handles full appointment editing
    }, []);

  const handleQuickBooked = useCallback(() => {
    refreshScheduler();
  }, [refreshScheduler]);

  const handleNewQuickBook = useCallback(() => {
    setQuickBookPrefill({ date: selectedDate });
    setQuickBookOpen(true);
  }, [selectedDate]);

  // Show calendar tab as the existing AppointmentView
  if (activeView === 'calendar') {
    return (
      <div className="flex flex-col flex-1 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111] flex items-center justify-between">
          <div className="flex items-center gap-1">
            {viewTabs.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveView(key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition ${
                  activeView === key
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
                data-testid={`view-tab-${key}`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>
        </div>
        <AppointmentView />
      </div>
    );
  }

  // Staff tab: use the new redesigned scheduler
  if (activeView === 'staff') {
    return (
      <div className="flex flex-col flex-1 overflow-hidden" data-testid="scheduler-view">
        <NewSchedulerView />
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden" data-testid="scheduler-view">
      {/* Toolbar */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111] flex items-center justify-between gap-4 flex-wrap">
        {/* View switcher */}
        <div className="flex items-center gap-1">
          {viewTabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveView(key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition ${
                activeView === key
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
              data-testid={`view-tab-${key}`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Date nav + actions */}
        <div className="flex items-center gap-3">
          <SchedulerDateNav selectedDate={selectedDate} onDateChange={setSelectedDate} />
          {activeView === 'resources' && (
            <div className="flex items-center gap-1 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
              <button
                onClick={() => setZoomIndex(i => Math.max(i - 1, 0))}
                disabled={zoomIndex <= 0}
                className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 transition-colors"
                title="Zoom out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setZoomIndex(i => Math.min(i + 1, ZOOM_LEVELS.length - 1))}
                disabled={zoomIndex >= ZOOM_LEVELS.length - 1}
                className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 transition-colors"
                title="Zoom in"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <Button variant="ghost" size="sm" onClick={handleRefresh} aria-label="Refresh">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button size="sm" onClick={handleNewQuickBook}>
            <Plus className="w-4 h-4 mr-1" />
            Quick Book
          </Button>
        </div>
      </div>

      {/* View content */}
      <div className="flex-1 overflow-auto bg-white dark:bg-[#111]">
        {activeView === 'resources' && (
          <ResourceColumnsView
            resources={resources}
            appointmentsByResource={appointmentsByResource}
            shiftsByEmployee={shiftsByEmployee}
            employees={employees}
            onAppointmentClick={handleAppointmentClick}
            hourWidth={hourWidth}
          />
        )}
        {activeView === 'list' && (
          <AppointmentListView
            appointments={appointments}
            employees={employees}
            resources={resources}
            onAppointmentClick={handleAppointmentClick}
          />
        )}
      </div>

      {/* Panels */}
      <QuickBookPanel
        isOpen={quickBookOpen}
        onClose={() => setQuickBookOpen(false)}
        tenantId={tenantId}
        prefill={quickBookPrefill}
        customers={customers}
        employees={employees}
        resources={resources}
        services={services}
        onBooked={handleQuickBooked}
      />
      <EmployeeDayFocusPanel
        isOpen={!!focusEmployee}
        onClose={() => setFocusEmployee(null)}
        employee={focusEmployee}
        appointments={focusEmployee ? (appointmentsByEmployee.get(String(focusEmployee.id)) || []) : []}
        shifts={focusEmployee ? (shiftsByEmployee.get(String(focusEmployee.id)) || []) : []}
        onAppointmentClick={handleAppointmentClick}
      />
    </div>
  );
}
