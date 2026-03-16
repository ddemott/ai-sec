import React, { useEffect, useMemo, useState } from 'react';
import { Api, SUPER_ADMIN_TENANT_ID } from '../lib/api';
import { formatPhone } from '../lib/phone';
import { Appointment } from '../lib/types';
import { MOCK_APPOINTMENTS } from '../lib/mockData';
import { toLocalISO, toISOStringWithOffset, formatCustomerAddress, splitFullName } from '../lib/utils';
import { useSession, useStaticData } from '../lib/hooks';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { Card } from './ui/Card';
import { Badge } from './ui/Badge';
import { Modal } from './ui/Modal';
import { 
  Calendar as CalendarIcon, 
  RefreshCw, 
  ChevronRight, 
  ChevronLeft,
  Search,
  Save,
  X,
  MapPin,
  Navigation,
  Copy,
  Edit,
  // Loader2,
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

import { format } from 'date-fns'
import { enUS } from 'date-fns/locale/en-US'
import { parse, startOfWeek, getDay } from 'date-fns'

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales: { 'en-US': enUS }
})

const DnDCalendar = withDragAndDrop(BigCalendar)

export default function AppointmentView({ overrideTenantId }: { overrideTenantId?: string | null }) {
  const { tenantId } = useSession(overrideTenantId);
  const { customers, resources, employees, refresh: refreshStaticData } = useStaticData(tenantId);

  // Appointments state
  const [appointments, setAppointments] = useState<any[]>([]);
  // Calendar events for react-big-calendar
  const calendarEvents = useMemo(() => {
    return appointments.map((a: any) => ({
      id: a.id,
      title: a.description || (a.customers?.name || 'Appointment'),
      start: new Date(a.start_time),
      end: new Date(a.end_time),
      resource_id: a.resource_id,
      employee_id: a.employee_id,
      customers: a.customers,
      resources: a.resources,
      status: a.status,
      location: a.location,
    }));
  }, [appointments]);
    // Loading state
    const [loading, setLoading] = useState<boolean>(false);
    // Mock data state
    const [usingMockData, setUsingMockData] = useState<boolean>(false);
    // Mobile detail pane state
    const [showDetailOnMobile, setShowDetailOnMobile] = useState<boolean>(false);
    // Creation/editing state
    const [isCreating, setIsCreating] = useState<boolean>(false);
    // Appointment selection state
    const [selectedAppointment, setSelectedAppointment] = useState<any>(null);
    // Draft event state for calendar block
    // const [draftEvent, setDraftEvent] = useState<{ start: Date; end: Date } | null>(null);
    // Form state
    const [form, setForm] = useState({
      customer_id: '',
      resource_id: '',
      employee_id: '' as string | number,
      description: '',
      start_time: '',
      end_time: '',
      location: '',
      customer_first_name: '',
      customer_last_name: '',
      customer_phone: '',
      customer_notes: ''
    });
    // Utility function for base times
    function getServiceBaseTimes(appointment: any): { start: Date; end: Date } {
      return {
        start: appointment.start_time ? new Date(appointment.start_time) : new Date(),
        end: appointment.end_time ? new Date(appointment.end_time) : new Date(),
      };
    }

  // Calendar view state
  const [calendarView, setCalendarView] = useState<CalendarViewType>('month');
  // Store original appointment for cancel/undo
  const [originalAppointment, setOriginalAppointment] = useState<Appointment | null>(null);
  // Track saving state for update button
  const [saving, setSaving] = useState(false);
  // Calendar date state
  const [calendarDate, setCalendarDate] = useState<Date>(new Date());
  // Editing state
  const [isEditing, setIsEditing] = useState<boolean>(false);
  // Error state
  const [error, setError] = useState<string>("");
  // Confirm modal state
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);

  const findCustomerById = (id: string) => customers.find(c => c.id === id) as any

  useEffect(() => {
    fetchAppointments()
  }, [tenantId])

  useEffect(() => {
    if (selectedAppointment) {
      setIsEditing(false)
      setIsCreating(false)
      const customer: any = selectedAppointment.customers || {}
      const customerMetadata = customer.metadata || {}
      const { first, last } = splitFullName(customer.name || '')
      const derivedFirst = customer.first_name || first || ''
      const derivedLast = customer.last_name || last || ''

      const baseTimes = getServiceBaseTimes(selectedAppointment as any)

      setForm({
        customer_id: selectedAppointment.customer_id,
        resource_id: selectedAppointment.resource_id,
        employee_id: selectedAppointment.employee_id || '',
        description: selectedAppointment.description || '',
        start_time: toLocalISO(baseTimes.start),
        end_time: toLocalISO(baseTimes.end),
        location: selectedAppointment.location || '',
        customer_first_name: derivedFirst,
        customer_last_name: derivedLast,
        customer_phone: formatPhone(customer.phone) || '',
        customer_notes: customerMetadata.notes || ''
      })
    }
  }, [selectedAppointment])

  async function fetchAppointments(selectId?: string) {
    setLoading(true)
    try {
      if (!tenantId) {
        setAppointments(MOCK_APPOINTMENTS)
        setUsingMockData(true)
        if (!selectedAppointment) setSelectedAppointment(MOCK_APPOINTMENTS[0])
        setLoading(false)
        return
      }

      const data = await Api.appointments.list(tenantId)

      if (!Array.isArray(data)) {
        throw new Error('Unexpected response shape from /appointments')
      }

      setAppointments(data)
      setUsingMockData(false)

      if (data.length === 0) {
        if (selectId) {
          setSelectedAppointment(null)
        } else if (!selectedAppointment) {
          setSelectedAppointment(null)
        }
      } else if (selectId) {
        const newlyCreated = data.find((a: any) => a.id === selectId)
        if (newlyCreated) setSelectedAppointment(newlyCreated)
      } else if (!selectedAppointment) {
        setSelectedAppointment(data[0])
      } else {
        const updated = data.find((a: any) => a.id === selectedAppointment.id)
        if (updated) setSelectedAppointment(updated)
      }
    } catch {
      setAppointments(MOCK_APPOINTMENTS)
      setUsingMockData(true)
      if (!selectedAppointment) setSelectedAppointment(MOCK_APPOINTMENTS[0])
    }
    setLoading(false)
  }

  async function handleUpdate() {
    if (!selectedAppointment) return;
    setShowConfirmModal(false);
    setSaving(true);
    setError("");
    if (!tenantId) {
      setError('Please log in to edit appointments.');
      setSaving(false);
      return;
    }
    if (usingMockData) {
      setError('Sample appointments cannot be updated. Create a real appointment after logging in.');
      setSaving(false);
      return;
    }

    try {
      const res = await Api.appointments.update(selectedAppointment.id, selectedAppointment.tenant_id, {
          ...form,
          start_time: toISOStringWithOffset(form.start_time),
          end_time: toISOStringWithOffset(form.end_time),
          resource_id: form.resource_id,
          employee_id: form.employee_id || null,
          customer_name: `${form.customer_first_name} ${form.customer_last_name}`.trim(),
          customer_phone: form.customer_phone
      });

      if (res.success) {
        setIsEditing(false);
        await fetchAppointments();
      } else {
        setError(res.error || 'Failed to update appointment');
      }
    } catch {
      setError('Connection error');
    } finally {
      setSaving(false);
    }
  }


  async function handleCreate() {
    setSaving(true)
    setError("")

    if (!tenantId) {
      setError('Please log in to create appointments.')
      setSaving(false)
      return
    }

    if (usingMockData) {
      setError('You are viewing sample data only. Please sign in to a real business tenant to create appointments that persist.')
      setSaving(false)
      return
    }

    let targetTenantId = tenantId
    if (tenantId === SUPER_ADMIN_TENANT_ID) {
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
      const res = await Api.appointments.create(targetTenantId, {
            ...form,
            start_time: toISOStringWithOffset(form.start_time),
            end_time: toISOStringWithOffset(form.end_time),
            employee_id: form.employee_id || null,
            customer_phone: form.customer_phone
        })
        if (res.success) {
          setIsCreating(false)
          setDraftEvent(null)
          fetchAppointments(res.appointment_id)
        } else {
            setError(res.error || 'Failed to create appointment')
        }
    } catch {
      setError('Connection error');
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedAppointment) return
    if (!confirm('Permanently delete this appointment record?')) return
    if (usingMockData) {
      setError('Sample appointments cannot be deleted. Create a real appointment after logging in.')
      return
    }
    if (!tenantId) {
      setError('Please log in to delete appointments.')
      return
    }
    
    try {
      const res = await Api.appointments.delete(selectedAppointment.id)
      if (res.success) {
          setSelectedAppointment(null)
          fetchAppointments()
      } else {
          setError(res.error || 'Failed to delete appointment')
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
    setDraftEvent({ start: now, end: inOneHour })
    setForm({
      customer_id: defaultCustomerId,
      resource_id: resources[0]?.id || '',
      employee_id: employees[0]?.id || '',
      description: '',
      start_time: toLocalISO(now),
      end_time: toLocalISO(inOneHour),
      location: defaultLocation,
      customer_first_name: '',
      customer_last_name: '',
      customer_phone: '',
      customer_notes: ''
    })
  }

  const requestUpdateConfirmation = () => {
    if (!selectedAppointment) return;
    setShowConfirmModal(true);
    setIsEditing(true); 
  }

  // Keep the draft calendar block in sync with the form while creating
  useEffect(() => {
    if (!isCreating) return
    if (!form.start_time || !form.end_time) return
    const start = new Date(form.start_time)
    const end = new Date(form.end_time)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return
    setDraftEvent({ start, end })
  }, [isCreating, form.start_time, form.end_time])

  const cancelUpdate = () => {
    if (originalAppointment) {
      setAppointments(prev =>
        prev.map(a => (a.id === originalAppointment.id ? originalAppointment : a))
      )
      setSelectedAppointment(originalAppointment as any)
    }
    setError("")
    setIsEditing(false)
    setShowConfirmModal(false)
  }

  return (
    <div className="flex flex-1 overflow-hidden relative text-gray-900 dark:text-gray-100 transition-colors duration-200 flex-col">
      <section className="w-full border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111] p-4 md:p-6">
        <div className="mb-4 flex flex-wrap items-center gap-4">
          <div className="w-full mt-2">
            <DnDCalendar
              localizer={localizer}
              events={calendarEvents}
              startAccessor="start"
              endAccessor="end"
              style={{ height: 500 }}
              view={calendarView}
              date={calendarDate}
              resizable
              draggableAccessor={() => true}
              onView={(view: CalendarViewType) => setCalendarView(view)}
              onNavigate={(date: Date) => setCalendarDate(date)}
              onSelectEvent={(event: any) => {
                setSelectedAppointment(appointments.find(a => a.id === event.id))
                setShowDetailOnMobile(true)
                setIsCreating(false)
                setCalendarDate(new Date(event.start))
              }}
              onEventDrop={({ event, start, end }: any) => {
                const apt = appointments.find(a => a.id === event.id)
                if (!apt) return
                setOriginalAppointment(apt as any)
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
                setShowConfirmModal(true)
              }}
              onEventResize={({ event, start, end }: any) => {
                const apt = appointments.find(a => a.id === event.id)
                if (!apt) return
                setOriginalAppointment(apt as any)
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
                setShowConfirmModal(true)
              }}
              eventPropGetter={(event: any) => {
                const isSelected = selectedAppointment && event.id === selectedAppointment.id;
                let color = '#3b82f6';
                if (!event.resource_id) {
                  color = '#6b7280';
                }
                const overlaps = appointments.filter(a => {
                  if (a.id === event.id) return false;
                  const aStart = new Date(a.start_time);
                  const aEnd = new Date(a.end_time);
                  const eStart = new Date(event.start);
                  const eEnd = new Date(event.end);
                  return a.resource_id === event.resource_id &&
                    ((aStart < eEnd && aEnd > eStart));
                });
                if (overlaps.length > 0) {
                  color = '#dc2626';
                }
                if (isSelected) {
                  color = '#2563eb';
                }
                return {
                  style: {
                    backgroundColor: color,
                    borderRadius: '4px',
                    border: 'none',
                    color: 'white',
                  },
                };
              }}
            />
          </div>
        </div>
      </section>
      
      <div className="flex flex-1 overflow-hidden relative">
        {/* List Pane */}
        <section className={`w-full md:w-80 flex flex-col bg-gray-50 dark:bg-[#1a1a1a] border-r border-gray-200 dark:border-gray-800 ${showDetailOnMobile ? 'hidden md:flex' : 'flex'}`}>
          <header className="p-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1a1a1a] sticky top-0 z-10">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold">Appointments</h2>
              <div className="flex space-x-1">
                  <Button onClick={startNewAppointment} size="sm" className="p-1.5">
                    <Plus className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => fetchAppointments()} className="p-1.5">
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                  </Button>
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
                onClick={() => {
                  setSelectedAppointment(apt)
                  setShowDetailOnMobile(true)
                  setIsCreating(false)
                  setCalendarDate(new Date(apt.start_time))
                }}
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
                    {(() => {
                      const { start } = getServiceBaseTimes(apt as any)
                      return `${format(start, 'MMM d')} at ${format(start, 'p')}`
                    })()}
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
                          <Badge variant="danger">Canceled</Badge>
                        )}
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  {!isEditing && !isCreating ? (
                    <>
                      <Button variant="danger" size="sm" onClick={handleDelete} title="Delete record">
                        <Trash2 className="w-5 h-5" />
                      </Button>
                      {selectedAppointment?.status === 'scheduled' && (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            if (selectedAppointment) {
                              setOriginalAppointment(selectedAppointment)
                            }
                            setIsEditing(true)
                          }}
                        >
                          <Edit className="w-4 h-4 mr-2" /> Modify
                        </Button>
                      )}
                    </>
                  ) : (
                      <Button variant="ghost" onClick={() => { setIsEditing(false); setIsCreating(false); setDraftEvent(null) }}>
                        <X className="w-6 h-6" />
                      </Button>
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
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                          <div className="space-y-6">
                              <Card title="Drive To" icon={<Navigation className="w-4 h-4" />} variant="success">
                                  <div className="space-y-4">
                                      <Input 
                                          label="Location / Address"
                                          value={form.location} 
                                          onChange={e => setForm({...form, location: e.target.value})} 
                                          placeholder="Business address or mobile location" 
                                      />
                                      <div className="grid grid-cols-2 gap-4">
                                          <Input 
                                              type="datetime-local" 
                                              label="Start Time"
                                              value={form.start_time} 
                                              onChange={e => setForm({...form, start_time: e.target.value})} 
                                          />
                                          <Input 
                                              type="datetime-local" 
                                              label="End Time"
                                              value={form.end_time} 
                                              onChange={e => setForm({...form, end_time: e.target.value})} 
                                          />
                                      </div>
                                  </div>
                              </Card>

                              <Card title="Customer Details">
                                  <div className="space-y-4">
                                      {isCreating ? (
                                          <Select
                                              label="Select Customer"
                                              value={form.customer_id}
                                              onChange={e => {
                                                  const newCustomerId = e.target.value
                                                  const customer = findCustomerById(newCustomerId)
                                                  const suggestedLocation = formatCustomerAddress(customer)
                                                  setForm(prev => ({
                                                      ...prev,
                                                      customer_id: newCustomerId,
                                                      location: prev.location || suggestedLocation
                                                  }))
                                              }}
                                              options={customers.map(c => ({ label: `${c.name} ${formatPhone(c.phone)}`, value: c.id }))}
                                          />
                                      ) : (
                                          <div className="grid grid-cols-2 gap-4">
                                              <Input label="First Name" value={form.customer_first_name} onChange={e => setForm({...form, customer_first_name: e.target.value})} />
                                              <Input label="Last Name" value={form.customer_last_name} onChange={e => setForm({...form, customer_last_name: e.target.value})} />
                                          </div>
                                      )}
                                      <Input label="Phone Number" value={form.customer_phone} onChange={e => setForm({...form, customer_phone: e.target.value})} />
                                      <div className="grid grid-cols-2 gap-4">
                                          <Select 
                                              label="Service Unit"
                                              value={form.resource_id} 
                                              onChange={e => setForm({...form, resource_id: e.target.value})} 
                                              options={resources.map(r => ({ label: r.name, value: r.id }))}
                                          />
                                          <Select 
                                              label="Staff Assigned"
                                              value={form.employee_id} 
                                              onChange={e => setForm({...form, employee_id: e.target.value})} 
                                              options={[
                                                { label: 'Unassigned', value: '' },
                                                ...employees.map(e => ({ label: `${e.name} ${e.type === 'user' ? '(Owner)' : ''}`, value: e.id.toString() }))
                                              ]}
                                          />
                                      </div>
                                      <div>
                                          <label className="block text-xs font-bold text-gray-400 dark:text-gray-500 uppercase mb-1">Internal Notes</label>
                                          <textarea rows={2} value={form.customer_notes} onChange={e => setForm({...form, customer_notes: e.target.value})} className="w-full p-2.5 bg-gray-50 dark:bg-[#222] border border-gray-200 dark:border-gray-800 rounded-lg outline-none text-sm italic" placeholder="Private notes..." />
                                      </div>
                                  </div>
                              </Card>
                          </div>

                          <div className="space-y-6">
                              <Card title="AI Secretary Summary" variant="dark">
                                  <div className="space-y-4">
                                      <Input 
                                          label="Description / Service"
                                          value={form.description} 
                                          onChange={e => setForm({...form, description: e.target.value})} 
                                          className="bg-blue-800 dark:bg-blue-900 border-blue-700 dark:border-blue-800 text-lg font-medium italic text-white" 
                                          placeholder="e.g. Oil Change" 
                                      />
                                      <p className="text-sm text-blue-200 dark:text-blue-400 leading-relaxed italic opacity-80">
                                          Editing this will update the core service description the AI uses for future reference.
                                      </p>
                                  </div>
                              </Card>
                              
                              <div className="flex flex-col md:flex-row space-y-3 md:space-y-0 md:space-x-3 pt-6">
                                  <Button variant="secondary" className="px-8 py-3" onClick={() => { setIsEditing(false); setIsCreating(false); setDraftEvent(null) }}>
                                      Discard
                                  </Button>
                                  <Button 
                                      className="flex-1 py-3"
                                      onClick={isCreating ? handleCreate : requestUpdateConfirmation} 
                                      isLoading={saving}
                                      data-testid="update-appointment-btn"
                                  >
                                      {!saving && <Save className="w-5 h-5 mr-2" />}
                                      {isCreating ? 'Create Appointment' : 'Update Appointment'}
                                  </Button>
                              </div>
                          </div>
                      </div>
                  ) : (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                          <div className="space-y-6">
                              <Card title="Drive To" icon={<Navigation className="w-4 h-4" />} variant="success">
                                  <div className="flex items-start justify-between">
                                      <div className="flex items-start">
                                          <MapPin className="w-5 h-5 text-green-600 dark:text-green-500 mr-3 mt-1 flex-shrink-0" />
                                          <div>
                                              <p className="text-lg font-bold text-green-900 dark:text-green-100 leading-tight">
                                                  {selectedAppointment?.location || 'No address provided'}
                                              </p>
                                              <p className="text-xs text-green-600 dark:text-green-500 mt-2 font-medium">
                                                  {(() => {
                                                    const { start, end } = getServiceBaseTimes(selectedAppointment as any)
                                                    return `${format(start, 'PPPP')} from ${format(start, 'p')} to ${format(end, 'p')}`
                                                  })()}
                                              </p>
                                          </div>
                                      </div>
                                      <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(selectedAppointment?.location || '')} title="Copy Address">
                                          <Copy className="w-4 h-4" />
                                      </Button>
                                  </div>
                              </Card>

                              <Card title="Customer Details">
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
                                      <div className="flex justify-between items-center pb-2 border-b border-gray-50 dark:border-gray-800">
                                          <span className="text-gray-500 dark:text-gray-400 text-sm">Service Unit</span>
                                          <span className="font-bold text-gray-900 dark:text-white">{
                                            resources.find(r => r.id === selectedAppointment?.resource_id)?.name || 'Unknown'
                                          }</span>
                                      </div>
                                      <div className="flex justify-between items-center">
                                          <span className="text-gray-500 dark:text-gray-400 text-sm">Staff Assigned</span>
                                          <span className="font-bold text-gray-900 dark:text-white">
                                            {employees.find(e => e.id.toString() === selectedAppointment?.employee_id?.toString())?.name || 'Unassigned'}
                                          </span>
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
                              </Card>
                          </div>
                          <Card title="AI Secretary Summary" variant="dark">
                              <p className="text-lg leading-relaxed font-medium italic">
                                  {`This appointment for ${selectedAppointment?.customers?.name} was scheduled for ${selectedAppointment?.description.toLowerCase()}. The AI has verified availability for ${resources.find(r => r.id === selectedAppointment?.resource_id)?.name || 'Unknown'}${employees.find(e => e.id.toString() === selectedAppointment?.employee_id?.toString()) ? ` and assigned to ${employees.find(e => e.id.toString() === selectedAppointment?.employee_id?.toString())?.name}` : ''}.`}
                              </p>
                          </Card>
                      </div>
                  )}
              </div>
              <Modal
                isOpen={showConfirmModal && !isCreating}
                onClose={cancelUpdate}
                title="Make this change permanent?"
                footer={
                  <>
                    <Button variant="secondary" onClick={cancelUpdate}>Keep Original</Button>
                    <Button onClick={handleUpdate} data-testid="save-changes-btn">Save Changes</Button>
                  </>
                }
              >
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Save these changes to the appointment, or keep the original details.
                </p>
              </Modal>
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
