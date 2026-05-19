'use client';

import React from 'react';
import { useVocabulary } from '@/lib/VocabularyContext';
import type { Step4Props, WizardShift, WizardEmployee } from './types';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function Step4Shifts({
  employees,
  shifts,
  loading,
  saving,
  error,
  selectedEmployeeId,
  onSelectEmployee,
  onToggleShift,
  onUpdateTime,
}: Step4Props) {
  const vocab = useVocabulary();
  const selectedEmployee = employees.find(
    (e: WizardEmployee) => String(e.employee_id) === String(selectedEmployeeId)
  );
  const employeeShifts = shifts.filter(
    (s: WizardShift) => String(s.employee_id) === String(selectedEmployeeId)
  );

  function getShiftForDay(dow: number) {
    return employeeShifts.find((s: WizardShift) => s.day_of_week === dow);
  }

  return (
    <div>
      <div className="mb-4">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          When does everyone work?
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Select an {vocab.employee_label.toLowerCase()}, then toggle the days they work and set
          their hours.
        </p>
      </div>

      {employees.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">
          No {vocab.employee_plural.toLowerCase()} yet. Go back to Step 3 to add team members first.
        </p>
      ) : (
        <>
          {/* Employee selector */}
          <div className="flex flex-wrap gap-2 mb-4">
            {employees.map((emp: WizardEmployee) => {
              const empShiftCount = shifts.filter(
                (s: WizardShift) => String(s.employee_id) === String(emp.employee_id)
              ).length;
              const isSelected = String(emp.employee_id) === String(selectedEmployeeId);
              return (
                <button
                  key={emp.employee_id}
                  onClick={() => onSelectEmployee(isSelected ? null : String(emp.employee_id))}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    isSelected
                      ? 'ring-2'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                  style={
                    isSelected
                      ? {
                          backgroundColor: 'var(--accent-muted)',
                          color: 'var(--accent-soft)',
                          boxShadow: '0 0 0 2px var(--accent-soft)',
                        }
                      : undefined
                  }
                >
                  {emp.first_name || emp.name} {emp.last_name || ''}
                  {empShiftCount > 0 && (
                    <span className="ml-1.5 text-xs opacity-60">({empShiftCount}d)</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Shift grid for selected employee */}
          {selectedEmployee && !loading ? (
            <div className="space-y-2">
              {DAY_NAMES.map((dayName, dow) => {
                const shift = getShiftForDay(dow);
                return (
                  <div
                    key={dow}
                    className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#222]"
                  >
                    {/* Day toggle */}
                    <button
                      onClick={() =>
                        onToggleShift(String(selectedEmployee.employee_id), dow, '08:00', '17:00')
                      }
                      disabled={saving}
                      className={`w-12 text-sm font-medium rounded-md py-1 transition-colors ${
                        shift
                          ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400'
                          : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500'
                      }`}
                    >
                      {dayName}
                    </button>

                    {/* Time inputs */}
                    {shift ? (
                      <div className="flex items-center gap-2 text-sm">
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
                      <span className="text-xs text-gray-400 dark:text-gray-500">Off</span>
                    )}
                  </div>
                );
              })}
              {error && <p className="text-xs text-red-600 dark:text-red-400 mt-2">{error}</p>}
            </div>
          ) : selectedEmployee && loading ? (
            <p className="text-sm text-gray-400">Loading shifts...</p>
          ) : (
            <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">
              Select an {vocab.employee_label.toLowerCase()} above to set their schedule.
            </p>
          )}
        </>
      )}
    </div>
  );
}
