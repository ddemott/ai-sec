import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Minus, Plus, RefreshCw, Save, X, Users, Zap, GripVertical } from 'lucide-react';
import { useStaticData } from '../../lib/hooks';
import { Api } from '../../lib/api';
import { formatHour, shiftTimeToHour, formatShiftTime, formatTime24to12 } from '../../lib/utils';
import type { ServiceMapping } from '../../lib/types';
import { useActiveTenantId } from '../../lib/SessionContext';
import { useSchedulerData } from './useSchedulerData';
import { SchedulerDateNav } from './SchedulerDateNav';
import { StaffProfileCard } from './StaffProfileCard';
import { EmptyState } from '../ui/EmptyState';
import { AppointmentPopover } from './AppointmentPopover';
import { ConfirmModal } from '../ui/ConfirmModal';
import { showToast } from '../ui/Toast';
import { useConfirm } from '../../lib/useConfirm';
import type { SchedulerAppointment } from './useSchedulerData';
import type { Service, Employee } from '../../lib/types';

// --- Constants ---
const STAFF_PANEL_WIDTH = 160;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DEFAULT_COL_W = 72;
const MIN_COL_W = 36;
const MAX_COL_W = 140;
const ZOOM_STEP = 16;
const ROW_HEIGHT = 56;
const SKILL_BAR_HEIGHT = 22;
const SKILL_ROW_MIN_HEIGHT = 54;
const HEADER_HEIGHT = 36;
const DEFAULT_OPEN_HOUR = 8;
const DEFAULT_CLOSE_HOUR = 17;

// --- Skill color palette ---
const SKILL_COLORS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
  '#14b8a6', // teal
  '#a855f7', // purple
  '#84cc16', // lime
  '#e11d48', // rose
];

// --- Types ---
type ViewMode = 'hours' | 'skills';

interface ProfileCardState {
  employeeId: string;
  anchorRect: DOMRect;
}

// --- Helpers ---

function getZoomPercent(colW: number): number {
  return Math.round((colW / DEFAULT_COL_W) * 100);
}

/** Parse an ISO datetime to fractional hours (e.g. 9:30 -> 9.5) */
function toFractionalHour(isoStr: string): number {
  if (!isoStr) return 0;
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return 0;
  return d.getHours() + d.getMinutes() / 60;
}

/** Get appointment status color classes */
function getStatusColor(status: string): { bg: string; border: string; text: string } {
  switch (status) {
    case 'completed':
      return { bg: 'var(--green, #22c55e)', border: 'var(--green, #22c55e)', text: '#fff' };
    case 'scheduled':
      return { bg: 'var(--accent, #3b82f6)', border: 'var(--accent, #3b82f6)', text: '#fff' };
    default:
      // pending or anything else
      return { bg: 'var(--yellow, #eab308)', border: 'var(--yellow, #eab308)', text: '#000' };
  }
}

function findServiceName(description: string, services: Service[]): string {
  // Try to match appointment description to a service name
  const svc = services.find((s) => s.name.toLowerCase() === description?.toLowerCase());
  return svc?.name || description || '';
}

/** Build a consistent color map from service/skill names to colors */
function buildSkillColorMap(allSkillNames: string[]): Map<string, string> {
  const sorted = Array.from(new Set(allSkillNames)).sort();
  const map = new Map<string, string>();
  sorted.forEach((skill, i) => {
    map.set(skill, SKILL_COLORS[i % SKILL_COLORS.length]);
  });
  return map;
}

/** Drag handle grip dots SVG (same pattern as tenant reorder) */
function GripDots() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" data-testid="grip-handle">
      <circle cx="3" cy="2" r="1.5" />
      <circle cx="9" cy="2" r="1.5" />
      <circle cx="3" cy="6" r="1.5" />
      <circle cx="9" cy="6" r="1.5" />
      <circle cx="3" cy="10" r="1.5" />
      <circle cx="9" cy="10" r="1.5" />
    </svg>
  );
}

// --- Component ---

export interface NewSchedulerViewProps {
  /** Override tenant ID (defaults to active tenant from context) */
  tenantId?: string | null;
  /** View tabs from parent SchedulerView (Staff, Resources, List, Calendar) */
  viewTabs?: { key: string; label: string; icon: React.ElementType }[];
  activeView?: string;
  onViewChange?: (key: string) => void;
  /** Optional Quick Book trigger — when provided, renders a button in the
      header toolbar so the front-desk operator can book a call-in without
      switching sub-tabs. Empty grid cells are also click-targets that call
      this with `{ employeeId, hour, date }` prefilled (front-desk audit P1
      #4). Wired by SchedulerView. */
  onQuickBook?: (prefill?: { employeeId?: string; hour?: number; date?: Date }) => void;
}

