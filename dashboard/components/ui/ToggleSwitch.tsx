'use client';

import React from 'react';

interface ToggleSwitchProps {
  checked: boolean;
  onChange: () => void;
  label: string;
}

export function ToggleSwitch({ checked, onChange, label }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
      style={{ backgroundColor: checked ? 'var(--accent)' : 'var(--border-soft)' }}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`}
        style={{ backgroundColor: 'var(--primary-text)' }}
      />
    </button>
  );
}
