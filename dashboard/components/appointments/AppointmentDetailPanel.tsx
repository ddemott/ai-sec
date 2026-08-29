import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { useServiceMappings } from '../../lib/hooks';
import { useActiveTenantId } from '../../lib/SessionContext';
import { filterEmployeesByService, filterResourcesByService } from '../../lib/availability';
import { Calendar as CalendarIcon } from 'lucide-react';
import { useAppointmentDetail } from '../../lib/AppointmentDetailContext';
import type { Appointment } from '../../lib/types';
import { Api } from '../../lib/api';
import { showToast } from '../ui/Toast';
import { AppointmentPanelHeader } from './AppointmentPanelHeader';
import { AppointmentEditForm } from './AppointmentEditForm';
import { AppointmentViewDisplay } from './AppointmentViewDisplay';

interface AppointmentDetailPanelProps {
  customers: {
    customer_id: string;
    name: string;
    phone: string;
    tenant_id?: string;
    address?: string;
    address_line2?: string;
    city?: string;
    state?: string;
    postal_code?: string;
  }[];
  resources: { resource_id: string; name: string }[];
  employees: { employee_id: string; name: string; type?: string }[];
  services: { service_id: string; name: string; duration_minutes: number }[];
  vocab: { booking_label: string; resource_label: string; employee_label: string };
  getServiceBaseTimes: (appointment: Appointment) => { start: Date; end: Date };
  findCustomerById: (id: string) =>
    | {
        customer_id: string;
        name: string;
        phone: string;
        address?: string;
        address_line2?: string;
        city?: string;
        state?: string;
        postal_code?: string;
      }
    | undefined;
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
    selectedAppointment,
    isCreating,
    isEditing,
    showDetailOnMobile,
    saving,
    error,
    form,
    showConfirmModal,
    setForm,
  } = useAppointmentDetail();

  const onFormChange = (f: typeof form) => setForm(f);

  const tenantId = useActiveTenantId();
  const [isSendingLinks, setIsSendingLinks] = useState(false);

  const handleSendLinks = async () => {
    if (!selectedAppointment) return;
    setIsSendingLinks(true);
    try {
      const res = await Api.appointments.sendSelfServiceLinks(
        selectedAppointment.appointment_id,
        tenantId
      );
      if (res.success) {
        showToast(res.message ?? 'Cancel/reschedule links sent.', 'success');
      } else {
        showToast(res.error ?? 'Failed to send links.', 'error');
      }
    } catch {
      showToast('Failed to send links — check your connection.', 'error');
    } finally {
      setIsSendingLinks(false);
    }
  };

  const { maps } = useServiceMappings(tenantId);
  const currentServiceId = useMemo(() => {
    if (!form.description) return null;
    const svc = services.find((s) => s.name === form.description);
    return svc ? String(svc.service_id) : null;
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
    if (
      form.employee_id &&
      !eligibleEmployees.some((e) => String(e.employee_id) === form.employee_id)
    ) {
      setForm((prev) => ({ ...prev, employee_id: '' }));
    }
    if (form.resource_id && !eligibleResources.some((r) => r.resource_id === form.resource_id)) {
      setForm((prev) => ({ ...prev, resource_id: '' }));
    }
  }, [eligibleEmployees, eligibleResources, form.employee_id, form.resource_id, setForm]);

  // Auto-calculate end time when service or start time changes
  useEffect(() => {
    if (!form.description || !form.start_time) return;
    const svc = services.find((s) => s.name === form.description);
    if (svc && svc.duration_minutes) {
      const start = new Date(form.start_time);
      if (isNaN(start.getTime())) return;
      const end = new Date(start.getTime() + svc.duration_minutes * 60000);
      const offset = end.getTimezoneOffset() * 60000;
      const endStr = new Date(end.getTime() - offset).toISOString().slice(0, 16);
      if (form.end_time !== endStr) {
        setForm((prev) => ({ ...prev, end_time: endStr }));
      }
    }
  }, [form.description, form.start_time, services, form.end_time, setForm]);

  return (
    <section
      className={`flex-1 flex flex-col overflow-y-auto fixed inset-0 z-20 md:relative md:z-0 ${showDetailOnMobile || isCreating ? 'flex' : 'hidden md:flex'}`}
      style={{ backgroundColor: 'var(--bg-surface)' }}
    >
      {selectedAppointment || isCreating ? (
        <>
          <AppointmentPanelHeader
            selectedAppointment={selectedAppointment}
            isCreating={isCreating}
            isEditing={isEditing}
            isSendingLinks={isSendingLinks}
            vocab={vocab}
            onEdit={onEdit}
            onCancelEdit={onCancelEdit}
            onDelete={onDelete}
            onSendLinks={() => void handleSendLinks()}
            onCloseMobile={onCloseMobile}
          />

          <div className="p-4 md:p-8 space-y-8">
            {error && (
              <div className="p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-400 rounded-xl text-sm font-medium">
                {error}
              </div>
            )}

            {isEditing || isCreating ? (
              <AppointmentEditForm
                form={form}
                onFormChange={onFormChange}
                services={services}
                vocab={vocab}
                eligibleEmployees={eligibleEmployees}
                eligibleResources={eligibleResources}
                alignmentBlocked={alignmentBlocked}
                noEligibleEmployees={noEligibleEmployees}
                noEligibleResources={noEligibleResources}
                customers={customers}
                findCustomerById={findCustomerById}
                isCreating={isCreating}
                saving={saving}
                onCancelEdit={onCancelEdit}
                onSave={onSave}
                onRequestUpdateConfirmation={onRequestUpdateConfirmation}
              />
            ) : (
              selectedAppointment && (
                <AppointmentViewDisplay
                  selectedAppointment={selectedAppointment}
                  resources={resources}
                  employees={employees}
                  vocab={vocab}
                  getServiceBaseTimes={getServiceBaseTimes}
                />
              )
            )}
          </div>

          <Modal
            isOpen={showConfirmModal && !isCreating}
            onClose={onCancelUpdate}
            title="Make this change permanent?"
            footer={
              <>
                <Button variant="secondary" onClick={onCancelUpdate}>
                  Keep Original
                </Button>
                <Button onClick={onConfirmUpdate} data-testid="save-changes-btn">
                  Save Changes
                </Button>
              </>
            }
          >
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Save these changes to the appointment, or keep the original details.
            </p>
          </Modal>
        </>
      ) : (
        <div
          className="flex-1 flex items-center justify-center italic flex-col"
          style={{ color: 'var(--text-muted)' }}
        >
          <CalendarIcon className="w-12 h-12 mb-4 opacity-20" />
          {`Select ${vocab.booking_label === 'Appointment' ? 'an' : 'a'} ${vocab.booking_label.toLowerCase()} or click "+" to book one manually.`}
        </div>
      )}
    </section>
  );
}
