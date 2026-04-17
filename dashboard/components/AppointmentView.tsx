import React, { useEffect, useMemo, useState } from 'react';
import { Api, SUPER_ADMIN_TENANT_ID } from '../lib/api';
import { formatPhone } from '../lib/phone';
import { Appointment } from '../lib/types';
import { MOCK_APPOINTMENTS } from '../lib/mockData';
import { toLocalISO, toISOStringWithOffset, formatCustomerAddress, splitFullName } from '../lib/utils';
import { useStaticData } from '../lib/hooks'
import { useActiveTenantId } from '../lib/SessionContext';
import { useVocabulary } from '@/lib/VocabularyContext';
import {
  Calendar as BigCalendar,
  dateFnsLocalizer,
  View as CalendarViewType
} from 'react-big-calendar'
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop'

import { format } from 'date-fns'
import { enUS } from 'date-fns/locale/en-US'
import { parse, startOfWeek, getDay } from 'date-fns'

import { AppointmentListSidebar } from './AppointmentListSidebar';
import { AppointmentDetailPanel } from './AppointmentDetailPanel';
import { AppointmentDetailProvider, useAppointmentDetail } from '../lib/AppointmentDetailContext';

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales: { 'en-US': enUS }
})

const DnDCalendar = withDragAndDrop(BigCalendar)

interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  resource_id: string;
  employee_id?: string | number | null;
  customers?: Appointment['customers'];
  resources?: Appointment['resources'];
  status: string;
  location?: string;
}

interface DnDEventArgs {
  event: CalendarEvent;
  start: Date;
  end: Date;
}

export default function AppointmentView() {
  return (
    <AppointmentDetailProvider>
      <AppointmentViewInner />
    </AppointmentDetailProvider>
  )
}

