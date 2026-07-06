'use client';

/**
 * "Finish setting up your business" prompt on the Home tab.
 * Shown only when the wizard was dismissed with setup still incomplete.
 * Extracted from DashboardHome.tsx (dense-view decomposition).
 */

import React from 'react';
import { Wand2 } from 'lucide-react';
import { Button } from '../ui/Button';

interface HomeSetupPromptProps {
  services: Array<{ service_id: string }>;
  resources: Array<{ resource_id: string }>;
  employees: Array<{ employee_id: string }>;
  vocab: { resource_plural: string; employee_plural: string };
  onOpenSetup: () => void;
}

export function HomeSetupPrompt({
  services,
  resources,
  employees,
  vocab,
  onOpenSetup,
}: HomeSetupPromptProps) {
  return (
    <div
      className="rounded-xl border-2 p-5"
      style={{ borderColor: 'var(--accent)', backgroundColor: 'var(--accent-muted)' }}
    >
      <div className="flex items-start gap-4">
        <div className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-raised)' }}>
          <Wand2 className="w-6 h-6" style={{ color: 'var(--accent-soft)' }} />
        </div>
        <div className="flex-1">
          <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>
            Finish setting up your business
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            {services.length === 0 && 'Add your services. '}
            {resources.length === 0 && `Add your ${vocab.resource_plural.toLowerCase()}. `}
            {employees.length === 0 && `Add your ${vocab.employee_plural.toLowerCase()}. `}
          </p>
          <Button variant="primary" size="sm" className="mt-3" onClick={onOpenSetup}>
            <Wand2 className="w-4 h-4 mr-1.5" />
            Open Setup Assistant
          </Button>
        </div>
      </div>
    </div>
  );
}
