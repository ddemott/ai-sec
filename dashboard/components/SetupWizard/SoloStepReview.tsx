'use client'

import React from 'react'
import { Check, AlertCircle } from 'lucide-react'
import { Button } from '../ui/Button'
import { statusToBadge } from '../../lib/coverage'
import type { WizardShift } from './types'
import type { Service, CoverageItem } from '../../lib/types'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface SoloStepReviewProps {
  services: Service[]
  shifts: WizardShift[]
  coverageData: CoverageItem[]
  finalizing: boolean
  finalized: boolean
  error: string | null
  ownerName: string
  resourceName: string
  onFinalize: () => void
}

export function SoloStepReview({
  services, shifts, coverageData, finalizing, finalized, error, ownerName, resourceName, onFinalize,
}: SoloStepReviewProps) {
  const activeDays = shifts.filter(s => s.start_time && s.end_time)
  const daysSummary = activeDays.map(s => DAY_NAMES[s.day_of_week]).join(', ') || 'No days set'

  if (finalized) {
    return (
      <div className="text-center py-8">
        <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center mx-auto mb-4">
          <Check className="w-8 h-8 text-green-600 dark:text-green-400" />
        </div>
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">You&apos;re all set!</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Your business is configured and ready to receive calls.
        </p>

        {/* Coverage summary */}
        {coverageData.length > 0 && (
          <div className="text-left max-w-sm mx-auto space-y-2">
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Service Coverage</h4>
            {coverageData.map(item => {
              const badge = statusToBadge(item.status)
              const colorClass = badge === 'full'
                ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400'
                : badge === 'partial'
                ? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400'
                : 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400'
              return (
                <div key={item.service_id} className="flex items-center justify-between text-sm">
                  <span className="text-gray-700 dark:text-gray-300">{item.service_name}</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${colorClass}`}>
                    {item.status}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Review &amp; Complete</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          We&apos;ll create your profile and assign all services to you.
        </p>
      </div>

      <div className="space-y-4 mb-6">
        {/* Services summary */}
        <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#222]">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Services</p>
          <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{services.length} service{services.length !== 1 ? 's' : ''}</p>
          {services.length > 0 && (
            <p className="text-xs text-gray-500 mt-1">{services.map(s => s.name).join(', ')}</p>
          )}
        </div>

        {/* Hours summary */}
        <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#222]">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Your Hours</p>
          <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{activeDays.length} day{activeDays.length !== 1 ? 's' : ''}/week</p>
          <p className="text-xs text-gray-500 mt-1">{daysSummary}</p>
        </div>

        {/* What will be created */}
        <div className="p-4 rounded-xl border" style={{ borderColor: 'var(--accent-soft)', backgroundColor: 'var(--accent-muted)' }}>
          <p className="text-sm font-medium mb-2" style={{ color: 'var(--accent-soft)' }}>What we&apos;ll set up for you:</p>
          <ul className="text-sm space-y-1" style={{ color: 'var(--accent-soft)' }}>
            <li>Create your staff profile ({ownerName})</li>
            <li>Create a default work station ({resourceName})</li>
            <li>Assign all {services.length} service{services.length !== 1 ? 's' : ''} to you</li>
          </ul>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 mb-4">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      <Button onClick={onFinalize} isLoading={finalizing} disabled={services.length === 0}>
        {finalizing ? 'Setting up...' : 'Complete Setup'}
      </Button>
    </div>
  )
}
