'use client'

import React, { useState, useEffect } from 'react'
import { Calendar, Users, Clock, Wrench, ChevronRight, Wand2, ArrowRight } from 'lucide-react'
import { Api } from '../lib/api'
import { useActiveTenantId, useSessionContext } from '../lib/SessionContext'
import { useVocabulary } from '@/lib/VocabularyContext'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { WizardModeChooser } from './SetupWizard/WizardModeChooser'
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

  // Wizard state
  type WizardMode = 'solo' | 'team' | null
  const [wizardMode, setWizardMode] = useState<WizardMode>(null)
  const [wizardDismissed, setWizardDismissed] = useState(false)

  // Check for ?trial=true from landing page CTA
  const [trialParam] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      if (params.get('trial') === 'true') {
        window.history.replaceState({}, '', window.location.pathname)
        return true
      }
    }
    return false
  })

  interface DashboardAppointment { id: string; start_time: string; status: string; description?: string; customer_name?: string }
  interface DashboardEmployee { id: string; name: string; type?: string; is_active: boolean }
  interface DashboardService { id: string | number; name: string }
  interface DashboardResource { id: string; name: string }
  interface CoverageItem { service_id: string | number; service_name: string; coverage_status: string; covered_hours?: number; total_open_hours?: number }

  const [appointments, setAppointments] = useState<DashboardAppointment[]>([])
  const [employees, setEmployees] = useState<DashboardEmployee[]>([])
  const [services, setServices] = useState<DashboardService[]>([])
  const [resources, setResources] = useState<DashboardResource[]>([])
  const [coverage, setCoverage] = useState<CoverageItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!tenantId) return
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId])

  async function loadData() {
    setLoading(true)
    try {
      const today = new Date().toISOString().split('T')[0]
      const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
      const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]

      const [appts, emps, svcs, res, cov] = await Promise.all([
        Api.appointments.list(tenantId, { startDate: today, endDate: tomorrow }).catch(() => []),
        Api.employees.list(tenantId).catch(() => []),
        Api.services.list(tenantId).catch(() => []),
        Api.resources.list(tenantId).catch(() => []),
        Api.coverage.check(tenantId!, today, weekEnd).catch(() => []),
      ])

      setAppointments(Array.isArray(appts) ? appts : [])
      setEmployees(Array.isArray(emps) ? emps.filter((e: DashboardEmployee) => e.type === 'employee' && e.is_active) : [])
      setServices(Array.isArray(svcs) ? svcs : [])
      setResources(Array.isArray(res) ? res : [])
      setCoverage(Array.isArray(cov) ? cov : [])
    } catch (err) {
      console.error('Dashboard load error', err)
    }
    setLoading(false)
  }

  const todayAppointments = appointments.filter((a) => a.status === 'scheduled')

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const needsSetup = services.length === 0 || employees.length === 0 || resources.length === 0

  function handleCloseWizard() {
    setWizardMode(null)
    setWizardDismissed(true)
    loadData() // refresh counts after wizard completes
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

      {/* WIZARD — auto-opens for new tenants, mode chooser first */}
      {showWizardChooser && (
        <WizardModeChooser
          onChoose={(mode) => setWizardMode(mode)}
          onClose={() => setWizardDismissed(true)}
        />
      )}
      {wizardMode === 'solo' && (
        <SoloWizard isOpen={true} onClose={handleCloseWizard} />
      )}
      {wizardMode === 'team' && (
        <SetupWizard isOpen={true} onClose={handleCloseWizard} />
      )}

      {/* STAT CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={Calendar}
          label={`Today's ${vocab.booking_label}s`}
          value={todayAppointments.length}
          onClick={() => onNavigate?.('schedule')}
        />
        <StatCard
          icon={Users}
          label={`${vocab.employee_plural}`}
          value={employees.length}
          onClick={() => onNavigate?.('my-team')}
        />
        <StatCard
          icon={Wrench}
          label="Services"
          value={services.length}
          onClick={() => onNavigate?.('my-business')}
        />
        <StatCard
          icon={Calendar}
          label={`${vocab.resource_plural}`}
          value={resources.length}
          onClick={() => onNavigate?.('my-business')}
        />
      </div>

      {/* SERVICE COVERAGE — neutral data, no judgment */}
      {coverage.length > 0 && (
        <Card>
          <h2 className="font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Calendar className="w-4 h-4" style={{ color: 'var(--accent-soft)' }} />
            This Week&apos;s Coverage
          </h2>
          <div className="space-y-2">
            {coverage.map((c) => (
              <div key={c.service_id} className="flex items-center justify-between py-2 px-3 rounded-lg" style={{ backgroundColor: 'var(--bg-raised)' }}>
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{c.service_name}</span>
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {c.covered_hours}/{c.total_open_hours} hrs covered
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* TODAY'S APPOINTMENTS */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Clock className="w-4 h-4 text-blue-500" />
            Today&apos;s {vocab.booking_label}s
          </h2>
          <button
            onClick={() => onNavigate?.('schedule')}
            className="text-xs hover:underline flex items-center gap-1"
            style={{ color: 'var(--accent-soft)' }}
          >
            View schedule <ChevronRight className="w-3 h-3" />
          </button>
        </div>
        {todayAppointments.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">
            No {vocab.booking_label.toLowerCase()}s scheduled for today.
          </p>
        ) : (
          <div className="space-y-2">
            {todayAppointments.slice(0, 8).map((appt) => (
              <div
                key={appt.id}
                className="flex items-center justify-between p-2.5 rounded-lg border"
                style={{ backgroundColor: 'var(--bg-raised)', borderColor: 'var(--border-soft)' }}
              >
                <div>
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {appt.description || vocab.booking_label}
                  </span>
                  {appt.customer_name && (
                    <span className="text-xs ml-2" style={{ color: 'var(--text-secondary)' }}>
                      — {appt.customer_name}
                    </span>
                  )}
                </div>
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {new Date(appt.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </span>
              </div>
            ))}
            {todayAppointments.length > 8 && (
              <p className="text-xs text-gray-400 text-center pt-1">
                +{todayAppointments.length - 8} more
              </p>
            )}
          </div>
        )}
      </Card>

      {/* QUICK ACTIONS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <QuickAction
          icon={Calendar}
          label={`View Schedule`}
          description={`See today's ${vocab.booking_label.toLowerCase()}s`}
          onClick={() => onNavigate?.('schedule')}
        />
        <QuickAction
          icon={Users}
          label="Manage Team"
          description={`${vocab.employee_plural}, shifts, and skills`}
          onClick={() => onNavigate?.('my-team')}
        />
        <QuickAction
          icon={Wrench}
          label="Setup Assistant"
          description={`Services, ${vocab.resource_plural.toLowerCase()}, assignments`}
          onClick={() => onNavigate?.('my-business')}
        />
      </div>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, onClick }: {
  icon: React.ElementType
  label: string
  value: number
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="p-4 rounded-xl border transition-colors text-left"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-soft)' }}
    >
      <Icon className="w-5 h-5 mb-2" style={{ color: 'var(--accent-soft)' }} />
      <div className="text-2xl font-display" style={{ color: 'var(--text-primary)' }}>{value}</div>
      <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{label}</div>
    </button>
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
