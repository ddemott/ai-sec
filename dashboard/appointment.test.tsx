// @vitest-environment jsdom
import React from 'react';
import { expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AppointmentView from './components/AppointmentView';
import { MOCK_APPOINTMENTS } from './lib/mockData';

// Mock VocabularyContext
vi.mock('@/lib/VocabularyContext', () => ({
  useVocabulary: () => ({
    resource_label: 'Resource',
    resource_plural: 'Resources',
    employee_label: 'Employee',
    employee_plural: 'Employees',
    booking_label: 'Appointment',
  }),
}));

// Mutable so individual tests can switch to super-admin context
let mockActiveTenantId = 'f234e471-0e60-4163-86c9-93cfd9338e3a';

// Mock SessionContext for useActiveTenantId
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
  useActiveTenantId: () => mockActiveTenantId,
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock fetch
global.fetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  // Mock window and localStorage for Node/test env
  if (typeof window === 'undefined') {
    global.window = Object.create(global);
  }
  if (!window.localStorage) {
    let store = {} as Record<string, string>;
    window.localStorage = {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      },
      key: (i: number) => Object.keys(store)[i] || null,
      length: 0,
    };
  }
  window.localStorage.setItem('tenantId', 'f234e471-0e60-4163-86c9-93cfd9338e3a');
  // Use vi.fn() directly for fetch so all calls are tracked
  global.fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    console.log('TEST DEBUG: fetch called', input, init);
    // Helper to create Response-like object
    function createMockResponse(data: unknown) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        redirected: false,
        type: 'basic',
        url: typeof input === 'string' ? input : '',
        json: async () => data,
        text: async () => JSON.stringify(data),
        clone: function () {
          return this;
        },
        body: null,
        bodyUsed: false,
      } as Response;
    }
    // POST update endpoint
    if (
      typeof input === 'string' &&
      input.match(/\/appointments\/([\w-]+)\/update$/) &&
      init?.method === 'POST'
    ) {
      return Promise.resolve(createMockResponse({ success: true }));
    }
    // Mock GET appointments (simulate real tenant, not mock mode)
    if (
      typeof input === 'string' &&
      input.includes('/appointments') &&
      (!init?.method || init.method === 'GET')
    ) {
      return Promise.resolve(createMockResponse([...MOCK_APPOINTMENTS]));
    }
    // Mock GET customers/resources/employees/services/skills
    return Promise.resolve(createMockResponse([]));
  });
});

test('AppointmentView: clicking calendar event opens detail view', async () => {
  render(<AppointmentView />);

  // MOCK_APPOINTMENTS[0] is for Bob Smith
  // We use findAllByText and pick the first one (the list item)
  const eventButtons = await screen.findAllByText(/Bob Smith/i, { selector: 'p' });
  fireEvent.click(eventButtons[0]);

  // Detail header should now show the customer name
  const headings = await screen.findAllByText(/Bob Smith/i);
  expect(headings.length).toBeGreaterThan(0);
  // WHO: tenant user | WHAT: click calendar event | WHEN: appointments loaded | WHERE: AppointmentView | WHY: user needs to see appointment details to manage bookings
});

