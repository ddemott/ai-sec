'use client'

import React, { useEffect, useState, useMemo } from 'react'
import { ChevronRight, ChevronDown, Users } from 'lucide-react'
import { Api } from '../lib/api'
import { useSession } from '../lib/hooks'

const HOURS_START = 6  // 6am
const HOURS_END = 22   // 10pm
const DAYS = [
  { label: 'Sun', value: 0 },
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
]

interface Employee {
  id: string
  name: string
  shift_start: string | null
  shift_end: string | null
}

interface ServiceStaffing {
  service_id: string
  service_name: string
  duration_minutes: number
  employees: Employee[]
}

function parseHour(timeStr: string | null): number | null {
  if (!timeStr) return null
  return parseInt(timeStr.split(':')[0], 10)
}

function formatHour(h: number): string {
  if (h === 0 || h === 24) return '12a'
  if (h === 12) return '12p'
  return h < 12 ? `${h}a` : `${h - 12}p`
}

/** Count how many employees cover a given hour */
function staffCountAtHour(employees: Employee[], hour: number): number {
  let count = 0
  for (const emp of employees) {
    const start = parseHour(emp.shift_start)
    const end = parseHour(emp.shift_end)
    if (start !== null && end !== null && hour >= start && hour < end) {
      count++
    }
  }
  return count
}

/** Get employee names covering a given hour */
function staffAtHour(employees: Employee[], hour: number): string[] {
  const names: string[] = []
  for (const emp of employees) {
    const start = parseHour(emp.shift_start)
    const end = parseHour(emp.shift_end)
    if (start !== null && end !== null && hour >= start && hour < end) {
      names.push(emp.name)
    }
  }
  return names
}

// Color intensity based on staff count
function getHourColor(count: number): string {
  if (count === 0) return 'bg-gray-100 dark:bg-gray-800/50'
  if (count === 1) return 'bg-blue-200 dark:bg-blue-900/40'
  if (count === 2) return 'bg-blue-300 dark:bg-blue-800/50'
  if (count === 3) return 'bg-blue-400 dark:bg-blue-700/60'
  return 'bg-blue-500 dark:bg-blue-600/70' // 4+
}

// Employee bar colors (cycle through)
const EMP_COLORS = [
  'bg-blue-400 dark:bg-blue-500',
  'bg-emerald-400 dark:bg-emerald-500',
  'bg-amber-400 dark:bg-amber-500',
  'bg-purple-400 dark:bg-purple-500',
  'bg-rose-400 dark:bg-rose-500',
  'bg-cyan-400 dark:bg-cyan-500',
  'bg-orange-400 dark:bg-orange-500',
]

