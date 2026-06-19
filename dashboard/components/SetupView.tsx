'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Wand2 } from 'lucide-react';
import { Button } from './ui/Button';
import { FolderTab, FolderTabBar } from './ui/FolderTabs';
import ServiceAssignmentView from './ServiceAssignmentView';
import ResourceManagerView from './ResourceManagerView';
import EmployeeManagementView from './EmployeeManagementView';
import ShiftManagementView from './ShiftManagementView';
import SkillAssignmentsView from './SkillAssignmentsView';
import TeamAccessView from './TeamAccessView';
import BusinessSettingsView from './BusinessSettingsView';
import BillingView from './BillingView';
import SetupWizard from './SetupWizard';
import SoloWizard from './SetupWizard/SoloWizard';
import { WizardModeChooser } from './SetupWizard/WizardModeChooser';
import { WizardWelcome } from './SetupWizard/WizardWelcome';
import { BusinessTypePicker } from './SetupWizard/BusinessTypePicker';
import { useVocabulary, useVocabularyRefresh } from '@/lib/VocabularyContext';
import { useActiveTenantId } from '@/lib/SessionContext';
import { Api } from '../lib/api';
import { notifySetupProgressChanged } from '../lib/useSetupProgress';
import { useOnboardingState } from '../lib/useOnboardingState';

// IA merge (2026-06-03): "My Business" + "My Team" + "Business Settings" were
// three separate top-level destinations for the same user question — "where do
// I configure my business?" They are now sub-tabs under a single "Setup" tab.
// Phase 1 is a re-parent: each sub-tab renders the SAME leaf component the old
// tabs rendered, so behavior is unchanged — only the navigation collapses.
// (Phase 2 will dedup the Calendar/CRM/Resources sections that BusinessSettings
// and SettingsView still duplicate; tracked separately.)
//
// Sub-tab ids are kept identical to the old per-view ?subtab= ids so deep links
// survive: 'services'/'resources' (was My Business), 'employees'/'shifts'/
// 'skills'/'logins' (was My Team), 'business-settings' (was the Business
// Settings tab). The legacy `?subtab=skill-map` remap is carried over.
type SubTab =
  | 'services'
  | 'resources'
  | 'employees'
  | 'shifts'
  | 'skills'
  | 'logins'
  | 'business-settings'
  | 'billing';

const VALID_SUB_TABS: SubTab[] = [
  'services',
  'resources',
  'employees',
  'shifts',
  'skills',
  'logins',
  'business-settings',
  'billing',
];

function resolveInitialTab(searchParams: URLSearchParams): SubTab {
  const raw = searchParams.get('subtab');
  if (raw === 'skill-map') return 'skills';
  if (VALID_SUB_TABS.includes(raw as SubTab)) return raw as SubTab;
  return 'services';
}

