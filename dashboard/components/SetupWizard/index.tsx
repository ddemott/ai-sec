'use client'

import React, { useState, useEffect } from 'react'
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
import { WizardStepContent } from './WizardStepContent'
import type {
  WizardStep,
  ServiceForm,
  ResourceForm,
  EmployeeForm,
  WizardShift,
  WizardMapping,
  CoverageItem,
  WizardService,
  WizardResource,
  WizardEmployee,
  SetupWizardProps,
} from './types'
import { EMPTY_SERVICE, EMPTY_RESOURCE, EMPTY_EMPLOYEE } from './types'

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

  // Step 1 — Services
  const [editingService, setEditingService] = useState<ServiceForm | null>(null)
  const [editingServiceId, setEditingServiceId] = useState<string | number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Step 2 — Resources
  const [editingResource, setEditingResource] = useState<ResourceForm | null>(null)
  const [editingResourceId, setEditingResourceId] = useState<string | null>(null)

  // Step 3 — Employees
  const [editingEmployee, setEditingEmployee] = useState<EmployeeForm | null>(null)
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null)

  // Step 4 — Shifts
  const [shifts, setShifts] = useState<WizardShift[]>([])
  const [shiftsLoading, setShiftsLoading] = useState(false)
  const [selectedShiftEmployee, setSelectedShiftEmployee] = useState<string | null>(null)

  // Step 5 — Assignments
  const [serviceEmployeeMappings, setServiceEmployeeMappings] = useState<WizardMapping[]>([])
  const [serviceResourceMappings, setServiceResourceMappings] = useState<WizardMapping[]>([])
  const [mappingsLoading, setMappingsLoading] = useState(false)

  // Step 6 — Coverage
  const [coverageData, setCoverageData] = useState<CoverageItem[]>([])
  const [coverageLoading, setCoverageLoading] = useState(false)

  // Fetch shifts when entering step 4
  useEffect(() => {
    if (step === 4 && tenantId) {
      setShiftsLoading(true)
      Api.shifts.list(tenantId).then((data: WizardShift[]) => {
        setShifts(Array.isArray(data) ? data : [])
      }).catch(() => setShifts([])).finally(() => setShiftsLoading(false))
    }
  }, [step, tenantId])

  // Fetch mappings when entering step 5
  useEffect(() => {
    if (step === 5 && tenantId) {
      setMappingsLoading(true)
      Promise.all([
        Api.mappings.listServiceEmployee(tenantId),
        Api.mappings.listServiceResource(tenantId),
      ]).then(([empMaps, resMaps]) => {
        setServiceEmployeeMappings(Array.isArray(empMaps) ? empMaps : [])
        setServiceResourceMappings(Array.isArray(resMaps) ? resMaps : [])
      }).catch(() => {
        setServiceEmployeeMappings([])
        setServiceResourceMappings([])
      }).finally(() => setMappingsLoading(false))
    }
  }, [step, tenantId])

  // Fetch coverage when entering step 6
  useEffect(() => {
    if (step === 6 && tenantId) {
      setCoverageLoading(true)
      Api.coverage.check(tenantId).then((data: CoverageItem[]) => {
        setCoverageData(Array.isArray(data) ? data : [])
      }).catch(() => setCoverageData([])).finally(() => setCoverageLoading(false))
    }
  }, [step, tenantId])

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }
    return () => { document.body.style.overflow = 'unset' }
  }, [isOpen])

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setStep(1)
      setEditingService(null)
      setEditingServiceId(null)
      setEditingResource(null)
      setEditingResourceId(null)
      setEditingEmployee(null)
      setEditingEmployeeId(null)
      setShifts([])
      setSelectedShiftEmployee(null)
      setServiceEmployeeMappings([])
      setServiceResourceMappings([])
      setCoverageData([])
      setError(null)
    }
  }, [isOpen])

  const goNext = () => setStep(s => Math.min(s + 1, 7) as WizardStep)
  const goBack = () => setStep(s => Math.max(s - 1, 1) as WizardStep)
  const goToStep = (s: WizardStep) => setStep(s)

  // --- Service CRUD ---

  function startAddService() {
    setEditingService({ ...EMPTY_SERVICE })
    setEditingServiceId(null)
    setError(null)
  }

  function startEditService(svc: WizardService) {
    setEditingService({
      name: svc.name || '',
      description: svc.description || '',
      duration_minutes: svc.duration_minutes || 30,
      price: svc.price ?? undefined,
    })
    setEditingServiceId(svc.id)
    setError(null)
  }

  function cancelEditService() {
    setEditingService(null)
    setEditingServiceId(null)
    setError(null)
  }

  async function saveService() {
    if (!editingService || !tenantId) return
    if (!editingService.name.trim()) {
      setError('Service name is required')
      return
    }
    if (editingService.duration_minutes < 1) {
      setError('Duration must be at least 1 minute')
      return
    }

    setSaving(true)
    setError(null)
    try {
      if (editingServiceId) {
        await Api.services.update(editingServiceId, tenantId, {
          name: editingService.name.trim(),
          description: editingService.description.trim(),
          duration_minutes: editingService.duration_minutes,
        })
      } else {
        await Api.services.create(tenantId, {
          name: editingService.name.trim(),
          description: editingService.description.trim(),
          duration_minutes: editingService.duration_minutes,
        })
      }
      await refresh()
      setEditingService(null)
      setEditingServiceId(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err) || 'Failed to save service')
    } finally {
      setSaving(false)
    }
  }

  async function deleteService(id: string | number) {
    if (!tenantId) return
    setSaving(true)
    try {
      await Api.services.delete(String(id), tenantId)
      await refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err) || 'Failed to delete service')
    } finally {
      setSaving(false)
    }
  }

  // --- Resource CRUD ---

  function startAddResource() {
    setEditingResource({ ...EMPTY_RESOURCE })
    setEditingResourceId(null)
    setError(null)
  }

  function startEditResource(res: WizardResource) {
    setEditingResource({ name: res.name || '', description: res.description || '' })
    setEditingResourceId(res.id)
    setError(null)
  }

  function cancelEditResource() {
    setEditingResource(null)
    setEditingResourceId(null)
    setError(null)
  }

  async function saveResource() {
    if (!editingResource || !tenantId) return
    if (!editingResource.name.trim()) {
      setError('Resource name is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (editingResourceId) {
        await Api.resources.update(editingResourceId, { name: editingResource.name.trim(), description: editingResource.description.trim() }, tenantId)
      } else {
        await Api.resources.create(tenantId, { name: editingResource.name.trim(), description: editingResource.description.trim() })
      }
      await refresh()
      setEditingResource(null)
      setEditingResourceId(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err) || 'Failed to save resource')
    } finally {
      setSaving(false)
    }
  }

  async function deleteResource(id: string) {
    if (!tenantId) return
    setSaving(true)
    try {
      await Api.resources.delete(id, tenantId)
      await refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err) || 'Failed to delete resource')
    } finally {
      setSaving(false)
    }
  }

  // --- Employee CRUD ---

  function startAddEmployee() {
    setEditingEmployee({ ...EMPTY_EMPLOYEE })
    setEditingEmployeeId(null)
    setError(null)
  }

  function startEditEmployee(emp: WizardEmployee) {
    setEditingEmployee({
      first_name: emp.first_name || '',
      last_name: emp.last_name || '',
      email: emp.email || '',
      phone: emp.phone || '',
    })
    setEditingEmployeeId(String(emp.id))
    setError(null)
  }

  function cancelEditEmployee() {
    setEditingEmployee(null)
    setEditingEmployeeId(null)
    setError(null)
  }

  async function saveEmployee() {
    if (!editingEmployee || !tenantId) return
    if (!editingEmployee.first_name.trim()) {
      setError('First name is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const name = `${editingEmployee.first_name.trim()} ${editingEmployee.last_name.trim()}`.trim()
      if (editingEmployeeId) {
        await Api.employees.update(editingEmployeeId, {
          tenant_id: tenantId, name, first_name: editingEmployee.first_name.trim(), last_name: editingEmployee.last_name.trim(),
          email: editingEmployee.email.trim(), phone: editingEmployee.phone.trim(),
        })
      } else {
        await Api.employees.create(tenantId, {
          name, first_name: editingEmployee.first_name.trim(), last_name: editingEmployee.last_name.trim(),
          email: editingEmployee.email.trim(), phone: editingEmployee.phone.trim(),
        })
      }
      await refresh()
      setEditingEmployee(null)
      setEditingEmployeeId(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err) || 'Failed to save employee')
    } finally {
      setSaving(false)
    }
  }

  async function deleteEmployee(id: string | number) {
    if (!tenantId) return
    setSaving(true)
    try {
      await Api.employees.delete(String(id), tenantId)
      await refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err) || 'Failed to delete employee')
    } finally {
      setSaving(false)
    }
  }

  // --- Shift CRUD ---

  async function refreshShifts() {
    if (!tenantId) return
    const data = await Api.shifts.list(tenantId)
    setShifts(Array.isArray(data) ? data : [])
  }

  async function toggleShift(employeeId: string, dayOfWeek: number, startTime: string, endTime: string) {
    if (!tenantId) return
    const existing = shifts.find(
      (s: WizardShift) => String(s.employee_id) === String(employeeId) && s.day_of_week === dayOfWeek
    )
    setSaving(true)
    setError(null)
    try {
      if (existing) {
        await Api.shifts.delete(String(existing.id), tenantId)
      } else {
        await Api.shifts.create(tenantId, {
          employee_id: employeeId,
          day_of_week: dayOfWeek,
          start_time: startTime,
          end_time: endTime,
        })
      }
      await refreshShifts()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err) || 'Failed to update shift')
    } finally {
      setSaving(false)
    }
  }

  async function updateShiftTime(shiftId: string | number, startTime: string, endTime: string) {
    if (!tenantId) return
    setSaving(true)
    setError(null)
    try {
      await Api.shifts.update(String(shiftId), tenantId, { start_time: startTime, end_time: endTime })
      await refreshShifts()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err) || 'Failed to update shift time')
    } finally {
      setSaving(false)
    }
  }

  // --- Assignment toggle ---

  async function toggleEmployeeAssignment(serviceId: string | number, employeeId: string) {
    if (!tenantId) return
    const exists = serviceEmployeeMappings.some(
      (m: WizardMapping) => m.service_id === serviceId && String(m.employee_id) === String(employeeId)
    )
    setSaving(true)
    setError(null)
    try {
      if (exists) {
        await Api.mappings.unassignServiceEmployee(String(serviceId), employeeId, tenantId)
      } else {
        await Api.mappings.assignServiceEmployee(String(serviceId), employeeId, tenantId)
      }
      const updated = await Api.mappings.listServiceEmployee(tenantId)
      setServiceEmployeeMappings(Array.isArray(updated) ? updated : [])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err) || 'Failed to update assignment')
    } finally {
      setSaving(false)
    }
  }

  async function toggleResourceAssignment(serviceId: string | number, resourceId: string) {
    if (!tenantId) return
    const exists = serviceResourceMappings.some(
      (m: WizardMapping) => m.service_id === serviceId && m.resource_id === resourceId
    )
    setSaving(true)
    setError(null)
    try {
      if (exists) {
        await Api.mappings.unassignServiceResource(String(serviceId), resourceId, tenantId)
      } else {
        await Api.mappings.assignServiceResource(String(serviceId), resourceId, tenantId)
      }
      const updated = await Api.mappings.listServiceResource(tenantId)
      setServiceResourceMappings(Array.isArray(updated) ? updated : [])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err) || 'Failed to update assignment')
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  const activeServices: WizardService[] = services.filter(s => !(s as { is_deleted?: boolean }).is_deleted).map(s => ({ id: s.id, name: s.name, description: s.description, duration_minutes: s.duration_minutes, price: s.price }))
  const activeResources: WizardResource[] = resources.filter(r => r.is_active !== false).map(r => ({ id: r.id, name: r.name, description: r.description ?? undefined, is_active: r.is_active }))
  const activeEmployees: WizardEmployee[] = employees.filter(e => !e.is_deleted && e.is_active !== false).map(e => ({ id: e.id, name: e.name, first_name: e.first_name ?? undefined, last_name: e.last_name ?? undefined, email: e.email ?? undefined, phone: e.phone ?? undefined, type: e.type, is_active: e.is_active }))

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
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  s === step
                    ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                    : s < step
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 cursor-pointer'
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
            editingService={editingService}
            editingServiceId={editingServiceId}
            onAddService={startAddService}
            onEditService={startEditService}
            onDeleteService={deleteService}
            onSaveService={saveService}
            onCancelEditService={cancelEditService}
            onChangeService={setEditingService}
            resources={activeResources}
            editingResource={editingResource}
            editingResourceId={editingResourceId}
            onAddResource={startAddResource}
            onEditResource={startEditResource}
            onDeleteResource={deleteResource}
            onSaveResource={saveResource}
            onCancelEditResource={cancelEditResource}
            onChangeResource={setEditingResource}
            employees={activeEmployees}
            editingEmployee={editingEmployee}
            editingEmployeeId={editingEmployeeId}
            onAddEmployee={startAddEmployee}
            onEditEmployee={startEditEmployee}
            onDeleteEmployee={deleteEmployee}
            onSaveEmployee={saveEmployee}
            onCancelEditEmployee={cancelEditEmployee}
            onChangeEmployee={setEditingEmployee}
            shifts={shifts}
            shiftsLoading={shiftsLoading}
            selectedShiftEmployee={selectedShiftEmployee}
            onSelectShiftEmployee={setSelectedShiftEmployee}
            onToggleShift={toggleShift}
            onUpdateShiftTime={updateShiftTime}
            serviceEmployeeMappings={serviceEmployeeMappings}
            serviceResourceMappings={serviceResourceMappings}
            mappingsLoading={mappingsLoading}
            onToggleEmployeeAssignment={toggleEmployeeAssignment}
            onToggleResourceAssignment={toggleResourceAssignment}
            coverageData={coverageData}
            coverageLoading={coverageLoading}
            phoneStatus={null}
            inboundPhone={null}
            loading={loading}
            saving={saving}
            error={error}
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
