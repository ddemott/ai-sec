'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { API_BASE_URL } from '../lib/api'
import { formatPhone, normalizePhone } from '../lib/phone'
import { Appointment, Customer } from '@/lib/types'
import { MOCK_APPOINTMENTS } from '@/lib/mockData'
import { 
  Calendar as CalendarIcon, 
  RefreshCw, 
  ChevronRight, 
  ChevronLeft,
  Clock, 
  Phone, 
  User,
  Search,
  CalendarClock,
  Save,
  X,
  MapPin,
  Navigation,
  Copy,
  Edit,
  Loader2,
  StickyNote,
  Trash2,
  Plus
} from 'lucide-react'
import {
  Calendar as BigCalendar,
  dateFnsLocalizer,
  View as CalendarViewType
} from 'react-big-calendar'
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop'
import { format, parse, startOfWeek, getDay } from 'date-fns'
import { enUS } from 'date-fns/locale'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css'

export default function AppointmentView() {
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null)
  const [originalAppointment, setOriginalAppointment] = useState<Appointment | null>(null)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [resources, setResources] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showDetailOnMobile, setShowDetailOnMobile] = useState(false)
  
  // States
  const [isEditing, setIsEditing] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [usingMockData, setUsingMockData] = useState(false)

  // Calendar state
  const [calendarView, setCalendarView] = useState<CalendarViewType>('week')
  const [calendarDate, setCalendarDate] = useState<Date>(new Date())

  const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000'

  // Helper to format date for datetime-local input without timezone shift
  const toLocalISO = (date: Date | string) => {
    const d = new Date(date)
    const offset = d.getTimezoneOffset()
    const localDate = new Date(d.getTime() - (offset * 60 * 1000))
    return localDate.toISOString().slice(0, 16)
  }

  const locales = useMemo(() => ({ 'en-US': enUS }), [])
  const localizer = useMemo(
    () =>
      dateFnsLocalizer({
        format,
        parse,
        startOfWeek,
        getDay,
        locales
      }),
    [locales]
  )

  const DnDCalendar = useMemo(() => withDragAndDrop(BigCalendar as any), [])

  const calendarEvents = useMemo(
    () =>
      appointments.map(apt => {
        const customer: any = apt.customers || {}
        const first = customer.first_name || ''
        const last = customer.last_name || ''
        const structured = `${first} ${last}`.trim()
        const title = structured || customer.name || 'Appointment'
        return {
          id: apt.id,
          title,
          start: new Date(apt.start_time),
          end: new Date(apt.end_time),
        }
      }),
    [appointments]
  )

  // Form state
  const [form, setForm] = useState({
    customer_id: '',
    resource_id: '',
    description: '',
    start_time: '',
    end_time: '',
    location: '',
    customer_first_name: '',
    customer_last_name: '',
    customer_phone: '',
    customer_notes: ''
  })

  const findCustomerById = (id: string) => customers.find(c => c.id === id) as any

  const formatCustomerAddress = (customer: any | undefined) => {
    if (!customer) return ''
    return [
      customer.address,
      customer.address_line2,
      customer.city,
      [customer.state, customer.postal_code].filter(Boolean).join(' ')
    ]
      .filter(Boolean)
      .join(', ')
  }

  useEffect(() => {
    fetchAppointments()
    fetchStaticData()
  }, [])

  useEffect(() => {
    if (selectedAppointment) {
      setIsEditing(false)
      setIsCreating(false)
      const customer: any = selectedAppointment.customers || {}
      const customerMetadata = customer.metadata || {}
      const fullName: string = customer.name || ''
      const [firstFromFull, ...restFromFull] = fullName.split(/\s+/)
      const derivedFirst = customer.first_name || firstFromFull || ''
      const derivedLast = customer.last_name || (restFromFull.join(' ') || '')

      setForm({
        customer_id: selectedAppointment.customer_id,
        resource_id: selectedAppointment.resource_id,
        description: selectedAppointment.description || '',
        start_time: toLocalISO(selectedAppointment.start_time),
        end_time: toLocalISO(selectedAppointment.end_time),
        location: selectedAppointment.location || '',
        customer_first_name: derivedFirst,
        customer_last_name: derivedLast,
        customer_phone: customer.phone || '',
        customer_notes: customerMetadata.notes || ''
      })
    }
  }, [selectedAppointment])

  async function fetchStaticData() {
    const tenantId = localStorage.getItem('tenantId')
    try {
      const [cRes, rRes] = await Promise.all([
        fetch(`${API_BASE_URL}/customers?tenant_id=${tenantId}`).then(r => r.json()),
        fetch(`${API_BASE_URL}/resources?tenant_id=${tenantId}`).then(r => r.json())
      ])
      if (Array.isArray(cRes)) setCustomers(cRes)
      if (Array.isArray(rRes)) setResources(rRes)
    } catch (e) {
      console.error('Failed to fetch customers/resources', e)
    }
  }

  async function fetchAppointments(selectId?: string) {
    setLoading(true)
    const tenantId = localStorage.getItem('tenantId')
    try {
      const res = await fetch(`${API_BASE_URL}/appointments?tenant_id=${tenantId}`)
      if (!res.ok) {
        throw new Error('Failed to fetch appointments')
      }
      const data = await res.json()

      if (!data || data.length === 0) {
        setAppointments(MOCK_APPOINTMENTS)
        setUsingMockData(true)
        if (!selectedAppointment) setSelectedAppointment(MOCK_APPOINTMENTS[0])
      } else {
        setAppointments(data)
        setUsingMockData(false)

        // If supporting data failed to load for any reason, derive
        // basic customer/resource options from the appointments we have.
        if (customers.length === 0) {
          const customerMap = new Map<string, { id: string; name: string; phone: string }>()
          data.forEach((a: any) => {
            if (a.customer_id) {
              customerMap.set(a.customer_id, {
                id: a.customer_id,
                name: a.customers?.name || 'Unknown',
                phone: a.customers?.phone || ''
              })
            }
          })
          setCustomers(Array.from(customerMap.values()) as any)
        }

        if (resources.length === 0) {
          const resourceMap = new Map<string, { id: string; name: string }>()
          data.forEach((a: any) => {
            if (a.resource_id) {
              resourceMap.set(a.resource_id, {
                id: a.resource_id,
                name: a.resources?.name || 'Resource'
              })
            }
          })
          setResources(Array.from(resourceMap.values()) as any)
        }
        
        if (selectId) {
          const newlyCreated = data.find((a: any) => a.id === selectId)
          if (newlyCreated) setSelectedAppointment(newlyCreated)
        } else if (!selectedAppointment) {
          setSelectedAppointment(data[0])
        } else {
          const updated = data.find((a: any) => a.id === selectedAppointment.id)
          if (updated) setSelectedAppointment(updated)
        }
      }
    } catch (e) {
      setAppointments(MOCK_APPOINTMENTS)
      setUsingMockData(true)
      if (!selectedAppointment) setSelectedAppointment(MOCK_APPOINTMENTS[0])
    }
    setLoading(false)
  }

  async function handleUpdate() {
    if (!selectedAppointment) return
    setShowConfirmModal(false)
    setSaving(true)
    setError(null)
    const tenantId = localStorage.getItem('tenantId')

    if (!tenantId) {
      setError('Please log in to edit appointments.')
      setSaving(false)
      return
    }

    if (usingMockData) {
      setError('Sample appointments cannot be updated. Create a real appointment after logging in.')
      setSaving(false)
      return
    }

    // Use the appointment's original tenant_id if we are SuperAdmin
    const targetTenantId = tenantId === PLATFORM_TENANT_ID 
      ? selectedAppointment.tenant_id 
      : tenantId

    try {
      const response = await fetch(`${API_BASE_URL}/appointments/${selectedAppointment.id}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: targetTenantId,
          ...form,
          customer_name: `${form.customer_first_name} ${form.customer_last_name}`.trim(),
          customer_phone: normalizePhone(form.customer_phone)
        })
      })
      const data = await response.json()
      if (response.ok && data.success) {
        setIsEditing(false)
        await fetchAppointments()
      } else {
        setError(data.error || 'Failed to update appointment')
      }
    } catch (err) {
      setError('Connection error')
    } finally {
      setSaving(false)
    }
  }

  async function handleCreate() {
    setSaving(true)
    setError(null)
    const tenantId = localStorage.getItem('tenantId')

    if (!tenantId) {
      setError('Please log in to create appointments.')
      setSaving(false)
      return
    }

    // For now, if SuperAdmin creates an appointment, we need a way to assign it
    // to a tenant. We'll default to the first customer's tenant if SuperAdmin.
    let targetTenantId = tenantId
    if (tenantId === PLATFORM_TENANT_ID) {
      const selectedCustomerObj = customers.find(c => c.id === form.customer_id)
      if (selectedCustomerObj) {
        targetTenantId = selectedCustomerObj.tenant_id
      } else {
        setError('Cannot determine target tenant for new appointment.')
        setSaving(false)
        return
      }
    }

    try {
      const res = await fetch(`${API_BASE_URL}/appointments/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tenant_id: targetTenantId,
                ...form,
                customer_phone: normalizePhone(form.customer_phone)
            })
        })
        const data = await res.json()
        if (res.ok && data.success) {
            setIsCreating(false)
            fetchAppointments(data.appointment_id)
        } else {
            setError(data.error || 'Failed to create appointment')
        }
    } catch (e) {
        setError('Connection error')
    }
    setSaving(false)
  }

  async function handleDelete() {
    if (!selectedAppointment) return
    if (!confirm('Permanently delete this appointment record?')) return
    if (usingMockData) {
      setError('Sample appointments cannot be deleted. Create a real appointment after logging in.')
      return
    }
    const tenantId = localStorage.getItem('tenantId')
    if (!tenantId) {
      setError('Please log in to delete appointments.')
      return
    }
    
    try {
      const res = await fetch(`${API_BASE_URL}/appointments/${selectedAppointment.id}`, {
            method: 'DELETE'
        })
        if (res.ok) {
            setSelectedAppointment(null)
            fetchAppointments()
        }
    } catch (e) {
        console.error(e)
    }
  }

  const startNewAppointment = () => {
    setIsCreating(true)
    setIsEditing(false)
    setSelectedAppointment(null)
    const now = new Date()
    const inOneHour = new Date(now.getTime() + 60 * 60 * 1000)
    const defaultCustomerId = customers[0]?.id || ''
    const defaultCustomer = findCustomerById(defaultCustomerId)
    const defaultLocation = formatCustomerAddress(defaultCustomer)
    setForm({
      customer_id: defaultCustomerId,
      resource_id: resources[0]?.id || '',
      description: '',
      start_time: now.toISOString().slice(0, 16),
      end_time: inOneHour.toISOString().slice(0, 16),
      location: defaultLocation,
      customer_first_name: '',
      customer_last_name: '',
      customer_phone: '',
      customer_notes: ''
    })
  }

  const requestUpdateConfirmation = () => {
    if (!selectedAppointment) return
    setShowConfirmModal(true)
  }

  const cancelUpdate = () => {
    if (originalAppointment) {
      setAppointments(prev =>
        prev.map(a => (a.id === originalAppointment.id ? originalAppointment : a))
      )
      setSelectedAppointment(originalAppointment as any)
    }
    setError(null)
    setIsEditing(false)
    setShowConfirmModal(false)
  }

  return (
    <div className="flex flex-1 overflow-hidden relative text-gray-900 dark:text-gray-100 transition-colors duration-200 flex-col">

      {/* Calendar Pane */}
      <section className="w-full border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111] p-4 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setCalendarDate(new Date())}
              className="px-3 py-1 text-xs font-semibold rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-[#222]"
            >
              Today
            </button>
            <div className="flex items-center space-x-1">
              <button
                onClick={() => setCalendarDate(prev => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() - 1))}
                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-[#222]"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setCalendarDate(prev => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 1))}
                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-[#222]"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <h2 className="text-sm md:text-lg font-semibold text-gray-800 dark:text-gray-100">
              {calendarDate.toLocaleDateString([], { month: 'long', year: 'numeric' })}
            </h2>
          </div>
          <div className="inline-flex rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden text-xs">
            {(['month', 'week', 'day'] as CalendarViewType[]).map(view => (
              <button
                key={view}
                onClick={() => setCalendarView(view)}
                className={`px-3 py-1 font-semibold capitalize ${
                  calendarView === view
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-[#111] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#222]'
                }`}
              >
                {view}
              </button>
            ))}
          </div>
        </div>
        <div className="h-[360px] md:h-[480px] border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden bg-white dark:bg-[#111]">
          <DnDCalendar
            localizer={localizer}
            events={calendarEvents}
            view={calendarView}
            onView={(view: CalendarViewType) => setCalendarView(view)}
            date={calendarDate}
            onNavigate={(date: Date) => setCalendarDate(date)}
            startAccessor="start"
            endAccessor="end"
            style={{ height: '100%', width: '100%' }}
            selectable
            resizable
            onSelectSlot={(slot: any) => {
              const start = slot.start as Date
              const end = slot.end as Date
              const startIso = toLocalISO(start)
              const endIso = toLocalISO(end)

              // Always treat clicking an empty slot as starting a NEW appointment.
              // Updating/rescheduling existing appointments is handled via the
              // Modify button or by dragging/resizing events, so users don't
              // accidentally overwrite an existing booking when they meant to
              // create a fresh one.
              setSelectedAppointment(null)
              setIsCreating(true)
              setIsEditing(false)
              const defaultCustomerId = customers[0]?.id || ''
              const defaultCustomer = findCustomerById(defaultCustomerId)
              const defaultLocation = formatCustomerAddress(defaultCustomer)
              const defaultResourceId = resources[0]?.id || ''
              setForm({
                customer_id: defaultCustomerId,
                resource_id: defaultResourceId,
                description: '',
                start_time: startIso,
                end_time: endIso,
                location: defaultLocation,
                customer_first_name: '',
                customer_last_name: '',
                customer_phone: '',
                customer_notes: ''
              })
              setShowDetailOnMobile(true)
            }}
            onSelectEvent={(event: any) => {
              const apt = appointments.find(a => a.id === event.id)
              if (apt) {
                setSelectedAppointment(apt)
                setOriginalAppointment(apt) // Set originalAppointment when selecting an appointment
                setShowDetailOnMobile(true)
                setIsCreating(false)
              }
            }}
            onEventDrop={({ event, start, end }: any) => {
              const apt = appointments.find(a => a.id === event.id)
              if (!apt) return

              setOriginalAppointment(apt as any) // Set originalAppointment when dragging an event

              const startIso = (start as Date).toISOString()
              const endIso = (end as Date).toISOString()

              // Update local calendar state for immediate feedback
              setAppointments(prev => prev.map(a => a.id === apt.id ? { ...a, start_time: startIso, end_time: endIso } : a))

              // Open edit form with new times; user still confirms via Save
              setSelectedAppointment({ ...apt, start_time: startIso, end_time: endIso } as any)
              setIsEditing(true)
              setIsCreating(false)
              setShowDetailOnMobile(true)
              setForm(prev => ({
                ...prev,
                start_time: toLocalISO(start),
                end_time: toLocalISO(end)
              }))
            }}
            onEventResize={({ event, start, end }: any) => {
              const apt = appointments.find(a => a.id === event.id)
              if (!apt) return

              setOriginalAppointment(apt as any) // Set originalAppointment when resizing an event

              const startIso = (start as Date).toISOString()
              const endIso = (end as Date).toISOString()

              setAppointments(prev => prev.map(a => a.id === apt.id ? { ...a, start_time: startIso, end_time: endIso } : a))

              setSelectedAppointment({ ...apt, start_time: startIso, end_time: endIso } as any)
              setIsEditing(true)
              setIsCreating(false)
              setShowDetailOnMobile(true)
              setForm(prev => ({
                ...prev,
                start_time: toLocalISO(start),
                end_time: toLocalISO(end)
              }))
            }}
            eventPropGetter={(event: any) => {
              const isSelected = selectedAppointment && event.id === selectedAppointment.id
              return {
                style: {
                  backgroundColor: isSelected ? '#2563eb' : '#3b82f6',
                  borderRadius: '4px',
                  border: 'none',
                  color: 'white',
                },
              }
            }}
          />
        </div>
      </section>

      <div className="flex flex-1 overflow-hidden relative">

      {/* List Pane */}
      <section className={`w-full md:w-80 flex flex-col bg-gray-50 dark:bg-[#1a1a1a] border-r border-gray-200 dark:border-gray-800 ${showDetailOnMobile ? 'hidden md:flex' : 'flex'}`}>
        <header className="p-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1a1a1a] sticky top-0 z-10">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-bold">Appointments</h2>
            <div className="flex space-x-1">
                <button onClick={startNewAppointment} title="Add Appointment" className="p-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700">
                    <Plus className="w-4 h-4" />
                </button>
                <button onClick={fetchAppointments} className="p-1.5 hover:bg-gray-100 dark:hover:bg-[#333] rounded text-gray-500 dark:text-gray-400">
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400 dark:text-gray-500" />
            <input type="text" placeholder="Search bookings..." className="w-full pl-9 pr-4 py-2 bg-gray-100 dark:bg-[#222] border-none rounded-md text-sm outline-none dark:text-gray-200" />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
          {appointments.map((apt) => (
            <div 
              key={apt.id}
              onClick={() => { setSelectedAppointment(apt); setShowDetailOnMobile(true); setIsCreating(false); }}
              className={`p-4 border-b border-gray-100 dark:border-gray-800 cursor-pointer transition flex justify-between items-start
                ${selectedAppointment?.id === apt.id ? 'bg-white dark:bg-[#2a2a2a] border-l-4 border-l-blue-600 dark:border-l-blue-400 shadow-sm' : 'hover:bg-gray-100 dark:hover:bg-[#222]'}`}
            >
              <div>
                <p className={`text-sm font-semibold ${selectedAppointment?.id === apt.id ? 'text-blue-600 dark:text-blue-400' : 'text-gray-900 dark:text-gray-100'}`}>
                  {apt.customers?.name || 'Unknown'}
                </p>
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-tighter mt-1 truncate max-w-[180px]">
                  {apt.description}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {new Date(apt.start_time).toLocaleDateString([], { month: 'short', day: 'numeric' })} at {new Date(apt.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 mt-1" />
            </div>
          ))}
        </div>
      </section>

      {/* Detail Pane */}
      <section className={`flex-1 flex flex-col bg-white dark:bg-[#111] overflow-y-auto fixed inset-0 z-20 md:relative md:z-0 ${(showDetailOnMobile || isCreating) ? 'flex' : 'hidden md:flex'}`}>
        {(selectedAppointment || isCreating) ? (
          <>
            <header className="p-4 md:p-8 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-[#111] sticky top-0 z-10 shadow-sm flex items-center justify-between">
              <div className="flex items-start">
                <button onClick={() => { setShowDetailOnMobile(false); setIsCreating(false); }} className="md:hidden p-2 -ml-2 mr-2 text-blue-600 dark:text-blue-400"><ChevronLeft className="w-6 h-6" /></button>
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">
                        {isCreating ? 'New Appointment' : (isEditing ? 'Edit Appointment' : selectedAppointment?.description)}
                    </h1>
                    {selectedAppointment?.status === 'canceled' && (
                        <span className="bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400 px-2 py-0.5 rounded text-xs font-bold uppercase tracking-widest mt-1 inline-block">Canceled</span>
                    )}
                </div>
              </div>
              <div className="flex items-center space-x-2">
                {!isEditing && !isCreating ? (
                  <>
                    <button onClick={handleDelete} className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-lg transition" title="Delete record"><Trash2 className="w-5 h-5" /></button>
                    {selectedAppointment?.status === 'scheduled' && (
                      <button
                        onClick={() => {
                        if (selectedAppointment) {
                          setOriginalAppointment(selectedAppointment)
                        }
                        setIsEditing(true)
                        }}
                        className="flex items-center px-4 py-2 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition font-bold text-sm border border-blue-200 dark:border-blue-800"
                      >
                        <Edit className="w-4 h-4 mr-2" /> Modify
                      </button>
                    )}
                  </>
                ) : (
                    <button onClick={() => { setIsEditing(false); setIsCreating(false); }} className="p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-[#333] rounded-lg"><X className="w-6 h-6" /></button>
                )}
              </div>
            </header>
            
            <div className="p-4 md:p-8 space-y-8">
                {error && (
                    <div className="p-4 bg-red-50 dark:bg-red-950/40 border border-red-100 dark:border-red-900/40 text-red-700 dark:text-red-400 rounded-xl text-sm font-medium">
                        {error}
                    </div>
                )}

                {(isEditing || isCreating) ? (
                    <div className="bg-gray-50 dark:bg-[#1a1a1a] p-6 rounded-2xl border border-gray-200 dark:border-gray-800 max-w-4xl space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-4">
                                <h3 className="font-bold text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest border-b dark:border-gray-800 pb-2">Client & Resource</h3>
                                {isCreating ? (
                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Select Customer</label>
                                            <select
                                              value={form.customer_id}
                                              onChange={e => {
                                                const newCustomerId = e.target.value
                                                const customer = findCustomerById(newCustomerId)
                                                const suggestedLocation = formatCustomerAddress(customer)
                                                setForm(prev => ({
                                                  ...prev,
                                                  customer_id: newCustomerId,
                                                  // If user hasn't typed a location yet, prefill from CRM
                                                  location: prev.location || suggestedLocation
                                                }))
                                              }}
                                              className="w-full p-2.5 bg-white dark:bg-[#222] border border-gray-300 dark:border-gray-700 rounded-lg outline-none dark:text-gray-100"
                                            >
                                                {customers.map(c => (
                                                  <option key={c.id} value={c.id}>
                                                    {c.name} ({formatPhone(c.phone)})
                                                  </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Assign Resource</label>
                                            <select value={form.resource_id} onChange={e => setForm({...form, resource_id: e.target.value})} className="w-full p-2.5 bg-white dark:bg-[#222] border border-gray-300 dark:border-gray-700 rounded-lg outline-none dark:text-gray-100">
                                                {resources.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                ) : (
                                  <>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                      <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Customer First Name</label>
                                        <input
                                          type="text"
                                          value={form.customer_first_name}
                                          onChange={e => setForm({ ...form, customer_first_name: e.target.value })}
                                          className="w-full p-2.5 bg-white dark:bg-[#222] border border-gray-300 dark:border-gray-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 dark:text-gray-100"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Customer Last Name</label>
                                        <input
                                          type="text"
                                          value={form.customer_last_name}
                                          onChange={e => setForm({ ...form, customer_last_name: e.target.value })}
                                          className="w-full p-2.5 bg-white dark:bg-[#222] border border-gray-300 dark:border-gray-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 dark:text-gray-100"
                                        />
                                      </div>
                                    </div>
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Phone Number</label>
                                      <input
                                        type="text"
                                        value={form.customer_phone}
                                        onChange={e => setForm({ ...form, customer_phone: e.target.value })}
                                        className="w-full p-2.5 bg-white dark:bg-[#222] border border-gray-300 dark:border-gray-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 dark:text-gray-100"
                                        placeholder="+1-555-010-9999"
                                      />
                                    </div>
                                  </>
                                )}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Internal Notes</label>
                                    <textarea rows={3} value={form.customer_notes} onChange={e => setForm({...form, customer_notes: e.target.value})} className="w-full p-2.5 bg-white dark:bg-[#222] border border-gray-300 dark:border-gray-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm dark:text-gray-100" placeholder="Private notes..." />
                                </div>
                            </div>
                            <div className="space-y-4">
                                <h3 className="font-bold text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest border-b dark:border-gray-800 pb-2">Appointment Details</h3>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description / Service</label>
                                    <input type="text" value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="w-full p-2.5 bg-white dark:bg-[#222] border border-gray-300 dark:border-gray-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 dark:text-gray-100" placeholder="e.g. Oil Change" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Location / Address</label>
                                    <input type="text" value={form.location} onChange={e => setForm({...form, location: e.target.value})} className="w-full p-2.5 bg-white dark:bg-[#222] border border-gray-300 dark:border-gray-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 dark:text-gray-100" placeholder="Business address or mobile location" />
                                </div>
                            </div>
                            <div className="space-y-4 col-span-full">
                                <h3 className="font-bold text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest border-b dark:border-gray-800 pb-2">Scheduling</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Start Time</label>
                                        <input type="datetime-local" value={form.start_time} onChange={e => setForm({...form, start_time: e.target.value})} className="w-full p-2.5 bg-white dark:bg-[#222] border border-gray-300 dark:border-gray-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 dark:text-gray-100" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">End Time</label>
                                        <input type="datetime-local" value={form.end_time} onChange={e => setForm({...form, end_time: e.target.value})} className="w-full p-2.5 bg-white dark:bg-[#222] border border-gray-300 dark:border-gray-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 dark:text-gray-100" />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col md:flex-row space-y-3 md:space-y-0 md:space-x-3 pt-6 border-t border-gray-200 dark:border-gray-800">
                            <button onClick={() => { setIsEditing(false); setIsCreating(false); }} className="px-8 py-3 text-gray-600 dark:text-gray-400 font-bold hover:bg-gray-100 dark:hover:bg-[#333] rounded-xl transition bg-white dark:bg-transparent border border-gray-200 dark:border-gray-800">
                                Discard
                            </button>
                            <button 
                              onClick={isCreating ? handleCreate : requestUpdateConfirmation} 
                                disabled={saving}
                                className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition shadow-lg flex items-center justify-center disabled:opacity-50"
                            >
                                {saving ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Save className="w-5 h-5 mr-2" />}
                                {isCreating ? 'Create Appointment' : 'Update Appointment'}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        <div className="space-y-6">
                            {/* DRIVE TO CARD */}
                            <div className="bg-green-50 dark:bg-green-950/20 p-6 rounded-2xl border border-green-100 dark:border-green-900/40 shadow-sm">
                                <h3 className="font-bold text-green-900 dark:text-green-400 mb-4 flex items-center text-sm uppercase tracking-widest">
                                    <Navigation className="w-4 h-4 mr-2" /> Drive To
                                </h3>
                                <div className="flex items-start justify-between">
                                    <div className="flex items-start">
                                        <MapPin className="w-5 h-5 text-green-600 dark:text-green-500 mr-3 mt-1 flex-shrink-0" />
                                        <p className="text-lg font-bold text-green-900 dark:text-green-100 leading-tight">
                                            {selectedAppointment?.location || 'No address provided'}
                                        </p>
                                    </div>
                                    <button 
                                        onClick={() => navigator.clipboard.writeText(selectedAppointment?.location || '')}
                                        className="p-2 hover:bg-green-100 dark:hover:bg-green-900/40 rounded-lg text-green-700 dark:text-green-400"
                                        title="Copy Address"
                                    >
                                        <Copy className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>

                            <div className="bg-white dark:bg-[#1a1a1a] p-6 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
                                <h3 className="font-bold text-gray-900 dark:text-gray-100 mb-4 flex items-center text-sm uppercase tracking-widest text-gray-400 dark:text-gray-500">Customer Details</h3>
                                <div className="space-y-4">
                                    <div className="flex justify-between items-center pb-2 border-b border-gray-50 dark:border-gray-800">
                                        <span className="text-gray-500 dark:text-gray-400 text-sm">Name</span>
                                        <span className="font-bold text-gray-900 dark:text-white">{selectedAppointment?.customers?.name}</span>
                                    </div>
                                    <div className="flex justify-between items-center pb-2 border-b border-gray-50 dark:border-gray-800">
                                        <span className="text-gray-500 dark:text-gray-400 text-sm">Phone</span>
                                        <a
                                          href={`tel:${selectedAppointment?.customers?.phone}`}
                                          className="font-bold text-blue-600 dark:text-blue-400 underline"
                                        >
                                          {formatPhone(selectedAppointment?.customers?.phone)}
                                        </a>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-gray-500 dark:text-gray-400 text-sm">Service Unit</span>
                                        <span className="font-bold text-gray-900 dark:text-white">{selectedAppointment?.resources?.name}</span>
                                    </div>
                                    {(selectedAppointment?.customers as any)?.metadata?.notes && (
                                        <div className="mt-4 pt-4 border-t border-gray-50 dark:border-gray-800">
                                            <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1 flex items-center">
                                                <StickyNote className="w-3 h-3 mr-1" /> Customer Notes
                                            </p>
                                            <p className="text-sm text-gray-600 dark:text-gray-400 italic leading-relaxed">
                                                {(selectedAppointment!.customers as any).metadata.notes}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="bg-blue-900 dark:bg-blue-950 p-6 rounded-2xl text-white shadow-xl h-fit border dark:border-gray-800">
                            <h3 className="font-bold mb-4 flex items-center text-blue-200 dark:text-blue-400 text-sm uppercase tracking-widest">AI Secretary Summary</h3>
                            <p className="text-lg leading-relaxed font-medium italic">
                                "This appointment for {selectedAppointment?.customers?.name} was scheduled for {selectedAppointment?.description.toLowerCase()}. The AI has verified availability for {selectedAppointment?.resources?.name}."
                            </p>
                        </div>
                    </div>
                )}
            </div>
            {showConfirmModal && !isCreating && (
              <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40">
                <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 max-w-sm w-full p-6 space-y-4">
                  <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    Make this change permanent?
                  </h2>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Save these changes to the appointment, or keep the original details.
                  </p>
                  <div className="flex justify-end space-x-3 pt-2">
                    <button
                      type="button"
                      onClick={cancelUpdate}
                      className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#333] text-sm font-medium"
                    >
                      Keep Original
                    </button>
                    <button
                      type="button"
                      onClick={handleUpdate}
                      className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm font-semibold"
                    >
                      Save Changes
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-600 italic flex-col">
            <CalendarIcon className="w-12 h-12 mb-4 opacity-20" />
            Select an appointment or click "+" to book one manually.
          </div>
        )}
      </section>
      </div>
    </div>
  )
}
