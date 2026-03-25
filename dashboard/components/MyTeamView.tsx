'use client'

import React, { useState } from 'react'
import EmployeeManagementView from './EmployeeManagementView'
import ShiftManagementView from './ShiftManagementView'
import SkillMatrixView from './SkillMatrixView'
import SkillRelationshipMap from './skill-map/SkillRelationshipMap'
import { useVocabulary } from '@/lib/VocabularyContext'

type SubTab = 'employees' | 'shifts' | 'skills' | 'skill-map'

export default function MyTeamView() {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('employees')
  const vocab = useVocabulary()

  const SUB_TABS: { id: SubTab; label: string }[] = [
    { id: 'employees', label: vocab.employee_plural },
    { id: 'shifts', label: 'Shifts' },
    { id: 'skills', label: 'Skill Matrix' },
    { id: 'skill-map', label: 'Skill Map' },
  ]

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <nav className="flex px-4 shrink-0" style={{ backgroundColor: 'var(--bg-surface)', borderBottom: '1px solid var(--border-soft)' }}>
        {SUB_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id)}
            className="px-4 py-3 text-sm font-medium transition-colors"
            style={{
              color: activeSubTab === tab.id ? 'var(--accent-soft)' : 'var(--text-secondary)',
              borderBottom: activeSubTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <div className="flex-1 overflow-hidden">
        {activeSubTab === 'employees' && <EmployeeManagementView />}
        {activeSubTab === 'shifts' && <ShiftManagementView />}
        {activeSubTab === 'skills' && <SkillMatrixView />}
        {activeSubTab === 'skill-map' && <SkillRelationshipMap />}
      </div>
    </div>
  )
}
