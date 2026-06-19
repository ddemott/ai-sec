import React from 'react';
import { expect, test, vi, beforeEach, describe } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CRMView from './components/CRMView';
import { MOCK_CUSTOMERS, MOCK_SUMMARIES } from './lib/mockData';

// Mock fetch
global.fetch = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    then: vi.fn((resolve) => resolve({ data: [], error: null })),
  },
}));

// SessionContext mock — must live at the top level so the
// hoisting Vitest does is honest. The earlier nested placement
// (mid-test body) worked by accident under Vitest 4.x but emits
// a deprecation warning that becomes an error in a future
// release (UX audit spawned-followup, 2026-05-18).
vi.mock('@/lib/SessionContext', () => ({
  useSessionContext: () => ({
    tenantId: 'f234e471-0e60-4163-86c9-93cfd9338e3a',
    userName: 'Test User',
    isAdmin: false,
    managedTenantId: 'f234e471-0e60-4163-86c9-93cfd9338e3a',
    managedTenantName: 'DynaTire',
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    selectManagedTenant: vi.fn(),
    tenantsVersion: 0,
    notifyTenantsChanged: vi.fn(),
  }),
  useActiveTenantId: () => 'f234e471-0e60-4163-86c9-93cfd9338e3a',
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const TENANT_ID = 'f234e471-0e60-4163-86c9-93cfd9338e3a';

// Mock appointments data
const MOCK_CUSTOMER_APPOINTMENTS = [
  {
    id: 'appt-1',
    start_time: new Date(Date.now() + 86400000).toISOString(), // tomorrow
    end_time: new Date(Date.now() + 86400000 + 3600000).toISOString(),
    status: 'scheduled',
    description: 'Oil Change',
    location: '123 Main St',
    resource_name: 'Service Truck 1',
    employee_name: 'Mike Tech',
  },
  {
    id: 'appt-2',
    start_time: new Date(Date.now() - 86400000 * 3).toISOString(), // 3 days ago
    end_time: new Date(Date.now() - 86400000 * 3 + 3600000).toISOString(),
    status: 'completed',
    description: 'Tire Rotation',
    location: '123 Main St',
    resource_name: 'Service Truck 1',
    employee_name: null,
  },
  {
    id: 'appt-3',
    start_time: new Date(Date.now() - 86400000 * 7).toISOString(), // 7 days ago
    end_time: new Date(Date.now() - 86400000 * 7 + 3600000).toISOString(),
    status: 'canceled',
    description: 'Brake Inspection',
    location: '456 Oak Ave',
    resource_name: 'Service Truck 2',
    employee_name: 'Jane Mechanic',
  },
];

/**
 * Helper to set up fetch mock that responds differently based on URL
 */
function setupFetchMock(overrides: Record<string, unknown> = {}) {
  (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
    if (url.includes('/customers/') && url.includes('/appointments')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => overrides.appointments ?? MOCK_CUSTOMER_APPOINTMENTS,
      });
    }
    if (url.includes('/call-summaries')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => overrides.summaries ?? MOCK_SUMMARIES,
      });
    }
    if (url.includes('/customers')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => overrides.customers ?? MOCK_CUSTOMERS,
      });
    }
    // Default
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => [],
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.setItem('tenantId', TENANT_ID);
});

