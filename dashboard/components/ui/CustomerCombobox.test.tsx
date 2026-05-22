import React, { useState } from 'react';
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
  const {
    value: initialValue,
    onChange: externalOnChange,
    customers: customersOverride,
    ...rest
  } = props;
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
    render(
      <Harness
        label="Select Customer"
        placeholder="Find by name or phone"
        promptLabel="— pick one —"
      />
    );
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

describe('CustomerCombobox — walk-in creation (modal)', () => {
  test('no create affordance when onCreateCustomer is omitted', () => {
    render(<Harness />);
    expect(screen.queryByTestId('customer-create-open')).not.toBeInTheDocument();
    // WHO: AppointmentDetailPanel (creation lives elsewhere there) | WHAT: the "New customer" affordance is opt-in, absent by default | WHEN: a consumer renders the combobox without wiring a create handler | WHERE: CustomerCombobox onCreateCustomer gate | WHY: adding inline create to every consumer would put a half-wired button (no handler) on surfaces that don't want it — the prop must gate the entire feature
  });

  test('create affordance appears when onCreateCustomer is provided', () => {
    render(<Harness onCreateCustomer={vi.fn()} />);
    expect(screen.getByTestId('customer-create-open')).toBeInTheDocument();
    // WHO: front-desk operator at the counter with a walk-in | WHAT: the entry point to add a not-yet-existing customer is visible | WHEN: QuickBook wires a create handler | WHERE: CustomerCombobox | WHY: this is the whole point — a walk-in who isn't in the system had no path; the affordance is that path
  });

  test('opening create opens the modal, splitting the search term into first + last name', () => {
    render(<Harness onCreateCustomer={vi.fn()} />);
    fireEvent.change(screen.getByTestId('cb-search'), { target: { value: 'Jane Walk-in' } });
    fireEvent.click(screen.getByTestId('customer-create-open'));

    expect(screen.getByTestId('customer-create-form')).toBeInTheDocument();
    expect(screen.getByTestId('customer-create-first-name')).toHaveValue('Jane');
    expect(screen.getByTestId('customer-create-last-name')).toHaveValue('Walk-in');
    // WHO: operator who typed the caller's name into search, found nothing, then clicked New | WHAT: the typed name carries into the modal SPLIT across first/last so it isn't re-keyed and the name columns actually populate | WHERE: CustomerCombobox seed split → CustomerCreateModal | WHY: the single "Full name" field this modal replaced couldn't fill the split first_name/last_name columns the record stores; splitting the seed both saves re-typing and fixes the column the old form lost
  });

  test('submitting with empty first name shows a validation error and does NOT call the handler', () => {
    const onCreate = vi.fn();
    render(<Harness onCreateCustomer={onCreate} />);
    fireEvent.click(screen.getByTestId('customer-create-open'));
    // first name empty (no search term), phone present
    fireEvent.change(screen.getByLabelText('Phone Number'), {
      target: { value: '6305551234' },
    });
    fireEvent.click(screen.getByTestId('customer-create-save'));

    expect(screen.getByRole('alert')).toHaveTextContent('First name is required.');
    expect(onCreate).not.toHaveBeenCalled();
    // WHO: operator who clicked Add before typing a name | WHAT: client-side guard blocks the empty submit | WHEN: first-name field blank | WHERE: CustomerCreateModal submit | WHY: backend derives name from first+last and requires name min(1); catching it inline avoids a round-trip + a server-shaped error, and the handler must not fire so no malformed POST is attempted
  });

  test('submitting with empty phone shows a validation error and does NOT call the handler', () => {
    const onCreate = vi.fn();
    render(<Harness onCreateCustomer={onCreate} />);
    fireEvent.click(screen.getByTestId('customer-create-open'));
    fireEvent.change(screen.getByTestId('customer-create-first-name'), {
      target: { value: 'Jane' },
    });
    // phone left empty
    fireEvent.click(screen.getByTestId('customer-create-save'));

    expect(screen.getByRole('alert')).toHaveTextContent('Phone is required.');
    expect(onCreate).not.toHaveBeenCalled();
    // WHO: operator who entered a name but no number | WHAT: phone guard fires | WHEN: phone blank | WHERE: CustomerCreateModal submit | WHY: backend CustomerCreateSchema requires phone min(1) — without the inline guard the operator would get a generic server error after a wasted round-trip
  });

  test('successful create derives name from first+last, hands the full draft to the handler, and selects the returned customer', async () => {
    const onCreate = vi
      .fn()
      .mockResolvedValue({ customer_id: 'new99', name: 'Jane Doe', phone: '+16305551234' });
    const onChange = vi.fn();
    render(<Harness onCreateCustomer={onCreate} onChange={onChange} />);

    fireEvent.click(screen.getByTestId('customer-create-open'));
    fireEvent.change(screen.getByTestId('customer-create-first-name'), {
      target: { value: 'Jane' },
    });
    fireEvent.change(screen.getByTestId('customer-create-last-name'), {
      target: { value: 'Doe' },
    });
    fireEvent.change(screen.getByLabelText('Phone Number'), {
      target: { value: '6305551234' },
    });
    fireEvent.click(screen.getByTestId('customer-create-save'));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('new99'));
    // Draft carries the split fields AND the derived full name; PhoneInput
    // normalizes the typed digits to E.164.
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        first_name: 'Jane',
        last_name: 'Doe',
        name: 'Jane Doe',
        phone: '+16305551234',
      })
    );
    // modal closes on success
    await waitFor(() =>
      expect(screen.queryByTestId('customer-create-form')).not.toBeInTheDocument()
    );
    // WHO: operator booking a walk-in end-to-end | WHAT: create → auto-select in one flow, derived name + split fields handed to the caller, modal dismissed | WHEN: required fields valid and the handler resolves a customer | WHERE: CustomerCreateModal submit happy path | WHY: the feature's contract is "add and it's selected"; deriving name from first+last is the whole point of the modal — the record stores the split the old single-field form could not
  });

  test('failed create (handler resolves null) shows an error and does NOT select', async () => {
    const onCreate = vi.fn().mockResolvedValue(null);
    const onChange = vi.fn();
    render(<Harness onCreateCustomer={onCreate} onChange={onChange} />);

    fireEvent.click(screen.getByTestId('customer-create-open'));
    fireEvent.change(screen.getByTestId('customer-create-first-name'), {
      target: { value: 'Jane' },
    });
    fireEvent.change(screen.getByLabelText('Phone Number'), {
      target: { value: '6305551234' },
    });
    fireEvent.click(screen.getByTestId('customer-create-save'));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(onChange).not.toHaveBeenCalled();
    // modal stays open so the operator can retry without re-typing
    expect(screen.getByTestId('customer-create-form')).toBeInTheDocument();
    // WHO: operator when the create POST fails (dup phone, server error) | WHAT: error surfaced, no phantom selection, modal preserved for retry | WHEN: the handler resolves null/throws | WHERE: CustomerCreateModal submit failure branch | WHY: selecting a customer that wasn't actually created would let the operator book against a non-existent customer_id; the failure must block selection AND keep the typed values for a retry
  });

  test('cancel closes the modal without creating', () => {
    const onCreate = vi.fn();
    render(<Harness onCreateCustomer={onCreate} />);
    fireEvent.click(screen.getByTestId('customer-create-open'));
    expect(screen.getByTestId('customer-create-form')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('customer-create-cancel'));
    expect(screen.queryByTestId('customer-create-form')).not.toBeInTheDocument();
    expect(screen.getByTestId('cb-select')).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
    // WHO: operator who opened create by mistake or found the customer after all | WHAT: a clean back-out path to search-and-pick | WHEN: Cancel clicked | WHERE: CustomerCreateModal onClose | WHY: H3 user-control-and-freedom — opening the modal must be reversible, and cancelling must not fire the create handler
  });

  test('affordance label widens to name the walk-in when search has no matches', () => {
    render(<Harness onCreateCustomer={vi.fn()} />);
    fireEvent.change(screen.getByTestId('cb-search'), { target: { value: 'Zzz Nobody' } });
    expect(screen.getByTestId('customer-create-open')).toHaveTextContent(
      'Add "Zzz Nobody" as a new customer'
    );
    // WHO: operator who searched for a caller not in the system | WHAT: the empty-result state turns the generic affordance into a targeted "Add X" call to action | WHEN: the filter excludes every existing customer | WHERE: CustomerCombobox affordance label | WHY: "no matches" is exactly the moment a walk-in needs creating; surfacing their typed name in the button makes the next action obvious instead of leaving a dead-end empty list
  });
});
