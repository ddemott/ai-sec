'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { type Customer } from '@/lib/types';
import { MOCK_CUSTOMERS, MOCK_SUMMARIES } from '@/lib/mockData';
import { Search, RefreshCw, ChevronRight, UserPlus } from 'lucide-react';
import { Api } from '../lib/api';
import { detectTimezone } from '../lib/constants';
import { formatPhone } from '../lib/phone';
import { splitFullName } from '../lib/utils';
import { useFormState } from '../lib/hooks';
import { EmptyState } from './ui/EmptyState';
import { useActiveTenantId } from '../lib/SessionContext';
import { Button } from './ui/Button';
import { CustomerDetailPanel } from './CustomerDetailPanel';
import { ConfirmModal } from './ui/ConfirmModal';
import { showToast } from './ui/Toast';
import { useConfirm } from '../lib/useConfirm';

export default function CRMView() {
  const tenantId = useActiveTenantId();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [summaries, setSummaries] = useState<
    {
      call_summary_id: string;
      customer_id: string;
      summary: string;
      call_timestamp?: string;
      created_at?: string;
      has_transcript?: boolean;
    }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [showDetailOnMobile, setShowDetailOnMobile] = useState(false);
  const [customerAppointments, setCustomerAppointments] = useState<
    {
      appointment_id: string;
      start_time: string;
      end_time: string;
      status: string;
      description: string;
      resource_name?: string;
      employee_name?: string;
      location?: string;
    }[]
  >([]);
  const [searchQuery, setSearchQuery] = useState('');
  // Keyboard-nav focus index into the filtered customer list
  // (UX audit Flows 4.1 row 5, 2026-05-18). -1 means nothing
  // focused; ArrowDown from the search input sets it to 0.
  const [focusedIdx, setFocusedIdx] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const { state: confirmState, confirm, close: closeConfirm } = useConfirm();

  // States
  const [isEditing, setIsEditing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const {
    form: editForm,
    setField,
    setForm: setEditForm,
  } = useFormState({
    first_name: '',
    last_name: '',
    phone: '',
    email: '',
    address: '',
    address_line2: '',
    city: '',
    state: '',
    postal_code: '',
    timezone: 'America/New_York',
    notes: '',
  });
  const handleEditFormChange = (field: string, value: string) =>
    setField(field as keyof typeof editForm, value);

  useEffect(() => {
    if (tenantId) {
      void fetchCustomers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  useEffect(() => {
    if (selectedCustomer) {
      void fetchHistory(selectedCustomer.customer_id);
      void fetchCustomerAppointments(selectedCustomer.customer_id);
      const { first, last } = splitFullName(selectedCustomer.name || '');
      const derivedFirst = selectedCustomer.first_name || first || '';
      const derivedLast = selectedCustomer.last_name || last || '';
      setEditForm({
        first_name: derivedFirst,
        last_name: derivedLast,
        phone: formatPhone(selectedCustomer.phone) || '',
        email: selectedCustomer.email || '',
        address: selectedCustomer.address || '',
        address_line2: selectedCustomer.address_line2 || '',
        city: selectedCustomer.city || '',
        state: selectedCustomer.state || '',
        postal_code: selectedCustomer.postal_code || '',
        timezone: selectedCustomer.timezone || 'America/New_York',
        notes: (selectedCustomer.metadata?.notes as string) || '',
      });
      setIsEditing(false);
      setIsCreating(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCustomer]);

  // Auto-detect timezone
  useEffect(() => {
    if (!isEditing && !isCreating) return;
    const tz = detectTimezone(editForm.city, editForm.state);
    if (tz) {
      setEditForm((prev) => ({ ...prev, timezone: tz }));
    }
  }, [editForm.city, editForm.state, isEditing, isCreating, setEditForm]);

  async function fetchCustomers() {
    setLoading(true);
    try {
      const data = await Api.customers.list(tenantId);
      if (!data || data.length === 0) {
        if (!tenantId) {
          setCustomers(MOCK_CUSTOMERS);
          if (!selectedCustomer) setSelectedCustomer(MOCK_CUSTOMERS[0]);
        } else {
          setCustomers([]);
        }
      } else {
        setCustomers(data as unknown as Customer[]);
        if (!selectedCustomer) setSelectedCustomer((data as unknown as Customer[])[0]);
      }
    } catch {
      setCustomers(MOCK_CUSTOMERS);
      if (!selectedCustomer) setSelectedCustomer(MOCK_CUSTOMERS[0]);
    }
    setLoading(false);
  }

  async function fetchHistory(customerId: string) {
    try {
      const data = await Api.callSummaries.list(tenantId, customerId);
      if (!data || data.length === 0) {
        setSummaries(MOCK_SUMMARIES.filter((s) => s.customer_id === customerId));
      } else {
        setSummaries(data as typeof summaries);
      }
    } catch {
      setSummaries(MOCK_SUMMARIES.filter((s) => s.customer_id === customerId));
    }
  }

  async function fetchCustomerAppointments(customerId: string) {
    try {
      const data = await Api.customers.appointments(customerId, tenantId);
      setCustomerAppointments((data || []) as typeof customerAppointments);
    } catch {
      setCustomerAppointments([]);
    }
  }

  function handleCancelAppointment(appointmentId: string) {
    confirm({
      title: 'Cancel Appointment',
      message: 'Are you sure you want to cancel this appointment?',
      confirmLabel: 'Cancel Appointment',
      onConfirm: async () => {
        closeConfirm();
        try {
          const res = await Api.appointments.cancel(appointmentId, tenantId);
          if (res.success && selectedCustomer) {
            void fetchCustomerAppointments(selectedCustomer.customer_id);
          }
        } catch (e) {
          console.error(e);
        }
      },
    });
  }

  function handleReactivateAppointment(appointmentId: string) {
    confirm({
      title: 'Reactivate Appointment',
      message:
        'Restore this canceled appointment to the schedule? It will be added back to connected calendars.',
      confirmLabel: 'Reactivate',
      onConfirm: async () => {
        closeConfirm();
        try {
          const res = await Api.appointments.reactivate(appointmentId, tenantId);
          if (res.success) {
            showToast('Appointment reactivated.', 'success');
            if (selectedCustomer) void fetchCustomerAppointments(selectedCustomer.customer_id);
            return;
          }
          // Status-conflict semantics: TIMESLOT_OCCUPIED means the slot was
          // rebooked while this appointment was canceled — operator must
          // book new instead. NOT_CANCELED means another session already
          // restored it; refresh shows truth.
          if (res.error_code === 'TIMESLOT_OCCUPIED') {
            showToast(
              'That time slot is no longer available. Book a new appointment instead.',
              'error'
            );
          } else if (res.error_code === 'NOT_CANCELED') {
            showToast('This appointment is already active.', 'info');
            if (selectedCustomer) void fetchCustomerAppointments(selectedCustomer.customer_id);
          } else {
            showToast(res.error || 'Failed to reactivate appointment.', 'error');
          }
        } catch (e) {
          console.error(e);
          showToast('Failed to reactivate appointment.', 'error');
        }
      },
    });
  }

  const upcomingAppointments = useMemo(
    () =>
      customerAppointments.filter(
        (a) => a.status === 'scheduled' && new Date(a.start_time) > new Date()
      ),
    [customerAppointments]
  );

  const pastAppointments = useMemo(
    () =>
      customerAppointments.filter(
        (a) => a.status !== 'scheduled' || new Date(a.start_time) <= new Date()
      ),
    [customerAppointments]
  );

  const filteredCustomers = useMemo(() => {
    if (!searchQuery.trim()) return customers;
    const q = searchQuery.toLowerCase();
    return customers.filter(
      (c) =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.phone || '').includes(q) ||
        (c.email || '').toLowerCase().includes(q)
    );
  }, [customers, searchQuery]);

  async function handleSave() {
    if (!selectedCustomer) return;
    setSaving(true);

    try {
      const res = await Api.customers.update(
        selectedCustomer.customer_id,
        selectedCustomer.tenant_id,
        {
          first_name: editForm.first_name,
          last_name: editForm.last_name,
          name: `${editForm.first_name} ${editForm.last_name}`.trim(),
          phone: editForm.phone,
          email: editForm.email,
          address: editForm.address,
          address_line2: editForm.address_line2,
          city: editForm.city,
          state: editForm.state,
          postal_code: editForm.postal_code,
          timezone: editForm.timezone,
          notes: editForm.notes,
        }
      );

      if (res.success) {
        setIsEditing(false);
        setIsCreating(false);
        await fetchCustomers();
      } else {
        console.error('Failed to update customer', res.error);
      }
    } catch (e) {
      console.error(e);
    }
    setSaving(false);
  }

  async function handleCreate() {
    setSaving(true);

    try {
      const res = await Api.customers.create(tenantId, {
        first_name: editForm.first_name,
        last_name: editForm.last_name,
        name: `${editForm.first_name} ${editForm.last_name}`.trim(),
        phone: editForm.phone,
        email: editForm.email,
        address: editForm.address,
        address_line2: editForm.address_line2,
        city: editForm.city,
        state: editForm.state,
        postal_code: editForm.postal_code,
        timezone: editForm.timezone,
        notes: editForm.notes,
      });
      if (res.success) {
        setIsCreating(false);
        void fetchCustomers();
      }
    } catch (e) {
      console.error(e);
    }
    setSaving(false);
  }

  function handleDelete() {
    if (!selectedCustomer) return;
    confirm({
      title: 'Delete Customer',
      message: `Are you sure you want to delete ${selectedCustomer.name}? This cannot be undone.`,
      confirmLabel: 'Delete',
      onConfirm: async () => {
        closeConfirm();
        try {
          const res = await Api.customers.delete(selectedCustomer.customer_id);
          if (res.success) {
            setSelectedCustomer(null);
            void fetchCustomers();
          }
        } catch (e) {
          console.error(e);
        }
      },
    });
  }

  const startNewCustomer = () => {
    setIsCreating(true);
    setIsEditing(false);
    setSelectedCustomer(null);
    setEditForm({
      first_name: '',
      last_name: '',
      phone: '',
      email: '',
      address: '',
      address_line2: '',
      city: '',
      state: '',
      postal_code: '',
      timezone: 'America/New_York',
      notes: '',
    });
  };

  return (
    <div
      className="flex flex-1 overflow-hidden relative transition-colors duration-200"
      style={{ color: 'var(--text-primary)' }}
    >
      {/* ITEM LIST PANE */}
      <section
        className={`w-full md:w-80 flex flex-col ${showDetailOnMobile ? 'hidden md:flex' : 'flex'}`}
        style={{ backgroundColor: 'var(--bg-raised)', borderRight: '1px solid var(--border-soft)' }}
      >
        <header
          className="p-4 sticky top-0 z-10"
          style={{
            borderBottom: '1px solid var(--border-soft)',
            backgroundColor: 'var(--bg-surface)',
          }}
        >
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-bold">Customers</h2>
            <div className="flex space-x-1">
              <Button onClick={startNewCustomer} size="sm" className="gap-2">
                <UserPlus className="w-4 h-4" />
                Add Customer
              </Button>
              <Button variant="ghost" onClick={fetchCustomers} size="sm" className="p-1.5">
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
          <div className="relative">
            <Search
              className="w-4 h-4 absolute left-3 top-2.5"
              style={{ color: 'var(--text-muted)' }}
            />
            <input
              data-shortcut-target="search"
              type="text"
              placeholder="Search customers..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setFocusedIdx(-1);
              }}
              onKeyDown={(e) => {
                // ArrowDown from the search input → focus first row.
                // Enter (with a search term but no focused row yet) →
                // auto-select the first match.
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  if (filteredCustomers.length > 0) setFocusedIdx(0);
                } else if (e.key === 'Enter' && filteredCustomers.length > 0) {
                  e.preventDefault();
                  const first = filteredCustomers[0];
                  setSelectedCustomer(first);
                  setIsCreating(false);
                  setShowDetailOnMobile(true);
                }
              }}
              role="combobox"
              aria-expanded={filteredCustomers.length > 0}
              aria-controls="crm-customer-list"
              aria-activedescendant={
                focusedIdx >= 0
                  ? `crm-customer-row-${filteredCustomers[focusedIdx]?.customer_id}`
                  : undefined
              }
              className="w-full pl-9 pr-4 py-2 border-none rounded-md text-sm outline-none"
              style={{ backgroundColor: 'var(--bg-raised)', color: 'var(--text-primary)' }}
            />
          </div>
        </header>
        <div
          ref={listRef}
          id="crm-customer-list"
          role="listbox"
          aria-label="Customers"
          className="flex-1 overflow-y-auto pb-20 md:pb-0"
          onKeyDown={(e) => {
            // Keyboard nav through the filtered list. ArrowUp/Down
            // moves focus, Enter selects, Escape returns focus to
            // the search input.
            if (filteredCustomers.length === 0) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setFocusedIdx((i) => Math.min(i + 1, filteredCustomers.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setFocusedIdx((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter' && focusedIdx >= 0) {
              e.preventDefault();
              const c = filteredCustomers[focusedIdx];
              if (c) {
                setSelectedCustomer(c);
                setIsCreating(false);
                setShowDetailOnMobile(true);
              }
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setFocusedIdx(-1);
              document.querySelector<HTMLInputElement>('[data-shortcut-target="search"]')?.focus();
            }
          }}
        >
          {filteredCustomers.length === 0 && !loading && (
            <EmptyState
              icon={UserPlus}
              title={searchQuery ? `No customers match "${searchQuery}"` : 'No customers yet'}
              description={searchQuery ? undefined : 'Add your first customer to get started.'}
              variant="compact"
            />
          )}
          {filteredCustomers.map((c, idx) => {
            const isSelected = selectedCustomer?.customer_id === c.customer_id;
            const isFocused = focusedIdx === idx;
            return (
              <div
                key={c.customer_id}
                id={`crm-customer-row-${c.customer_id}`}
                role="option"
                tabIndex={isFocused ? 0 : -1}
                aria-selected={isSelected}
                ref={(el) => {
                  // Focus the row when it becomes the keyboard cursor target.
                  if (el && isFocused && document.activeElement !== el) el.focus();
                }}
                onMouseEnter={() => setFocusedIdx(-1)}
                onClick={() => {
                  setSelectedCustomer(c);
                  setIsCreating(false);
                  setShowDetailOnMobile(true);
                }}
                className={`p-4 cursor-pointer transition flex justify-between items-center outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${isSelected ? 'border-l-4' : ''}`}
                style={{
                  borderBottom: '1px solid var(--border-soft)',
                  ...(isSelected
                    ? { backgroundColor: 'var(--bg-surface)', borderLeftColor: 'var(--accent)' }
                    : isFocused
                      ? { backgroundColor: 'var(--accent-muted)' }
                      : {}),
                }}
              >
                <div>
                  <p
                    className="text-sm font-semibold"
                    style={{ color: isSelected ? 'var(--accent-soft)' : 'var(--text-primary)' }}
                  >
                    {c.name || 'Unknown'}
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                    {formatPhone(c.phone)}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
              </div>
            );
          })}
        </div>
      </section>

      {/* DETAIL PANE */}
      <CustomerDetailPanel
        selectedCustomer={selectedCustomer}
        isCreating={isCreating}
        isEditing={isEditing}
        saving={saving}
        showDetailOnMobile={showDetailOnMobile}
        editForm={editForm}
        summaries={summaries}
        upcomingAppointments={upcomingAppointments}
        pastAppointments={pastAppointments}
        onEditFormChange={handleEditFormChange}
        onEdit={() => setIsEditing(true)}
        onCancelEdit={() => {
          setIsEditing(false);
          setIsCreating(false);
        }}
        onSave={handleSave}
        onCreate={handleCreate}
        onDelete={handleDelete}
        onCancelAppointment={handleCancelAppointment}
        onReactivateAppointment={handleReactivateAppointment}
        onCloseMobile={() => {
          setShowDetailOnMobile(false);
          setIsCreating(false);
        }}
      />
      <ConfirmModal {...confirmState} onClose={closeConfirm} />
    </div>
  );
}
