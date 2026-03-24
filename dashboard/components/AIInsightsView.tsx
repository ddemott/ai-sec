'use client'

import React, { useState } from 'react'
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
        {activeSubTab === 'persona' && <AIConfigView />}
        {activeSubTab === 'analytics' && <AnalyticsView />}
      </div>
    </div>
  )
}
