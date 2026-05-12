import React, { useState, useMemo } from 'react';
import { Search } from 'lucide-react';
import { formatPhone } from '../../lib/phone';

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
}: CustomerComboboxProps) {
  const [searchTerm, setSearchTerm] = useState('');

  const filtered = useMemo(() => {
    if (!searchTerm) return customers;
    const term = searchTerm.toLowerCase();
    return customers.filter((c) => {
      const nameMatch = (c.name || '').toLowerCase().includes(term);
      const phoneMatch = (c.phone || '').includes(searchTerm);
      return nameMatch || phoneMatch;
    });
  }, [customers, searchTerm]);

  return (
    <div>
      {label && (
        <label className="block text-xs font-bold uppercase mb-1" style={{ color: 'var(--text-muted, #888)' }}>
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
          className="w-full pl-9 pr-4 py-2 bg-gray-50 dark:bg-[#222] border border-gray-200 dark:border-gray-800 rounded-lg text-sm outline-none disabled:opacity-60"
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
    </div>
  );
}
