export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6

export interface ServiceForm {
  name: string
  description: string
  duration_minutes: number
  price?: number
}

export const EMPTY_SERVICE: ServiceForm = { name: '', description: '', duration_minutes: 30 }

export interface ResourceForm {
  name: string
  description: string
}

export const EMPTY_RESOURCE: ResourceForm = { name: '', description: '' }

export interface EmployeeForm {
  first_name: string
  last_name: string
  email: string
  phone: string
}

export const EMPTY_EMPLOYEE: EmployeeForm = { first_name: '', last_name: '', email: '', phone: '' }

export interface WizardShift {
  id: number
  employee_id: string | number
  day_of_week: number
  start_time: string
  end_time: string
}

export interface WizardMapping {
  service_id: number
  employee_id?: string | number
  resource_id?: string
}

export interface CoverageItem {
  service_id: number
  service_name: string
  coverage_status: string
  has_employees: boolean
  has_resources: boolean
  has_shifts: boolean
}

export interface WizardService {
  id: number
  name: string
  description?: string
  duration_minutes: number
  price?: number
  is_deleted?: boolean
}

export interface WizardResource {
  id: string
  name: string
  description?: string
  is_deleted?: boolean
  is_active?: boolean
}

export interface WizardEmployee {
  id: string | number
  name: string
  first_name?: string
  last_name?: string
  email?: string
  phone?: string
  type?: string
  is_deleted?: boolean
  is_active?: boolean
}

export interface SetupWizardProps {
  isOpen: boolean
  onClose: () => void
  overrideTenantId?: string | null
}

export interface Step1Props {
  services: WizardService[]
  loading: boolean
  editingService: ServiceForm | null
  editingServiceId: number | null
  saving: boolean
  error: string | null
  onAdd: () => void
  onEdit: (svc: WizardService) => void
  onDelete: (id: number) => void
  onSave: () => void
  onCancel: () => void
  onChange: (form: ServiceForm) => void
}

export interface Step2Props {
  resources: WizardResource[]
  loading: boolean
  editingResource: ResourceForm | null
  editingResourceId: string | null
  saving: boolean
  error: string | null
  onAdd: () => void
  onEdit: (res: WizardResource) => void
  onDelete: (id: string) => void
  onSave: () => void
  onCancel: () => void
  onChange: (form: ResourceForm) => void
}

export interface Step3Props {
  employees: WizardEmployee[]
  loading: boolean
  editingEmployee: EmployeeForm | null
  editingEmployeeId: string | null
  saving: boolean
  error: string | null
  onAdd: () => void
  onEdit: (emp: WizardEmployee) => void
  onDelete: (id: string | number) => void
  onSave: () => void
  onCancel: () => void
  onChange: (form: EmployeeForm) => void
}

export interface Step4Props {
  employees: WizardEmployee[]
  shifts: WizardShift[]
  loading: boolean
  saving: boolean
  error: string | null
  selectedEmployeeId: string | null
  onSelectEmployee: (id: string | null) => void
  onToggleShift: (employeeId: string, dayOfWeek: number, startTime: string, endTime: string) => void
  onUpdateTime: (shiftId: number, startTime: string, endTime: string) => void
}

export interface Step5Props {
  services: WizardService[]
  resources: WizardResource[]
  employees: WizardEmployee[]
  serviceEmployeeMappings: WizardMapping[]
  serviceResourceMappings: WizardMapping[]
  loading: boolean
  saving: boolean
  error: string | null
  onToggleEmployee: (serviceId: number, employeeId: string) => void
  onToggleResource: (serviceId: number, resourceId: string) => void
}

export interface Step6Props {
  services: WizardService[]
  resources: WizardResource[]
  employees: WizardEmployee[]
  coverageData: CoverageItem[]
  loading: boolean
}
