'use client'

import React, { useState } from 'react'
import { FolderTab, FolderTabBar } from './ui/FolderTabs'
import AIConfigView from './AIConfigView'
import AnalyticsView from './AnalyticsView'

type SubTab = 'persona' | 'analytics'

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'persona', label: 'AI Persona' },
  { id: 'analytics', label: 'Analytics' },
]

export default function AIInsightsView() {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('persona')

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <FolderTabBar size="sm" ariaLabel="AI sections">
        {SUB_TABS.map(tab => (
          <FolderTab key={tab.id} label={tab.label} size="sm" isActive={activeSubTab === tab.id} onClick={() => setActiveSubTab(tab.id)} />
        ))}
      </FolderTabBar>
      <div className="flex-1 overflow-hidden">
        {activeSubTab === 'persona' && <AIConfigView />}
        {activeSubTab === 'analytics' && <AnalyticsView />}
      </div>
    </div>
  )
}
