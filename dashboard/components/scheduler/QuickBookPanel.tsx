import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Zap } from 'lucide-react';
import { Button } from '../ui/Button';
import { SchedulerSidePanel } from './SchedulerSidePanel';
import { Select } from '../ui/Select';
import { Input } from '../ui/Input';
import { CustomerCombobox } from '../ui/CustomerCombobox';
import { Api } from '../../lib/api';
import { useVocabulary } from '@/lib/VocabularyContext';
import { useServiceMappings, useTenantTimezone } from '../../lib/hooks';
import { filterEmployeesByService, filterResourcesByService } from '../../lib/availability';
import { validateAppointmentTimeRange } from '../../lib/appointmentValidation';
import { ConflictModal, type BookingConflict, type AvailableAlternative } from './ConflictModal';

interface QuickBookCustomer {
  customer_id: string;
  name?: string;
  phone?: string;
}
interface QuickBookEmployee {
  employee_id: string;
  name: string;
  skills?: string[];
}
interface QuickBookResource {
  resource_id: string;
  name: string;
}
interface QuickBookService {
  service_id: string;
  name: string;
  duration_minutes?: number;
}

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
  const tenantTimezone = useTenantTimezone();
  const [customerId, setCustomerId] = useState('');
  // Local copy of the customer list so an inline-created walk-in appears in
  // the combobox immediately, without waiting for the parent's `customers`
  // prop to refetch. Seeded from props and re-synced when they change.
  const [localCustomers, setLocalCustomers] = useState<QuickBookCustomer[]>(customers);
  const [serviceId, setServiceId] = useState('');
  const [resourceId, setResourceId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Conflict modal state — populated when /appointments/create returns
  // 409 with a `conflict` block. Showing the existing appointment's
  // details lets the operator pick another time without leaving the panel.
  const [conflict, setConflict] = useState<BookingConflict | null>(null);
  // Next-available alternatives surfaced alongside the conflict — the
  // operator can click one to pre-fill the form with that time + employee
  // + resource and submit again. Empty when no alternatives were found.
  const [nextAvailable, setNextAvailable] = useState<AvailableAlternative[]>([]);

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
    if (employeeId && !eligibleEmployees.some((e) => String(e.employee_id) === employeeId)) {
      setEmployeeId('');
    }
    if (resourceId && !eligibleResources.some((r) => r.resource_id === resourceId)) {
      setResourceId('');
    }
  }, [eligibleEmployees, eligibleResources, employeeId, resourceId]);

  // Auto-suggest the least-skilled qualified employee when a service is
  // picked but no employee is chosen yet. Mirrors the RPC's auto-
  // assignment policy (2026-05-08): senior-time preservation. The
  // operator can override by picking a different option in the dropdown,
  // or clear by picking "Unassigned". We don't auto-select on every
  // render — only on the first eligible-employee population for a given
  // service pick — so a manual "Unassigned" choice sticks.
  const autoSuggestedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!serviceId) {
      autoSuggestedRef.current = null;
      return;
    }
    if (employeeId) return; // operator already picked
    if (autoSuggestedRef.current === serviceId) return; // already suggested for this service
    if (eligibleEmployees.length === 0) return;

    const sorted = [...eligibleEmployees].sort((a, b) => {
      const aSkills = a.skills?.length ?? 0;
      const bSkills = b.skills?.length ?? 0;
      if (aSkills !== bSkills) return aSkills - bSkills;
      // Tiebreaker: alphabetical for predictable client-side suggestion.
      // (The backend RPC adds a least-busy-today tiebreaker that needs
      // appointment data we don't fetch into Quick Book; alphabetical
      // here is a stable approximation, and the operator can always
      // override before submit.)
      return a.name.localeCompare(b.name);
    });
    setEmployeeId(String(sorted[0].employee_id));
    autoSuggestedRef.current = serviceId;
  }, [serviceId, employeeId, eligibleEmployees]);

  // Inline "no qualified option" state. Only meaningful when a service is
  // chosen — without a service, any employee/resource is valid.
  const hasServicePicked = !!serviceId;
  const noEligibleEmployees = hasServicePicked && eligibleEmployees.length === 0;
  const noEligibleResources = hasServicePicked && eligibleResources.length === 0;
  const alignmentBlocked = noEligibleEmployees || noEligibleResources;

  // Keep the local list in sync when the parent supplies a fresh customers
  // prop (e.g. after onBooked → reload). Inline-created customers added to
  // localCustomers survive until the next prop change replaces the array.
  useEffect(() => {
    setLocalCustomers(customers);
  }, [customers]);

  useEffect(() => {
    if (isOpen && prefill) {
      setResourceId(prefill.resourceId || resources[0]?.resource_id || '');
      setEmployeeId(prefill.employeeId || '');
      setCustomerId(customers[0]?.customer_id || '');
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
      const svc = services.find((s) => String(s.service_id) === serviceId);
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

    const svc = services.find((s) => String(s.service_id) === serviceId);
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
      } else if (res.error_code === 'TIMESLOT_OCCUPIED' && res.conflict) {
        // Overlap with an existing appointment — show the conflict modal
        // with the existing booking's details. Inline error stays empty
        // so the modal owns the messaging.
        setConflict(res.conflict);
        setNextAvailable(res.next_available ?? []);
        setError('');
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

  // Sticky Book-Now footer (passed to the shared shell). Comment preserved:
  // UX audit Devices 4.3.3 (2026-05-18) — position:sticky bottom:0 keeps it
  // above the iOS keyboard; env(safe-area-inset-bottom) clears the home bar.
  const bookNowFooter = (
    <footer
      className="border-t shrink-0 sticky bottom-0"
      style={{
        backgroundColor: 'var(--bg-surface, #1a1a1a)',
        borderColor: 'var(--border-soft)',
        padding: '1rem',
        paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))',
      }}
    >
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
  );

  return (
    <>
      <SchedulerSidePanel
        icon={<Zap className="w-4 h-4" style={{ color: 'var(--warning)' }} />}
        title="Quick Book"
        onClose={onClose}
        closeLabel="Close quick book"
        dataTestId="quick-book-panel"
        bodyClassName="p-4 space-y-4"
        footer={bookNowFooter}
      >
        <div aria-live="polite">
          {error && (
            <div className="p-3 text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/20 rounded-lg border border-red-100 dark:border-red-900/40">
              {error}
            </div>
          )}
        </div>

        {/* Customer search + inline walk-in creation */}
        <CustomerCombobox
          customers={localCustomers.map((c) => ({
            customer_id: c.customer_id,
            name: c.name ?? null,
            phone: c.phone ?? null,
          }))}
          value={customerId}
          onChange={setCustomerId}
          selectTestId="quick-book-customer"
          searchTestId="quick-book-customer-search"
          onCreateCustomer={async (draft) => {
            // Create the walk-in, then add to the local list so the new
            // option is selectable without leaving the panel. Returning the
            // CustomerOption lets the combobox select it via onChange.
            // `notes` maps to metadata.notes (the column the record stores +
            // the detail panel reads) rather than a top-level field the
            // backend would silently drop.
            const { notes, ...rest } = draft;
            const res = await Api.customers.create(tenantId, {
              ...rest,
              metadata: notes ? { notes } : undefined,
            });
            const c = res?.customer;
            if (!c) return null;
            setLocalCustomers((prev) => [
              { customer_id: c.customer_id, name: c.name, phone: c.phone },
              ...prev,
            ]);
            return { customer_id: c.customer_id, name: c.name, phone: c.phone };
          }}
        />

        {/* Service */}
        <Select
          label="Service"
          value={serviceId}
          onChange={(e) => setServiceId(e.target.value)}
          options={[
            { label: 'Walk-in (no service)', value: '' },
            ...services.map((s) => ({
              label: `${s.name} (${s.duration_minutes}min)`,
              value: String(s.service_id),
            })),
          ]}
          data-testid="quick-book-service"
        />

        {/* Resource — narrowed to those permitted for the selected service */}
        <Select
          label={vocab.resource_label}
          value={resourceId}
          onChange={(e) => setResourceId(e.target.value)}
          options={eligibleResources.map((r) => ({ label: r.name, value: r.resource_id }))}
          data-testid="quick-book-resource"
        />

        {/* Employee — narrowed to those qualified for the selected service */}
        <Select
          label={vocab.employee_label}
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          options={[
            { label: 'Unassigned', value: '' },
            ...eligibleEmployees.map((e) => ({ label: e.name, value: String(e.employee_id) })),
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

        {/* Time — step="900" enforces 15-minute increments at the form
            level (browser arrow keys + reportValidity); the JS validator
            and the DB CHECK constraint are the safety nets behind it. */}
        {/* Timezone hint — front-desk staff in a different local zone
            would create bookings relative to their clock without this.
            2026-05-28 UX audit #F2. */}
        {tenantTimezone && (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Times are in {tenantTimezone}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Input
            type="datetime-local"
            label="Start"
            step="900"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
          <Input
            type="datetime-local"
            label="End"
            step="900"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
          />
        </div>
      </SchedulerSidePanel>

      <ConflictModal
        isOpen={conflict !== null}
        conflict={conflict}
        nextAvailable={nextAvailable}
        onPickAlternative={(slot) => {
          // Pre-fill the form with the picked alternative. Convert UTC
          // ISO times back to a datetime-local input string in the user's
          // local zone so the input renders the time the operator clicked.
          const toLocalInputValue = (iso: string) => {
            const d = new Date(iso);
            const offset = d.getTimezoneOffset() * 60000;
            return new Date(d.getTime() - offset).toISOString().slice(0, 16);
          };
          setStartTime(toLocalInputValue(slot.start_time));
          setEndTime(toLocalInputValue(slot.end_time));
          setResourceId(slot.resource_id);
          setEmployeeId(slot.employee_id);
          setConflict(null);
          setNextAvailable([]);
        }}
        onClose={() => {
          setConflict(null);
          setNextAvailable([]);
        }}
      />
    </>
  );
};
