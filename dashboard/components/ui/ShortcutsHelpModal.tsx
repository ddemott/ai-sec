'use client'

import React from 'react'
import { Modal } from './Modal'
import type { Shortcut } from '../../lib/useKeyboardShortcuts'

interface ShortcutsHelpModalProps {
  isOpen: boolean
  onClose: () => void
  shortcuts: Shortcut[]
}

function renderKeyChip(key: string): React.ReactNode {
  // Split chord into individual keys for visual separation.
  const parts = key.split(/\s+/)
  return parts.map((p, i) => (
    <React.Fragment key={i}>
      <kbd
        className="inline-block px-2 py-0.5 rounded text-xs font-bold uppercase"
        style={{
          backgroundColor: 'var(--bg-raised)',
          border: '1px solid var(--border)',
          color: 'var(--text-primary)',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          minWidth: '1.5rem',
          textAlign: 'center',
        }}
      >
        {p === ' ' ? 'Space' : p === '/' ? '/' : p}
      </kbd>
      {i < parts.length - 1 && (
        <span className="text-xs mx-1" style={{ color: 'var(--text-muted)' }}>then</span>
      )}
    </React.Fragment>
  ))
}

export function ShortcutsHelpModal({ isOpen, onClose, shortcuts }: ShortcutsHelpModalProps) {
  // Group by category. Render in a fixed order so the modal layout
  // stays stable across renders.
  const grouped: Record<string, Shortcut[]> = { navigation: [], actions: [], help: [] }
  for (const sc of shortcuts) grouped[sc.category || 'actions'].push(sc)

  const sections: { id: keyof typeof grouped; label: string }[] = [
    { id: 'navigation', label: 'Navigation' },
    { id: 'actions', label: 'Actions' },
    { id: 'help', label: 'Help' },
  ]

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Keyboard shortcuts">
      <div className="space-y-5">
        {sections.map(s => {
          const items = grouped[s.id]
          if (items.length === 0) return null
          return (
            <section key={s.id}>
              <h3
                className="text-[10px] font-bold uppercase tracking-widest mb-2"
                style={{ color: 'var(--text-muted)' }}
              >
                {s.label}
              </h3>
              <ul className="space-y-2">
                {items.map((sc, i) => (
                  <li key={i} className="flex items-center justify-between gap-3">
                    <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{sc.label}</span>
                    <span className="flex items-center gap-1 shrink-0">{renderKeyChip(sc.key)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
        <p className="text-xs pt-3 border-t" style={{ color: 'var(--text-muted)', borderColor: 'var(--border-soft)' }}>
          Shortcuts are suppressed while typing in inputs. Press <kbd className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ backgroundColor: 'var(--bg-raised)', border: '1px solid var(--border)' }}>?</kbd> any time to reopen this list.
        </p>
      </div>
    </Modal>
  )
}
