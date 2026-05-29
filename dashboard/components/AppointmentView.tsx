import React, { useEffect, useMemo, useState } from 'react';
import { Api, SUPER_ADMIN_TENANT_ID } from '../lib/api';
import { formatPhone } from '../lib/phone';
import { type Appointment } from '../lib/types';
import { MOCK_APPOINTMENTS } from '../lib/mockData';
import {
  toLocalISO,
  toISOStringWithOffset,
  formatCustomerAddress,
  splitFullName,
} from '../lib/utils';
import { useStaticData } from '../lib/hooks';
import { useActiveTenantId } from '../lib/SessionContext';
import { useVocabulary } from '@/lib/VocabularyContext';
import { validateAppointmentTimeRange } from '../lib/appointmentValidation';
import {
  Calendar as BigCalendar,
  dateFnsLocalizer,
  type View as CalendarViewType,
} from 'react-big-calendar';
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop';

import { format } from 'date-fns';
import { enUS } from 'date-fns/locale/en-US';
import { parse, startOfWeek, getDay } from 'date-fns';

import { AppointmentListSidebar } from './AppointmentListSidebar';
import { AppointmentDetailPanel } from './AppointmentDetailPanel';
import { AppointmentDetailProvider, useAppointmentDetail } from '../lib/AppointmentDetailContext';
import {
  ConflictModal,
  type BookingConflict,
  type AvailableAlternative,
} from './scheduler/ConflictModal';
import { ConfirmModal } from './ui/ConfirmModal';
import { useConfirm } from '../lib/useConfirm';
import { showToast } from './ui/Toast';
import { isSlotOnFifteenMinuteGrid } from '../lib/calendarSlot';

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales: { 'en-US': enUS },
});

const DnDCalendar = withDragAndDrop(BigCalendar);

interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  resource_id: string;
  employee_id?: string | null;
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

export interface AppointmentViewProps {
  /** Optional empty-slot click handler. When provided, the BigCalendar
      becomes `selectable` and clicks/drags on empty slots fire this with
      the selected `{ start, end }` range. SchedulerView wires this to the
      Quick Book panel so booking is reachable from the Calendar sub-tab
      without hunting for the sidebar's icon-only "+" button (front-desk
      audit P1 #4). When omitted the calendar stays read-only on slots —
      the existing "+" affordance still creates appointments. */
  onSelectSlot?: (range: { start: Date; end: Date }) => void;
  /** When set on mount/change, AppointmentView pre-selects this appointment
      and enters edit mode automatically. Wired by SchedulerView so the
      AppointmentPopover's "Edit" button (visible from Resources / List /
      Staff sub-tabs) can open the same edit panel that the Calendar
      sub-tab uses. */
  initialEditAppointmentId?: string | null;
  /** Called once after `initialEditAppointmentId` has been consumed so the
      parent can clear its state and a re-render with the same id won't
      re-trigger edit mode. */
  onInitialEditConsumed?: () => void;
}

export default function AppointmentView(props: AppointmentViewProps = {}) {
  return (
    <AppointmentDetailProvider>
      <AppointmentViewInner {...props} />
    </AppointmentDetailProvider>
  );
}