export default function ServiceCoverageView({ overrideTenantId }: { overrideTenantId?: string | null }) {
  const { tenantId } = useSession(overrideTenantId)
  const [data, setData] = useState<ServiceStaffing[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDay, setSelectedDay] = useState(() => new Date().getDay())
  const [expandedServices, setExpandedServices] = useState<Set<string>>(new Set())

  const hours = useMemo(() =>
    Array.from({ length: HOURS_END - HOURS_START }, (_, i) => HOURS_START + i),
    []
  )

  useEffect(() => {
    if (!tenantId) return
    setLoading(true)
    Api.staffing.get(tenantId, selectedDay)
      .then(d => setData(d || []))
      .catch(() => setData([]))
      .finally(() => setLoading(false))
  }, [tenantId, selectedDay])

  const toggleExpand = (serviceId: string) => {
    setExpandedServices(prev => {
      const next = new Set(prev)
      if (next.has(serviceId)) next.delete(serviceId)
      else next.add(serviceId)
      return next
    })
  }

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-gray-400">Loading coverage map...</div>
  }

  return (
    <div className="flex-1 flex flex-col overflow-auto p-4 md:p-6" style={{ color: 'var(--text-primary)' }}>
      {/* Day selector */}
      <div className="flex items-center gap-2 mb-6">
        <span className="text-sm font-medium text-gray-500 dark:text-gray-400 mr-2">Day:</span>
        {DAYS.map(day => (
          <button
            key={day.value}
            onClick={() => setSelectedDay(day.value)}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-all ${
              selectedDay === day.value
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            {day.label}
          </button>
        ))}
      </div>

      {data.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400 dark:text-gray-600">
          <Users className="w-12 h-12 mb-3 opacity-30" />
          <p className="text-sm">No services configured yet.</p>
          <p className="text-xs mt-1">Add services and assign employees to see the staffing map.</p>
        </div>
      ) : (
        <div className="space-y-1">
          {/* Hour header */}
          <div className="flex items-center">
            <div className="w-48 shrink-0" />
            <div className="flex flex-1">
              {hours.map(h => (
                <div key={h} className="flex-1 text-center text-[10px] text-gray-400 dark:text-gray-500 font-medium">
                  {formatHour(h)}
                </div>
              ))}
            </div>
            <div className="w-20 shrink-0" />
          </div>

          {/* Service rows */}
          {data.map(service => {
            const isExpanded = expandedServices.has(service.service_id)
            const maxStaff = Math.max(...hours.map(h => staffCountAtHour(service.employees, h)), 0)

            return (
              <div key={service.service_id} className="rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
                {/* Collapsed summary row */}
                <div
                  className="flex items-center cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors"
                  onClick={() => toggleExpand(service.service_id)}
                >
                  {/* Service name */}
                  <div className="w-48 shrink-0 px-3 py-2.5 flex items-center gap-2">
                    {isExpanded
                      ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                      : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                    }
                    <span className="text-sm font-semibold truncate">{service.service_name}</span>
                  </div>

                  {/* Heatmap bar */}
                  <div className="flex flex-1 py-1.5">
                    {hours.map(h => {
                      const count = staffCountAtHour(service.employees, h)
                      const names = staffAtHour(service.employees, h)
                      return (
                        <div
                          key={h}
                          className={`flex-1 mx-px rounded-sm min-h-[28px] flex items-center justify-center transition-colors ${getHourColor(count)}`}
                          title={count > 0 ? `${formatHour(h)}: ${count} staff (${names.join(', ')})` : `${formatHour(h)}: no staff`}
                        >
                          {count > 0 && (
                            <span className={`text-[10px] font-bold ${count === 0 ? 'text-gray-400' : 'text-white dark:text-white'}`}>
                              {count}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* Summary */}
                  <div className="w-20 shrink-0 px-2 text-right">
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {service.employees.length} staff
                    </span>
                    {maxStaff === 0 && (
                      <p className="text-[9px] text-gray-400">none today</p>
                    )}
                  </div>
                </div>

                {/* Expanded: employee shift bars */}
                {isExpanded && (
                  <div className="border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/20">
                    {service.employees.length === 0 ? (
                      <div className="px-4 py-3 text-xs text-gray-400 italic">
                        No employees assigned to this service.
                      </div>
                    ) : (
                      service.employees.map((emp, empIdx) => {
                        const shiftStart = parseHour(emp.shift_start)
                        const shiftEnd = parseHour(emp.shift_end)
                        const colorClass = EMP_COLORS[empIdx % EMP_COLORS.length]

                        return (
                          <div key={`${emp.id}-${emp.shift_start}`} className="flex items-center">
                            {/* Employee name */}
                            <div className="w-48 shrink-0 px-3 py-1.5 pl-10">
                              <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate block">
                                {emp.name}
                              </span>
                            </div>

                            {/* Shift bar */}
                            <div className="relative flex flex-1 py-1">
                              {hours.map(h => (
                                <div key={h} className="flex-1 mx-px min-h-[20px]" />
                              ))}
                              {shiftStart !== null && shiftEnd !== null && (
                                <div
                                  className={`absolute top-1 bottom-1 rounded ${colorClass} opacity-80`}
                                  style={{
                                    left: `${((shiftStart - HOURS_START) / (HOURS_END - HOURS_START)) * 100}%`,
                                    width: `${((shiftEnd - shiftStart) / (HOURS_END - HOURS_START)) * 100}%`,
                                  }}
                                >
                                  <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white truncate px-1">
                                    {formatHour(shiftStart)}–{formatHour(shiftEnd)}
                                  </span>
                                </div>
                              )}
                            </div>

                            {/* Shift time text */}
                            <div className="w-20 shrink-0 px-2 text-right">
                              <span className="text-[10px] text-gray-400">
                                {shiftStart !== null && shiftEnd !== null
                                  ? `${formatHour(shiftStart)}–${formatHour(shiftEnd)}`
                                  : 'off today'}
                              </span>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Legend */}
      <div className="mt-6 flex items-center gap-4 text-[10px] text-gray-400 dark:text-gray-500">
        <span>Staff count:</span>
        <div className="flex items-center gap-1"><div className="w-4 h-3 rounded-sm bg-gray-100 dark:bg-gray-800/50" /> 0</div>
        <div className="flex items-center gap-1"><div className="w-4 h-3 rounded-sm bg-blue-200 dark:bg-blue-900/40" /> 1</div>
        <div className="flex items-center gap-1"><div className="w-4 h-3 rounded-sm bg-blue-300 dark:bg-blue-800/50" /> 2</div>
        <div className="flex items-center gap-1"><div className="w-4 h-3 rounded-sm bg-blue-400 dark:bg-blue-700/60" /> 3</div>
        <div className="flex items-center gap-1"><div className="w-4 h-3 rounded-sm bg-blue-500 dark:bg-blue-600/70" /> 4+</div>
      </div>
    </div>
  )
}
