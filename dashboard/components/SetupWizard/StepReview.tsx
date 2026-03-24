'use client'

import React from 'react'
import { useVocabulary } from '@/lib/VocabularyContext'
import { CoverageStatusBadge } from '../ui/CoverageStatusBadge'
import type { Step6Props, CoverageItem } from './types'

export function Step6Review({ services, resources, employees, coverageData, loading }: Step6Props) {
  const vocab = useVocabulary()
  const allCovered = coverageData.length > 0 && coverageData.every((c: CoverageItem) => c.coverage_status === 'full')

  return (
    <div>
      <div className="mb-4">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Review your setup</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Here&apos;s a summary of your business configuration and coverage status.
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
          {coverageData.map((item: CoverageItem) => (
            <div
              key={item.service_id}
              className="flex items-center justify-between px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#222]"
            >
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.service_name}</span>
              <CoverageStatusBadge status={item.coverage_status as 'full' | 'partial' | 'uncovered' | 'no_staff' | 'no_resource'} />
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
