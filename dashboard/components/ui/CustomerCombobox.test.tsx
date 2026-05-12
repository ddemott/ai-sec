import React, { useState } from 'react';
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CustomerCombobox, type CustomerOption } from './CustomerCombobox';

const customers: CustomerOption[] = [
  { customer_id: 'c1', name: 'Alice Smith', phone: '+15555550001' },
  { customer_id: 'c2', name: 'Bob Smithers', phone: '+15555550002' },
  { customer_id: 'c3', name: 'Carlos Rivera', phone: '+15558881234' },
  { customer_id: 'c4', name: 'Dana Lee', phone: null },
  { customer_id: 'c5', name: null, phone: '+15555550005' }, // edge case: no name
];

// Controlled wrapper so tests can verify selection persists.
function Harness(props: Partial<React.ComponentProps<typeof CustomerCombobox>>) {
  const { value: initialValue, onChange: externalOnChange, customers: customersOverride, ...rest } = props;
  const [value, setValue] = useState(initialValue ?? '');
  return (
    <CustomerCombobox
      customers={customersOverride ?? customers}
      selectTestId="cb-select"
      searchTestId="cb-search"
      {...rest}
      value={value}
      onChange={(id) => {
        setValue(id);
        externalOnChange?.(id);
      }}
    />
  );
}

