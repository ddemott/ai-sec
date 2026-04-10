'use client'

import React, { useState, useEffect, useRef } from 'react'
import {
  ChevronRight,
  ChevronLeft,
  Check,
  X,
  Wand2,
} from 'lucide-react'
import { Api } from '../../lib/api'
import { useStaticData } from '../../lib/hooks'
import { useActiveTenantId } from '../../lib/SessionContext'
import { useVocabulary } from '@/lib/VocabularyContext'
import { Button } from '../ui/Button'
import { showToast } from '../ui/Toast'
import { WizardStepContent } from './WizardStepContent'
import { useWizardCrud } from './useWizardCrud'
import type { WizardStep, WizardService, WizardResource, WizardEmployee, SetupWizardProps } from './types'

function getStepLabels(vocab: { resource_plural: string; employee_plural: string }): Record<WizardStep, string> {
  return {
    1: 'Services',
    2: vocab.resource_plural,
    3: vocab.employee_plural,
    4: 'Shifts',
    5: 'Assignments',
    6: 'Review',
    7: 'Go Live',
  }
}

export default function SetupWizard({ isOpen, onClose }: SetupWizardProps) {
  const tenantId = useActiveTenantId()
  const { services, resources, employees, loading, refresh } = useStaticData(tenantId)
  const vocab = useVocabulary()
  const STEP_LABELS = getStepLabels(vocab)
  const [step, setStep] = useState<WizardStep>(1)

  const crud = useWizardCrud(tenantId, step, refresh)

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }
    return () => { document.body.style.overflow = 'unset' }
  }, [isOpen])

  const seedingRef = useRef(false)

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setStep(1)
      crud.resetAll()
      seedingRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // Auto-seed example services from the business template when no services exist
  useEffect(() => {
    if (!isOpen || !tenantId || loading || seedingRef.current || services.length > 0) return
    seedingRef.current = true
    seedFromTemplate()
    async function seedFromTemplate() {
      try {
        const [config, templates] = await Promise.all([
          Api.tenants.getConfig(tenantId!),
          Api.templates.listFull(),
        ])
        const tpl = (templates || []).find(t => t.business_type === config?.business_type)
        if (!tpl?.example_services?.length) return
        for (const name of tpl.example_services) {
          await Api.services.create(tenantId!, { name, duration_minutes: 30 })
        }
        await refresh()
      } catch {
        // Non-critical — user can still add services manually
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, tenantId, loading, services.length])

  const activeServices: WizardService[] = services.filter(s => !(s as { is_deleted?: boolean }).is_deleted).map(s => ({ id: s.id, name: s.name, description: s.description, duration_minutes: s.duration_minutes, price: s.price }))
  const activeResources: WizardResource[] = resources.filter(r => r.is_active !== false).map(r => ({ id: r.id, name: r.name, description: r.description ?? undefined, is_active: r.is_active }))
  const activeEmployees: WizardEmployee[] = employees.filter(e => !e.is_deleted && e.is_active !== false).map(e => ({ id: e.id, name: e.name, first_name: e.first_name ?? undefined, last_name: e.last_name ?? undefined, email: e.email ?? undefined, phone: e.phone ?? undefined, type: e.type, is_active: e.is_active }))

  const canAdvanceTo = (target: WizardStep): boolean => {
    if (target <= step) return true // backward always allowed
    if (target >= 2 && activeServices.length === 0) return false
    if (target >= 4 && activeEmployees.length === 0) return false
    if (target >= 5 && (activeEmployees.length === 0 || activeServices.length === 0)) return false
    return true
  }

  const goNext = () => {
    const next = Math.min(step + 1, 7) as WizardStep
    if (canAdvanceTo(next)) setStep(next)
    else showToast('Complete this step before continuing', 'warning')
  }
  const goBack = () => setStep(s => Math.max(s - 1, 1) as WizardStep)
  const goToStep = (s: WizardStep) => {
    if (canAdvanceTo(s)) setStep(s)
    else showToast('Complete earlier steps first', 'warning')
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wizard-title"
    >
      <div
        className="bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <header className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <Wand2 className="w-5 h-5 text-blue-500" />
            <h2 id="wizard-title" className="text-lg font-bold text-gray-900 dark:text-gray-100">
              Setup Assistant
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close wizard"
            className="p-1 text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* Progress bar */}
        <div className="px-6 py-3 border-b border-gray-100 dark:border-gray-800 shrink-0">
          <div className="flex items-center gap-1">
            {([1, 2, 3, 4, 5, 6, 7] as WizardStep[]).map(s => (
              <button
                key={s}
                onClick={() => goToStep(s)}
                disabled={!canAdvanceTo(s) && s > step}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  s === step
                    ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                    : s < step
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 cursor-pointer'
                    : !canAdvanceTo(s)
                    ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 opacity-50 cursor-not-allowed'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'
                }`}
              >
                {s < step ? (
                  <Check className="w-3 h-3" />
                ) : (
                  <span className="w-3 text-center">{s}</span>
                )}
                <span className="hidden sm:inline">{STEP_LABELS[s]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          <WizardStepContent
            step={step}
            services={activeServices}
            editingService={crud.editingService}
            editingServiceId={crud.editingServiceId}
            onAddService={crud.startAddService}
            onEditService={crud.startEditService}
            onDeleteService={crud.deleteService}
            onSaveService={crud.saveService}
            onCancelEditService={crud.cancelEditService}
            onChangeService={crud.setEditingService}
            resources={activeResources}
            editingResource={crud.editingResource}
            editingResourceId={crud.editingResourceId}
            onAddResource={crud.startAddResource}
            onEditResource={crud.startEditResource}
            onDeleteResource={crud.deleteResource}
            onSaveResource={crud.saveResource}
            onCancelEditResource={crud.cancelEditResource}
            onChangeResource={crud.setEditingResource}
            employees={activeEmployees}
            editingEmployee={crud.editingEmployee}
            editingEmployeeId={crud.editingEmployeeId}
            onAddEmployee={crud.startAddEmployee}
            onEditEmployee={crud.startEditEmployee}
            onDeleteEmployee={crud.deleteEmployee}
            onSaveEmployee={crud.saveEmployee}
            onCancelEditEmployee={crud.cancelEditEmployee}
            onChangeEmployee={crud.setEditingEmployee}
            shifts={crud.shifts}
            shiftsLoading={crud.shiftsLoading}
            selectedShiftEmployee={crud.selectedShiftEmployee}
            onSelectShiftEmployee={crud.setSelectedShiftEmployee}
            onToggleShift={crud.toggleShift}
            onUpdateShiftTime={crud.updateShiftTime}
            serviceEmployeeMappings={crud.serviceEmployeeMappings}
            serviceResourceMappings={crud.serviceResourceMappings}
            mappingsLoading={crud.mappingsLoading}
            onToggleEmployeeAssignment={crud.toggleEmployeeAssignment}
            onToggleResourceAssignment={crud.toggleResourceAssignment}
            coverageData={crud.coverageData}
            coverageLoading={crud.coverageLoading}
            phoneStatus={null}
            inboundPhone={null}
            loading={loading}
            saving={crud.saving}
            error={crud.error}
          />
        </div>

        {/* Footer */}
        <footer className="px-6 py-4 bg-gray-50 dark:bg-[#222] border-t border-gray-100 dark:border-gray-800 flex items-center justify-between shrink-0">
          <div className="text-xs text-gray-400">
            Step {step} of 7
          </div>
          <div className="flex gap-2">
            {step > 1 && (
              <Button variant="ghost" size="sm" onClick={goBack}>
                <ChevronLeft className="w-4 h-4 mr-1" />
                Back
              </Button>
            )}
            {step < 7 ? (
              <Button variant="primary" size="sm" onClick={goNext}>
                {step === 6 ? 'Go Live' : 'Next'}
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            ) : (
              <Button variant="success" size="sm" onClick={onClose}>
                <Check className="w-4 h-4 mr-1" />
                Done
              </Button>
            )}
          </div>
        </footer>
      </div>
    </div>
  )
}
