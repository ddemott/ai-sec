'use client'

import React from 'react'
import type { WizardShift } from './types'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface SoloStepHoursProps {
  shifts: WizardShift[]
  loading: boolean
  saving: boolean
  error: string | null
  onToggleDay: (dayOfWeek: number) => void
  onUpdateTime: (shiftId: string | number, startTime: string, endTime: string) => void
}

export function SoloStepHours({ shifts, loading, saving, error, onToggleDay, onUpdateTime }: SoloStepHoursProps) {
  function getShiftForDay(dow: number) {
    return shifts.find(s => s.day_of_week === dow)
  }

  return (
    <div>
      <div className="mb-4">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">When are you available?</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Toggle the days you work and set your hours for each day.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading...</p>
      ) : (
        <div className="space-y-2">
          {DAY_NAMES.map((dayName, dow) => {
            const shift = getShiftForDay(dow)
            return (
              <div
                key={dow}
                className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#222]"
              >
                <button
                  onClick={() => onToggleDay(dow)}
                  disabled={saving}
                  className={`w-12 text-sm font-medium rounded-md py-1 transition-colors ${
                    shift
                      ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500'
                  }`}
                >
                  {dayName}
                </button>

                {shift ? (
                  <div className="flex items-center gap-2 text-sm">
                    <input
                      type="time"
                      value={shift.start_time?.slice(0, 5) || '08:00'}
                      onChange={e => onUpdateTime(shift.id, e.target.value, shift.end_time?.slice(0, 5) || '17:00')}
                      className="px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#333] text-gray-900 dark:text-gray-100 text-sm"
                    />
                    <span className="text-gray-400">to</span>
                    <input
                      type="time"
                      value={shift.end_time?.slice(0, 5) || '17:00'}
                      onChange={e => onUpdateTime(shift.id, shift.start_time?.slice(0, 5) || '08:00', e.target.value)}
                      className="px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#333] text-gray-900 dark:text-gray-100 text-sm"
                    />
                  </div>
                ) : (
                  <span className="text-xs text-gray-400 dark:text-gray-500">Off</span>
                )}
              </div>
            )
          })}
          {error && <p className="text-xs text-red-600 dark:text-red-400 mt-2">{error}</p>}
        </div>
      )}
    </div>
  )
}
