'use client';

import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { Clock, Plus, Trash2, Users, Minus, ChevronLeft, ChevronRight, Copy } from 'lucide-react';
import { Api } from '../lib/api';
import { formatTime24to12, formatHour, shiftTimeToHour } from '../lib/utils';
import { useStaticData } from '../lib/hooks';
import { useActiveTenantId } from '../lib/SessionContext';
import { useVocabulary } from '@/lib/VocabularyContext';
import type { EffectiveShift } from '../lib/types';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { TimeInput } from './ui/TimeInput';
import { showToast } from './ui/Toast';
import { ConfirmModal } from './ui/ConfirmModal';
import { useConfirm } from '../lib/useConfirm';
import { LoadingState } from './ui/LoadingState';

// Timeline constants
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DEFAULT_COL_W = 72;
const MIN_COL_W = 36;
const MAX_COL_W = 140;
const ZOOM_STEP = 16;
const ROW_HEIGHT = 48;
const HEADER_HEIGHT = 32;
const DAY_LABEL_WIDTH = 120;
const DEFAULT_OPEN_HOUR = 8;
const DEFAULT_CLOSE_HOUR = 17;

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatWeekLabel(weekStart: Date): string {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `Week of ${months[weekStart.getMonth()]} ${weekStart.getDate()}, ${weekStart.getFullYear()}`;
}

function getZoomPercent(colW: number): number {
  return Math.round((colW / DEFAULT_COL_W) * 100);
}

// ── Solo Schedule View ────────────────────────────────────────────────────
// Mon-Sun weekly grid for single-employee tenants. Replaces the full team
// timeline (zoom, week nav, employee picker) with a simple form that maps
// to how a solo operator actually thinks: "what days do I work and what
// hours?" Writes via expandWeekly so bookings honour the schedule immediately.

const WEEK_DAYS = [
  { id: 1, label: 'Mon' },
  { id: 2, label: 'Tue' },
  { id: 3, label: 'Wed' },
  { id: 4, label: 'Thu' },
  { id: 5, label: 'Fri' },
  { id: 6, label: 'Sat' },
  { id: 0, label: 'Sun' },
];

interface DayRow {
  day_of_week: number;
  active: boolean;
  start_time: string;
  end_time: string;
}

