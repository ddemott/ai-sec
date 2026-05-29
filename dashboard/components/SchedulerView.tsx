import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Users, Columns3, List, Calendar, LayoutGrid, RefreshCw, Plus, ZoomIn, ZoomOut } from 'lucide-react';
import { Api } from '../lib/api';
import { useStaticData, useTenantTimezone } from '../lib/hooks';
import { useActiveTenantId } from '../lib/SessionContext';
import { useVocabulary } from '@/lib/VocabularyContext';
import { showToast } from './ui/Toast';
import { useSchedulerData } from './scheduler/useSchedulerData';
import type { SchedulerAppointment } from './scheduler/useSchedulerData';
import { SchedulerDateNav } from './scheduler/SchedulerDateNav';
import { ResourceColumnsView } from './scheduler/ResourceColumnsView';
import { AppointmentListView } from './scheduler/AppointmentListView';
import { QuickBookPanel } from './scheduler/QuickBookPanel';
import { EmployeeDayFocusPanel } from './scheduler/EmployeeDayFocusPanel';
import NewSchedulerView from './scheduler/NewSchedulerView';
import { AppointmentPopover } from './scheduler/AppointmentPopover';
import { Button } from './ui/Button';
import { ConfirmModal } from './ui/ConfirmModal';
import { useConfirm } from '../lib/useConfirm';
import AppointmentView from './AppointmentView';

export type SchedulerViewTab = 'day' | 'calendar';
type DayMode = 'staff' | 'resources' | 'list';

const VALID_VIEW_TABS: SchedulerViewTab[] = ['day', 'calendar'];
const VALID_DAY_MODES: DayMode[] = ['staff', 'resources', 'list'];

function resolveInitialView(): SchedulerViewTab {
  if (typeof window === 'undefined') return 'day';
  const raw = new URLSearchParams(window.location.search).get('subtab');
  if (raw && (VALID_VIEW_TABS as string[]).includes(raw)) return raw as SchedulerViewTab;
  return 'day';
}

function resolveInitialDayMode(): DayMode {
  if (typeof window === 'undefined') return 'staff';
  const raw = new URLSearchParams(window.location.search).get('daymode');
  if (raw && (VALID_DAY_MODES as string[]).includes(raw)) return raw as DayMode;
  return 'staff';
}