describe('CRM Unified View - Search', () => {
  test('should filter customer list by search query', async () => {
    setupFetchMock();
    render(<CRMView />);

    // Wait for customers to load — use getAllByText since Bob appears in list and detail header
    await waitFor(() => {
      expect(screen.getAllByText('Bob Smith').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('Alice Johnson')).toBeDefined();

    // Type in search bar
    const searchInput = screen.getByPlaceholderText('Search customers...');
    fireEvent.change(searchInput, { target: { value: 'Bob' } });

    // The list pane should only show Bob. Alice should be gone from the list.
    // Bob still appears in the detail header, so we check Alice is gone entirely.
    expect(screen.queryByText('Alice Johnson')).toBeNull();
    expect(screen.getAllByText('Bob Smith').length).toBeGreaterThan(0);
    // WHO: tenant user | WHAT: search customers by name | WHEN: customer list loaded | WHERE: CRMView search | WHY: quickly find specific customer without scrolling
  });

  test('should filter by phone number', async () => {
    setupFetchMock();
    render(<CRMView />);

    await waitFor(() => {
      expect(screen.getAllByText('Bob Smith').length).toBeGreaterThan(0);
    });

    const searchInput = screen.getByPlaceholderText('Search customers...');
    fireEvent.change(searchInput, { target: { value: '5550001111' } });

    // Alice's phone matches, Bob's doesn't — but Bob still appears in detail header
    expect(screen.getByText('Alice Johnson')).toBeDefined();
    // WHO: tenant user | WHAT: search customers by phone | WHEN: customer list loaded | WHERE: CRMView search | WHY: find customer by phone when name is unknown
  });

  test('should show all customers when search is cleared', async () => {
    setupFetchMock();
    render(<CRMView />);

    await waitFor(() => {
      expect(screen.getAllByText('Bob Smith').length).toBeGreaterThan(0);
    });

    const searchInput = screen.getByPlaceholderText('Search customers...');
    fireEvent.change(searchInput, { target: { value: 'zzzznotfound' } });

    // Both should be gone from the list (but Bob may persist in detail header from prior selection)
    await waitFor(() => {
      expect(screen.queryByText('Alice Johnson')).toBeNull();
    });

    fireEvent.change(searchInput, { target: { value: '' } });
    expect(screen.getAllByText('Bob Smith').length).toBeGreaterThan(0);
    expect(screen.getByText('Alice Johnson')).toBeDefined();
    // WHO: tenant user | WHAT: clear search filter | WHEN: after filtering customers | WHERE: CRMView search | WHY: restore full customer list after narrowing results
  });
});

describe('CRM Unified View - Keyboard navigation (UX audit Flows 4.1.5)', () => {
  // The keyboard-nav layer (committed in a8fea43) gives front-desk
  // power-users a way to find + open a customer without leaving the
  // keyboard. Tests pin the contract for each transition so a future
  // refactor of the focus state machine surfaces here.

  test('HAPPY: ArrowDown from the search input arms the first row via aria-activedescendant', async () => {
    // WHO: a front-desk operator who pressed `/` to focus search, then
    //      ArrowDown to move into the list
    // WHAT: the search input's aria-activedescendant points at the
    //       first filtered row's id so screen readers track the
    //       keyboard cursor
    // WHEN: customers loaded, search input focused, ArrowDown pressed
    // WHERE: dashboard/components/CRMView.tsx — search-input onKeyDown
    // WHY: without aria-activedescendant, a screen reader would
    //      announce the search input but the visual focus would
    //      sit on a list row with no audible signal. Pins the
    //      combobox+listbox a11y contract.
    setupFetchMock();
    render(<CRMView />);
    await waitFor(() => {
      expect(screen.getAllByText('Bob Smith').length).toBeGreaterThan(0);
    });

    const searchInput = screen.getByPlaceholderText('Search customers...');
    expect(searchInput.getAttribute('aria-activedescendant')).toBeFalsy();

    fireEvent.keyDown(searchInput, { key: 'ArrowDown' });

    const activeId = searchInput.getAttribute('aria-activedescendant');
    expect(activeId).toBeTruthy();
    expect(activeId).toMatch(/^crm-customer-row-/);
  });

  test('HAPPY: Enter on search with results auto-selects the first match', async () => {
    // WHO: operator who typed a partial name and hit Enter — they
    //      expect the obvious match to open, not to have to ArrowDown
    //      first
    // WHAT: Enter pressed in the search input with results visible
    //       selects the first filtered customer (the detail pane
    //       header reflects the selection)
    // WHEN: customers loaded, search filtered to "Alice", Enter
    // WHERE: dashboard/components/CRMView.tsx — search onKeyDown Enter
    // WHY: matches Gmail/Slack quick-finder semantics — without the
    //      auto-select, the operator pays an extra ArrowDown for an
    //      unambiguous match.
    setupFetchMock();
    render(<CRMView />);
    await waitFor(() => {
      expect(screen.getAllByText('Bob Smith').length).toBeGreaterThan(0);
    });

    const searchInput = screen.getByPlaceholderText('Search customers...');
    fireEvent.change(searchInput, { target: { value: 'Alice' } });

    // The detail pane initially shows Bob (auto-selected on mount).
    // Pin pre-state: an Alice h1 is NOT yet in the document; only
    // her list row is. After Enter, an h1 with her name should
    // appear in the detail pane.
    await waitFor(() => {
      expect(screen.queryByRole('heading', { level: 1, name: /^Alice Johnson$/ })).toBeNull();
    });

    fireEvent.keyDown(searchInput, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.queryByRole('heading', { level: 1, name: /^Alice Johnson$/ })).toBeTruthy();
    });
  });

  test('HAPPY: Escape from the customer list returns focus to the search input', async () => {
    // WHO: operator who pressed `/` to search, ArrowDown'd into the
    //      list, then changed their mind and wants to refine the
    //      search query
    // WHAT: Escape pressed on the listbox restores focus to the
    //       search input
    // WHEN: list focused (ArrowDown landed there), Escape pressed
    // WHERE: dashboard/components/CRMView.tsx — list onKeyDown Escape
    // WHY: without an explicit Escape return-path, the operator has
    //      to mouse-click back to search — defeating the point of
    //      the `/`-then-Arrow workflow.
    setupFetchMock();
    render(<CRMView />);
    await waitFor(() => {
      expect(screen.getAllByText('Bob Smith').length).toBeGreaterThan(0);
    });

    const searchInput = screen.getByPlaceholderText('Search customers...');
    fireEvent.keyDown(searchInput, { key: 'ArrowDown' });

    const list = document.getElementById('crm-customer-list');
    expect(list).toBeTruthy();
    fireEvent.keyDown(list!, { key: 'Escape' });

    // Focus should be back on the search input. jsdom doesn't always
    // fire focus listeners synchronously, but document.activeElement
    // reflects the focus call this code path makes.
    expect(document.activeElement).toBe(searchInput);
  });

  test('SAD: ArrowDown with no filtered results is a no-op', async () => {
    // WHO: operator who typed a query that matches no customers and
    //      reflexively pressed ArrowDown
    // WHAT: the search input's aria-activedescendant stays empty —
    //      no row is armed because there are no rows
    // WHEN: filtered list is empty, ArrowDown pressed
    // WHERE: dashboard/components/CRMView.tsx — onKeyDown guard
    //        `if (filteredCustomers.length === 0) return`
    // WHY: a UI that arms a phantom row on ArrowDown would either
    //      crash on Enter or trap focus on an invisible target —
    //      both are worse than doing nothing.
    setupFetchMock();
    render(<CRMView />);
    await waitFor(() => {
      expect(screen.getAllByText('Bob Smith').length).toBeGreaterThan(0);
    });

    const searchInput = screen.getByPlaceholderText('Search customers...');
    fireEvent.change(searchInput, { target: { value: 'zzzzz-no-match' } });
    // The list (id="crm-customer-list") should empty out, even if
    // the detail-pane h1 still shows Bob (auto-selected on mount).
    await waitFor(() => {
      const list = document.getElementById('crm-customer-list');
      expect(list?.querySelectorAll('[role="option"]').length || 0).toBe(0);
    });

    fireEvent.keyDown(searchInput, { key: 'ArrowDown' });

    expect(searchInput.getAttribute('aria-activedescendant')).toBeFalsy();
  });
});

