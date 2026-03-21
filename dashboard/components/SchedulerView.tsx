import React, { useState, useCallback } from 'react';
import { Users, Columns3, List, Calendar, RefreshCw, Plus, ZoomIn, ZoomOut } from 'lucide-react';
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
import { Api } from '../lib/api';
import { showToast } from './ui/Toast';
import AppointmentView from './AppointmentView';

function formatHourLabel(hour: number): string {
  const h = hour % 12 || 12;
  const ampm = hour < 12 ? 'AM' : 'PM';
  return `${h}${ampm}`;
}

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
  } = useSchedulerData(tenantId, selectedDate, employees, resources);

  const handleRefresh = useCallback(() => {
    refreshScheduler();
    refreshStaticData();
  }, [refreshScheduler, refreshStaticData]);

  const handleSlotClick = useCallback((employeeId: string, hour: number) => {
    setQuickBookPrefill({ employeeId, hour, date: selectedDate });
    setQuickBookOpen(true);
  }, [selectedDate]);

  const handleSlotDrag = useCallback((employeeId: string, startHour: number, endHour: number) => {
    setQuickBookPrefill({ employeeId, hour: startHour, endHour, date: selectedDate });
    setQuickBookOpen(true);
  }, [selectedDate]);

  const handleShiftDrag = useCallback(async (employeeId: string, startHour: number, endHour: number) => {
    if (!tenantId) return;
    // Only create shifts for actual employees, not user accounts
    const emp = employees.find(e => String(e.id) === employeeId);
    if (emp && (emp as Record<string, unknown>).type === 'user') return;
    const dayOfWeek = selectedDate.getDay(); // 0=Sun..6=Sat
    const startTime = `${String(startHour).padStart(2, '0')}:00`;
    const endTime = `${String(endHour).padStart(2, '0')}:00`;
    try {
      // Delete existing shifts for this employee on this day (replace, don't stack)
      const existingShifts = shiftsByEmployee.get(String(employeeId)) || [];
      for (const existing of existingShifts) {
        if (existing.id) {
          await Api.shifts.delete(existing.id, tenantId);
        }
      }
      // Create the new shift
      await Api.shifts.create(tenantId, {
        employee_id: employeeId,
        day_of_week: dayOfWeek,
        start_time: startTime,
        end_time: endTime,
      });
      handleRefresh();
      showToast(`Shift saved: ${formatHourLabel(startHour)}–${formatHourLabel(endHour)}`);
    } catch (err) {
      console.error('Failed to create shift:', err);
      showToast('Failed to save shift', 'error');
    }
  }, [tenantId, selectedDate, handleRefresh, employees, shiftsByEmployee]);

  const handleShiftDelete = useCallback(async (shiftId: number) => {
    if (!tenantId) return;
    try {
      await Api.shifts.delete(shiftId, tenantId);
      handleRefresh();
      showToast('Shift deleted');
    } catch (err) {
      console.error('Failed to delete shift:', err);
      showToast('Failed to delete shift', 'error');
    }
  }, [tenantId, handleRefresh]);

  const handleEmployeeClick = useCallback((employee: { id: string | number; name: string }) => {
    setFocusEmployee(employee);
  }, []);

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
          {(activeView === 'staff' || activeView === 'resources') && (
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
        {activeView === 'staff' && (
          <StaffSwimLaneView
            employees={employees}
            appointmentsByEmployee={appointmentsByEmployee}
            shiftsByEmployee={shiftsByEmployee}
            onAppointmentClick={handleAppointmentClick}
            onSlotClick={handleSlotClick}
            onSlotDrag={handleSlotDrag}
            onShiftDrag={handleShiftDrag}
            onShiftDelete={handleShiftDelete}
            onEmployeeClick={handleEmployeeClick}
            hourWidth={hourWidth}
          />
        )}
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
