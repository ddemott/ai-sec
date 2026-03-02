'use client'

import React, { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { MOCK_TENANT } from '@/lib/mockData'
import { Tenant, BusinessTemplate } from '@/lib/types'
import { 
  Settings, 
  MessageSquare, 
  Mic, 
  Save, 
  RefreshCw,
  Info,
  LayoutTemplate
} from 'lucide-react'

export default function AIConfigView() {
  const [config, setConfig] = useState<Tenant | null>(null)
  const [templates, setTemplates] = useState<BusinessTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    fetchConfig()
    fetchTemplates()
  }, [])

  async function fetchConfig() {
    setLoading(true)
    const tenantId = localStorage.getItem('tenantId')
    try {
      const { data, error } = await supabase
        .from('tenants')
        .select('id, name, business_type, system_prompt, voice_id, first_message')
        .eq('id', tenantId)
        .single()
      
      if (error || !data) {
        setConfig(MOCK_TENANT as any)
      } else {
        setConfig(data)
      }
    } catch (e) {
      setConfig(MOCK_TENANT as any)
    }
    setLoading(false)
  }

  async function fetchTemplates() {
    const { data } = await supabase.from('business_templates').select('*')
    if (data) setTemplates(data)
  }

  async function handleSave() {
    if (!config) return
    setSaving(true)
    
    const { error } = await supabase
      .from('tenants')
      .update({
        system_prompt: config.system_prompt,
        voice_id: config.voice_id,
        business_type: config.business_type,
        first_message: config.first_message
      })
      .eq('id', config.id)
    
    setSuccess(!error)
    setSaving(false)
    if (!error) setTimeout(() => setSuccess(false), 3000)
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
        <button 
          onClick={handleSave}
          disabled={saving}
          className="flex items-center px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-bold text-sm shadow-sm disabled:opacity-50"
        >
          {saving ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          {success ? "Saved!" : "Save Changes"}
        </button>
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
              System Instructions (The "Brain")
            </h2>
            <span className="text-xs font-medium text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-[#222] px-2 py-1 rounded">Advanced</span>
          </div>
          <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 p-4 rounded-xl flex items-start">
            <Info className="w-5 h-5 text-blue-500 dark:text-blue-400 mr-3 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-blue-700 dark:text-blue-300 leading-relaxed">
              This prompt defines your AI's personality. Tell it what to say, what to avoid, and how to handle specific situations. The AI will follow these rules on every call.
            </p>
          </div>
          <textarea 
            rows={10}
            value={config?.system_prompt || ''}
            onChange={(e) => setConfig(prev => prev ? {...prev, system_prompt: e.target.value} : null)}
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
          <input 
            type="text"
            value={config?.first_message || ''}
            onChange={(e) => setConfig(prev => prev ? {...prev, first_message: e.target.value} : null)}
            className="w-full p-4 border border-gray-200 dark:border-gray-800 rounded-xl text-sm md:text-base leading-relaxed focus:ring-2 focus:ring-blue-500 outline-none shadow-inner bg-gray-50/30 dark:bg-[#1a1a1a] dark:text-gray-200"
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
            <div 
                onClick={() => setConfig(prev => prev ? {...prev, voice_id: 'ba124806-6962-4354-94a0-7607775952f4'} : null)}
                className={`p-4 border rounded-xl transition cursor-pointer bg-white dark:bg-[#1a1a1a] shadow-sm flex items-center justify-between ${config?.voice_id === 'ba124806-6962-4354-94a0-7607775952f4' ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-200 dark:border-gray-800 hover:border-blue-300'}`}
            >
              <div>
                <p className="font-bold dark:text-gray-100">Cartesia - British Female</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Professional, Calm, Clear</p>
              </div>
              <div className={`w-4 h-4 rounded-full border-2 ${config?.voice_id === 'ba124806-6962-4354-94a0-7607775952f4' ? 'bg-blue-600 border-blue-600' : 'border-gray-300 dark:border-gray-600'}`} />
            </div>
            <div 
                onClick={() => setConfig(prev => prev ? {...prev, voice_id: '21m00Tcm4llvDq8ikWAM'} : null)}
                className={`p-4 border rounded-xl transition cursor-pointer bg-white dark:bg-[#1a1a1a] shadow-sm flex items-center justify-between ${config?.voice_id === '21m00Tcm4llvDq8ikWAM' ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-200 dark:border-gray-800 hover:border-blue-300'}`}
            >
              <div>
                <p className="font-bold dark:text-gray-100">Rachel - US Female</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Soft, Friendly, Warm</p>
              </div>
              <div className={`w-4 h-4 rounded-full border-2 ${config?.voice_id === '21m00Tcm4llvDq8ikWAM' ? 'bg-blue-600 border-blue-600' : 'border-gray-300 dark:border-gray-600'}`} />
            </div>
            <div 
                onClick={() => setConfig(prev => prev ? {...prev, voice_id: 'pNInz6ovDWjNkhCspfAY'} : null)}
                className={`p-4 border rounded-xl transition cursor-pointer bg-white dark:bg-[#1a1a1a] shadow-sm flex items-center justify-between ${config?.voice_id === 'pNInz6ovDWjNkhCspfAY' ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-200 dark:border-gray-800 hover:border-blue-300'}`}
            >
              <div>
                <p className="font-bold dark:text-gray-100">Josh - US Male</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Deep, Trustworthy</p>
              </div>
              <div className={`w-4 h-4 rounded-full border-2 ${config?.voice_id === 'pNInz6ovDWjNkhCspfAY' ? 'bg-blue-600 border-blue-600' : 'border-gray-300 dark:border-gray-600'}`} />
            </div>
            <div 
                onClick={() => setConfig(prev => prev ? {...prev, voice_id: 'ErXwSzhRj4IW3zYCt9a2'} : null)}
                className={`p-4 border rounded-xl transition cursor-pointer bg-white dark:bg-[#1a1a1a] shadow-sm flex items-center justify-between ${config?.voice_id === 'ErXwSzhRj4IW3zYCt9a2' ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-200 dark:border-gray-800 hover:border-blue-300'}`}
            >
              <div>
                <p className="font-bold dark:text-gray-100">Antoni - US Male</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Casual, Conversational</p>
              </div>
              <div className={`w-4 h-4 rounded-full border-2 ${config?.voice_id === 'ErXwSzhRj4IW3zYCt9a2' ? 'bg-blue-600 border-blue-600' : 'border-gray-300 dark:border-gray-600'}`} />
            </div>
          </div>
        </section>

        {/* Test Section */}
        <section className="pt-8 border-t border-gray-100 dark:border-gray-800">
          <div className="p-6 bg-gray-900 dark:bg-[#1a1a1a] rounded-2xl text-white flex flex-col md:flex-row items-center justify-between space-y-4 md:space-y-0 border dark:border-gray-800">
            <div>
              <h3 className="text-lg font-bold">Ready to test?</h3>
              <p className="text-gray-400 text-sm">Save your changes and call your business number to hear the new persona.</p>
            </div>
            <button className="px-6 py-2 bg-white text-gray-900 font-bold rounded-lg hover:bg-gray-100 transition shadow-lg text-sm">
              Call My AI Now
            </button>
          </div>
        </section>

      </div>
    </div>
  )
}