function SoloScheduleView({
  tenantId,
  employeeId,
  employeeName,
}: {
  tenantId: string | null;
  employeeId: string;
  employeeName: string;
}) {
  const [rows, setRows] = useState<DayRow[]>(
    WEEK_DAYS.map((d) => ({
      day_of_week: d.id,
      active: [1, 2, 3, 4, 5].includes(d.id), // Mon-Fri on by default
      start_time: '08:00',
      end_time: '17:00',
    }))
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function toggle(dow: number) {
    setRows((prev) =>
      prev.map((r) => (r.day_of_week === dow ? { ...r, active: !r.active } : r))
    );
    setSaved(false);
  }

  function updateTime(dow: number, field: 'start_time' | 'end_time', val: string) {
    setRows((prev) =>
      prev.map((r) => (r.day_of_week === dow ? { ...r, [field]: val } : r))
    );
    setSaved(false);
  }

  async function handleSave() {
    if (!tenantId) return;
    setSaving(true);
    try {
      const pattern = rows
        .filter((r) => r.active)
        .map((r) => ({
          day_of_week: r.day_of_week,
          start_time: r.start_time,
          end_time: r.end_time,
        }));
      await Api.shifts.expandWeekly(tenantId, employeeId, pattern);
      setSaved(true);
      showToast('Schedule saved', 'success');
    } catch {
      showToast('Failed to save schedule', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="flex-1 overflow-y-auto p-8"
      style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
    >
      <header className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div
            className="p-2 rounded-lg"
            style={{ backgroundColor: 'var(--accent-muted)', color: 'var(--accent-soft)' }}
          >
            <Clock className="w-5 h-5" />
          </div>
          <h1 className="text-2xl font-display">Working Days</h1>
        </div>
        <p className="text-sm ml-11" style={{ color: 'var(--text-secondary)' }}>
          {employeeName} — which days do you work and what hours?
        </p>
      </header>

      <div className="max-w-lg space-y-2 mb-6">
        {WEEK_DAYS.map(({ id, label }) => {
          const row = rows.find((r) => r.day_of_week === id)!;
          return (
            <div
              key={id}
              className="flex items-center gap-3 p-3 rounded-xl border transition-colors"
              style={{
                borderColor: row.active ? 'var(--accent)' : 'var(--border-soft)',
                backgroundColor: row.active ? 'var(--accent-muted)' : 'var(--bg-raised)',
              }}
            >
              {/* Day toggle */}
              <button
                type="button"
                onClick={() => toggle(id)}
                className="w-12 text-sm font-bold shrink-0 text-left"
                style={{ color: row.active ? 'var(--accent-soft)' : 'var(--text-muted)' }}
                aria-label={`Toggle ${label}`}
              >
                {label}
              </button>

              {row.active ? (
                <>
                  <TimeInput
                    value={row.start_time}
                    onChange={(v) => updateTime(id, 'start_time', v)}
                    aria-label={`${label} start time`}
                  />
                  <span className="text-sm shrink-0" style={{ color: 'var(--text-muted)' }}>to</span>
                  <TimeInput
                    value={row.end_time}
                    onChange={(v) => updateTime(id, 'end_time', v)}
                    aria-label={`${label} end time`}
                  />
                </>
              ) : (
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Off</span>
              )}

              {/* Quick toggle button */}
              <button
                type="button"
                onClick={() => toggle(id)}
                className="ml-auto text-xs px-2.5 py-1 rounded-md min-h-[36px] transition-colors"
                style={{
                  backgroundColor: row.active ? 'var(--accent)' : 'var(--bg-surface)',
                  color: row.active ? 'var(--primary-text)' : 'var(--text-muted)',
                  border: '1px solid var(--border-soft)',
                }}
              >
                {row.active ? 'Working' : 'Off'}
              </button>
            </div>
          );
        })}
      </div>

      <Button
        variant="primary"
        onClick={() => void handleSave()}
        isLoading={saving}
        disabled={saving}
      >
        {saved ? 'Saved!' : 'Save schedule'}
      </Button>
      <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
        Saves your working days for the next 4 weeks. Callers can only book during these hours.
      </p>
    </div>
  );
}

// ── Main Component (team mode) ───────────────────────────────────────────────
export default function ShiftManagementView() {
  const tenantId = useActiveTenantId();
  const { employees, loading: empsLoading } = useStaticData(tenantId);
  const vocab = useVocabulary();

  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()));
  const [scheduledShifts, setScheduledShifts] = useState<EffectiveShift[]>([]);
  const [loadingShifts, setLoadingShifts] = useState(false);
  const { state: confirmState, confirm: confirmAction, close: closeConfirm } = useConfirm();

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDate, setEditingDate] = useState<string | null>(null);
  // After pilot #3 (composite-key retrofit, 2026-05-18) the shift is
  // identified by (employee_id, shift_date) instead of a surrogate UUID.
  // editingDate already holds the date; we just remember whether the
  // shift currently exists in employee_schedule (vs being purely a
  // weekly-pattern projection that's never been overridden).
  const [editingExistsAsOverride, setEditingExistsAsOverride] = useState<boolean>(false);
  const [modalForm, setModalForm] = useState({
    start_time: '08:00',
    end_time: '17:00',
    is_off: false,
  });

  // Timeline state
  const [colW, setColW] = useState(DEFAULT_COL_W);
  const gridRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const hasAutoScrolled = useRef(false);
  const totalGridWidth = 24 * colW;

  // Auto-select first employee when list loads
  useEffect(() => {
    if (!selectedEmployeeId && employees.length > 0) {
      setSelectedEmployeeId(employees[0].employee_id);
    }
  }, [employees, selectedEmployeeId]);

  // Fetch scheduled shifts when employee or week changes
  useEffect(() => {
    if (!selectedEmployeeId || !tenantId) {
      setScheduledShifts([]);
      return;
    }
    void fetchShifts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmployeeId, tenantId, weekStart]);

  async function fetchShifts() {
    if (!selectedEmployeeId || !tenantId) return;
    setLoadingShifts(true);
    try {
      const endDate = new Date(weekStart);
      endDate.setDate(endDate.getDate() + 6);
      const data = await Api.shifts.schedule.forDate(
        tenantId,
        selectedEmployeeId,
        toDateStr(weekStart),
        toDateStr(endDate)
      );
      setScheduledShifts(Array.isArray(data) ? data : []);
    } catch {
      setScheduledShifts([]);
    } finally {
      setLoadingShifts(false);
    }
  }

  // Auto-scroll to business hours
  useEffect(() => {
    if (hasAutoScrolled.current || !gridRef.current) return;
    gridRef.current.scrollLeft = (DEFAULT_OPEN_HOUR - 1) * colW;
    hasAutoScrolled.current = true;
  }, [colW, selectedEmployeeId]);

  const handleGridScroll = useCallback(() => {
    if (gridRef.current && headerRef.current) {
      headerRef.current.scrollLeft = gridRef.current.scrollLeft;
    }
  }, []);

  // Week navigation
  const prevWeek = () =>
    setWeekStart((d) => {
      const n = new Date(d);
      n.setDate(n.getDate() - 7);
      return n;
    });
  const nextWeek = () =>
    setWeekStart((d) => {
      const n = new Date(d);
      n.setDate(n.getDate() + 7);
      return n;
    });
  const goToday = () => setWeekStart(getWeekStart(new Date()));

  // Build 7-day array
  const weekDays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + i);
        return {
          date: d,
          dateStr: toDateStr(d),
          label: `${DAY_NAMES[d.getDay()]} ${formatDate(d)}`,
          isToday: toDateStr(d) === toDateStr(new Date()),
        };
      }),
    [weekStart]
  );

  // Find shift for a date
  function shiftForDate(dateStr: string): EffectiveShift | undefined {
    return scheduledShifts.find((s) => s.shift_date.substring(0, 10) === dateStr);
  }

  // Open editor for a day
  function openEditor(dateStr: string) {
    const existing = shiftForDate(dateStr);
    setEditingDate(dateStr);
    // is_override === true means the row exists in employee_schedule
    // (was either created via /shifts/overrides/create or by the wizard's
    // expand-weekly fan-out). false means we're seeing a weekly-pattern
    // projection that has never been overridden — delete is a no-op for
    // those because there's no row to remove.
    setEditingExistsAsOverride(!!existing?.is_override);
    if (existing && !existing.is_off && existing.start_time && existing.end_time) {
      setModalForm({
        start_time: existing.start_time.substring(0, 5),
        end_time: existing.end_time.substring(0, 5),
        is_off: false,
      });
    } else {
      setModalForm({ start_time: '08:00', end_time: '17:00', is_off: false });
    }
    setIsModalOpen(true);
  }

  async function handleSave() {
    if (!selectedEmployeeId || !tenantId || !editingDate) return;
    if (!modalForm.is_off) {
      if (!modalForm.start_time || !modalForm.end_time) {
        showToast('Start and end times are required', 'error');
        return;
      }
      if (modalForm.start_time >= modalForm.end_time) {
        showToast('End time must be after start time', 'error');
        return;
      }
    }
    try {
      await Api.shifts.schedule.save(tenantId, {
        employee_id: selectedEmployeeId,
        shift_date: editingDate,
        start_time: modalForm.is_off ? undefined : modalForm.start_time,
        end_time: modalForm.is_off ? undefined : modalForm.end_time,
        is_off: modalForm.is_off,
      });
      setIsModalOpen(false);
      void fetchShifts();
    } catch {
      showToast('Failed to save schedule', 'error');
    }
  }

  async function handleDelete(dateStr: string) {
    if (!tenantId || !selectedEmployeeId) return;
    try {
      await Api.shifts.schedule.remove(selectedEmployeeId, dateStr, tenantId);
      void fetchShifts();
    } catch {
      showToast('Failed to remove schedule', 'error');
    }
  }

  async function handleClearDay(dateStr: string) {
    if (!selectedEmployeeId || !tenantId) return;
    try {
      await Api.shifts.schedule.save(tenantId, {
        employee_id: selectedEmployeeId,
        shift_date: dateStr,
        is_off: true,
      });
      void fetchShifts();
    } catch {
      showToast('Failed to clear schedule', 'error');
    }
  }

  const [copying, setCopying] = useState(false);

  function handleCopyToNextWeek() {
    if (!selectedEmployeeId || !tenantId) return;
    const hasAnyShift = scheduledShifts.some((s) => !s.is_off && s.start_time && s.end_time);
    if (!hasAnyShift) {
      showToast('No shifts to copy — schedule at least one day first', 'warning');
      return;
    }
    const nextWeekStart = new Date(weekStart);
    nextWeekStart.setDate(nextWeekStart.getDate() + 7);
    confirmAction({
      title: 'Copy Week Forward',
      message: `Copy this week's schedule to ${formatWeekLabel(nextWeekStart)}? Any existing shifts that week will be overwritten.`,
      confirmLabel: 'Copy',
      confirmVariant: 'primary',
      onConfirm: async () => {
        closeConfirm();
        setCopying(true);
        try {
          const result = await Api.shifts.copyWeek(
            tenantId,
            selectedEmployeeId,
            toDateStr(weekStart),
            toDateStr(nextWeekStart)
          );
          showToast(
            `Copied ${result.copied} shift${result.copied === 1 ? '' : 's'} to next week`,
            'success'
          );
        } catch {
          showToast('Failed to copy shifts', 'error');
        } finally {
          setCopying(false);
        }
      },
    });
  }

  const handleZoomIn = useCallback(
    () => setColW((prev) => Math.min(prev + ZOOM_STEP, MAX_COL_W)),
    []
  );
  const handleZoomOut = useCallback(
    () => setColW((prev) => Math.max(prev - ZOOM_STEP, MIN_COL_W)),
    []
  );
  const activeEmployees = useMemo(
    () => employees.filter((e) => e.type === 'employee'),
    [employees]
  );

  if (empsLoading && activeEmployees.length === 0) {
    return <LoadingState message={`Loading ${vocab.employee_label.toLowerCase()} schedule…`} />;
  }

  // Solo path — single employee gets a simple Mon-Sun grid instead of
  // the full team timeline with zoom, employee picker, week navigator.
  // 2026-05-28 P1 UX fix: a baker/solo stylist shouldn't need a timeline
  // built for 10-person shops. Writes via the same expandWeekly API used
  // by the setup wizard so data format is identical.
  if (activeEmployees.length === 1) {
    return (
      <SoloScheduleView
        tenantId={tenantId}
        employeeId={activeEmployees[0].employee_id}
        employeeName={activeEmployees[0].first_name || activeEmployees[0].name}
      />
    );
  }

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden p-8 transition-colors duration-200"
      style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
    >
      <header className="mb-4 shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center">
            <div
              className="p-2 rounded-lg mr-4"
              style={{ backgroundColor: 'var(--accent-muted)', color: 'var(--accent-soft)' }}
            >
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-3xl font-display">{vocab.employee_label} Schedule</h1>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Schedule your team&apos;s working hours by date.
              </p>
            </div>
          </div>
        </div>

        {/* Employee selector */}
        <div className="mb-4" data-testid="shift-employee-selector">
          <label
            className="text-[10px] font-bold uppercase tracking-widest mb-2 block"
            style={{ color: 'var(--text-muted)' }}
          >
            Select {vocab.employee_label}
          </label>
          <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
            {activeEmployees.map((emp) => (
              <button
                key={emp.employee_id}
                onClick={() => {
                  setSelectedEmployeeId(emp.employee_id);
                  hasAutoScrolled.current = false;
                }}
                className={`px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition-all ${selectedEmployeeId === emp.employee_id ? 'text-white shadow-lg scale-105' : ''}`}
                style={
                  selectedEmployeeId === emp.employee_id
                    ? { backgroundColor: 'var(--accent)' }
                    : { backgroundColor: 'var(--bg-raised)', color: 'var(--text-secondary)' }
                }
                data-testid={`shift-employee-${emp.employee_id}`}
              >
                {emp.name}
              </button>
            ))}
            {activeEmployees.length === 0 && (
              <p className="text-sm italic" style={{ color: 'var(--text-muted)' }}>
                No {vocab.employee_plural.toLowerCase()} found. Add them in {vocab.employee_label}{' '}
                Management first.
              </p>
            )}
          </div>
        </div>

        {/* Week navigation + controls */}
        {selectedEmployeeId && (
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <button
                onClick={prevWeek}
                className="p-1.5 rounded-lg transition-colors"
                style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-raised)' }}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-bold min-w-[200px] text-center">
                {formatWeekLabel(weekStart)}
              </span>
              <button
                onClick={nextWeek}
                className="p-1.5 rounded-lg transition-colors"
                style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-raised)' }}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                onClick={goToday}
                className="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-raised)' }}
              >
                Today
              </button>
              <button
                onClick={handleCopyToNextWeek}
                disabled={copying || loadingShifts}
                className="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 disabled:opacity-40"
                style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-raised)' }}
                title="Copy this week's schedule to next week"
              >
                <Copy className="w-3.5 h-3.5" />
                {copying ? 'Copying...' : 'Copy to Next Week'}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <div
                className="flex items-center gap-0 rounded-lg overflow-hidden"
                style={{ border: '1px solid var(--border-soft)' }}
              >
                <button
                  onClick={handleZoomOut}
                  disabled={colW <= MIN_COL_W}
                  className="p-1.5 transition-colors disabled:opacity-30"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span
                  className="text-xs font-bold px-2 select-none"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {getZoomPercent(colW)}%
                </span>
                <button
                  onClick={handleZoomIn}
                  disabled={colW >= MAX_COL_W}
                  className="p-1.5 transition-colors disabled:opacity-30"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Timeline */}
      <div className="flex-1 overflow-hidden">
        {!selectedEmployeeId ? (
          <div
            className="h-full flex flex-col items-center justify-center rounded-3xl border-2 border-dashed"
            style={{ backgroundColor: 'var(--bg-raised)', borderColor: 'var(--border-soft)' }}
          >
            <Users className="w-12 h-12 mb-4" style={{ color: 'var(--text-muted)' }} />
            <p className="font-medium" style={{ color: 'var(--text-secondary)' }}>
              Select an {vocab.employee_label.toLowerCase()} to manage their schedule
            </p>
          </div>
        ) : (
          <div
            className="h-full flex flex-col rounded-2xl border overflow-hidden relative"
            style={{ backgroundColor: 'var(--bg-raised)', borderColor: 'var(--border-soft)' }}
          >
            {/* Header */}
            <div className="flex shrink-0" style={{ borderBottom: '1px solid var(--border-soft)' }}>
              <div
                className="shrink-0 flex items-center px-3 text-[10px] font-bold uppercase tracking-widest"
                style={{
                  width: DAY_LABEL_WIDTH,
                  height: HEADER_HEIGHT,
                  color: 'var(--text-muted)',
                  borderRight: '1px solid var(--border-soft)',
                }}
              >
                Date
              </div>
              <div ref={headerRef} className="flex-1 overflow-hidden">
                <div className="flex" style={{ width: totalGridWidth }}>
                  {HOURS.map((h) => (
                    <div
                      key={h}
                      className="text-center text-[10px] font-bold shrink-0 flex items-center justify-center select-none"
                      style={{
                        width: colW,
                        height: HEADER_HEIGHT,
                        color: 'var(--text-muted)',
                        background:
                          h < DEFAULT_OPEN_HOUR || h >= DEFAULT_CLOSE_HOUR
                            ? 'rgba(0,0,0,0.2)'
                            : 'transparent',
                        borderRight: '1px solid var(--border-soft)',
                      }}
                    >
                      {formatHour(h)}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Day rows */}
            <div className="flex-1 overflow-y-auto flex">
              <div className="shrink-0" style={{ width: DAY_LABEL_WIDTH }}>
                {weekDays.map((day) => (
                  <div
                    key={day.dateStr}
                    className="flex items-center px-3 cursor-pointer hover:brightness-110 transition-all"
                    style={{
                      height: ROW_HEIGHT,
                      borderBottom: '1px solid var(--border-soft)',
                      borderRight: '1px solid var(--border-soft)',
                      backgroundColor: day.isToday ? 'rgba(59,130,246,0.08)' : undefined,
                    }}
                    onClick={() => openEditor(day.dateStr)}
                  >
                    <span
                      className="font-bold text-sm"
                      style={{
                        color: day.isToday
                          ? 'var(--accent, #3b82f6)'
                          : shiftForDate(day.dateStr)
                            ? 'var(--text-primary)'
                            : 'var(--text-muted)',
                      }}
                    >
                      {day.label}
                    </span>
                  </div>
                ))}
              </div>

              <div ref={gridRef} className="flex-1 overflow-x-auto" onScroll={handleGridScroll}>
                <div style={{ width: totalGridWidth }}>
                  {weekDays.map((day) => {
                    const shift = shiftForDate(day.dateStr);
                    const hasShift = shift && !shift.is_off && shift.start_time && shift.end_time;

                    return (
                      <div
                        key={day.dateStr}
                        className="relative"
                        style={{
                          height: ROW_HEIGHT,
                          borderBottom: '1px solid var(--border-soft)',
                          backgroundColor: day.isToday ? 'rgba(59,130,246,0.04)' : undefined,
                        }}
                      >
                        <div className="absolute inset-0 flex">
                          {HOURS.map((h) => (
                            <div
                              key={h}
                              className="shrink-0"
                              style={{
                                width: colW,
                                height: ROW_HEIGHT,
                                background:
                                  h < DEFAULT_OPEN_HOUR || h >= DEFAULT_CLOSE_HOUR
                                    ? 'rgba(0,0,0,0.15)'
                                    : 'transparent',
                                borderRight: '1px solid var(--border-soft)',
                              }}
                            />
                          ))}
                        </div>

                        {hasShift && (
                          <div
                            className="absolute group cursor-pointer rounded-md transition-all hover:brightness-110"
                            style={{
                              left: shiftTimeToHour(shift.start_time!) * colW,
                              width: Math.max(
                                (shiftTimeToHour(shift.end_time!) -
                                  shiftTimeToHour(shift.start_time!)) *
                                  colW,
                                8
                              ),
                              top: 6,
                              bottom: 6,
                              background: 'var(--accent, #3b82f6)',
                              opacity: 0.85,
                              zIndex: 2,
                            }}
                            onClick={() => openEditor(day.dateStr)}
                            title={`${formatTime24to12(shift.start_time!.substring(0, 5))} - ${formatTime24to12(shift.end_time!.substring(0, 5))}`}
                          >
                            {(shiftTimeToHour(shift.end_time!) -
                              shiftTimeToHour(shift.start_time!)) *
                              colW >
                              90 && (
                              <span
                                className="absolute inset-0 flex items-center px-2 text-[11px] font-bold text-white truncate"
                                style={{ textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}
                              >
                                {formatTime24to12(shift.start_time!.substring(0, 5))} –{' '}
                                {formatTime24to12(shift.end_time!.substring(0, 5))}
                              </span>
                            )}
                            <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  confirmAction({
                                    title: 'Delete Shift',
                                    message: `Remove this shift for ${day.label}?`,
                                    confirmLabel: 'Delete',
                                    onConfirm: () => {
                                      closeConfirm();
                                      if (shift.is_override) {
                                        void handleDelete(day.dateStr);
                                      } else {
                                        void handleClearDay(day.dateStr);
                                      }
                                    },
                                  });
                                }}
                                className="p-1 rounded-md hover:bg-white/20 transition-colors"
                                title="Delete shift"
                              >
                                <Trash2 className="w-3.5 h-3.5 text-white" />
                              </button>
                            </div>
                          </div>
                        )}

                        {shift?.is_off && (
                          <div
                            className="absolute inset-0 flex items-center justify-center"
                            style={{ zIndex: 2 }}
                          >
                            <span
                              className="text-[10px] font-bold px-2 py-0.5 rounded"
                              style={{ backgroundColor: 'rgba(239,68,68,0.15)', color: '#ef4444' }}
                            >
                              OFF
                            </span>
                          </div>
                        )}

                        {!shift && (
                          <div
                            className="absolute inset-0 flex items-center justify-center cursor-pointer"
                            style={{ zIndex: 2 }}
                            onClick={() => openEditor(day.dateStr)}
                          >
                            <span
                              className="text-[10px] italic"
                              style={{ color: 'var(--text-muted)' }}
                            >
                              Click to schedule
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {loadingShifts && (
              <div
                className="absolute inset-0 flex items-center justify-center bg-black/10 rounded-2xl"
                style={{ zIndex: 10 }}
              >
                <span className="text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>
                  Loading...
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Schedule editor modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingDate ? `Schedule for ${editingDate}` : 'Schedule'}
        disableBackdropClose
        footer={
          <div className="flex gap-2">
            {editingDate && shiftForDate(editingDate) && !shiftForDate(editingDate)?.is_off && (
              <Button
                variant="ghost"
                onClick={() => {
                  if (editingExistsAsOverride && editingDate) {
                    void handleDelete(editingDate);
                  } else if (editingDate) {
                    void handleClearDay(editingDate);
                  }
                  setIsModalOpen(false);
                }}
                style={{ color: '#ef4444' }}
              >
                Delete
              </Button>
            )}
            <div className="flex-1" />
            <Button variant="ghost" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSave}>
              {editingExistsAsOverride ? 'Update' : 'Save'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={modalForm.is_off}
              onChange={(e) => setModalForm({ ...modalForm, is_off: e.target.checked })}
              className="rounded"
            />
            <span className="text-sm font-bold">Day Off</span>
          </label>
          {!modalForm.is_off && (
            <div className="grid grid-cols-2 gap-4">
              <TimeInput
                label="Start Time"
                value={modalForm.start_time}
                onChange={(v) => setModalForm({ ...modalForm, start_time: v })}
              />
              <TimeInput
                label="End Time"
                value={modalForm.end_time}
                onChange={(v) => setModalForm({ ...modalForm, end_time: v })}
              />
            </div>
          )}
        </div>
      </Modal>
      <ConfirmModal {...confirmState} onClose={closeConfirm} />
    </div>
  );
}
