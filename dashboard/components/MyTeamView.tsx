'use client'

import React, { useState } from 'react'
import EmployeeManagementView from './EmployeeManagementView'
import ShiftManagementView from './ShiftManagementView'
import SkillMatrixView from './SkillMatrixView'

type SubTab = 'employees' | 'shifts' | 'skills'

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'employees', label: 'Employees' },
  { id: 'shifts', label: 'Shifts' },
  { id: 'skills', label: 'Skill Matrix' },
]

export default function MyTeamView({ overrideTenantId }: { overrideTenantId?: string | null }) {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('employees')

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <nav className="flex border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1a1a1a] px-4 shrink-0">
        {SUB_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeSubTab === tab.id
                ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <div className="flex-1 overflow-hidden">
        {activeSubTab === 'employees' && <EmployeeManagementView overrideTenantId={overrideTenantId} />}
        {activeSubTab === 'shifts' && <ShiftManagementView overrideTenantId={overrideTenantId} />}
        {activeSubTab === 'skills' && <SkillMatrixView overrideTenantId={overrideTenantId} />}
      </div>
    </div>
  )
}
