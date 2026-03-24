'use client'

import React, { useState } from 'react'
import { Wand2 } from 'lucide-react'
import ServiceAssignmentView from './ServiceAssignmentView'
import ResourceManagerView from './ResourceManagerView'
import KnowledgeBaseView from './KnowledgeBaseView'
import ServiceCoverageView from './ServiceCoverageView'
import SetupWizard from './SetupWizard'
import { useVocabulary } from '@/lib/VocabularyContext'

type SubTab = 'services' | 'resources' | 'knowledge' | 'coverage'

export default function MyBusinessView() {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('services')
  const vocab = useVocabulary()

  const SUB_TABS: { id: SubTab; label: string }[] = [
    { id: 'services', label: 'Services' },
    { id: 'resources', label: vocab.resource_plural },
    { id: 'knowledge', label: 'Knowledge Base' },
    { id: 'coverage', label: 'Staffing Map' },
  ]
  const [wizardOpen, setWizardOpen] = useState(false)

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <nav className="flex items-center border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1a1a1a] px-4 shrink-0">
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
        <div className="ml-auto">
          <button
            onClick={() => setWizardOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
          >
            <Wand2 className="w-3.5 h-3.5" />
            Setup Assistant
          </button>
        </div>
      </nav>
      <div className="flex-1 overflow-hidden">
        {activeSubTab === 'services' && <ServiceAssignmentView />}
        {activeSubTab === 'resources' && <ResourceManagerView />}
        {activeSubTab === 'knowledge' && <KnowledgeBaseView />}
        {activeSubTab === 'coverage' && <ServiceCoverageView />}
      </div>
      <SetupWizard
        isOpen={wizardOpen}
        onClose={() => setWizardOpen(false)}
       
      />
    </div>
  )
}
