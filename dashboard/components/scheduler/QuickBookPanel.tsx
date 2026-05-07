import React, { useState, useEffect, useMemo } from 'react';
import { X, Zap } from 'lucide-react';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { Input } from '../ui/Input';
import { CustomerCombobox } from '../ui/CustomerCombobox';
import { Api } from '../../lib/api';
import { useVocabulary } from '@/lib/VocabularyContext';
import { useServiceMappings } from '../../lib/hooks';
import { filterEmployeesByService, filterResourcesByService } from '../../lib/availability';
import { validateAppointmentTimeRange } from '../../lib/appointmentValidation';

interface QuickBookCustomer { id: string; name?: string; phone?: string }
interface QuickBookEmployee { id: string | number; name: string }
interface QuickBookResource { id: string; name: string }
interface QuickBookService { id: string | number; name: string; duration_minutes?: number }

interface QuickBookPanelProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string | null;
  prefill?: {
    employeeId?: string;
    resourceId?: string;
    hour?: number;
    endHour?: number;
    date?: Date;
  };
  customers: QuickBookCustomer[];
  employees: QuickBookEmployee[];
  resources: QuickBookResource[];
  services: QuickBookService[];
  onBooked: () => void;
}

function toLocalISOFromParts(date: Date, hour: number): string {
  const d = new Date(date);
  d.setHours(hour, 0, 0, 0);
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 16);
}