export default function NewSchedulerView({
  tenantId: tenantIdProp,
  viewTabs,
  activeView,
  onViewChange,
  onQuickBook,
}: NewSchedulerViewProps) {
  const contextTenantId = useActiveTenantId();
  const tenantId = tenantIdProp !== undefined ? tenantIdProp : contextTenantId;

  const { employees: allStaff, services, refresh: refreshStaticData } = useStaticData(tenantId);

  // Fetch service-employee mappings to derive skills (single source of truth)
  const [empMappings, setEmpMappings] = useState<ServiceMapping[]>([]);
  useEffect(() => {
    if (!tenantId) return;
    Api.mappings
      .listServiceEmployee(tenantId)
      .then((m) => setEmpMappings(Array.isArray(m) ? m : []))
      .catch(() => {});
  }, [tenantId]);

  // Build skills per employee from mappings + service names
  const employeeSkillsMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const m of empMappings) {
      const empId = String(m.employee_id);
      const svc = services.find((s) => String(s.service_id) === String(m.service_id));
      if (svc) {
        const list = map.get(empId) || [];
        list.push(svc.name);
        map.set(empId, list);
      }
    }
    // Sort skills alphabetically so ordering is consistent across employees
    for (const [key, list] of map) {
      map.set(key, list.sort());
    }
    return map;
  }, [empMappings, services]);

  // Filter out user accounts — only show employees in scheduler
  const baseEmployees = useMemo(() => allStaff.filter((e) => e.type !== 'user'), [allStaff]);

  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [colW, setColW] = useState(DEFAULT_COL_W);
  const [viewMode, setViewMode] = useState<ViewMode>('hours');

  // --- Drag-to-reorder state (Item #6) ---
  const storageKey = tenantId ? `scheduler-staff-order-${tenantId}` : null;

  // Load persisted order from localStorage on mount
  const [staffOrder, setStaffOrder] = useState<string[]>(() => {
    if (!storageKey) return [];
    try {
      const stored = localStorage.getItem(storageKey);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [savedOrder, setSavedOrder] = useState<string[]>(() => {
    if (!storageKey) return [];
    try {
      const stored = localStorage.getItem(storageKey);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [orderDirty, setOrderDirty] = useState(false);

  // Warn before leaving with unsaved reorder
  useEffect(() => {
    if (!orderDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [orderDirty]);

  // Sync staff order with baseEmployees when they change
  useEffect(() => {
    const ids = baseEmployees.map((e) => String(e.employee_id));
    // Only reset if the set of employee IDs changed (not just reordering)
    const currentSet = new Set(savedOrder);
    const newSet = new Set(ids);
    const sameSet = currentSet.size === newSet.size && ids.every((id) => currentSet.has(id));
    if (!sameSet) {
      // If we have a persisted order, apply it (filter to only existing employees)
      if (savedOrder.length > 0) {
        const validSaved = savedOrder.filter((id) => newSet.has(id));
        const newIds = ids.filter((id) => !new Set(validSaved).has(id));
        const merged = [...validSaved, ...newIds];
        setStaffOrder(merged);
        setSavedOrder(merged);
      } else {
        setStaffOrder(ids);
        setSavedOrder(ids);
      }
      setOrderDirty(false);
    }
  }, [baseEmployees, savedOrder]);

  // Ordered employees based on staffOrder
  const employees = useMemo(() => {
    if (staffOrder.length === 0) return baseEmployees;
    const empMap = new Map(baseEmployees.map((e) => [String(e.employee_id), e]));
    const ordered: Employee[] = [];
    for (const id of staffOrder) {
      const emp = empMap.get(id);
      if (emp) ordered.push(emp);
    }
    // Add any employees not in the order (newly added)
    for (const emp of baseEmployees) {
      if (!staffOrder.includes(String(emp.employee_id))) {
        ordered.push(emp);
      }
    }
    return ordered;
  }, [baseEmployees, staffOrder]);

  // --- Profile card state (Item #4) ---
  const [profileCard, setProfileCard] = useState<ProfileCardState | null>(null);
  const [apptPopover, setApptPopover] = useState<{
    appointment: SchedulerAppointment;
    anchorRect: DOMRect;
  } | null>(null);

  const {
    appointments,
    loading,
    appointmentsByEmployee,
    shiftsByEmployee,
    refresh: refreshScheduler,
  } = useSchedulerData(tenantId, selectedDate, employees, []);

  // Derive business hours from shift data, fallback to defaults
  const { openHour, closeHour } = useMemo(() => {
    let earliest = DEFAULT_OPEN_HOUR;
    let latest = DEFAULT_CLOSE_HOUR;
    for (const shifts of shiftsByEmployee.values()) {
      for (const s of shifts) {
        if (s.start_time) {
          const h = shiftTimeToHour(String(s.start_time));
          if (h < earliest) earliest = Math.floor(h);
        }
        if (s.end_time) {
          const h = shiftTimeToHour(String(s.end_time));
          if (h > latest) latest = Math.ceil(h);
        }
      }
    }
    return { openHour: earliest, closeHour: latest };
  }, [shiftsByEmployee]);

  const handleRefresh = useCallback(() => {
    void refreshScheduler();
    void refreshStaticData();
  }, [refreshScheduler, refreshStaticData]);

  // --- Skill color map (Item #5) ---
  // Build skill color map from all assigned service names
  const skillColorMap = useMemo(() => {
    const allNames: string[] = [];
    for (const names of employeeSkillsMap.values()) allNames.push(...names);
    return buildSkillColorMap(allNames);
  }, [employeeSkillsMap]);

  // --- Refs for scroll sync ---
  const staffPanelRef = useRef<HTMLDivElement>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const hasAutoScrolled = useRef(false);

  // Scroll sync: grid vertical -> staff panel vertical
  // Scroll sync: grid horizontal -> header horizontal
  useEffect(() => {
    const gridEl = gridContainerRef.current;
    if (!gridEl) return;

    const handleScroll = () => {
      if (staffPanelRef.current) {
        staffPanelRef.current.scrollTop = gridEl.scrollTop;
      }
      if (headerRef.current) {
        headerRef.current.scrollLeft = gridEl.scrollLeft;
      }
    };

    gridEl.addEventListener('scroll', handleScroll, { passive: true });
    return () => gridEl.removeEventListener('scroll', handleScroll);
  }, []);

  // Auto-scroll to 1hr before earliest appointment (or 7am)
  useEffect(() => {
    if (hasAutoScrolled.current) return;
    if (loading) return;

    const gridEl = gridContainerRef.current;
    if (!gridEl) return;

    let scrollToHour = 7; // default if no appointments
    if (appointments.length > 0) {
      let earliest = 24;
      for (const appt of appointments) {
        const h = toFractionalHour(appt.start_time);
        if (h < earliest) earliest = h;
      }
      scrollToHour = Math.max(0, Math.floor(earliest) - 1);
    }

    gridEl.scrollLeft = scrollToHour * colW;
    hasAutoScrolled.current = true;
  }, [appointments, loading, colW]);

  // Reset auto-scroll flag when date changes
  useEffect(() => {
    hasAutoScrolled.current = false;
  }, [selectedDate]);

  // --- Zoom ---
  const handleZoomIn = useCallback(() => {
    setColW((prev) => Math.min(prev + ZOOM_STEP, MAX_COL_W));
  }, []);

  const handleZoomOut = useCallback(() => {
    setColW((prev) => Math.max(prev - ZOOM_STEP, MIN_COL_W));
  }, []);

  // --- Empty-slot click → open Quick Book prefilled (front-desk audit P1 #4) ---
  // Click only fires when the row's specific employee has a shift covering
  // the hour on the viewed date. Cells outside that window are passive —
  // booking would be rejected by the RPC with EMPLOYEE_NOT_SCHEDULED, so
  // the UI shouldn't invite the click.
  const isEmployeeWorkingAt = useCallback(
    (employeeId: string, hour: number): boolean => {
      const empShifts = shiftsByEmployee.get(employeeId) || [];
      // useSchedulerData already drops is_off days from the map, so any
      // shift returned here is a real working window.
      for (const s of empShifts) {
        if (!s.start_time || !s.end_time) continue;
        const startH = shiftTimeToHour(String(s.start_time));
        const endH = shiftTimeToHour(String(s.end_time));
        if (hour >= startH && hour < endH) return true;
      }
      return false;
    },
    [shiftsByEmployee]
  );

  const handleSlotClick = useCallback(
    (employeeId: string, hour: number) => {
      if (!onQuickBook) return;
      if (!isEmployeeWorkingAt(employeeId, hour)) return;
      onQuickBook({ employeeId, hour, date: selectedDate });
    },
    [onQuickBook, selectedDate, isEmployeeWorkingAt]
  );

  // --- Staff name click -> open profile card (Item #4) ---
  const handleStaffNameClick = useCallback((employeeId: string, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setProfileCard((prev) =>
      prev?.employeeId === employeeId ? null : { employeeId, anchorRect: rect }
    );
  }, []);

  const handleProfileCardClose = useCallback(() => {
    setProfileCard(null);
  }, []);

  // --- Mark off today (front-desk audit P0 #2) ---
  // Front-desk role can take a sick employee off the board without leaving
  // Schedule. The handler is declared further down, after profileCardEmployee
  // is in scope — only the lightweight UI state and label memos live here.
  const [markingOff, setMarkingOff] = useState(false);
  const { state: confirmState, confirm: openConfirm, close: closeConfirm } = useConfirm();

  // --- Appointment click -> open popover ---
  const handleAppointmentClick = useCallback(
    (appointment: SchedulerAppointment, e: React.MouseEvent) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setApptPopover((prev) =>
        prev?.appointment.appointment_id === appointment.appointment_id
          ? null
          : { appointment, anchorRect: rect }
      );
      setProfileCard(null); // close profile card if open
    },
    []
  );

  const handleApptPopoverClose = useCallback(() => {
    setApptPopover(null);
  }, []);

  // Soft-cancel from popover (Staff sub-tab). Mirrors SchedulerView's
  // handlePopoverCancel but lives here because NewSchedulerView fetches
  // its own data and owns its own refresh — SchedulerView's handler
  // would refresh the parent's data set, not this view's. 2026-05-13:
  // added after the user reported "no delete button" — the popover
  // was rendered without onCancel so its action buttons never showed.
  // Undo for cancel-appointment — reactivates the row via the dedicated
  // backend route. TIMESLOT_OCCUPIED means another booking landed in the
  // freed slot before the user clicked Undo; surface that explicitly.
  const undoApptCancel = useCallback(
    async (appointmentId: string) => {
      if (!tenantId) return;
      try {
        const res = await Api.appointments.reactivate(appointmentId, tenantId);
        if (res.success) {
          showToast('Appointment restored', 'success');
          void refreshScheduler();
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
    [tenantId, refreshScheduler]
  );

  const handleApptCancel = useCallback(
    (appointmentId: string) => {
      if (!tenantId) return;
      openConfirm({
        title: 'Cancel appointment?',
        message:
          'The slot will free up, but the record stays for history. You can restore it later from Customers.',
        confirmLabel: 'Cancel appointment',
        confirmVariant: 'danger',
        onConfirm: () => {
          void (async () => {
            closeConfirm();
            try {
              const res = await Api.appointments.cancel(appointmentId, tenantId);
              if (res.success) {
                showToast('Appointment canceled', 'success', {
                  label: 'Undo',
                  onClick: () => {
                    void undoApptCancel(appointmentId);
                  },
                });
                setApptPopover(null);
                void refreshScheduler();
              } else {
                showToast(res.error || 'Failed to cancel appointment', 'error');
              }
            } catch {
              showToast('Connection error — could not cancel appointment', 'error');
            }
          })();
        },
      });
    },
    [tenantId, refreshScheduler, openConfirm, closeConfirm, undoApptCancel]
  );

  // Drag-to-move from a Staff-lane block. Block already snapped delta
  // to 15 min and called us with the resolved minute count. We compute
  // new start/end ISO times and PUT them; the GiST exclusion constraint
  // in the booking RPC catches any race-conflict (409 → toast + revert
  // via refreshScheduler).
  const handleApptMove = useCallback(
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
          void refreshScheduler(); // snap visual back to DB state
        }
      } catch {
        showToast('Connection error — appointment not moved', 'error');
        void refreshScheduler();
      }
    },
    [tenantId, appointments, refreshScheduler]
  );

  // --- Drag-to-reorder handlers (Item #6) ---
  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      if (dragIndex === null || dragIndex === index) return;

      setStaffOrder((prev) => {
        const updated = [...prev];
        const [moved] = updated.splice(dragIndex, 1);
        updated.splice(index, 0, moved);
        return updated;
      });
      setDragIndex(index);
      setOrderDirty(true);
    },
    [dragIndex]
  );

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
  }, []);

  const handleSaveOrder = useCallback(() => {
    setSavedOrder([...staffOrder]);
    setOrderDirty(false);
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(staffOrder));
      } catch {
        /* ignore */
      }
    }
  }, [staffOrder, storageKey]);

  const handleDiscardOrder = useCallback(() => {
    setStaffOrder([...savedOrder]);
    setOrderDirty(false);
  }, [savedOrder]);

  // --- Compute profile card data (Item #4) ---
  const profileCardEmployee = useMemo(() => {
    if (!profileCard) return null;
    return employees.find((e) => String(e.employee_id) === profileCard.employeeId) || null;
  }, [profileCard, employees]);

  const profileCardData = useMemo(() => {
    if (!profileCard || !profileCardEmployee) return null;
    const empId = profileCard.employeeId;
    const empAppts = appointmentsByEmployee.get(empId) || [];
    const todayApptCount = empAppts.length;
    let todayHours = 0;
    for (const appt of empAppts) {
      const start = toFractionalHour(appt.start_time);
      const end = toFractionalHour(appt.end_time);
      todayHours += Math.max(end - start, 0);
    }
    todayHours = Math.round(todayHours * 10) / 10;

    const empShifts = shiftsByEmployee.get(empId) || [];
    let shiftStart: string | null = null;
    let shiftEnd: string | null = null;
    if (empShifts.length > 0 && empShifts[0].start_time && empShifts[0].end_time) {
      shiftStart = formatShiftTime(empShifts[0].start_time);
      shiftEnd = formatShiftTime(empShifts[0].end_time);
    }

    return { todayApptCount, todayHours, shiftStart, shiftEnd };
  }, [profileCard, profileCardEmployee, appointmentsByEmployee, shiftsByEmployee]);

  // --- Mark off handler (declared here so it can close over profileCardEmployee) ---
  const isSelectedDateToday = useMemo(() => {
    const now = new Date();
    return (
      selectedDate.getFullYear() === now.getFullYear() &&
      selectedDate.getMonth() === now.getMonth() &&
      selectedDate.getDate() === now.getDate()
    );
  }, [selectedDate]);

  const selectedDateLabel = useMemo(() => {
    if (isSelectedDateToday) return 'today';
    return selectedDate.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }, [selectedDate, isSelectedDateToday]);

  const markOffButtonLabel = isSelectedDateToday
    ? 'Mark off today'
    : `Mark off ${selectedDateLabel}`;

  const handleMarkOffClick = useCallback(() => {
    if (!profileCardEmployee || !tenantId) return;
    const employeeId = profileCardEmployee.employee_id;
    const employeeName = profileCardEmployee.name;
    const tzOffsetMs = selectedDate.getTimezoneOffset() * 60000;
    const shiftDate = new Date(selectedDate.getTime() - tzOffsetMs).toISOString().slice(0, 10);

    openConfirm({
      title: markOffButtonLabel,
      message: `Mark ${employeeName} off for ${selectedDateLabel}? Their shift will be removed and the AI won't book new appointments with them on this day.`,
      confirmLabel: 'Mark off',
      confirmVariant: 'warning',
      onConfirm: () => {
        void (async () => {
          setMarkingOff(true);
          try {
            await Api.shifts.schedule.save(tenantId, {
              employee_id: employeeId,
              shift_date: shiftDate,
              is_off: true,
            });
            showToast(`${employeeName} marked off for ${selectedDateLabel}`, 'success');
            closeConfirm();
            handleProfileCardClose();
            handleRefresh();
          } catch {
            showToast('Failed to mark off — please try again', 'error');
          } finally {
            setMarkingOff(false);
          }
        })();
      },
    });
  }, [
    profileCardEmployee,
    tenantId,
    selectedDate,
    selectedDateLabel,
    markOffButtonLabel,
    openConfirm,
    closeConfirm,
    handleProfileCardClose,
    handleRefresh,
  ]);

  // --- Compute row heights for skills mode (Item #5) ---
  const getRowHeight = useCallback(
    (emp: Employee): number => {
      if (viewMode !== 'skills') return ROW_HEIGHT;
      const skillCount = employeeSkillsMap.get(String(emp.employee_id))?.length || 0;
      return Math.max(SKILL_ROW_MIN_HEIGHT, Math.min(skillCount * SKILL_BAR_HEIGHT + 10, 200));
    },
    [viewMode, employeeSkillsMap]
  );

  // --- Compute grid width ---
  const totalGridWidth = 24 * colW;

  return (
    <div className="flex flex-col flex-1 overflow-hidden" data-testid="new-scheduler-view">
      {/* Header toolbar */}
      <div
        className="px-4 py-3 flex items-center justify-between gap-4 flex-wrap"
        style={{
          borderBottom: '1px solid var(--border-soft)',
          background: 'var(--bg-surface, #1a1a1a)',
        }}
      >
        <div className="flex items-center gap-3">
          {/* View switcher tabs (from parent SchedulerView) */}
          {viewTabs && onViewChange && (
            <div className="flex items-center gap-1" data-testid="scheduler-view-tabs">
              {viewTabs.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => onViewChange(key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition ${
                    activeView !== key ? 'hover:brightness-125' : ''
                  }`}
                  style={{
                    background: activeView === key ? 'var(--accent, #3b82f6)' : 'transparent',
                    color:
                      activeView === key ? 'var(--primary-text, #fff)' : 'var(--text-secondary)',
                  }}
                  data-testid={`view-tab-${key}`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>
          )}
          {!viewTabs && (
            <h1
              className="font-display text-2xl tracking-wide uppercase"
              style={{
                fontFamily: 'var(--font-display, "Bebas Neue", sans-serif)',
                color: 'var(--text-primary, #fff)',
              }}
            >
              Schedule
            </h1>
          )}
        </div>

        <div className="flex items-center gap-3">
          <SchedulerDateNav selectedDate={selectedDate} onDateChange={setSelectedDate} />

          {/* Quick Book trigger — wired by SchedulerView so the front-desk
              operator can book a call-in from this sub-tab too. Hidden when
              the parent didn't pass a handler so the component remains
              usable in other contexts. */}
          {onQuickBook && (
            <button
              onClick={() => onQuickBook?.()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
              style={{ background: 'var(--accent, #3b82f6)', color: 'var(--primary-text, #fff)' }}
              data-testid="quick-book-trigger"
            >
              <Zap className="w-3.5 h-3.5" />
              Quick Book
            </button>
          )}

          {/* View mode toggle (Item #5) */}
          <div
            className="flex items-center gap-0 rounded-lg overflow-hidden"
            style={{ border: '1px solid var(--border-soft, #444)' }}
            data-testid="view-mode-toggle"
          >
            <button
              onClick={() => setViewMode('hours')}
              className="px-3 py-1.5 text-xs font-bold transition-colors"
              style={{
                background: viewMode === 'hours' ? 'var(--accent, #3b82f6)' : 'transparent',
                color:
                  viewMode === 'hours'
                    ? 'var(--primary-text, #fff)'
                    : 'var(--text-secondary, #aaa)',
              }}
              data-testid="view-mode-hours"
            >
              Hours
            </button>
            <button
              onClick={() => setViewMode('skills')}
              className="px-3 py-1.5 text-xs font-bold transition-colors"
              style={{
                background: viewMode === 'skills' ? 'var(--accent, #3b82f6)' : 'transparent',
                color:
                  viewMode === 'skills'
                    ? 'var(--primary-text, #fff)'
                    : 'var(--text-secondary, #aaa)',
              }}
              data-testid="view-mode-skills"
            >
              Skills
            </button>
          </div>

          {/* Zoom controls */}
          <div
            className="flex items-center gap-0 rounded-lg overflow-hidden"
            style={{ border: '1px solid var(--border-soft, #444)' }}
          >
            <button
              onClick={handleZoomOut}
              disabled={colW <= MIN_COL_W}
              className="p-1.5 transition-colors disabled:opacity-30"
              style={{ color: 'var(--text-secondary, #aaa)' }}
              aria-label="Zoom out"
              data-testid="zoom-out"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span
              className="text-xs font-bold px-2 select-none"
              style={{ color: 'var(--text-muted, #888)' }}
              data-testid="zoom-label"
            >
              {getZoomPercent(colW)}%
            </span>
            <button
              onClick={handleZoomIn}
              disabled={colW >= MAX_COL_W}
              className="p-1.5 transition-colors disabled:opacity-30"
              style={{ color: 'var(--text-secondary, #aaa)' }}
              aria-label="Zoom in"
              data-testid="zoom-in"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Save/Discard reorder buttons (Item #6) */}
          {orderDirty && (
            <div className="flex items-center gap-1.5" data-testid="reorder-controls">
              <button
                onClick={handleSaveOrder}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-bold transition-colors"
                style={{
                  background: 'var(--accent, #3b82f6)',
                  color: '#fff',
                }}
                data-testid="save-order"
              >
                <Save className="w-3 h-3" />
                Save Order
              </button>
              <button
                onClick={handleDiscardOrder}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-bold transition-colors"
                style={{
                  background: 'transparent',
                  color: 'var(--text-secondary, #aaa)',
                  border: '1px solid var(--border-soft, #444)',
                }}
                data-testid="discard-order"
              >
                <X className="w-3 h-3" />
                Discard
              </button>
            </div>
          )}

          <button
            onClick={handleRefresh}
            className="p-1.5 rounded transition-colors"
            style={{ color: 'var(--text-secondary, #aaa)' }}
            aria-label="Refresh"
            data-testid="scheduler-refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Empty state when no employees */}
      {!loading && employees.length === 0 && (
        <div className="flex-1 flex" style={{ background: 'var(--bg-base, #111)' }}>
          <EmptyState
            icon={Users}
            title="No staff to display"
            description="Add employees in My Team to see the schedule."
            data-testid="scheduler-empty"
          />
        </div>
      )}

      {/* Main scheduler body */}
      {employees.length > 0 && (
        <div className="flex flex-1 overflow-hidden" style={{ background: 'var(--bg-base, #111)' }}>
          {/* Left: fixed staff names panel */}
          <div
            className="flex flex-col shrink-0"
            style={{ width: STAFF_PANEL_WIDTH, borderRight: '1px solid var(--border-soft)' }}
          >
            {/* Top-left corner (aligns with hour header) */}
            <div
              className="shrink-0"
              style={{
                height: HEADER_HEIGHT,
                borderBottom: '1px solid var(--border-soft)',
                background: 'var(--bg-surface, #1a1a1a)',
              }}
            />

            {/* Staff names (scrolls vertically in sync with grid) */}
            <div
              ref={staffPanelRef}
              className="flex-1 overflow-hidden"
              style={{ background: 'var(--bg-surface, #1a1a1a)' }}
              data-testid="staff-names-panel"
            >
              {employees.map((emp, idx) => {
                const rowH = getRowHeight(emp);
                return (
                  <div
                    key={String(emp.employee_id)}
                    role="button"
                    tabIndex={0}
                    draggable
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={(e) => handleDragOver(e, idx)}
                    onDragEnd={handleDragEnd}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleStaffNameClick(
                          String(emp.employee_id),
                          e as unknown as React.MouseEvent
                        );
                      }
                    }}
                    className="flex items-center px-1.5 cursor-pointer transition-all focus-visible:ring-2 focus-visible:ring-inset"
                    style={{
                      ['--tw-ring-color' as string]: 'var(--accent)',
                      height: rowH,
                      borderBottom: '1px solid var(--border-soft)',
                      color: 'var(--text-primary, #fff)',
                      opacity: dragIndex === idx ? 0.5 : 1,
                      transform: dragIndex === idx ? 'scale(1.02)' : 'none',
                    }}
                    onClick={(e) => handleStaffNameClick(String(emp.employee_id), e)}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        'var(--accent-muted, rgba(59,130,246,0.1))';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background = 'transparent';
                    }}
                    data-testid={`staff-name-${emp.employee_id}`}
                  >
                    {/* Drag handle (Item #6) */}
                    <div
                      className="shrink-0 cursor-grab active:cursor-grabbing mr-1.5 flex items-center"
                      style={{ color: 'var(--text-muted, #666)' }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = 'var(--text-secondary, #aaa)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = 'var(--text-muted, #666)';
                      }}
                      data-testid={`drag-handle-${emp.employee_id}`}
                    >
                      <GripDots />
                    </div>
                    <span
                      className="text-sm font-bold truncate"
                      style={{ fontFamily: 'var(--font-body, "DM Sans", sans-serif)' }}
                    >
                      {emp.name}
                    </span>
                  </div>
                );
              })}

              {/* Unassigned row if applicable */}
              {(appointmentsByEmployee.get('unassigned')?.length || 0) > 0 && (
                <div
                  className="flex items-center px-3"
                  style={{
                    height: ROW_HEIGHT,
                    borderBottom: '1px solid var(--border-soft)',
                    color: 'var(--text-muted, #888)',
                    fontStyle: 'italic',
                  }}
                  data-testid="staff-name-unassigned"
                >
                  <span
                    className="text-sm truncate"
                    style={{ fontFamily: 'var(--font-body, "DM Sans", sans-serif)' }}
                  >
                    Unassigned
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Right: hour header + appointment grid */}
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Hour header (scrolls horizontally in sync with grid) */}
            <div
              ref={headerRef}
              className="shrink-0 overflow-hidden"
              style={{
                height: HEADER_HEIGHT,
                borderBottom: '1px solid var(--border-soft)',
                background: 'var(--bg-surface, #1a1a1a)',
              }}
              data-testid="hour-header"
            >
              <div className="flex" style={{ width: totalGridWidth }}>
                {HOURS.map((h) => {
                  const isOutsideBusiness = h < openHour || h >= closeHour;
                  // Mark the open/close boundaries with an accent-colored
                  // left border so the transition from "closed" to "open"
                  // hours is visible at a glance. Pre-fix the rgba(0,0,0,0.2)
                  // outside-business overlay was nearly invisible on dark
                  // themes (near-black on near-black) — the user reported
                  // "can't see business hours very easily" on 2026-05-13.
                  const isOpenBoundary = h === openHour && openHour > 0;
                  const isCloseBoundary = h === closeHour && closeHour < 24;
                  return (
                    <div
                      key={h}
                      className="text-center text-[10px] font-bold shrink-0 flex items-center justify-center select-none"
                      style={{
                        width: colW,
                        height: HEADER_HEIGHT,
                        color: isOutsideBusiness
                          ? 'var(--text-muted, #666)'
                          : 'var(--text-secondary, #aaa)',
                        // Bumped from 0.2 → 0.45 so the outside-business
                        // band is clearly visible on both light and dark
                        // themes. Inside-business stays transparent so
                        // the underlying surface color reads through.
                        background: isOutsideBusiness ? 'rgba(0,0,0,0.45)' : 'transparent',
                        borderLeft:
                          isOpenBoundary || isCloseBoundary
                            ? '2px solid var(--accent, #3b82f6)'
                            : undefined,
                        borderRight: '1px solid var(--border-soft)',
                      }}
                      data-testid={`hour-cell-${h}`}
                    >
                      {formatHour(h)}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Scrollable grid area.
              `touch-action: pan-x pan-y pinch-zoom` (2026-05-18, UX
              audit Devices 4.3 row 2): 1-finger touches still fire
              as mouse events for the AppointmentBlock drag handler
              (browser emulation), but 2-finger gestures bypass the
              app entirely and reach the browser — so pinch-zoom
              works AND a 2-finger swipe scrolls the grid even
              while the user's touch starts on a draggable block.
              Without this, the block's mousedown-emulated-from-
              touchstart captured every 2-finger gesture and the
              scheduler felt frozen on iPad. */}
            <div
              ref={gridContainerRef}
              className="flex-1 overflow-auto relative"
              style={{ touchAction: 'pan-x pan-y pinch-zoom' }}
              data-testid="scheduler-grid"
            >
              {loading && (
                <div
                  className="absolute inset-0 flex items-center justify-center z-10"
                  style={{ background: 'rgba(0,0,0,0.15)' }}
                  data-testid="scheduler-loading"
                >
                  <RefreshCw
                    className="w-5 h-5 animate-spin"
                    style={{ color: 'var(--text-secondary)' }}
                  />
                </div>
              )}
              <div style={{ width: totalGridWidth, minHeight: '100%' }}>
                {employees.map((emp) => {
                  const empId = String(emp.employee_id);
                  const empAppointments = appointmentsByEmployee.get(empId) || [];
                  const rowH = getRowHeight(emp);

                  return (
                    <div
                      key={empId}
                      className="relative"
                      style={{
                        height: rowH,
                        borderBottom: '1px solid var(--border-soft)',
                      }}
                      data-testid={`scheduler-row-${empId}`}
                    >
                      {/* Hour slot backgrounds — clickable in hours mode when
                        Quick Book is wired AND the row's employee actually
                        has a shift covering this hour (audit P1 #4 +
                        out-of-hours fix). Cells outside the employee's
                        shift stay passive: booking those would be
                        rejected by the RPC with EMPLOYEE_NOT_SCHEDULED, so
                        a clickable affordance there would be a broken
                        invitation. The global `isOutsideBusiness` band is
                        still used for the visual shading (the building's
                        overall open window vs. a single employee's day off
                        within open hours both render shaded — but only
                        the per-employee gate decides clickability). */}
                      <div className="absolute inset-0 flex">
                        {HOURS.map((h) => {
                          const isOutsideBusiness = h < openHour || h >= closeHour;
                          const employeeWorking =
                            viewMode === 'hours' && isEmployeeWorkingAt(empId, h);
                          const isClickable = !!onQuickBook && employeeWorking;
                          return (
                            <div
                              key={h}
                              role={isClickable ? 'button' : undefined}
                              aria-label={
                                isClickable ? `Book ${emp.name} at ${formatHour(h)}` : undefined
                              }
                              tabIndex={isClickable ? 0 : undefined}
                              onClick={isClickable ? () => handleSlotClick(empId, h) : undefined}
                              onKeyDown={
                                isClickable
                                  ? (e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        handleSlotClick(empId, h);
                                      }
                                    }
                                  : undefined
                              }
                              className={`shrink-0${isClickable ? ' cursor-pointer hover:bg-[rgba(59,130,246,0.08)]' : ''}`}
                              style={{
                                width: colW,
                                height: rowH,
                                background: isOutsideBusiness ? 'rgba(0,0,0,0.35)' : 'transparent',
                                borderRight: '1px solid var(--border-soft)',
                              }}
                              data-testid={`slot-${empId}-${h}`}
                            />
                          );
                        })}
                      </div>

                      {/* Hours mode: shift bar + appointment blocks */}
                      {viewMode === 'hours' && (
                        <>
                          <ShiftBar shifts={shiftsByEmployee.get(empId) || []} colW={colW} />
                          {empAppointments.map((appt) => (
                            <AppointmentBlockNew
                              key={appt.appointment_id}
                              appointment={appt}
                              colW={colW}
                              services={services}
                              onClick={handleAppointmentClick}
                              onDelete={handleApptCancel}
                              onMove={handleApptMove}
                            />
                          ))}
                        </>
                      )}

                      {/* Skills mode: stacked skill bars (Item #5) */}
                      {viewMode === 'skills' && (
                        <SkillBars
                          employee={emp}
                          employeeSkills={employeeSkillsMap.get(empId) || []}
                          shifts={shiftsByEmployee.get(empId) || []}
                          colW={colW}
                          skillColorMap={skillColorMap}
                          openHour={openHour}
                          closeHour={closeHour}
                        />
                      )}
                    </div>
                  );
                })}

                {/* Unassigned row */}
                {viewMode === 'hours' &&
                  (appointmentsByEmployee.get('unassigned')?.length || 0) > 0 && (
                    <div
                      className="relative"
                      style={{
                        height: ROW_HEIGHT,
                        borderBottom: '1px solid var(--border-soft)',
                      }}
                      data-testid="scheduler-row-unassigned"
                    >
                      <div className="absolute inset-0 flex">
                        {HOURS.map((h) => {
                          const isOutsideBusiness = h < openHour || h >= closeHour;
                          return (
                            <div
                              key={h}
                              className="shrink-0"
                              style={{
                                width: colW,
                                height: ROW_HEIGHT,
                                background: isOutsideBusiness ? 'rgba(0,0,0,0.35)' : 'transparent',
                                borderLeft:
                                  (h === openHour && openHour > 0) ||
                                  (h === closeHour && closeHour < 24)
                                    ? '2px solid var(--accent, #3b82f6)'
                                    : undefined,
                                borderRight: '1px solid var(--border-soft)',
                              }}
                            />
                          );
                        })}
                      </div>

                      {(appointmentsByEmployee.get('unassigned') || []).map((appt) => (
                        <AppointmentBlockNew
                          key={appt.appointment_id}
                          appointment={appt}
                          colW={colW}
                          services={services}
                          onClick={handleAppointmentClick}
                          onDelete={handleApptCancel}
                          onMove={handleApptMove}
                        />
                      ))}
                    </div>
                  )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Staff Profile Card (Item #4) */}
      {profileCard && profileCardEmployee && profileCardData && (
        <StaffProfileCard
          employee={profileCardEmployee}
          todayApptCount={profileCardData.todayApptCount}
          todayHours={profileCardData.todayHours}
          shiftStart={profileCardData.shiftStart}
          shiftEnd={profileCardData.shiftEnd}
          skills={employeeSkillsMap.get(profileCard.employeeId) || []}
          anchorRect={profileCard.anchorRect}
          onClose={handleProfileCardClose}
          onMarkOff={handleMarkOffClick}
          markOffLabel={markOffButtonLabel}
          isMarkingOff={markingOff}
        />
      )}

      <ConfirmModal
        isOpen={confirmState.isOpen}
        onClose={closeConfirm}
        onConfirm={confirmState.onConfirm}
        title={confirmState.title}
        message={confirmState.message}
        confirmLabel={confirmState.confirmLabel}
        confirmVariant={confirmState.confirmVariant}
        loading={markingOff}
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
          onClose={handleApptPopoverClose}
          onCancel={handleApptCancel}
        />
      )}
    </div>
  );
}

// --- Shift bar sub-component (Hours mode) ---

interface ShiftBarProps {
  shifts: { start_time?: string; end_time?: string }[];
  colW: number;
}

function ShiftBar({ shifts, colW }: ShiftBarProps) {
  if (shifts.length === 0) return null;

  return (
    <div className="absolute inset-0" style={{ pointerEvents: 'none', zIndex: 1 }}>
      {shifts.map((shift, i) => {
        if (!shift.start_time || !shift.end_time) return null;
        const startH = shiftTimeToHour(shift.start_time);
        const endH = shiftTimeToHour(shift.end_time);
        const left = startH * colW;
        const width = (endH - startH) * colW;

        return (
          <div
            key={i}
            className="absolute rounded-md transition-all hover:brightness-110"
            style={{
              left,
              width: Math.max(width, 8),
              top: 6,
              bottom: 6,
              background: 'var(--accent, #3b82f6)',
              opacity: 0.85,
              zIndex: 2,
            }}
            title={`${formatTime24to12(shift.start_time.substring(0, 5))} - ${formatTime24to12(shift.end_time.substring(0, 5))}`}
            data-testid={`shift-bar-${i}`}
          >
            {width > 90 && (
              <span
                className="absolute inset-0 flex items-center px-2 text-[11px] font-bold truncate"
                style={{ color: 'var(--primary-text)', textShadow: '0 1px 2px rgba(0,0,0,0.15)' }}
              >
                {formatTime24to12(shift.start_time.substring(0, 5))} –{' '}
                {formatTime24to12(shift.end_time.substring(0, 5))}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- Skill bars sub-component (Item #5) ---

interface SkillBarsProps {
  employee: Employee;
  employeeSkills: string[];
  shifts: { start_time?: string; end_time?: string }[];
  colW: number;
  skillColorMap: Map<string, string>;
  openHour: number;
  closeHour: number;
}

function SkillBars({
  employee,
  employeeSkills,
  shifts,
  colW,
  skillColorMap,
  openHour,
  closeHour,
}: SkillBarsProps) {
  const skills = employeeSkills;
  if (skills.length === 0) return null;

  // Determine shift hours (fallback to business hours)
  let shiftStartH = openHour;
  let shiftEndH = closeHour;
  if (shifts.length > 0 && shifts[0].start_time && shifts[0].end_time) {
    shiftStartH = shiftTimeToHour(shifts[0].start_time);
    shiftEndH = shiftTimeToHour(shifts[0].end_time);
  }

  const barLeft = shiftStartH * colW;
  const barWidth = (shiftEndH - shiftStartH) * colW;

  return (
    <div className="absolute inset-0" style={{ pointerEvents: 'none', zIndex: 2 }}>
      {skills.map((skill, i) => {
        const color = skillColorMap.get(skill) || '#666';
        return (
          <div
            key={skill}
            className="absolute rounded-sm overflow-hidden"
            style={{
              left: barLeft,
              width: Math.max(barWidth, 4),
              top: 5 + i * SKILL_BAR_HEIGHT,
              height: SKILL_BAR_HEIGHT - 3,
              background: color,
              opacity: 0.8,
            }}
            title={skill}
            data-testid={`skill-bar-${employee.employee_id}-${i}`}
          >
            {/* Label at left edge — hide if bar is too narrow */}
            {barWidth > 50 && (
              <span
                className="text-[10px] font-bold px-1.5 leading-tight block truncate"
                style={{
                  color: '#fff',
                  fontFamily: 'var(--font-body, "DM Sans", sans-serif)',
                  lineHeight: `${SKILL_BAR_HEIGHT - 3}px`,
                }}
              >
                {skill}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- Appointment block sub-component ---

interface AppointmentBlockNewProps {
  appointment: SchedulerAppointment;
  colW: number;
  services: Service[];
  onClick?: (appointment: SchedulerAppointment, e: React.MouseEvent) => void;
  /**
   * Always-visible trash → soft-cancel. Parent owns confirm + API.
   * Hidden for already-canceled rows, during drag, and on very narrow
   * blocks (where the icon would cover the customer-name span).
   * Visibility was previously `opacity-0 group-hover:opacity-100`,
   * making the affordance invisible on touch + keyboard (UX audit #2,
   * 2026-05-18).
   */
  onDelete?: (appointmentId: string) => void;
  /**
   * Outlook-style drag-to-move (Staff sub-tab). Parent receives the
   * 15-min-snapped delta and computes/persists the new start_time +
   * end_time via Api.appointments.update. Click-vs-drag is
   * disambiguated by the 4px threshold below.
   */
  onMove?: (appointmentId: string, deltaMinutes: number) => void;
}

// Same constants as scheduler/AppointmentBlock.tsx — keep in sync if
// either value changes. 4px is the standard click-vs-drag threshold;
// 15 min matches the booking-form grid.
const NEW_CLICK_DRAG_THRESHOLD_PX = 4;
const NEW_SNAP_MIN = 15;

function AppointmentBlockNew({
  appointment,
  colW,
  services,
  onClick,
  onDelete,
  onMove,
}: AppointmentBlockNewProps) {
  const startH = toFractionalHour(appointment.start_time);
  const endH = toFractionalHour(appointment.end_time);
  const duration = Math.max(endH - startH, 0.25); // min 15 min visual

  const left = startH * colW;
  const width = duration * colW;

  const customerName = appointment.customers?.name || 'Unknown';
  const serviceName = findServiceName(appointment.description, services);
  const statusColors = getStatusColor(appointment.status);
  const isCanceled = appointment.status === 'canceled';

  // Drag state. Same shape as scheduler/AppointmentBlock.tsx but with
  // pixel-positioned math (colW px per hour, not percentage of parent).
  const [drag, setDrag] = useState<{ startX: number; deltaPx: number } | null>(null);
  const dragRef = useRef<typeof drag>(null);
  dragRef.current = drag;
  const minutesPerPx = 60 / colW;

  useEffect(() => {
    if (!drag) return;
    const onMouseMove = (e: MouseEvent) => {
      const cur = dragRef.current;
      if (!cur) return;
      setDrag({ ...cur, deltaPx: e.clientX - cur.startX });
    };
    const onMouseUp = () => {
      const cur = dragRef.current;
      if (!cur) return;
      const deltaPx = cur.deltaPx;
      setDrag(null);
      if (Math.abs(deltaPx) < NEW_CLICK_DRAG_THRESHOLD_PX) return; // click, not drag
      const rawMinutes = deltaPx * minutesPerPx;
      const deltaMinutes = Math.round(rawMinutes / NEW_SNAP_MIN) * NEW_SNAP_MIN;
      if (deltaMinutes !== 0 && onMove) {
        onMove(appointment.appointment_id, deltaMinutes);
      }
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [drag, minutesPerPx, appointment.appointment_id, onMove]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!onMove || isCanceled || e.button !== 0) return;
    setDrag({ startX: e.clientX, deltaPx: 0 });
  };

  const handleTrashClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDelete) onDelete(appointment.appointment_id);
  };

  const isDragging = drag !== null && Math.abs(drag.deltaPx) >= NEW_CLICK_DRAG_THRESHOLD_PX;
  const dragStyle = drag
    ? { transform: `translateX(${drag.deltaPx}px)`, opacity: 0.7, zIndex: 20 as const }
    : {};
  // Hide the trash on very narrow blocks — at <40px the icon eats the
  // customer-name span. Block click still opens the popover where
  // Cancel is available, so narrow-block users aren't locked out.
  const isNarrowBlock = width < 40;
  const showTrash = onDelete && !isCanceled && !isDragging && !isNarrowBlock;
  // Drag-to-move discoverability — see AppointmentBlock.tsx for the
  // rationale. Without a visible handle, the cursor:move cue is
  // invisible on touch and on quick scans (UX audit #6, 2026-05-18).
  const showDragHandle = !!onMove && !isCanceled && !isDragging && !isNarrowBlock;
  const moveHintTitle =
    onMove && !isCanceled
      ? `${customerName} — ${serviceName}\nDrag to move · click for details`
      : `${customerName} — ${serviceName}`;

  return (
    <div
      className={`group absolute rounded px-1.5 py-0.5 text-xs font-bold truncate transition-opacity hover:opacity-90 ${isCanceled ? 'cursor-pointer' : onMove ? 'cursor-move' : 'cursor-pointer'}`}
      style={{
        left,
        width: Math.max(width, 20),
        top: 4,
        bottom: 4,
        background: statusColors.bg,
        border: `1px solid ${statusColors.border}`,
        color: statusColors.text,
        zIndex: drag ? 20 : 2,
        fontFamily: 'var(--font-body, "DM Sans", sans-serif)',
        ...dragStyle,
      }}
      title={moveHintTitle}
      onMouseDown={handleMouseDown}
      onClick={(e) => onClick?.(appointment, e)}
      data-testid={`appt-block-${appointment.appointment_id}`}
    >
      {showDragHandle && (
        <span
          className="absolute left-0 top-1/2 -translate-y-1/2 opacity-40 pointer-events-none"
          aria-hidden="true"
          data-testid={`appt-block-drag-handle-${appointment.appointment_id}`}
        >
          <GripVertical className="w-3 h-3" style={{ color: statusColors.text }} />
        </span>
      )}
      <span className={`block truncate leading-tight${showDragHandle ? ' pl-3' : ''}`}>
        {customerName}
      </span>
      {width > 60 && (
        <span
          className={`block truncate leading-tight text-[10px] opacity-80${showDragHandle ? ' pl-3' : ''}`}
        >
          {serviceName}
        </span>
      )}
      {showTrash && (
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={handleTrashClick}
          className="absolute top-0 right-0 p-1.5 rounded opacity-70 hover:opacity-100 focus-visible:opacity-100 hover:bg-black/30 focus-visible:bg-black/30 focus-visible:outline-none transition-opacity"
          title="Cancel this appointment"
          aria-label="Cancel appointment"
          data-testid={`appt-block-delete-${appointment.appointment_id}`}
        >
          <X className="w-3 h-3" style={{ color: statusColors.text }} />
        </button>
      )}
    </div>
  );
}
