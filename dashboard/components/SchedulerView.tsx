import React, { useState, useCallback } from 'react';
import { Users, Columns3, List, Calendar, RefreshCw, Plus } from 'lucide-react';
import { useSession, useStaticData } from '../lib/hooks';
import { useSchedulerData } from './scheduler/useSchedulerData';
import type { SchedulerAppointment } from './scheduler/useSchedulerData';
import { SchedulerDateNav } from './scheduler/SchedulerDateNav';
import { StaffSwimLaneView } from './scheduler/StaffSwimLaneView';
import { ResourceColumnsView } from './scheduler/ResourceColumnsView';
import { AppointmentListView } from './scheduler/AppointmentListView';
import { QuickBookPanel } from './scheduler/QuickBookPanel';
import { EmployeeDayFocusPanel } from './scheduler/EmployeeDayFocusPanel';
import { Button } from './ui/Button';
import AppointmentView from './AppointmentView';

export type SchedulerViewTab = 'staff' | 'resources' | 'list' | 'calendar';

interface SchedulerViewProps {
  overrideTenantId?: string | null;
}

const viewTabs: { key: SchedulerViewTab; label: string; icon: React.ElementType }[] = [
  { key: 'staff', label: 'Staff', icon: Users },
  { key: 'resources', label: 'Resources', icon: Columns3 },
  { key: 'list', label: 'List', icon: List },
  { key: 'calendar', label: 'Calendar', icon: Calendar },
];

export default function SchedulerView({ overrideTenantId }: SchedulerViewProps) {
  const { tenantId } = useSession(overrideTenantId);
  const { customers, resources, employees, services, refresh: refreshStaticData } = useStaticData(tenantId);

  const [activeView, setActiveView] = useState<SchedulerViewTab>('staff');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  // QuickBook panel state
  const [quickBookOpen, setQuickBookOpen] = useState(false);
  const [quickBookPrefill, setQuickBookPrefill] = useState<{
    employeeId?: string;
    resourceId?: string;
    hour?: number;
    date?: Date;
  }>({});

  // Employee focus panel state
  const [focusEmployee, setFocusEmployee] = useState<any | null>(null);

  const {
    appointments,
    loading,
    appointmentsByEmployee,
    appointmentsByResource,
    shiftsByEmployee,
    refresh: refreshScheduler,
  } = useSchedulerData(tenantId, selectedDate, employees, resources);

  const handleRefresh = useCallback(() => {
    refreshScheduler();
    refreshStaticData();
  }, [refreshScheduler, refreshStaticData]);

  const handleSlotClick = useCallback((employeeId: string, hour: number) => {
    setQuickBookPrefill({ employeeId, hour, date: selectedDate });
    setQuickBookOpen(true);
  }, [selectedDate]);

  const handleEmployeeClick = useCallback((employee: any) => {
    setFocusEmployee(employee);
  }, []);

  const handleAppointmentClick = useCallback((_appt: SchedulerAppointment) => {
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
        <AppointmentView overrideTenantId={overrideTenantId} />
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
        {activeView === 'staff' && (
          <StaffSwimLaneView
            employees={employees}
            appointmentsByEmployee={appointmentsByEmployee}
            shiftsByEmployee={shiftsByEmployee}
            onAppointmentClick={handleAppointmentClick}
            onSlotClick={handleSlotClick}
            onEmployeeClick={handleEmployeeClick}
          />
        )}
        {activeView === 'resources' && (
          <ResourceColumnsView
            resources={resources}
            appointmentsByResource={appointmentsByResource}
            shiftsByEmployee={shiftsByEmployee}
            employees={employees}
            onAppointmentClick={handleAppointmentClick}
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
