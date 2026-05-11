'use client'

import React from 'react'
import { useVocabulary } from '@/lib/VocabularyContext'
import type { Step5Props, WizardService, WizardResource, WizardEmployee, WizardMapping } from './types'

export function Step5Assignments({
  services, resources, employees,
  serviceEmployeeMappings, serviceResourceMappings,
  loading, saving, error,
  onToggleEmployee, onToggleResource,
}: Step5Props) {
  const vocab = useVocabulary()
  function isEmployeeAssigned(serviceId: string, employeeId: string) {
    return serviceEmployeeMappings.some(
      (m: WizardMapping) => String(m.service_id) === String(serviceId) && String(m.employee_id) === String(employeeId)
    )
  }

  function isResourceAssigned(serviceId: string, resourceId: string) {
    return serviceResourceMappings.some(
      (m: WizardMapping) => String(m.service_id) === String(serviceId) && m.resource_id === resourceId
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
          {services.map((svc: WizardService) => (
            <div key={svc.id} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#222] p-4">
              <div className="font-medium text-sm text-gray-900 dark:text-gray-100 mb-3">{svc.name}</div>

              {/* Employee assignments */}
              {employees.length > 0 && (
                <div className="mb-3">
                  <div className="text-xs font-bold text-gray-400 uppercase mb-1.5">{vocab.employee_plural}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {employees.map((emp: WizardEmployee) => {
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
                    {resources.map((res: WizardResource) => {
                      const assigned = isResourceAssigned(svc.id, res.id)
                      return (
                        <button
                          key={res.id}
                          onClick={() => onToggleResource(svc.id, res.id)}
                          disabled={saving}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                            assigned
                              ? ''
                              : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                          }`}
                          style={assigned ? { backgroundColor: 'var(--accent-muted)', color: 'var(--accent-soft)' } : undefined}
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
