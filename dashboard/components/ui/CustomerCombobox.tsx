import React, { useState, useMemo } from 'react';
import { Search, UserPlus } from 'lucide-react';
import { formatPhone } from '../../lib/phone';
import { CustomerCreateModal, type CustomerCreateDraft } from './CustomerCreateModal';

export interface CustomerOption {
  customer_id: string;
  name?: string | null;
  phone?: string | null;
}

export interface CustomerComboboxProps {
  /** Available customers to search/select from. */
  customers: CustomerOption[];
  /** Current selected customer ID, or empty string for no selection. */
  value: string;
  /** Called with the new customer ID (or "" when the prompt option is picked). */
  onChange: (id: string) => void;
  /** Label rendered above the search input. */
  label?: string;
  /** Placeholder for the search input. */
  placeholder?: string;
  /** Prompt option text shown when nothing is selected. */
  promptLabel?: string;
  /** Disable the entire control. */
  disabled?: boolean;
  /** Optional data-testid for the select element. */
  selectTestId?: string;
  /** Optional data-testid for the search input. */
  searchTestId?: string;
  /**
   * When provided, a "New customer" affordance appears beneath the select.
   * Picking it opens the walk-in modal (full contact form: split first/last
   * name, phone, email, address, timezone, notes); on submit the handler is
   * called and must resolve to the created customer (or null on failure).
   * The combobox then selects the new customer via `onChange`. Omit this prop
   * to keep the control search-and-pick only (e.g. the appointment detail
   * panel, where customer creation lives elsewhere).
   *
   * WHY a callback rather than calling the API here: the combobox stays
   * presentational, and the caller owns the customer list it renders from —
   * so the caller appends the new record to its own state on success, which
   * is what makes the new option appear in the select.
   */
  onCreateCustomer?: (draft: CustomerCreateDraft) => Promise<CustomerOption | null>;
}

/**
 * Two-element customer picker: a Search-icon input filters a native <select>
 * by name (case-insensitive) or phone substring. Replaces the
 * 50+-item raw <select> in AppointmentDetailPanel and consolidates the
 * inline search-then-select pattern QuickBookPanel had been carrying.
 *
 * The control is uncontrolled with respect to the search term — typing only
 * filters the visible options. The selected value flows through `value` /
 * `onChange` so callers can wire side effects (e.g. AppointmentDetailPanel's
 * address pre-fill on customer change).
 *
 * When `onCreateCustomer` is supplied, a walk-in who isn't in the system yet
 * can be added via a modal (full contact form) without leaving the panel —
 * the most time-pressured front-desk case.
 */
export function CustomerCombobox({
  customers,
  value,
  onChange,
  label = 'Customer',
  placeholder = 'Search customers...',
  promptLabel = 'Select customer...',
  disabled = false,
  selectTestId,
  searchTestId,
  onCreateCustomer,
}: CustomerComboboxProps) {
  const [searchTerm, setSearchTerm] = useState('');
  // `creating` toggles the walk-in modal. The modal owns its own field state;
  // the first/last name seed from the current search term (split below) so
  // typing a name then clicking "New customer" carries it over.
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    if (!searchTerm) return customers;
    const term = searchTerm.toLowerCase();
    return customers.filter((c) => {
      const nameMatch = (c.name || '').toLowerCase().includes(term);
      const phoneMatch = (c.phone || '').includes(searchTerm);
      return nameMatch || phoneMatch;
    });
  }, [customers, searchTerm]);

  // Split the search term into a first/last seed for the walk-in modal:
  // first word → first name, the rest → last name. So "Mary Jane Smith"
  // seeds first="Mary", last="Jane Smith".
  const seedParts = searchTerm.trim().split(/\s+/).filter(Boolean);
  const seedFirstName = seedParts[0] ?? '';
  const seedLastName = seedParts.slice(1).join(' ');

  return (
    <div>
      {label && (
        <label
          className="block text-xs font-bold uppercase mb-1"
          style={{ color: 'var(--text-muted, #888)' }}
        >
          {label}
        </label>
      )}

      <div className="relative mb-2">
        <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" aria-hidden="true" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={placeholder}
          data-testid={searchTestId}
          className="w-full pl-9 pr-4 py-2 bg-gray-50 dark:bg-[#222] border border-gray-200 dark:border-gray-800 rounded-lg text-sm outline-none"
        />
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        data-testid={selectTestId}
        className="w-full p-2.5 bg-gray-50 dark:bg-[#222] border border-gray-200 dark:border-gray-800 rounded-lg text-sm font-bold disabled:opacity-60"
      >
        <option value="">{promptLabel}</option>
        {filtered.map((c) => (
          <option key={c.customer_id} value={c.customer_id}>
            {c.name || '(no name)'}
            {c.phone ? ` (${formatPhone(c.phone)})` : ''}
          </option>
        ))}
      </select>
      {/* New-customer affordance — only when the caller wired a create
          handler. When the search filtered everything out, the prompt
          widens to name the walk-in case explicitly. Opens the walk-in modal. */}
      {onCreateCustomer && (
        <button
          type="button"
          onClick={() => setCreating(true)}
          disabled={disabled}
          data-testid="customer-create-open"
          className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold disabled:opacity-60"
          style={{ color: 'var(--accent-soft)' }}
        >
          <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
          {searchTerm.trim() && filtered.length === 0
            ? `Add "${searchTerm.trim()}" as a new customer`
            : 'New customer (walk-in)'}
        </button>
      )}

      {onCreateCustomer && (
        <CustomerCreateModal
          isOpen={creating}
          seedFirstName={seedFirstName}
          seedLastName={seedLastName}
          onClose={() => setCreating(false)}
          onCreate={onCreateCustomer}
          onCreated={(c) => {
            // Select the new walk-in and clear the search so the freshly
            // created record is the visible selection, not a filtered list.
            onChange(c.customer_id);
            setSearchTerm('');
          }}
        />
      )}
    </div>
  );
}
