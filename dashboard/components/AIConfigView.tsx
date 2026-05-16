'use client'

import React, { useEffect, useState } from 'react'
import { MOCK_TENANT } from '@/lib/mockData'
import { Tenant } from '@/lib/types'
import {
  Settings,
  MessageSquare,
  Mic,
  Info,
} from 'lucide-react'
import { Api } from '../lib/api'
import { useActiveTenantId } from '../lib/SessionContext'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { showToast } from './ui/Toast'

// Business-type / template browsing lives in BusinessSettingsView now
// (BusinessTypeSection.tsx). Owners pick the template once during the
// wizard — putting the 24-card grid here forced every prompt-tuning
// visit to scroll past it, and the unguarded "Apply" click could
// overwrite a hand-tuned persona in one tap.
export default function AIConfigView() {
  const tenantId = useActiveTenantId()
  const [config, setConfig] = useState<Tenant | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (tenantId) {
      fetchConfig()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId])

  async function fetchConfig() {
    setLoading(true)
    try {
      const data = await Api.tenants.getConfig(tenantId)
      if (!data) {
        setConfig(MOCK_TENANT as Tenant)
      } else {
        setConfig(data)
      }
    } catch {
      setConfig(MOCK_TENANT as Tenant)
    }
    setLoading(false)
    setDirty(false)
  }

  async function handleSave() {
    if (!config) return
    setSaving(true)

    try {
      const res = await Api.tenants.updateConfig(config.tenant_id, {
        system_prompt: config.system_prompt,
        voice_id: config.voice_id,
        business_type: config.business_type,
        first_message: config.first_message
      })
      setSuccess(res.success)
      if (res.success) {
        setDirty(false)
        showToast('AI persona saved')
        setTimeout(() => setSuccess(false), 3000)
      }
    } catch (e) {
      console.error('Failed to save config', e)
      showToast('Failed to save', 'error')
    }
    setSaving(false)
  }

  if (loading) return <div className="p-8 text-gray-500 italic">Loading AI configuration...</div>

  return (
    <div className="flex flex-1 flex-col overflow-y-auto transition-colors duration-200" style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}>
      <header className="p-4 md:p-8 flex items-center justify-between sticky top-0 z-10" style={{ borderBottom: '1px solid var(--border-soft)', backgroundColor: 'var(--bg-surface)' }}>
        <div className="flex items-center">
          <div className="p-2 rounded-lg mr-4 shadow-md" style={{ backgroundColor: 'var(--accent)', color: 'var(--primary-text)' }}>
            <Settings className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl md:text-3xl font-display">AI Persona Tuning</h1>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Customize how your AI assistant talks. To change your industry template, go to Business Settings.
            </p>
          </div>
        </div>
        <Button
          onClick={handleSave}
          isLoading={saving}
          variant={success ? 'success' : dirty ? 'warning' : 'primary'}
          className={`px-6 py-2.5 transition-shadow ${dirty ? 'ring-2 ring-yellow-400 shadow-lg' : ''}`}
          disabled={!dirty || saving}
        >
          {success ? 'Saved!' : dirty ? 'Save Changes*' : 'Save Changes'}
        </Button>
      </header>

      <div className="p-4 md:p-8 space-y-8 max-w-4xl">

        {/* System Prompt Section */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold flex items-center" style={{ color: 'var(--text-primary)' }}>
              <MessageSquare className="w-5 h-5 mr-2" style={{ color: 'var(--accent-soft)' }} />
              System Instructions (The &quot;Brain&quot;)
            </h2>
            <span className="text-xs font-medium px-2 py-1 rounded" style={{ color: 'var(--text-muted)', backgroundColor: 'var(--bg-raised)' }}>Advanced</span>
          </div>
          <div className="border p-4 rounded-xl flex items-start" style={{ backgroundColor: 'var(--accent-muted)', borderColor: 'var(--accent-muted)' }}>
            <Info className="w-5 h-5 mr-3 mt-0.5 flex-shrink-0" style={{ color: 'var(--accent-soft)' }} />
            <p className="text-sm leading-relaxed" style={{ color: 'var(--accent-soft)' }}>
              This prompt defines your AI&apos;s personality. Tell it what to say, what to avoid, and how to handle specific situations. The AI will follow these rules on every call.
            </p>
          </div>
          <textarea
            rows={10}
            value={config?.system_prompt || ''}
            onChange={(e) => {
              setConfig(prev => prev ? {...prev, system_prompt: e.target.value} : null);
              setDirty(true);
            }}
            className="w-full p-4 border rounded-xl text-sm md:text-base leading-relaxed focus:ring-2 outline-none shadow-inner font-mono"
            style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-raised)', color: 'var(--text-primary)' }}
            placeholder="Ex: You are a helpful assistant for DynaTire. Be professional and concise..."
          />
        </section>

        {/* First Message Section */}
        <section className="space-y-4">
          <h2 className="text-lg font-bold flex items-center" style={{ color: 'var(--text-primary)' }}>
            <MessageSquare className="w-5 h-5 mr-2" style={{ color: 'var(--accent-soft)' }} />
            First Message (Greeting)
          </h2>
          <Input
            value={config?.first_message || ''}
            onChange={(e) => {
              setConfig(prev => prev ? {...prev, first_message: e.target.value} : null);
              setDirty(true);
            }}
            placeholder="Ex: Thanks for calling! How can I help you today?"
          />
        </section>

        {/* Voice Selection Section */}
        <section className="space-y-4">
          <h2 className="text-lg font-bold flex items-center" style={{ color: 'var(--text-primary)' }}>
            <Mic className="w-5 h-5 mr-2" style={{ color: 'var(--accent-soft)' }} />
            Voice Identity
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4" role="radiogroup" aria-label="Voice selection">
            {[
              { id: 'ba124806-6962-4354-94a0-7607775952f4', name: 'Cartesia - British Female', desc: 'Professional, Calm, Clear' },
              { id: '21m00Tcm4llvDq8ikWAM', name: 'Rachel - US Female', desc: 'Soft, Friendly, Warm' },
              { id: 'pNInz6ovDWjNkhCspfAY', name: 'Josh - US Male', desc: 'Deep, Trustworthy' },
              { id: 'ErXwSzhRj4IW3zYCt9a2', name: 'Antoni - US Male', desc: 'Casual, Conversational' }
            ].map(voice => (
              <Card
                key={voice.id}
                onClick={() => {
                  setConfig(prev => prev ? {...prev, voice_id: voice.id} : null);
                  setDirty(true);
                }}
                className={`p-4 cursor-pointer flex items-center justify-between ${config?.voice_id === voice.id ? 'ring-1' : ''}`}
                style={config?.voice_id === voice.id ? { borderColor: 'var(--accent)', ['--tw-ring-color' as string]: 'var(--accent)' } : undefined}
                role="radio"
                aria-checked={config?.voice_id === voice.id}
                aria-label={voice.name}
              >
                <div>
                  <p className="font-bold">{voice.name}</p>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{voice.desc}</p>
                </div>
                <div className={`w-4 h-4 rounded-full border-2`} style={config?.voice_id === voice.id ? { backgroundColor: 'var(--accent)', borderColor: 'var(--accent)' } : { borderColor: 'var(--border-soft)' }} />
              </Card>
            ))}
          </div>
        </section>

        {/* Test Section */}
        <section className="pt-8 border-t" style={{ borderColor: 'var(--border-soft)' }}>
          <Card className="p-6 bg-gray-900 dark:bg-[#1a1a1a] text-white flex flex-col md:flex-row items-center justify-between space-y-4 md:space-y-0">
            <div>
              <h3 className="text-lg font-bold">Ready to test?</h3>
              <p className="text-gray-400 text-sm">Save your changes and call your business number to hear the new persona.</p>
            </div>
            <Button variant="secondary" className="bg-white text-gray-900 hover:bg-gray-100">
              Call My AI Now
            </Button>
          </Card>
        </section>
      </div>
    </div>
  )
}
