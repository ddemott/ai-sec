'use client'

import React from 'react'
import { User, Users, Wand2, X } from 'lucide-react'

interface WizardModeChooserProps {
  onChoose: (mode: 'solo' | 'team') => void
  onClose: () => void
}

export function WizardModeChooser({ onChoose, onClose }: WizardModeChooserProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div
        className="rounded-2xl shadow-xl border max-w-lg w-full overflow-hidden"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <Wand2 className="w-5 h-5" style={{ color: 'var(--accent-soft)' }} />
            <h2 className="text-lg font-bold">How is your business set up?</h2>
          </div>
          <button onClick={onClose} className="p-1 transition" style={{ color: 'var(--text-secondary)' }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode cards */}
        <div className="p-6 grid grid-cols-2 gap-4">
          <button
            onClick={() => onChoose('solo')}
            className="flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-gray-200 dark:border-gray-700 transition-all group"
            style={{ ['--hover-border' as string]: 'var(--accent-soft)' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-soft)'; e.currentTarget.style.backgroundColor = 'var(--accent-muted)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = ''; e.currentTarget.style.backgroundColor = '' }}
          >
            <div className="w-14 h-14 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform" style={{ backgroundColor: 'var(--accent-muted)' }}>
              <User className="w-7 h-7" style={{ color: 'var(--accent-soft)' }} />
            </div>
            <div className="text-center">
              <p className="font-semibold text-gray-900 dark:text-gray-100">Just me</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                I handle all appointments myself
              </p>
            </div>
          </button>

          <button
            onClick={() => onChoose('team')}
            className="flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-gray-200 dark:border-gray-700 transition-all group"
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-soft)'; e.currentTarget.style.backgroundColor = 'var(--accent-muted)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = ''; e.currentTarget.style.backgroundColor = '' }}
          >
            <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Users className="w-7 h-7 text-green-600 dark:text-green-400" />
            </div>
            <div className="text-center">
              <p className="font-semibold text-gray-900 dark:text-gray-100">I have a team</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                I have employees who provide services
              </p>
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}
