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
        {activeSubTab === 'persona' && <AIConfigView />}
        {activeSubTab === 'analytics' && <AnalyticsView />}
      </div>
    </div>
  )
}
