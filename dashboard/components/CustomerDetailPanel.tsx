'use client';

import React from 'react';
import {
  Users,
  Phone,
  Mail,
  MapPin,
  History,
  Edit2,
  Save,
  X,
  Trash2,
  Calendar,
  Clock,
  XCircle,
  ChevronLeft,
  RefreshCw,
} from 'lucide-react';
import { US_STATES, US_TIMEZONES } from '../lib/constants';
import { formatPhone } from '../lib/phone';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { PhoneInput } from './ui/PhoneInput';
import { Select } from './ui/Select';
import { Card } from './ui/Card';
import { Badge } from './ui/Badge';
import { type Customer } from '@/lib/types';
import { EmptyState } from './ui/EmptyState';

interface EditForm {
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  address: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
  timezone: string;
  notes: string;
}

interface CallSummary {
  call_summary_id: string;
  customer_id: string;
  summary: string;
  call_timestamp?: string;
  created_at?: string;
  has_transcript?: boolean;
}

interface CustomerAppointment {
  appointment_id: string;
  start_time: string;
  end_time: string;
  status: string;
  description: string;
  resource_name?: string;
  employee_name?: string;
  location?: string;
}

interface CustomerDetailPanelProps {
  selectedCustomer: Customer | null;
  isCreating: boolean;
  isEditing: boolean;
  saving: boolean;
  showDetailOnMobile: boolean;
  editForm: EditForm;
  summaries: CallSummary[];
  upcomingAppointments: CustomerAppointment[];
  pastAppointments: CustomerAppointment[];
  onEditFormChange: (field: string, value: string) => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onCreate: () => void;
  onDelete: () => void;
  onCancelAppointment: (appointmentId: string) => void;
  onReactivateAppointment: (appointmentId: string) => void;
  onCloseMobile: () => void;
}

