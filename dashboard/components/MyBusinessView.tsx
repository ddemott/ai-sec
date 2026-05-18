'use client'

import React, { useState, useCallback, useEffect } from 'react'
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
import { useOnboardingState } from '../lib/useOnboardingState'

type SubTab = 'services' | 'resources'

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

  // Sub-tab popstate handler (UX audit Flows 4.1.8). Parent dashboard
  // page handles ?tab= on back/forward; ?subtab= needs its own
  // listener so the active sub-tab snaps back to whatever the
  // restored URL says (not the default 'services').
  useEffect(() => {
    function onPopState() {
      const raw = new URLSearchParams(window.location.search).get('subtab') as SubTab | null
      const next = (raw && VALID_SUB_TABS.includes(raw)) ? raw : 'services'
      setActiveSubTab(prev => (prev === next ? prev : next))
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
  const tenantId = useActiveTenantId()
  const vocab = useVocabulary()
  const refreshVocabulary = useVocabularyRefresh()

  const SUB_TABS: { id: SubTab; label: string }[] = [
    { id: 'services', label: 'Services' },
    { id: 'resources', label: vocab.resource_plural },
  ]

  // Setup wizard overlay state — driven by the same reducer
  // DashboardHome uses (UX audit #7 → #7-followup). MyBusinessView
  // never auto-opens; the wizard surface only appears when the user
  // clicks "Setup Assistant", so autoOpen=false. Stages: idle |
  // welcome | chooser | picker | wizard | dismissed.
  const { stage, mode, transitions } = useOnboardingState({
    needsSetup: false, // MyBusinessView doesn't gate on data state
    loading: false,
    autoOpen: false,
  })

  // Clicking "Setup Assistant" from this page IS the "yes, set me up"
  // signal — no scope-framing welcome needed. Jump straight to the
  // mode chooser, matching the ?wizard=open URL-param shortcut.
  const handleOpenWizard = transitions.openToChooser

  const handleCloseWizard = useCallback(() => {
    transitions.closeToIdle()
    notifySetupProgressChanged()
  }, [transitions])

  const handleBusinessTypeSelected = useCallback(async (businessType: string) => {
    if (!tenantId) {
      transitions.enterWizard()
      return
    }
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
    } catch {
      // Still proceed — worst case default vocabulary
    }
    transitions.enterWizard()
  }, [tenantId, refreshVocabulary, transitions])

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

      {/* Wizard overlays — exactly one renders at a time, enforced
          by useOnboardingState. Note we skip the 'welcome' stage
          entirely on this page: clicking "Setup Assistant" IS the
          explicit opt-in, no scope-framing needed. */}
      {stage === 'welcome' && (
        <WizardWelcome
          onContinue={transitions.advanceWelcome}
          onDismiss={handleCloseWizard}
        />
      )}
      {stage === 'chooser' && (
        <WizardModeChooser
          onChoose={transitions.chooseMode}
          onClose={handleCloseWizard}
        />
      )}
      {stage === 'picker' && (
        <BusinessTypePicker
          onSelect={handleBusinessTypeSelected}
          onBack={transitions.backToChooser}
          onClose={handleCloseWizard}
        />
      )}
      {stage === 'wizard' && mode === 'solo' && (
        <SoloWizard isOpen={true} onClose={handleCloseWizard} />
      )}
      {stage === 'wizard' && mode === 'team' && (
        <SetupWizard isOpen={true} onClose={handleCloseWizard} />
      )}
    </div>
  )
}
