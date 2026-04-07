'use client'

import React, { useState } from 'react'
import { FolderTab, FolderTabBar } from './ui/FolderTabs'
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
      <FolderTabBar size="sm" ariaLabel="Team sections">
        {SUB_TABS.map(tab => (
          <FolderTab key={tab.id} label={tab.label} size="sm" isActive={activeSubTab === tab.id} onClick={() => setActiveSubTab(tab.id)} />
        ))}
      </FolderTabBar>
      <div className="flex-1 overflow-hidden">
        {activeSubTab === 'employees' && <EmployeeManagementView />}
        {activeSubTab === 'shifts' && <ShiftManagementView />}
        {activeSubTab === 'skills' && <SkillMatrixView />}
        {activeSubTab === 'skill-map' && <SkillRelationshipMap />}
      </div>
    </div>
  )
}
