'use client';

import React from 'react';
import { MapPin, Navigation, Copy, StickyNote } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { formatPhone } from '../../lib/phone';
import { splitCallContext } from '../../../shared/callContext';
import { format } from 'date-fns';
import type { Appointment } from '../../lib/types';

interface AppointmentViewDisplayProps {
  selectedAppointment: Appointment;
  resources: { resource_id: string; name: string }[];
  employees: { employee_id: string | number; name: string }[];
  vocab: { resource_label: string; employee_label: string };
  getServiceBaseTimes: (appointment: Appointment) => { start: Date; end: Date };
}

export function AppointmentViewDisplay({
  selectedAppointment,
  resources,
  employees,
  vocab,
  getServiceBaseTimes,
}: AppointmentViewDisplayProps) {
  const resourceName =
    resources.find((r) => r.resource_id === selectedAppointment.resource_id)?.name || 'Unknown';
  const employee = employees.find(
    (e) => e.employee_id.toString() === selectedAppointment.employee_id?.toString()
  );
  const { start, end } = getServiceBaseTimes(selectedAppointment);
  // The voice agent stamps call context ("Job details: …", "Caller notes: …") onto the
  // description. The summary sentence uses only the service line; the context gets its
  // own section next to the caller's name and phone.
  const { serviceText, callContext } = splitCallContext(selectedAppointment.description);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div className="space-y-6">
        <Card title="Drive To" icon={<Navigation className="w-4 h-4" />} variant="success">
          <div className="flex items-start justify-between">
            <div className="flex items-start">
              <MapPin className="w-5 h-5 text-green-600 dark:text-green-500 mr-3 mt-1 flex-shrink-0" />
              <div>
                <p className="text-lg font-bold text-green-900 dark:text-green-100 leading-tight">
                  {selectedAppointment.location || 'No address provided'}
                </p>
                <p className="text-xs text-green-600 dark:text-green-500 mt-2 font-medium">
                  {`${format(start, 'PPPP')} from ${format(start, 'p')} to ${format(end, 'p')}`}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void navigator.clipboard.writeText(selectedAppointment.location || '')}
              title="Copy Address"
            >
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        </Card>

        <Card title="Customer Details">
          <div className="space-y-4">
            <div
              className="flex justify-between items-center pb-2"
              style={{ borderBottom: '1px solid var(--border-soft)' }}
            >
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Name
              </span>
              <span className="font-bold" style={{ color: 'var(--text-primary)' }}>
                {selectedAppointment.customers?.name}
              </span>
            </div>
            <div
              className="flex justify-between items-center pb-2"
              style={{ borderBottom: '1px solid var(--border-soft)' }}
            >
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Phone
              </span>
              <a
                href={`tel:${selectedAppointment.customers?.phone}`}
                className="font-bold underline"
                style={{ color: 'var(--accent-soft)' }}
              >
                {formatPhone(selectedAppointment.customers?.phone)}
              </a>
            </div>
            <div
              className="flex justify-between items-center pb-2"
              style={{ borderBottom: '1px solid var(--border-soft)' }}
            >
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {vocab.resource_label}
              </span>
              <span className="font-bold" style={{ color: 'var(--text-primary)' }}>
                {resourceName}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {`${vocab.employee_label} Assigned`}
              </span>
              <span className="font-bold" style={{ color: 'var(--text-primary)' }}>
                {employee?.name || 'Unassigned'}
              </span>
            </div>
            {callContext.length > 0 && (
              <div
                className="mt-4 pt-4"
                style={{ borderTop: '1px solid var(--border-soft)' }}
                data-testid="appointment-call-context"
              >
                <p
                  className="text-xs font-bold uppercase tracking-widest mb-1 flex items-center"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <StickyNote className="w-3 h-3 mr-1" /> From the Call
                </p>
                {callContext.map((line, i) => (
                  <p
                    key={i}
                    className="text-sm leading-relaxed"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {line}
                  </p>
                ))}
              </div>
            )}
            {!!selectedAppointment.customers?.metadata?.notes && (
              <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border-soft)' }}>
                <p
                  className="text-xs font-bold uppercase tracking-widest mb-1 flex items-center"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <StickyNote className="w-3 h-3 mr-1" /> Customer Notes
                </p>
                <p
                  className="text-sm italic leading-relaxed"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {typeof selectedAppointment.customers?.metadata?.notes === 'string'
                    ? selectedAppointment.customers.metadata.notes
                    : ''}
                </p>
              </div>
            )}
          </div>
        </Card>
      </div>

      <Card title="Summary" variant="dark">
        <p className="text-lg leading-relaxed font-medium italic">
          {`This appointment for ${selectedAppointment.customers?.name} is scheduled for ${(serviceText || selectedAppointment.description).toLowerCase()} on ${resourceName}${employee ? `, assigned to ${employee.name}` : ''}.`}
        </p>
      </Card>
    </div>
  );
}
