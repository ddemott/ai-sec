'use client'

import React, { useState } from 'react'
import { Wand2 } from 'lucide-react'
import { FolderTab, FolderTabBar } from './ui/FolderTabs'
import ServiceAssignmentView from './ServiceAssignmentView'
import ResourceManagerView from './ResourceManagerView'
import KnowledgeBaseView from './KnowledgeBaseView'
import SetupWizard from './SetupWizard'
import SoloWizard from './SetupWizard/SoloWizard'
import { WizardModeChooser } from './SetupWizard/WizardModeChooser'
import { BusinessTypePicker } from './SetupWizard/BusinessTypePicker'
import { useVocabulary, useVocabularyRefresh } from '@/lib/VocabularyContext'
import { useActiveTenantId } from '@/lib/SessionContext'
import { Api } from '../lib/api'

type SubTab = 'services' | 'resources' | 'knowledge'
type WizardMode = 'solo' | 'team' | null

export default function MyBusinessView() {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('services')
  const tenantId = useActiveTenantId()
  const vocab = useVocabulary()
  const refreshVocabulary = useVocabularyRefresh()

  const SUB_TABS: { id: SubTab; label: string }[] = [
    { id: 'services', label: 'Services' },
    { id: 'resources', label: vocab.resource_plural },
    { id: 'knowledge', label: 'Knowledge Base' },
  ]
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardMode, setWizardMode] = useState<WizardMode>(null)
  const [businessTypeReady, setBusinessTypeReady] = useState(false)

  function handleOpenWizard() {
    setWizardOpen(true)
    setWizardMode(null)
    setBusinessTypeReady(false)
  }

  function handleCloseWizard() {
    setWizardOpen(false)
    setWizardMode(null)
    setBusinessTypeReady(false)
  }

  async function handleBusinessTypeSelected(businessType: string) {
    if (!tenantId) return
    try {
      const templates = await Api.templates.listFull()
      const tpl = (templates || []).find(t => t.business_type === businessType)
      await Api.tenants.updateConfig(tenantId, {
        business_type: businessType,
        system_prompt: tpl?.system_prompt_template || undefined,
        voice_id: tpl?.voice_id || undefined,
        first_message: tpl?.first_message || undefined,
      })
      refreshVocabulary()
      setBusinessTypeReady(true)
    } catch {
      setBusinessTypeReady(true)
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <FolderTabBar size="sm" ariaLabel="Business sections" right={
        <button
          onClick={handleOpenWizard}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
          style={{ color: 'var(--accent-soft)' }}
        >
          <Wand2 className="w-3.5 h-3.5" />
          Setup Assistant
        </button>
      }>
        {SUB_TABS.map(tab => (
          <FolderTab key={tab.id} label={tab.label} size="sm" isActive={activeSubTab === tab.id} onClick={() => setActiveSubTab(tab.id)} />
        ))}
      </FolderTabBar>
      <div className="flex-1 overflow-hidden">
        {activeSubTab === 'services' && <ServiceAssignmentView />}
        {activeSubTab === 'resources' && <ResourceManagerView />}
        {activeSubTab === 'knowledge' && <KnowledgeBaseView />}
      </div>

      {/* Wizard flow: mode chooser → business type → wizard */}
      {wizardOpen && !wizardMode && (
        <WizardModeChooser
          onChoose={setWizardMode}
          onClose={handleCloseWizard}
        />
      )}
      {wizardMode && !businessTypeReady && (
        <BusinessTypePicker
          onSelect={handleBusinessTypeSelected}
          onBack={() => setWizardMode(null)}
          onClose={handleCloseWizard}
        />
      )}
      {wizardMode === 'solo' && businessTypeReady && (
        <SoloWizard isOpen={true} onClose={handleCloseWizard} />
      )}
      {wizardMode === 'team' && businessTypeReady && (
        <SetupWizard isOpen={true} onClose={handleCloseWizard} />
      )}
    </div>
  )
}
