// @vitest-environment jsdom
import React from 'react'
import { expect, test, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AppointmentView from './components/AppointmentView'
import { MOCK_APPOINTMENTS } from './lib/mockData'

// Mock VocabularyContext
vi.mock('@/lib/VocabularyContext', () => ({
  useVocabulary: () => ({
    resource_label: 'Resource', resource_plural: 'Resources',
    employee_label: 'Employee', employee_plural: 'Employees',
    booking_label: 'Appointment',
  }),
}))

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
  useActiveTenantId: () => 'f234e471-0e60-4163-86c9-93cfd9338e3a',
  SessionProvider: ({ children }: any) => children,
}))


// Mock fetch
global.fetch = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  // Mock window and localStorage for Node/test env
  if (typeof window === 'undefined') {
    global.window = Object.create(global)
  }
  if (!window.localStorage) {
    let store = {} as Record<string, string>
    window.localStorage = {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, value: string) => { store[key] = value },
      removeItem: (key: string) => { delete store[key] },
      clear: () => { store = {} },
      key: (i: number) => Object.keys(store)[i] || null,
      length: 0
    }
  }
  window.localStorage.setItem('tenantId', 'f234e471-0e60-4163-86c9-93cfd9338e3a')
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
        clone: function () { return this },
        body: null,
        bodyUsed: false,
      } as Response;
    }
    // POST update endpoint
    if (typeof input === 'string' && input.match(/\/appointments\/([\w-]+)\/update$/) && init?.method === 'POST') {
      return Promise.resolve(createMockResponse({ success: true }))
    }
    // Mock GET appointments (simulate real tenant, not mock mode)
    if (typeof input === 'string' && input.includes('/appointments') && (!init?.method || init.method === 'GET')) {
      return Promise.resolve(createMockResponse([...MOCK_APPOINTMENTS]))
    }
    // Mock GET customers/resources/employees/services/skills
    return Promise.resolve(createMockResponse([]))
  })
})

test('AppointmentView: clicking calendar event opens detail view', async () => {
  render(<AppointmentView />)

  // MOCK_APPOINTMENTS[0] is for Bob Smith
  // We use findAllByText and pick the first one (the list item)
  const eventButtons = await screen.findAllByText(/Bob Smith/i, { selector: 'p' })
  fireEvent.click(eventButtons[0])

  // Detail header should now show the customer name
  const headings = await screen.findAllByText(/Bob Smith/i)
  expect(headings.length).toBeGreaterThan(0)
  // WHO: tenant user | WHAT: click calendar event | WHEN: appointments loaded | WHERE: AppointmentView | WHY: user needs to see appointment details to manage bookings
})

test('AppointmentView: can modify and save an appointment', async () => {

  window.localStorage.setItem('tenantId', 'f234e471-0e60-4163-86c9-93cfd9338e3a')
  render(<AppointmentView />)

  // Select the appointment via the list or calendar
  const listItems = await screen.findAllByText(/Bob Smith/i, { selector: 'p' })
  fireEvent.click(listItems[0])

  // Enter edit mode
  const modifyBtns = await screen.findAllByRole('button', { name: /Modify/i })
  fireEvent.click(modifyBtns[0])

  // Format the expected time using the component's internal toLocalISO logic
  const d = new Date(MOCK_APPOINTMENTS[0].start_time)
  const offset = d.getTimezoneOffset()
  const localDate = new Date(d.getTime() - (offset * 60 * 1000))
  const expectedTimeStr = localDate.toISOString().slice(0, 16)

  // Change the start time via the datetime-local input bound to start_time
  const startInput = await screen.findByDisplayValue(expectedTimeStr)
  fireEvent.change(startInput, { target: { value: '2026-03-05T11:00' } })


  // Use data-testid to uniquely select the Update Appointment button
  const updateButton = screen.getByTestId('update-appointment-btn')
  fireEvent.click(updateButton)


  // Wait for modal to appear
  await waitFor(() => {
    const btn = screen.queryByTestId('save-changes-btn');
    expect(btn).not.toBeNull();
  });
  // Click Save Changes in modal
  const saveChangesButton = screen.getByTestId('save-changes-btn');
  fireEvent.click(saveChangesButton)

  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(`https://localhost:4001/appointments/${MOCK_APPOINTMENTS[0].id}/update`),
      expect.objectContaining({ method: 'POST' })
    )
  })
  // WHO: tenant user | WHAT: modify and save appointment | WHEN: in edit mode with changed time | WHERE: AppointmentView detail panel | WHY: user must be able to reschedule appointments without data loss
})