export default function SchedulerView() {
  const tenantId = useActiveTenantId();
  const vocab = useVocabulary();
  const tenantTimezone = useTenantTimezone();
  const [activeView, setActiveView] = useState<SchedulerViewTab>(resolveInitialView);
  const [dayMode, setDayMode] = useState<DayMode>(resolveInitialDayMode);

  const {
    customers,
    resources,
    employees: allStaff,
    services,
    refresh: refreshStaticData,
  } = useStaticData(tenantId);
  const employees = useMemo(() => allStaff.filter((e) => e.type !== 'user'), [allStaff]);

  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  // Zoom: px per hour for ResourceColumnsView only
  const ZOOM_LEVELS = [40, 60, 90, 120, 180];
  const [zoomIndex, setZoomIndex] = useState(1);
  const hourWidth = ZOOM_LEVELS[zoomIndex];

  // QuickBook panel state
  const [quickBookOpen, setQuickBookOpen] = useState(false);
  const [quickBookPrefill, setQuickBookPrefill] = useState<{
    employeeId?: string;
    resourceId?: string;
    hour?: number;
    endHour?: number;
    date?: Date;
  }>({});

  // Employee focus panel state
  const [focusEmployee, setFocusEmployee] = useState<{ employee_id: string; name: string } | null>(
    null
  );

  const {
    appointments,
    loading,
    appointmentsByEmployee,
    appointmentsByResource,
    shiftsByEmployee,
    refresh: refreshScheduler,
  } = useSchedulerData(tenantId, selectedDate, employees, resources);

  const handleRefresh = useCallback(() => {
    void refreshScheduler();
    void refreshStaticData();
  }, [refreshScheduler, refreshStaticData]);

  const [apptPopover, setApptPopover] = useState<{
    appointment: SchedulerAppointment;
    anchorRect: DOMRect;
  } | null>(null);

  const { state: confirmState, confirm: confirmAction, close: closeConfirm } = useConfirm();

  const [pendingEditAppointmentId, setPendingEditAppointmentId] = useState<string | null>(null);

  const handleAppointmentClick = useCallback((appt: SchedulerAppointment, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setApptPopover((prev) =>
      prev?.appointment.appointment_id === appt.appointment_id
        ? null
        : { appointment: appt, anchorRect: rect }
    );
  }, []);

  const handlePopoverEdit = useCallback((appointmentId: string) => {
    setPendingEditAppointmentId(appointmentId);
    setActiveView('calendar');
    setApptPopover(null);
  }, []);

  const undoCancel = useCallback(
    async (appointmentId: string) => {
      if (!tenantId) return;
      try {
        const res = await Api.appointments.reactivate(appointmentId, tenantId);
        if (res.success) {
          showToast('Appointment restored', 'success');
          void refreshScheduler();
          void refreshStaticData();
        } else if (res.error_code === 'TIMESLOT_OCCUPIED') {
          showToast(
            'That time slot is no longer available. Book a new appointment instead.',
            'error'
          );
        } else {
          showToast(res.error || 'Could not restore appointment', 'error');
        }
      } catch {
        showToast('Connection error — could not restore appointment', 'error');
      }
    },
    [tenantId, refreshScheduler, refreshStaticData]
  );

  const handlePopoverCancel = useCallback(
    (appointmentId: string) => {
      if (!tenantId) return;
      confirmAction({
        title: 'Cancel appointment?',
        message:
          'The slot will free up, but the record stays for history. You can restore it later from Customers.',
        confirmLabel: 'Cancel appointment',
        confirmVariant: 'danger',
        onConfirm: async () => {
          closeConfirm();
          try {
            const res = await Api.appointments.cancel(appointmentId, tenantId);
            if (res.success) {
              showToast('Appointment canceled', 'success', {
                label: 'Undo',
                onClick: () => {
                  void undoCancel(appointmentId);
                },
              });
              setApptPopover(null);
              void refreshScheduler();
              void refreshStaticData();
            } else {
              showToast(res.error || 'Failed to cancel appointment', 'error');
            }
          } catch {
            showToast('Connection error — could not cancel appointment', 'error');
          }
        },
      });
    },
    [tenantId, refreshScheduler, refreshStaticData, confirmAction, closeConfirm, undoCancel]
  );

  const handleQuickBooked = useCallback(() => {
    void refreshScheduler();
  }, [refreshScheduler]);

  const handleAppointmentDelete = useCallback(
    (appointmentId: string) => {
      if (!tenantId) return;
      confirmAction({
        title: 'Cancel appointment?',
        message:
          'The slot will free up, but the record stays for history. You can restore it later from Customers.',
        confirmLabel: 'Cancel appointment',
        confirmVariant: 'danger',
        onConfirm: async () => {
          closeConfirm();
          try {
            const res = await Api.appointments.cancel(appointmentId, tenantId);
            if (res.success) {
              showToast('Appointment canceled', 'success', {
                label: 'Undo',
                onClick: () => {
                  void undoCancel(appointmentId);
                },
              });
              void refreshScheduler();
            } else {
              showToast(res.error || 'Failed to cancel appointment', 'error');
            }
          } catch {
            showToast('Connection error — could not cancel appointment', 'error');
          }
        },
      });
    },
    [tenantId, refreshScheduler, confirmAction, closeConfirm, undoCancel]
  );

  const handleAppointmentMove = useCallback(
    async (appointmentId: string, deltaMinutes: number) => {
      if (!tenantId || deltaMinutes === 0) return;
      const appt = appointments.find((a) => a.appointment_id === appointmentId);
      if (!appt) return;
      const newStart = new Date(
        new Date(appt.start_time).getTime() + deltaMinutes * 60_000
      ).toISOString();
      const newEnd = new Date(
        new Date(appt.end_time).getTime() + deltaMinutes * 60_000
      ).toISOString();
      try {
        const res = await Api.appointments.update(appointmentId, tenantId, {
          start_time: newStart,
          end_time: newEnd,
        });
        if (res.success) {
          showToast(
            `Moved to ${new Date(newStart).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`,
            'success'
          );
          void refreshScheduler();
        } else {
          showToast(res.error || 'Could not move appointment', 'error');
          void refreshScheduler();
        }
      } catch {
        showToast('Connection error — appointment not moved', 'error');
        void refreshScheduler();
      }
    },
    [tenantId, appointments, refreshScheduler]
  );

  const handleNewQuickBook = useCallback(
    (prefill?: {
      employeeId?: string;
      resourceId?: string;
      hour?: number;
      endHour?: number;
      date?: Date;
    }) => {
      setQuickBookPrefill({ date: selectedDate, ...prefill });
      setQuickBookOpen(true);
    },
    [selectedDate]
  );

  // Sync activeView + dayMode to ?subtab=…&daymode=… (replaceState — no history clutter)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    let changed = false;
    if (params.get('subtab') !== activeView) {
      params.set('subtab', activeView);
      changed = true;
    }
    if (activeView === 'day') {
      if (params.get('daymode') !== dayMode) {
        params.set('daymode', dayMode);
        changed = true;
      }
    } else if (params.has('daymode')) {
      params.delete('daymode');
      changed = true;
    }
    if (changed) {
      window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
    }
  }, [activeView, dayMode]);

  // Restore view + day-mode from URL on browser back/forward
  useEffect(() => {
    function onPopState() {
      const nextView = resolveInitialView();
      const nextMode = resolveInitialDayMode();
      setActiveView((prev) => (prev === nextView ? prev : nextView));
      setDayMode((prev) => (prev === nextMode ? prev : nextMode));
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Tab button style helpers
  const tabActive = {
    backgroundColor: 'var(--accent)',
    color: 'var(--primary-text)',
  };
  const tabInactive = undefined;
  const tabCls = (active: boolean) =>
    `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition ${
      active ? '' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
    }`;

  const dayModeCls = (active: boolean) =>
    `flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold transition ${
      active ? '' : 'text-gray-500 dark:text-gray-400 hover:brightness-110'
    }`;

  return (
    <div className="flex flex-col flex-1 overflow-hidden" data-testid="scheduler-view">
      {/* Unified header — single bar for all views */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111] flex items-center justify-between gap-3 flex-wrap">
        {/* Left: top-level view tabs */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveView('day')}
            className={tabCls(activeView === 'day')}
            style={activeView === 'day' ? tabActive : tabInactive}
            data-testid="view-tab-day"
          >
            <LayoutGrid className="w-4 h-4" />
            Day
          </button>
          <button
            onClick={() => setActiveView('calendar')}
            className={tabCls(activeView === 'calendar')}
            style={activeView === 'calendar' ? tabActive : tabInactive}
            data-testid="view-tab-calendar"
          >
            <Calendar className="w-4 h-4" />
            Calendar
          </button>
        </div>

        {/* Right: context-sensitive controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Day: date navigator */}
          {activeView === 'day' && (
            <SchedulerDateNav
              selectedDate={selectedDate}
              onDateChange={setSelectedDate}
              tenantTimezone={tenantTimezone}
            />
          )}

          {/* Day: sub-mode segmented control */}
          {activeView === 'day' && (
            <div
              className="flex items-center rounded-lg overflow-hidden"
              style={{ border: '1px solid var(--border-soft)' }}
              role="group"
              aria-label="Day view mode"
            >
              <button
                onClick={() => setDayMode('staff')}
                className={dayModeCls(dayMode === 'staff')}
                style={dayMode === 'staff' ? tabActive : tabInactive}
                data-testid="day-mode-staff"
              >
                <Users className="w-4 h-4" />
                <span className="hidden sm:inline">{vocab.employee_plural}</span>
              </button>
              <button
                onClick={() => setDayMode('resources')}
                className={dayModeCls(dayMode === 'resources')}
                style={dayMode === 'resources' ? tabActive : tabInactive}
                data-testid="day-mode-resources"
              >
                <Columns3 className="w-4 h-4" />
                <span className="hidden sm:inline">{vocab.resource_plural}</span>
              </button>
              <button
                onClick={() => setDayMode('list')}
                className={dayModeCls(dayMode === 'list')}
                style={dayMode === 'list' ? tabActive : tabInactive}
                data-testid="day-mode-list"
              >
                <List className="w-4 h-4" />
                <span className="hidden sm:inline">List</span>
              </button>
            </div>
          )}

          {/* Day + resources: column zoom */}
          {activeView === 'day' && dayMode === 'resources' && (
            <div
              className="flex items-center gap-1 border rounded-lg overflow-hidden"
              style={{ borderColor: 'var(--border-soft)' }}
              role="group"
              aria-label={`Scheduler zoom · level ${zoomIndex + 1} of ${ZOOM_LEVELS.length} · ${hourWidth} pixels per hour`}
            >
              <button
                onClick={() => setZoomIndex((i) => Math.max(i - 1, 0))}
                disabled={zoomIndex <= 0}
                className="p-1.5 hover:brightness-110 disabled:opacity-30 transition-colors"
                title="Zoom out"
                aria-label="Zoom out"
                style={{ color: 'var(--text-secondary)' }}
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span
                className="text-xs font-bold tabular-nums px-1 select-none whitespace-nowrap"
                style={{ color: 'var(--text-muted)' }}
                aria-hidden="true"
              >
                {zoomIndex + 1}/{ZOOM_LEVELS.length}
              </span>
              <button
                onClick={() => setZoomIndex((i) => Math.min(i + 1, ZOOM_LEVELS.length - 1))}
                disabled={zoomIndex >= ZOOM_LEVELS.length - 1}
                className="p-1.5 hover:brightness-110 disabled:opacity-30 transition-colors"
                title="Zoom in"
                aria-label="Zoom in"
                style={{ color: 'var(--text-secondary)' }}
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <Button variant="ghost" size="sm" onClick={handleRefresh} aria-label="Refresh">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button size="sm" onClick={() => handleNewQuickBook()} data-testid="quick-book-trigger">
            <Plus className="w-4 h-4 mr-1" />
            Quick Book
          </Button>
        </div>
      </div>

      {/* View content */}
      <div
        className={
          activeView === 'day' && dayMode === 'staff'
            ? 'flex-1 flex overflow-hidden'
            : 'flex-1 overflow-auto bg-white dark:bg-[#111]'
        }
      >
        {activeView === 'calendar' && (
          <AppointmentView
            initialEditAppointmentId={pendingEditAppointmentId}
            onInitialEditConsumed={() => setPendingEditAppointmentId(null)}
            onSelectSlot={({ start, end }) => {
              const startHour = start.getHours();
              const endHour = end.getHours();
              handleNewQuickBook({
                date: start,
                hour: startHour,
                endHour: endHour > startHour ? endHour : startHour + 1,
              });
            }}
          />
        )}
        {activeView === 'day' && dayMode === 'staff' && (
          <NewSchedulerView
            selectedDate={selectedDate}
            onDateChange={setSelectedDate}
            onQuickBook={handleNewQuickBook}
          />
        )}
        {activeView === 'day' && dayMode === 'resources' && (
          <ResourceColumnsView
            resources={resources}
            appointmentsByResource={appointmentsByResource}
            shiftsByEmployee={shiftsByEmployee}
            employees={employees}
            onAppointmentClick={handleAppointmentClick}
            onAppointmentDelete={handleAppointmentDelete}
            onAppointmentMove={handleAppointmentMove}
            hourWidth={hourWidth}
          />
        )}
        {activeView === 'day' && dayMode === 'list' && (
          <AppointmentListView
            appointments={appointments}
            employees={employees}
            resources={resources}
            onAppointmentClick={handleAppointmentClick}
          />
        )}
      </div>

      {/* Panels — rendered for every view so Quick Book reachable everywhere */}
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
        appointments={
          focusEmployee ? appointmentsByEmployee.get(String(focusEmployee.employee_id)) || [] : []
        }
        shifts={focusEmployee ? shiftsByEmployee.get(String(focusEmployee.employee_id)) || [] : []}
        onAppointmentClick={handleAppointmentClick}
      />

      {apptPopover && (
        <AppointmentPopover
          appointment={apptPopover.appointment}
          employeeName={
            apptPopover.appointment.employee_id
              ? employees.find(
                  (e) => String(e.employee_id) === String(apptPopover.appointment.employee_id)
                )?.name || null
              : null
          }
          resourceName={apptPopover.appointment.resources?.name || null}
          anchorRect={apptPopover.anchorRect}
          onClose={() => setApptPopover(null)}
          onEdit={handlePopoverEdit}
          onCancel={handlePopoverCancel}
        />
      )}

      <ConfirmModal {...confirmState} onClose={closeConfirm} />
    </div>
  );
}
