'use client'

import React, { useEffect, useState } from 'react'
import { MOCK_TENANT } from '@/lib/mockData'
import { Tenant, BusinessTemplate } from '@/lib/types'
import { 
  Settings, 
  MessageSquare, 
  Mic, 
  Info,
  LayoutTemplate
} from 'lucide-react'
import { Api } from '../lib/api'
import { useSession } from '../lib/hooks'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Input } from './ui/Input'

export default function AIConfigView({ overrideTenantId }: { overrideTenantId?: string | null }) {
  const { tenantId } = useSession(overrideTenantId)
  const [config, setConfig] = useState<Tenant | null>(null)
  const [templates, setTemplates] = useState<BusinessTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [dirty, setDirty] = useState(false)

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
        setTimeout(() => setSuccess(false), 3000)
      }
    } catch (e) {
      console.error('Failed to save config', e)
    }
    setSaving(false)
  }

  function applyTemplate(template: BusinessTemplate) {
    if (!config) return
    if (confirm(`Apply ${template.display_name} defaults? This will overwrite your current settings.`)) {
        setConfig({
            ...config,
            business_type: template.business_type,
            system_prompt: template.system_prompt_template,
            voice_id: template.voice_id,
            first_message: template.first_message
        })
        setDirty(true)
    }
  }

  if (loading) return <div className="p-8 text-gray-500 italic">Loading AI configuration...</div>

  return (
    <div className="flex flex-1 flex-col bg-white dark:bg-[#111] overflow-y-auto text-gray-900 dark:text-gray-100 transition-colors duration-200">
      <header className="p-4 md:p-8 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-[#1a1a1a] flex items-center justify-between sticky top-0 bg-white dark:bg-[#111] z-10">
        <div className="flex items-center">
          <div className="bg-blue-600 p-2 rounded-lg mr-4 shadow-md text-white">
            <Settings className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl md:text-3xl font-bold dark:text-white">AI Persona Tuning</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Customize how your AI Secretary talks and behaves</p>
          </div>
        </div>
        <Button 
          onClick={handleSave}
          loading={saving}
          variant={success ? 'success' : dirty ? 'warning' : 'primary'}
          className={`px-6 py-2.5 transition-shadow ${dirty ? 'ring-2 ring-yellow-400 shadow-lg' : ''}`}
          disabled={!dirty || saving}
        >
          {success ? "Saved!" : dirty ? "Save Changes*" : "Save Changes"}
        </Button>
      </header>

      <div className="p-4 md:p-8 space-y-8 max-w-4xl">
        
        {/* Template Selection Section */}
        <section className="space-y-4">
          <h2 className="text-lg font-bold flex items-center dark:text-gray-200">
            <LayoutTemplate className="w-5 h-5 mr-2 text-blue-600 dark:text-blue-400" />
            Business Type Template
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {templates.map(t => (
                <button
                    key={t.business_type}
                    onClick={() => applyTemplate(t)}
                    className={`p-3 border rounded-xl text-sm font-medium transition ${config?.business_type === t.business_type ? 'bg-blue-50 dark:bg-blue-900/40 border-blue-500 text-blue-700 dark:text-blue-300' : 'bg-white dark:bg-[#1a1a1a] border-gray-200 dark:border-gray-800 hover:border-blue-300 text-gray-700 dark:text-gray-300'}`}
                >
                    {t.display_name}
                </button>
            ))}
          </div>
        </section>

        {/* System Prompt Section */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold flex items-center dark:text-gray-200">
              <MessageSquare className="w-5 h-5 mr-2 text-blue-600 dark:text-blue-400" />
              System Instructions (The &quot;Brain&quot;)
            </h2>
            <span className="text-xs font-medium text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-[#222] px-2 py-1 rounded">Advanced</span>
          </div>
          <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 p-4 rounded-xl flex items-start">
            <Info className="w-5 h-5 text-blue-500 dark:text-blue-400 mr-3 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-blue-700 dark:text-blue-300 leading-relaxed">
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
            className="w-full p-4 border border-gray-200 dark:border-gray-800 rounded-xl text-sm md:text-base leading-relaxed focus:ring-2 focus:ring-blue-500 outline-none shadow-inner bg-gray-50/30 dark:bg-[#1a1a1a] font-mono dark:text-gray-200"
            placeholder="Ex: You are a helpful assistant for DynaTire. Be professional and concise..."
          />
        </section>

        {/* First Message Section */}
        <section className="space-y-4">
          <h2 className="text-lg font-bold flex items-center dark:text-gray-200">
            <MessageSquare className="w-5 h-5 mr-2 text-blue-600 dark:text-blue-400" />
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
          <h2 className="text-lg font-bold flex items-center dark:text-gray-200">
            <Mic className="w-5 h-5 mr-2 text-blue-600 dark:text-blue-400" />
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
                  className={`p-4 cursor-pointer flex items-center justify-between ${config?.voice_id === voice.id ? 'border-blue-500 ring-1 ring-blue-500' : 'hover:border-blue-300'}`}
                >
                <div>
                  <p className="font-bold">{voice.name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{voice.desc}</p>
                </div>
                <div className={`w-4 h-4 rounded-full border-2 ${config?.voice_id === voice.id ? 'bg-blue-600 border-blue-600' : 'border-gray-300 dark:border-gray-600'}`} />
              </Card>
            ))}
          </div>
        </section>

        {/* Test Section */}
        <section className="pt-8 border-t border-gray-100 dark:border-gray-800">
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
