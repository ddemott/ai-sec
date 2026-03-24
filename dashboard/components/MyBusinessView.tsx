'use client'

import React, { useState } from 'react'
import { Wand2 } from 'lucide-react'
import ServiceAssignmentView from './ServiceAssignmentView'
import ResourceManagerView from './ResourceManagerView'
import KnowledgeBaseView from './KnowledgeBaseView'
import SetupWizard from './SetupWizard'
import SoloWizard from './SetupWizard/SoloWizard'
import { WizardModeChooser } from './SetupWizard/WizardModeChooser'
import { useVocabulary } from '@/lib/VocabularyContext'

type SubTab = 'services' | 'resources' | 'knowledge'
type WizardMode = 'solo' | 'team' | null

export default function MyBusinessView() {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('services')
  const vocab = useVocabulary()

  const SUB_TABS: { id: SubTab; label: string }[] = [
    { id: 'services', label: 'Services' },
    { id: 'resources', label: vocab.resource_plural },
    { id: 'knowledge', label: 'Knowledge Base' },
  ]
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardMode, setWizardMode] = useState<WizardMode>(null)

  function handleOpenWizard() {
    setWizardOpen(true)
    setWizardMode(null)
  }

  function handleCloseWizard() {
    setWizardOpen(false)
    setWizardMode(null)
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <nav className="flex items-center border-b px-4 shrink-0" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-soft)' }}>
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
        <div className="ml-auto">
          <button
            onClick={handleOpenWizard}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
            style={{ color: 'var(--accent-soft)' }}
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
      </div>

      {/* Wizard flow: mode chooser → solo or team wizard */}
      {wizardOpen && !wizardMode && (
        <WizardModeChooser
          onChoose={setWizardMode}
          onClose={handleCloseWizard}
        />
      )}
      {wizardMode === 'solo' && (
        <SoloWizard isOpen={true} onClose={handleCloseWizard} />
      )}
      {wizardMode === 'team' && (
        <SetupWizard isOpen={true} onClose={handleCloseWizard} />
      )}
    </div>
  )
}