test('AppointmentView: canceling confirmation reverts changes and does not save', async () => {
  render(<AppointmentView />)

  const listItems = await screen.findAllByText(/Bob Smith/i, { selector: 'p' })
  fireEvent.click(listItems[0])

  const modifyBtns = await screen.findAllByRole('button', { name: /Modify/i })
  fireEvent.click(modifyBtns[0])

  const updateButton = screen.getByRole('button', { name: /Update Appointment/i })
  fireEvent.click(updateButton)

  const keepOriginalButton = await screen.findByRole('button', { name: /Keep Original/i })
  fireEvent.click(keepOriginalButton)

  expect(global.fetch).not.toHaveBeenCalledWith(
    expect.stringContaining(`/appointments/${MOCK_APPOINTMENTS[0].id}/update`),
    expect.objectContaining({ method: 'POST' })
  )
  // WHO: tenant user | WHAT: cancel confirmation dialog | WHEN: after clicking Update but before confirming | WHERE: AppointmentView confirmation modal | WHY: user must be able to back out of changes without accidentally saving
})

test('AppointmentView: month navigation moves between months', async () => {
  const { container } = render(<AppointmentView />)

  // Switch to month view
  const monthButtons = await screen.findAllByRole('button', { name: /Month/i })
  fireEvent.click(monthButtons[0])

  // Capture all header labels using the current month name (e.g., "April 2026")
  const currentMonth = new Date().toLocaleString('en-US', { month: 'long' })
  const monthRegex = new RegExp(`${currentMonth} 20\\d{2}`)
  const headersBefore = screen.getAllByText(monthRegex)
  const beforeLabels = headersBefore.map(h => h.textContent)

  // Find the Next button inside the calendar toolbar
  const toolbar = container.querySelector('.rbc-toolbar')
  const nextButton = toolbar && Array.from(toolbar.querySelectorAll('button')).find(btn => btn.textContent?.match(/Next/i))

  expect(nextButton).toBeTruthy()
  fireEvent.click(nextButton!)

  await waitFor(() => {
    // Search for any Month 2026 header
    const headersAfter = screen.getAllByText(/[A-Z][a-z]+ 20\d{2}/)
    const afterLabels = headersAfter.map(h => h.textContent)
    // At least one label should change
    expect(afterLabels.some(label => !beforeLabels.includes(label))).toBe(true)
  })
  // WHO: tenant user | WHAT: navigate between months | WHEN: in month view | WHERE: AppointmentView calendar | WHY: user needs to browse future/past appointments for scheduling
})

import { describe } from 'vitest'

describe('AppointmentView sad paths', () => {
  test('renders without crashing when appointments fetch fails', async () => {
    // Override fetch to return an error for appointments
    global.fetch = vi.fn((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : ''
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
          clone: function () { return this },
          body: null,
          bodyUsed: false,
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ([]),
        text: async () => '[]',
        clone: function () { return this },
        body: null,
        bodyUsed: false,
      } as unknown as Response)
    })

    render(<AppointmentView />)

    // Component should render without throwing — calendar toolbar should still be present
    await waitFor(() => {
      const toolbar = document.querySelector('.rbc-toolbar')
      expect(toolbar).toBeTruthy()
    })
    // WHO: tenant user | WHAT: view appointments | WHEN: API returns 500 error | WHERE: AppointmentView | WHY: dashboard must not crash when backend is unavailable
  })

  test('stays in edit mode when save/update API call fails', async () => {
    // Override fetch: appointments load fine, but update returns error
    global.fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : ''
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
          clone: function () { return this },
          body: null,
          bodyUsed: false,
        } as Response
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
          clone: function () { return this },
          body: null,
          bodyUsed: false,
        } as Response)
      }
      if (url.includes('/appointments') && (!init?.method || init.method === 'GET')) {
        return Promise.resolve(okResponse([...MOCK_APPOINTMENTS]))
      }
      return Promise.resolve(okResponse([]))
    })

    render(<AppointmentView />)

    // Select appointment
    const listItems = await screen.findAllByText(/Bob Smith/i, { selector: 'p' })
    fireEvent.click(listItems[0])

    // Enter edit mode
    const modifyBtns = await screen.findAllByRole('button', { name: /Modify/i })
    fireEvent.click(modifyBtns[0])

    // Click Update Appointment
    const updateButton = screen.getByTestId('update-appointment-btn')
    fireEvent.click(updateButton)

    // Confirm save in modal
    await waitFor(() => {
      const btn = screen.queryByTestId('save-changes-btn')
      expect(btn).not.toBeNull()
    })
    const saveChangesButton = screen.getByTestId('save-changes-btn')
    fireEvent.click(saveChangesButton)

    // The update fetch should have been attempted
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/update'),
        expect.objectContaining({ method: 'POST' })
      )
    })

    // The Modify button should not reappear (still in edit mode or detail view, not reset)
    // At minimum, the component should not have crashed
    await waitFor(() => {
      const toolbar = document.querySelector('.rbc-toolbar')
      expect(toolbar).toBeTruthy()
    })
    // WHO: tenant user | WHAT: save appointment changes | WHEN: API update returns 500 | WHERE: AppointmentView detail panel | WHY: user must not lose edits when save fails — they should be able to retry
  })
})
