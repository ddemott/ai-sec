'use client'

import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import {
  Clock,
  Plus,
  Trash2,
  Users,
  Copy,
  AlertCircle,
  Minus,
  ChevronLeft,
  ChevronRight,
  Settings
} from 'lucide-react'
import { Api } from '../lib/api'
import { formatTime24to12, formatHour, shiftTimeToHour } from '../lib/utils'
import { useStaticData } from '../lib/hooks'
import { useActiveTenantId } from '../lib/SessionContext'
import { useVocabulary } from '@/lib/VocabularyContext'
import type { EffectiveShift } from '../lib/types'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Modal } from './ui/Modal'

// Timeline constants
const HOURS = Array.from({ length: 24 }, (_, i) => i)
const DEFAULT_COL_W = 72
const MIN_COL_W = 36
const MAX_COL_W = 140
const ZOOM_STEP = 16
const ROW_HEIGHT = 48
const HEADER_HEIGHT = 32
const DAY_LABEL_WIDTH = 120
const DEFAULT_OPEN_HOUR = 8
const DEFAULT_CLOSE_HOUR = 17

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const FULL_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function getZoomPercent(colW: number): number {
  return Math.round((colW / DEFAULT_COL_W) * 100)
}

function getWeekStart(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay() // 0=Sun
  d.setDate(d.getDate() - day)
  d.setHours(0, 0, 0, 0)
  return d
}

function formatDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function toDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatWeekLabel(weekStart: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `Week of ${months[weekStart.getMonth()]} ${weekStart.getDate()}, ${weekStart.getFullYear()}`
}

