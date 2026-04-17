'use client'

import React, { useEffect, useState } from 'react'
import { MOCK_TENANT } from '@/lib/mockData'
import { Tenant, BusinessTemplate } from '@/lib/types'
import {
  Settings,
  MessageSquare,
  Mic,
  Info,
  LayoutTemplate,
  X,
  Eye,
  Check,
} from 'lucide-react'
import { Api } from '../lib/api'
import { useActiveTenantId } from '../lib/SessionContext'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { Modal } from './ui/Modal'
import { showToast } from './ui/Toast'

export default function AIConfigView() {
  const tenantId = useActiveTenantId()
  const [config, setConfig] = useState<Tenant | null>(null)
  const [templates, setTemplates] = useState<BusinessTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [previewTemplate, setPreviewTemplate] = useState<BusinessTemplate | null>(null)

  useEffect(() => {
    if (tenantId) {
      fetchConfig()
      fetchTemplates()
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

  async function fetchTemplates() {
    try {
      const data = await Api.templates.listFull()
      if (data) setTemplates(data)
    } catch (e) {
      console.error('Failed to fetch templates', e)
    }
  }

  async function handleSave() {
    if (!config) return
    setSaving(true)

    try {
      const res = await Api.tenants.updateConfig(config.id, {
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

  function applyTemplate(template: BusinessTemplate) {
    if (!config) return
    setConfig({
      ...config,
      business_type: template.business_type,
      system_prompt: template.system_prompt_template,
      voice_id: template.voice_id,
      first_message: template.first_message
    })
    setDirty(true)
    setPreviewTemplate(null)
    showToast(`Applied "${template.display_name}" template — save to keep changes`)
  }

  // Group templates by category
  const templatesByCategory = templates.reduce((acc, t) => {
    const cat = t.category || 'Other'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(t)
    return acc
  }, {} as Record<string, BusinessTemplate[]>)

  const sortedCategories = Object.entries(templatesByCategory).sort(
    (a, b) => (templates.find(t => t.category === a[0])?.sort_order ?? 99)
      - (templates.find(t => t.category === b[0])?.sort_order ?? 99)
  )

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
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Customize how your Secretary HQ agent talks and behaves</p>
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

        {/* Template Browsing Section */}
        <section className="space-y-4">
          <h2 className="text-lg font-bold flex items-center" style={{ color: 'var(--text-primary)' }}>
            <LayoutTemplate className="w-5 h-5 mr-2" style={{ color: 'var(--accent-soft)' }} />
            Business Type Templates
          </h2>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Browse templates to see what each business type provides. Click any to preview before applying.
          </p>

          {sortedCategories.map(([category, categoryTemplates]) => (
            <div key={category} className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{category}</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {categoryTemplates.map(t => {
                  const isActive = config?.business_type === t.business_type
                  return (
                    <button
                      key={t.business_type}
                      onClick={() => setPreviewTemplate(t)}
                      className={`p-3 border rounded-xl text-sm font-medium transition text-left group`}
                      style={isActive
                        ? { backgroundColor: 'color-mix(in srgb, var(--accent) 10%, transparent)', color: 'var(--accent-soft)', borderColor: 'var(--accent)' }
                        : { backgroundColor: 'var(--bg-raised)', borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }
                      }
                    >
                      <div className="flex items-center justify-between">
                        <span>{t.display_name}</span>
                        <Eye className="w-3.5 h-3.5 opacity-0 group-hover:opacity-50 transition-opacity" />
                      </div>
                      {isActive && (
                        <span className="text-[10px] flex items-center gap-1 mt-1" style={{ color: 'var(--accent-soft)' }}>
                          <Check className="w-3 h-3" /> Current
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </section>

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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

      {/* Template Preview Modal */}
      {previewTemplate && (
        <Modal isOpen={true} onClose={() => setPreviewTemplate(null)} title="">
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold">{previewTemplate.display_name}</h2>
                <p className="text-xs text-gray-400 mt-0.5 uppercase tracking-wider">
                  {previewTemplate.category || 'Business Template'}
                </p>
              </div>
              <button onClick={() => setPreviewTemplate(null)} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Vocabulary Preview */}
            <div className="bg-gray-50 dark:bg-gray-800/30 rounded-lg p-3 space-y-1">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Dashboard Labels</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div><span className="text-gray-400">Resources called:</span> <span className="font-medium">{previewTemplate.resource_plural || 'Resources'}</span></div>
                <div><span className="text-gray-400">Staff called:</span> <span className="font-medium">{previewTemplate.employee_plural || 'Employees'}</span></div>
                <div><span className="text-gray-400">Bookings called:</span> <span className="font-medium">{previewTemplate.booking_label || 'Appointments'}</span></div>
                <div><span className="text-gray-400">Default resource:</span> <span className="font-medium">{previewTemplate.default_resource_name || 'Station 1'}</span></div>
              </div>
            </div>

            {/* System Prompt Preview */}
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">AI System Prompt</p>
              <div className="bg-gray-50 dark:bg-gray-800/30 rounded-lg p-3 text-sm font-mono leading-relaxed max-h-40 overflow-y-auto">
                {previewTemplate.system_prompt_template}
              </div>
            </div>

            {/* First Message Preview */}
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Greeting Message</p>
              <div className="bg-gray-50 dark:bg-gray-800/30 rounded-lg p-3 text-sm italic">
                &quot;{previewTemplate.first_message}&quot;
              </div>
            </div>

            {/* Example Services */}
            {previewTemplate.example_services && previewTemplate.example_services.length > 0 && (
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Suggested Services</p>
                <div className="flex flex-wrap gap-1.5">
                  {previewTemplate.example_services.map((svc, i) => (
                    <span key={i} className="text-xs px-2 py-1 rounded-full" style={{ backgroundColor: 'var(--accent-muted)', color: 'var(--accent-soft)' }}>{svc}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Apply Button */}
            <div className="flex items-center justify-between pt-3 border-t" style={{ borderColor: 'var(--border-soft)' }}>
              <p className="text-xs text-gray-400">
                {config?.business_type === previewTemplate.business_type
                  ? 'This is your current template.'
                  : 'This will update your AI persona settings. You can still edit them after applying.'}
              </p>
              <Button
                onClick={() => applyTemplate(previewTemplate)}
                disabled={config?.business_type === previewTemplate.business_type}
              >
                {config?.business_type === previewTemplate.business_type ? 'Already Applied' : 'Apply to My Business'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
