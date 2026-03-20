'use client'

import React, { useEffect, useState, useRef, useCallback } from 'react'
import { 
  Building2, 
  RefreshCw, 
  Search, 
  ChevronRight, 
  Save, 
  Globe, 
  MessageSquare, 
  X, 
  Phone,
  LayoutTemplate,
  Edit,
  Clock,
  ShieldAlert,
  Trash2,
  Mic
} from 'lucide-react'
import { Api } from '../lib/api'
import { useSessionContext } from '@/lib/SessionContext'
import { formatPhone, normalizePhone } from '../lib/phone'
import { US_TIMEZONES } from '../lib/constants'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { Select } from './ui/Select'
import { Card } from './ui/Card'
import { Badge } from './ui/Badge'
import { Modal } from './ui/Modal'

type Tenant = {
    id: string
    name: string
    business_type: string
    timezone: string
    owner_phone?: string | null
    inbound_phone?: string | null
    voice_id?: string | null
    first_message?: string | null
    system_prompt?: string | null
}

type Template = {
    business_type: string
    display_name: string
}

interface SuperAdminProps {
  onSelectTenant?: (id: string, name: string) => void;
  currentTenantId?: string | null;
}

export default function SuperAdminDashboard({ onSelectTenant, currentTenantId }: SuperAdminProps) {
    const { notifyTenantsChanged } = useSessionContext()
    const [tenants, setTenants] = useState<Tenant[]>([])
    const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null)
    const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  
  // Edit form state
    const [form, setForm] = useState<Tenant | null>(null)
  
  // Drag-and-drop reorder state
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const [originalOrder, setOriginalOrder] = useState<Tenant[]>([])
  const [hasReordered, setHasReordered] = useState(false)
  const [savingOrder, setSavingOrder] = useState(false)

  // Delete confirmation state
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  // Create Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [newBusiness, setNewBusiness] = useState({
    tenant_name: '',
    business_type: 'mobile-tire',
    owner_first_name: '',
    owner_last_name: '',
    owner_email: '',
    owner_pass: ''
  })

    useEffect(() => {
      void fetchData()
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

  useEffect(() => {
    if (selectedTenant) {
      setForm({ 
        ...selectedTenant,
        owner_phone: formatPhone(selectedTenant.owner_phone)
      })
      setIsEditing(false) // Default to read-only when switching tenants
      setSuccess(false)
      setError(null)
    }
  }, [selectedTenant])

    const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [tData, tempData] = await Promise.all([
        Api.tenants.list(),
        Api.templates.list()
      ])
      
      const tenantsArray = Array.isArray(tData) ? tData : []
      const templatesArray = Array.isArray(tempData) ? tempData : []

      setTenants(tenantsArray)
      setTemplates(templatesArray)
      
      if (tenantsArray.length > 0 && !selectedTenant) {
        const initial = currentTenantId 
          ? (tenantsArray.find(t => t.id === currentTenantId) || tenantsArray[0])
          : tenantsArray[0];
        setSelectedTenant(initial)
        if (onSelectTenant && !currentTenantId) onSelectTenant(initial.id, initial.name);
      }
    } catch (e) {
      console.error('Fetch error:', e)
      setError('Failed to load data from backend. Ensure server is reachable.')
    } finally {
      setLoading(false)
    }
  }

  // --- Drag-and-drop reorder ---
  function handleDragStart(index: number) {
    setDragIndex(index)
    if (!hasReordered) setOriginalOrder([...tenants])
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault()
    if (dragIndex === null || dragIndex === index) return
    setOverIndex(index)

    const updated = [...tenants]
    const [moved] = updated.splice(dragIndex, 1)
    updated.splice(index, 0, moved)
    setTenants(updated)
    setDragIndex(index)
    setHasReordered(true)
  }

  function handleDragEnd() {
    setDragIndex(null)
    setOverIndex(null)
  }

  async function handleSaveOrder() {
    setSavingOrder(true)
    try {
      const order = tenants.map(t => t.id)
      const res = await Api.tenants.reorder(order)
      if (res.success) {
        setHasReordered(false)
        setOriginalOrder([])
        notifyTenantsChanged()
      }
    } catch {
      setError('Failed to save order')
    } finally {
      setSavingOrder(false)
    }
  }

  function handleDiscardOrder() {
    setTenants(originalOrder)
    setHasReordered(false)
    setOriginalOrder([])
  }

  async function handleSave() {
    if (!form) return
    setSaving(true)
    setError(null)
    setSuccess(false)

    const normalizedForm = {
      ...form,
      owner_phone: form.owner_phone ? normalizePhone(form.owner_phone) : null,
      inbound_phone: form.inbound_phone ? normalizePhone(form.inbound_phone) : null
    }

    try {
      const res = await Api.tenants.update(form.id, normalizedForm)

      if (res.success) {
        setSuccess(true)
        setIsEditing(false)
        const updatedTenants = tenants.map(t => t.id === form.id ? { ...normalizedForm } : t)
        setTenants(updatedTenants)
        setSelectedTenant({ ...normalizedForm } as Tenant)
        if (onSelectTenant) onSelectTenant(form.id, form.name);
      } else {
        setError(res.error || 'Failed to update business attributes')
      }
    } catch {
      setError('Connection error')
    } finally {
      setSaving(false)
    }
  }

  function handleDelete() {
    if (!selectedTenant) return
    setDeleteConfirmText('')
    setIsDeleteModalOpen(true)
  }

  async function confirmDelete() {
    if (!selectedTenant) return
    setDeleting(true)
    try {
      const res = await Api.tenants.delete(selectedTenant.id)
      if (res.success) {
        setSelectedTenant(null)
        setIsDeleteModalOpen(false)
        setDeleteConfirmText('')
        fetchData()
        notifyTenantsChanged()
      } else {
        setError(res.error || 'Failed to delete business')
      }
    } catch {
      setError('Failed to delete business')
    } finally {
      setDeleting(false)
    }
  }

  async function handleCreate() {
    setSaving(true)
    setError(null)
    try {
      const res = await Api.tenants.create(newBusiness)
        if (res.success) {
            setIsCreateModalOpen(false)
            setNewBusiness({
                tenant_name: '',
                business_type: 'mobile-tire',
            owner_first_name: '',
            owner_last_name: '',
                owner_email: '',
                owner_pass: ''
            })
            fetchData()
            notifyTenantsChanged()
        } else {
            setError(res.error || 'Failed to create new business')
        }
    } catch {
      setError('Connection error')
    } finally {
        setSaving(false)
    }
  }

  if (loading) return <div className="p-8 text-gray-500 italic flex items-center"><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Loading all businesses...</div>

  return (
    <div className="flex flex-1 overflow-hidden relative text-gray-900 dark:text-gray-100 bg-white dark:bg-[#111] transition-colors duration-200">
      
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Launch New Business"
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsCreateModalOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} isLoading={saving} disabled={!newBusiness.tenant_name}>Deploy Business</Button>
          </>
        }
      >
        <div className="space-y-4">
            <Input 
                label="Business Name"
                placeholder="e.g. Elite Salon & Spa"
                value={newBusiness.tenant_name}
                onChange={e => setNewBusiness({...newBusiness, tenant_name: e.target.value})}
            />
            <Select 
                label="Template Type"
                value={newBusiness.business_type}
                onChange={e => setNewBusiness({...newBusiness, business_type: e.target.value})}
                options={templates.map(t => ({ label: t.display_name, value: t.business_type }))}
            />
            <div className="pt-4 border-t border-gray-50 dark:border-gray-800 space-y-4">
                <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Initial Owner Credentials</h4>
                <div className="grid grid-cols-2 gap-3">
                    <Input 
                      placeholder="First Name"
                      value={newBusiness.owner_first_name}
                      onChange={e => setNewBusiness({...newBusiness, owner_first_name: e.target.value})}
                    />
                    <Input 
                        type="email" 
                        placeholder="Email"
                        value={newBusiness.owner_email}
                        onChange={e => setNewBusiness({...newBusiness, owner_email: e.target.value})}
                    />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Input 
                    placeholder="Last Name"
                    value={newBusiness.owner_last_name}
                    onChange={e => setNewBusiness({...newBusiness, owner_last_name: e.target.value})}
                  />
                  <Input 
                    type="password" 
                    placeholder="Owner Password"
                    value={newBusiness.owner_pass}
                    onChange={e => setNewBusiness({...newBusiness, owner_pass: e.target.value})}
                  />
                </div>
            </div>
        </div>
      </Modal>
      
      {/* Sidebar List */}
      <section className="w-full md:w-80 flex flex-col bg-gray-50 dark:bg-[#1a1a1a] border-r border-gray-200 dark:border-gray-800 transition-colors duration-200">
        <header className="p-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1a1a1a] sticky top-0 z-10 transition-colors duration-200">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-bold flex items-center">
                <Globe className="w-5 h-5 mr-2 text-blue-600 dark:text-blue-400" />
                All Businesses
            </h2>
            <div className="flex items-center space-x-1">
                <Button 
                    variant="ghost"
                    onClick={() => setIsCreateModalOpen(true)} 
                    size="sm"
                    className="p-1.5"
                    title="Launch New Business"
                >
                    <Building2 className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={fetchData} className="p-1.5 text-gray-500 dark:text-gray-400">
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
            </div>
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400 dark:text-gray-500" />
            <input type="text" placeholder="Search businesses..." className="w-full pl-9 pr-4 py-2 bg-gray-100 dark:bg-[#222] border-none rounded-md text-sm outline-none dark:text-gray-200 transition-colors duration-200" />
          </div>
        </header>

        {/* Save/Discard reorder bar */}
        {hasReordered && (
          <div className="flex items-center justify-between gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800">
            <span className="text-xs font-bold text-amber-700 dark:text-amber-300">Order changed</span>
            <div className="flex gap-1.5">
              <button
                onClick={handleDiscardOrder}
                className="text-xs font-bold text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 px-2 py-1 rounded transition-colors"
              >
                Discard
              </button>
              <button
                onClick={handleSaveOrder}
                disabled={savingOrder}
                className="text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 px-3 py-1 rounded transition-colors disabled:opacity-50"
              >
                {savingOrder ? 'Saving...' : 'Save Order'}
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {tenants.map((t, idx) => (
            <div
              key={t.id}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragEnd={handleDragEnd}
              onClick={() => {
                setSelectedTenant(t);
                if (onSelectTenant) onSelectTenant(t.id, t.name);
              }}
              className={`p-4 border-b border-gray-100 dark:border-gray-800 cursor-pointer transition flex justify-between items-center
                ${selectedTenant?.id === t.id ? 'bg-white dark:bg-[#2a2a2a] border-l-4 border-l-blue-600 dark:border-l-blue-400 shadow-sm' : 'hover:bg-gray-100 dark:hover:bg-[#222]'}
                ${dragIndex === idx ? 'opacity-50' : ''}`}
            >
              <div className="flex items-center gap-3">
                <div className="cursor-grab active:cursor-grabbing text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                    <circle cx="3" cy="2" r="1.5" /><circle cx="9" cy="2" r="1.5" />
                    <circle cx="3" cy="6" r="1.5" /><circle cx="9" cy="6" r="1.5" />
                    <circle cx="3" cy="10" r="1.5" /><circle cx="9" cy="10" r="1.5" />
                  </svg>
                </div>
                <div>
                  <p className={`text-sm font-semibold ${selectedTenant?.id === t.id ? 'text-blue-600 dark:text-blue-400' : 'text-gray-900 dark:text-gray-100'}`}>{t.name}</p>
                  <div className="flex items-center mt-1">
                      <Badge variant="secondary" className="mr-2">
                          {t.business_type}
                      </Badge>
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono truncate max-w-[100px]">{t.id.slice(0,8)}</span>
                  </div>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600" />
            </div>
          ))}
        </div>
      </section>

      {/* Detail Pane */}
      <section className="flex-1 flex flex-col bg-white dark:bg-[#111] overflow-y-auto transition-colors duration-200">
        {selectedTenant && form ? (
          <>
            <header className="p-4 md:p-8 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-[#1a1a1a] flex items-center justify-between sticky top-0 bg-white dark:bg-[#111] z-10 transition-colors duration-200">
              <div className="flex items-center">
                <div className="bg-blue-600 dark:bg-blue-700 p-2 rounded-lg mr-4 shadow-md text-white">
                  <Building2 className="w-6 h-6" />
                </div>
                <div>
                  <h1 className="text-xl md:text-3xl font-bold dark:text-white">{selectedTenant.name}</h1>
                  <p className="text-sm text-gray-500 dark:text-gray-400 font-mono italic">
                    {isEditing ? 'Global Attributes Editor' : 'Business Settings Overview'}
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                {success && <span className="text-green-600 dark:text-green-400 text-sm font-bold flex items-center mr-2"><Save className="w-4 h-4 mr-1" /> Updated!</span>}
                {!isEditing ? (
                    <>
                        <Button variant="danger" size="sm" onClick={handleDelete} title="Delete Business"><Trash2 className="w-5 h-5" /></Button>
                        <Button 
                            variant="secondary"
                            onClick={() => setIsEditing(true)}
                        >
                            <Edit className="w-4 h-4 mr-2" /> Modify Attributes
                        </Button>
                    </>
                ) : (
                    <>
                        <Button variant="ghost" onClick={() => setIsEditing(false)}>
                            <X className="w-5 h-5" />
                        </Button>
                        <Button 
                            onClick={handleSave}
                            isLoading={saving}
                        >
                            {!saving && <Save className="w-4 h-4 mr-2" />}
                            Save Changes
                        </Button>
                    </>
                )}
              </div>
            </header>

            <div className="p-4 md:p-8 space-y-8 max-w-4xl">
              
              {error && (
                <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/40 text-red-700 dark:text-red-400 rounded-xl text-sm font-medium">
                  {error}
                </div>
              )}

              {/* Core Identity */}
              <Card title="Business Identity & Operations" className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-4">
                        {isEditing ? (
                            <Input 
                                label="Display Name"
                                value={form.name} 
                                onChange={e => setForm({...form, name: e.target.value})}
                            />
                        ) : (
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase ml-1">Display Name</label>
                                <p className="p-2.5 font-bold text-lg text-gray-900 dark:text-white">{selectedTenant.name}</p>
                            </div>
                        )}
                        {isEditing ? (
                            <Select 
                                label="Template Type"
                                value={form.business_type} 
                                onChange={e => setForm({...form, business_type: e.target.value})}
                                options={templates.map(t => ({ label: t.display_name, value: t.business_type }))}
                            />
                        ) : (
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase ml-1 flex items-center">
                                    <LayoutTemplate className="w-3 h-3 mr-1" /> Template Type
                                </label>
                                <p className="p-2.5 text-blue-700 dark:text-blue-400 font-bold uppercase tracking-tight text-sm">
                                    {templates.find(t => t.business_type === selectedTenant.business_type)?.display_name || selectedTenant.business_type}
                                </p>
                            </div>
                        )}
                    </div>
                    <div className="space-y-4">
                        {isEditing ? (
                            <Select 
                                label="Timezone"
                                value={form.timezone} 
                                onChange={e => setForm({...form, timezone: e.target.value})}
                                options={US_TIMEZONES}
                            />
                        ) : (
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase ml-1 flex items-center">
                                    <Clock className="w-3 h-3 mr-1" /> Timezone
                                </label>
                                <p className="p-2.5 text-gray-700 dark:text-gray-300 font-medium text-sm">
                                    {US_TIMEZONES.find(tz => tz.value === selectedTenant.timezone)?.label || selectedTenant.timezone}
                                </p>
                            </div>
                        )}
                        {isEditing ? (
                            <Input 
                                label="Owner Notification Phone"
                                value={form.owner_phone || ''} 
                                onChange={e => setForm({...form, owner_phone: e.target.value})}
                                placeholder="+1-555-010-9999"
                            />
                        ) : (
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase ml-1 flex items-center">
                                    <Phone className="w-3 h-3 mr-1" /> Owner Notification Phone
                                </label>
                                <p className="p-2.5 text-gray-700 dark:text-gray-300 font-medium font-mono">{selectedTenant.owner_phone ? formatPhone(selectedTenant.owner_phone) : 'Not set'}</p>
                            </div>
                        )}
                        {isEditing ? (
                            <Input 
                                label="Vapi Inbound Phone"
                                value={form.inbound_phone || ''} 
                                onChange={e => setForm({...form, inbound_phone: e.target.value})}
                                placeholder="+1-555-000-0000"
                            />
                        ) : (
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase ml-1 flex items-center text-blue-600">
                                    <Globe className="w-3 h-3 mr-1" /> Vapi Inbound Phone (Routing)
                                </label>
                                <p className="p-2.5 text-blue-700 dark:text-blue-400 font-bold font-mono">{selectedTenant.inbound_phone ? formatPhone(selectedTenant.inbound_phone) : 'Not connected'}</p>
                            </div>
                        )}
                    </div>
                </div>
              </Card>

              {/* AI Config */}
              <section className="space-y-6">
                <div className="flex items-center space-x-2 text-gray-700 dark:text-gray-200 border-b border-gray-100 dark:border-gray-800 pb-2">
                    <ShieldAlert className="w-5 h-5 text-amber-500" />
                    <h2 className="text-lg font-bold tracking-tight">AI Secretary Core Attributes</h2>
                </div>
                
                <div className="space-y-6">
                    {isEditing ? (
                        <Input 
                            label="Voice ID (Vapi/ElevenLabs)"
                            value={form.voice_id || ''} 
                            onChange={e => setForm({...form, voice_id: e.target.value})}
                            className="font-mono" 
                        />
                    ) : (
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase ml-1 flex items-center">
                                <Mic className="w-3 h-3 mr-1" /> Voice ID (Vapi/ElevenLabs)
                            </label>
                            <p className="p-3 bg-gray-50 dark:bg-[#1a1a1a] rounded-xl text-gray-600 dark:text-gray-400 font-mono text-xs border dark:border-gray-800">{selectedTenant.voice_id || 'Not set'}</p>
                        </div>
                    )}

                    {isEditing ? (
                        <Input 
                            label="First Message (Greeting)"
                            value={form.first_message || ''} 
                            onChange={e => setForm({...form, first_message: e.target.value})}
                        />
                    ) : (
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase ml-1 flex items-center">
                                <MessageSquare className="w-3 h-3 mr-1" /> First Message (Greeting)
                            </label>
                            <p className="p-3 bg-gray-50 dark:bg-[#1a1a1a] rounded-xl text-gray-700 dark:text-gray-300 italic border-l-4 border-blue-200 dark:border-l-blue-900 leading-relaxed">&quot;{selectedTenant.first_message || 'No greeting set'}&quot;</p>
                        </div>
                    )}

                    <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase ml-1 flex items-center">
                            <RefreshCw className="w-3 h-3 mr-1" /> System Prompt (Brain)
                        </label>
                        {isEditing ? (
                            <textarea 
                                rows={10}
                                value={form.system_prompt || ''} 
                                onChange={e => setForm({...form, system_prompt: e.target.value})}
                                className="w-full p-4 bg-white dark:bg-[#222] border border-gray-200 dark:border-gray-800 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm font-mono shadow-inner dark:text-gray-100 transition" 
                            />
                        ) : (
                            <div className="p-4 bg-gray-50 dark:bg-[#1a1a1a] rounded-xl text-gray-600 dark:text-gray-400 text-sm leading-relaxed font-mono whitespace-pre-wrap max-h-60 overflow-y-auto border border-gray-100 dark:border-gray-800">
                                {selectedTenant.system_prompt || 'No prompt configured.'}
                            </div>
                        )}
                    </div>
                </div>
              </section>

              {isEditing && (
                <div className="pt-8 border-t border-gray-200 dark:border-gray-800 flex flex-col md:flex-row space-y-3 md:space-y-0 md:space-x-4">
                    <Button 
                        onClick={handleSave}
                        isLoading={saving}
                        className="flex-1 py-4 text-lg"
                    >
                        {!saving && <Save className="w-6 h-6 mr-3" />}
                        Save All Global Attributes
                    </Button>
                    <Button 
                        variant="secondary"
                        onClick={() => setIsEditing(false)}
                        className="px-8 py-4"
                    >
                        Cancel
                    </Button>
                </div>
              )}

            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-600 italic">Select a business to manage its global attributes</div>
        )}
      </section>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => { setIsDeleteModalOpen(false); setDeleteConfirmText(''); }}
        title="Delete Business"
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => { setIsDeleteModalOpen(false); setDeleteConfirmText(''); }}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={confirmDelete}
              disabled={deleteConfirmText !== selectedTenant?.name || deleting}
            >
              {deleting ? 'Deleting...' : 'Permanently Delete'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <ShieldAlert className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <div className="text-sm text-red-700 dark:text-red-300">
              <p className="font-bold mb-1">This action is permanent and cannot be undone.</p>
              <p>Deleting <strong>{selectedTenant?.name}</strong> will permanently remove all associated data including customers, appointments, employees, resources, call history, and knowledge base documents.</p>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">
              Type <strong>{selectedTenant?.name}</strong> to confirm:
            </label>
            <Input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={selectedTenant?.name || ''}
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}
