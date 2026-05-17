'use client'

import React, { useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { Wand2 } from 'lucide-react'
import { Button } from './ui/Button'
import { FolderTab, FolderTabBar } from './ui/FolderTabs'
import ServiceAssignmentView from './ServiceAssignmentView'
import ResourceManagerView from './ResourceManagerView'
import SetupWizard from './SetupWizard'
import SoloWizard from './SetupWizard/SoloWizard'
import { WizardModeChooser } from './SetupWizard/WizardModeChooser'
import { WizardWelcome } from './SetupWizard/WizardWelcome'
import { BusinessTypePicker } from './SetupWizard/BusinessTypePicker'
import { useVocabulary, useVocabularyRefresh } from '@/lib/VocabularyContext'
import { useActiveTenantId } from '@/lib/SessionContext'
import { Api } from '../lib/api'
import { notifySetupProgressChanged } from '../lib/useSetupProgress'

type SubTab = 'services' | 'resources'
type WizardMode = 'solo' | 'team' | null

const VALID_SUB_TABS: SubTab[] = ['services', 'resources']

export default function MyBusinessView() {
  const searchParams = useSearchParams()
  const initialTab = VALID_SUB_TABS.includes(searchParams.get('subtab') as SubTab)
    ? (searchParams.get('subtab') as SubTab)
    : 'services'
  const [activeSubTab, setActiveSubTab] = useState<SubTab>(initialTab)

  const handleSubTabChange = useCallback((tab: SubTab) => {
    setActiveSubTab(tab)
    const params = new URLSearchParams(window.location.search)
    params.set('subtab', tab)
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`)
  }, [])
  const tenantId = useActiveTenantId()
  const vocab = useVocabulary()
  const refreshVocabulary = useVocabularyRefresh()

  const SUB_TABS: { id: SubTab; label: string }[] = [
    { id: 'services', label: 'Services' },
    { id: 'resources', label: vocab.resource_plural },
  ]
  const [wizardOpen, setWizardOpen] = useState(false)
  const [welcomePassed, setWelcomePassed] = useState(false)
  const [wizardMode, setWizardMode] = useState<WizardMode>(null)
  const [businessTypeReady, setBusinessTypeReady] = useState(false)

  function handleOpenWizard() {
    setWizardOpen(true)
    setWelcomePassed(false)
    setWizardMode(null)
    setBusinessTypeReady(false)
  }

  function handleCloseWizard() {
    setWizardOpen(false)
    setWelcomePassed(false)
    setWizardMode(null)
    setBusinessTypeReady(false)
    notifySetupProgressChanged()
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
        <Button
          variant="ghost"
          size="sm"
          onClick={handleOpenWizard}
          className="flex items-center gap-1.5 text-xs font-medium"
        >
          <Wand2 className="w-3.5 h-3.5" />
          Setup Assistant
        </Button>
      }>
        {SUB_TABS.map(tab => (
          <FolderTab key={tab.id} label={tab.label} size="sm" isActive={activeSubTab === tab.id} onClick={() => handleSubTabChange(tab.id)} />
        ))}
      </FolderTabBar>
      <div className="flex-1 overflow-hidden">
        {activeSubTab === 'services' && <ServiceAssignmentView />}
        {activeSubTab === 'resources' && <ResourceManagerView />}
      </div>

      {/* Wizard flow: welcome → mode chooser → business type → wizard.
          Welcome sets scope expectations ("~10 minutes, stop any time")
          before the binary solo/team fork. */}
      {wizardOpen && !welcomePassed && (
        <WizardWelcome
          onContinue={() => setWelcomePassed(true)}
          onDismiss={handleCloseWizard}
        />
      )}
      {wizardOpen && welcomePassed && !wizardMode && (
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