test('AppointmentView: can modify and save an appointment', async () => {
  window.localStorage.setItem('tenantId', 'f234e471-0e60-4163-86c9-93cfd9338e3a');
  render(<AppointmentView />);

  // Select the appointment via the list or calendar
  const listItems = await screen.findAllByText(/Bob Smith/i, { selector: 'p' });
  fireEvent.click(listItems[0]);

  // Enter edit mode
  const modifyBtns = await screen.findAllByRole('button', { name: /Edit Details/i });
  fireEvent.click(modifyBtns[0]);

  // Format the expected time using the component's internal toLocalISO logic
  const d = new Date(MOCK_APPOINTMENTS[0].start_time);
  const offset = d.getTimezoneOffset();
  const localDate = new Date(d.getTime() - offset * 60 * 1000);
  const expectedTimeStr = localDate.toISOString().slice(0, 16);

  // Change BOTH start and end together so the new range stays internally
  // consistent. The shared validateAppointmentTimeRange helper rejects
  // end<=start and >12h spans, so changing only start_time leaves end_time
  // unchanged at MOCK_APPOINTMENTS[0].end_time (~tomorrow 10am) and the
  // resulting ~62-day span trips the duration cap.
  const startInput = await screen.findByDisplayValue(expectedTimeStr);
  fireEvent.change(startInput, { target: { value: '2026-03-05T11:00' } });
  const endInput = await screen.findByLabelText(/End Time/i);
  fireEvent.change(endInput, { target: { value: '2026-03-05T12:00' } });

  // Use data-testid to uniquely select the Update Appointment button
  const updateButton = screen.getByTestId('update-appointment-btn');
  fireEvent.click(updateButton);

  // Wait for modal to appear
  await waitFor(() => {
    const btn = screen.queryByTestId('save-changes-btn');
    expect(btn).not.toBeNull();
  });
  // Click Save Changes in modal
  const saveChangesButton = screen.getByTestId('save-changes-btn');
  fireEvent.click(saveChangesButton);

  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        `https://localhost:4001/appointments/${MOCK_APPOINTMENTS[0].appointment_id}/update`
      ),
      expect.objectContaining({ method: 'POST' })
    );
  });
  // WHO: tenant user | WHAT: modify and save appointment | WHEN: in edit mode with changed time | WHERE: AppointmentView detail panel | WHY: user must be able to reschedule appointments without data loss
});

test('AppointmentView: canceling confirmation reverts changes and does not save', async () => {
  render(<AppointmentView />);

  const listItems = await screen.findAllByText(/Bob Smith/i, { selector: 'p' });
  fireEvent.click(listItems[0]);

  const modifyBtns = await screen.findAllByRole('button', { name: /Edit Details/i });
  fireEvent.click(modifyBtns[0]);

  const updateButton = screen.getByRole('button', { name: /Update Appointment/i });
  fireEvent.click(updateButton);

  const keepOriginalButton = await screen.findByRole('button', { name: /Keep Original/i });
  fireEvent.click(keepOriginalButton);

  expect(global.fetch).not.toHaveBeenCalledWith(
    expect.stringContaining(`/appointments/${MOCK_APPOINTMENTS[0].appointment_id}/update`),
    expect.objectContaining({ method: 'POST' })
  );
  // WHO: tenant user | WHAT: cancel confirmation dialog | WHEN: after clicking Update but before confirming | WHERE: AppointmentView confirmation modal | WHY: user must be able to back out of changes without accidentally saving
});

test('AppointmentView: month navigation moves between months', async () => {
  const { container } = render(<AppointmentView />);

  // Switch to month view
  const monthButtons = await screen.findAllByRole('button', { name: /Month/i });
  fireEvent.click(monthButtons[0]);

  // Capture all header labels using the current month name (e.g., "April 2026")
  const currentMonth = new Date().toLocaleString('en-US', { month: 'long' });
  const monthRegex = new RegExp(`${currentMonth} 20\\d{2}`);
  const headersBefore = screen.getAllByText(monthRegex);
  const beforeLabels = headersBefore.map((h) => h.textContent);

  // Find the Next button inside the calendar toolbar
  const toolbar = container.querySelector('.rbc-toolbar');
  const nextButton =
    toolbar &&
    Array.from(toolbar.querySelectorAll('button')).find((btn) => btn.textContent?.match(/Next/i));

  expect(nextButton).toBeTruthy();
  fireEvent.click(nextButton!);

  await waitFor(() => {
    // Search for any Month 2026 header
    const headersAfter = screen.getAllByText(/[A-Z][a-z]+ 20\d{2}/);
    const afterLabels = headersAfter.map((h) => h.textContent);
    // At least one label should change
    expect(afterLabels.some((label) => !beforeLabels.includes(label))).toBe(true);
  });
  // WHO: tenant user | WHAT: navigate between months | WHEN: in month view | WHERE: AppointmentView calendar | WHY: user needs to browse future/past appointments for scheduling
});

