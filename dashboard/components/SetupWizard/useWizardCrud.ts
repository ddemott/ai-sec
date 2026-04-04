'use client'

import { useState, useEffect, useCallback } from 'react'
import { Api } from '../../lib/api'
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
} from './types'
import { EMPTY_SERVICE, EMPTY_RESOURCE, EMPTY_EMPLOYEE } from './types'

/**
 * Extracts all CRUD operations and step-specific data fetching from SetupWizard.
 * Reduces the main wizard component to just layout + navigation.
 */
export function useWizardCrud(tenantId: string | null, step: WizardStep, refresh: () => Promise<void>) {
  // Shared state
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Step 1 — Services
  const [editingService, setEditingService] = useState<ServiceForm | null>(null)
  const [editingServiceId, setEditingServiceId] = useState<string | number | null>(null)

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

  const resetAll = useCallback(() => {
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
  }, [])

  // --- Service CRUD ---
  const startAddService = () => { setEditingService({ ...EMPTY_SERVICE }); setEditingServiceId(null); setError(null) }
  const startEditService = (svc: WizardService) => { setEditingService({ name: svc.name || '', description: svc.description || '', duration_minutes: svc.duration_minutes || 30, price: svc.price ?? undefined }); setEditingServiceId(svc.id); setError(null) }
  const cancelEditService = () => { setEditingService(null); setEditingServiceId(null); setError(null) }

  async function saveService() {
    if (!editingService || !tenantId) return
    if (!editingService.name.trim()) { setError('Service name is required'); return }
    if (editingService.duration_minutes < 1) { setError('Duration must be at least 1 minute'); return }
    setSaving(true); setError(null)
    try {
      if (editingServiceId) {
        await Api.services.update(editingServiceId, tenantId, { name: editingService.name.trim(), description: editingService.description.trim(), duration_minutes: editingService.duration_minutes })
      } else {
        await Api.services.create(tenantId, { name: editingService.name.trim(), description: editingService.description.trim(), duration_minutes: editingService.duration_minutes })
      }
      await refresh(); setEditingService(null); setEditingServiceId(null)
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err) || 'Failed to save service') }
    finally { setSaving(false) }
  }

  async function deleteService(id: string | number) {
    if (!tenantId) return; setSaving(true)
    try { await Api.services.delete(String(id), tenantId); await refresh() }
    catch (err: unknown) { setError(err instanceof Error ? err.message : String(err) || 'Failed to delete service') }
    finally { setSaving(false) }
  }

  // --- Resource CRUD ---
  const startAddResource = () => { setEditingResource({ ...EMPTY_RESOURCE }); setEditingResourceId(null); setError(null) }
  const startEditResource = (res: WizardResource) => { setEditingResource({ name: res.name || '', description: res.description || '' }); setEditingResourceId(res.id); setError(null) }
  const cancelEditResource = () => { setEditingResource(null); setEditingResourceId(null); setError(null) }

  async function saveResource() {
    if (!editingResource || !tenantId) return
    if (!editingResource.name.trim()) { setError('Resource name is required'); return }
    setSaving(true); setError(null)
    try {
      if (editingResourceId) {
        await Api.resources.update(editingResourceId, { name: editingResource.name.trim(), description: editingResource.description.trim() }, tenantId)
      } else {
        await Api.resources.create(tenantId, { name: editingResource.name.trim(), description: editingResource.description.trim() })
      }
      await refresh(); setEditingResource(null); setEditingResourceId(null)
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err) || 'Failed to save resource') }
    finally { setSaving(false) }
  }

  async function deleteResource(id: string) {
    if (!tenantId) return; setSaving(true)
    try { await Api.resources.delete(id, tenantId); await refresh() }
    catch (err: unknown) { setError(err instanceof Error ? err.message : String(err) || 'Failed to delete resource') }
    finally { setSaving(false) }
  }

  // --- Employee CRUD ---
  const startAddEmployee = () => { setEditingEmployee({ ...EMPTY_EMPLOYEE }); setEditingEmployeeId(null); setError(null) }
  const startEditEmployee = (emp: WizardEmployee) => { setEditingEmployee({ first_name: emp.first_name || '', last_name: emp.last_name || '', email: emp.email || '', phone: emp.phone || '' }); setEditingEmployeeId(String(emp.id)); setError(null) }
  const cancelEditEmployee = () => { setEditingEmployee(null); setEditingEmployeeId(null); setError(null) }

  async function saveEmployee() {
    if (!editingEmployee || !tenantId) return
    if (!editingEmployee.first_name.trim()) { setError('First name is required'); return }
    setSaving(true); setError(null)
    try {
      const name = `${editingEmployee.first_name.trim()} ${editingEmployee.last_name.trim()}`.trim()
      if (editingEmployeeId) {
        await Api.employees.update(editingEmployeeId, { tenant_id: tenantId, name, first_name: editingEmployee.first_name.trim(), last_name: editingEmployee.last_name.trim(), email: editingEmployee.email.trim(), phone: editingEmployee.phone.trim() })
      } else {
        await Api.employees.create(tenantId, { name, first_name: editingEmployee.first_name.trim(), last_name: editingEmployee.last_name.trim(), email: editingEmployee.email.trim(), phone: editingEmployee.phone.trim() })
      }
      await refresh(); setEditingEmployee(null); setEditingEmployeeId(null)
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err) || 'Failed to save employee') }
    finally { setSaving(false) }
  }

  async function deleteEmployee(id: string | number) {
    if (!tenantId) return; setSaving(true)
    try { await Api.employees.delete(String(id), tenantId); await refresh() }
    catch (err: unknown) { setError(err instanceof Error ? err.message : String(err) || 'Failed to delete employee') }
    finally { setSaving(false) }
  }

  // --- Shift CRUD ---
  async function refreshShifts() {
    if (!tenantId) return
    const data = await Api.shifts.list(tenantId)
    setShifts(Array.isArray(data) ? data : [])
  }

  async function toggleShift(employeeId: string, dayOfWeek: number, startTime: string, endTime: string) {
    if (!tenantId) return
    const existing = shifts.find((s: WizardShift) => String(s.employee_id) === String(employeeId) && s.day_of_week === dayOfWeek)
    setSaving(true); setError(null)
    try {
      if (existing) { await Api.shifts.delete(String(existing.id), tenantId) }
      else { await Api.shifts.create(tenantId, { employee_id: employeeId, day_of_week: dayOfWeek, start_time: startTime, end_time: endTime }) }
      await refreshShifts()
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err) || 'Failed to update shift') }
    finally { setSaving(false) }
  }

  async function updateShiftTime(shiftId: string | number, startTime: string, endTime: string) {
    if (!tenantId) return; setSaving(true); setError(null)
    try { await Api.shifts.update(String(shiftId), tenantId, { start_time: startTime, end_time: endTime }); await refreshShifts() }
    catch (err: unknown) { setError(err instanceof Error ? err.message : String(err) || 'Failed to update shift time') }
    finally { setSaving(false) }
  }

  // --- Assignment toggle ---
  async function toggleEmployeeAssignment(serviceId: string | number, employeeId: string) {
    if (!tenantId) return
    const exists = serviceEmployeeMappings.some((m: WizardMapping) => m.service_id === serviceId && String(m.employee_id) === String(employeeId))
    setSaving(true); setError(null)
    try {
      if (exists) { await Api.mappings.unassignServiceEmployee(String(serviceId), employeeId, tenantId) }
      else { await Api.mappings.assignServiceEmployee(String(serviceId), employeeId, tenantId) }
      const updated = await Api.mappings.listServiceEmployee(tenantId)
      setServiceEmployeeMappings(Array.isArray(updated) ? updated : [])
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err) || 'Failed to update assignment') }
    finally { setSaving(false) }
  }

  async function toggleResourceAssignment(serviceId: string | number, resourceId: string) {
    if (!tenantId) return
    const exists = serviceResourceMappings.some((m: WizardMapping) => m.service_id === serviceId && m.resource_id === resourceId)
    setSaving(true); setError(null)
    try {
      if (exists) { await Api.mappings.unassignServiceResource(String(serviceId), resourceId, tenantId) }
      else { await Api.mappings.assignServiceResource(String(serviceId), resourceId, tenantId) }
      const updated = await Api.mappings.listServiceResource(tenantId)
      setServiceResourceMappings(Array.isArray(updated) ? updated : [])
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err) || 'Failed to update assignment') }
    finally { setSaving(false) }
  }

  return {
    saving, error, resetAll,
    // Services
    editingService, editingServiceId, setEditingService,
    startAddService, startEditService, cancelEditService, saveService, deleteService,
    // Resources
    editingResource, editingResourceId, setEditingResource,
    startAddResource, startEditResource, cancelEditResource, saveResource, deleteResource,
    // Employees
    editingEmployee, editingEmployeeId, setEditingEmployee,
    startAddEmployee, startEditEmployee, cancelEditEmployee, saveEmployee, deleteEmployee,
    // Shifts
    shifts, shiftsLoading, selectedShiftEmployee, setSelectedShiftEmployee,
    toggleShift, updateShiftTime,
    // Assignments
    serviceEmployeeMappings, serviceResourceMappings, mappingsLoading,
    toggleEmployeeAssignment, toggleResourceAssignment,
    // Coverage
    coverageData, coverageLoading,
  }
}
