import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Users, Columns3, List, Calendar, RefreshCw, Plus, ZoomIn, ZoomOut, ChevronDown } from 'lucide-react';
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

export type SchedulerViewTab = 'staff' | 'resources' | 'list' | 'calendar';

const VALID_VIEW_TABS: SchedulerViewTab[] = ['staff', 'resources', 'list', 'calendar'];

/**
 * Resolve the initial scheduler view-tab from `?subtab=…` on the URL,
 * falling back to 'staff' (the default landing — see comment below).
 * Lives outside the component so it can be called from a `useState`
 * initializer without re-running on every render.
 */
function resolveInitialView(): SchedulerViewTab {
  if (typeof window === 'undefined') return 'staff';
  const raw = new URLSearchParams(window.location.search).get('subtab');
  if (raw && (VALID_VIEW_TABS as string[]).includes(raw)) return raw as SchedulerViewTab;
  return 'staff';
}

export default function SchedulerView() {
  const tenantId = useActiveTenantId();
  const vocab = useVocabulary();
  const tenantTimezone = useTenantTimezone();
  // Declare activeView before viewTabs so Terser's let-chain doesn't produce
  // a TDZ when overflowActive uses activeView inside an Array.some callback.
  // TypeScript allows the reference inside the closure regardless of order,
  // but at runtime the minifier collapses all consts into one let sequence,
  // so the declaration must precede any expression that evaluates the variable.
  const [activeView, setActiveView] = useState<SchedulerViewTab>(resolveInitialView);

  const viewTabs: { key: SchedulerViewTab; label: string; icon: React.ElementType }[] = [
    { key: 'calendar', label: 'Calendar', icon: Calendar },
    { key: 'staff', label: vocab.employee_plural, icon: Users },
    { key: 'resources', label: vocab.resource_plural, icon: Columns3 },
    { key: 'list', label: 'List', icon: List },
  ];
  const primaryTabs = viewTabs.filter((t) => t.key === 'staff' || t.key === 'calendar');
  const overflowTabs = viewTabs.filter((t) => t.key === 'resources' || t.key === 'list');
  const overflowActive = overflowTabs.some((t) => t.key === activeView);
  const {
    customers,
    resources,
    employees: allStaff,
    services,
    refresh: refreshStaticData,
  } = useStaticData(tenantId);
  // Only show actual employees in the scheduler, not user accounts (owners/admins)
  const employees = useMemo(() => allStaff.filter((e) => e.type !== 'user'), [allStaff]);

  // Default sub-tab: Staff (front-desk audit P1 #5, 2026-05-07).
  // The Staff sub-tab is the daily-use surface for front-desk operators —
  // rows = staff, hours across, today highlighted, empty cells now click
  // through to Quick Book (P1 #4). Calendar stays available for month/week
  // overview and drag-and-drop, just no longer the landing.
  //
  // URL sync (UX audit 4.2 row 9, 2026-05-18): the active view is now
  // also reflected in `?subtab=…` so deep-links + browser back/forward
  // survive. `resolveInitialView` reads the URL on first mount; the
  // effect below writes the default back on first render so a bare
  // /dashboard?tab=schedule lands with the URL telling the truth.
  // (activeView useState hoisted above viewTabs — see comment above viewTabs)
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [overflowMenuOpen, setOverflowMenuOpen] = useState(false);
  const overflowBtnRef = useRef<HTMLButtonElement>(null);

  // Write the active view to ?subtab=… whenever it changes (including
  // the initial render, so a bare URL gets stamped with the resolved
  // default). Use replaceState rather than pushState — the dashboard
  // page already handles the parent tab via pushState, and we don't
  // want every sub-tab switch to clutter the back-button history.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('subtab') !== activeView) {
      params.set('subtab', activeView);
      window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
    }
  }, [activeView]);

  // Sub-tab popstate handler (UX audit Flows 4.1.8, 2026-05-18). The
  // parent dashboard page already updates the top-level `?tab=`
  // state on popstate, but the scheduler's own ?subtab=… needs its
  // own listener — without it, browser back/forward inside the
  // schedule tab snapped to the default 'staff' view even when the
  // URL said otherwise (felt especially broken on iOS Safari where
  // back-button is a primary navigation pattern).
  useEffect(() => {
    function onPopState() {
      const next = resolveInitialView();
      setActiveView((prev) => (prev === next ? prev : next));
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

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

  // When the popover's Edit button fires from a non-Calendar sub-tab, we
  // switch to Calendar AND ask AppointmentView to pre-select + edit this
  // appointment on its next render. Simpler than hoisting the
  // AppointmentDetailContext above SchedulerView.
  const [pendingEditAppointmentId, setPendingEditAppointmentId] = useState<string | null>(null);

  const handleAppointmentClick = useCallback((appt: SchedulerAppointment, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setApptPopover((prev) =>
      prev?.appointment.appointment_id === appt.appointment_id
        ? null
        : { appointment: appt, anchorRect: rect }
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
  // Undo wraps the existing reactivate route (added 2026-05-10) for the
  // 5-second Undo window on the cancel-success toast. TIMESLOT_OCCUPIED
  // means another booking landed in the freed slot before the user hit
  // Undo — surface that as a hard error, not silent failure.
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

  // Soft-cancel from the hover-trash icon on an appointment block.
  // Same shape as handlePopoverCancel above but called from the block
  // directly (no popover round-trip). The confirm() is intentional —
  // a one-click delete on a scheduled appointment is too punishing for
  // a misclick. Origin: 2026-05-13 — user reported "no delete button"
  // for appointments; the hover-trash gives a direct affordance.
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

  // Outlook-style drag-to-move. The block already snapped the delta
  // to a 15-min grid (matches the booking-form gridding); we compute
  // the new start/end timestamps from the delta and PUT them. The
  // GiST exclusion constraint in book_with_scheduling_atomic catches
  // any race-conflict (409 → toast + refresh, which snaps the visual
  // back to the DB-of-record position).
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

  // Single Quick Book opener — used by the toolbar button (no args) and by
  // empty-cell clicks on the Staff/Calendar sub-tabs (with cell prefill).
  // Caller-supplied date wins over selectedDate so the Staff sub-tab's own
  // date nav (which doesn't sync with SchedulerView's) doesn't get
  // overwritten when a user clicks a slot on a different day.
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
            <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
              Schedule
            </div>
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Month, week, or day view. Click a slot to book.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              {primaryTabs.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setActiveView(key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition ${
                    activeView !== key
                      ? 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                      : ''
                  }`}
                  style={
                    activeView === key
                      ? { backgroundColor: 'var(--accent)', color: 'var(--primary-text)' }
                      : undefined
                  }
                  data-testid={`view-tab-${key}`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
              <div className="relative">
                <button
                  ref={overflowBtnRef}
                  onClick={() => setOverflowMenuOpen(!overflowMenuOpen)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition ${
                    !overflowActive
                      ? 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                      : ''
                  }`}
                  style={
                    overflowActive
                      ? { backgroundColor: 'var(--accent)', color: 'var(--primary-text)' }
                      : undefined
                  }
                  data-testid="view-tab-overflow"
                >
                  More
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
                {overflowMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-[99]" onClick={() => setOverflowMenuOpen(false)} />
                    <div
                      className="absolute top-full left-0 mt-1 z-[100] rounded-xl shadow-2xl border py-1 min-w-[140px]"
                      style={{ backgroundColor: 'var(--bg-raised)', borderColor: 'var(--border-soft)' }}
                    >
                      {overflowTabs.map(({ key, label, icon: Icon }) => (
                        <button
                          key={key}
                          onClick={() => { setActiveView(key); setOverflowMenuOpen(false); }}
                          className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition hover:brightness-125"
                          style={{
                            color: activeView === key ? 'var(--accent-soft)' : 'var(--text-primary)',
                            backgroundColor: activeView === key ? 'var(--accent-muted)' : 'transparent',
                          }}
                          data-testid={`view-tab-${key}`}
                        >
                          <Icon className="w-4 h-4" />
                          {label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
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
            {primaryTabs.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveView(key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition ${
                  activeView !== key
                    ? 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                    : ''
                }`}
                style={
                  activeView === key
                    ? { backgroundColor: 'var(--accent)', color: 'var(--primary-text)' }
                    : undefined
                }
                data-testid={`view-tab-${key}`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
            <div className="relative">
              <button
                onClick={() => setOverflowMenuOpen(!overflowMenuOpen)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition ${
                  !overflowActive
                    ? 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                    : ''
                }`}
                style={
                  overflowActive
                    ? { backgroundColor: 'var(--accent)', color: 'var(--primary-text)' }
                    : undefined
                }
                data-testid="view-tab-overflow"
              >
                More
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              {overflowMenuOpen && (
                <>
                  <div className="fixed inset-0 z-[99]" onClick={() => setOverflowMenuOpen(false)} />
                  <div
                    className="absolute top-full left-0 mt-1 z-[100] rounded-xl shadow-2xl border py-1 min-w-[140px]"
                    style={{ backgroundColor: 'var(--bg-raised)', borderColor: 'var(--border-soft)' }}
                  >
                    {overflowTabs.map(({ key, label, icon: Icon }) => (
                      <button
                        key={key}
                        onClick={() => { setActiveView(key); setOverflowMenuOpen(false); }}
                        className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition hover:brightness-125"
                        style={{
                          color: activeView === key ? 'var(--accent-soft)' : 'var(--text-primary)',
                          backgroundColor: activeView === key ? 'var(--accent-muted)' : 'transparent',
                        }}
                        data-testid={`view-tab-${key}`}
                      >
                        <Icon className="w-4 h-4" />
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <SchedulerDateNav
              selectedDate={selectedDate}
              onDateChange={setSelectedDate}
              tenantTimezone={tenantTimezone}
            />
            {activeView === 'resources' && (
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
                {/* Zoom-level indicator. UX audit 4.2 row 8 (2026-05-18):
                    the previous icon-only +/- pair gave no hint about
                    where on the zoom scale the user currently sat.
                    Compact label fits between the buttons; aria-label
                    on the wrapping `role="group"` carries the full
                    context for screen readers. */}
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
      )}

      {/* View content */}
      <div
        className={
          activeView === 'staff'
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
            onAppointmentDelete={handleAppointmentDelete}
            onAppointmentMove={handleAppointmentMove}
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
        appointments={
          focusEmployee ? appointmentsByEmployee.get(String(focusEmployee.employee_id)) || [] : []
        }
        shifts={focusEmployee ? shiftsByEmployee.get(String(focusEmployee.employee_id)) || [] : []}
        onAppointmentClick={handleAppointmentClick}
      />

      {/* Appointment popover */}
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
