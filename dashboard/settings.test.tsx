import React from 'react'
import { expect, test, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SettingsView from './components/SettingsView'
import { mockJsonResponse } from './lib/test-utils'

// Simple in-memory resources store for mocking
let mockResources: Array<{ id: string; name: string; description?: string | null; is_active?: boolean }> = []

// Build a fetch mock that supports resources GET/CREATE/UPDATE
function buildFetchMock() {
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString()

    if (url.includes('/resources?tenant_id=')) {
      return mockJsonResponse(mockResources)
    }

    if (url.endsWith('/resources/create') && init?.method === 'POST') {
      const body = init.body ? JSON.parse(init.body as string) : {}
      const newRes = {
        id: `res-${mockResources.length + 1}`,
        name: body.name,
        description: body.description ?? null,
        is_active: true,
      }
      mockResources.push(newRes)
      return mockJsonResponse({ success: true, resource: newRes })
    }

    if (url.includes('/resources/') && url.endsWith('/update') && init?.method === 'POST') {
      const body = init.body ? JSON.parse(init.body as string) : {}
      const id = url.split('/resources/')[1].split('/')[0]
      mockResources = mockResources.map(r =>
        r.id === id ? { ...r, ...('is_active' in body ? { is_active: body.is_active } : {}) } : r
      )
      return mockJsonResponse({ success: true })
    }

    return mockJsonResponse({})
  })

  return fetchMock
}

beforeEach(() => {
  mockResources = [
    { id: 'res-1', name: 'Resource 1', description: 'Primary unit', is_active: true },
  ]

  window.localStorage.setItem('tenantId', 'tenant-owner-1')

  const fetchMock = buildFetchMock()
  vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock)
})

test('SettingsView (owner): shows resources list and creation form', async () => {
  render(<SettingsView />)

  // Should render business settings header
  await screen.findByText(/Business Settings/i)
  await screen.findByText(/Resources & Capacity Units/i)

  // Existing resource from mock should appear

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
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}))

  await screen.findByText(/Resource 1/i)
  // WHO: business owner | WHAT: views resources list and creation form | WHEN: initial settings page load | WHERE: SettingsView | WHY: owners must see existing resources and the form to add new ones for capacity management
})

test('SettingsView (owner): can add a new resource', async () => {
  render(<SettingsView />)

  // Wait for initial resources to load
  await screen.findByText(/Resource 1/i)

  const [nameInput] = screen.getAllByPlaceholderText(/Resource Name/i)
  const [descInput] = screen.getAllByPlaceholderText(/Optional description/i)
  const [addButton] = screen.getAllByRole('button', { name: /Add Resource/i })

  fireEvent.change(nameInput, { target: { value: 'Resource 2' } })
  fireEvent.change(descInput, { target: { value: 'Secondary unit' } })
  fireEvent.click(addButton)

  await waitFor(() => {
    expect(screen.getByText(/Resource 2/i)).toBeTruthy()
  })
  // WHO: business owner | WHAT: creates a new resource | WHEN: name and description filled, Add clicked | WHERE: SettingsView | WHY: owners need to add bays/stations/chairs to match their physical capacity
})

test('SettingsView (owner): can toggle resource active state', async () => {
  render(<SettingsView />)

  const [toggleButton] = await screen.findAllByRole('button', { name: /Active/i })
  fireEvent.click(toggleButton)

  await waitFor(() => {
    // After toggle, button text should indicate inactive state
    expect(screen.getByRole('button', { name: /Inactive/i })).toBeTruthy()
  })
  // WHO: business owner | WHAT: toggles resource active/inactive | WHEN: resource exists and toggle clicked | WHERE: SettingsView | WHY: deactivating a resource prevents bookings against it without deleting history
})