export default function SetupView() {
  // Read the initial sub-tab from window.location directly rather than Next's
  // useSearchParams(): page.tsx upgrades a legacy ?tab=my-team URL to
  // ?tab=setup&subtab=employees via history.replaceState, which Next's router
  // hook does NOT observe — so useSearchParams() would still report no subtab
  // and we'd wrongly default to 'services'. window.location.search reflects the
  // replaceState immediately.
  const initialTab =
    typeof window !== 'undefined'
      ? resolveInitialTab(new URLSearchParams(window.location.search))
      : 'services';
  const [activeSubTab, setActiveSubTab] = useState<SubTab>(initialTab);

  const handleSubTabChange = useCallback((tab: SubTab) => {
    setActiveSubTab(tab);
    const params = new URLSearchParams(window.location.search);
    params.set('subtab', tab);
    // Leaving the merged 'skills' tab discards the view=map override so the
    // next visit defaults to the Grid view (matches the old MyTeamView).
    if (tab !== 'skills') params.delete('view');
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
  }, []);

  // Normalize a legacy `?subtab=skill-map` URL to `?subtab=skills&view=map`.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('subtab') === 'skill-map') {
      params.set('subtab', 'skills');
      params.set('view', 'map');
      window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
    }
  }, []);

  // Sub-tab popstate handler — the parent dashboard page handles ?tab= on
  // back/forward; ?subtab= needs its own listener so the active sub-tab snaps
  // back to whatever the restored URL says (not the default).
  useEffect(() => {
    function onPopState() {
      const next = resolveInitialTab(new URLSearchParams(window.location.search));
      setActiveSubTab((prev) => (prev === next ? prev : next));
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Cross-jump from a child sub-tab to a sibling. The Business Settings
  // sub-tab (solo mode) has "edit your services / hours" pointers that used to
  // click the old top-level My Business / My Team tabs. Now those are sibling
  // sub-tabs here, so they fire this event instead of a DOM click. Decoupled so
  // BusinessSettingsView doesn't need to know about SetupView's sub-nav.
  useEffect(() => {
    function onGoto(e: Event) {
      const sub = (e as CustomEvent<{ subtab?: string }>).detail?.subtab;
      if (sub && VALID_SUB_TABS.includes(sub as SubTab)) handleSubTabChange(sub as SubTab);
    }
    window.addEventListener('ai-sec:setup-subtab', onGoto);
    return () => window.removeEventListener('ai-sec:setup-subtab', onGoto);
  }, [handleSubTabChange]);

  const tenantId = useActiveTenantId();
  const vocab = useVocabulary();
  const refreshVocabulary = useVocabularyRefresh();

  const SUB_TABS: { id: SubTab; label: string }[] = [
    { id: 'services', label: 'Services' },
    { id: 'resources', label: vocab.resource_plural },
    { id: 'employees', label: vocab.employee_plural },
    { id: 'shifts', label: 'Working Days' },
    { id: 'skills', label: 'Who Can Do What' },
    { id: 'logins', label: 'Team Access' },
    { id: 'business-settings', label: 'Business Settings' },
    { id: 'billing', label: 'Billing' },
  ];

  // Setup Assistant wizard overlay — ported verbatim from the old
  // MyBusinessView so the launcher survives the merge. Never auto-opens here;
  // the wizard surface only appears when the user clicks "Setup Assistant".
  const { stage, mode, transitions } = useOnboardingState({
    needsSetup: false,
    loading: false,
    autoOpen: false,
  });

  const handleOpenWizard = transitions.openToChooser;

  const handleCloseWizard = useCallback(() => {
    transitions.closeToIdle();
    notifySetupProgressChanged();
  }, [transitions]);

  const handleBusinessTypeSelected = useCallback(
    async (businessType: string) => {
      if (!tenantId) {
        transitions.enterWizard();
        return;
      }
      try {
        const templates = await Api.templates.listFull();
        const tpl = (templates || []).find((t) => t.business_type === businessType);
        await Api.tenants.updateConfig(tenantId, {
          business_type: businessType,
          system_prompt: tpl?.system_prompt_template || undefined,
          voice_id: tpl?.voice_id || undefined,
          first_message: tpl?.first_message || undefined,
        });
        refreshVocabulary();
      } catch {
        // Still proceed — worst case default vocabulary
      }
      transitions.enterWizard();
    },
    [tenantId, refreshVocabulary, transitions]
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <FolderTabBar
        size="sm"
        ariaLabel="Setup sections"
        right={
          <Button
            variant="ghost"
            size="sm"
            onClick={handleOpenWizard}
            className="flex items-center gap-1.5 text-xs font-medium"
          >
            <Wand2 className="w-3.5 h-3.5" />
            Setup Assistant
          </Button>
        }
      >
        {SUB_TABS.map((tab) => (
          <FolderTab
            key={tab.id}
            label={tab.label}
            size="sm"
            isActive={activeSubTab === tab.id}
            onClick={() => handleSubTabChange(tab.id)}
          />
        ))}
      </FolderTabBar>
      <div className="flex-1 overflow-hidden">
        {activeSubTab === 'services' && <ServiceAssignmentView />}
        {activeSubTab === 'resources' && <ResourceManagerView />}
        {activeSubTab === 'employees' && <EmployeeManagementView />}
        {activeSubTab === 'shifts' && <ShiftManagementView />}
        {activeSubTab === 'skills' && <SkillAssignmentsView />}
        {activeSubTab === 'logins' && <TeamAccessView />}
        {activeSubTab === 'business-settings' && <BusinessSettingsView />}
        {activeSubTab === 'billing' && <BillingView />}
      </div>

      {/* Wizard overlays — exactly one renders at a time, enforced by
          useOnboardingState. We skip the 'welcome' stage on this page:
          clicking "Setup Assistant" IS the explicit opt-in. */}
      {stage === 'welcome' && (
        <WizardWelcome onContinue={transitions.advanceWelcome} onDismiss={handleCloseWizard} />
      )}
      {stage === 'chooser' && (
        <WizardModeChooser onChoose={transitions.chooseMode} onClose={handleCloseWizard} />
      )}
      {stage === 'picker' && (
        <BusinessTypePicker
          onSelect={handleBusinessTypeSelected}
          onBack={transitions.backToChooser}
          onClose={handleCloseWizard}
        />
      )}
      {stage === 'wizard' && mode === 'solo' && (
        <SoloWizard isOpen={true} onClose={handleCloseWizard} onBackToPicker={transitions.backToPicker} />
      )}
      {stage === 'wizard' && mode === 'team' && (
        <SetupWizard isOpen={true} onClose={handleCloseWizard} onBackToPicker={transitions.backToPicker} />
      )}
    </div>
  );
}
