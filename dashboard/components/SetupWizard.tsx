'use client'

import React, { useState, useEffect, useCallback } from 'react'
import {
  ChevronRight,
  ChevronLeft,
  Check,
  X,
  Plus,
  Pencil,
  Trash2,
  Clock,
  DollarSign,
  Wand2,
} from 'lucide-react'
import { Api } from '../lib/api'
import { useSession, useStaticData } from '../lib/hooks'
import { useVocabulary } from '@/lib/VocabularyContext'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { CoverageStatusBadge } from './ui/CoverageStatusBadge'

type WizardStep = 1 | 2 | 3 | 4 | 5 | 6

function getStepLabels(vocab: { resource_plural: string; employee_plural: string }): Record<WizardStep, string> {
  return {
    1: 'Services',
    2: vocab.resource_plural,
    3: vocab.employee_plural,
    4: 'Shifts',
    5: 'Assignments',
    6: 'Review',
  }
}

interface ServiceForm {
  name: string
  description: string
  duration_minutes: number
  price?: number
}

const EMPTY_SERVICE: ServiceForm = { name: '', description: '', duration_minutes: 30 }

interface ResourceForm {
  name: string
  description: string
}

const EMPTY_RESOURCE: ResourceForm = { name: '', description: '' }

interface EmployeeForm {
  first_name: string
  last_name: string
  email: string
  phone: string
}

const EMPTY_EMPLOYEE: EmployeeForm = { first_name: '', last_name: '', email: '', phone: '' }

interface SetupWizardProps {
  isOpen: boolean
  onClose: () => void
  overrideTenantId?: string | null
}

