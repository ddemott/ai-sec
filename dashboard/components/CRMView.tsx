'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { Customer } from '@/lib/types'
import { MOCK_CUSTOMERS, MOCK_SUMMARIES } from '@/lib/mockData'
import {
  Search,
  RefreshCw,
  ChevronRight,
  UserPlus,
} from 'lucide-react'
import { Api } from '../lib/api'
import { detectTimezone } from '../lib/constants'
import { formatPhone } from '../lib/phone'
import { splitFullName } from '../lib/utils'
import { useActiveTenantId } from '../lib/SessionContext'
import { Button } from './ui/Button'
import { CustomerDetailPanel } from './CustomerDetailPanel'

export default function CRMView() {
  const tenantId = useActiveTenantId();
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
    <div className="flex flex-1 overflow-hidden relative transition-colors duration-200" style={{ color: 'var(--text-primary)' }}>
      {/* ITEM LIST PANE */}
      <section className={`w-full md:w-80 flex flex-col ${showDetailOnMobile ? 'hidden md:flex' : 'flex'}`} style={{ backgroundColor: 'var(--bg-raised)', borderRight: '1px solid var(--border-soft)' }}>
        <header className="p-4 sticky top-0 z-10" style={{ borderBottom: '1px solid var(--border-soft)', backgroundColor: 'var(--bg-surface)' }}>
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
            <Search className="w-4 h-4 absolute left-3 top-2.5" style={{ color: 'var(--text-muted)' }} />
            <input type="text" placeholder="Search customers..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-9 pr-4 py-2 border-none rounded-md text-sm outline-none" style={{ backgroundColor: 'var(--bg-raised)', color: 'var(--text-primary)' }} />
          </div>
        </header>
        <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
          {filteredCustomers.map((c) => (
            <div
              key={c.id}
              onClick={() => { setSelectedCustomer(c); setIsCreating(false); setShowDetailOnMobile(true); }}
              className={`p-4 cursor-pointer transition flex justify-between items-center
                ${selectedCustomer?.id === c.id ? 'border-l-4' : ''}`}
              style={{
                borderBottom: '1px solid var(--border-soft)',
                ...(selectedCustomer?.id === c.id
                  ? { backgroundColor: 'var(--bg-surface)', borderLeftColor: 'var(--accent)' }
                  : {})
              }}
            >
              <div>
                <p className="text-sm font-semibold" style={{ color: selectedCustomer?.id === c.id ? 'var(--accent-soft)' : 'var(--text-primary)' }}>{c.name || 'Unknown'}</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{formatPhone(c.phone)}</p>
              </div>
              <ChevronRight className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            </div>
          ))}
        </div>
      </section>

      {/* DETAIL PANE */}
      <CustomerDetailPanel
        selectedCustomer={selectedCustomer}
        isCreating={isCreating}
        isEditing={isEditing}
        saving={saving}
        showDetailOnMobile={showDetailOnMobile}
        editForm={editForm}
        summaries={summaries}
        upcomingAppointments={upcomingAppointments}
        pastAppointments={pastAppointments}
        onEditFormChange={handleEditFormChange}
        onEdit={() => setIsEditing(true)}
        onCancelEdit={() => { setIsEditing(false); setIsCreating(false); }}
        onSave={handleSave}
        onCreate={handleCreate}
        onDelete={handleDelete}
        onCancelAppointment={handleCancelAppointment}
        onCloseMobile={() => { setShowDetailOnMobile(false); setIsCreating(false); }}
      />
    </div>
  )
}
