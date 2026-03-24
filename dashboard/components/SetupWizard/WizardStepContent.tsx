import React from 'react'
import { Step1Services } from './StepServices'
import { Step2Resources } from './StepResources'
import { Step3Employees } from './StepEmployees'
import { Step4Shifts } from './StepShifts'
import { Step5Assignments } from './StepAssignments'
import { Step6Review } from './StepReview'
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

interface WizardStepContentProps {
  step: WizardStep

  // Step 1 — Services
  services: WizardService[]
  editingService: ServiceForm | null
  editingServiceId: string | number | null
  onAddService: () => void
  onEditService: (svc: WizardService) => void
  onDeleteService: (id: string | number) => void
  onSaveService: () => void
  onCancelEditService: () => void
  onChangeService: (form: ServiceForm | null) => void

  // Step 2 — Resources
  resources: WizardResource[]
  editingResource: ResourceForm | null
  editingResourceId: string | null
  onAddResource: () => void
  onEditResource: (res: WizardResource) => void
  onDeleteResource: (id: string) => void
  onSaveResource: () => void
  onCancelEditResource: () => void
  onChangeResource: (form: ResourceForm | null) => void

  // Step 3 — Employees
  employees: WizardEmployee[]
  editingEmployee: EmployeeForm | null
  editingEmployeeId: string | null
  onAddEmployee: () => void
  onEditEmployee: (emp: WizardEmployee) => void
  onDeleteEmployee: (id: string | number) => void
  onSaveEmployee: () => void
  onCancelEditEmployee: () => void
  onChangeEmployee: (form: EmployeeForm | null) => void

  // Step 4 — Shifts
  shifts: WizardShift[]
  shiftsLoading: boolean
  selectedShiftEmployee: string | null
  onSelectShiftEmployee: (id: string | null) => void
  onToggleShift: (employeeId: string, dayOfWeek: number, startTime: string, endTime: string) => void
  onUpdateShiftTime: (shiftId: string | number, startTime: string, endTime: string) => void

  // Step 5 — Assignments
  serviceEmployeeMappings: WizardMapping[]
  serviceResourceMappings: WizardMapping[]
  mappingsLoading: boolean
  onToggleEmployeeAssignment: (serviceId: string | number, employeeId: string) => void
  onToggleResourceAssignment: (serviceId: string | number, resourceId: string) => void

  // Step 6 — Coverage
  coverageData: CoverageItem[]
  coverageLoading: boolean

  // Shared
  loading: boolean
  saving: boolean
  error: string | null
}

export function WizardStepContent({
  step,
  services,
  editingService,
  editingServiceId,
  onAddService,
  onEditService,
  onDeleteService,
  onSaveService,
  onCancelEditService,
  onChangeService,
  resources,
  editingResource,
  editingResourceId,
  onAddResource,
  onEditResource,
  onDeleteResource,
  onSaveResource,
  onCancelEditResource,
  onChangeResource,
  employees,
  editingEmployee,
  editingEmployeeId,
  onAddEmployee,
  onEditEmployee,
  onDeleteEmployee,
  onSaveEmployee,
  onCancelEditEmployee,
  onChangeEmployee,
  shifts,
  shiftsLoading,
  selectedShiftEmployee,
  onSelectShiftEmployee,
  onToggleShift,
  onUpdateShiftTime,
  serviceEmployeeMappings,
  serviceResourceMappings,
  mappingsLoading,
  onToggleEmployeeAssignment,
  onToggleResourceAssignment,
  coverageData,
  coverageLoading,
  loading,
  saving,
  error,
}: WizardStepContentProps) {
  switch (step) {
    case 1:
      return (
        <Step1Services
          services={services}
          loading={loading}
          editingService={editingService}
          editingServiceId={editingServiceId}
          saving={saving}
          error={error}
          onAdd={onAddService}
          onEdit={onEditService}
          onDelete={onDeleteService}
          onSave={onSaveService}
          onCancel={onCancelEditService}
          onChange={onChangeService}
        />
      )
    case 2:
      return (
        <Step2Resources
          resources={resources}
          loading={loading}
          editingResource={editingResource}
          editingResourceId={editingResourceId}
          saving={saving}
          error={error}
          onAdd={onAddResource}
          onEdit={onEditResource}
          onDelete={onDeleteResource}
          onSave={onSaveResource}
          onCancel={onCancelEditResource}
          onChange={onChangeResource}
        />
      )
    case 3:
      return (
        <Step3Employees
          employees={employees}
          loading={loading}
          editingEmployee={editingEmployee}
          editingEmployeeId={editingEmployeeId}
          saving={saving}
          error={error}
          onAdd={onAddEmployee}
          onEdit={onEditEmployee}
          onDelete={onDeleteEmployee}
          onSave={onSaveEmployee}
          onCancel={onCancelEditEmployee}
          onChange={onChangeEmployee}
        />
      )
    case 4:
      return (
        <Step4Shifts
          employees={employees}
          shifts={shifts}
          loading={shiftsLoading}
          saving={saving}
          error={error}
          selectedEmployeeId={selectedShiftEmployee}
          onSelectEmployee={onSelectShiftEmployee}
          onToggleShift={onToggleShift}
          onUpdateTime={onUpdateShiftTime}
        />
      )
    case 5:
      return (
        <Step5Assignments
          services={services}
          resources={resources}
          employees={employees}
          serviceEmployeeMappings={serviceEmployeeMappings}
          serviceResourceMappings={serviceResourceMappings}
          loading={mappingsLoading}
          saving={saving}
          error={error}
          onToggleEmployee={onToggleEmployeeAssignment}
          onToggleResource={onToggleResourceAssignment}
        />
      )
    case 6:
      return (
        <Step6Review
          services={services}
          resources={resources}
          employees={employees}
          coverageData={coverageData}
          loading={coverageLoading}
        />
      )
    default:
      return null
  }
}
