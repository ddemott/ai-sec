import React, { useState, useEffect } from 'react';
import { X, Search, Zap } from 'lucide-react';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { Input } from '../ui/Input';
import { Api } from '../../lib/api';
import { formatPhone } from '../../lib/phone';
import { useVocabulary } from '@/lib/VocabularyContext';

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
  customers: any[];
  employees: any[];
  resources: any[];
  services: any[];
  onBooked: () => void;
}

function toLocalISOFromParts(date: Date, hour: number): string {
  const d = new Date(date);
  d.setHours(hour, 0, 0, 0);
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, -1);
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
  const [searchTerm, setSearchTerm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen && prefill) {
      setResourceId(prefill.resourceId || resources[0]?.id || '');
      setEmployeeId(prefill.employeeId || '');
      setCustomerId(customers[0]?.id || '');
      setServiceId('');
      setError('');
      setSaving(false);
      setSearchTerm('');

      if (prefill.date && prefill.hour != null) {
        setStartTime(toLocalISOFromParts(prefill.date, prefill.hour));
        setEndTime(toLocalISOFromParts(prefill.date, prefill.endHour ?? prefill.hour + 1));
      }
    }
  }, [isOpen, prefill]);

  // Update description and end time when service changes
  useEffect(() => {
    if (serviceId) {
      const svc = services.find((s: any) => String(s.id) === serviceId);
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
    setSaving(true);
    setError('');

    const svc = services.find((s: any) => String(s.id) === serviceId);
    const description = svc?.name || 'Walk-in';

    try {
      const res = await Api.appointments.create(tenantId, {
        customer_id: customerId,
        resource_id: resourceId,
        employee_id: employeeId || null,
        start_time: new Date(startTime).toISOString(),
        end_time: new Date(endTime).toISOString(),
        description,
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

  const filteredCustomers = searchTerm
    ? customers.filter((c: any) =>
        c.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.phone?.includes(searchTerm)
      )
    : customers;

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-white dark:bg-[#1a1a1a] shadow-2xl border-l border-gray-200 dark:border-gray-800 z-30 flex flex-col animate-in slide-in-from-right duration-200" data-testid="quick-book-panel">
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
        {error && (
          <div className="p-3 text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/20 rounded-lg border border-red-100 dark:border-red-900/40">
            {error}
          </div>
        )}

        {/* Customer search */}
        <div>
          <label className="block text-xs font-bold text-gray-400 dark:text-gray-500 uppercase mb-1">Customer</label>
          <div className="relative mb-2">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search customers..."
              className="w-full pl-9 pr-4 py-2 bg-gray-50 dark:bg-[#222] border border-gray-200 dark:border-gray-800 rounded-lg text-sm outline-none"
            />
          </div>
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className="w-full p-2.5 bg-gray-50 dark:bg-[#222] border border-gray-200 dark:border-gray-800 rounded-lg text-sm font-bold"
            data-testid="quick-book-customer"
          >
            <option value="">Select customer...</option>
            {filteredCustomers.map((c: any) => (
              <option key={c.id} value={c.id}>{c.name} {c.phone ? `(${formatPhone(c.phone)})` : ''}</option>
            ))}
          </select>
        </div>

        {/* Service */}
        <Select
          label="Service"
          value={serviceId}
          onChange={(e) => setServiceId(e.target.value)}
          options={[
            { label: 'Walk-in (no service)', value: '' },
            ...services.map((s: any) => ({ label: `${s.name} (${s.duration_minutes}min)`, value: String(s.id) })),
          ]}
          data-testid="quick-book-service"
        />

        {/* Resource */}
        <Select
          label={vocab.resource_label}
          value={resourceId}
          onChange={(e) => setResourceId(e.target.value)}
          options={resources.map((r: any) => ({ label: r.name, value: r.id }))}
          data-testid="quick-book-resource"
        />

        {/* Employee */}
        <Select
          label={vocab.employee_label}
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          options={[
            { label: 'Unassigned', value: '' },
            ...employees.map((e: any) => ({ label: e.name, value: String(e.id) })),
          ]}
          data-testid="quick-book-employee"
        />

        {/* Time */}
        <div className="grid grid-cols-2 gap-3">
          <Input
            type="datetime-local"
            label="Start"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
          <Input
            type="datetime-local"
            label="End"
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
          disabled={!customerId || !resourceId}
          data-testid="quick-book-confirm"
        >
          <Zap className="w-4 h-4 mr-2" />
          Book Now
        </Button>
      </footer>
    </div>
  );
};
