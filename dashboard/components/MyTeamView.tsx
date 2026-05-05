'use client'

import React, { useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { FolderTab, FolderTabBar } from './ui/FolderTabs'
import EmployeeManagementView from './EmployeeManagementView'
import ShiftManagementView from './ShiftManagementView'
import SkillMatrixView from './SkillMatrixView'
import SkillRelationshipMap from './skill-map/SkillRelationshipMap'
import { useVocabulary } from '@/lib/VocabularyContext'

type SubTab = 'employees' | 'shifts' | 'skills' | 'skill-map'

const VALID_SUB_TABS: SubTab[] = ['employees', 'shifts', 'skills', 'skill-map']

export default function MyTeamView() {
  const searchParams = useSearchParams()
  const initialTab = VALID_SUB_TABS.includes(searchParams.get('subtab') as SubTab)
    ? (searchParams.get('subtab') as SubTab)
    : 'employees'
  const [activeSubTab, setActiveSubTab] = useState<SubTab>(initialTab)

  const handleSubTabChange = useCallback((tab: SubTab) => {
    setActiveSubTab(tab)
    const params = new URLSearchParams(window.location.search)
    params.set('subtab', tab)
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`)
  }, [])
  const vocab = useVocabulary()

  const SUB_TABS: { id: SubTab; label: string }[] = [
    { id: 'employees', label: vocab.employee_plural },
    { id: 'shifts', label: 'Shifts' },
    { id: 'skills', label: 'Service Assignments' },
    { id: 'skill-map', label: 'Skill Map' },
  ]

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <FolderTabBar size="sm" ariaLabel="Team sections">
        {SUB_TABS.map(tab => (
          <FolderTab key={tab.id} label={tab.label} size="sm" isActive={activeSubTab === tab.id} onClick={() => handleSubTabChange(tab.id)} />
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
