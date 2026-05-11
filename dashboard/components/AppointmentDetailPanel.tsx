import React, { useEffect, useMemo } from 'react';
import { formatPhone } from '../lib/phone';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { Card } from './ui/Card';
import { Badge } from './ui/Badge';
import { Modal } from './ui/Modal';
import { CustomerCombobox } from './ui/CustomerCombobox';
import { useServiceMappings } from '../lib/hooks';
import { useActiveTenantId } from '../lib/SessionContext';
import { filterEmployeesByService, filterResourcesByService } from '../lib/availability';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  Save,
  X,
  MapPin,
  Navigation,
  Copy,
  Edit,
  StickyNote,
  Trash2,
} from 'lucide-react';
import { format } from 'date-fns';
import { formatCustomerAddress } from '../lib/utils';
import { useAppointmentDetail } from '../lib/AppointmentDetailContext';
import type { Appointment } from '../lib/types';

interface AppointmentDetailPanelProps {
  customers: { id: string; name: string; phone: string; tenant_id?: string; address?: string; address_line2?: string; city?: string; state?: string; postal_code?: string }[];
  resources: { id: string; name: string }[];
  employees: { id: string; name: string; type?: string }[];
  services: { id: string; name: string; duration_minutes: number }[];
  vocab: { booking_label: string; resource_label: string; employee_label: string };
  getServiceBaseTimes: (appointment: Appointment) => { start: Date; end: Date };
  findCustomerById: (id: string) => { id: string; name: string; phone: string; address?: string; address_line2?: string; city?: string; state?: string; postal_code?: string } | undefined;
  onEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  onSave: () => void;
  onRequestUpdateConfirmation: () => void;
  onCancelUpdate: () => void;
  onConfirmUpdate: () => void;
  onCloseMobile: () => void;
}

