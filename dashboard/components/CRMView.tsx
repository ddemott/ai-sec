'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { Customer } from '@/lib/types'
import { MOCK_CUSTOMERS, MOCK_SUMMARIES } from '@/lib/mockData'
import { 
  Users, 
  Search, 
  RefreshCw, 
  ChevronRight, 
  ChevronLeft,
  Phone, 
  Mail,
  MapPin,
  History,
  Edit2,
  Save,
  X,
  Trash2,
  UserPlus,
  Calendar,
  Clock,
  XCircle,
} from 'lucide-react'
import { Api } from '../lib/api'
import { US_STATES, US_TIMEZONES, detectTimezone } from '../lib/constants'
import { formatPhone } from '../lib/phone'
import { splitFullName } from '../lib/utils'
import { useSession } from '../lib/hooks'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { PhoneInput } from './ui/PhoneInput'
import { Select } from './ui/Select'
import { Card } from './ui/Card'
import { Badge } from './ui/Badge'

export default function CRMView({ overrideTenantId }: { overrideTenantId?: string | null }) {
  const { tenantId } = useSession(overrideTenantId);
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [summaries, setSummaries] = useState<{ id: string; customer_id: string; summary: string; call_timestamp?: string; created_at?: string; has_transcript?: boolean }[]>([])
  const [loading, setLoading] = useState(true)
  const [showDetailOnMobile, setShowDetailOnMobile] = useState(false)
  const [customerAppointments, setCustomerAppointments] = useState<{ id: string; start_time: string; end_time: string; status: string; description: string; resource_name?: string; employee_name?: string; location?: string }[]>([])
  const [searchQuery, setSearchQuery] = useState('')

  // States
  const [isEditing, setIsEditing] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editForm, setEditForm] = useState({
    first_name: '',
    last_name: '',
    phone: '',
    email: '',
    address: '',
    address_line2: '',
    city: '',
    state: '',
    postal_code: '',
    timezone: 'America/New_York',
    notes: ''
  })

  const handleEditFormChange = (field: string, value: string) => {
    setEditForm(prev => ({ ...prev, [field]: value }))
  }

  useEffect(() => {
    if (tenantId) {
      fetchCustomers()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId])

  useEffect(() => {
    if (selectedCustomer) {
        fetchHistory(selectedCustomer.id)
        fetchCustomerAppointments(selectedCustomer.id)
      const { first, last } = splitFullName(selectedCustomer.name || '')
      const derivedFirst = selectedCustomer.first_name || first || ''
      const derivedLast = selectedCustomer.last_name || last || ''
        setEditForm({
        first_name: derivedFirst,
        last_name: derivedLast,
            phone: formatPhone(selectedCustomer.phone) || '',
            email: selectedCustomer.email || '',
            address: selectedCustomer.address || '',
        address_line2: selectedCustomer.address_line2 || '',
        city: selectedCustomer.city || '',
        state: selectedCustomer.state || '',
        postal_code: selectedCustomer.postal_code || '',
        timezone: selectedCustomer.timezone || 'America/New_York',
            notes: (selectedCustomer.metadata?.notes as string) || ''
        })
        setIsEditing(false)
        setIsCreating(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCustomer])

  // Auto-detect timezone
  useEffect(() => {
    if (!isEditing && !isCreating) return
    const tz = detectTimezone(editForm.city, editForm.state)
    if (tz) {
      setEditForm(prev => ({ ...prev, timezone: tz }))
    }
  }, [editForm.city, editForm.state, isEditing, isCreating])

  async function fetchCustomers() {
    setLoading(true)
    try {
      const data = await Api.customers.list(tenantId)
      if (!data || data.length === 0) {
        if (!tenantId) {
            setCustomers(MOCK_CUSTOMERS)
            if (!selectedCustomer) setSelectedCustomer(MOCK_CUSTOMERS[0])
        } else {
            setCustomers([])
        }
      } else {
        setCustomers(data as unknown as Customer[])
        if (!selectedCustomer) setSelectedCustomer((data as unknown as Customer[])[0])
      }
    } catch {
      setCustomers(MOCK_CUSTOMERS)
      if (!selectedCustomer) setSelectedCustomer(MOCK_CUSTOMERS[0])
    }
    setLoading(false)
  }

  async function fetchHistory(customerId: string) {
    try {
      const data = await Api.callSummaries.list(tenantId, customerId)
      if (!data || data.length === 0) {
        setSummaries(MOCK_SUMMARIES.filter(s => s.customer_id === customerId))
      } else {
        setSummaries(data as typeof summaries)
      }
    } catch {
      setSummaries(MOCK_SUMMARIES.filter(s => s.customer_id === customerId))
    }
  }

  async function fetchCustomerAppointments(customerId: string) {
    try {
      const data = await Api.customers.appointments(customerId, tenantId)
      setCustomerAppointments((data || []) as typeof customerAppointments)
    } catch {
      setCustomerAppointments([])
    }
  }

  async function handleCancelAppointment(appointmentId: string) {
    if (!confirm('Are you sure you want to cancel this appointment?')) return
    try {
      const res = await Api.appointments.cancel(appointmentId, tenantId)
      if (res.success && selectedCustomer) {
        fetchCustomerAppointments(selectedCustomer.id)
      }
    } catch (e) {
      console.error(e)
    }
  }

  const upcomingAppointments = useMemo(() =>
    customerAppointments.filter(a => a.status === 'scheduled' && new Date(a.start_time) > new Date()),
    [customerAppointments]
  )

  const pastAppointments = useMemo(() =>
    customerAppointments.filter(a => a.status !== 'scheduled' || new Date(a.start_time) <= new Date()),
    [customerAppointments]
  )

  const filteredCustomers = useMemo(() => {
    if (!searchQuery.trim()) return customers
    const q = searchQuery.toLowerCase()
    return customers.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.phone || '').includes(q) ||
      (c.email || '').toLowerCase().includes(q)
    )
  }, [customers, searchQuery])

  async function handleSave() {
    if (!selectedCustomer) return
    setSaving(true)

    try {
      const res = await Api.customers.update(selectedCustomer.id, selectedCustomer.tenant_id, {
        first_name: editForm.first_name,
        last_name: editForm.last_name,
        name: `${editForm.first_name} ${editForm.last_name}`.trim(),
        phone: editForm.phone,
        email: editForm.email,
        address: editForm.address,
        address_line2: editForm.address_line2,
        city: editForm.city,
        state: editForm.state,
        postal_code: editForm.postal_code,
        timezone: editForm.timezone,
        notes: editForm.notes
      })

      if (res.success) {
        setIsEditing(false)
        setIsCreating(false)
        await fetchCustomers()
      } else {
        console.error('Failed to update customer', res.error)
      }
    } catch (e) {
      console.error(e)
    }
    setSaving(false)
  }

  async function handleCreate() {
    setSaving(true)
    
    try {
      const res = await Api.customers.create(tenantId, {
          first_name: editForm.first_name,
          last_name: editForm.last_name,
          name: `${editForm.first_name} ${editForm.last_name}`.trim(),
          phone: editForm.phone,
          email: editForm.email,
          address: editForm.address,
          address_line2: editForm.address_line2,
          city: editForm.city,
          state: editForm.state,
          postal_code: editForm.postal_code,
          timezone: editForm.timezone,
          notes: editForm.notes
      })
      if (res.success) {
          setIsCreating(false)
          fetchCustomers()
      }
    } catch (e) {
        console.error(e)
    }
    setSaving(false)
  }

  async function handleDelete() {
    if (!selectedCustomer) return
    if (!confirm(`Are you sure you want to delete ${selectedCustomer.name}? This cannot be undone.`)) return
    
    try {
      const res = await Api.customers.delete(selectedCustomer.id)
      if (res.success) {
          setSelectedCustomer(null)
          fetchCustomers()
      }
    } catch (e) {
        console.error(e)
    }
  }

  const startNewCustomer = () => {
    setIsCreating(true)
    setIsEditing(false)
    setSelectedCustomer(null)
    setEditForm({
      first_name: '',
      last_name: '',
      phone: '',
      email: '',
      address: '',
      address_line2: '',
      city: '',
      state: '',
      postal_code: '',
      timezone: 'America/New_York',
      notes: ''
    })
  }

  return (
    <div className="flex flex-1 overflow-hidden relative text-gray-900 dark:text-gray-100 transition-colors duration-200">
      {/* ITEM LIST PANE */}
      <section className={`w-full md:w-80 flex flex-col bg-gray-50 dark:bg-[#1a1a1a] border-r border-gray-200 dark:border-gray-800 ${showDetailOnMobile ? 'hidden md:flex' : 'flex'}`}>
        <header className="p-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1a1a1a] sticky top-0 z-10">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-bold">Customers</h2>
            <div className="flex space-x-1">
                <Button onClick={startNewCustomer} size="sm" className="p-1.5">
                    <UserPlus className="w-4 h-4" />
                </Button>
                <Button variant="ghost" onClick={fetchCustomers} size="sm" className="p-1.5">
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
            </div>
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400 dark:text-gray-500" />
            <input type="text" placeholder="Search customers..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-9 pr-4 py-2 bg-gray-100 dark:bg-[#222] border-none rounded-md text-sm outline-none dark:text-gray-200" />
          </div>
        </header>
        <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
          {filteredCustomers.map((c) => (
            <div 
              key={c.id}
              onClick={() => { setSelectedCustomer(c); setIsCreating(false); setShowDetailOnMobile(true); }}
              className={`p-4 border-b border-gray-100 dark:border-gray-800 cursor-pointer transition flex justify-between items-center
                ${selectedCustomer?.id === c.id ? 'bg-white dark:bg-[#2a2a2a] border-l-4 border-l-blue-600 dark:border-l-blue-400' : 'hover:bg-gray-100 dark:hover:bg-[#222]'}`}
            >
              <div>
                <p className={`text-sm font-semibold ${selectedCustomer?.id === c.id ? 'text-blue-600 dark:text-blue-400' : 'text-gray-900 dark:text-gray-100'}`}>{c.name || 'Unknown'}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{formatPhone(c.phone)}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600" />
            </div>
          ))}
        </div>
      </section>

      {/* DETAIL PANE */}
      <section className={`flex-1 flex flex-col bg-white dark:bg-[#111] overflow-y-auto fixed inset-0 z-20 md:relative md:z-0 ${(showDetailOnMobile || isCreating) ? 'flex' : 'hidden md:flex'}`}>
        {(selectedCustomer || isCreating) ? (
          <>
            <header className="p-4 md:p-8 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-[#1a1a1a] flex items-center justify-between">
              <div className="flex items-center">
                <button 
                    onClick={() => { setShowDetailOnMobile(false); setIsCreating(false); }}
                    className="md:hidden p-2 -ml-2 mr-2 text-blue-600 dark:text-blue-400"
                >
                    <ChevronLeft className="w-6 h-6" />
                </button>
                <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 md:w-16 md:h-16 bg-blue-600 dark:bg-blue-700 rounded-full flex items-center justify-center text-white text-xl md:text-2xl font-bold">
                    {isCreating ? '+' : (selectedCustomer?.name?.charAt(0) || '?')}
                    </div>
                    <div>
                    <h1 className="text-xl md:text-3xl font-bold dark:text-white">{isCreating ? 'New Customer' : (selectedCustomer?.name || 'Unknown')}</h1>
                    {!isCreating && (
                        <p className="text-gray-500 dark:text-gray-400 text-sm md:text-base flex items-center">
                        <Phone className="w-4 h-4 mr-2" /> {formatPhone(selectedCustomer?.phone)}
                        </p>
                    )}
                    </div>
                </div>
              </div>
              
              <div className="flex items-center space-x-2">
                {!isEditing && !isCreating ? (
                    <>
                        <Button variant="danger" size="sm" onClick={handleDelete} title="Delete Customer">
                            <Trash2 className="w-5 h-5" />
                        </Button>
                        <Button variant="secondary" onClick={() => setIsEditing(true)}>
                            <Edit2 className="w-4 h-4 mr-2" /> Edit Info
                        </Button>
                    </>
                ) : (
                    <div className="flex space-x-2">
                        <Button variant="ghost" onClick={() => { setIsEditing(false); setIsCreating(false); }}>
                            <X className="w-5 h-5" />
                        </Button>
                        <Button 
                            onClick={isCreating ? handleCreate : handleSave} 
                            isLoading={saving}
                        >
                            {!saving && <Save className="w-4 h-4 mr-2" />}
                            {isCreating ? 'Create Customer' : 'Save Changes'}
                        </Button>
                    </div>
                )}
              </div>
            </header>

            <div className="p-4 md:p-8 space-y-8">
              <Card title="Contact Details & Notes" className="max-w-2xl">
                {(!isEditing && !isCreating) ? (
                    <div className="space-y-4 text-sm">
                        <div className="flex items-start">
                            <Mail className="w-4 h-4 mr-3 text-gray-400 dark:text-gray-500 mt-0.5" />
                            <span className="dark:text-gray-300">{selectedCustomer?.email || 'No email provided'}</span>
                        </div>
                        <div className="flex items-start">
                            <MapPin className="w-4 h-4 mr-3 text-gray-400 dark:text-gray-500 mt-0.5" />
                            <span className="dark:text-gray-300">
                              {selectedCustomer
                                ? [
                                    selectedCustomer.address,
                                    selectedCustomer.address_line2,
                                    selectedCustomer.city,
                                    [
                                      selectedCustomer.state,
                                      selectedCustomer.postal_code
                                    ].filter(Boolean).join(' ')
                                  ]
                                  .filter(Boolean)
                                  .join(', ') || 'No address on file'
                                : 'No address on file'}
                            </span>
                         </div>
                        <div className="flex items-start">
                            <RefreshCw className="w-4 h-4 mr-3 text-gray-400 dark:text-gray-500 mt-0.5" />
                            <span className="dark:text-gray-300">
                              Timezone: {US_TIMEZONES.find(t => t.value === selectedCustomer?.timezone)?.label || selectedCustomer?.timezone || 'Not set'}
                            </span>
                        </div>
                        <div className="mt-6 pt-6 border-t border-gray-100 dark:border-gray-800">
                            <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase mb-2">Internal Notes</p>
                            <p className="text-gray-700 dark:text-gray-400 italic leading-relaxed">
                                {(selectedCustomer?.metadata?.notes as string) || 'No internal notes added yet.'}
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <Input label="First Name" value={editForm.first_name} onChange={(e) => handleEditFormChange('first_name', e.target.value)} placeholder="First Name" />
                        <Input label="Last Name" value={editForm.last_name} onChange={(e) => handleEditFormChange('last_name', e.target.value)} placeholder="Last Name" />
                        <PhoneInput label="Phone Number" value={editForm.phone} onChange={(val) => handleEditFormChange('phone', val)} />
                      </div>
                      <Input label="Email" type="email" value={editForm.email} onChange={(e) => handleEditFormChange('email', e.target.value)} placeholder="customer@email.com" />
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Input label="Address Line 1" value={editForm.address} onChange={(e) => handleEditFormChange('address', e.target.value)} placeholder="123 Street St" />
                        <Input label="Address Line 2" value={editForm.address_line2} onChange={(e) => handleEditFormChange('address_line2', e.target.value)} placeholder="Apt / Suite / Unit" />
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <Input label="City" value={editForm.city} onChange={(e) => handleEditFormChange('city', e.target.value)} placeholder="New York" />
                        <Select 
                        label="State" 
                        value={editForm.state} 
                        onChange={(e) => handleEditFormChange('state', e.target.value)} 
                        options={[{ label: 'Select state', value: '' }, ...US_STATES.map(code => ({ label: code, value: code }))]}
                        />
                        <Input label="ZIP" value={editForm.postal_code} onChange={(e) => handleEditFormChange('postal_code', e.target.value)} placeholder="10001" />
                      </div>
                      <Select
                        label="Timezone"
                        value={editForm.timezone}
                        onChange={(e) => handleEditFormChange('timezone', e.target.value)}
                        options={US_TIMEZONES}
                      />
                      <div>
                        <label className="block text-xs font-bold text-gray-400 dark:text-gray-500 uppercase mb-1">Internal Notes</label>
                        <textarea 
                          rows={4}
                          value={editForm.notes} 
                          onChange={(e) => handleEditFormChange('notes', e.target.value)}
                          className="w-full p-2.5 bg-gray-50 dark:bg-[#222] border border-gray-200 dark:border-gray-800 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-gray-100 transition"
                          placeholder="Add private notes the AI should consider..."
                        />
                      </div>
                    </div>
                )}
              </Card>

              {!isCreating && (
                <>
                  {/* UPCOMING APPOINTMENTS */}
                  <div className="space-y-4">
                    <h3 className="font-bold text-gray-900 dark:text-white flex items-center text-lg">
                      <Calendar className="w-5 h-5 mr-2 text-gray-400 dark:text-gray-500" />
                      Upcoming Appointments
                    </h3>
                    {upcomingAppointments.length > 0 ? (
                      <div className="space-y-3">
                        {upcomingAppointments.map((a) => (
                          <div key={a.id} className="p-4 border border-gray-100 dark:border-gray-800 rounded-xl bg-white dark:bg-[#1a1a1a] shadow-sm flex justify-between items-start">
                            <div className="space-y-1">
                              <p className="text-sm font-semibold text-gray-900 dark:text-white">{a.description}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center">
                                <Clock className="w-3 h-3 mr-1" />
                                {new Date(a.start_time).toLocaleDateString()} at {new Date(a.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                {a.resource_name}{a.employee_name ? ` / ${a.employee_name}` : ''}
                              </p>
                              {a.location && <p className="text-xs text-gray-400 dark:text-gray-500">{a.location}</p>}
                            </div>
                            <div className="flex items-center space-x-2">
                              <Badge variant="primary">Scheduled</Badge>
                              <Button variant="danger" size="sm" onClick={() => handleCancelAppointment(a.id)} aria-label="Cancel appointment">
                                <XCircle className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-gray-400 dark:text-gray-600 italic text-sm">No upcoming appointments.</p>
                    )}
                  </div>

                  {/* APPOINTMENT HISTORY */}
                  <div className="space-y-4">
                    <h3 className="font-bold text-gray-900 dark:text-white flex items-center text-lg">
                      <History className="w-5 h-5 mr-2 text-gray-400 dark:text-gray-500" />
                      Appointment History
                    </h3>
                    {pastAppointments.length > 0 ? (
                      <div className="space-y-3">
                        {pastAppointments.map((a) => (
                          <div key={a.id} className="p-4 border border-gray-100 dark:border-gray-800 rounded-xl bg-white dark:bg-[#1a1a1a] shadow-sm flex justify-between items-start">
                            <div className="space-y-1">
                              <p className="text-sm font-semibold text-gray-900 dark:text-white">{a.description}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center">
                                <Clock className="w-3 h-3 mr-1" />
                                {new Date(a.start_time).toLocaleDateString()} at {new Date(a.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                {a.resource_name}{a.employee_name ? ` / ${a.employee_name}` : ''}
                              </p>
                            </div>
                            <Badge variant={a.status === 'completed' ? 'success' : a.status === 'canceled' ? 'danger' : 'secondary'}>
                              {a.status === 'completed' ? 'Completed' : a.status === 'canceled' ? 'Canceled' : a.status}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-gray-400 dark:text-gray-600 italic text-sm">No past appointments.</p>
                    )}
                  </div>

                  {/* AI CALL HISTORY */}
                  <div className="space-y-4">
                    <h3 className="font-bold text-gray-900 dark:text-white flex items-center text-lg">
                      <Phone className="w-5 h-5 mr-2 text-gray-400 dark:text-gray-500" />
                      AI Call History
                    </h3>
                    <div className="space-y-4">
                      {summaries.length > 0 ? summaries.map((s) => (
                        <div key={s.id} className="p-5 border border-gray-100 dark:border-gray-800 rounded-xl bg-white dark:bg-[#1a1a1a] shadow-sm">
                          <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500 mb-2">
                            <span className="font-bold text-blue-600 dark:text-blue-400 uppercase">AI Summary</span>
                            <span>{new Date(s.call_timestamp || s.created_at || '').toLocaleDateString()}</span>
                          </div>
                          <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed italic">&quot;{s.summary}&quot;</p>
                          {s.has_transcript && (
                            <p className="text-xs text-green-600 dark:text-green-400 mt-2">Transcript available</p>
                          )}
                        </div>
                      )) : (
                        <p className="text-gray-400 dark:text-gray-600 italic text-sm">No call history available.</p>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-600 italic text-center px-4 flex-col">
            <Users className="w-12 h-12 mb-4 opacity-20" />
            Select a customer or click the &quot;+&quot; button to add one.
          </div>
        )}
      </section>
    </div>
  )
}