describe('CustomerCombobox — front-desk audit P0 #3', () => {
  test('renders default label, placeholder, and prompt option when no overrides', () => {
    render(<Harness />);
    expect(screen.getByText('Customer')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search customers...')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Select customer...' })).toBeInTheDocument();
    // WHO: dashboard caller using the default-configured combobox | WHAT: default copy renders | WHEN: any consumer (QuickBook, AppointmentDetailPanel) uses without overrides | WHERE: CustomerCombobox | WHY: pin the default user-facing copy so a future props refactor that drops a default doesn't ship a blank-label control to production
  });

  test('typing into search filters options by name (case-insensitive)', () => {
    render(<Harness />);
    fireEvent.change(screen.getByTestId('cb-search'), { target: { value: 'smit' } });

    // Both Smith / Smithers should remain in the option list.
    expect(screen.getByRole('option', { name: /Alice Smith/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Bob Smithers/ })).toBeInTheDocument();
    // Carlos and Dana are filtered out.
    expect(screen.queryByRole('option', { name: /Carlos Rivera/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Dana Lee/ })).not.toBeInTheDocument();
    // Prompt remains.
    expect(screen.getByRole('option', { name: 'Select customer...' })).toBeInTheDocument();
    // WHO: front-desk operator with phone in hand | WHAT: typing the partial last name narrows the dropdown | WHEN: looking up a caller named "Mrs. Smith" mid-call | WHERE: CustomerCombobox filter logic | WHY: this is the primary UX win the audit identified — Hick's Law violation (50+-item raw select) → search-then-select. Test pins both halves: matches keep, non-matches drop, case-insensitive
  });

  test('typing into search filters by phone substring', () => {
    render(<Harness />);
    fireEvent.change(screen.getByTestId('cb-search'), { target: { value: '888' } });

    expect(screen.getByRole('option', { name: /Carlos Rivera/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Alice Smith/ })).not.toBeInTheDocument();
    // WHO: front-desk operator who has the caller's phone but not name | WHAT: phone-substring match works | WHEN: caller-ID showed an unfamiliar number, operator types the last 3 digits to look it up | WHERE: CustomerCombobox filter | WHY: real call-center workflow — name-only filter would force the operator to ask "may I get your name first" which is the friction the audit calls out
  });

  test('selecting an option calls onChange with the customer id', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(screen.getByTestId('cb-select'), { target: { value: 'c2' } });
    expect(onChange).toHaveBeenCalledWith('c2');
    // WHO: front-desk operator | WHAT: selection delivers the id (not the label, not the index) | WHEN: operator picks the matched customer from the dropdown | WHERE: CustomerCombobox onChange contract | WHY: callers wire side effects on the id (e.g. AppointmentDetailPanel pre-fills the customer's address); the contract must guarantee the id flows through
  });

  test('selecting the prompt option clears the value', () => {
    const onChange = vi.fn();
    render(<Harness value="c1" onChange={onChange} />);
    fireEvent.change(screen.getByTestId('cb-select'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith('');
    // WHO: operator who clicked the wrong customer | WHAT: explicit clear path back to no-selection | WHEN: backing out of an in-progress booking | WHERE: CustomerCombobox onChange | WHY: H3 (user control & freedom) — picking an option must be reversible; an empty-string clear lets the parent's required-field validation fire correctly on save
  });

  test('disabled prop disables both search input and select', () => {
    render(<Harness disabled />);
    expect(screen.getByTestId('cb-search')).toBeDisabled();
    expect(screen.getByTestId('cb-select')).toBeDisabled();
    // WHO: caller in a "saving..." state | WHAT: control locks during in-flight operations | WHEN: parent has set disabled=true (e.g. mid-save) | WHERE: CustomerCombobox | WHY: prevents the operator from changing the customer mid-save and submitting a different id than the one they confirmed
  });

  test('renders custom label, placeholder, and promptLabel when overridden', () => {
    render(<Harness label="Select Customer" placeholder="Find by name or phone" promptLabel="— pick one —" />);
    expect(screen.getByText('Select Customer')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Find by name or phone')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '— pick one —' })).toBeInTheDocument();
    // WHO: AppointmentDetailPanel consumer (uses "Select Customer" label) | WHAT: custom copy passes through to DOM | WHEN: a surface needs context-specific copy | WHERE: CustomerCombobox prop forwarding | WHY: pin the override path — the audit explicitly preserves AppointmentDetailPanel's "Select Customer" label, so callers must be able to override the default
  });

  test('formats phone in option labels via formatPhone', () => {
    render(<Harness />);
    // Default formatPhone for +15555550001 → "+1 (555) 555-0001"
    const alice = screen.getByRole('option', { name: /Alice Smith/ });
    expect(alice).toHaveTextContent('+1 (555) 555-0001');
    // WHO: operator scanning the dropdown | WHAT: phones rendered human-readable | WHEN: option list rendered | WHERE: CustomerCombobox option label | WHY: raw E.164 ("+15555550001") is hard to scan visually; matches the existing display pattern across the dashboard
  });

  test('option for customer with no phone omits the phone parens', () => {
    render(<Harness />);
    const dana = screen.getByRole('option', { name: 'Dana Lee' });
    expect(dana).toBeInTheDocument();
    expect(dana.textContent).toBe('Dana Lee');
    // WHO: any caller listing customers without phones | WHAT: no empty parens or stray "()" rendered | WHEN: customer record has phone=null | WHERE: CustomerCombobox option label | WHY: dirty render with "(undefined)" or empty parens would leak in production — the conditional formatter must drop both the parens and the space
  });

  test('option for customer with no name uses fallback label', () => {
    render(<Harness />);
    const noName = screen.getByRole('option', { name: /\(no name\)/ });
    expect(noName).toBeInTheDocument();
    // WHO: any caller with a partially-imported customer record | WHAT: option still selectable, label communicates the gap | WHEN: a customer was imported from a CRM with phone but no name yet | WHERE: CustomerCombobox option label | WHY: rendering "" as the label produces an invisible option the operator cannot click — a fallback label keeps the row reachable so the operator can still book or open the record
  });

  test('non-matching search shows only the prompt option', () => {
    render(<Harness />);
    fireEvent.change(screen.getByTestId('cb-search'), { target: { value: 'zzznomatch' } });
    // Only the prompt remains.
    const select = screen.getByTestId('cb-select');
    expect(select.querySelectorAll('option')).toHaveLength(1);
    expect(screen.getByRole('option', { name: 'Select customer...' })).toBeInTheDocument();
    // WHO: operator who mistyped or for whom no match exists | WHAT: empty result state preserves the prompt so the control isn't broken-looking | WHEN: filter excludes every customer | WHERE: CustomerCombobox | WHY: a visibly-empty <select> reads as "broken control"; keeping the prompt option signals "no matches — clear search and try again"
  });
});