export function AppointmentDetailPanel({
  customers,
  resources,
  employees,
  services,
  vocab,
  getServiceBaseTimes,
  findCustomerById,
  onEdit,
  onCancelEdit,
  onDelete,
  onSave,
  onRequestUpdateConfirmation,
  onCancelUpdate,
  onConfirmUpdate,
  onCloseMobile,
}: AppointmentDetailPanelProps) {
  const {
    selectedAppointment, isCreating, isEditing, showDetailOnMobile,
    saving, error, form, showConfirmModal, setForm,
  } = useAppointmentDetail()

  const onFormChange = (f: typeof form) => setForm(f)

  // Booking-alignment filter (audit P1 #4 follow-up: "system only books
  // when everything aligns"). Derive service_id from the form's free-text
  // `description` field — the panel doesn't track service_id directly,
  // matching is by name (the same convention the auto-end-time effect
  // below uses).
  const tenantId = useActiveTenantId();
  const { maps } = useServiceMappings(tenantId);
  const currentServiceId = useMemo(() => {
    if (!form.description) return null;
    const svc = services.find((s) => s.name === form.description);
    return svc ? String(svc.id) : null;
  }, [form.description, services]);
  const eligibleEmployees = useMemo(
    () => filterEmployeesByService(employees, currentServiceId, maps.serviceEmployee),
    [employees, currentServiceId, maps.serviceEmployee]
  );
  const eligibleResources = useMemo(
    () => filterResourcesByService(resources, currentServiceId, maps.serviceResource),
    [resources, currentServiceId, maps.serviceResource]
  );
  const noEligibleEmployees = !!currentServiceId && eligibleEmployees.length === 0;
  const noEligibleResources = !!currentServiceId && eligibleResources.length === 0;
  const alignmentBlocked = noEligibleEmployees || noEligibleResources;

  // Auto-clear stale resource/employee selections when the chosen service
  // narrows them out, so submitting can't carry an id that's no longer in
  // the dropdown.
  useEffect(() => {
    if (form.employee_id && !eligibleEmployees.some((e) => String(e.id) === form.employee_id)) {
      setForm((prev) => ({ ...prev, employee_id: '' }));
    }
    if (form.resource_id && !eligibleResources.some((r) => r.id === form.resource_id)) {
      setForm((prev) => ({ ...prev, resource_id: '' }));
    }
  }, [eligibleEmployees, eligibleResources, form.employee_id, form.resource_id, setForm]);

  // Auto-calculate end time when service or start time changes
  useEffect(() => {
    if (!form.description || !form.start_time) return;
    const svc = services.find(s => s.name === form.description);
    if (svc && svc.duration_minutes) {
      const start = new Date(form.start_time);
      if (isNaN(start.getTime())) return;
      const end = new Date(start.getTime() + svc.duration_minutes * 60000);
      const offset = end.getTimezoneOffset() * 60000;
      const endStr = new Date(end.getTime() - offset).toISOString().slice(0, 16);
      if (form.end_time !== endStr) {
        setForm(prev => ({ ...prev, end_time: endStr }));
      }
    }
  }, [form.description, form.start_time, services, form.end_time, setForm]);

  return (
    <section className={`flex-1 flex flex-col overflow-y-auto fixed inset-0 z-20 md:relative md:z-0 ${(showDetailOnMobile || isCreating) ? 'flex' : 'hidden md:flex'}`} style={{ backgroundColor: 'var(--bg-surface)' }}>
      {(selectedAppointment || isCreating) ? (
        <>
          <header className="p-4 md:p-8 sticky top-0 z-10 shadow-sm flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-soft)', backgroundColor: 'var(--bg-surface)' }}>
            <div className="flex items-start">
              <button onClick={onCloseMobile} className="md:hidden p-2 -ml-2 mr-2" style={{ color: 'var(--accent-soft)' }}><ChevronLeft className="w-6 h-6" /></button>
              <div>
                  <h1 className="text-2xl md:text-3xl font-display">
                      {isCreating ? `New ${vocab.booking_label}` : (isEditing ? `Edit ${vocab.booking_label}` : selectedAppointment?.description)}
                  </h1>
                    {selectedAppointment?.status === 'canceled' && (
                      <Badge variant="danger">Canceled</Badge>
                    )}
              </div>
            </div>
            <div className="flex items-center space-x-2">
              {!isEditing && !isCreating ? (
                <>
                  <Button variant="danger" size="sm" onClick={onDelete} title="Cancel this appointment">
                    <Trash2 className="w-4 h-4 mr-1" /> Cancel Appointment
                  </Button>
                  {selectedAppointment?.status === 'scheduled' && (
                    <Button
                      variant="secondary"
                      onClick={onEdit}
                    >
                      <Edit className="w-4 h-4 mr-2" /> Edit Details
                    </Button>
                  )}
                </>
              ) : (
                  <Button variant="ghost" onClick={onCancelEdit}>
                    <X className="w-6 h-6" />
                  </Button>
              )}
            </div>
          </header>

          <div className="p-4 md:p-8 space-y-8">
              {error && (
                  <div className="p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-400 rounded-xl text-sm font-medium">
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
                                      onChange={e => onFormChange({...form, location: e.target.value})}
                                      placeholder="Business address or mobile location"
                                  />
                                  <div className="grid grid-cols-2 gap-4">
                                      <Input
                                          type="datetime-local"
                                          label="Start Time"
                                          step="900"
                                          value={form.start_time}
                                          onChange={e => onFormChange({...form, start_time: e.target.value})}
                                      />
                                      <Input
                                          type="datetime-local"
                                          label="End Time"
                                          step="900"
                                          value={form.end_time}
                                          onChange={e => onFormChange({...form, end_time: e.target.value})}
                                      />
                                  </div>
                              </div>
                          </Card>

                          <Card title="Customer Details">
                              <div className="space-y-4">
                                  {isCreating ? (
                                      <CustomerCombobox
                                          label="Select Customer"
                                          customers={customers}
                                          value={form.customer_id}
                                          onChange={(newCustomerId) => {
                                              const customer = findCustomerById(newCustomerId)
                                              const suggestedLocation = formatCustomerAddress(customer)
                                              onFormChange({
                                                  ...form,
                                                  customer_id: newCustomerId,
                                                  location: form.location || suggestedLocation,
                                              })
                                          }}
                                          selectTestId="appointment-customer-select"
                                          searchTestId="appointment-customer-search"
                                      />
                                  ) : (
                                      <div className="grid grid-cols-2 gap-4">
                                          <Input label="First Name" value={form.customer_first_name} onChange={e => onFormChange({...form, customer_first_name: e.target.value})} />
                                          <Input label="Last Name" value={form.customer_last_name} onChange={e => onFormChange({...form, customer_last_name: e.target.value})} />
                                      </div>
                                  )}
                                  <Input label="Phone Number" value={form.customer_phone} onChange={e => onFormChange({...form, customer_phone: e.target.value})} />
                                  <div className="grid grid-cols-2 gap-4">
                                      <Select
                                          label={vocab.resource_label}
                                          value={form.resource_id}
                                          onChange={e => onFormChange({...form, resource_id: e.target.value})}
                                          options={eligibleResources.map(r => ({ label: r.name, value: r.id }))}
                                      />
                                      <Select
                                          label={`${vocab.employee_label} Assigned`}
                                          value={form.employee_id}
                                          onChange={e => onFormChange({...form, employee_id: e.target.value})}
                                          options={[
                                            { label: 'Unassigned', value: '' },
                                            ...eligibleEmployees.map(e => ({ label: `${e.name} ${e.type === 'user' ? '(Owner)' : ''}`, value: e.id.toString() }))
                                          ]}
                                      />
                                  </div>
                                  {alignmentBlocked && (
                                      <div
                                          className="p-3 text-sm rounded-lg border"
                                          style={{
                                              color: 'var(--warning, #eab308)',
                                              background: 'var(--warning-muted, rgba(234,179,8,0.10))',
                                              borderColor: 'var(--warning-muted, rgba(234,179,8,0.3))',
                                          }}
                                          role="status"
                                          data-testid="appointment-alignment-blocked"
                                      >
                                          {noEligibleEmployees && noEligibleResources
                                              ? `No qualified ${vocab.employee_label.toLowerCase()} or ${vocab.resource_label.toLowerCase()} configured for this service. Assign one in Back Office → Service Assignments first.`
                                              : noEligibleEmployees
                                                  ? `No ${vocab.employee_label.toLowerCase()} is configured to perform this service. Assign one in Back Office → Service Assignments first.`
                                                  : `No ${vocab.resource_label.toLowerCase()} is configured for this service. Assign one in Back Office → Service Assignments first.`}
                                      </div>
                                  )}
                                  <div>
                                      <label className="block text-xs font-bold uppercase mb-1" style={{ color: 'var(--text-muted)' }}>Internal Notes</label>
                                      <textarea rows={2} value={form.customer_notes} onChange={e => onFormChange({...form, customer_notes: e.target.value})} className="w-full p-2.5 rounded-lg outline-none text-sm italic" style={{ backgroundColor: 'var(--bg-raised)', border: '1px solid var(--border-soft)', color: 'var(--text-primary)' }} placeholder="Private notes..." />
                                  </div>
                              </div>
                          </Card>
                      </div>

                      <div className="space-y-6">
                          <Card title="Summary" variant="dark">
                              <div className="space-y-4">
                                  <Select
                                      label="Service"
                                      value={form.description}
                                      onChange={e => onFormChange({...form, description: e.target.value})}
                                      options={[
                                        { label: 'Walk-in (no service)', value: '' },
                                        ...services.map(s => ({ label: `${s.name} (${s.duration_minutes}min)`, value: s.name })),
                                      ]}
                                  />
                              </div>
                          </Card>

                          <div className="flex flex-col md:flex-row space-y-3 md:space-y-0 md:space-x-3 pt-6">
                              <Button variant="secondary" className="px-8 py-3" onClick={onCancelEdit}>
                                  Discard
                              </Button>
                              <Button
                                  className="flex-1 py-3"
                                  onClick={isCreating ? onSave : onRequestUpdateConfirmation}
                                  isLoading={saving}
                                  disabled={alignmentBlocked}
                                  data-testid="update-appointment-btn"
                              >
                                  {!saving && <Save className="w-5 h-5 mr-2" />}
                                  {isCreating ? `Create ${vocab.booking_label}` : `Update ${vocab.booking_label}`}
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
                                                const { start, end } = getServiceBaseTimes(selectedAppointment as Appointment)
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
                                  <div className="flex justify-between items-center pb-2" style={{ borderBottom: '1px solid var(--border-soft)' }}>
                                      <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Name</span>
                                      <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{selectedAppointment?.customers?.name}</span>
                                  </div>
                                  <div className="flex justify-between items-center pb-2" style={{ borderBottom: '1px solid var(--border-soft)' }}>
                                      <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Phone</span>
                                      <a
                                        href={`tel:${selectedAppointment?.customers?.phone}`}
                                        className="font-bold underline"
                                        style={{ color: 'var(--accent-soft)' }}
                                      >
                                        {formatPhone(selectedAppointment?.customers?.phone)}
                                      </a>
                                  </div>
                                  <div className="flex justify-between items-center pb-2" style={{ borderBottom: '1px solid var(--border-soft)' }}>
                                      <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{vocab.resource_label}</span>
                                      <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{
                                        resources.find(r => r.id === selectedAppointment?.resource_id)?.name || 'Unknown'
                                      }</span>
                                  </div>
                                  <div className="flex justify-between items-center">
                                      <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{`${vocab.employee_label} Assigned`}</span>
                                      <span className="font-bold" style={{ color: 'var(--text-primary)' }}>
                                        {employees.find(e => e.id.toString() === selectedAppointment?.employee_id?.toString())?.name || 'Unassigned'}
                                      </span>
                                  </div>
                                  {!!selectedAppointment?.customers?.metadata?.notes && (
                                      <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border-soft)' }}>
                                          <p className="text-[10px] font-bold uppercase tracking-widest mb-1 flex items-center" style={{ color: 'var(--text-muted)' }}>
                                              <StickyNote className="w-3 h-3 mr-1" /> Customer Notes
                                          </p>
                                          <p className="text-sm italic leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                                              {String(selectedAppointment!.customers?.metadata?.notes || '')}
                                          </p>
                                      </div>
                                  )}
                              </div>
                          </Card>
                      </div>
                      <Card title="Summary" variant="dark">
                          <p className="text-lg leading-relaxed font-medium italic">
                              {`This appointment for ${selectedAppointment?.customers?.name} was scheduled for ${selectedAppointment?.description.toLowerCase()}. The AI has verified availability for ${resources.find(r => r.id === selectedAppointment?.resource_id)?.name || 'Unknown'}${employees.find(e => e.id.toString() === selectedAppointment?.employee_id?.toString()) ? ` and assigned to ${employees.find(e => e.id.toString() === selectedAppointment?.employee_id?.toString())?.name}` : ''}.`}
                          </p>
                      </Card>
                  </div>
              )}
          </div>
          <Modal
            isOpen={showConfirmModal && !isCreating}
            onClose={onCancelUpdate}
            title="Make this change permanent?"
            footer={
              <>
                <Button variant="secondary" onClick={onCancelUpdate}>Keep Original</Button>
                <Button onClick={onConfirmUpdate} data-testid="save-changes-btn">Save Changes</Button>
              </>
            }
          >
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Save these changes to the appointment, or keep the original details.
            </p>
          </Modal>
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center italic flex-col" style={{ color: 'var(--text-muted)' }}>
          <CalendarIcon className="w-12 h-12 mb-4 opacity-20" />
          {`Select ${vocab.booking_label === 'Appointment' ? 'an' : 'a'} ${vocab.booking_label.toLowerCase()} or click "+" to book one manually.`}
        </div>
      )}
    </section>
  );
}
