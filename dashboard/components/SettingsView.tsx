'use client'

import React, { useState, useEffect } from 'react'
import { 
  PlusCircle, 
  Building2, 
  UserPlus, 
  ShieldCheck, 
  Settings,
  Calendar,
  ExternalLink,
  Unlink,
  CheckCircle2
} from 'lucide-react'
import { Api } from '../lib/api'
import { CRMIntegrationCard } from './CRMIntegrationCard'
import { useStaticData } from '../lib/hooks'
import { useActiveTenantId, useSessionContext } from '../lib/SessionContext'
import { useVocabulary } from '@/lib/VocabularyContext'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { Select } from './ui/Select'
import { Badge } from './ui/Badge'

export default function SettingsView() {
  const tenantId = useActiveTenantId()
  const { isAdmin: isSuperAdmin } = useSessionContext()
  const { resources, loading: resourcesLoading, error: resourcesError, refresh: refreshResources } = useStaticData(tenantId)
  const vocab = useVocabulary()
  
  const [templates, setTemplates] = useState<{business_type: string, display_name: string}[]>([])
  const [onboardingLoading, setOnboardingLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [onboardingError, setOnboardingError] = useState<string | null>(null)
  const [newResource, setNewResource] = useState({ name: '', description: '' })

  // Calendar State
  const [calendarSettings, setCalendarSettings] = useState<{ provider: string; external_calendar_id: string } | null>(null)
  const [calLoading, setCalLoading] = useState(false)

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
    } else if (tenantId) {
      fetchCalendarSettings()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin, tenantId])

  // Detect OAuth redirect params
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('calendarConnected') === 'true') {
      fetchCalendarSettings()
      // Clean up URL
      const url = new URL(window.location.href)
      url.searchParams.delete('calendarConnected')
      window.history.replaceState({}, '', url.pathname)
    }
    if (params.get('calendarError')) {
      console.error('Calendar connection failed:', params.get('calendarError'))
      const url = new URL(window.location.href)
      url.searchParams.delete('calendarError')
      window.history.replaceState({}, '', url.pathname)
    }
    // CRM OAuth callbacks handled by CRMIntegrationCard component
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchCalendarSettings() {
    try {
      const data = await Api.calendar.getSettings(tenantId)
      setCalendarSettings(data)
    } catch {
      console.error("Failed to fetch calendar settings")
    }
  }

  async function handleConnectCalendar(provider: 'google' | 'outlook') {
    setCalLoading(true)
    try {
      const res = await Api.calendar.getAuthUrl(tenantId, provider)
      // Redirect browser to provider's consent screen
      window.location.href = res.url
    } catch {
      console.error(`Failed to get ${provider} auth URL`)
      setCalLoading(false)
    }
  }

  async function handleDisconnectCalendar() {
    setCalLoading(true)
    try {
      const res = await Api.calendar.disconnect(tenantId)
      if (res.success) {
        setCalendarSettings(null)
      }
    } catch {
      console.error("Disconnect failed")
    } finally {
      setCalLoading(false)
    }
  }

  async function fetchTemplates() {
    try {
      const data = await Api.templates.list()
      setTemplates(data)
    } catch {
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
          business_type: '',
          owner_first_name: '',
          owner_last_name: '',
          owner_email: '',
          owner_pass: ''
        })
      } else {
        setOnboardingError(res.error || 'Failed to create business')
      }
    } catch {
      setOnboardingError('Connection error to backend')
    } finally {
      setOnboardingLoading(false)
    }
  }

  if (!isSuperAdmin) {
    return (
      <div className="flex-1 flex flex-col overflow-y-auto p-8 transition-colors duration-200" style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}>
        <header className="mb-8 flex items-center">
            <div className="p-2 rounded-lg mr-4" style={{ backgroundColor: 'var(--bg-raised)', color: 'var(--text-secondary)' }}>
                <Settings className="w-6 h-6" />
            </div>
            <div>
                <h1 className="text-3xl font-display">Business Settings</h1>
                <p style={{ color: 'var(--text-secondary)' }}>Manage your bays, resources, and preferences</p>
            </div>
        </header>
        <div className="space-y-8">
          <Card className="p-8 text-center" style={{ backgroundColor: 'var(--bg-raised)' }}>
            <p className="italic" style={{ color: 'var(--text-muted)' }}>User profile settings will appear here.</p>
          </Card>

          {/* CALENDAR SYNC SECTION */}
          <Card className="p-6" style={{ backgroundColor: 'var(--bg-raised)' }}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center">
                <div className="bg-blue-100 dark:bg-blue-900/30 p-2 rounded-lg mr-4 text-blue-600 dark:text-blue-400">
                  <Calendar className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold">Calendar Synchronization</h2>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                    Automatically push AI bookings to your Google or Outlook calendar.
                  </p>
                </div>
              </div>
              {calendarSettings && (
                <Badge variant="success" className="flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Connected
                </Badge>
              )}
            </div>

            {!calendarSettings ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button
                  onClick={() => handleConnectCalendar('google')}
                  disabled={calLoading}
                  className="flex items-center justify-center gap-3 p-4 border rounded-2xl hover:border-blue-500 transition-all font-bold group"
                  style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-soft)' }}
                >
                  <div className="w-8 h-8 bg-red-50 dark:bg-red-900/20 rounded-lg flex items-center justify-center text-red-600">G</div>
                  <span>Connect Google Calendar</span>
                  <ExternalLink className="w-4 h-4 ml-auto opacity-0 group-hover:opacity-100 transition-all" />
                </button>
                <button
                  onClick={() => handleConnectCalendar('outlook')}
                  disabled={calLoading}
                  className="flex items-center justify-center gap-3 p-4 border rounded-2xl hover:border-blue-500 transition-all font-bold group"
                  style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-soft)' }}
                >
                  <div className="w-8 h-8 bg-blue-50 dark:bg-blue-900/20 rounded-lg flex items-center justify-center text-blue-600">O</div>
                  <span>Connect Outlook Calendar</span>
                  <ExternalLink className="w-4 h-4 ml-auto opacity-0 group-hover:opacity-100 transition-all" />
                </button>
              </div>
            ) : (
              <div className="p-4 border rounded-2xl flex items-center justify-between" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-soft)' }}>
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white ${calendarSettings.provider === 'google' ? 'bg-red-500' : 'bg-blue-500'}`}>
                    {calendarSettings.provider === 'google' ? 'G' : 'O'}
                  </div>
                  <div>
                    <div className="font-bold capitalize">{calendarSettings.provider} Calendar Connected</div>
                    <div className="text-xs text-gray-500">ID: {calendarSettings.external_calendar_id}</div>
                  </div>
                </div>
                <Button 
                  variant="ghost" 
                  onClick={handleDisconnectCalendar}
                  disabled={calLoading}
                  className="text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                  icon={Unlink}
                >
                  Disconnect
                </Button>
              </div>
            )}
          </Card>

          {/* CRM INTEGRATIONS */}
          <CRMIntegrationCard tenantId={tenantId} provider={{ name: 'Jobber', color: 'green', icon: 'J', description: 'Sync customers and appointments with your Jobber account.', getSettings: Api.jobber.getSettings, getAuthUrl: Api.jobber.getAuthUrl, disconnect: Api.jobber.disconnect, triggerSync: Api.jobber.triggerSync, connectedParam: 'jobberConnected' }} />
          <CRMIntegrationCard tenantId={tenantId} provider={{ name: 'HubSpot', color: 'orange', icon: 'H', description: 'Sync customers and appointments with your HubSpot account.', getSettings: Api.hubspot.getSettings, getAuthUrl: Api.hubspot.getAuthUrl, disconnect: Api.hubspot.disconnect, triggerSync: Api.hubspot.triggerSync, connectedParam: 'hubspotConnected' }} />
          <CRMIntegrationCard tenantId={tenantId} provider={{ name: 'Square', color: 'blue', icon: 'S', description: 'Sync customers and bookings with your Square account.', getSettings: Api.square.getSettings, getAuthUrl: Api.square.getAuthUrl, disconnect: Api.square.disconnect, triggerSync: Api.square.triggerSync, connectedParam: 'squareConnected' }} />
          <CRMIntegrationCard tenantId={tenantId} provider={{ name: 'ServiceTitan', color: 'purple', icon: 'ST', description: 'Sync customers and jobs with your ServiceTitan account.', getSettings: Api.servicetitan.getSettings, getAuthUrl: Api.servicetitan.getAuthUrl, disconnect: Api.servicetitan.disconnect, triggerSync: Api.servicetitan.triggerSync, connectedParam: 'servicetitanConnected' }} />

          <Card className="p-6" style={{ backgroundColor: 'var(--bg-raised)' }}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold">{vocab.resource_plural} & Capacity Units</h2>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>Each unit (bay, chair, room, or vehicle) is a {vocab.resource_label.toLowerCase()} that can run its own {vocab.booking_label.toLowerCase()}s in parallel.</p>
              </div>
            </div>

            {resourcesError && (
              <div className="mb-4 text-sm text-red-600 dark:text-red-400">
                {resourcesError}
              </div>
            )}

            <form onSubmit={handleCreateResource} className="flex flex-col md:flex-row gap-3 mb-6">
              <Input
                placeholder={`${vocab.resource_label} Name (e.g. Station 2)`}
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
                Add {vocab.resource_label}
              </Button>
            </form>

            <div className="border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border-soft)' }}>
              <div className="px-4 py-2 text-xs font-bold uppercase tracking-widest flex justify-between" style={{ backgroundColor: 'var(--bg-raised)', color: 'var(--text-secondary)' }}>
                <span>Name</span>
                <span className="w-32 text-right">Status</span>
              </div>
              {resourcesLoading && resources.length === 0 ? (
                <div className="p-4 text-sm" style={{ color: 'var(--text-secondary)' }}>Loading {vocab.resource_plural.toLowerCase()}...</div>
              ) : resources.length === 0 ? (
                <div className="p-4 text-sm" style={{ color: 'var(--text-secondary)' }}>No {vocab.resource_plural.toLowerCase()} yet. Add your first {vocab.resource_label.toLowerCase()} above.</div>
              ) : (
                resources.map(r => (
                  <div key={r.id} className="px-4 py-3 border-t flex items-center justify-between text-sm" style={{ borderColor: 'var(--border-soft)' }}>
                    <div>
                      <div className="font-semibold">{r.name}</div>
                      {r.description && (
                        <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{r.description}</div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      className="h-8 text-xs px-3"
                      onClick={() => toggleResourceActive(r.id, r.is_active ?? true)}
                    >
                      <Badge variant={r.is_active ?? true ? 'success' : 'secondary'}>
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
    <div className="flex-1 flex flex-col overflow-y-auto transition-colors duration-200" style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}>
      <header className="p-4 md:p-8 sticky top-0 z-10 flex items-center" style={{ borderBottom: '1px solid var(--border-soft)', backgroundColor: 'var(--bg-surface)' }}>
        <div className="bg-blue-600 p-2 rounded-lg mr-4 shadow-md text-white">
          <ShieldCheck className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-2xl md:text-3xl font-display">Business Onboarding</h1>
          <p className="text-sm italic font-medium" style={{ color: 'var(--text-secondary)' }}>Super-Admin Console (Multi-Tenant Management)</p>
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
            <h2 className="text-lg font-bold flex items-center" style={{ color: 'var(--text-primary)' }}>
              <Building2 className="w-5 h-5 mr-2 text-blue-600 dark:text-blue-400" />
              1. Business Information
            </h2>
            <Card className="grid grid-cols-1 md:grid-cols-2 gap-4 p-6" style={{ backgroundColor: 'var(--bg-raised)', borderColor: 'var(--border-soft)' }}>
              <div className="space-y-1">
                <label className="text-xs font-bold uppercase ml-1" style={{ color: 'var(--text-secondary)' }}>Company Name</label>
                <Input 
                  required
                  value={form.tenant_name}
                  onChange={e => setForm({...form, tenant_name: e.target.value})}
                  placeholder="e.g. Sunny Day Spa"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold uppercase ml-1" style={{ color: 'var(--text-secondary)' }}>Business Template</label>
                <Select 
                  required
                  value={form.business_type}
                  onChange={e => setForm({...form, business_type: e.target.value})}
                  options={[
                    { label: 'Select a template...', value: '' },
                    ...templates.map(t => ({ label: t.display_name, value: t.business_type }))
                  ]}
                />
              </div>
            </Card>
          </section>

          {/* Owner Info */}
          <section className="space-y-4">
            <h2 className="text-lg font-bold flex items-center" style={{ color: 'var(--text-primary)' }}>
              <UserPlus className="w-5 h-5 mr-2 text-blue-600 dark:text-blue-400" />
              2. Owner Account
            </h2>
            <Card className="space-y-4 p-6" style={{ backgroundColor: 'var(--bg-raised)', borderColor: 'var(--border-soft)' }}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase ml-1" style={{ color: 'var(--text-secondary)' }}>First Name</label>
                  <Input 
                    required
                    value={form.owner_first_name}
                    onChange={e => setForm({...form, owner_first_name: e.target.value})}
                    placeholder="John"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase ml-1" style={{ color: 'var(--text-secondary)' }}>Last Name</label>
                  <Input 
                    required
                    value={form.owner_last_name}
                    onChange={e => setForm({...form, owner_last_name: e.target.value})}
                    placeholder="Doe"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase ml-1" style={{ color: 'var(--text-secondary)' }}>Email</label>
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
                <label className="text-xs font-bold uppercase ml-1" style={{ color: 'var(--text-secondary)' }}>Password</label>
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
            isLoading={onboardingLoading}
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
