'use client'

import React, { useState, useEffect } from 'react'
import { 
  PlusCircle, 
  Building2, 
  UserPlus, 
  ShieldCheck, 
  Settings
} from 'lucide-react'
import { Api } from '../lib/api'
import { useSession, useStaticData } from '../lib/hooks'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { Select } from './ui/Select'
import { Badge } from './ui/Badge'

export default function SettingsView() {
  const { tenantId, isSuperAdmin } = useSession()
  const { resources, loading: resourcesLoading, error: resourcesError, refresh: refreshResources } = useStaticData(tenantId)
  
  const [templates, setTemplates] = useState<{business_type: string, display_name: string}[]>([])
  const [onboardingLoading, setOnboardingLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [onboardingError, setOnboardingError] = useState<string | null>(null)
  const [newResource, setNewResource] = useState({ name: '', description: '' })

  // Form State for onboarding
  const [form, setForm] = useState({
    tenant_name: '',
    business_type: '',
    owner_first_name: '',
    owner_last_name: '',
    owner_email: '',
    owner_pass: ''
  })

  useEffect(() => {
    if (isSuperAdmin) {
      fetchTemplates()
    }
  }, [isSuperAdmin])

  async function fetchTemplates() {
    try {
      const data = await Api.templates.list()
      setTemplates(data)
      if (data.length > 0) setForm(f => ({ ...f, business_type: data[0].business_type }))
    } catch (e) {
      console.error("Failed to fetch templates")
    }
  }

  async function handleCreateResource(e: React.FormEvent) {
    e.preventDefault()
    if (!tenantId || !newResource.name.trim()) return
    try {
      const res = await Api.resources.create(tenantId, {
          name: newResource.name.trim(),
          description: newResource.description.trim() || undefined
      })
      if (res.success) {
        refreshResources()
        setNewResource({ name: '', description: '' })
      }
    } catch (e) {
      console.error('Failed to create resource', e)
    }
  }

  async function toggleResourceActive(resourceId: string, currentActive: boolean | undefined) {
    try {
      const res = await Api.resources.update(resourceId, { is_active: !currentActive })
      if (res.success) {
        refreshResources()
      }
    } catch (e) {
      console.error('Failed to update resource', e)
    }
  }

  async function handleCreateOnboarding(e: React.FormEvent) {
    e.preventDefault()
    setOnboardingLoading(true)
    setOnboardingError(null)
    setSuccess(false)

    try {
      const res = await Api.tenants.create(form)
      if (res.success) {
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
        setOnboardingError(res.error || 'Failed to create business')
      }
    } catch (err) {
      setOnboardingError('Connection error to backend')
    } finally {
      setOnboardingLoading(false)
    }
  }

  if (!isSuperAdmin) {
    return (
      <div className="flex-1 flex flex-col bg-white dark:bg-[#111] overflow-y-auto text-gray-900 dark:text-gray-100 p-8 transition-colors duration-200">
        <header className="mb-8 flex items-center">
            <div className="bg-gray-100 dark:bg-[#222] p-2 rounded-lg mr-4 text-gray-500 dark:text-gray-400">
                <Settings className="w-6 h-6" />
            </div>
            <div>
                <h1 className="text-3xl font-bold">Business Settings</h1>
                <p className="text-gray-500 dark:text-gray-400">Manage your bays, resources, and preferences</p>
            </div>
        </header>
        <div className="space-y-8">
          <Card className="p-8 text-center bg-gray-50 dark:bg-[#1a1a1a]">
            <p className="text-gray-400 dark:text-gray-500 italic">User profile settings coming soon...</p>
          </Card>

          <Card className="p-6 bg-gray-50 dark:bg-[#1a1a1a]">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold">Resources & Capacity Units</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Each unit (bay, chair, room, or vehicle) is a resource that can run its own appointments in parallel.</p>
              </div>
            </div>

            {resourcesError && (
              <div className="mb-4 text-sm text-red-600 dark:text-red-400">
                {resourcesError}
              </div>
            )}

            <form onSubmit={handleCreateResource} className="flex flex-col md:flex-row gap-3 mb-6">
              <Input
                placeholder="Resource Name (e.g. Station 2)"
                value={newResource.name}
                onChange={e => setNewResource(prev => ({ ...prev, name: e.target.value }))}
                className="flex-1"
              />
              <Input
                placeholder="Optional description"
                value={newResource.description}
                onChange={e => setNewResource(prev => ({ ...prev, description: e.target.value }))}
                className="flex-1"
              />
              <Button
                type="submit"
                disabled={!tenantId || !newResource.name.trim()}
                icon={PlusCircle}
              >
                Add Resource
              </Button>
            </form>

            <div className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
              <div className="bg-gray-100 dark:bg-[#222] px-4 py-2 text-xs font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 flex justify-between">
                <span>Name</span>
                <span className="w-32 text-right">Status</span>
              </div>
              {resourcesLoading && resources.length === 0 ? (
                <div className="p-4 text-sm text-gray-500 dark:text-gray-400">Loading resources...</div>
              ) : resources.length === 0 ? (
                <div className="p-4 text-sm text-gray-500 dark:text-gray-400">No resources yet. Add your first bay or service unit above.</div>
              ) : (
                resources.map(r => (
                  <div key={r.id} className="px-4 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between text-sm">
                    <div>
                      <div className="font-semibold">{r.name}</div>
                      {r.description && (
                        <div className="text-xs text-gray-500 dark:text-gray-400">{r.description}</div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      className="h-8 text-xs px-3"
                      onClick={() => toggleResourceActive(r.id, r.is_active ?? true)}
                    >
                      <Badge variant={r.is_active ?? true ? 'success' : 'default'}>
                        {r.is_active ?? true ? 'Active' : 'Inactive'}
                      </Badge>
                    </Button>
                  </div>
                ))
              )}
            </div>
          </Card>
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
            Business created successfully! The owner can now log in.
          </div>
        )}

        {onboardingError && (
          <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-400 rounded-xl flex items-center font-bold">
            {onboardingError}
          </div>
        )}

        <form onSubmit={handleCreateOnboarding} className="space-y-8">
          
          {/* Business Info */}
          <section className="space-y-4">
            <h2 className="text-lg font-bold flex items-center text-gray-700 dark:text-gray-200">
              <Building2 className="w-5 h-5 mr-2 text-blue-600 dark:text-blue-400" />
              1. Business Information
            </h2>
            <Card className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-gray-50 dark:bg-[#1a1a1a] p-6 border-gray-100 dark:border-gray-800">
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase ml-1">Company Name</label>
                <Input 
                  required
                  value={form.tenant_name}
                  onChange={e => setForm({...form, tenant_name: e.target.value})}
                  placeholder="e.g. Sunny Day Spa"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase ml-1">Business Template</label>
                <Select 
                  required
                  value={form.business_type}
                  onChange={e => setForm({...form, business_type: e.target.value})}
                  options={templates.map(t => ({ label: t.display_name, value: t.business_type }))}
                />
              </div>
            </Card>
          </section>

          {/* Owner Info */}
          <section className="space-y-4">
            <h2 className="text-lg font-bold flex items-center text-gray-700 dark:text-gray-200">
              <UserPlus className="w-5 h-5 mr-2 text-blue-600 dark:text-blue-400" />
              2. Owner Account
            </h2>
            <Card className="space-y-4 bg-gray-50 dark:bg-[#1a1a1a] p-6 border-gray-100 dark:border-gray-800">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase ml-1">First Name</label>
                  <Input 
                    required
                    value={form.owner_first_name}
                    onChange={e => setForm({...form, owner_first_name: e.target.value})}
                    placeholder="John"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase ml-1">Last Name</label>
                  <Input 
                    required
                    value={form.owner_last_name}
                    onChange={e => setForm({...form, owner_last_name: e.target.value})}
                    placeholder="Doe"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase ml-1">Email</label>
                  <Input 
                    type="email" 
                    required
                    value={form.owner_email}
                    onChange={e => setForm({...form, owner_email: e.target.value})}
                    placeholder="owner@business.com"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase ml-1">Password</label>
                <Input 
                  type="password" 
                  required
                  value={form.owner_pass}
                  onChange={e => setForm({...form, owner_pass: e.target.value})}
                  placeholder="••••••••"
                />
              </div>
            </Card>
          </section>

          <Button 
            type="submit"
            disabled={onboardingLoading}
            loading={onboardingLoading}
            className="w-full py-4 text-lg"
            icon={PlusCircle}
          >
            Finalize & Create Business
          </Button>
        </form>
      </div>
    </div>
  )
}