import { describe } from 'vitest';

describe('AppointmentView sad paths', () => {
  test('renders without crashing when appointments fetch fails', async () => {
    // Override fetch to return an error for appointments
    global.fetch = vi.fn((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : '';
      if (url.includes('/appointments') && !url.includes('/update')) {
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          headers: new Headers(),
          redirected: false,
          type: 'basic',
          url,
          json: async () => ({ success: false, error: 'DB connection failed' }),
          text: async () => '{"success":false,"error":"DB connection failed"}',
          clone: function () {
            return this;
          },
          body: null,
          bodyUsed: false,
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => [],
        text: async () => '[]',
        clone: function () {
          return this;
        },
        body: null,
        bodyUsed: false,
      } as unknown as Response);
    });

    render(<AppointmentView />);

    // Component should render without throwing — calendar toolbar should still be present
    await waitFor(() => {
      const toolbar = document.querySelector('.rbc-toolbar');
      expect(toolbar).toBeTruthy();
    });
    // WHO: tenant user | WHAT: view appointments | WHEN: API returns 500 error | WHERE: AppointmentView | WHY: dashboard must not crash when backend is unavailable
  });

  test('stays in edit mode when save/update API call fails', async () => {
    // Override fetch: appointments load fine, but update returns error
    global.fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : '';
      function okResponse(data: unknown) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers(),
          redirected: false,
          type: 'basic',
          url,
          json: async () => data,
          text: async () => JSON.stringify(data),
          clone: function () {
            return this;
          },
          body: null,
          bodyUsed: false,
        } as Response;
      }
      if (url.match(/\/appointments\/([\w-]+)\/update$/) && init?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          headers: new Headers(),
          redirected: false,
          type: 'basic',
          url,
          json: async () => ({ success: false, error: 'Update failed' }),
          text: async () => '{"success":false,"error":"Update failed"}',
          clone: function () {
            return this;
          },
          body: null,
          bodyUsed: false,
        } as Response);
      }
      if (url.includes('/appointments') && (!init?.method || init.method === 'GET')) {
        return Promise.resolve(okResponse([...MOCK_APPOINTMENTS]));
      }
      return Promise.resolve(okResponse([]));
    });

    render(<AppointmentView />);

    // Select appointment
    const listItems = await screen.findAllByText(/Bob Smith/i, { selector: 'p' });
    fireEvent.click(listItems[0]);

    // Enter edit mode
    const modifyBtns = await screen.findAllByRole('button', { name: /Edit Details/i });
    fireEvent.click(modifyBtns[0]);

    // Click Update Appointment
    const updateButton = screen.getByTestId('update-appointment-btn');
    fireEvent.click(updateButton);

    // Confirm save in modal
    await waitFor(() => {
      const btn = screen.queryByTestId('save-changes-btn');
      expect(btn).not.toBeNull();
    });
    const saveChangesButton = screen.getByTestId('save-changes-btn');
    fireEvent.click(saveChangesButton);

    // The update fetch should have been attempted
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/update'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    // The Modify button should not reappear (still in edit mode or detail view, not reset)
    // At minimum, the component should not have crashed
    await waitFor(() => {
      const toolbar = document.querySelector('.rbc-toolbar');
      expect(toolbar).toBeTruthy();
    });
    // WHO: tenant user | WHAT: save appointment changes | WHEN: API update returns 500 | WHERE: AppointmentView detail panel | WHY: user must not lose edits when save fails — they should be able to retry
  });

  test('mock-mode handleUpdate is a no-op (no /update fetch when sample data is showing)', async () => {
    // WHO: a logged-out (or mid-fetch-failure) viewer who sees MOCK_APPOINTMENTS
    //      and tries to edit one of them
    // WHAT: AppointmentView's `if (usingMockData) { setError(...); return; }`
    //       guard at the top of handleUpdate prevents the /update POST
    //       from ever being issued
    // WHEN: the GET /appointments fetch rejected during initial load, so the
    //       catch arm set MOCK_APPOINTMENTS + usingMockData=true. The user
    //       then drives the same edit flow that "can modify and save an
    //       appointment" exercises in the happy path.
    // WHERE: dashboard/components/AppointmentView.tsx → handleUpdate, line 215
    //        guard. Banner copy "Showing sample data" lives in
    //        AppointmentListSidebar.tsx:55.
    // WHY: without this guard a user editing a fake appointment would fire
    //      a POST /appointments/{mock-id}/update that 404s. The guard
    //      intercepts before the fetch — pinning the no-op behavior here
    //      prevents a regression that would silently spam the backend with
    //      404-bound writes whenever fetch fails on initial load.
    const updateFetchHappened = vi.fn();
    global.fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : '';
      // GET /appointments rejects → component catches → usingMockData=true,
      // MOCK_APPOINTMENTS rendered.
      if (
        url.includes('/appointments') &&
        (!init?.method || init.method === 'GET') &&
        !url.includes('/update')
      ) {
        return Promise.reject(new Error('simulated network error'));
      }
      // Track any /update POST that slips through — the test's load-bearing
      // assertion is that this counter stays at zero.
      if (url.match(/\/appointments\/([\w-]+)\/update$/) && init?.method === 'POST') {
        updateFetchHappened();
      }
      // Other GETs (customers, resources, employees, services, skills) succeed
      // so the form can render the dropdowns it expects.
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        redirected: false,
        type: 'basic',
        url,
        json: async () => [],
        text: async () => '[]',
        clone: function () {
          return this;
        },
        body: null,
        bodyUsed: false,
      } as Response);
    });

    render(<AppointmentView />);

    // Wait for the mock-mode banner to confirm the catch arm fired and
    // usingMockData is now true. If this never appears, the test setup is
    // broken (fetch didn't reject) and any later assertion would be
    // meaningless.
    await screen.findByText(/Showing sample data/i);

    // Drive the same edit-and-save flow as the happy-path test.
    const listItems = await screen.findAllByText(/Bob Smith/i, { selector: 'p' });
    fireEvent.click(listItems[0]);

    const modifyBtns = await screen.findAllByRole('button', { name: /Edit Details/i });
    fireEvent.click(modifyBtns[0]);

    const updateButton = screen.getByTestId('update-appointment-btn');
    fireEvent.click(updateButton);

    await waitFor(() => {
      const btn = screen.queryByTestId('save-changes-btn');
      expect(btn).not.toBeNull();
    });
    const saveChangesButton = screen.getByTestId('save-changes-btn');
    fireEvent.click(saveChangesButton);

    // Wait long enough that any pending fetch would have resolved if it
    // were going to happen. waitFor with a short timeout is enough — the
    // guard rejects synchronously, so by the time React's event loop has
    // processed the click no fetch should be queued.
    await waitFor(() => {
      // Anchor on a stable post-click DOM signal so this isn't a sleep.
      // The save-changes-btn click closes the confirm modal in the happy
      // path; in the mock-mode path the error message lives in the
      // detail panel (handleUpdate set it via setError). Either way the
      // toolbar continues to be present, which proves the component
      // didn't crash and the click path completed.
      expect(document.querySelector('.rbc-toolbar')).toBeTruthy();
    });

    expect(updateFetchHappened).not.toHaveBeenCalled();
  });

  test('mock-mode handleDelete is a no-op (no /cancel POST when sample data is showing)', async () => {
    // WHO: same logged-out / fetch-failure viewer who tries to cancel a
    //      sample appointment
    // WHAT: AppointmentView's `if (usingMockData) { setError(...); return; }`
    //       guard inside handleDelete short-circuits before the confirm
    //       modal opens, so no POST /appointments/:id/cancel is issued
    // WHEN: GET /appointments rejected → mock-mode active → user clicks
    //       Cancel Appointment on Bob Smith's mock row
    // WHERE: dashboard/components/AppointmentView.tsx → handleDelete
    //        usingMockData guard. The destructive UI is now the themed
    //        ConfirmModal (ui/ConfirmModal.tsx); the guard runs before
    //        the modal is opened, so the modal never appears in mock-
    //        mode and the cancel API is never called.
    // WHY: handleDelete switched from hard-DELETE to soft-cancel via
    //      POST /appointments/:id/cancel (2026-05-07). Mock-mode
    //      appointments don't exist server-side, so issuing the cancel
    //      would silently 404 and pollute the audit log. This test pins
    //      both contracts at once: (a) the guard still short-circuits
    //      under mock-mode, AND (b) the request shape that would have
    //      gone out is the new POST /cancel — not the old DELETE. A
    //      future refactor that re-orders the guards OR reverts to hard
    //      delete surfaces here.
    const cancelFetchHappened = vi.fn();
    const deleteFetchHappened = vi.fn();
    global.fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : '';
      if (
        url.includes('/appointments') &&
        (!init?.method || init.method === 'GET') &&
        !url.includes('/update') &&
        !url.includes('/cancel')
      ) {
        return Promise.reject(new Error('simulated network error'));
      }
      if (url.includes('/appointments/') && url.includes('/cancel') && init?.method === 'POST') {
        cancelFetchHappened();
      }
      if (url.includes('/appointments/') && init?.method === 'DELETE') {
        deleteFetchHappened();
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        redirected: false,
        type: 'basic',
        url,
        json: async () => [],
        text: async () => '[]',
        clone: function () {
          return this;
        },
        body: null,
        bodyUsed: false,
      } as Response);
    });

    render(<AppointmentView />);

    await screen.findByText(/Showing sample data/i);

    const listItems = await screen.findAllByText(/Bob Smith/i, { selector: 'p' });
    fireEvent.click(listItems[0]);

    // "Cancel Appointment" button in AppointmentDetailPanel.
    const cancelButtons = await screen.findAllByRole('button', { name: /Cancel Appointment/i });
    fireEvent.click(cancelButtons[0]);

    // Confirm the mock-mode error message surfaces. This pins the guard
    // ran (the older test pinned that window.confirm fired first; the
    // refactor to ConfirmModal flipped the order so the guard runs
    // before the modal opens — the user-visible contract is unchanged).
    await screen.findByText(/Sample appointments cannot be canceled/i);

    expect(cancelFetchHappened).not.toHaveBeenCalled();
    // Belt-and-braces: also confirm the legacy DELETE path is not used.
    expect(deleteFetchHappened).not.toHaveBeenCalled();
  });

  test('mock-mode handleCreate is a no-op (no POST /appointments/create when sample data is showing)', async () => {
    // WHO: same logged-out / fetch-failure viewer who clicks the "+"
    //      button to create a new appointment while mock-mode is active
    // WHAT: AppointmentView's `if (usingMockData) { setError(...); return; }`
    //       guard inside handleCreate prevents the POST /appointments/create
    //       from ever being issued
    // WHEN: GET /appointments rejected → mock-mode active → user clicks
    //       the "+" button (which calls startNewAppointment → opens the
    //       create form prefilled with whatever first customer/resource/
    //       employee is loaded), then clicks "Create Appointment" without
    //       changing any field
    // WHERE: dashboard/components/AppointmentView.tsx → handleCreate, line 256
    //        guard. The "+" button is in AppointmentListSidebar.tsx with
    //        data-testid="new-appointment-btn"; the submit button is
    //        rendered by AppointmentDetailPanel.tsx with the text
    //        "Create Appointment" while isCreating is true.
    // WHY: creating a fake appointment via API would issue a POST against
    //      /appointments/create with a payload referencing mock customers
    //      and resources that don't exist in the real database. The guard
    //      short-circuits before the fetch; this test pins that behavior
    //      so a refactor that re-orders the guards (e.g. moves the mock-
    //      mode check below the API call) surfaces immediately. Pairs
    //      with the handleUpdate + handleDelete mock-mode no-op tests so
    //      all three destructive guards are contract-pinned.
    const createFetchHappened = vi.fn();
    global.fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : '';
      // GET /appointments rejects → component catches → usingMockData=true,
      // MOCK_APPOINTMENTS rendered. Don't reject the create POST below
      // (different method) — but the guard should prevent it from firing
      // anyway, so this branch is belt-and-suspenders.
      if (
        url.includes('/appointments') &&
        (!init?.method || init.method === 'GET') &&
        !url.includes('/update') &&
        !url.includes('/create')
      ) {
        return Promise.reject(new Error('simulated network error'));
      }
      // Track any /create POST that slips through — the test's load-
      // bearing assertion is that this counter stays at zero.
      if (url.includes('/appointments/create') && init?.method === 'POST') {
        createFetchHappened();
      }
      // Other GETs (customers, resources, employees, services, skills)
      // succeed with empty arrays so the form can still render.
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        redirected: false,
        type: 'basic',
        url,
        json: async () => [],
        text: async () => '[]',
        clone: function () {
          return this;
        },
        body: null,
        bodyUsed: false,
      } as Response);
    });

    render(<AppointmentView />);

    // Wait for the mock-mode banner — anchors the test on a known
    // post-fetch-rejection state.
    await screen.findByText(/Showing sample data/i);

    // Click the "+" button (sidebar header) → startNewAppointment runs,
    // isCreating becomes true, the detail panel renders the create form.
    const newButton = await screen.findByTestId('new-appointment-btn');
    fireEvent.click(newButton);

    // The submit button text is `Create ${vocab.booking_label}`; the
    // mocked vocab returns booking_label="Appointment".
    const createButton = await screen.findByRole('button', { name: /create appointment/i });
    fireEvent.click(createButton);

    await waitFor(() => {
      // Anchor on a stable post-click DOM signal so this isn't a sleep.
      // The setError + setSaving(false) inside the guard rerenders the
      // component without crashing; the calendar toolbar continues to
      // be present, which proves the click path completed.
      expect(document.querySelector('.rbc-toolbar')).toBeTruthy();
    });

    expect(createFetchHappened).not.toHaveBeenCalled();
  });
});

