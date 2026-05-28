'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { FolderTab, FolderTabBar } from './ui/FolderTabs';
import EmployeeManagementView from './EmployeeManagementView';
import ShiftManagementView from './ShiftManagementView';
import SkillAssignmentsView from './SkillAssignmentsView';
import TeamAccessView from './TeamAccessView';
import { useVocabulary } from '@/lib/VocabularyContext';

// B1 (2026-05-17): the former 'skills' (Service Assignments) and
// 'skill-map' (Skill Map) sub-tabs are merged into a single 'skills'
// sub-tab with an in-tab Grid/Map toggle. Stale `?subtab=skill-map`
// URLs are remapped to `skills` with `?view=map` so deep-links survive.
type SubTab = 'employees' | 'shifts' | 'skills' | 'logins';

const VALID_SUB_TABS: SubTab[] = ['employees', 'shifts', 'skills', 'logins'];

function resolveInitialTab(searchParams: URLSearchParams): SubTab {
  const raw = searchParams.get('subtab');
  if (raw === 'skill-map') return 'skills';
  if (VALID_SUB_TABS.includes(raw as SubTab)) return raw as SubTab;
  return 'employees';
}

export default function MyTeamView() {
  const searchParams = useSearchParams();
  const initialTab = resolveInitialTab(new URLSearchParams(searchParams.toString()));
  const [activeSubTab, setActiveSubTab] = useState<SubTab>(initialTab);

  const handleSubTabChange = useCallback((tab: SubTab) => {
    setActiveSubTab(tab);
    const params = new URLSearchParams(window.location.search);
    params.set('subtab', tab);
    // Switching off the merged 'skills' tab discards the view=map override
    // so the next visit defaults to the Grid view.
    if (tab !== 'skills') params.delete('view');
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
  }, []);

  // On mount, normalize a legacy `?subtab=skill-map` URL by remapping it
  // to `?subtab=skills&view=map`. The active sub-tab state was already
  // resolved correctly by resolveInitialTab — this just keeps the
  // address bar honest so the user sees a URL that matches the new
  // tab structure.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('subtab') === 'skill-map') {
      params.set('subtab', 'skills');
      params.set('view', 'map');
      window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
    }
  }, []);

  // Sub-tab popstate handler (UX audit Flows 4.1.8, 2026-05-18). The
  // parent dashboard page handles ?tab= on back/forward; ?subtab=
  // needs its own listener here so the active sub-tab snaps back to
  // whatever the restored URL says (not the default).
  useEffect(() => {
    function onPopState() {
      const next = resolveInitialTab(new URLSearchParams(window.location.search));
      setActiveSubTab((prev) => (prev === next ? prev : next));
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  const vocab = useVocabulary();

  const SUB_TABS: { id: SubTab; label: string }[] = [
    { id: 'employees', label: vocab.employee_plural },
    // "Working Days" reads plainer than "Shifts" — most service-business
    // owners think in days-and-hours, not industrial shifts. The Solo
    // wizard already uses "When you work" / "Your Hours" for the same
    // concept; this aligns the live nav with that language.
    { id: 'shifts', label: 'Working Days' },
    // B1: "Service Assignments" now contains both Grid (was: Service
    // Assignments) and Map (was: Skill Map) views via an in-tab toggle.
    { id: 'skills', label: 'Who Can Do What' },
    { id: 'logins', label: 'Team Access' },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <FolderTabBar size="sm" ariaLabel="Team sections">
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
        {activeSubTab === 'employees' && <EmployeeManagementView />}
        {activeSubTab === 'shifts' && <ShiftManagementView />}
        {activeSubTab === 'skills' && <SkillAssignmentsView />}
        {activeSubTab === 'logins' && <TeamAccessView />}
      </div>
    </div>
  );
}