function AppointmentViewInner() {
  const tenantId = useActiveTenantId();
  const { customers, resources, employees, services } = useStaticData(tenantId);
  const vocab = useVocabulary();
  const {
    selectedAppointment, setSelectedAppointment,
    isCreating, setIsCreating,
    setIsEditing,
    showDetailOnMobile, setShowDetailOnMobile,
    setSaving,
    setError,
    form, setForm,
    setShowConfirmModal,
  } = useAppointmentDetail();

  // Appointments state
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  // Calendar events for react-big-calendar
  const calendarEvents = useMemo(() => {
    return appointments.map((a: Appointment) => ({
      id: a.id,
      title: a.description || (a.customers?.name || vocab.booking_label),
      start: new Date(a.start_time),
      end: new Date(a.end_time),
      resource_id: a.resource_id,
      employee_id: a.employee_id,
      customers: a.customers,
      resources: a.resources,
      status: a.status,
      location: a.location,
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointments, vocab.booking_label]);
    // Loading state
    const [loading, setLoading] = useState<boolean>(false);
    // Mock data state
    const [usingMockData, setUsingMockData] = useState<boolean>(false);
    // Draft event state for calendar block
    const [, setDraftEvent] = useState<{ start: Date; end: Date } | null>(null);
    // Utility function for base times
    function getServiceBaseTimes(appointment: Appointment): { start: Date; end: Date } {
      return {
        start: appointment.start_time ? new Date(appointment.start_time) : new Date(),
        end: appointment.end_time ? new Date(appointment.end_time) : new Date(),
      };
    }

  // Calendar view state
  const [calendarView, setCalendarView] = useState<CalendarViewType>('month');
  // Store original appointment for cancel/undo
  const [originalAppointment, setOriginalAppointment] = useState<Appointment | null>(null);
  // Calendar date state
  const [calendarDate, setCalendarDate] = useState<Date>(new Date());
  // Zoom: step in minutes per slot (smaller = more zoomed in)
  const ZOOM_LEVELS = [60, 30, 15, 10, 5];
  const [zoomIndex, setZoomIndex] = useState(1); // default 30min
  const calendarStep = ZOOM_LEVELS[zoomIndex];
  const calendarTimeslots = 1;
  // 24-hour day boundaries
  const calendarMin = new Date(2000, 0, 1, 0, 0, 0);
  const calendarMax = new Date(2000, 0, 1, 23, 59, 59);
  const calendarScrollTo = new Date(2000, 0, 1, 7, 0, 0);

  const findCustomerById = (id: string) => customers.find(c => c.id === id)

  useEffect(() => {
    fetchAppointments()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId])

  useEffect(() => {
    if (selectedAppointment) {
      setIsEditing(false)
      setIsCreating(false)
      const customer = selectedAppointment.customers || {} as NonNullable<Appointment['customers']>
      const customerMetadata = (customer.metadata || {}) as Record<string, string>
      const { first, last } = splitFullName(customer.name || '')
      const derivedFirst = customer.first_name || first || ''
      const derivedLast = customer.last_name || last || ''

      const baseTimes = getServiceBaseTimes(selectedAppointment as Appointment)

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

      // Hide canceled appointments from the calendar view
      setAppointments(data.filter((a: Appointment) => a.status !== 'canceled'))
      setUsingMockData(false)

      if (data.length === 0) {
        if (selectId) {
          setSelectedAppointment(null)
        } else if (!selectedAppointment) {
          setSelectedAppointment(null)
        }
      } else if (selectId) {
        const newlyCreated = data.find((a: Appointment) => a.id === selectId)
        if (newlyCreated) setSelectedAppointment(newlyCreated)
      } else if (!selectedAppointment) {
        setSelectedAppointment(data[0])
      } else {
        const updated = data.find((a: Appointment) => a.id === selectedAppointment.id)
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
          setSaving(false)
          fetchAppointments(res.appointment_id)
        } else {
            setError(res.error || 'Failed to create appointment')
            setSaving(false)
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
        setError('Connection error — could not delete appointment')
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
      setSelectedAppointment(originalAppointment as Appointment)
    }
    setError("")
    setIsEditing(false)
    setShowConfirmModal(false)
  }

  return (
    <div className="flex flex-1 overflow-hidden relative transition-colors duration-200 flex-col" style={{ color: 'var(--text-primary)' }}>
      <section className="w-full p-4 md:p-6 flex-1 overflow-auto flex flex-col" style={{ borderBottom: '1px solid var(--border-soft)', backgroundColor: 'var(--bg-surface)' }}>
        <div className="flex-1 flex flex-col">
          <div className="w-full flex-1 flex flex-col">
            {(calendarView === 'week' || calendarView === 'day') && (
              <div className="flex items-center gap-2 mb-2 justify-end">
                <span className="text-xs text-gray-400 font-medium">Zoom:</span>
                <button
                  onClick={() => setZoomIndex(i => Math.min(i + 1, ZOOM_LEVELS.length - 1))}
                  disabled={zoomIndex >= ZOOM_LEVELS.length - 1}
                  className="px-2 py-0.5 text-xs font-bold rounded disabled:opacity-30 transition-colors"
                  style={{ border: '1px solid var(--border-soft)' }}
                  title="Zoom in"
                >+</button>
                <span className="text-xs font-mono w-12 text-center" style={{ color: 'var(--text-secondary)' }}>{calendarStep}min</span>
                <button
                  onClick={() => setZoomIndex(i => Math.max(i - 1, 0))}
                  disabled={zoomIndex <= 0}
                  className="px-2 py-0.5 text-xs font-bold rounded disabled:opacity-30 transition-colors"
                  style={{ border: '1px solid var(--border-soft)' }}
                  title="Zoom out"
                >{'\u2212'}</button>
              </div>
            )}
            <DnDCalendar
              localizer={localizer}
              events={calendarEvents}
              startAccessor="start"
              endAccessor="end"
              style={{ height: calendarView === 'month' ? 500 : 'calc(100vh - 200px)' }}
              view={calendarView}
              date={calendarDate}
              min={calendarMin}
              max={calendarMax}
              step={calendarStep}
              timeslots={calendarTimeslots}
              scrollToTime={calendarScrollTo}
              resizable
              draggableAccessor={() => true}
              onView={(view: CalendarViewType) => setCalendarView(view)}
              onNavigate={(date: Date) => setCalendarDate(date)}
              onSelectEvent={(event: CalendarEvent) => {
                setSelectedAppointment(appointments.find(a => a.id === event.id) || null)
                setShowDetailOnMobile(true)
                setIsCreating(false)
                setCalendarDate(new Date(event.start))
              }}
              onEventDrop={({ event, start, end }: DnDEventArgs) => {
                const apt = appointments.find(a => a.id === event.id)
                if (!apt) return
                setOriginalAppointment(apt as Appointment)
                const startIso = (start as Date).toISOString()
                const endIso = (end as Date).toISOString()

                setAppointments(prev => prev.map(a => a.id === apt.id ? { ...a, start_time: startIso, end_time: endIso } : a))
                setSelectedAppointment({ ...apt, start_time: startIso, end_time: endIso } as Appointment)
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
              onEventResize={({ event, start, end }: DnDEventArgs) => {
                const apt = appointments.find(a => a.id === event.id)
                if (!apt) return
                setOriginalAppointment(apt as Appointment)
                const startIso = (start as Date).toISOString()
                const endIso = (end as Date).toISOString()

                setAppointments(prev => prev.map(a => a.id === apt.id ? { ...a, start_time: startIso, end_time: endIso } : a))
                setSelectedAppointment({ ...apt, start_time: startIso, end_time: endIso } as Appointment)
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
              eventPropGetter={(event: CalendarEvent) => {
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
        <AppointmentListSidebar
          appointments={appointments}
          selectedAppointment={selectedAppointment}
          loading={loading}
          usingMockData={usingMockData}
          showDetailOnMobile={showDetailOnMobile}
          bookingLabel={vocab.booking_label}
          onSelectAppointment={(apt) => {
            setSelectedAppointment(apt)
            setShowDetailOnMobile(true)
            setIsCreating(false)
            setCalendarDate(new Date(apt.start_time))
          }}
          onRefresh={() => fetchAppointments()}
          onStartNew={startNewAppointment}
          getServiceBaseTimes={getServiceBaseTimes}
        />

        <AppointmentDetailPanel
          customers={customers}
          resources={resources}
          employees={employees}
          services={services}
          vocab={vocab}
          getServiceBaseTimes={getServiceBaseTimes}
          findCustomerById={findCustomerById}
          onEdit={() => {
            if (selectedAppointment) {
              setOriginalAppointment(selectedAppointment)
            }
            setIsEditing(true)
          }}
          onCancelEdit={() => { setIsEditing(false); setIsCreating(false); setDraftEvent(null) }}
          onDelete={handleDelete}
          onSave={handleCreate}
          onRequestUpdateConfirmation={requestUpdateConfirmation}
          onCancelUpdate={cancelUpdate}
          onConfirmUpdate={handleUpdate}
          onCloseMobile={() => { setShowDetailOnMobile(false); setIsCreating(false); }}
        />
      </div>
    </div>
  )
}
