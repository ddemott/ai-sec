'use client';

/**
 * The scrollable 7-day × 24-hour timeline grid. Owns its own scroll-sync refs
 * and auto-scroll to business hours. Pure presentation + callbacks;
 * all data-fetching and state live in ShiftManagementView.
 * Extracted from ShiftManagementView.tsx (dense-view decomposition).
 */

import React, { useRef, useEffect, useCallback } from 'react';
import { Users, Trash2 } from 'lucide-react';
import { formatHour, formatTime24to12, shiftTimeToHour } from '../../lib/utils';
import type { EffectiveShift } from '../../lib/types';
import {
  HOURS,
  ROW_HEIGHT,
  HEADER_HEIGHT,
  DAY_LABEL_WIDTH,
  DEFAULT_OPEN_HOUR,
  DEFAULT_CLOSE_HOUR,
} from './shiftFormatters';

export interface ShiftWeekDay {
  date: Date;
  dateStr: string;
  label: string;
  isToday: boolean;
}

interface ShiftTimelineProps {
  weekDays: ShiftWeekDay[];
  scheduledShifts: EffectiveShift[];
  colW: number;
  loadingShifts: boolean;
  /** Passed so the timeline can reset auto-scroll when the selection changes. */
  selectedEmployeeId: string | null;
  shiftForDate: (dateStr: string) => EffectiveShift | undefined;
  onOpenEditor: (dateStr: string) => void;
  onDeleteShift: (dateStr: string) => void;
  employeeLabel: string;
}

export function ShiftTimeline({
  weekDays,
  colW,
  loadingShifts,
  selectedEmployeeId,
  shiftForDate,
  onOpenEditor,
  onDeleteShift,
  employeeLabel,
}: ShiftTimelineProps) {
  const totalGridWidth = 24 * colW;
  const gridRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const hasAutoScrolled = useRef(false);

  // Reset scroll marker when the selected employee changes so the new
  // employee's timeline always opens at business hours.
  useEffect(() => {
    hasAutoScrolled.current = false;
  }, [selectedEmployeeId]);

  // Auto-scroll to business hours on first render or employee change.
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

  if (!selectedEmployeeId) {
    return (
      <div
        className="h-full flex flex-col items-center justify-center rounded-3xl border-2 border-dashed"
        style={{ backgroundColor: 'var(--bg-raised)', borderColor: 'var(--border-soft)' }}
      >
        <Users className="w-12 h-12 mb-4" style={{ color: 'var(--text-muted)' }} />
        <p className="font-medium" style={{ color: 'var(--text-secondary)' }}>
          Select an {employeeLabel.toLowerCase()} to manage their schedule
        </p>
      </div>
    );
  }

  return (
    <div
      className="h-full flex flex-col rounded-2xl border overflow-hidden relative"
      style={{ backgroundColor: 'var(--bg-raised)', borderColor: 'var(--border-soft)' }}
    >
      {/* Hour header row */}
      <div className="flex shrink-0" style={{ borderBottom: '1px solid var(--border-soft)' }}>
        <div
          className="shrink-0 flex items-center px-3 text-xs font-bold uppercase tracking-widest"
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
                className="text-center text-xs font-bold shrink-0 flex items-center justify-center select-none"
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
        {/* Date label column */}
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
              onClick={() => onOpenEditor(day.dateStr)}
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

        {/* Scrollable grid */}
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
                  {/* Hour cell backgrounds */}
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

                  {/* Shift bar */}
                  {hasShift && (
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label={`Edit shift for ${day.label}, ${formatTime24to12(shift.start_time!.substring(0, 5))} to ${formatTime24to12(shift.end_time!.substring(0, 5))}`}
                      className="absolute group cursor-pointer rounded-md transition-all hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1"
                      style={{
                        left: shiftTimeToHour(shift.start_time!) * colW,
                        width: Math.max(
                          (shiftTimeToHour(shift.end_time!) - shiftTimeToHour(shift.start_time!)) *
                            colW,
                          8
                        ),
                        top: 6,
                        bottom: 6,
                        background: 'var(--accent, #3b82f6)',
                        opacity: 0.85,
                        zIndex: 2,
                      }}
                      onClick={() => onOpenEditor(day.dateStr)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onOpenEditor(day.dateStr);
                        }
                      }}
                      title={`${formatTime24to12(shift.start_time!.substring(0, 5))} - ${formatTime24to12(shift.end_time!.substring(0, 5))}`}
                    >
                      {(shiftTimeToHour(shift.end_time!) - shiftTimeToHour(shift.start_time!)) *
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
                            onDeleteShift(day.dateStr);
                          }}
                          className="p-1 rounded-md hover:bg-white/20 transition-colors"
                          title="Delete shift"
                          aria-label={`Delete shift for ${day.label}`}
                        >
                          <Trash2 className="w-3.5 h-3.5 text-white" />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Day off marker */}
                  {shift?.is_off && (
                    <div
                      className="absolute inset-0 flex items-center justify-center"
                      style={{ zIndex: 2 }}
                    >
                      <span
                        className="text-xs font-bold px-2 py-0.5 rounded"
                        style={{ backgroundColor: 'rgba(239,68,68,0.15)', color: '#ef4444' }}
                      >
                        OFF
                      </span>
                    </div>
                  )}

                  {/* Empty / click-to-schedule */}
                  {!shift && (
                    <div
                      className="absolute inset-0 flex items-center justify-center cursor-pointer"
                      style={{ zIndex: 2 }}
                      onClick={() => onOpenEditor(day.dateStr)}
                    >
                      <span className="text-xs italic" style={{ color: 'var(--text-muted)' }}>
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

      {/* Loading overlay */}
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
  );
}
