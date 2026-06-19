'use client';

import React, { useState } from 'react';
import { FolderTab, FolderTabBar } from './ui/FolderTabs';
import AIConfigView from './AIConfigView';
import KnowledgeBaseView from './KnowledgeBaseView';

type SubTab = 'persona' | 'knowledge';

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'persona', label: 'AI Persona' },
  { id: 'knowledge', label: 'Knowledge Base' },
];

export default function AIInsightsView() {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('persona');

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <FolderTabBar size="sm" ariaLabel="AI sections">
        {SUB_TABS.map((tab) => (
          <FolderTab
            key={tab.id}
            label={tab.label}
            size="sm"
            isActive={activeSubTab === tab.id}
            onClick={() => setActiveSubTab(tab.id)}
          />
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
      </div>
    </div>
  );
}