export default function ShiftManagementView() {
  const tenantId = useActiveTenantId()
  const { employees, shifts: patternShifts, loading: empsLoading, refresh: refreshData } = useStaticData(tenantId)
  const vocab = useVocabulary()

  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null)
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()))
  const [effectiveShifts, setEffectiveShifts] = useState<EffectiveShift[]>([])
  const [loadingEffective, setLoadingEffective] = useState(false)

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingDate, setEditingDate] = useState<string | null>(null) // YYYY-MM-DD
  const [editingOverrideId, setEditingOverrideId] = useState<string | null>(null)
  const [modalForm, setModalForm] = useState({
    start_time: '09:00',
    end_time: '17:00',
    is_off: false,
  })

  // Pattern editor
  const [showPatternEditor, setShowPatternEditor] = useState(false)
  const [patternForm, setPatternForm] = useState({ day_of_week: 1, start_time: '09:00', end_time: '17:00' })

  // Copy week modal
  const [showCopyModal, setShowCopyModal] = useState(false)
  const [copyTargetDate, setCopyTargetDate] = useState('')

  // Timeline state
  const [colW, setColW] = useState(DEFAULT_COL_W)
  const gridRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const hasAutoScrolled = useRef(false)

  const totalGridWidth = 24 * colW

  // Fetch effective shifts when employee or week changes
  useEffect(() => {
    if (!selectedEmployeeId || !tenantId) {
      setEffectiveShifts([])
      return
    }
    fetchEffectiveShifts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmployeeId, tenantId, weekStart, patternShifts])

  async function fetchEffectiveShifts() {
    if (!selectedEmployeeId || !tenantId) return
    setLoadingEffective(true)
    try {
      const endDate = new Date(weekStart)
      endDate.setDate(endDate.getDate() + 6)
      const data = await Api.shifts.overrides.effective(
        tenantId, selectedEmployeeId, toDateStr(weekStart), toDateStr(endDate)
      )
      setEffectiveShifts(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Failed to fetch effective shifts', err)
      setEffectiveShifts([])
    } finally {
      setLoadingEffective(false)
    }
  }

  // Auto-scroll to business hours
  useEffect(() => {
    if (hasAutoScrolled.current || !gridRef.current) return
    gridRef.current.scrollLeft = (DEFAULT_OPEN_HOUR - 1) * colW
    hasAutoScrolled.current = true
  }, [colW, selectedEmployeeId])

  const handleGridScroll = useCallback(() => {
    if (gridRef.current && headerRef.current) {
      headerRef.current.scrollLeft = gridRef.current.scrollLeft
    }
  }, [])

  // Week navigation
  const prevWeek = () => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() - 7)
    setWeekStart(d)
  }
  const nextWeek = () => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + 7)
    setWeekStart(d)
  }
  const goToday = () => setWeekStart(getWeekStart(new Date()))

  // Build 7-day array for the current week
  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart)
      d.setDate(d.getDate() + i)
      return {
        date: d,
        dateStr: toDateStr(d),
        dayOfWeek: d.getDay(),
        label: `${DAY_NAMES[d.getDay()]} ${formatDate(d)}`,
        isToday: toDateStr(d) === toDateStr(new Date()),
      }
    })
  }, [weekStart])

  // Open override editor
  function openOverrideEditor(dateStr: string, existing?: EffectiveShift) {
    setEditingDate(dateStr)
    setEditingOverrideId(existing?.override_id || null)
    if (existing && !existing.is_off && existing.start_time && existing.end_time) {
      setModalForm({
        start_time: existing.start_time.substring(0, 5),
        end_time: existing.end_time.substring(0, 5),
        is_off: false,
      })
    } else if (existing?.is_off) {
      setModalForm({ start_time: '09:00', end_time: '17:00', is_off: true })
    } else {
      setModalForm({ start_time: '09:00', end_time: '17:00', is_off: false })
    }
    setIsModalOpen(true)
  }

  async function handleSaveOverride() {
    if (!selectedEmployeeId || !tenantId || !editingDate) return
    try {
      await Api.shifts.overrides.create(tenantId, {
        employee_id: selectedEmployeeId,
        shift_date: editingDate,
        start_time: modalForm.is_off ? undefined : modalForm.start_time,
        end_time: modalForm.is_off ? undefined : modalForm.end_time,
        is_off: modalForm.is_off,
      })
      setIsModalOpen(false)
      fetchEffectiveShifts()
    } catch {
      alert('Failed to save override')
    }
  }

  async function handleDeleteOverride(overrideId: string) {
    if (!tenantId) return
    try {
      await Api.shifts.overrides.delete(overrideId, tenantId)
      fetchEffectiveShifts()
    } catch {
      alert('Failed to delete override')
    }
  }

  // Pattern CRUD
  async function handleAddPattern() {
    if (!selectedEmployeeId || !tenantId) return
    try {
      await Api.shifts.create(tenantId, {
        employee_id: selectedEmployeeId,
        day_of_week: patternForm.day_of_week,
        start_time: patternForm.start_time,
        end_time: patternForm.end_time,
      })
      refreshData()
    } catch {
      alert('Failed to add pattern')
    }
  }

  async function handleDeletePattern(id: string) {
    try {
      await Api.shifts.delete(id, tenantId)
      refreshData()
    } catch {
      alert('Failed to delete pattern')
    }
  }

  // Copy week
  async function handleCopyWeek() {
    if (!selectedEmployeeId || !tenantId || !copyTargetDate) return
    try {
      await Api.shifts.copyWeek(tenantId, selectedEmployeeId, toDateStr(weekStart), copyTargetDate)
      setShowCopyModal(false)
      setCopyTargetDate('')
      // Navigate to the target week
      setWeekStart(getWeekStart(new Date(copyTargetDate + 'T12:00:00')))
    } catch {
      alert('Failed to copy week')
    }
  }

  const handleZoomIn = useCallback(() => setColW(prev => Math.min(prev + ZOOM_STEP, MAX_COL_W)), [])
  const handleZoomOut = useCallback(() => setColW(prev => Math.max(prev - ZOOM_STEP, MIN_COL_W)), [])

  const activeEmployees = useMemo(() => employees.filter(e => e.type === 'employee'), [employees])

  // Pattern shifts for the selected employee
  const employeePatterns = useMemo(() =>
    patternShifts.filter(s => s.employee_id.toString() === selectedEmployeeId),
  [patternShifts, selectedEmployeeId])

  if (empsLoading && activeEmployees.length === 0) {
    return <div className="p-8 text-gray-500 italic">Loading {vocab.employee_label.toLowerCase()} shifts...</div>
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-8 transition-colors duration-200" style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}>
      <header className="mb-4 shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center">
            <div className="bg-blue-100 dark:bg-blue-900/30 p-2 rounded-lg mr-4 text-blue-600 dark:text-blue-400">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-3xl font-display">{vocab.employee_label} Working Hours</h1>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Define when your team is available so the AI never overbooks.</p>
            </div>
          </div>
        </div>

        {/* Employee selector */}
        <div className="mb-4">
          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 block">Select {vocab.employee_label}</label>
          <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
            {activeEmployees.map(emp => (
              <button
                key={emp.id}
                onClick={() => { setSelectedEmployeeId(emp.id); hasAutoScrolled.current = false; }}
                className={`px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition-all ${selectedEmployeeId === emp.id ? 'bg-blue-600 text-white shadow-lg scale-105' : ''}`}
                style={selectedEmployeeId === emp.id ? {} : { backgroundColor: 'var(--bg-raised)', color: 'var(--text-secondary)' }}
              >
                {emp.name}
              </button>
            ))}
            {activeEmployees.length === 0 && <p className="text-sm text-gray-400 italic">No {vocab.employee_plural.toLowerCase()} found. Add them in {vocab.employee_label} Management first.</p>}
          </div>
        </div>

        {/* Week navigation + controls */}
        {selectedEmployeeId && (
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <button onClick={prevWeek} className="p-1.5 rounded-lg transition-colors" style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-raised)' }} aria-label="Previous week">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-bold min-w-[200px] text-center">{formatWeekLabel(weekStart)}</span>
              <button onClick={nextWeek} className="p-1.5 rounded-lg transition-colors" style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-raised)' }} aria-label="Next week">
                <ChevronRight className="w-4 h-4" />
              </button>
              <button onClick={goToday} className="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors" style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-raised)' }}>
                Today
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowPatternEditor(!showPatternEditor)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${showPatternEditor ? 'bg-blue-600 text-white' : ''}`}
                style={showPatternEditor ? {} : { color: 'var(--text-secondary)', backgroundColor: 'var(--bg-raised)' }}
              >
                <Settings className="w-3.5 h-3.5" />
                Weekly Pattern
              </button>

              <button
                onClick={() => setShowCopyModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-raised)' }}
              >
                <Copy className="w-3.5 h-3.5" />
                Copy Week
              </button>

              {/* Zoom controls */}
              <div className="flex items-center gap-0 rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-soft)' }}>
                <button onClick={handleZoomOut} disabled={colW <= MIN_COL_W} className="p-1.5 transition-colors disabled:opacity-30" style={{ color: 'var(--text-secondary)' }} aria-label="Zoom out">
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span className="text-xs font-bold px-2 select-none" style={{ color: 'var(--text-muted)' }}>{getZoomPercent(colW)}%</span>
                <button onClick={handleZoomIn} disabled={colW >= MAX_COL_W} className="p-1.5 transition-colors disabled:opacity-30" style={{ color: 'var(--text-secondary)' }} aria-label="Zoom in">
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Pattern editor (collapsible) */}
      {selectedEmployeeId && showPatternEditor && (
        <div className="mb-4 p-4 rounded-2xl border" style={{ backgroundColor: 'var(--bg-raised)', borderColor: 'var(--border-soft)' }}>
          <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>
            <Settings className="w-4 h-4 inline mr-2" />
            Recurring Weekly Pattern
          </h3>
          <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
            This is the default schedule used when no date-specific override exists.
          </p>
          <div className="flex flex-wrap gap-2 mb-3">
            {FULL_DAY_NAMES.map((_name, dow) => {
              const pattern = employeePatterns.find(p => p.day_of_week === dow)
              return (
                <div key={dow} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs" style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-soft)' }}>
                  <span className="font-bold w-12">{DAY_NAMES[dow]}</span>
                  {pattern ? (
                    <>
                      <span style={{ color: 'var(--text-primary)' }}>
                        {formatTime24to12(pattern.start_time.substring(0, 5))} – {formatTime24to12(pattern.end_time.substring(0, 5))}
                      </span>
                      <button onClick={() => handleDeletePattern(pattern.id)} className="text-gray-400 hover:text-red-500 transition-colors" title="Remove pattern">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>Off</span>
                  )}
                </div>
              )
            })}
          </div>
          <div className="flex items-center gap-2">
            <select
              className="rounded-lg px-2 py-1.5 text-xs font-bold" style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-soft)' }}
              value={patternForm.day_of_week}
              onChange={e => setPatternForm({ ...patternForm, day_of_week: parseInt(e.target.value) })}
            >
              {FULL_DAY_NAMES.map((name, i) => <option key={i} value={i}>{name}</option>)}
            </select>
            <input type="time" className="rounded-lg px-2 py-1.5 text-xs" style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-soft)' }}
              value={patternForm.start_time} onChange={e => setPatternForm({ ...patternForm, start_time: e.target.value })} />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>to</span>
            <input type="time" className="rounded-lg px-2 py-1.5 text-xs" style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-soft)' }}
              value={patternForm.end_time} onChange={e => setPatternForm({ ...patternForm, end_time: e.target.value })} />
            <Button variant="primary" size="sm" onClick={handleAddPattern} icon={Plus}>Add</Button>
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="flex-1 overflow-hidden">
        {!selectedEmployeeId ? (
          <div className="h-full flex flex-col items-center justify-center rounded-3xl border-2 border-dashed" style={{ backgroundColor: 'var(--bg-raised)', borderColor: 'var(--border-soft)' }}>
            <Users className="w-12 h-12 text-gray-200 dark:text-gray-800 mb-4" />
            <p className="text-gray-500 font-medium">Select an {vocab.employee_label.toLowerCase()} to manage their schedule</p>
          </div>
        ) : (
          <div className="h-full flex flex-col rounded-2xl border overflow-hidden" style={{ backgroundColor: 'var(--bg-raised)', borderColor: 'var(--border-soft)' }}>
            {/* Header: day label column + hour labels */}
            <div className="flex shrink-0" style={{ borderBottom: '1px solid var(--border-soft)' }}>
              <div className="shrink-0 flex items-center px-3 text-[10px] font-bold uppercase tracking-widest"
                style={{ width: DAY_LABEL_WIDTH, height: HEADER_HEIGHT, color: 'var(--text-muted)', borderRight: '1px solid var(--border-soft)' }}>
                Date
              </div>
              <div ref={headerRef} className="flex-1 overflow-hidden">
                <div className="flex" style={{ width: totalGridWidth }}>
                  {HOURS.map(h => {
                    const isOutside = h < DEFAULT_OPEN_HOUR || h >= DEFAULT_CLOSE_HOUR
                    return (
                      <div key={h} className="text-center text-[10px] font-bold shrink-0 flex items-center justify-center select-none"
                        style={{ width: colW, height: HEADER_HEIGHT, color: 'var(--text-muted)', background: isOutside ? 'rgba(0,0,0,0.2)' : 'transparent', borderRight: '1px solid var(--border-soft)' }}>
                        {formatHour(h)}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Day rows */}
            <div className="flex-1 overflow-hidden flex">
              {/* Fixed day label column */}
              <div className="shrink-0" style={{ width: DAY_LABEL_WIDTH }}>
                {weekDays.map(day => {
                  const eff = effectiveShifts.find(s => s.shift_date === day.dateStr)
                  return (
                    <div key={day.dateStr}
                      className="flex items-center justify-between px-3 cursor-pointer hover:brightness-110 transition-all"
                      style={{
                        height: ROW_HEIGHT,
                        borderBottom: '1px solid var(--border-soft)',
                        borderRight: '1px solid var(--border-soft)',
                        backgroundColor: day.isToday ? 'rgba(59,130,246,0.08)' : undefined,
                      }}
                      onClick={() => openOverrideEditor(day.dateStr, eff)}
                    >
                      <div>
                        <span className="font-bold text-sm" style={{ color: day.isToday ? 'var(--accent, #3b82f6)' : eff ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                          {day.label}
                        </span>
                        {eff?.is_override && (
                          <span className="ml-1.5 text-[9px] font-bold px-1 py-0.5 rounded" style={{ backgroundColor: 'rgba(245,158,11,0.2)', color: '#f59e0b' }}>
                            OVR
                          </span>
                        )}
                      </div>
                      <Plus className="w-3 h-3 opacity-0 group-hover:opacity-100" style={{ color: 'var(--text-muted)' }} />
                    </div>
                  )
                })}
              </div>

              {/* Scrollable timeline */}
              <div ref={gridRef} className="flex-1 overflow-x-auto overflow-y-hidden" onScroll={handleGridScroll}>
                <div style={{ width: totalGridWidth }}>
                  {weekDays.map(day => {
                    const eff = effectiveShifts.find(s => s.shift_date === day.dateStr)
                    const hasShift = eff && !eff.is_off && eff.start_time && eff.end_time

                    return (
                      <div key={day.dateStr} className="relative" style={{
                        height: ROW_HEIGHT,
                        borderBottom: '1px solid var(--border-soft)',
                        backgroundColor: day.isToday ? 'rgba(59,130,246,0.04)' : undefined,
                      }}>
                        {/* Hour backgrounds */}
                        <div className="absolute inset-0 flex">
                          {HOURS.map(h => (
                            <div key={h} className="shrink-0" style={{
                              width: colW, height: ROW_HEIGHT,
                              background: h < DEFAULT_OPEN_HOUR || h >= DEFAULT_CLOSE_HOUR ? 'rgba(0,0,0,0.15)' : 'transparent',
                              borderRight: '1px solid var(--border-soft)',
                            }} />
                          ))}
                        </div>

                        {/* Shift bar */}
                        {hasShift && (
                          <div
                            className="absolute group cursor-pointer rounded-md transition-all hover:brightness-110"
                            style={{
                              left: shiftTimeToHour(eff.start_time!) * colW,
                              width: Math.max((shiftTimeToHour(eff.end_time!) - shiftTimeToHour(eff.start_time!)) * colW, 8),
                              top: 6, bottom: 6,
                              background: eff.is_override ? '#f59e0b' : 'var(--accent, #3b82f6)',
                              opacity: 0.85,
                              zIndex: 2,
                            }}
                            onClick={() => openOverrideEditor(day.dateStr, eff)}
                            title={`${formatTime24to12(eff.start_time!.substring(0, 5))} - ${formatTime24to12(eff.end_time!.substring(0, 5))}${eff.is_override ? ' (override)' : ' (pattern)'}`}
                          >
                            {(shiftTimeToHour(eff.end_time!) - shiftTimeToHour(eff.start_time!)) * colW > 90 && (
                              <span className="absolute inset-0 flex items-center px-2 text-[11px] font-bold text-white truncate" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}>
                                {formatTime24to12(eff.start_time!.substring(0, 5))} – {formatTime24to12(eff.end_time!.substring(0, 5))}
                              </span>
                            )}

                            {/* Hover actions */}
                            {eff.is_override && eff.override_id && (
                              <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleDeleteOverride(eff.override_id!); }}
                                  className="p-0.5 rounded bg-white/20 hover:bg-red-500/80 transition-colors"
                                  title="Remove override (revert to pattern)"
                                >
                                  <Trash2 className="w-3 h-3 text-white" />
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Day off indicator */}
                        {eff?.is_off && (
                          <div className="absolute inset-0 flex items-center justify-center" style={{ zIndex: 2 }}>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ backgroundColor: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>
                              OFF
                              {eff.is_override && eff.override_id && (
                                <button
                                  onClick={() => handleDeleteOverride(eff.override_id!)}
                                  className="ml-2 hover:text-red-700 transition-colors"
                                  title="Remove override"
                                >
                                  <Trash2 className="w-3 h-3 inline" />
                                </button>
                              )}
                            </span>
                          </div>
                        )}

                        {/* Empty - no pattern, no override */}
                        {!eff && (
                          <div className="absolute inset-0 flex items-center justify-center cursor-pointer" style={{ zIndex: 2 }}
                            onClick={() => openOverrideEditor(day.dateStr)}>
                            <span className="text-[10px] italic" style={{ color: 'var(--text-muted)' }}>No schedule</span>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {loadingEffective && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/10 rounded-2xl" style={{ zIndex: 10 }}>
                <span className="text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>Loading...</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Override editor modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingDate ? `Schedule for ${editingDate}` : 'Edit Schedule'}
        disableBackdropClose
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setIsModalOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleSaveOverride}>
              {editingOverrideId ? 'Update' : 'Save Override'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={modalForm.is_off}
                onChange={e => setModalForm({ ...modalForm, is_off: e.target.checked })}
                className="rounded"
              />
              <span className="text-sm font-bold">Day Off</span>
            </label>
          </div>

          {!modalForm.is_off && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 block">Start Time</label>
                <input type="time" className="w-full border-none rounded-xl p-3 text-sm font-bold" style={{ backgroundColor: 'var(--bg-raised)' }}
                  value={modalForm.start_time} onChange={e => setModalForm({ ...modalForm, start_time: e.target.value })} />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 block">End Time</label>
                <input type="time" className="w-full border-none rounded-xl p-3 text-sm font-bold" style={{ backgroundColor: 'var(--bg-raised)' }}
                  value={modalForm.end_time} onChange={e => setModalForm({ ...modalForm, end_time: e.target.value })} />
              </div>
            </div>
          )}

          <Card variant="info" className="mt-4">
            <div className="flex gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <p className="text-[10px] leading-relaxed">
                This creates a date-specific override. The weekly pattern will be ignored for this date.
                Delete the override to revert to the pattern.
              </p>
            </div>
          </Card>
        </div>
      </Modal>

      {/* Copy week modal */}
      <Modal
        isOpen={showCopyModal}
        onClose={() => setShowCopyModal(false)}
        title="Copy Week Schedule"
        disableBackdropClose
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setShowCopyModal(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleCopyWeek} disabled={!copyTargetDate}>Copy</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Copy the current week's effective schedule ({formatWeekLabel(weekStart)}) to another week as date-specific overrides.
          </p>
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 block">Target Week Start (Sunday)</label>
            <input type="date" className="w-full border-none rounded-xl p-3 text-sm font-bold" style={{ backgroundColor: 'var(--bg-raised)' }}
              value={copyTargetDate} onChange={e => setCopyTargetDate(e.target.value)} />
          </div>
        </div>
      </Modal>
    </div>
  )
}
