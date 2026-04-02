'use client'

import React, { useState, useEffect } from 'react'
import { ChevronRight, ChevronLeft, X, Wand2 } from 'lucide-react'
import { Api } from '../../lib/api'
import { useStaticData } from '../../lib/hooks'
import { useActiveTenantId, useSessionContext } from '@/lib/SessionContext'
import { useVocabulary } from '@/lib/VocabularyContext'
import { Button } from '../ui/Button'
import { Step1Services } from './StepServices'
import { SoloStepHours } from './SoloStepHours'
import { SoloStepReview } from './SoloStepReview'
import type { ServiceForm, WizardShift, WizardService, SetupWizardProps } from './types'
import type { CoverageItem } from '../../lib/types'
import { EMPTY_SERVICE } from './types'

type SoloStep = 1 | 2 | 3

const STEP_LABELS: Record<SoloStep, string> = { 1: 'Services', 2: 'Your Hours', 3: 'Review' }

export default function SoloWizard({ isOpen, onClose }: SetupWizardProps) {
  const tenantId = useActiveTenantId()
  const { userName } = useSessionContext()
  const { services, loading, refresh } = useStaticData(tenantId)
  const vocab = useVocabulary()
  const [step, setStep] = useState<SoloStep>(1)

  // Step 1 — Services (reuses team wizard)
  const [editingService, setEditingService] = useState<ServiceForm | null>(null)
  const [editingServiceId, setEditingServiceId] = useState<string | number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Step 2 — Hours
  const [shifts, setShifts] = useState<WizardShift[]>([])
  const [shiftsLoading, setShiftsLoading] = useState(false)
  const [ownerEmployeeId, setOwnerEmployeeId] = useState<string | null>(null)

  // Step 3 — Finalization
  const [finalizing, setFinalizing] = useState(false)
  const [finalized, setFinalized] = useState(false)
  const [coverageData, setCoverageData] = useState<CoverageItem[]>([])

  const ownerName = userName || 'Owner'
  const resourceName = vocab.resource_label === 'Resource' ? 'Main Station' : vocab.resource_label + ' 1'

  // Reset state when wizard opens
  useEffect(() => {
    if (isOpen) {
      setStep(1)
      setEditingService(null)
      setEditingServiceId(null)
      setError(null)
      setFinalized(false)
      setCoverageData([])
      setOwnerEmployeeId(null)
      setShifts([])
    }
  }, [isOpen])

  // When moving to Step 2, ensure owner employee exists and load shifts
  useEffect(() => {
    if (step === 2 && tenantId) {
      ensureOwnerEmployee()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, tenantId])

  async function ensureOwnerEmployee() {
    if (ownerEmployeeId) {
      loadShifts(ownerEmployeeId)
      return
    }

    setSaving(true)
    setError(null)
    try {
      const nameParts = (ownerName || 'Owner').split(' ')
      const firstName = nameParts[0] || 'Owner'
      const lastName = nameParts.slice(1).join(' ') || ''

      const res = await Api.employees.create(tenantId, {
        name: ownerName,
        first_name: firstName,
        last_name: lastName,
        skills: [],
      })
      if (res.success && res.employee) {
        const empId = String(res.employee.id)
        setOwnerEmployeeId(empId)
        await loadShifts(empId)
      } else {
        setError(res.error || 'Failed to create your staff profile')
      }
    } catch {
      setError('Failed to create your staff profile')
    } finally {
      setSaving(false)
    }
  }

  async function loadShifts(employeeId: string) {
    setShiftsLoading(true)
    try {
      const data = await Api.shifts.list(tenantId)
      const ownerShifts = (Array.isArray(data) ? data : [])
        .filter(s => String(s.employee_id) === employeeId)
        .map(s => ({ ...s, id: s.id ?? `${s.day_of_week}` })) as WizardShift[]
      setShifts(ownerShifts)
    } catch {
      setError('Failed to load shifts')
    } finally {
      setShiftsLoading(false)
    }
  }

  // --- Service CRUD (same as team wizard) ---
  async function handleSaveService() {
    if (!editingService || !tenantId) return
    setSaving(true)
    setError(null)
    try {
      if (editingServiceId) {
        await Api.services.update(editingServiceId, tenantId, editingService)
      } else {
        await Api.services.create(tenantId, editingService)
      }
      await refresh()
      setEditingService(null)
      setEditingServiceId(null)
    } catch {
      setError('Failed to save service')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteService(id: string | number) {
    if (!tenantId) return
    setSaving(true)
    try {
      await Api.services.delete(String(id), tenantId)
      await refresh()
    } catch {
      setError('Failed to delete service')
    } finally {
      setSaving(false)
    }
  }

  // --- Shift toggle ---
  async function handleToggleDay(dayOfWeek: number) {
    if (!ownerEmployeeId || !tenantId) return
    const existing = shifts.find(s => s.day_of_week === dayOfWeek)
    setSaving(true)
    setError(null)
    try {
      if (existing) {
        await Api.shifts.delete(String(existing.id), tenantId)
      } else {
        await Api.shifts.create(tenantId, {
          employee_id: ownerEmployeeId,
          day_of_week: dayOfWeek,
          start_time: '08:00',
          end_time: '17:00',
        })
      }
      await loadShifts(ownerEmployeeId)
    } catch {
      setError('Failed to update shift')
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdateTime(shiftId: string | number, startTime: string, endTime: string) {
    if (!tenantId) return
    setSaving(true)
    try {
      await Api.shifts.update(String(shiftId), tenantId, { start_time: startTime, end_time: endTime })
      await loadShifts(ownerEmployeeId!)
    } catch {
      setError('Failed to update shift time')
    } finally {
      setSaving(false)
    }
  }

  // --- Finalization (Step 3) ---
  async function handleFinalize() {
    if (!tenantId || !ownerEmployeeId) return
    setFinalizing(true)
    setError(null)
    try {
      // 1. Create default resource
      const resResult = await Api.resources.create(tenantId, {
        name: resourceName,
        description: 'Auto-created during solo setup',
      })
      const resourceId = resResult.success && resResult.resource ? resResult.resource.id : null
      if (!resourceId) throw new Error('Failed to create work station')

      // 2. Assign all services to employee + resource
      for (const svc of services) {
        await Api.mappings.assignServiceEmployee(String(svc.id), ownerEmployeeId, tenantId)
        await Api.mappings.assignServiceResource(String(svc.id), resourceId, tenantId)
      }

      // 3. Fetch coverage
      const coverage = await Api.coverage.check(tenantId)
      setCoverageData(Array.isArray(coverage) ? coverage : [])

      setFinalized(true)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed. Please try again.')
    } finally {
      setFinalizing(false)
    }
  }

  if (!isOpen) return null

  const wizardServices: WizardService[] = (services || []).map(s => ({
    id: s.id,
    name: s.name,
    description: s.description || '',
    duration_minutes: s.duration_minutes,
    price: s.price ?? undefined,
  }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div
        className="rounded-2xl shadow-xl border max-w-lg w-full max-h-[85vh] flex flex-col overflow-hidden"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between shrink-0" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <Wand2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h2 className="text-lg font-bold">Solo Setup</h2>
          </div>
          <button onClick={onClose} className="p-1 transition" style={{ color: 'var(--text-secondary)' }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="px-6 py-3 flex gap-2 shrink-0 border-b" style={{ borderColor: 'var(--border)' }}>
          {([1, 2, 3] as SoloStep[]).map(s => (
            <button
              key={s}
              onClick={() => !finalized && s <= step && setStep(s)}
              className={`flex-1 text-xs font-medium py-1.5 rounded-lg transition-colors ${
                s === step
                  ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                  : s < step
                  ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'
              }`}
            >
              {STEP_LABELS[s]}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto px-6 py-4">
          {step === 1 && (
            <Step1Services
              services={wizardServices}
              loading={loading}
              editingService={editingService}
              editingServiceId={editingServiceId}
              saving={saving}
              error={error}
              onAdd={() => { setEditingService({ ...EMPTY_SERVICE }); setEditingServiceId(null) }}
              onEdit={(svc: WizardService) => {
                setEditingService({ name: svc.name, description: svc.description || '', duration_minutes: svc.duration_minutes, price: svc.price ?? undefined })
                setEditingServiceId(svc.id)
              }}
              onDelete={handleDeleteService}
              onSave={handleSaveService}
              onCancel={() => { setEditingService(null); setEditingServiceId(null); setError(null) }}
              onChange={setEditingService}
            />
          )}

          {step === 2 && (
            <SoloStepHours
              shifts={shifts}
              loading={shiftsLoading}
              saving={saving}
              error={error}
              onToggleDay={handleToggleDay}
              onUpdateTime={handleUpdateTime}
            />
          )}

          {step === 3 && (
            <SoloStepReview
              services={services}
              shifts={shifts}
              coverageData={coverageData}
              finalizing={finalizing}
              finalized={finalized}
              error={error}
              ownerName={ownerName}
              resourceName={resourceName}
              onFinalize={handleFinalize}
            />
          )}
        </div>

        {/* Footer navigation */}
        <div className="px-6 py-3 border-t flex justify-between shrink-0" style={{ borderColor: 'var(--border)' }}>
          {step > 1 && !finalized ? (
            <Button variant="secondary" onClick={() => setStep((step - 1) as SoloStep)}>
              <ChevronLeft className="w-4 h-4 mr-1" /> Back
            </Button>
          ) : <div />}

          {step < 3 ? (
            <Button onClick={() => setStep((step + 1) as SoloStep)} disabled={step === 1 && services.length === 0}>
              Next <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          ) : finalized ? (
            <Button onClick={onClose}>Done</Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