function AppointmentViewInner({
  onSelectSlot,
  initialEditAppointmentId,
  onInitialEditConsumed,
}: AppointmentViewProps) {
  const tenantId = useActiveTenantId();
  const { customers, resources, employees, services } = useStaticData(tenantId);
  const vocab = useVocabulary();
  const {
    selectedAppointment,
    setSelectedAppointment,
    isCreating,
    setIsCreating,
    setIsEditing,
    showDetailOnMobile,
    setShowDetailOnMobile,
    setSaving,
    setError,
    form,
    setForm,
    setShowConfirmModal,
  } = useAppointmentDetail();

  const {
    state: cancelConfirmState,
    confirm: confirmCancel,
    close: closeCancelConfirm,
  } = useConfirm();

  // Appointments state
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  // Calendar events for react-big-calendar
  const calendarEvents = useMemo(() => {
    return appointments.map((a: Appointment) => ({
      id: a.appointment_id,
      title: a.description || a.customers?.name || vocab.booking_label,
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
  // Conflict modal — populated when /appointments/create returns 409 with
  // a `conflict` block. Lets the operator see WHICH existing appointment
  // is blocking the slot they tried to book. The `nextAvailable` array
  // is rendered as clickable alternatives in the modal; clicking one
  // pre-fills the form so the operator can submit again.
  const [conflict, setConflict] = useState<BookingConflict | null>(null);
  const [nextAvailable, setNextAvailable] = useState<AvailableAlternative[]>([]);
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

  const findCustomerById = (id: string) => customers.find((c) => c.customer_id === id);

  useEffect(() => {
    void fetchAppointments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  // Pre-select + enter edit mode when SchedulerView hands us an appointment
  // id (popover Edit button from a non-Calendar sub-tab). Waits for the
  // appointments list to be populated so we can find the row. The
  // setTimeout(0) lands setIsEditing(true) after the
  // selectedAppointment-changed effect below auto-resets it to false on the
  // setSelectedAppointment call that runs in this effect — without it, the
  // pre-edit handoff would silently drop into view-only mode.
  useEffect(() => {
    if (!initialEditAppointmentId) return;
    if (appointments.length === 0) return;
    const appt = appointments.find((a) => a.appointment_id === initialEditAppointmentId);
    if (!appt) {
      onInitialEditConsumed?.();
      return;
    }
    setSelectedAppointment(appt);
    setShowDetailOnMobile(true);
    setIsCreating(false);
    const t = setTimeout(() => {
      setIsEditing(true);
      onInitialEditConsumed?.();
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEditAppointmentId, appointments]);

  useEffect(() => {
    if (selectedAppointment) {
      setIsEditing(false);
      setIsCreating(false);
      const customer =
        selectedAppointment.customers || ({} as NonNullable<Appointment['customers']>);
      const customerMetadata = (customer.metadata || {}) as Record<string, string>;
      const { first, last } = splitFullName(customer.name || '');
      const derivedFirst = customer.first_name || first || '';
      const derivedLast = customer.last_name || last || '';

      const baseTimes = getServiceBaseTimes(selectedAppointment);

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
        customer_notes: customerMetadata.notes || '',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAppointment]);

  async function fetchAppointments(selectId?: string) {
    setLoading(true);
    try {
      if (!tenantId) {
        setAppointments(MOCK_APPOINTMENTS);
        setUsingMockData(true);
        if (!selectedAppointment) setSelectedAppointment(MOCK_APPOINTMENTS[0]);
        setLoading(false);
        return;
      }

      const data = await Api.appointments.list(tenantId);

      if (!Array.isArray(data)) {
        throw new Error('Unexpected response shape from /appointments');
      }

      // Hide canceled appointments from the calendar view
      setAppointments(data.filter((a: Appointment) => a.status !== 'canceled'));
      setUsingMockData(false);

      if (data.length === 0) {
        if (selectId) {
          setSelectedAppointment(null);
        } else if (!selectedAppointment) {
          setSelectedAppointment(null);
        }
      } else if (selectId) {
        const newlyCreated = data.find((a: Appointment) => a.appointment_id === selectId);
        if (newlyCreated) setSelectedAppointment(newlyCreated);
      } else if (!selectedAppointment) {
        setSelectedAppointment(data[0]);
      } else {
        const updated = data.find(
          (a: Appointment) => a.appointment_id === selectedAppointment.appointment_id
        );
        if (updated) setSelectedAppointment(updated);
      }
    } catch {
      setAppointments(MOCK_APPOINTMENTS);
      setUsingMockData(true);
      if (!selectedAppointment) setSelectedAppointment(MOCK_APPOINTMENTS[0]);
    }
    setLoading(false);
  }

  async function handleUpdate() {
    if (!selectedAppointment) return;
    if (!tenantId) {
      setError('Please log in to edit appointments.');
      return;
    }
    if (usingMockData) {
      setError(
        'Sample appointments cannot be updated. Create a real appointment after logging in.'
      );
      return;
    }

    const validationError = validateAppointmentTimeRange(form.start_time, form.end_time);
    if (validationError) {
      setError(validationError);
      return;
    }

    setShowConfirmModal(false);
    setSaving(true);
    setError('');

    try {
      const res = await Api.appointments.update(
        selectedAppointment.appointment_id,
        selectedAppointment.tenant_id,
        {
          ...form,
          start_time: toISOStringWithOffset(form.start_time),
          end_time: toISOStringWithOffset(form.end_time),
          resource_id: form.resource_id,
          employee_id: form.employee_id || null,
          customer_name: `${form.customer_first_name} ${form.customer_last_name}`.trim(),
          customer_phone: form.customer_phone,
        }
      );

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
    if (!tenantId) {
      setError('Please log in to create appointments.');
      return;
    }

    if (usingMockData) {
      setError(
        'You are viewing sample data only. Sign in to your business account to create appointments that persist.'
      );
      return;
    }

    const validationError = validateAppointmentTimeRange(form.start_time, form.end_time);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError('');

    let targetTenantId = tenantId;
    if (tenantId === SUPER_ADMIN_TENANT_ID) {
      const selectedCustomerObj = customers.find((c) => c.customer_id === form.customer_id);
      if (selectedCustomerObj) {
        targetTenantId = selectedCustomerObj.tenant_id;
      } else {
        setError(
          'Could not determine which business this appointment belongs to. Please pick a customer first.'
        );
        setSaving(false);
        return;
      }
    }

    // Derive service_id from form.description by matching against the
    // services list — mirrors the alignment-filter convention in
    // AppointmentDetailPanel. When provided, the booking RPC enforces
    // service_employee / service_resource mapping (or its array
    // fallback). For walk-in / unmatched descriptions, service_id is
    // omitted and the RPC takes the legacy unchecked path.
    const matchedSvc = services.find((s) => s.name === form.description);
    try {
      const res = await Api.appointments.create(targetTenantId, {
        ...form,
        start_time: toISOStringWithOffset(form.start_time),
        end_time: toISOStringWithOffset(form.end_time),
        employee_id: form.employee_id || null,
        customer_phone: form.customer_phone,
        service_id: matchedSvc ? matchedSvc.service_id : null,
      });
      if (res.success) {
        setIsCreating(false);
        setDraftEvent(null);
        setSaving(false);
        void fetchAppointments(res.appointment_id);
      } else if (res.error_code === 'TIMESLOT_OCCUPIED' && res.conflict) {
        // Overlap with an existing appointment — show the conflict modal
        // with the existing booking's details. Inline error stays empty
        // so the modal owns the messaging.
        setConflict(res.conflict);
        setNextAvailable(res.next_available ?? []);
        setError('');
        setSaving(false);
      } else {
        setError(res.error || 'Failed to create appointment');
        setSaving(false);
      }
    } catch {
      setError('Connection error');
      setSaving(false);
    }
  }

  function handleDelete() {
    if (!selectedAppointment) return;
    if (usingMockData) {
      setError(
        'Sample appointments cannot be canceled. Create a real appointment after logging in.'
      );
      return;
    }
    if (!tenantId) {
      setError('Please log in to cancel appointments.');
      return;
    }
    const appointmentId = selectedAppointment.appointment_id;
    confirmCancel({
      title: 'Cancel appointment?',
      message:
        'It will be marked canceled and the slot will free up, but the record stays for history.',
      confirmLabel: 'Cancel appointment',
      confirmVariant: 'danger',
      onConfirm: async () => {
        closeCancelConfirm();
        try {
          // Soft-cancel rather than hard-delete: the appointment row stays
          // in the DB with status='canceled' so re-clicks from a stale
          // list don't return 404, the audit trail is preserved, and the
          // row can still be referenced by reports / call summaries. The
          // backend soft-cancel route also drops the slot from synced
          // calendars + CRMs, matching what an operator expects from
          // "cancel."
          const res = await Api.appointments.cancel(appointmentId, tenantId);
          if (res.success) {
            setSelectedAppointment(null);
            void fetchAppointments();
            showToast('Appointment canceled', 'success', {
              label: 'Undo',
              onClick: () => {
                void (async () => {
                  try {
                    const r = await Api.appointments.reactivate(appointmentId, tenantId);
                    if (r.success) {
                      showToast('Appointment restored', 'success');
                      void fetchAppointments();
                    } else if (r.error_code === 'TIMESLOT_OCCUPIED') {
                      showToast(
                        'That time slot is no longer available. Book a new appointment instead.',
                        'error'
                      );
                    } else {
                      showToast(r.error || 'Could not restore appointment', 'error');
                    }
                  } catch {
                    showToast('Connection error — could not restore appointment', 'error');
                  }
                })();
              },
            });
          } else {
            setError(res.error || 'Failed to cancel appointment');
          }
        } catch (e) {
          console.error(e);
          setError('Connection error — could not cancel appointment');
        }
      },
    });
  }

  const startNewAppointment = () => {
    setIsCreating(true);
    setIsEditing(false);
    setSelectedAppointment(null);
    const now = new Date();
    const inOneHour = new Date(now.getTime() + 60 * 60 * 1000);
    const defaultCustomerId = customers[0]?.customer_id || '';
    const defaultCustomer = findCustomerById(defaultCustomerId);
    const defaultLocation = formatCustomerAddress(defaultCustomer);
    setDraftEvent({ start: now, end: inOneHour });
    setForm({
      customer_id: defaultCustomerId,
      resource_id: resources[0]?.resource_id || '',
      employee_id: employees[0]?.employee_id || '',
      description: '',
      start_time: toLocalISO(now),
      end_time: toLocalISO(inOneHour),
      location: defaultLocation,
      customer_first_name: '',
      customer_last_name: '',
      customer_phone: '',
      customer_notes: '',
    });
  };

  const requestUpdateConfirmation = () => {
    if (!selectedAppointment) return;
    setShowConfirmModal(true);
    setIsEditing(true);
  };

  // Keep the draft calendar block in sync with the form while creating
  useEffect(() => {
    if (!isCreating) return;
    if (!form.start_time || !form.end_time) return;
    const start = new Date(form.start_time);
    const end = new Date(form.end_time);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
    setDraftEvent({ start, end });
  }, [isCreating, form.start_time, form.end_time]);

  const cancelUpdate = () => {
    if (originalAppointment) {
      setAppointments((prev) =>
        prev.map((a) =>
          a.appointment_id === originalAppointment.appointment_id ? originalAppointment : a
        )
      );
      setSelectedAppointment(originalAppointment);
    }
    setError('');
    setIsEditing(false);
    setShowConfirmModal(false);
  };

  return (
    <div
      className="flex flex-1 overflow-hidden relative transition-colors duration-200 flex-col"
      style={{ color: 'var(--text-primary)' }}
    >
      <section
        className="w-full p-4 md:p-6 flex-1 overflow-auto flex flex-col"
        style={{
          borderBottom: '1px solid var(--border-soft)',
          backgroundColor: 'var(--bg-surface)',
        }}
      >
        <div className="flex-1 flex flex-col">
          <div className="w-full flex-1 flex flex-col">
            {(calendarView === 'week' || calendarView === 'day') && (
              <div className="flex items-center gap-2 mb-2 justify-end">
                <span className="text-xs text-gray-400 font-medium">Zoom:</span>
                <button
                  onClick={() => setZoomIndex((i) => Math.min(i + 1, ZOOM_LEVELS.length - 1))}
                  disabled={zoomIndex >= ZOOM_LEVELS.length - 1}
                  className="px-2 py-0.5 text-xs font-bold rounded disabled:opacity-30 transition-colors"
                  style={{ border: '1px solid var(--border-soft)' }}
                  title="Zoom in"
                >
                  +
                </button>
                <span
                  className="text-xs font-mono w-12 text-center"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {calendarStep}min
                </span>
                <button
                  onClick={() => setZoomIndex((i) => Math.max(i - 1, 0))}
                  disabled={zoomIndex <= 0}
                  className="px-2 py-0.5 text-xs font-bold rounded disabled:opacity-30 transition-colors"
                  style={{ border: '1px solid var(--border-soft)' }}
                  title="Zoom out"
                >
                  {'\u2212'}
                </button>
              </div>
            )}
            <DnDCalendar
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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
              selectable={!!onSelectSlot}
              onSelectSlot={
                onSelectSlot
                  ? ({ start, end }: { start: Date | string; end: Date | string }) => {
                      const slot = { start: new Date(start), end: new Date(end) };
                      // Front-end guard: react-big-calendar zoom levels go
                      // down to 5min, but the DB enforces a 15-min grid.
                      // Reject off-grid clicks here so the form never opens
                      // with off-grid prefill times. The backend Zod + DB
                      // CHECK + JS form validator stay as defense-in-depth
                      // for direct API hits — this guard just spares the
                      // operator the wasted form-fill round-trip.
                      if (!isSlotOnFifteenMinuteGrid(slot)) {
                        showToast(
                          'Please pick a time in 15-minute increments (:00, :15, :30, :45).',
                          'warning'
                        );
                        return;
                      }
                      onSelectSlot(slot);
                    }
                  : undefined
              }
              draggableAccessor={() => true}
              onView={(view: CalendarViewType) => setCalendarView(view)}
              onNavigate={(date: Date) => setCalendarDate(date)}
              onSelectEvent={(event: CalendarEvent) => {
                setSelectedAppointment(
                  appointments.find((a) => a.appointment_id === event.id) || null
                );
                setShowDetailOnMobile(true);
                setIsCreating(false);
                setCalendarDate(new Date(event.start));
              }}
              onEventDrop={({ event, start, end }: DnDEventArgs) => {
                const apt = appointments.find((a) => a.appointment_id === event.id);
                if (!apt) return;
                setOriginalAppointment(apt);
                const startIso = start.toISOString();
                const endIso = end.toISOString();

                setAppointments((prev) =>
                  prev.map((a) =>
                    a.appointment_id === apt.appointment_id
                      ? { ...a, start_time: startIso, end_time: endIso }
                      : a
                  )
                );
                setSelectedAppointment({
                  ...apt,
                  start_time: startIso,
                  end_time: endIso,
                } as Appointment);
                setIsEditing(true);
                setIsCreating(false);
                setShowDetailOnMobile(true);
                setForm((prev) => ({
                  ...prev,
                  start_time: toLocalISO(start),
                  end_time: toLocalISO(end),
                }));
                setShowConfirmModal(true);
              }}
              onEventResize={({ event, start, end }: DnDEventArgs) => {
                const apt = appointments.find((a) => a.appointment_id === event.id);
                if (!apt) return;
                setOriginalAppointment(apt);
                const startIso = start.toISOString();
                const endIso = end.toISOString();

                setAppointments((prev) =>
                  prev.map((a) =>
                    a.appointment_id === apt.appointment_id
                      ? { ...a, start_time: startIso, end_time: endIso }
                      : a
                  )
                );
                setSelectedAppointment({
                  ...apt,
                  start_time: startIso,
                  end_time: endIso,
                } as Appointment);
                setIsEditing(true);
                setIsCreating(false);
                setShowDetailOnMobile(true);
                setForm((prev) => ({
                  ...prev,
                  start_time: toLocalISO(start),
                  end_time: toLocalISO(end),
                }));
                setShowConfirmModal(true);
              }}
              eventPropGetter={(event: CalendarEvent) => {
                const isSelected =
                  selectedAppointment && event.id === selectedAppointment.appointment_id;
                let color = '#3b82f6';
                if (!event.resource_id) {
                  color = '#6b7280';
                }
                const overlaps = appointments.filter((a) => {
                  if (a.appointment_id === event.id) return false;
                  const aStart = new Date(a.start_time);
                  const aEnd = new Date(a.end_time);
                  const eStart = new Date(event.start);
                  const eEnd = new Date(event.end);
                  return a.resource_id === event.resource_id && aStart < eEnd && aEnd > eStart;
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
            setSelectedAppointment(apt);
            setShowDetailOnMobile(true);
            setIsCreating(false);
            setCalendarDate(new Date(apt.start_time));
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
              setOriginalAppointment(selectedAppointment);
            }
            setIsEditing(true);
          }}
          onCancelEdit={() => {
            setIsEditing(false);
            setIsCreating(false);
            setDraftEvent(null);
          }}
          onDelete={handleDelete}
          onSave={handleCreate}
          onRequestUpdateConfirmation={requestUpdateConfirmation}
          onCancelUpdate={cancelUpdate}
          onConfirmUpdate={handleUpdate}
          onCloseMobile={() => {
            setShowDetailOnMobile(false);
            setIsCreating(false);
          }}
        />
      </div>
      <ConflictModal
        isOpen={conflict !== null}
        conflict={conflict}
        nextAvailable={nextAvailable}
        onPickAlternative={(slot) => {
          // Pre-fill the form with the picked alternative slot. The
          // calendar-create flow uses `form` state — convert ISO back
          // to the datetime-local input format the form expects.
          const toLocalInputValue = (iso: string) => {
            const d = new Date(iso);
            const offset = d.getTimezoneOffset() * 60000;
            return new Date(d.getTime() - offset).toISOString().slice(0, 16);
          };
          setForm({
            ...form,
            start_time: toLocalInputValue(slot.start_time),
            end_time: toLocalInputValue(slot.end_time),
            resource_id: slot.resource_id,
            employee_id: slot.employee_id,
          });
          setConflict(null);
          setNextAvailable([]);
        }}
        onClose={() => {
          setConflict(null);
          setNextAvailable([]);
        }}
      />

      <ConfirmModal {...cancelConfirmState} onClose={closeCancelConfirm} />
    </div>
  );
}