describe('CRM Unified View - Upcoming Appointments', () => {
  test('should display upcoming appointments section when customer is selected', async () => {
    setupFetchMock();
    render(<CRMView />);

    // First customer is auto-selected, wait for appointments to load
    await waitFor(() => {
      expect(screen.getByText('Upcoming Appointments')).toBeDefined();
    });

    // Should show the scheduled future appointment
    await waitFor(() => {
      expect(screen.getByText('Oil Change')).toBeDefined();
    });
    // WHO: tenant user | WHAT: view upcoming appointments | WHEN: customer selected | WHERE: CRMView detail panel | WHY: see what is scheduled next for this customer
  });

  test('should show resource and employee name on appointment cards', async () => {
    setupFetchMock();
    render(<CRMView />);

    await waitFor(() => {
      expect(screen.getByText('Oil Change')).toBeDefined();
    });

    // Service Truck 1 appears on multiple cards, so use getAllByText
    expect(screen.getAllByText(/Service Truck 1/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Mike Tech/).length).toBeGreaterThan(0);
    // WHO: tenant user | WHAT: view resource and employee on appointment | WHEN: appointments loaded | WHERE: CRMView appointment cards | WHY: know which staff and resource are assigned to each job
  });

  test('should show cancel button on upcoming appointments', async () => {
    setupFetchMock();
    render(<CRMView />);

    await waitFor(() => {
      expect(screen.getByText('Oil Change')).toBeDefined();
    });

    // Should have a cancel button
    const cancelButtons = screen.getAllByLabelText(/cancel appointment/i);
    expect(cancelButtons.length).toBeGreaterThan(0);
    // WHO: tenant user | WHAT: see cancel action on upcoming appointment | WHEN: future appointment displayed | WHERE: CRMView appointment cards | WHY: allow quick cancellation without navigating away
  });
});

