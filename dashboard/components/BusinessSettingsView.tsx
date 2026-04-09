'use client'

import React, { useState, useEffect } from 'react'
import {
  PlusCircle,
  Settings,
  Calendar,
  ExternalLink,
  Unlink,
  CheckCircle2,
  Scissors,
  Clock,
  Pencil,
  Trash2,
} from 'lucide-react'
import { Api } from '../lib/api'
import { CRMIntegrationCard } from './CRMIntegrationCard'
import { useStaticData } from '../lib/hooks'
import { useActiveTenantId } from '../lib/SessionContext'
import { useVocabulary } from '@/lib/VocabularyContext'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { Badge } from './ui/Badge'
import type { Service, EffectiveShift } from '../lib/types'

export default function BusinessSettingsView() {
  const tenantId = useActiveTenantId()
  const { resources, services, employees, loading: staticLoading, error: resourcesError, refresh: refreshResources } = useStaticData(tenantId)
  const vocab = useVocabulary()

  const [teamSize, setTeamSize] = useState<number | null>(null)
  const [newResource, setNewResource] = useState({ name: '', description: '' })

  // Service editing
  const [editingService, setEditingService] = useState<Service | null>(null)
  const [newService, setNewService] = useState({ name: '', description: '', duration_minutes: 30 })
  const [addingService, setAddingService] = useState(false)
  const [savingService, setSavingService] = useState(false)
  const [serviceError, setServiceError] = useState<string | null>(null)

  // Availability
  const [shifts, setShifts] = useState<EffectiveShift[]>([])
  const [shiftsLoading, setShiftsLoading] = useState(false)

  // Calendar State
  const [calendarSettings, setCalendarSettings] = useState<{ provider: string; external_calendar_id: string } | null>(null)
  const [calLoading, setCalLoading] = useState(false)

  const isSolo = teamSize === 1
  const soloEmployee = isSolo ? employees[0] : null

  useEffect(() => {
    if (tenantId) {
      fetchCalendarSettings()
      fetchTenantConfig()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId])

  useEffect(() => {
    if (isSolo && soloEmployee && tenantId) {
      fetchShifts(soloEmployee.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSolo, soloEmployee?.id, tenantId])

  async function fetchTenantConfig() {
    try {
      const config = await Api.tenants.getConfig(tenantId)
      setTeamSize(config.team_size ?? null)
    } catch {
      // Default to team mode if we can't determine
      setTeamSize(null)
    }
  }

  async function fetchShifts(employeeId: string) {
    setShiftsLoading(true)
    try {
      // Get next 7 days of shifts
      const today = new Date()
      const weekOut = new Date(today)
      weekOut.setDate(weekOut.getDate() + 6)
      const startDate = today.toISOString().split('T')[0]
      const endDate = weekOut.toISOString().split('T')[0]
      const data = await Api.shifts.schedule.forDate(tenantId, employeeId, startDate, endDate)
      setShifts(data)
    } catch {
      console.error('Failed to fetch shifts')
    } finally {
      setShiftsLoading(false)
    }
  }

  // Detect OAuth redirect params
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('calendarConnected') === 'true') {
      fetchCalendarSettings()
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
    } catch (err) {
      console.error('Failed to create resource', err)
    }
  }

  async function toggleResourceActive(resourceId: string, currentActive: boolean | undefined) {
    try {
      const res = await Api.resources.update(resourceId, { is_active: !currentActive })
      if (res.success) {
        refreshResources()
      }
    } catch (err) {
      console.error('Failed to update resource', err)
    }
  }

  async function handleAddService() {
    if (!tenantId || !newService.name.trim()) {
      setServiceError('Service name is required')
      return
    }
    setSavingService(true)
    setServiceError(null)
    try {
      const res = await Api.services.create(tenantId, {
        name: newService.name.trim(),
        description: newService.description.trim() || undefined,
        duration_minutes: newService.duration_minutes,
      })
      if (res.success) {
        setNewService({ name: '', description: '', duration_minutes: 30 })
        setAddingService(false)
        refreshResources()
      } else {
        setServiceError('Failed to create service')
      }
    } catch {
      setServiceError('Connection error')
    } finally {
      setSavingService(false)
    }
  }

  async function handleUpdateService() {
    if (!editingService || !tenantId) return
    if (!editingService.name.trim()) {
      setServiceError('Service name is required')
      return
    }
    setSavingService(true)
    setServiceError(null)
    try {
      const res = await Api.services.update(editingService.id, tenantId, {
        name: editingService.name.trim(),
        description: editingService.description?.trim() || undefined,
        duration_minutes: editingService.duration_minutes,
      })
      if (res.success) {
        setEditingService(null)
        refreshResources()
      } else {
        setServiceError('Failed to update service')
      }
    } catch {
      setServiceError('Connection error')
    } finally {
      setSavingService(false)
    }
  }

  async function handleDeleteService(id: string, name: string) {
    if (!tenantId || !confirm(`Remove "${name}" from your services?`)) return
    try {
      await Api.services.delete(id, tenantId)
      refreshResources()
    } catch {
      console.error('Failed to delete service')
    }
  }

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  function formatTime(t: string) {
    const [h, m] = t.split(':').map(Number)
    const ampm = h >= 12 ? 'PM' : 'AM'
    const hour = h % 12 || 12
    return `${hour}:${String(m).padStart(2, '0')} ${ampm}`
  }

  // Show loading until we know team_size
  if (teamSize === null && !staticLoading) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ backgroundColor: 'var(--bg-surface)' }}>
        <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading settings...</div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-y-auto p-8 transition-colors duration-200" style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}>
      <header className="mb-8 flex items-center">
        <div className="p-2 rounded-lg mr-4" style={{ backgroundColor: 'var(--accent-muted)', color: 'var(--accent-soft)' }}>
          <Settings className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-3xl font-display">Business Settings</h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            {isSolo ? 'Your services, availability, and calendar' : `Calendar sync, integrations, and ${vocab.resource_plural.toLowerCase()}`}
          </p>
        </div>
      </header>

      <div className="max-w-3xl space-y-8">

        {/* ─── MY SERVICES (solo mode) ─── */}
        {isSolo && (
          <Card className="p-6" style={{ backgroundColor: 'var(--bg-raised)' }}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center">
                <div className="p-2 rounded-lg mr-4" style={{ backgroundColor: 'var(--accent-muted)', color: 'var(--accent-soft)' }}>
                  <Scissors className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold">My Services</h2>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>What you offer and how long each takes.</p>
                </div>
              </div>
              {!addingService && !editingService && (
                <Button variant="ghost" size="sm" icon={PlusCircle} onClick={() => { setAddingService(true); setServiceError(null) }}>
                  Add
                </Button>
              )}
            </div>

            {serviceError && (
              <div className="mb-4 text-sm text-red-500">{serviceError}</div>
            )}

            {/* Add service form */}
            {addingService && (
              <div className="mb-4 p-4 rounded-xl border" style={{ borderColor: 'var(--accent)', backgroundColor: 'var(--bg-surface)' }}>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                  <Input
                    placeholder="Service name"
                    value={newService.name}
                    onChange={e => setNewService(s => ({ ...s, name: e.target.value }))}
                    className="md:col-span-2"
                  />
                  <Input
                    type="number"
                    placeholder="Minutes"
                    value={String(newService.duration_minutes)}
                    onChange={e => setNewService(s => ({ ...s, duration_minutes: parseInt(e.target.value) || 0 }))}
                  />
                </div>
                <Input
                  placeholder="Description (optional)"
                  value={newService.description}
                  onChange={e => setNewService(s => ({ ...s, description: e.target.value }))}
                  className="mb-3"
                />
                <div className="flex gap-2">
                  <Button size="sm" isLoading={savingService} onClick={handleAddService}>Add Service</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setAddingService(false); setServiceError(null) }}>Cancel</Button>
                </div>
              </div>
            )}

            {/* Edit service form */}
            {editingService && (
              <div className="mb-4 p-4 rounded-xl border" style={{ borderColor: 'var(--accent)', backgroundColor: 'var(--bg-surface)' }}>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                  <Input
                    placeholder="Service name"
                    value={editingService.name}
                    onChange={e => setEditingService(s => s ? ({ ...s, name: e.target.value }) : s)}
                    className="md:col-span-2"
                  />
                  <Input
                    type="number"
                    placeholder="Minutes"
                    value={String(editingService.duration_minutes)}
                    onChange={e => setEditingService(s => s ? ({ ...s, duration_minutes: parseInt(e.target.value) || 0 }) : s)}
                  />
                </div>
                <Input
                  placeholder="Description (optional)"
                  value={editingService.description || ''}
                  onChange={e => setEditingService(s => s ? ({ ...s, description: e.target.value }) : s)}
                  className="mb-3"
                />
                <div className="flex gap-2">
                  <Button size="sm" isLoading={savingService} onClick={handleUpdateService}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditingService(null); setServiceError(null) }}>Cancel</Button>
                </div>
              </div>
            )}

            {/* Service list */}
            <div className="border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border-soft)' }}>
              {services.length === 0 ? (
                <div className="p-4 text-sm" style={{ color: 'var(--text-muted)' }}>No services yet. Add what you offer so clients can book.</div>
              ) : (
                services.map(s => (
                  <div key={s.id} className="px-4 py-3 border-t first:border-t-0 flex items-center justify-between text-sm" style={{ borderColor: 'var(--border-soft)' }}>
                    <div>
                      <div className="font-semibold">{s.name}</div>
                      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {s.duration_minutes} min{s.description ? ` · ${s.description}` : ''}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => { setEditingService(s); setAddingService(false); setServiceError(null) }}
                        className="p-1.5 rounded-md transition-colors"
                        style={{ color: 'var(--text-secondary)' }}
                        title="Edit"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteService(s.id, s.name)}
                        className="p-1.5 rounded-md transition-colors"
                        style={{ color: 'var(--red)' }}
                        title="Remove"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        )}

        {/* ─── MY AVAILABILITY (solo mode) ─── */}
        {isSolo && (
          <Card className="p-6" style={{ backgroundColor: 'var(--bg-raised)' }}>
            <div className="flex items-center mb-6">
              <div className="p-2 rounded-lg mr-4" style={{ backgroundColor: 'var(--accent-muted)', color: 'var(--accent-soft)' }}>
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold">My Availability</h2>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>When clients can book you. Edit your schedule in Staff & Shifts.</p>
              </div>
            </div>

            {shiftsLoading ? (
              <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading schedule...</div>
            ) : shifts.length === 0 ? (
              <div className="text-sm" style={{ color: 'var(--text-muted)' }}>No schedule set yet. Set your hours in Staff & Shifts.</div>
            ) : (
              <div className="grid grid-cols-7 gap-2">
                {shifts.map((shift, i) => {
                  const date = new Date(shift.shift_date + 'T12:00:00')
                  const dayName = DAY_NAMES[date.getDay()]
                  const dayNum = date.getDate()
                  const isOff = shift.is_off
                  return (
                    <div
                      key={i}
                      className="rounded-xl p-3 text-center border"
                      style={{
                        borderColor: isOff ? 'var(--border-soft)' : 'var(--accent)',
                        backgroundColor: isOff ? 'var(--bg-surface)' : 'var(--accent-muted)',
                      }}
                    >
                      <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{dayName}</div>
                      <div className="text-lg font-bold" style={{ color: isOff ? 'var(--text-muted)' : 'var(--text-primary)' }}>{dayNum}</div>
                      {isOff ? (
                        <div className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>Off</div>
                      ) : (
                        <div className="text-[10px] mt-1" style={{ color: 'var(--accent-soft)' }}>
                          {shift.start_time && formatTime(shift.start_time)}<br />{shift.end_time && formatTime(shift.end_time)}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        )}

        {/* ─── MY CALENDAR ─── */}
        <Card className="p-6" style={{ backgroundColor: 'var(--bg-raised)' }}>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center">
              <div className="bg-blue-100 dark:bg-blue-900/30 p-2 rounded-lg mr-4 text-blue-600 dark:text-blue-400">
                <Calendar className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold">{isSolo ? 'My Calendar' : 'Calendar Synchronization'}</h2>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                  {isSolo
                    ? 'Sync bookings to your personal Google or Outlook calendar.'
                    : 'Automatically push AI bookings to your Google or Outlook calendar.'}
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

        {/* ─── CRM INTEGRATIONS ─── */}
        <CRMIntegrationCard tenantId={tenantId} provider={{ name: 'Jobber', color: 'green', icon: 'J', description: 'Sync customers and appointments with your Jobber account.', getSettings: Api.jobber.getSettings, getAuthUrl: Api.jobber.getAuthUrl, disconnect: Api.jobber.disconnect, triggerSync: Api.jobber.triggerSync, connectedParam: 'jobberConnected' }} />
        <CRMIntegrationCard tenantId={tenantId} provider={{ name: 'HubSpot', color: 'orange', icon: 'H', description: 'Sync customers and appointments with your HubSpot account.', getSettings: Api.hubspot.getSettings, getAuthUrl: Api.hubspot.getAuthUrl, disconnect: Api.hubspot.disconnect, triggerSync: Api.hubspot.triggerSync, connectedParam: 'hubspotConnected' }} />
        <CRMIntegrationCard tenantId={tenantId} provider={{ name: 'Square', color: 'blue', icon: 'S', description: 'Sync customers and bookings with your Square account.', getSettings: Api.square.getSettings, getAuthUrl: Api.square.getAuthUrl, disconnect: Api.square.disconnect, triggerSync: Api.square.triggerSync, connectedParam: 'squareConnected' }} />
        <CRMIntegrationCard tenantId={tenantId} provider={{ name: 'ServiceTitan', color: 'purple', icon: 'ST', description: 'Sync customers and jobs with your ServiceTitan account.', getSettings: Api.servicetitan.getSettings, getAuthUrl: Api.servicetitan.getAuthUrl, disconnect: Api.servicetitan.disconnect, triggerSync: Api.servicetitan.triggerSync, connectedParam: 'servicetitanConnected' }} />

        {/* ─── RESOURCES & CAPACITY (team mode only) ─── */}
        {!isSolo && (
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
              {staticLoading && resources.length === 0 ? (
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
        )}
      </div>
    </div>
  )
}
