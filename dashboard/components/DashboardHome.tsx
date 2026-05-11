'use client'

import React, { useState, useEffect } from 'react'
import { Calendar, Users, Clock, Wrench, ChevronRight, Wand2, ArrowRight, AlertCircle } from 'lucide-react'
import { Api } from '../lib/api'
import { useActiveTenantId, useSessionContext } from '../lib/SessionContext'
import { useVocabulary, useVocabularyRefresh } from '@/lib/VocabularyContext'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { WizardModeChooser } from './SetupWizard/WizardModeChooser'
import { BusinessTypePicker } from './SetupWizard/BusinessTypePicker'
import SetupWizard from './SetupWizard'
import SoloWizard from './SetupWizard/SoloWizard'
import type { Tab } from '../app/dashboard/page'

interface DashboardHomeProps {
  onNavigate?: (tab: Tab) => void
}

export default function DashboardHome({ onNavigate }: DashboardHomeProps) {
  const tenantId = useActiveTenantId()
  const { userName } = useSessionContext()
  const vocab = useVocabulary()
  const refreshVocabulary = useVocabularyRefresh()

  // Wizard state: null → mode chooser, 'solo'/'team' → business picker, then wizard
  type WizardMode = 'solo' | 'team' | null
  const [wizardMode, setWizardMode] = useState<WizardMode>(null)
  const [businessTypeReady, setBusinessTypeReady] = useState(false)
  const [wizardDismissed, setWizardDismissed] = useState(false)

  // Clean ?trial=true from landing page CTA on mount
  useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      if (params.get('trial') === 'true') {
        window.history.replaceState({}, '', window.location.pathname)
      }
    }
  })

  interface DashboardAppointment {
    id: string; start_time: string; end_time?: string; status: string; description?: string; customer_name?: string;
    employee_id?: string | null;
    customers?: { name?: string; first_name?: string; last_name?: string; phone?: string };
    resources?: { name?: string };
  }
  interface DashboardEmployee { id: string; name: string; first_name?: string | null; last_name?: string | null; type?: string; is_active: boolean }
  interface DashboardService { id: string; name: string }
  interface DashboardResource { id: string; name: string }

  const [appointments, setAppointments] = useState<DashboardAppointment[]>([])
  const [employees, setEmployees] = useState<DashboardEmployee[]>([])
  const [services, setServices] = useState<DashboardService[]>([])
  const [resources, setResources] = useState<DashboardResource[]>([])
  const [loading, setLoading] = useState(true)
  // Surface load failures so an empty dashboard can never be confused with
  // "new tenant with no data yet." The older silent `.catch(() => [])`
  // pattern left owners unsure whether they had no bookings, or the app
  // had lost its connection — a trust-eroding ambiguity.
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!tenantId) return
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId])

  async function loadData() {
    setLoading(true)
    setLoadError(null)
    const today = new Date().toISOString().split('T')[0]
    const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]

    // Track whether any of the 4 data calls failed. Promise.all would
    // reject on first failure and leave partial state unset; Promise
    // .allSettled lets each call succeed or fail independently so we
    // render partial data and show a dismissable error for the gaps.
    const results = await Promise.allSettled([
      Api.appointments.list(tenantId, { startDate: today, endDate: weekEnd }),
      Api.employees.list(tenantId),
      Api.services.list(tenantId),
      Api.resources.list(tenantId),
    ])

    const [apptsR, empsR, svcsR, resR] = results

    setAppointments(apptsR.status === 'fulfilled' && Array.isArray(apptsR.value) ? apptsR.value : [])
    setEmployees(
      empsR.status === 'fulfilled' && Array.isArray(empsR.value)
        ? empsR.value.filter((e: DashboardEmployee) => e.type === 'employee' && e.is_active)
        : []
    )
    setServices(svcsR.status === 'fulfilled' && Array.isArray(svcsR.value) ? svcsR.value : [])
    setResources(resR.status === 'fulfilled' && Array.isArray(resR.value) ? resR.value : [])

    const anyFailed = results.some((r) => r.status === 'rejected')
    if (anyFailed) {
      setLoadError("Couldn't load all your data. Check your connection and try again.")
    }
    setLoading(false)
  }

  const todayStr = new Date().toISOString().split('T')[0]
  const todayAppointments = appointments
    .filter((a) => a.status === 'scheduled' && a.start_time.startsWith(todayStr))
    .sort((a, b) => a.start_time.localeCompare(b.start_time))

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const needsSetup = services.length === 0 || employees.length === 0 || resources.length === 0

  function handleCloseWizard() {
    setWizardMode(null)
    setBusinessTypeReady(false)
    setWizardDismissed(true)
    loadData() // refresh counts after wizard completes
  }

  async function handleBusinessTypeSelected(businessType: string) {
    if (!tenantId) return
    try {
      // Fetch the full template to apply its settings
      const templates = await Api.templates.listFull()
      const tpl = (templates || []).find(t => t.business_type === businessType)
      // Update tenant config with template values
      await Api.tenants.updateConfig(tenantId, {
        business_type: businessType,
        system_prompt: tpl?.system_prompt_template || undefined,
        voice_id: tpl?.voice_id || undefined,
        first_message: tpl?.first_message || undefined,
      })
      refreshVocabulary()
      setBusinessTypeReady(true)
    } catch {
      // Still proceed — worst case they get default vocabulary
      setBusinessTypeReady(true)
    }
  }

  // Auto-show wizard chooser for new tenants that need setup
  // trialParam only triggers the wizard if the tenant actually needs setup
  const showWizardChooser = needsSetup && !wizardDismissed && !wizardMode && !loading

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse text-gray-400">Loading dashboard...</div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-5xl mx-auto">
      {/* GREETING */}
      <div>
        <h1 className="text-2xl font-display">
          {greeting}, {userName || 'there'}
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        </p>
      </div>

      {/* LOAD ERROR — shown when any of the four parallel fetches failed.
          Retryable in-place so users don't have to reload the whole app. */}
      {loadError && (
        <div
          role="alert"
          className="rounded-xl border-2 p-4 flex items-start gap-3"
          style={{ borderColor: 'var(--red, #dc2626)', backgroundColor: 'var(--bg-raised)' }}
        >
          <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" style={{ color: 'var(--red, #dc2626)' }} aria-hidden="true" />
          <div className="flex-1">
            <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {loadError}
            </div>
            <Button variant="secondary" size="sm" className="mt-2" onClick={loadData}>
              Try again
            </Button>
          </div>
          <button
            onClick={() => setLoadError(null)}
            aria-label="Dismiss error"
            className="text-xs px-2 py-1 rounded hover:brightness-125"
            style={{ color: 'var(--text-muted)' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* SETUP PROMPT — shown if wizard was dismissed but setup still incomplete */}
      {needsSetup && wizardDismissed && (
        <div className="rounded-xl border-2 p-5" style={{ borderColor: 'var(--accent)', backgroundColor: 'var(--accent-muted)' }}>
          <div className="flex items-start gap-4">
            <div className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-raised)' }}>
              <Wand2 className="w-6 h-6" style={{ color: 'var(--accent-soft)' }} />
            </div>
            <div className="flex-1">
              <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Finish setting up your business</h2>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                {services.length === 0 && `Add your services. `}
                {resources.length === 0 && `Add your ${vocab.resource_plural.toLowerCase()}. `}
                {employees.length === 0 && `Add your ${vocab.employee_plural.toLowerCase()}. `}
              </p>
              <Button
                variant="primary"
                size="sm"
                className="mt-3"
                onClick={() => setWizardDismissed(false)}
              >
                <Wand2 className="w-4 h-4 mr-1.5" />
                Open Setup Assistant
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* WIZARD — auto-opens for new tenants: mode chooser → business type → wizard */}
      {showWizardChooser && (
        <WizardModeChooser
          onChoose={(mode) => setWizardMode(mode)}
          onClose={() => setWizardDismissed(true)}
        />
      )}
      {wizardMode && !businessTypeReady && (
        <BusinessTypePicker
          onSelect={handleBusinessTypeSelected}
          onBack={() => setWizardMode(null)}
          onClose={handleCloseWizard}
        />
      )}
      {wizardMode === 'solo' && businessTypeReady && (
        <SoloWizard isOpen={true} onClose={handleCloseWizard} />
      )}
      {wizardMode === 'team' && businessTypeReady && (
        <SetupWizard isOpen={true} onClose={handleCloseWizard} />
      )}

      {/* TODAY'S SCHEDULE — the whole header row is a click target
          (Fitts's Law: larger targets are faster to hit). The 12px
          "Full schedule" link previously WAS the only affordance but
          was barely tappable on mobile. Now the entire header behaves
          as one button; the chevron stays as the visual cue. */}
      <Card>
        <button
          type="button"
          onClick={() => onNavigate?.('schedule')}
          aria-label="View full schedule"
          className="w-full flex items-center justify-between mb-4 rounded-md transition-colors hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-offset-2 group"
          style={{ '--tw-ring-color': 'var(--accent-glow)' } as React.CSSProperties}
        >
          <h2 className="font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Clock className="w-4 h-4" style={{ color: 'var(--accent-soft)' }} aria-hidden="true" />
            Today&apos;s Schedule
          </h2>
          <span
            className="text-xs flex items-center gap-1 group-hover:underline"
            style={{ color: 'var(--accent-soft)' }}
          >
            Full schedule <ChevronRight className="w-3 h-3" aria-hidden="true" />
          </span>
        </button>
        {todayAppointments.length === 0 ? (
          <div className="py-4 text-center">
            <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
              Nothing booked for today yet.
            </p>
            <div className="flex gap-2 justify-center flex-wrap">
              <Button variant="secondary" size="sm" onClick={() => onNavigate?.('schedule')}>
                <Calendar className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
                View this week
              </Button>
              {employees.length > 1 && (
                <Button variant="secondary" size="sm" onClick={() => onNavigate?.('my-team')}>
                  <Users className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
                  See staff shifts
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            {todayAppointments.map((appt) => {
              const startTime = new Date(appt.start_time)
              const endTime = appt.end_time ? new Date(appt.end_time) : null
              const customerName = appt.customers
                ? [appt.customers.first_name, appt.customers.last_name].filter(Boolean).join(' ') || appt.customers.name
                : appt.customer_name
              return (
                <div
                  key={appt.id}
                  className="flex items-center gap-3 p-3 rounded-lg border"
                  style={{ backgroundColor: 'var(--bg-raised)', borderColor: 'var(--border-soft)' }}
                >
                  <div className="text-right" style={{ minWidth: '5.5rem' }}>
                    <div className="text-sm font-bold" style={{ color: 'var(--accent-soft)' }}>
                      {startTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                    </div>
                    {endTime && (
                      <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        to {endTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                      </div>
                    )}
                  </div>
                  <div className="w-px h-8 rounded" style={{ backgroundColor: 'var(--accent)' }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                      {appt.description || vocab.booking_label}
                    </div>
                    <div className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                      {customerName || 'Walk-in'}
                      {appt.resources?.name && ` · ${appt.resources.name}`}
                    </div>
                  </div>
                </div>
              )
            })}
            {todayAppointments.length > 10 && (
              <button
                className="text-xs text-center pt-1 w-full hover:underline cursor-pointer"
                style={{ color: 'var(--accent)' }}
                onClick={() => onNavigate?.('schedule')}
              >
                +{todayAppointments.length - 10} more — view schedule
              </button>
            )}
          </div>
        )}
      </Card>

      {/* THIS WEEK — day by day with appointment counts and who's working */}
      <Card>
        <h2 className="font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <Calendar className="w-4 h-4" style={{ color: 'var(--accent-soft)' }} />
          This Week
        </h2>
        <WeekView
          tenantId={tenantId}
          employees={employees}
          vocab={vocab}
          onNavigate={onNavigate}
        />
      </Card>

      {/* QUICK ACTIONS — 1 col on phones, 2 on tablets (cards need space
          for icon + label + description without truncating), 3 on
          desktop. The previous md:grid-cols-3 was cramped at 768-900px. */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <QuickAction
          icon={Calendar}
          label={`View Schedule`}
          description={`Open the full scheduler`}
          onClick={() => onNavigate?.('schedule')}
        />
        <QuickAction
          icon={Users}
          label={employees.length <= 1 ? 'My Business' : 'Manage Team'}
          description={employees.length <= 1 ? 'Services and availability' : `${vocab.employee_plural}, shifts, and skills`}
          onClick={() => onNavigate?.(employees.length <= 1 ? 'my-business' : 'my-team')}
        />
        <QuickAction
          icon={Wrench}
          label="Services & Resources"
          description={`Services, ${vocab.resource_plural.toLowerCase()}, assignments`}
          onClick={() => onNavigate?.('my-business')}
        />
      </div>
    </div>
  )
}

function WeekView({ tenantId, employees, vocab, onNavigate }: {
  tenantId: string | null
  employees: { id: string; name: string; first_name?: string | null; last_name?: string | null }[]
  vocab: { booking_label: string; employee_label: string }
  onNavigate?: (tab: Tab) => void
}) {
  const [weekAppts, setWeekAppts] = useState<{ date: string; count: number; appts: { time: string; desc: string; employee?: string }[] }[]>([])
  const [weekShifts, setWeekShifts] = useState<Record<string, { name: string; start: string; end: string; isOff: boolean }[]>>({})

  useEffect(() => {
    if (!tenantId) return
    loadWeekData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId])

  async function loadWeekData() {
    const today = new Date()
    const days: string[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(today)
      d.setDate(d.getDate() + i)
      days.push(d.toISOString().split('T')[0])
    }

    // Fetch appointments for the week
    const weekEnd = days[6]
    try {
      const appts = await Api.appointments.list(tenantId, { startDate: days[0], endDate: new Date(new Date(weekEnd).getTime() + 86400000).toISOString().split('T')[0] })
      const apptList = Array.isArray(appts) ? appts.filter(a => a.status === 'scheduled') : []

      const byDay = days.map(date => {
        const dayAppts = apptList
          .filter(a => a.start_time.startsWith(date))
          .sort((a, b) => a.start_time.localeCompare(b.start_time))
        return {
          date,
          count: dayAppts.length,
          appts: dayAppts.slice(0, 4).map(a => {
            const empName = a.employee_id && employees.find(e => e.id === String(a.employee_id))
            return {
              time: new Date(a.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
              desc: a.description || vocab.booking_label,
              employee: empName ? (empName.first_name || empName.name) : undefined,
            }
          }),
        }
      })
      setWeekAppts(byDay)
    } catch {
      // Silent fail — week view is supplementary
    }

    // Fetch shifts for each employee
    if (employees.length > 0 && employees.length <= 10) {
      const shiftMap: Record<string, { name: string; start: string; end: string; isOff: boolean }[]> = {}
      try {
        const shiftPromises = employees.map(emp =>
          Api.shifts.schedule.forDate(tenantId, emp.id, days[0], days[6])
            .then(shifts => ({ empId: emp.id, empName: emp.first_name || emp.name, shifts }))
            .catch(() => ({ empId: emp.id, empName: emp.first_name || emp.name, shifts: [] }))
        )
        const results = await Promise.all(shiftPromises)
        for (const { empName, shifts } of results) {
          for (const shift of shifts) {
            const dateKey = shift.shift_date
            if (!shiftMap[dateKey]) shiftMap[dateKey] = []
            shiftMap[dateKey].push({
              name: empName,
              start: shift.start_time || '',
              end: shift.end_time || '',
              isOff: shift.is_off,
            })
          }
        }
        setWeekShifts(shiftMap)
      } catch {
        // Silent fail
      }
    }
  }

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  function formatShiftTime(t: string) {
    if (!t) return ''
    const [h, m] = t.split(':').map(Number)
    const ampm = h >= 12 ? 'p' : 'a'
    const hour = h % 12 || 12
    return m === 0 ? `${hour}${ampm}` : `${hour}:${String(m).padStart(2, '0')}${ampm}`
  }

  if (weekAppts.length === 0) {
    return (
      <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>
        No recent activity
      </p>
    )
  }

  return (
    <div className="grid grid-cols-7 gap-2">
      {weekAppts.map((day) => {
        const date = new Date(day.date + 'T12:00:00')
        const dayName = DAY_NAMES[date.getDay()]
        const dayNum = date.getDate()
        const isToday = day.date === new Date().toISOString().split('T')[0]
        const dayShifts = weekShifts[day.date] || []
        const workingStaff = dayShifts.filter(s => !s.isOff)

        return (
          <button
            key={day.date}
            onClick={() => onNavigate?.('schedule')}
            className="rounded-xl p-2.5 border text-left transition-colors"
            style={{
              borderColor: isToday ? 'var(--accent)' : 'var(--border-soft)',
              backgroundColor: isToday ? 'var(--accent-muted)' : 'var(--bg-surface)',
            }}
          >
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{dayName}</span>
              <span className="text-lg font-bold" style={{ color: isToday ? 'var(--accent-soft)' : 'var(--text-primary)' }}>{dayNum}</span>
            </div>

            {/* Appointment count */}
            {day.count > 0 ? (
              <div className="text-xs font-medium mb-1" style={{ color: 'var(--accent-soft)' }}>
                {day.count} {day.count === 1 ? vocab.booking_label.toLowerCase() : `${vocab.booking_label.toLowerCase()}s`}
              </div>
            ) : (
              <div className="text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>
                No bookings
              </div>
            )}

            {/* First few appointments */}
            {day.appts.slice(0, 2).map((a, i) => (
              <div key={i} className="text-[10px] truncate" style={{ color: 'var(--text-secondary)' }}>
                {a.time} {a.desc}
              </div>
            ))}
            {day.count > 2 && (
              <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>+{day.count - 2} more</div>
            )}

            {/* Who's working */}
            {workingStaff.length > 0 && employees.length > 1 && (
              <div className="mt-1.5 pt-1.5 border-t" style={{ borderColor: 'var(--border-soft)' }}>
                {workingStaff.slice(0, 2).map((s, i) => (
                  <div key={i} className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>
                    {s.name} {formatShiftTime(s.start)}–{formatShiftTime(s.end)}
                  </div>
                ))}
                {workingStaff.length > 2 && (
                  <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>+{workingStaff.length - 2} more</div>
                )}
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}

function QuickAction({ icon: Icon, label, description, onClick }: {
  icon: React.ElementType
  label: string
  description: string
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 p-4 rounded-xl border transition-colors text-left"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-soft)' }}
    >
      <div className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-raised)' }}>
        <Icon className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
      </div>
      <div>
        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{label}</div>
        <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{description}</div>
      </div>
      <ArrowRight className="w-4 h-4 text-gray-400 ml-auto" />
    </button>
  )
}