export function CustomerDetailPanel({
  selectedCustomer,
  isCreating,
  isEditing,
  saving,
  showDetailOnMobile,
  editForm,
  summaries,
  upcomingAppointments,
  pastAppointments,
  onEditFormChange,
  onEdit,
  onCancelEdit,
  onSave,
  onCreate,
  onDelete,
  onCancelAppointment,
  onReactivateAppointment,
  onCloseMobile,
}: CustomerDetailPanelProps) {
  return (
    <section
      className={`flex-1 flex flex-col overflow-y-auto fixed inset-0 z-20 md:relative md:z-0 ${showDetailOnMobile || isCreating ? 'flex' : 'hidden md:flex'}`}
      style={{ backgroundColor: 'var(--bg-surface)' }}
    >
      {selectedCustomer || isCreating ? (
        <>
          <header
            className="p-4 md:p-8 flex items-center justify-between"
            style={{
              borderBottom: '1px solid var(--border-soft)',
              backgroundColor: 'var(--bg-raised)',
            }}
          >
            <div className="flex items-center">
              <button
                onClick={onCloseMobile}
                aria-label="Back to customer list"
                className="md:hidden p-2 -ml-2 mr-2"
                style={{ color: 'var(--accent-soft)' }}
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <div className="flex items-center space-x-4">
                <div
                  className="w-12 h-12 md:w-16 md:h-16 rounded-full flex items-center justify-center text-xl md:text-2xl font-bold"
                  style={{ backgroundColor: 'var(--accent)', color: 'var(--primary-text)' }}
                >
                  {isCreating ? '+' : selectedCustomer?.name?.charAt(0) || '?'}
                </div>
                <div>
                  <h1 className="text-xl md:text-3xl font-display">
                    {isCreating ? 'New Customer' : selectedCustomer?.name || 'Unknown'}
                  </h1>
                  {!isCreating && (
                    <p
                      className="text-sm md:text-base flex items-center"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      <Phone className="w-4 h-4 mr-2" /> {formatPhone(selectedCustomer?.phone)}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              {!isEditing && !isCreating ? (
                <>
                  <Button variant="danger" size="sm" onClick={onDelete} title="Delete Customer">
                    <Trash2 className="w-5 h-5" />
                  </Button>
                  <Button variant="secondary" onClick={onEdit}>
                    <Edit2 className="w-4 h-4 mr-2" /> Edit Info
                  </Button>
                </>
              ) : (
                <div className="flex space-x-2">
                  <Button variant="ghost" onClick={onCancelEdit} aria-label="Cancel editing">
                    <X className="w-5 h-5" />
                  </Button>
                  <Button onClick={isCreating ? onCreate : onSave} isLoading={saving}>
                    {!saving && <Save className="w-4 h-4 mr-2" />}
                    {isCreating ? 'Create Customer' : 'Save Changes'}
                  </Button>
                </div>
              )}
            </div>
          </header>

          <div className="p-4 md:p-8 space-y-8">
            {/* In-panel section navigation */}
            {!isCreating && !isEditing && selectedCustomer && (
              <nav
                aria-label="Customer sections"
                className="flex gap-3 text-xs font-medium"
                style={{ color: 'var(--text-secondary)' }}
              >
                <a
                  href="#customer-contact"
                  className="hover:underline"
                  style={{ color: 'var(--accent-soft)' }}
                >
                  Contact
                </a>
                <a
                  href="#customer-upcoming"
                  className="hover:underline"
                  style={{ color: 'var(--accent-soft)' }}
                >
                  Upcoming
                </a>
                <a
                  href="#customer-history"
                  className="hover:underline"
                  style={{ color: 'var(--accent-soft)' }}
                >
                  History
                </a>
                <a
                  href="#customer-calls"
                  className="hover:underline"
                  style={{ color: 'var(--accent-soft)' }}
                >
                  Calls
                </a>
              </nav>
            )}

            <Card title="Contact Details & Notes" className="max-w-2xl" id="customer-contact">
              {!isEditing && !isCreating ? (
                <div className="space-y-4 text-sm">
                  <div className="flex items-start">
                    <Mail className="w-4 h-4 mr-3 mt-0.5" style={{ color: 'var(--text-muted)' }} />
                    <span style={{ color: 'var(--text-primary)' }}>
                      {selectedCustomer?.email || 'No email provided'}
                    </span>
                  </div>
                  <div className="flex items-start">
                    <MapPin
                      className="w-4 h-4 mr-3 mt-0.5"
                      style={{ color: 'var(--text-muted)' }}
                    />
                    <span style={{ color: 'var(--text-primary)' }}>
                      {selectedCustomer
                        ? [
                            selectedCustomer.address,
                            selectedCustomer.address_line2,
                            selectedCustomer.city,
                            [selectedCustomer.state, selectedCustomer.postal_code]
                              .filter(Boolean)
                              .join(' '),
                          ]
                            .filter(Boolean)
                            .join(', ') || 'No address on file'
                        : 'No address on file'}
                    </span>
                  </div>
                  <div className="flex items-start">
                    <RefreshCw
                      className="w-4 h-4 mr-3 mt-0.5"
                      style={{ color: 'var(--text-muted)' }}
                    />
                    <span style={{ color: 'var(--text-primary)' }}>
                      Timezone:{' '}
                      {US_TIMEZONES.find((t) => t.value === selectedCustomer?.timezone)?.label ||
                        selectedCustomer?.timezone ||
                        'Not set'}
                    </span>
                  </div>
                  <div className="mt-6 pt-6" style={{ borderTop: '1px solid var(--border-soft)' }}>
                    <p
                      className="text-xs font-bold uppercase mb-2"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      Internal Notes
                    </p>
                    <p
                      className="italic leading-relaxed"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {(selectedCustomer?.metadata?.notes as string) ||
                        'No internal notes added yet.'}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Input
                      label="First Name"
                      value={editForm.first_name}
                      onChange={(e) => onEditFormChange('first_name', e.target.value)}
                      placeholder="First Name"
                    />
                    <Input
                      label="Last Name"
                      value={editForm.last_name}
                      onChange={(e) => onEditFormChange('last_name', e.target.value)}
                      placeholder="Last Name"
                    />
                    <PhoneInput
                      label="Phone Number"
                      value={editForm.phone}
                      onChange={(val) => onEditFormChange('phone', val)}
                    />
                  </div>
                  <Input
                    label="Email"
                    type="email"
                    value={editForm.email}
                    onChange={(e) => onEditFormChange('email', e.target.value)}
                    placeholder="customer@email.com"
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input
                      label="Address Line 1"
                      value={editForm.address}
                      onChange={(e) => onEditFormChange('address', e.target.value)}
                      placeholder="123 Street St"
                    />
                    <Input
                      label="Address Line 2"
                      value={editForm.address_line2}
                      onChange={(e) => onEditFormChange('address_line2', e.target.value)}
                      placeholder="Apt / Suite / Unit"
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Input
                      label="City"
                      value={editForm.city}
                      onChange={(e) => onEditFormChange('city', e.target.value)}
                      placeholder="New York"
                    />
                    <Select
                      label="State"
                      value={editForm.state}
                      onChange={(e) => onEditFormChange('state', e.target.value)}
                      options={[
                        { label: 'Select state', value: '' },
                        ...US_STATES.map((code) => ({ label: code, value: code })),
                      ]}
                    />
                    <Input
                      label="ZIP"
                      value={editForm.postal_code}
                      onChange={(e) => onEditFormChange('postal_code', e.target.value)}
                      placeholder="10001"
                    />
                  </div>
                  <Select
                    label="Timezone"
                    value={editForm.timezone}
                    onChange={(e) => onEditFormChange('timezone', e.target.value)}
                    options={US_TIMEZONES}
                  />
                  <div>
                    <label
                      className="block text-xs font-bold uppercase mb-1"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      Internal Notes
                    </label>
                    <textarea
                      rows={4}
                      value={editForm.notes}
                      onChange={(e) => onEditFormChange('notes', e.target.value)}
                      className="w-full p-2.5 rounded-xl text-sm outline-none focus:ring-2 transition"
                      style={
                        {
                          backgroundColor: 'var(--bg-raised)',
                          border: '1px solid var(--border-soft)',
                          color: 'var(--text-primary)',
                          '--tw-ring-color': 'var(--accent-glow)',
                        } as React.CSSProperties
                      }
                      placeholder="Add private notes the AI should consider..."
                    />
                  </div>
                </div>
              )}
            </Card>

            {!isCreating && (
              <>
                {/* UPCOMING APPOINTMENTS */}
                <div id="customer-upcoming" className="space-y-4">
                  <h3
                    className="font-bold flex items-center text-lg"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    <Calendar className="w-5 h-5 mr-2" style={{ color: 'var(--text-muted)' }} />
                    Upcoming Appointments
                  </h3>
                  {upcomingAppointments.length > 0 ? (
                    <div className="space-y-3">
                      {upcomingAppointments.map((a) => (
                        <div
                          key={a.appointment_id}
                          className="p-4 rounded-xl shadow-sm flex justify-between items-start"
                          style={{
                            border: '1px solid var(--border-soft)',
                            backgroundColor: 'var(--bg-surface)',
                          }}
                        >
                          <div className="space-y-1">
                            <p
                              className="text-sm font-semibold"
                              style={{ color: 'var(--text-primary)' }}
                            >
                              {a.description}
                            </p>
                            <p
                              className="text-xs flex items-center"
                              style={{ color: 'var(--text-secondary)' }}
                            >
                              <Clock className="w-3 h-3 mr-1" />
                              {new Date(a.start_time).toLocaleDateString()} at{' '}
                              {new Date(a.start_time).toLocaleTimeString('en-US', {
                                hour: 'numeric',
                                minute: '2-digit',
                                hour12: true,
                              })}
                            </p>
                            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                              {a.resource_name}
                              {a.employee_name ? ` / ${a.employee_name}` : ''}
                            </p>
                            {a.location && (
                              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                {a.location}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center space-x-2">
                            <Badge variant="primary">Scheduled</Badge>
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => onCancelAppointment(a.appointment_id)}
                              aria-label="Cancel appointment"
                            >
                              <XCircle className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      icon={Calendar}
                      title="No upcoming appointments"
                      variant="compact"
                    />
                  )}
                </div>

                {/* APPOINTMENT HISTORY */}
                <div id="customer-history" className="space-y-4">
                  <h3
                    className="font-bold flex items-center text-lg"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    <History className="w-5 h-5 mr-2" style={{ color: 'var(--text-muted)' }} />
                    Appointment History
                  </h3>
                  {pastAppointments.length > 0 ? (
                    <div className="space-y-3">
                      {pastAppointments.map((a) => {
                        const isCanceled = a.status === 'canceled';
                        const dateLabel = `${new Date(a.start_time).toLocaleDateString()} at ${new Date(a.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
                        const Body = (
                          <>
                            <div className="space-y-1">
                              <p
                                className="text-sm font-semibold"
                                style={{ color: 'var(--text-primary)' }}
                              >
                                {a.description}
                              </p>
                              <p
                                className="text-xs flex items-center"
                                style={{ color: 'var(--text-secondary)' }}
                              >
                                <Clock className="w-3 h-3 mr-1" />
                                {dateLabel}
                              </p>
                              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                                {a.resource_name}
                                {a.employee_name ? ` / ${a.employee_name}` : ''}
                              </p>
                            </div>
                            <Badge
                              variant={
                                a.status === 'completed'
                                  ? 'success'
                                  : isCanceled
                                    ? 'danger'
                                    : 'secondary'
                              }
                            >
                              {a.status === 'completed'
                                ? 'Completed'
                                : isCanceled
                                  ? 'Canceled'
                                  : a.status}
                            </Badge>
                          </>
                        );
                        // Canceled rows are clickable to surface the reactivate
                        // affordance — the only place in the app where a
                        // canceled appointment is reachable from a click flow.
                        // Non-canceled history rows stay non-interactive (no
                        // detail-view route exists for past completed
                        // appointments yet — out of scope here).
                        return isCanceled ? (
                          <button
                            key={a.appointment_id}
                            type="button"
                            onClick={() => onReactivateAppointment(a.appointment_id)}
                            data-testid={`customer-history-canceled-${a.appointment_id}`}
                            aria-label={`Reactivate canceled appointment: ${a.description} on ${dateLabel}`}
                            className="w-full text-left p-4 rounded-xl shadow-sm flex justify-between items-start transition-colors hover:brightness-110"
                            style={{
                              border: '1px solid var(--border-soft)',
                              backgroundColor: 'var(--bg-surface)',
                              cursor: 'pointer',
                            }}
                          >
                            {Body}
                          </button>
                        ) : (
                          <div
                            key={a.appointment_id}
                            className="p-4 rounded-xl shadow-sm flex justify-between items-start"
                            style={{
                              border: '1px solid var(--border-soft)',
                              backgroundColor: 'var(--bg-surface)',
                            }}
                          >
                            {Body}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <EmptyState icon={History} title="No past appointments" variant="compact" />
                  )}
                </div>

                {/* AI CALL HISTORY */}
                <div id="customer-calls" className="space-y-4">
                  <h3
                    className="font-bold flex items-center text-lg"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    <Phone className="w-5 h-5 mr-2" style={{ color: 'var(--text-muted)' }} />
                    AI Call History
                  </h3>
                  <div className="space-y-4">
                    {summaries.length > 0 ? (
                      summaries.map((s) => (
                        <div
                          key={s.call_summary_id}
                          className="p-5 rounded-xl shadow-sm"
                          style={{
                            border: '1px solid var(--border-soft)',
                            backgroundColor: 'var(--bg-surface)',
                          }}
                        >
                          <div
                            className="flex justify-between text-xs mb-2"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            <span
                              className="font-bold uppercase"
                              style={{ color: 'var(--accent-soft)' }}
                            >
                              AI Summary
                            </span>
                            <span>
                              {new Date(
                                s.call_timestamp || s.created_at || ''
                              ).toLocaleDateString()}
                            </span>
                          </div>
                          <p
                            className="text-sm leading-relaxed italic"
                            style={{ color: 'var(--text-secondary)' }}
                          >
                            &quot;{s.summary}&quot;
                          </p>
                          {s.has_transcript && (
                            <p className="text-xs text-green-600 dark:text-green-400 mt-2">
                              Transcript available
                            </p>
                          )}
                        </div>
                      ))
                    ) : (
                      <EmptyState icon={Phone} title="No call history" variant="compact" />
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      ) : (
        <div
          className="flex-1 flex items-center justify-center italic text-center px-4 flex-col"
          style={{ color: 'var(--text-muted)' }}
        >
          <Users className="w-12 h-12 mb-4 opacity-20" />
          Select a customer or click the &quot;+&quot; button to add one.
        </div>
      )}
    </section>
  );
}