export const QuickBookPanel: React.FC<QuickBookPanelProps> = ({
  isOpen,
  onClose,
  tenantId,
  prefill,
  customers,
  employees,
  resources,
  services,
  onBooked,
}) => {
  const vocab = useVocabulary();
  const [customerId, setCustomerId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [resourceId, setResourceId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // service↔employee + service↔resource mappings for the alignment filter.
  // The dashboard previously let operators pick incompatible combinations
  // and relied on the booking RPC's late rejection; this hook + the two
  // helpers below close that gap so only valid combinations surface.
  const { maps } = useServiceMappings(tenantId);
  const eligibleEmployees = useMemo(
    () => filterEmployeesByService(employees, serviceId || null, maps.serviceEmployee),
    [employees, serviceId, maps.serviceEmployee]
  );
  const eligibleResources = useMemo(
    () => filterResourcesByService(resources, serviceId || null, maps.serviceResource),
    [resources, serviceId, maps.serviceResource]
  );

  // Auto-clear stale selections when the service narrows them out — so the
  // operator never submits an employee/resource that's no longer in the
  // dropdown but whose id still lives in form state.
  useEffect(() => {
    if (employeeId && !eligibleEmployees.some((e) => String(e.id) === employeeId)) {
      setEmployeeId('');
    }
    if (resourceId && !eligibleResources.some((r) => r.id === resourceId)) {
      setResourceId('');
    }
  }, [eligibleEmployees, eligibleResources, employeeId, resourceId]);

  // Inline "no qualified option" state. Only meaningful when a service is
  // chosen — without a service, any employee/resource is valid.
  const hasServicePicked = !!serviceId;
  const noEligibleEmployees = hasServicePicked && eligibleEmployees.length === 0;
  const noEligibleResources = hasServicePicked && eligibleResources.length === 0;
  const alignmentBlocked = noEligibleEmployees || noEligibleResources;

  useEffect(() => {
    if (isOpen && prefill) {
      setResourceId(prefill.resourceId || resources[0]?.id || '');
      setEmployeeId(prefill.employeeId || '');
      setCustomerId(customers[0]?.id || '');
      setServiceId('');
      setError('');
      setSaving(false);

      if (prefill.date && prefill.hour != null) {
        setStartTime(toLocalISOFromParts(prefill.date, prefill.hour));
        setEndTime(toLocalISOFromParts(prefill.date, prefill.endHour ?? prefill.hour + 1));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, prefill]);

  // Update description and end time when service changes
  useEffect(() => {
    if (serviceId) {
      const svc = services.find((s) => String(s.id) === serviceId);
      if (svc && svc.duration_minutes && startTime) {
        const start = new Date(startTime);
        const end = new Date(start.getTime() + svc.duration_minutes * 60000);
        const offset = end.getTimezoneOffset() * 60000;
        setEndTime(new Date(end.getTime() - offset).toISOString().slice(0, -1));
      }
    }
  }, [serviceId, startTime, services]);

  const handleBook = async () => {
    if (!tenantId || !customerId || !resourceId) {
      setError('Customer and resource are required');
      return;
    }

    const validationError = validateAppointmentTimeRange(startTime, endTime);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError('');

    const svc = services.find((s) => String(s.id) === serviceId);
    const description = svc?.name || 'Walk-in';

    try {
      const res = await Api.appointments.create(tenantId, {
        customer_id: customerId,
        resource_id: resourceId,
        employee_id: employeeId || null,
        start_time: new Date(startTime).toISOString(),
        end_time: new Date(endTime).toISOString(),
        description,
        // Pass serviceId so the RPC enforces service_employee +
        // service_resource mapping (or its array fallback) — the same
        // alignment the UI dropdown filter shows the operator.
        service_id: serviceId || null,
      });
      if (res.success) {
        onBooked();
        onClose();
      } else {
        setError(res.error || 'Booking failed');
      }
    } catch {
      setError('Connection error');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-96 bg-white dark:bg-[#1a1a1a] shadow-2xl border-l border-gray-200 dark:border-gray-800 z-30 flex flex-col animate-in slide-in-from-right duration-200" data-testid="quick-book-panel">
      <header className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-500" />
          <h3 className="font-bold text-gray-900 dark:text-gray-100">Quick Book</h3>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close quick book">
          <X className="w-4 h-4" />
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div aria-live="polite">
          {error && (
            <div className="p-3 text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/20 rounded-lg border border-red-100 dark:border-red-900/40">
              {error}
            </div>
          )}
        </div>

        {/* Customer search */}
        <CustomerCombobox
          customers={customers.map((c) => ({ id: c.id, name: c.name ?? null, phone: c.phone ?? null }))}
          value={customerId}
          onChange={setCustomerId}
          selectTestId="quick-book-customer"
          searchTestId="quick-book-customer-search"
        />


        {/* Service */}
        <Select
          label="Service"
          value={serviceId}
          onChange={(e) => setServiceId(e.target.value)}
          options={[
            { label: 'Walk-in (no service)', value: '' },
            ...services.map((s) => ({ label: `${s.name} (${s.duration_minutes}min)`, value: String(s.id) })),
          ]}
          data-testid="quick-book-service"
        />

        {/* Resource — narrowed to those permitted for the selected service */}
        <Select
          label={vocab.resource_label}
          value={resourceId}
          onChange={(e) => setResourceId(e.target.value)}
          options={eligibleResources.map((r) => ({ label: r.name, value: r.id }))}
          data-testid="quick-book-resource"
        />

        {/* Employee — narrowed to those qualified for the selected service */}
        <Select
          label={vocab.employee_label}
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          options={[
            { label: 'Unassigned', value: '' },
            ...eligibleEmployees.map((e) => ({ label: e.name, value: String(e.id) })),
          ]}
          data-testid="quick-book-employee"
        />

        {alignmentBlocked && (
          <div
            className="p-3 text-sm rounded-lg border"
            style={{
              color: 'var(--warning, #eab308)',
              background: 'var(--warning-muted, rgba(234,179,8,0.10))',
              borderColor: 'var(--warning-muted, rgba(234,179,8,0.3))',
            }}
            role="status"
            data-testid="quick-book-alignment-blocked"
          >
            {noEligibleEmployees && noEligibleResources
              ? `No qualified ${vocab.employee_label.toLowerCase()} or ${vocab.resource_label.toLowerCase()} configured for this service. Assign one in Back Office → Service Assignments first.`
              : noEligibleEmployees
                ? `No ${vocab.employee_label.toLowerCase()} is configured to perform this service. Assign one in Back Office → Service Assignments first.`
                : `No ${vocab.resource_label.toLowerCase()} is configured for this service. Assign one in Back Office → Service Assignments first.`}
          </div>
        )}

        {/* Time */}
        <div className="grid grid-cols-2 gap-3">
          <Input
            type="datetime-local"
            label="Start"
            step="60"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
          <Input
            type="datetime-local"
            label="End"
            step="60"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
          />
        </div>
      </div>

      <footer className="p-4 border-t border-gray-200 dark:border-gray-800">
        <Button
          className="w-full py-3"
          onClick={handleBook}
          isLoading={saving}
          disabled={!customerId || !resourceId || !startTime || !endTime || alignmentBlocked}
          data-testid="quick-book-confirm"
        >
          <Zap className="w-4 h-4 mr-2" />
          Book Now
        </Button>
      </footer>
    </div>
  );
};
