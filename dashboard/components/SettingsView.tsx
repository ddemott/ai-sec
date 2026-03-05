'use client'

import React, { useState, useEffect } from 'react'
import { 
  PlusCircle, 
  Building2, 
  UserPlus, 
  ShieldCheck, 
  Loader2,
  CheckCircle2,
  AlertCircle,
  Settings
} from 'lucide-react'
import { API_BASE_URL } from '../lib/api'

export default function SettingsView() {
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [templates, setTemplates] = useState<{business_type: string, display_name: string}[]>([])

  // Form State
  const [form, setForm] = useState({
    tenant_name: '',
    business_type: '',
    owner_first_name: '',
    owner_last_name: '',
    owner_email: '',
    owner_pass: ''
  })

  useEffect(() => {
    // Check if current user is an admin / super-admin
    // For this PoC we treat both the platform owner tenant
    // and the default DynaTire tenant as admin-capable.
    const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000'
    const DEFAULT_TENANT_ID = 'f234e471-0e60-4163-86c9-93cfd9338e3a'
    const tenantId = localStorage.getItem('tenantId')
    if (tenantId === PLATFORM_TENANT_ID || tenantId === DEFAULT_TENANT_ID) {
      setIsAdmin(true)
      fetchTemplates()
    }
  }, [])

  async function fetchTemplates() {
    try {
      const res = await fetch(`${API_BASE_URL}/templates`)
      const data = await res.json()
      setTemplates(data)
      if (data.length > 0) setForm(f => ({ ...f, business_type: data[0].business_type }))
    } catch (e) {
      console.error("Failed to fetch templates")
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(false)

    try {
      const response = await fetch(`${API_BASE_URL}/tenants/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })

      const data = await response.json()

      if (response.ok && data.success) {
        setSuccess(true)
        setForm({
          tenant_name: '',
          business_type: templates[0]?.business_type || '',
          owner_first_name: '',
          owner_last_name: '',
          owner_email: '',
          owner_pass: ''
        })
      } else {
        setError(data.error || 'Failed to create business')
      }
    } catch (err) {
      setError('Connection error to backend')
    } finally {
      setLoading(false)
    }
  }

  if (!isAdmin) {
    return (
      <div className="flex-1 flex flex-col bg-white dark:bg-[#111] overflow-y-auto text-gray-900 dark:text-gray-100 p-8 transition-colors duration-200">
        <header className="mb-8 flex items-center">
            <div className="bg-gray-100 dark:bg-[#222] p-2 rounded-lg mr-4 text-gray-500 dark:text-gray-400">
                <Settings className="w-6 h-6" />
            </div>
            <div>
                <h1 className="text-3xl font-bold">Personal Settings</h1>
                <p className="text-gray-500 dark:text-gray-400">Manage your profile and preferences</p>
            </div>
        </header>
        <div className="bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-gray-800 p-12 rounded-3xl text-center">
            <p className="text-gray-400 dark:text-gray-500 italic">User profile settings coming soon...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col bg-white dark:bg-[#111] overflow-y-auto text-gray-900 dark:text-gray-100 transition-colors duration-200">
      <header className="p-4 md:p-8 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-[#1a1a1a] sticky top-0 bg-white dark:bg-[#111] z-10 flex items-center">
        <div className="bg-blue-600 p-2 rounded-lg mr-4 shadow-md text-white">
          <ShieldCheck className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-2xl md:text-3xl font-bold dark:text-white">Business Onboarding</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 italic font-medium">Super-Admin Console (Multi-Tenant Management)</p>
        </div>
      </header>

      <div className="p-4 md:p-8 max-w-3xl space-y-8">
        
        {success && (
          <div className="p-4 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900/40 text-green-700 dark:text-green-400 rounded-xl flex items-center font-bold">
            <CheckCircle2 className="w-5 h-5 mr-3" />
            Business created successfully! The owner can now log in.
          </div>
        )}

        {error && (
          <div className="p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-400 rounded-xl flex items-center font-bold">
            <AlertCircle className="w-5 h-5 mr-3" />
            {error}
          </div>
        )}

        <form onSubmit={handleCreate} className="space-y-8">
          
          {/* Business Info */}
          <section className="space-y-4">
            <h2 className="text-lg font-bold flex items-center text-gray-700 dark:text-gray-200">
              <Building2 className="w-5 h-5 mr-2 text-blue-600 dark:text-blue-400" />
              1. Business Information
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-gray-50 dark:bg-[#1a1a1a] p-6 rounded-2xl border border-gray-100 dark:border-gray-800">
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase ml-1">Company Name</label>
                <input 
                  type="text" 
                  required
                  value={form.tenant_name}
                  onChange={e => setForm({...form, tenant_name: e.target.value})}
                  className="w-full p-3 bg-white dark:bg-[#222] border border-gray-200 dark:border-gray-800 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm shadow-sm dark:text-gray-100" 
                  placeholder="e.g. Sunny Day Spa"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase ml-1">Business Template</label>
                <select 
                  required
                  value={form.business_type}
                  onChange={e => setForm({...form, business_type: e.target.value})}
                  className="w-full p-3 bg-white dark:bg-[#222] border border-gray-200 dark:border-gray-800 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm shadow-sm appearance-none dark:text-gray-100"
                >
                  {templates.map(t => (
                    <option key={t.business_type} value={t.business_type}>{t.display_name}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* Owner Info */}
          <section className="space-y-4">
            <h2 className="text-lg font-bold flex items-center text-gray-700 dark:text-gray-200">
              <UserPlus className="w-5 h-5 mr-2 text-blue-600 dark:text-blue-400" />
              2. Owner Account
            </h2>
            <div className="space-y-4 bg-gray-50 dark:bg-[#1a1a1a] p-6 rounded-2xl border border-gray-100 dark:border-gray-800">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase ml-1">Owner First Name</label>
                  <input 
                    type="text" 
                    required
                    value={form.owner_first_name}
                    onChange={e => setForm({...form, owner_first_name: e.target.value})}
                    className="w-full p-3 bg-white dark:bg-[#222] border border-gray-200 dark:border-gray-800 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm shadow-sm dark:text-gray-100" 
                    placeholder="John"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase ml-1">Owner Last Name</label>
                  <input 
                    type="text" 
                    required
                    value={form.owner_last_name}
                    onChange={e => setForm({...form, owner_last_name: e.target.value})}
                    className="w-full p-3 bg-white dark:bg-[#222] border border-gray-200 dark:border-gray-800 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm shadow-sm dark:text-gray-100" 
                    placeholder="Doe"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase ml-1">Owner Email</label>
                  <input 
                    type="email" 
                    required
                    value={form.owner_email}
                    onChange={e => setForm({...form, owner_email: e.target.value})}
                    className="w-full p-3 bg-white dark:bg-[#222] border border-gray-200 dark:border-gray-800 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm shadow-sm dark:text-gray-100" 
                    placeholder="owner@business.com"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase ml-1">Password</label>
                <input 
                  type="password" 
                  required
                  value={form.owner_pass}
                  onChange={e => setForm({...form, owner_pass: e.target.value})}
                  className="w-full p-3 bg-white dark:bg-[#222] border border-gray-200 dark:border-gray-800 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm shadow-sm font-mono dark:text-gray-100" 
                  placeholder="••••••••"
                />
              </div>
            </div>
          </section>

          <button 
            type="submit"
            disabled={loading}
            className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold text-lg shadow-xl hover:bg-blue-700 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center"
          >
            {loading ? (
              <>
                <Loader2 className="w-6 h-6 mr-3 animate-spin" />
                Processing Onboarding...
              </>
            ) : (
              <>
                <PlusCircle className="w-6 h-6 mr-3" />
                Finalize & Create Business
              </>
            )}
          </button>
        </form>

        <div className="pt-8 border-t border-gray-100 dark:border-gray-800 flex items-center text-gray-400 dark:text-gray-500 text-xs">
            <CheckCircle2 className="w-4 h-4 mr-2" />
            <span>Template triggers will automatically create default resources and AI persona for the new business.</span>
        </div>

      </div>
    </div>
  )
}
