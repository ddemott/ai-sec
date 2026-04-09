'use client'

import React from 'react'
import { User, Mail, Shield } from 'lucide-react'
import { useSessionContext } from '../lib/SessionContext'
import { useTheme, THEMES } from '@/lib/ThemeContext'
import { Card } from './ui/Card'

export default function ProfileView() {
  const { userName, userEmail, isAdmin } = useSessionContext()
  const { theme, setTheme } = useTheme()

  return (
    <div className="flex-1 flex flex-col overflow-y-auto p-8 transition-colors duration-200" style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}>
      <header className="mb-8 flex items-center">
        <div className="p-2 rounded-lg mr-4" style={{ backgroundColor: 'var(--accent-muted)', color: 'var(--accent-soft)' }}>
          <User className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-3xl font-display">My Profile</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Your account details and preferences</p>
        </div>
      </header>

      <div className="max-w-2xl space-y-6">
        {/* Account Info */}
        <Card className="p-6" style={{ backgroundColor: 'var(--bg-raised)' }}>
          <h2 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--text-secondary)' }}>Account</h2>
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold" style={{ backgroundColor: 'var(--accent-muted)', color: 'var(--accent-soft)' }}>
                {userName ? userName.charAt(0).toUpperCase() : 'U'}
              </div>
              <div>
                <div className="font-bold text-sm">{userName || 'Unknown User'}</div>
                <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  <Mail className="w-3 h-3" />
                  {userEmail || 'No email on file'}
                </div>
              </div>
              {isAdmin && (
                <div className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest" style={{ backgroundColor: 'var(--accent-muted)', color: 'var(--accent-soft)' }}>
                  <Shield className="w-3 h-3" />
                  Admin
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* Theme Preference */}
        <Card className="p-6" style={{ backgroundColor: 'var(--bg-raised)' }}>
          <h2 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--text-secondary)' }}>Appearance</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {THEMES.map(t => (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                className="p-3 rounded-xl border text-left transition-all"
                style={{
                  borderColor: theme === t.id ? 'var(--accent)' : 'var(--border-soft)',
                  backgroundColor: theme === t.id ? 'var(--accent-muted)' : 'var(--bg-surface)',
                }}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-4 h-4 rounded-full border" style={{ backgroundColor: t.preview.accent, borderColor: 'var(--border-soft)' }} />
                  <span className="text-xs font-bold" style={{ color: theme === t.id ? 'var(--accent-soft)' : 'var(--text-primary)' }}>{t.name}</span>
                </div>
                <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{t.description}</div>
              </button>
            ))}
          </div>
        </Card>

        {/* Future: Password change, notification preferences, etc. */}
        <Card className="p-6 text-center" style={{ backgroundColor: 'var(--bg-raised)' }}>
          <p className="text-sm italic" style={{ color: 'var(--text-muted)' }}>Password change and notification preferences coming soon.</p>
        </Card>
      </div>
    </div>
  )
}
