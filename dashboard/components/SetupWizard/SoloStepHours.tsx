'use client';

import React, { useState } from 'react';
import { CopyCheck, ArrowDownToLine, X } from 'lucide-react';
import type { WizardShift } from './types';

// Mon-Sat then Sun — matches business week mental model
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAMES: Record<number, string> = {
  0: 'Sun',
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
};
const WEEKDAYS = [1, 2, 3, 4, 5];

interface SoloStepHoursProps {
  shifts: WizardShift[];
  loading: boolean;
  saving: boolean;
  error: string | null;
  onToggleDay: (dayOfWeek: number) => void;
  onUpdateTime: (shiftId: string, startTime: string, endTime: string) => void;
  onApplyToWeekdays: (sourceDow: number) => void;
  onCopyDown: (sourceDow: number) => void;
}

export function SoloStepHours({
  shifts,
  loading,
  saving,
  error,
  onToggleDay,
  onUpdateTime,
  onApplyToWeekdays,
  onCopyDown,
}: SoloStepHoursProps) {
  const [flashDays, setFlashDays] = useState<Set<number>>(new Set());

  function getShiftForDay(dow: number) {
    return shifts.find((s) => s.day_of_week === dow);
  }

  function handleApplyWeekdays(sourceDow: number) {
    onApplyToWeekdays(sourceDow);
    // Flash the affected weekday rows
    const affected = new Set(WEEKDAYS.filter((d) => d !== sourceDow));
    setFlashDays(affected);
    setTimeout(() => setFlashDays(new Set()), 1200);
  }

  function handleCopyDown(sourceDow: number) {
    onCopyDown(sourceDow);
    // Flash all rows below source
    const sourceIdx = DAY_ORDER.indexOf(sourceDow);
    const affected = new Set(DAY_ORDER.slice(sourceIdx + 1));
    setFlashDays(affected);
    setTimeout(() => setFlashDays(new Set()), 1200);
  }

  // Show "Apply to weekdays" if the source day is a weekday with a shift
  const isWeekday = (dow: number) => WEEKDAYS.includes(dow);

  // Check if the source day is the last in the displayed order (can't copy down from last)
  const isLastDay = (dow: number) => DAY_ORDER.indexOf(dow) === DAY_ORDER.length - 1;

  return (
    <div>
      <div className="mb-4">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          When are you available?
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Toggle the days you work and set your hours. Use the copy buttons to fill faster.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading...</p>
      ) : (
        <div className="space-y-1">
          {DAY_ORDER.map((dow) => {
            const shift = getShiftForDay(dow);
            const isFlashing = flashDays.has(dow);
            return (
              <div key={dow}>
                <div
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-colors duration-500 ${
                    isFlashing
                      ? ''
                      : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#222]'
                  }`}
                  style={
                    isFlashing
                      ? {
                          borderColor: 'var(--accent-soft)',
                          backgroundColor: 'var(--accent-muted)',
                        }
                      : undefined
                  }
                >
                  {/* Day toggle */}
                  <button
                    onClick={() => onToggleDay(dow)}
                    disabled={saving}
                    className={`w-12 text-sm font-medium rounded-md py-1 transition-colors shrink-0 ${
                      shift
                        ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500'
                    }`}
                  >
                    {DAY_NAMES[dow]}
                  </button>

                  {/* Time inputs or Off label */}
                  {shift ? (
                    <div className="flex items-center gap-2 text-sm flex-1 min-w-0">
                      <input
                        type="time"
                        value={shift.start_time?.slice(0, 5) || '08:00'}
                        onChange={(e) =>
                          onUpdateTime(
                            shift.id,
                            e.target.value,
                            shift.end_time?.slice(0, 5) || '17:00'
                          )
                        }
                        className="px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#333] text-gray-900 dark:text-gray-100 text-sm"
                      />
                      <span className="text-gray-400">to</span>
                      <input
                        type="time"
                        value={shift.end_time?.slice(0, 5) || '17:00'}
                        onChange={(e) =>
                          onUpdateTime(
                            shift.id,
                            shift.start_time?.slice(0, 5) || '08:00',
                            e.target.value
                          )
                        }
                        className="px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#333] text-gray-900 dark:text-gray-100 text-sm"
                      />
                    </div>
                  ) : (
                    <span className="text-xs text-gray-400 dark:text-gray-500 flex-1">Off</span>
                  )}

                  {/* Copy & remove actions */}
                  {shift && (
                    <div className="flex items-center gap-1 shrink-0">
                      {!isLastDay(dow) && (
                        <button
                          onClick={() => handleCopyDown(dow)}
                          disabled={saving}
                          className="p-1.5 text-gray-400 transition-colors"
                          onMouseEnter={(e) => {
                            e.currentTarget.style.color = 'var(--accent-soft)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.color = '';
                          }}
                          title="Copy to days below"
                        >
                          <ArrowDownToLine className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => onToggleDay(dow)}
                        disabled={saving}
                        className="p-1.5 text-gray-400 hover:[color:var(--danger)] transition-colors"
                        title="Remove this day"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {/* "Apply to all weekdays" link — shown after the first enabled weekday */}
                {shift &&
                  isWeekday(dow) &&
                  dow === DAY_ORDER.find((d) => isWeekday(d) && getShiftForDay(d)) && (
                    <button
                      onClick={() => handleApplyWeekdays(dow)}
                      disabled={saving}
                      className="flex items-center gap-1.5 ml-16 mt-1 mb-1 text-xs transition-colors disabled:opacity-50"
                      style={{ color: 'var(--accent-soft)' }}
                    >
                      <CopyCheck className="w-3 h-3" />
                      Apply to all weekdays
                    </button>
                  )}
              </div>
            );
          })}
          {error && <p className="text-xs text-red-600 dark:text-red-400 mt-2">{error}</p>}
        </div>
      )}
    </div>
  );
}
