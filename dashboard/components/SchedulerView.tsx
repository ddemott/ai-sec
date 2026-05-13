import React, { useState, useCallback, useMemo } from 'react';
import { Users, Columns3, List, Calendar, RefreshCw, Plus, ZoomIn, ZoomOut } from 'lucide-react';
import { Api } from '../lib/api';
import { useStaticData, useTenantTimezone } from '../lib/hooks'
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
import AppointmentView from './AppointmentView';

export type SchedulerViewTab = 'staff' | 'resources' | 'list' | 'calendar';

export default function SchedulerView() {
  const tenantId = useActiveTenantId();
  const vocab = useVocabulary();
  const tenantTimezone = useTenantTimezone();

  const viewTabs: { key: SchedulerViewTab; label: string; icon: React.ElementType }[] = [
    { key: 'calendar', label: 'Calendar', icon: Calendar },
    { key: 'staff', label: vocab.employee_plural, icon: Users },
    { key: 'resources', label: vocab.resource_plural, icon: Columns3 },
    { key: 'list', label: 'List', icon: List },
  ];
  const { customers, resources, employees: allStaff, services, refresh: refreshStaticData } = useStaticData(tenantId);
  // Only show actual employees in the scheduler, not user accounts (owners/admins)
  const employees = useMemo(() =>
    allStaff.filter(e => e.type !== 'user'),
    [allStaff]
  );

  // Default sub-tab: Staff (front-desk audit P1 #5, 2026-05-07).
  // The Staff sub-tab is the daily-use surface for front-desk operators —
  // rows = staff, hours across, today highlighted, empty cells now click
  // through to Quick Book (P1 #4). Calendar stays available for month/week
  // overview and drag-and-drop, just no longer the landing.
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
    endHour?: number;
    date?: Date;
  }>({});

  // Employee focus panel state
  const [focusEmployee, setFocusEmployee] = useState<{ employee_id: string; name: string } | null>(null);

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

  const [apptPopover, setApptPopover] = useState<{ appointment: SchedulerAppointment; anchorRect: DOMRect } | null>(null);

  // When the popover's Edit button fires from a non-Calendar sub-tab, we
  // switch to Calendar AND ask AppointmentView to pre-select + edit this
  // appointment on its next render. Simpler than hoisting the
  // AppointmentDetailContext above SchedulerView.
  const [pendingEditAppointmentId, setPendingEditAppointmentId] = useState<string | null>(null);

  const handleAppointmentClick = useCallback(
    (appt: SchedulerAppointment, e: React.MouseEvent) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setApptPopover(prev =>
        prev?.appointment.appointment_id === appt.appointment_id ? null : { appointment: appt, anchorRect: rect }
      );
    }, []);

  // Edit-from-popover (any sub-tab → Calendar with the appointment in
  // edit mode). Closes the architectural gap where Resources / List /
  // Staff sub-tabs only opened a read-only popover and the operator had
  // to navigate to Calendar and click the appointment again.
  const handlePopoverEdit = useCallback((appointmentId: string) => {
    setPendingEditAppointmentId(appointmentId);
    setActiveView('calendar');
    setApptPopover(null);
  }, []);

  // Cancel-from-popover (any sub-tab). Soft-cancel via the existing
  // /appointments/:id/cancel endpoint — sets status='canceled' but keeps
  // the row, so a stale-list re-click can't 404 the way the old hard
  // DELETE would. Refreshes both the scheduler data and the static data
  // (employees / resources / services / customers) so any view shows
  // the canceled status immediately.
  const handlePopoverCancel = useCallback(async (appointmentId: string) => {
    if (!tenantId) return;
    if (!confirm('Cancel this appointment? The slot will free up but the record stays for history.')) return;
    try {
      const res = await Api.appointments.cancel(appointmentId, tenantId);
      if (res.success) {
        showToast('Appointment canceled', 'success');
        setApptPopover(null);
        refreshScheduler();
        refreshStaticData();
      } else {
        showToast(res.error || 'Failed to cancel appointment', 'error');
      }
    } catch {
      showToast('Connection error — could not cancel appointment', 'error');
    }
  }, [tenantId, refreshScheduler, refreshStaticData]);

  const handleQuickBooked = useCallback(() => {
    refreshScheduler();
  }, [refreshScheduler]);

  // Single Quick Book opener — used by the toolbar button (no args) and by
  // empty-cell clicks on the Staff/Calendar sub-tabs (with cell prefill).
  // Caller-supplied date wins over selectedDate so the Staff sub-tab's own
  // date nav (which doesn't sync with SchedulerView's) doesn't get
  // overwritten when a user clicks a slot on a different day.
  const handleNewQuickBook = useCallback(
    (prefill?: { employeeId?: string; resourceId?: string; hour?: number; endHour?: number; date?: Date }) => {
      setQuickBookPrefill({ date: selectedDate, ...prefill });
      setQuickBookOpen(true);
    },
    [selectedDate]
  );

  // Single return so QuickBookPanel + EmployeeDayFocusPanel + AppointmentPopover
  // are reachable from every sub-tab — Quick Book used to be Resources/List
  // only, which made the most-frequent front-desk task (book a call-in) two
  // clicks deeper than necessary on the default Calendar landing.
  // See docs/sessions/2026-05-07-front-desk-audit.md punch list item #1.
  return (
    <div className="flex flex-col flex-1 overflow-hidden" data-testid="scheduler-view">
      {/* Calendar branch keeps its narrative header above the view-tab bar.
          Staff branch lets NewSchedulerView render its own header (it owns
          a richer toolbar with date nav, zoom, view-mode toggle). All other
          branches share the toolbar below. */}
      {activeView === 'calendar' && (
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111] flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Schedule</div>
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Month, week, or day view. Click a slot to book.</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              {viewTabs.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setActiveView(key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition ${
                    activeView !== key
                      ? 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                      : ''
                  }`}
                  style={activeView === key ? { backgroundColor: 'var(--accent)', color: 'var(--primary-text)' } : undefined}
                  data-testid={`view-tab-${key}`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>
            <Button size="sm" onClick={() => handleNewQuickBook()} data-testid="quick-book-trigger">
              <Plus className="w-4 h-4 mr-1" />
              Quick Book
            </Button>
          </div>
        </div>
      )}

      {(activeView === 'resources' || activeView === 'list') && (
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111] flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-1">
            {viewTabs.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveView(key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition ${
                  activeView !== key
                    ? 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                    : ''
                }`}
                style={activeView === key ? { backgroundColor: 'var(--accent)', color: 'var(--primary-text)' } : undefined}
                data-testid={`view-tab-${key}`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <SchedulerDateNav selectedDate={selectedDate} onDateChange={setSelectedDate} tenantTimezone={tenantTimezone} />
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
            <Button size="sm" onClick={() => handleNewQuickBook()} data-testid="quick-book-trigger">
              <Plus className="w-4 h-4 mr-1" />
              Quick Book
            </Button>
          </div>
        </div>
      )}

      {/* View content */}
      <div className={activeView === 'staff' ? 'flex-1 flex overflow-hidden' : 'flex-1 overflow-auto bg-white dark:bg-[#111]'}>
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
                // BigCalendar's drag-select returns [start, end). For a single
                // click in month view, end may equal start — fall back to a
                // 1-hour window so QuickBook doesn't open with end ≤ start.
                endHour: endHour > startHour ? endHour : startHour + 1,
              });
            }}
          />
        )}
        {activeView === 'staff' && (
          <NewSchedulerView
            viewTabs={viewTabs}
            activeView={activeView}
            onViewChange={(key) => setActiveView(key as SchedulerViewTab)}
            onQuickBook={handleNewQuickBook}
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

      {/* Panels — rendered for every sub-tab so Quick Book reachable everywhere */}
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
        appointments={focusEmployee ? (appointmentsByEmployee.get(String(focusEmployee.employee_id)) || []) : []}
        shifts={focusEmployee ? (shiftsByEmployee.get(String(focusEmployee.employee_id)) || []) : []}
        onAppointmentClick={handleAppointmentClick}
      />

      {/* Appointment popover */}
      {apptPopover && (
        <AppointmentPopover
          appointment={apptPopover.appointment}
          employeeName={
            apptPopover.appointment.employee_id
              ? employees.find(e => String(e.employee_id) === String(apptPopover.appointment.employee_id))?.name || null
              : null
          }
          resourceName={apptPopover.appointment.resources?.name || null}
          anchorRect={apptPopover.anchorRect}
          onClose={() => setApptPopover(null)}
          onEdit={handlePopoverEdit}
          onCancel={handlePopoverCancel}
        />
      )}
    </div>
  );
}
