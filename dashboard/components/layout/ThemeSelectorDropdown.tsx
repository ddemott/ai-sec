'use client';

import React from 'react';
import type { ThemeId, ThemeInfo } from '@/lib/ThemeContext';

interface ThemeSelectorDropdownProps {
  currentTheme: ThemeId;
  themes: ThemeInfo[];
  anchorRect: DOMRect | null;
  onClose: () => void;
  onSelect: (themeId: ThemeId) => void;
}

export function ThemeSelectorDropdown({
  currentTheme,
  themes,
  anchorRect,
  onClose,
  onSelect,
}: ThemeSelectorDropdownProps) {
  return (
    <>
      <div className="fixed inset-0 z-[99]" onClick={onClose} />
      <div
        className="fixed z-[100] rounded-xl shadow-2xl border p-3"
        style={{
          backgroundColor: 'var(--bg-raised)',
          borderColor: 'var(--border-soft)',
          top: anchorRect ? anchorRect.bottom + 4 : 0,
          left: anchorRect ? anchorRect.left : 0,
        }}
      >
        <div className="grid grid-cols-4 gap-2">
          {themes.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                onSelect(t.id);
                onClose();
              }}
              title={t.name}
              aria-label={t.name}
              aria-pressed={currentTheme === t.id}
              className="flex flex-col items-center gap-1 p-1.5 rounded-lg transition-all hover:brightness-110"
              style={
                currentTheme === t.id
                  ? {
                      boxShadow: '0 0 0 2px var(--accent)',
                      backgroundColor: 'var(--accent-muted)',
                    }
                  : undefined
              }
            >
              <span
                className="flex rounded overflow-hidden shrink-0"
                style={{ width: 36, height: 24, border: '1px solid rgba(255,255,255,0.1)' }}
              >
                <span style={{ flex: 2, backgroundColor: t.preview.bg }} />
                <span style={{ flex: 1, backgroundColor: t.preview.accent }} />
              </span>
              <span
                className="text-xs leading-none whitespace-nowrap"
                style={{ color: 'var(--text-muted)' }}
              >
                {t.name}
              </span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
