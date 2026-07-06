'use client';

import React from 'react';
import { Card } from '../ui/Card';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';

interface AssistantNameCardProps {
  personaName: string;
  savedPersonaName: string;
  savingName: boolean;
  onNameChange: (val: string) => void;
  onSave: () => void;
}

export function AssistantNameCard({
  personaName,
  savedPersonaName,
  savingName,
  onNameChange,
  onSave,
}: AssistantNameCardProps) {
  return (
    <Card className="p-6" style={{ backgroundColor: 'var(--bg-raised)' }}>
      <h2 className="text-lg font-bold mb-1">Assistant Name</h2>
      <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
        What your AI receptionist calls itself on calls (for example, &ldquo;Chris&rdquo;). Leave
        blank to use the default.
      </p>
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <Input
            label="Assistant name"
            value={personaName}
            maxLength={120}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Ex: Chris"
          />
        </div>
        <Button
          onClick={onSave}
          isLoading={savingName}
          disabled={personaName.trim() === savedPersonaName.trim()}
        >
          Save
        </Button>
      </div>
    </Card>
  );
}
