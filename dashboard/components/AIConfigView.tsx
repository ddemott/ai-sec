'use client'

import React, { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { MOCK_TENANT } from '@/lib/mockData'
import { 
  Settings, 
  MessageSquare, 
  Mic, 
  Save, 
  RefreshCw,
  Info,
  ChevronLeft
} from 'lucide-react'

interface TenantConfig {
  id: string;
  name: string;
  system_prompt: string;
  voice_id: string;
}

export default function AIConfigView() {
  const [config, setConfig] = useState<TenantConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    fetchConfig()
  }, [])

  async function fetchConfig() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('tenants')
        .select('id, name, system_prompt, voice_id')
        .limit(1)
        .single()
      
      if (error || !data) {
        setConfig(MOCK_TENANT)
      } else {
        setConfig(data)
      }
    } catch (e) {
      setConfig(MOCK_TENANT)
    }
    setLoading(false)
  }

  async function handleSave() {
    if (!config) return
    setSaving(true)
    
    // Mock save
    setTimeout(() => {
        setSuccess(true)
        setSaving(false)
        setTimeout(() => setSuccess(false), 3000)
    }, 500)

    // Attempt real update
    await supabase
      .from('tenants')
      .update({
        system_prompt: config.system_prompt,
        voice_id: config.voice_id
      })
      .eq('id', config.id)
  }

  if (loading) return <div className="p-8 text-gray-500 italic">Loading AI configuration...</div>

  return (
    <div className="flex flex-1 flex-col bg-white overflow-y-auto text-gray-900">
      <header className="p-4 md:p-8 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between sticky top-0 bg-white z-10">
        <div className="flex items-center">
          <div className="bg-blue-600 p-2 rounded-lg mr-4 shadow-md text-white">
            <Settings className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl md:text-3xl font-bold">AI Persona Tuning</h1>
            <p className="text-sm text-gray-500">Customize how your AI Secretary talks and behaves</p>
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
        
        {/* System Prompt Section */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold flex items-center">
              <MessageSquare className="w-5 h-5 mr-2 text-blue-600" />
              System Instructions (The "Brain")
            </h2>
            <span className="text-xs font-medium text-gray-400 bg-gray-100 px-2 py-1 rounded">Advanced</span>
          </div>
          <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl flex items-start">
            <Info className="w-5 h-5 text-blue-500 mr-3 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-blue-700 leading-relaxed">
              This prompt defines your AI's personality. Tell it what to say, what to avoid, and how to handle specific situations. The AI will follow these rules on every call.
            </p>
          </div>
          <textarea 
            rows={12}
            value={config?.system_prompt || ''}
            onChange={(e) => setConfig(prev => prev ? {...prev, system_prompt: e.target.value} : null)}
            className="w-full p-4 border border-gray-200 rounded-xl text-sm md:text-base leading-relaxed focus:ring-2 focus:ring-blue-500 outline-none shadow-inner bg-gray-50/30"
            placeholder="Ex: You are a helpful assistant for DynaTire. Be professional and concise..."
          />
        </section>

        {/* Voice Selection Section */}
        <section className="space-y-4">
          <h2 className="text-lg font-bold flex items-center">
            <Mic className="w-5 h-5 mr-2 text-blue-600" />
            Voice Identity
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div 
                onClick={() => setConfig(prev => prev ? {...prev, voice_id: 'ba124806-6962-4354-94a0-7607775952f4'} : null)}
                className={`p-4 border rounded-xl transition cursor-pointer bg-white shadow-sm flex items-center justify-between ${config?.voice_id === 'ba124806-6962-4354-94a0-7607775952f4' ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-200 hover:border-blue-300'}`}
            >
              <div>
                <p className="font-bold">Cartesia - British Female</p>
                <p className="text-xs text-gray-500">Professional, Calm, Clear</p>
              </div>
              <div className={`w-4 h-4 rounded-full border-2 ${config?.voice_id === 'ba124806-6962-4354-94a0-7607775952f4' ? 'bg-blue-600 border-blue-600' : 'border-gray-300'}`} />
            </div>
            <div 
                onClick={() => setConfig(prev => prev ? {...prev, voice_id: 'aura-standard-male'} : null)}
                className={`p-4 border rounded-xl transition cursor-pointer bg-white shadow-sm flex items-center justify-between ${config?.voice_id === 'aura-standard-male' ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-200 hover:border-blue-300'}`}
            >
              <div>
                <p className="font-bold">Deepgram Aura - US Male</p>
                <p className="text-xs text-gray-500">Friendly, Energetic</p>
              </div>
              <div className={`w-4 h-4 rounded-full border-2 ${config?.voice_id === 'aura-standard-male' ? 'bg-blue-600 border-blue-600' : 'border-gray-300'}`} />
            </div>
          </div>
        </section>

        {/* Test Section */}
        <section className="pt-8 border-t border-gray-100">
          <div className="p-6 bg-gray-900 rounded-2xl text-white flex flex-col md:flex-row items-center justify-between space-y-4 md:space-y-0">
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
