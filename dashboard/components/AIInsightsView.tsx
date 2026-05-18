'use client'

import React, { useState } from 'react'
import { FolderTab, FolderTabBar } from './ui/FolderTabs'
import AIConfigView from './AIConfigView'
import AnalyticsView from './AnalyticsView'
import KnowledgeBaseView from './KnowledgeBaseView'

// Sub-tab order intentionally reads as setup → setup → outcome:
//   Persona      — HOW the AI talks (configure)
//   Knowledge    — WHAT the AI knows (configure)
//   Analytics    — WHAT the AI did    (observe)
// KB moved here from My Business 2026-05-16 so Phone Assistant owns
// everything that defines the caller's experience. The unanswered-
// questions badge on the Phone Assistant top tab already pointed here
// — it now points to a sub-tab that exists.
type SubTab = 'persona' | 'knowledge' | 'analytics'

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'persona', label: 'AI Persona' },
  { id: 'knowledge', label: 'Knowledge Base' },
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
      {/* overflow-y-auto (not overflow-hidden) so the Knowledge Base
          questionnaire can scroll when expanded sections push content
          below the fold (2026-05-18 user feedback). The flex-1 +
          h-full siblings above keep the FolderTabBar pinned while
          the body scrolls underneath. */}
      <div className="flex-1 overflow-y-auto">
        {activeSubTab === 'persona' && <AIConfigView />}
        {activeSubTab === 'knowledge' && <KnowledgeBaseView />}
        {activeSubTab === 'analytics' && <AnalyticsView />}
      </div>
    </div>
  )
}