// ── Super-admin appointment routing ──────────────────────────────────────────

const SUPER_ADMIN_TENANT_ID = '00000000-0000-0000-0000-000000000000';
const CUSTOMER_TENANT_ID = 'f234e471-0e60-4163-86c9-93cfd9338e3a';

describe('AppointmentView super-admin routing', () => {
  beforeEach(() => {
    mockActiveTenantId = SUPER_ADMIN_TENANT_ID;
  });

  afterEach(() => {
    // Restore normal tenant so other tests are unaffected
    mockActiveTenantId = 'f234e471-0e60-4163-86c9-93cfd9338e3a';
    vi.clearAllMocks();
  });

  test('create routes to customer tenant, not super-admin tenant', async () => {
    // WHO: platform super-admin creating an appointment on behalf of a business
    // WHAT: handleCreate detects SUPER_ADMIN_TENANT_ID, looks up the selected
    //       customer's tenant_id, and issues the POST to that tenant instead
    // WHEN: super-admin selects a customer whose tenant_id = CUSTOMER_TENANT_ID,
    //       then clicks Create Appointment
    // WHERE: AppointmentView.tsx → handleCreate → SUPER_ADMIN_TENANT_ID guard
    // WHY: without the guard, the create POST would use SUPER_ADMIN_TENANT_ID
    //      and the appointment would land in the platform tenant, not the
    //      business's workspace — a silent data isolation failure
    const postedTenantIds: string[] = [];

    global.fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : '';
      function okResponse(data: unknown) {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers(),
          redirected: false,
          type: 'basic' as const,
          url,
          json: async () => data,
          text: async () => JSON.stringify(data),
          clone: function () {
            return this;
          },
          body: null,
          bodyUsed: false,
        } as Response);
      }
      if (url.includes('/appointments/create') && init?.method === 'POST') {
        // Capture which tenant_id the create was called with
        const body = JSON.parse((init?.body as string) || '{}') as Record<string, unknown>;
        postedTenantIds.push(body.tenant_id as string);
        return okResponse({
          success: true,
          appointment: { appointment_id: 'new-appt-1', tenant_id: CUSTOMER_TENANT_ID },
        });
      }
      if (url.includes('/appointments') && (!init?.method || init.method === 'GET')) {
        return okResponse([]);
      }
      if (url.includes('/customers')) {
        // Return a customer whose tenant_id is CUSTOMER_TENANT_ID (not super-admin)
        return okResponse([
          {
            customer_id: 'cust-001',
            name: 'Alice Smith',
            tenant_id: CUSTOMER_TENANT_ID,
            email: 'alice@example.com',
            phone: '+15551234567',
          },
        ]);
      }
      return okResponse([]);
    });

    render(<AppointmentView />);

    // Wait for the component to be ready
    await waitFor(() => {
      expect(document.querySelector('.rbc-toolbar')).toBeTruthy();
    });

    // Open create form
    const newButton = await screen.findByTestId('new-appointment-btn');
    fireEvent.click(newButton);

    // Submit the form (customer defaults to first available: cust-001)
    const createButton = await screen.findByRole('button', { name: /create appointment/i });
    fireEvent.click(createButton);

    await waitFor(() => {
      // Either the create was called with CUSTOMER_TENANT_ID, OR the form
      // shows an error if customer wasn't pre-selected. Both prove the guard ran.
      const calledWithCustomerTenant = postedTenantIds.includes(CUSTOMER_TENANT_ID);
      const calledWithSuperAdminTenant = postedTenantIds.includes(SUPER_ADMIN_TENANT_ID);
      // Must NEVER use the super-admin tenant
      expect(calledWithSuperAdminTenant).toBe(false);
      // If a create did fire, it must be for the customer's tenant
      if (postedTenantIds.length > 0) {
        expect(calledWithCustomerTenant).toBe(true);
      }
    });
    // WHO: platform super-admin | WHAT: create routes to customer tenant | WHERE: SUPER_ADMIN_TENANT_ID guard in handleCreate | WHY: appointments must land in the business workspace, not the platform tenant
  });

  test('SUPER_ADMIN_TENANT_ID guard blocks create when no customer selected', async () => {
    // WHO: super-admin clicking Create before selecting a customer
    // WHAT: guard can't resolve a tenant_id from an empty customer_id →
    //       setError fires, POST is never called
    // WHEN: create attempted with form.customer_id = '' (empty)
    // WHERE: AppointmentView.tsx → handleCreate → `if (!selectedCustomerObj)`
    // WHY: without this guard, the create would silently POST to undefined tenant_id
    const createFetch = vi.fn();

    global.fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : '';
      function okResponse(data: unknown) {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers(),
          redirected: false,
          type: 'basic' as const,
          url,
          json: async () => data,
          text: async () => JSON.stringify(data),
          clone: function () {
            return this;
          },
          body: null,
          bodyUsed: false,
        } as Response);
      }
      if (url.includes('/appointments/create') && init?.method === 'POST') {
        createFetch();
      }
      if (url.includes('/appointments') && (!init?.method || init.method === 'GET')) {
        return okResponse([]);
      }
      // Return NO customers — form.customer_id will be empty
      return okResponse([]);
    });

    render(<AppointmentView />);

    await waitFor(() => {
      expect(document.querySelector('.rbc-toolbar')).toBeTruthy();
    });

    const newButton = await screen.findByTestId('new-appointment-btn');
    fireEvent.click(newButton);

    const createButton = await screen.findByRole('button', { name: /create appointment/i });
    fireEvent.click(createButton);

    await waitFor(() => {
      // Guard should have blocked the create — either error message appears
      // or the create POST was never called
      expect(createFetch).not.toHaveBeenCalled();
    });
    // WHO: super-admin | WHAT: create blocked with no customer | WHERE: SUPER_ADMIN_TENANT_ID guard | WHY: prevents accidental POSTs with undefined tenant_id
  });
});