describe('CRM Unified View - Appointment History', () => {
  test('should display past appointments section', async () => {
    setupFetchMock();
    render(<CRMView />);

    await waitFor(() => {
      expect(screen.getByText('Appointment History')).toBeDefined();
    });
    // WHO: tenant user | WHAT: view appointment history section | WHEN: customer selected | WHERE: CRMView detail panel | WHY: review past service interactions for context
  });

  test('should show completed and canceled appointments in history', async () => {
    setupFetchMock();
    render(<CRMView />);

    await waitFor(() => {
      expect(screen.getByText('Tire Rotation')).toBeDefined();
      expect(screen.getByText('Brake Inspection')).toBeDefined();
    });
    // WHO: tenant user | WHAT: view completed and canceled appointments | WHEN: customer has past appointments | WHERE: CRMView history section | WHY: see full service history including cancellations
  });

  test('should show status badges on past appointments', async () => {
    setupFetchMock();
    render(<CRMView />);

    await waitFor(() => {
      expect(screen.getByText('Completed')).toBeDefined();
      expect(screen.getByText('Canceled')).toBeDefined();
    });
    // WHO: tenant user | WHAT: view status badges on past appointments | WHEN: history loaded | WHERE: CRMView history section | WHY: distinguish completed jobs from canceled ones at a glance
  });
});

describe('CRM Unified View - AI Call History', () => {
  test('should display call summaries section', async () => {
    setupFetchMock();
    render(<CRMView />);

    await waitFor(() => {
      expect(screen.getByText('AI Call History')).toBeDefined();
    });

    await waitFor(() => {
      expect(screen.getByText(/Bob called to ask about pricing/)).toBeDefined();
    });
    // WHO: tenant user | WHAT: view AI call summaries | WHEN: customer selected with call history | WHERE: CRMView call history section | WHY: review what the AI discussed with the customer
  });
});

describe('CRM Unified View - Cancel Appointment Flow', () => {
  test('should cancel an appointment and refresh the list', async () => {
    setupFetchMock();
    render(<CRMView />);

    await waitFor(() => {
      expect(screen.getByText('Oil Change')).toBeDefined();
    });

    // Click cancel on the upcoming appointment — opens confirmation modal
    const cancelButton = screen.getAllByLabelText(/cancel appointment/i)[0];
    fireEvent.click(cancelButton);

    // Confirm in the modal — click the button (not the title)
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeDefined();
    });
    const confirmBtn = screen
      .getAllByText('Cancel Appointment')
      .find((el) => el.tagName === 'BUTTON')!;
    fireEvent.click(confirmBtn);

    // Should have called the cancel endpoint
    await waitFor(() => {
      const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const cancelCall = calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' && c[0].includes('/appointments/') && c[0].includes('/cancel')
      );
      expect(cancelCall).toBeDefined();
    });
    // WHO: tenant user | WHAT: cancel an upcoming appointment | WHEN: appointment is in the future | WHERE: CRMView appointment card | WHY: allow front-desk staff to cancel on behalf of customer
  });
});

describe('CRM Unified View - Empty States', () => {
  test('should show message when no upcoming appointments', async () => {
    setupFetchMock({ appointments: [] });
    render(<CRMView />);

    await waitFor(() => {
      expect(screen.getByText(/no upcoming appointments/i)).toBeDefined();
    });
    // WHO: tenant user | WHAT: see empty upcoming appointments state | WHEN: customer has no future bookings | WHERE: CRMView detail panel | WHY: confirm no upcoming work rather than showing blank space
  });

  test('should show message when no appointment history', async () => {
    setupFetchMock({ appointments: [] });
    render(<CRMView />);

    await waitFor(() => {
      expect(screen.getByText(/no past appointments/i)).toBeDefined();
    });
    // WHO: tenant user | WHAT: see empty appointment history state | WHEN: customer is new with no past visits | WHERE: CRMView history section | WHY: clearly indicate no prior service history exists
  });
});