export default function SetupWizard({ isOpen, onClose, overrideTenantId }: SetupWizardProps) {
  const { tenantId } = useSession(overrideTenantId)
  const { services, resources, employees, loading, refresh } = useStaticData(tenantId)
  const vocab = useVocabulary()
  const STEP_LABELS = getStepLabels(vocab)
  const [step, setStep] = useState<WizardStep>(1)

  // Step 1 — Services
  const [editingService, setEditingService] = useState<ServiceForm | null>(null)
  const [editingServiceId, setEditingServiceId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Step 2 — Resources
  const [editingResource, setEditingResource] = useState<ResourceForm | null>(null)
  const [editingResourceId, setEditingResourceId] = useState<string | null>(null)

  // Step 3 — Employees
  const [editingEmployee, setEditingEmployee] = useState<EmployeeForm | null>(null)
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null)

  // Step 4 — Shifts
  const [shifts, setShifts] = useState<any[]>([])
  const [shiftsLoading, setShiftsLoading] = useState(false)
  const [selectedShiftEmployee, setSelectedShiftEmployee] = useState<string | null>(null)

  // Step 5 — Assignments
  const [serviceEmployeeMappings, setServiceEmployeeMappings] = useState<any[]>([])
  const [serviceResourceMappings, setServiceResourceMappings] = useState<any[]>([])
  const [mappingsLoading, setMappingsLoading] = useState(false)

  // Step 6 — Coverage
  const [coverageData, setCoverageData] = useState<any[]>([])
  const [coverageLoading, setCoverageLoading] = useState(false)

  // Fetch shifts when entering step 4
  useEffect(() => {
    if (step === 4 && tenantId) {
      setShiftsLoading(true)
      Api.shifts.list(tenantId).then((data: any[]) => {
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
      Api.coverage.check(tenantId).then((data: any[]) => {
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

  const goNext = () => setStep(s => Math.min(s + 1, 6) as WizardStep)
  const goBack = () => setStep(s => Math.max(s - 1, 1) as WizardStep)
  const goToStep = (s: WizardStep) => setStep(s)

  // --- Service CRUD ---

  function startAddService() {
    setEditingService({ ...EMPTY_SERVICE })
    setEditingServiceId(null)
    setError(null)
  }

  function startEditService(svc: any) {
    setEditingService({
      name: svc.name || '',
      description: svc.description || '',
      duration_minutes: svc.duration_minutes || 30,
      price: svc.price,
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
    } catch (err: any) {
      setError(err.message || 'Failed to save service')
    } finally {
      setSaving(false)
    }
  }

  async function deleteService(id: number) {
    if (!tenantId) return
    setSaving(true)
    try {
      await Api.services.delete(id, tenantId)
      await refresh()
    } catch (err: any) {
      setError(err.message || 'Failed to delete service')
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

  function startEditResource(res: any) {
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
    } catch (err: any) {
      setError(err.message || 'Failed to save resource')
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
    } catch (err: any) {
      setError(err.message || 'Failed to delete resource')
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

  function startEditEmployee(emp: any) {
    setEditingEmployee({
      first_name: emp.first_name || '',
      last_name: emp.last_name || '',
      email: emp.email || '',
      phone: emp.phone || '',
    })
    setEditingEmployeeId(emp.id)
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
        await Api.employees.update(editingEmployeeId as any, {
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
    } catch (err: any) {
      setError(err.message || 'Failed to save employee')
    } finally {
      setSaving(false)
    }
  }

  async function deleteEmployee(id: string | number) {
    if (!tenantId) return
    setSaving(true)
    try {
      await Api.employees.delete(id as any, tenantId)
      await refresh()
    } catch (err: any) {
      setError(err.message || 'Failed to delete employee')
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
      (s: any) => String(s.employee_id) === String(employeeId) && s.day_of_week === dayOfWeek
    )
    setSaving(true)
    setError(null)
    try {
      if (existing) {
        await Api.shifts.delete(existing.id, tenantId)
      } else {
        await Api.shifts.create(tenantId, {
          employee_id: employeeId,
          day_of_week: dayOfWeek,
          start_time: startTime,
          end_time: endTime,
        })
      }
      await refreshShifts()
    } catch (err: any) {
      setError(err.message || 'Failed to update shift')
    } finally {
      setSaving(false)
    }
  }

  async function updateShiftTime(shiftId: number, startTime: string, endTime: string) {
    if (!tenantId) return
    setSaving(true)
    setError(null)
    try {
      await Api.shifts.update(shiftId, tenantId, { start_time: startTime, end_time: endTime })
      await refreshShifts()
    } catch (err: any) {
      setError(err.message || 'Failed to update shift time')
    } finally {
      setSaving(false)
    }
  }

  // --- Assignment toggle ---

  async function toggleEmployeeAssignment(serviceId: number, employeeId: string) {
    if (!tenantId) return
    const exists = serviceEmployeeMappings.some(
      (m: any) => m.service_id === serviceId && String(m.employee_id) === String(employeeId)
    )
    setSaving(true)
    setError(null)
    try {
      if (exists) {
        await Api.mappings.unassignServiceEmployee(serviceId, employeeId, tenantId)
      } else {
        await Api.mappings.assignServiceEmployee(serviceId, employeeId, tenantId)
      }
      const updated = await Api.mappings.listServiceEmployee(tenantId)
      setServiceEmployeeMappings(Array.isArray(updated) ? updated : [])
    } catch (err: any) {
      setError(err.message || 'Failed to update assignment')
    } finally {
      setSaving(false)
    }
  }

  async function toggleResourceAssignment(serviceId: number, resourceId: string) {
    if (!tenantId) return
    const exists = serviceResourceMappings.some(
      (m: any) => m.service_id === serviceId && m.resource_id === resourceId
    )
    setSaving(true)
    setError(null)
    try {
      if (exists) {
        await Api.mappings.unassignServiceResource(serviceId, resourceId, tenantId)
      } else {
        await Api.mappings.assignServiceResource(serviceId, resourceId, tenantId)
      }
      const updated = await Api.mappings.listServiceResource(tenantId)
      setServiceResourceMappings(Array.isArray(updated) ? updated : [])
    } catch (err: any) {
      setError(err.message || 'Failed to update assignment')
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  const activeServices = services.filter((s: any) => !s.is_deleted)
  const activeResources = resources.filter((r: any) => !r.is_deleted && r.is_active !== false)
  const activeEmployees = employees.filter((e: any) => !e.is_deleted && e.is_active !== false)

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
            {([1, 2, 3, 4, 5, 6] as WizardStep[]).map(s => (
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
          {step === 1 && (
            <Step1Services
              services={activeServices}
              loading={loading}
              editingService={editingService}
              editingServiceId={editingServiceId}
              saving={saving}
              error={error}
              onAdd={startAddService}
              onEdit={startEditService}
              onDelete={deleteService}
              onSave={saveService}
              onCancel={cancelEditService}
              onChange={setEditingService}
            />
          )}
          {step === 2 && (
            <Step2Resources
              resources={activeResources}
              loading={loading}
              editingResource={editingResource}
              editingResourceId={editingResourceId}
              saving={saving}
              error={error}
              onAdd={startAddResource}
              onEdit={startEditResource}
              onDelete={deleteResource}
              onSave={saveResource}
              onCancel={cancelEditResource}
              onChange={setEditingResource}
            />
          )}
          {step === 3 && (
            <Step3Employees
              employees={activeEmployees}
              loading={loading}
              editingEmployee={editingEmployee}
              editingEmployeeId={editingEmployeeId}
              saving={saving}
              error={error}
              onAdd={startAddEmployee}
              onEdit={startEditEmployee}
              onDelete={deleteEmployee}
              onSave={saveEmployee}
              onCancel={cancelEditEmployee}
              onChange={setEditingEmployee}
            />
          )}
          {step === 4 && (
            <Step4Shifts
              employees={activeEmployees}
              shifts={shifts}
              loading={shiftsLoading}
              saving={saving}
              error={error}
              selectedEmployeeId={selectedShiftEmployee}
              onSelectEmployee={setSelectedShiftEmployee}
              onToggleShift={toggleShift}
              onUpdateTime={updateShiftTime}
            />
          )}
          {step === 5 && (
            <Step5Assignments
              services={activeServices}
              resources={activeResources}
              employees={activeEmployees}
              serviceEmployeeMappings={serviceEmployeeMappings}
              serviceResourceMappings={serviceResourceMappings}
              loading={mappingsLoading}
              saving={saving}
              error={error}
              onToggleEmployee={toggleEmployeeAssignment}
              onToggleResource={toggleResourceAssignment}
            />
          )}
          {step === 6 && (
            <Step6Review
              services={activeServices}
              resources={activeResources}
              employees={activeEmployees}
              coverageData={coverageData}
              loading={coverageLoading}
            />
          )}
        </div>

        {/* Footer */}
        <footer className="px-6 py-4 bg-gray-50 dark:bg-[#222] border-t border-gray-100 dark:border-gray-800 flex items-center justify-between shrink-0">
          <div className="text-xs text-gray-400">
            Step {step} of 6
          </div>
          <div className="flex gap-2">
            {step > 1 && (
              <Button variant="ghost" size="sm" onClick={goBack}>
                <ChevronLeft className="w-4 h-4 mr-1" />
                Back
              </Button>
            )}
            {step < 6 ? (
              <Button variant="primary" size="sm" onClick={goNext}>
                Next
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

// --- Step 1: Services ---

interface Step1Props {
  services: any[]
  loading: boolean
  editingService: ServiceForm | null
  editingServiceId: number | null
  saving: boolean
  error: string | null
  onAdd: () => void
  onEdit: (svc: any) => void
  onDelete: (id: number) => void
  onSave: () => void
  onCancel: () => void
  onChange: (form: ServiceForm) => void
}

function Step1Services({
  services, loading, editingService, editingServiceId, saving, error,
  onAdd, onEdit, onDelete, onSave, onCancel, onChange,
}: Step1Props) {
  return (
    <div>
      <div className="mb-4">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">What services do you offer?</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Add each service your business provides. You'll assign staff and resources to them in later steps.
        </p>
      </div>

      {/* Service list */}
      {loading ? (
        <p className="text-sm text-gray-400">Loading...</p>
      ) : (
        <div className="space-y-2 mb-4">
          {services.map((svc: any) => (
            <div
              key={svc.id}
              className="flex items-center justify-between px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#222]"
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-gray-900 dark:text-gray-100">{svc.name}</div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                    <Clock className="w-3 h-3" /> {svc.duration_minutes} min
                  </span>
                  {svc.description && (
                    <span className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-[200px]">
                      {svc.description}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 ml-2">
                <button
                  onClick={() => onEdit(svc)}
                  className="p-1.5 text-gray-400 hover:text-blue-500 transition-colors"
                  title="Edit"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onDelete(svc.id)}
                  className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
          {services.length === 0 && !editingService && (
            <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">
              No services yet. Add your first service to get started.
            </p>
          )}
        </div>
      )}

      {/* Add/Edit form */}
      {editingService ? (
        <div className="rounded-xl border-2 border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 p-4 space-y-3">
          <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {editingServiceId ? 'Edit Service' : 'New Service'}
          </div>
          <Input
            label="Service Name"
            value={editingService.name}
            onChange={e => onChange({ ...editingService, name: e.target.value })}
            placeholder="e.g. Oil Change, Haircut, Tire Rotation"
          />
          <Input
            label="Description (optional)"
            value={editingService.description}
            onChange={e => onChange({ ...editingService, description: e.target.value })}
            placeholder="Brief description"
          />
          <Input
            label="Duration (minutes)"
            type="number"
            value={String(editingService.duration_minutes)}
            onChange={e => onChange({ ...editingService, duration_minutes: parseInt(e.target.value) || 0 })}
          />
          {error && (
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          )}
          <div className="flex gap-2 pt-1">
            <Button variant="primary" size="sm" onClick={onSave} disabled={saving}>
              {saving ? 'Saving...' : editingServiceId ? 'Update' : 'Add Service'}
            </Button>
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <button
          onClick={onAdd}
          className="flex items-center gap-2 px-4 py-2.5 w-full rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 text-sm text-gray-500 dark:text-gray-400 hover:border-blue-400 hover:text-blue-500 dark:hover:border-blue-500 dark:hover:text-blue-400 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add a service
        </button>
      )}
    </div>
  )
}

// --- Step 2: Resources ---

interface Step2Props {
  resources: any[]
  loading: boolean
  editingResource: ResourceForm | null
  editingResourceId: string | null
  saving: boolean
  error: string | null
  onAdd: () => void
  onEdit: (res: any) => void
  onDelete: (id: string) => void
  onSave: () => void
  onCancel: () => void
  onChange: (form: ResourceForm) => void
}

function Step2Resources({
  resources, loading, editingResource, editingResourceId, saving, error,
  onAdd, onEdit, onDelete, onSave, onCancel, onChange,
}: Step2Props) {
  const vocab = useVocabulary()
  return (
    <div>
      <div className="mb-4">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Where does work happen?</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Add your {vocab.resource_plural.toLowerCase()} — anywhere a service is performed.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading...</p>
      ) : (
        <div className="space-y-2 mb-4">
          {resources.map((res: any) => (
            <div
              key={res.id}
              className="flex items-center justify-between px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#222]"
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-gray-900 dark:text-gray-100">{res.name}</div>
                {res.description && (
                  <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate max-w-[300px]">
                    {res.description}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 ml-2">
                <button onClick={() => onEdit(res)} className="p-1.5 text-gray-400 hover:text-blue-500 transition-colors" title="Edit">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => onDelete(res.id)} className="p-1.5 text-gray-400 hover:text-red-500 transition-colors" title="Delete">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
          {resources.length === 0 && !editingResource && (
            <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">
              No {vocab.resource_plural.toLowerCase()} yet. Add your first {vocab.resource_label.toLowerCase()}.
            </p>
          )}
        </div>
      )}

      {editingResource ? (
        <div className="rounded-xl border-2 border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 p-4 space-y-3">
          <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {editingResourceId ? `Edit ${vocab.resource_label}` : `New ${vocab.resource_label}`}
          </div>
          <Input
            label={`${vocab.resource_label} Name`}
            value={editingResource.name}
            onChange={e => onChange({ ...editingResource, name: e.target.value })}
            placeholder="e.g. Bay 1, Chair A, Room 3"
          />
          <Input
            label="Description (optional)"
            value={editingResource.description}
            onChange={e => onChange({ ...editingResource, description: e.target.value })}
            placeholder="Brief description"
          />
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex gap-2 pt-1">
            <Button variant="primary" size="sm" onClick={onSave} disabled={saving}>
              {saving ? 'Saving...' : editingResourceId ? 'Update' : `Add ${vocab.resource_label}`}
            </Button>
            <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          </div>
        </div>
      ) : (
        <button
          onClick={onAdd}
          className="flex items-center gap-2 px-4 py-2.5 w-full rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 text-sm text-gray-500 dark:text-gray-400 hover:border-blue-400 hover:text-blue-500 dark:hover:border-blue-500 dark:hover:text-blue-400 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add a {vocab.resource_label.toLowerCase()}
        </button>
      )}
    </div>
  )
}

// --- Step 3: Employees ---

interface Step3Props {
  employees: any[]
  loading: boolean
  editingEmployee: EmployeeForm | null
  editingEmployeeId: string | null
  saving: boolean
  error: string | null
  onAdd: () => void
  onEdit: (emp: any) => void
  onDelete: (id: string | number) => void
  onSave: () => void
  onCancel: () => void
  onChange: (form: EmployeeForm) => void
}

function Step3Employees({
  employees, loading, editingEmployee, editingEmployeeId, saving, error,
  onAdd, onEdit, onDelete, onSave, onCancel, onChange,
}: Step3Props) {
  const vocab = useVocabulary()
  return (
    <div>
      <div className="mb-4">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Who works here?</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Add your {vocab.employee_plural.toLowerCase()}. You&apos;ll set their schedules and assign them to services next.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading...</p>
      ) : (
        <div className="space-y-2 mb-4">
          {employees.map((emp: any) => (
            <div
              key={emp.id}
              className="flex items-center justify-between px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#222]"
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-gray-900 dark:text-gray-100">
                  {emp.first_name || emp.name} {emp.last_name || ''}
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  {emp.email && (
                    <span className="text-xs text-gray-400 dark:text-gray-500">{emp.email}</span>
                  )}
                  {emp.phone && (
                    <span className="text-xs text-gray-400 dark:text-gray-500">{emp.phone}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 ml-2">
                <button onClick={() => onEdit(emp)} className="p-1.5 text-gray-400 hover:text-blue-500 transition-colors" title="Edit">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => onDelete(emp.id)} className="p-1.5 text-gray-400 hover:text-red-500 transition-colors" title="Delete">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
          {employees.length === 0 && !editingEmployee && (
            <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">
              No {vocab.employee_plural.toLowerCase()} yet. Add your first team member.
            </p>
          )}
        </div>
      )}

      {editingEmployee ? (
        <div className="rounded-xl border-2 border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 p-4 space-y-3">
          <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {editingEmployeeId ? `Edit ${vocab.employee_label}` : `New ${vocab.employee_label}`}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="First Name"
              value={editingEmployee.first_name}
              onChange={e => onChange({ ...editingEmployee, first_name: e.target.value })}
              placeholder="First name"
            />
            <Input
              label="Last Name"
              value={editingEmployee.last_name}
              onChange={e => onChange({ ...editingEmployee, last_name: e.target.value })}
              placeholder="Last name"
            />
          </div>
          <Input
            label="Email (optional)"
            type="email"
            value={editingEmployee.email}
            onChange={e => onChange({ ...editingEmployee, email: e.target.value })}
            placeholder="email@example.com"
          />
          <Input
            label="Phone (optional)"
            type="tel"
            value={editingEmployee.phone}
            onChange={e => onChange({ ...editingEmployee, phone: e.target.value })}
            placeholder="+1 (555) 000-0000"
          />
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex gap-2 pt-1">
            <Button variant="primary" size="sm" onClick={onSave} disabled={saving}>
              {saving ? 'Saving...' : editingEmployeeId ? 'Update' : `Add ${vocab.employee_label}`}
            </Button>
            <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          </div>
        </div>
      ) : (
        <button
          onClick={onAdd}
          className="flex items-center gap-2 px-4 py-2.5 w-full rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 text-sm text-gray-500 dark:text-gray-400 hover:border-blue-400 hover:text-blue-500 dark:hover:border-blue-500 dark:hover:text-blue-400 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add an {vocab.employee_label.toLowerCase()}
        </button>
      )}
    </div>
  )
}

// --- Step 4: Shifts ---

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface Step4Props {
  employees: any[]
  shifts: any[]
  loading: boolean
  saving: boolean
  error: string | null
  selectedEmployeeId: string | null
  onSelectEmployee: (id: string | null) => void
  onToggleShift: (employeeId: string, dayOfWeek: number, startTime: string, endTime: string) => void
  onUpdateTime: (shiftId: number, startTime: string, endTime: string) => void
}

function Step4Shifts({
  employees, shifts, loading, saving, error,
  selectedEmployeeId, onSelectEmployee, onToggleShift, onUpdateTime,
}: Step4Props) {
  const vocab = useVocabulary()
  const selectedEmployee = employees.find((e: any) => String(e.id) === String(selectedEmployeeId))
  const employeeShifts = shifts.filter((s: any) => String(s.employee_id) === String(selectedEmployeeId))

  function getShiftForDay(dow: number) {
    return employeeShifts.find((s: any) => s.day_of_week === dow)
  }

  return (
    <div>
      <div className="mb-4">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">When does everyone work?</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Select an {vocab.employee_label.toLowerCase()}, then toggle the days they work and set their hours.
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
            {employees.map((emp: any) => {
              const empShiftCount = shifts.filter((s: any) => String(s.employee_id) === String(emp.id)).length
              const isSelected = String(emp.id) === String(selectedEmployeeId)
              return (
                <button
                  key={emp.id}
                  onClick={() => onSelectEmployee(isSelected ? null : String(emp.id))}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    isSelected
                      ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 ring-2 ring-blue-400'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  {emp.first_name || emp.name} {emp.last_name || ''}
                  {empShiftCount > 0 && (
                    <span className="ml-1.5 text-xs opacity-60">({empShiftCount}d)</span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Shift grid for selected employee */}
          {selectedEmployee && !loading ? (
            <div className="space-y-2">
              {DAY_NAMES.map((dayName, dow) => {
                const shift = getShiftForDay(dow)
                return (
                  <div
                    key={dow}
                    className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#222]"
                  >
                    {/* Day toggle */}
                    <button
                      onClick={() => onToggleShift(String(selectedEmployee.id), dow, '08:00', '17:00')}
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
  )
}

// --- Step 5: Assignments ---

interface Step5Props {
  services: any[]
  resources: any[]
  employees: any[]
  serviceEmployeeMappings: any[]
  serviceResourceMappings: any[]
  loading: boolean
  saving: boolean
  error: string | null
  onToggleEmployee: (serviceId: number, employeeId: string) => void
  onToggleResource: (serviceId: number, resourceId: string) => void
}

function Step5Assignments({
  services, resources, employees,
  serviceEmployeeMappings, serviceResourceMappings,
  loading, saving, error,
  onToggleEmployee, onToggleResource,
}: Step5Props) {
  const vocab = useVocabulary()
  function isEmployeeAssigned(serviceId: number, employeeId: string) {
    return serviceEmployeeMappings.some(
      (m: any) => m.service_id === serviceId && String(m.employee_id) === String(employeeId)
    )
  }

  function isResourceAssigned(serviceId: number, resourceId: string) {
    return serviceResourceMappings.some(
      (m: any) => m.service_id === serviceId && m.resource_id === resourceId
    )
  }

  if (services.length === 0) {
    return (
      <div>
        <div className="mb-4">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Connect everything together</h3>
        </div>
        <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">
          No services yet. Go back to Step 1 to add services first.
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Connect everything together</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          For each service, choose which {vocab.employee_plural.toLowerCase()} can perform it and which {vocab.resource_plural.toLowerCase()} it uses.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading assignments...</p>
      ) : (
        <div className="space-y-4">
          {services.map((svc: any) => (
            <div key={svc.id} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#222] p-4">
              <div className="font-medium text-sm text-gray-900 dark:text-gray-100 mb-3">{svc.name}</div>

              {/* Employee assignments */}
              {employees.length > 0 && (
                <div className="mb-3">
                  <div className="text-xs font-bold text-gray-400 uppercase mb-1.5">{vocab.employee_plural}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {employees.map((emp: any) => {
                      const assigned = isEmployeeAssigned(svc.id, String(emp.id))
                      return (
                        <button
                          key={emp.id}
                          onClick={() => onToggleEmployee(svc.id, String(emp.id))}
                          disabled={saving}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                            assigned
                              ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400'
                              : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                          }`}
                        >
                          {emp.first_name || emp.name} {emp.last_name || ''}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Resource assignments */}
              {resources.length > 0 && (
                <div>
                  <div className="text-xs font-bold text-gray-400 uppercase mb-1.5">{vocab.resource_plural}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {resources.map((res: any) => {
                      const assigned = isResourceAssigned(svc.id, res.id)
                      return (
                        <button
                          key={res.id}
                          onClick={() => onToggleResource(svc.id, res.id)}
                          disabled={saving}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                            assigned
                              ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400'
                              : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                          }`}
                        >
                          {res.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}
          {error && <p className="text-xs text-red-600 dark:text-red-400 mt-2">{error}</p>}
        </div>
      )}
    </div>
  )
}

// --- Step 6: Review ---

interface Step6Props {
  services: any[]
  resources: any[]
  employees: any[]
  coverageData: any[]
  loading: boolean
}

function Step6Review({ services, resources, employees, coverageData, loading }: Step6Props) {
  const vocab = useVocabulary()
  const allCovered = coverageData.length > 0 && coverageData.every((c: any) => c.coverage_status === 'full')
  const hasGaps = coverageData.some((c: any) => c.coverage_status !== 'full')

  return (
    <div>
      <div className="mb-4">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Review your setup</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Here's a summary of your business configuration and coverage status.
        </p>
      </div>

      {/* Summary counts */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="rounded-xl bg-gray-50 dark:bg-[#222] border border-gray-200 dark:border-gray-700 p-3 text-center">
          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{services.length}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Services</div>
        </div>
        <div className="rounded-xl bg-gray-50 dark:bg-[#222] border border-gray-200 dark:border-gray-700 p-3 text-center">
          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{employees.length}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">{vocab.employee_plural}</div>
        </div>
        <div className="rounded-xl bg-gray-50 dark:bg-[#222] border border-gray-200 dark:border-gray-700 p-3 text-center">
          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{resources.length}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">{vocab.resource_plural}</div>
        </div>
      </div>

      {/* Coverage per service */}
      {loading ? (
        <p className="text-sm text-gray-400">Checking coverage...</p>
      ) : coverageData.length > 0 ? (
        <div className="space-y-2 mb-4">
          <div className="text-xs font-bold text-gray-400 uppercase mb-2">Coverage by Service</div>
          {coverageData.map((item: any) => (
            <div
              key={item.service_id}
              className="flex items-center justify-between px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#222]"
            >
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.service_name}</span>
              <CoverageStatusBadge status={item.coverage_status} />
            </div>
          ))}
        </div>
      ) : services.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">
          No services configured yet.
        </p>
      ) : null}

      {/* Status message */}
      {coverageData.length > 0 && (
        <div className={`rounded-xl p-4 mt-4 ${
          allCovered
            ? 'bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800'
            : 'bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800'
        }`}>
          <p className={`text-sm font-medium ${
            allCovered
              ? 'text-green-700 dark:text-green-400'
              : 'text-amber-700 dark:text-amber-400'
          }`}>
            {allCovered
              ? "You're ready to go! All services are fully covered."
              : 'Some services have coverage gaps. Go back to fix assignments, shifts, or staffing.'}
          </p>
        </div>
      )}
    </div>
  )
}
