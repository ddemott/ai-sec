import React from 'react'
import { expect, test, vi, beforeEach, describe } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CRMView from './components/CRMView'
import { MOCK_CUSTOMERS, MOCK_SUMMARIES } from './lib/mockData'

// Mock fetch
global.fetch = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    then: vi.fn((resolve) => resolve({ data: [], error: null }))
  }
}))

const TENANT_ID = 'f234e471-0e60-4163-86c9-93cfd9338e3a'

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
]

/**
 * Helper to set up fetch mock that responds differently based on URL
 */
function setupFetchMock(overrides: Record<string, any> = {}) {
  ;(global.fetch as any).mockImplementation((url: string) => {
    if (url.includes('/customers/') && url.includes('/appointments')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => overrides.appointments ?? MOCK_CUSTOMER_APPOINTMENTS,
      })
    }
    if (url.includes('/call-summaries')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => overrides.summaries ?? MOCK_SUMMARIES,
      })
    }
    if (url.includes('/customers')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => overrides.customers ?? MOCK_CUSTOMERS,
      })
    }
    // Default
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => [],
    })
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.setItem('tenantId', TENANT_ID)
})

describe('CRM Unified View - Search', () => {
  test('should filter customer list by search query', async () => {
    setupFetchMock()
    render(<CRMView />)

    // Wait for customers to load — use getAllByText since Bob appears in list and detail header
    await waitFor(() => {
      expect(screen.getAllByText('Bob Smith').length).toBeGreaterThan(0)
    })
    expect(screen.getByText('Alice Johnson')).toBeDefined()

    // Type in search bar
    const searchInput = screen.getByPlaceholderText('Search customers...')
    fireEvent.change(searchInput, { target: { value: 'Bob' } })

    // The list pane should only show Bob. Alice should be gone from the list.
    // Bob still appears in the detail header, so we check Alice is gone entirely.
    expect(screen.queryByText('Alice Johnson')).toBeNull()
    expect(screen.getAllByText('Bob Smith').length).toBeGreaterThan(0)
  })

  test('should filter by phone number', async () => {
    setupFetchMock()
    render(<CRMView />)

    await waitFor(() => {
      expect(screen.getAllByText('Bob Smith').length).toBeGreaterThan(0)
    })

    const searchInput = screen.getByPlaceholderText('Search customers...')
    fireEvent.change(searchInput, { target: { value: '5550001111' } })

    // Alice's phone matches, Bob's doesn't — but Bob still appears in detail header
    expect(screen.getByText('Alice Johnson')).toBeDefined()
  })

  test('should show all customers when search is cleared', async () => {
    setupFetchMock()
    render(<CRMView />)

    await waitFor(() => {
      expect(screen.getAllByText('Bob Smith').length).toBeGreaterThan(0)
    })

    const searchInput = screen.getByPlaceholderText('Search customers...')
    fireEvent.change(searchInput, { target: { value: 'zzzznotfound' } })

    // Both should be gone from the list (but Bob may persist in detail header from prior selection)

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

    await waitFor(() => {
      expect(screen.queryByText('Alice Johnson')).toBeNull()
    })

    fireEvent.change(searchInput, { target: { value: '' } })
    expect(screen.getAllByText('Bob Smith').length).toBeGreaterThan(0)
    expect(screen.getByText('Alice Johnson')).toBeDefined()
  })
})

describe('CRM Unified View - Upcoming Appointments', () => {
  test('should display upcoming appointments section when customer is selected', async () => {
    setupFetchMock()
    render(<CRMView />)

    // First customer is auto-selected, wait for appointments to load
    await waitFor(() => {
      expect(screen.getByText('Upcoming Appointments')).toBeDefined()
    })

    // Should show the scheduled future appointment
    await waitFor(() => {
      expect(screen.getByText('Oil Change')).toBeDefined()
    })
  })

  test('should show resource and employee name on appointment cards', async () => {
    setupFetchMock()
    render(<CRMView />)

    await waitFor(() => {
      expect(screen.getByText('Oil Change')).toBeDefined()
    })

    // Service Truck 1 appears on multiple cards, so use getAllByText
    expect(screen.getAllByText(/Service Truck 1/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Mike Tech/).length).toBeGreaterThan(0)
  })

  test('should show cancel button on upcoming appointments', async () => {
    setupFetchMock()
    render(<CRMView />)

    await waitFor(() => {
      expect(screen.getByText('Oil Change')).toBeDefined()
    })

    // Should have a cancel button
    const cancelButtons = screen.getAllByLabelText(/cancel appointment/i)
    expect(cancelButtons.length).toBeGreaterThan(0)
  })
})

describe('CRM Unified View - Appointment History', () => {
  test('should display past appointments section', async () => {
    setupFetchMock()
    render(<CRMView />)

    await waitFor(() => {
      expect(screen.getByText('Appointment History')).toBeDefined()
    })
  })

  test('should show completed and canceled appointments in history', async () => {
    setupFetchMock()
    render(<CRMView />)

    await waitFor(() => {
      expect(screen.getByText('Tire Rotation')).toBeDefined()
      expect(screen.getByText('Brake Inspection')).toBeDefined()
    })
  })

  test('should show status badges on past appointments', async () => {
    setupFetchMock()
    render(<CRMView />)

    await waitFor(() => {
      expect(screen.getByText('Completed')).toBeDefined()
      expect(screen.getByText('Canceled')).toBeDefined()
    })
  })
})

describe('CRM Unified View - AI Call History', () => {
  test('should display call summaries section', async () => {
    setupFetchMock()
    render(<CRMView />)

    await waitFor(() => {
      expect(screen.getByText('AI Call History')).toBeDefined()
    })

    await waitFor(() => {
      expect(screen.getByText(/Bob called to ask about pricing/)).toBeDefined()
    })
  })
})

describe('CRM Unified View - Cancel Appointment Flow', () => {
  test('should cancel an appointment and refresh the list', async () => {
    setupFetchMock()
    render(<CRMView />)

    await waitFor(() => {
      expect(screen.getByText('Oil Change')).toBeDefined()
    })

    // Mock window.confirm
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)

    // Click cancel on the upcoming appointment
    const cancelButton = screen.getAllByLabelText(/cancel appointment/i)[0]
    fireEvent.click(cancelButton)

    // Should have called the cancel endpoint
    await waitFor(() => {
      const calls = (global.fetch as any).mock.calls
      const cancelCall = calls.find((c: any) => c[0].includes('/appointments/') && c[0].includes('/cancel'))
      expect(cancelCall).toBeDefined()
    })
  })
})

describe('CRM Unified View - Empty States', () => {
  test('should show message when no upcoming appointments', async () => {
    setupFetchMock({ appointments: [] })
    render(<CRMView />)

    await waitFor(() => {
      expect(screen.getByText(/no upcoming appointments/i)).toBeDefined()
    })
  })

  test('should show message when no appointment history', async () => {
    setupFetchMock({ appointments: [] })
    render(<CRMView />)

    await waitFor(() => {
      expect(screen.getByText(/no past appointments/i)).toBeDefined()
    })
  })
})
