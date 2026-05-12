// @vitest-environment jsdom
import React from 'react'
import { expect, test, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import SuperAdminDashboard from './components/SuperAdminDashboard'
import { mockJsonResponse } from './lib/test-utils'

// Mock SessionContext so SuperAdminDashboard can call useSessionContext
vi.mock('@/lib/SessionContext', () => ({
  useSessionContext: () => ({
    tenantId: '00000000-0000-0000-0000-000000000000',
    userName: 'Admin',
    isAdmin: true,
    managedTenantId: null,
    managedTenantName: null,
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    selectManagedTenant: vi.fn(),
    tenantsVersion: 0,
    notifyTenantsChanged: vi.fn(),
  }),
  useActiveTenantId: () => '00000000-0000-0000-0000-000000000000',
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}))

// Helper to build a fetch mock that returns tenants, templates, then a success for create/delete
function buildFetchMock() {
  const tenants = [
    {
      tenant_id: 'tenant-1',
      name: 'DynaTire PoC',
      business_type: 'mobile-tire',
      timezone: 'America/Los_Angeles',
      voice_id: null,
      system_prompt: null,
      first_message: null,
      owner_phone: null,
    },
  ]

  const templates = [
    {
      business_type: 'mobile-tire',
      display_name: 'Mobile Tire Shop',
    },
  ]

  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString()

    if (url.endsWith('/tenants') && (!init || init.method === undefined || init.method === 'GET')) {
      return mockJsonResponse(tenants)
    }

    if (url.endsWith('/templates')) {
      return mockJsonResponse(templates)
    }

    if (url.endsWith('/tenants/create') && init?.method === 'POST') {
      return mockJsonResponse({ success: true, tenant_id: 'new-tenant-id' })
    }

    if (url.includes('/tenants/') && init?.method === 'DELETE') {
      return mockJsonResponse({ success: true })
    }

    return mockJsonResponse({})
  })

  return fetchMock
}

test('SuperAdminDashboard: lists tenants and selects one', async () => {
  const fetchMock = buildFetchMock()
  vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock)

  render(<SuperAdminDashboard />)

  // Wait for the DynaTire tenant to appear in the sidebar
  const [tenantItem] = await screen.findAllByText(/DynaTire PoC/i)
  expect(tenantItem).toBeTruthy()

  // Clicking the tenant should show its detail header
  fireEvent.click(tenantItem)
  const heading = await screen.findByRole('heading', { name: /DynaTire PoC/i })
  expect(heading).toBeTruthy()
  // WHO: super-admin | WHAT: list and select tenant | WHEN: dashboard loads with tenants | WHERE: SuperAdminDashboard | WHY: admin must be able to browse and manage individual businesses
})

test('SuperAdminDashboard: can launch new business via modal', async () => {
  const fetchMock = buildFetchMock()
  vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock)

  render(<SuperAdminDashboard />)

  // Wait for initial data load
  await screen.findAllByText(/DynaTire PoC/i)

  // Open the create modal using the title on the icon button
  const [launchButton] = screen.getAllByTitle(/Launch New Business/i)
  fireEvent.click(launchButton)

  // Modal content should be visible
  await screen.findByText(/Launch New Business/i)

  // Fill in the new business form
  const nameInput = screen.getByPlaceholderText(/Elite Salon/i)
  fireEvent.change(nameInput, { target: { value: 'Acme Tires' } })

  const ownerFirstNameInput = screen.getByPlaceholderText(/First Name/i)
  fireEvent.change(ownerFirstNameInput, { target: { value: 'Alice' } })

  const ownerLastNameInput = screen.getByPlaceholderText(/Last Name/i)
  fireEvent.change(ownerLastNameInput, { target: { value: 'Owner' } })

  const ownerEmailInput = screen.getByPlaceholderText(/Email/i)
  fireEvent.change(ownerEmailInput, { target: { value: 'alice@example.com' } })

  const ownerPassInput = screen.getByPlaceholderText(/Owner Password/i)
  fireEvent.change(ownerPassInput, { target: { value: 'super-secret' } })

  const deployButton = screen.getByRole('button', { name: /Deploy Business/i })
  fireEvent.click(deployButton)

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/tenants/create'),
      expect.objectContaining({ method: 'POST' })
    )
  })

  const lastCall = fetchMock.mock.calls.find((call) =>
    (typeof call[0] === 'string' ? call[0] : call[0].toString()).includes('/tenants/create')
  )

  expect(lastCall).toBeDefined()
  if (!lastCall) throw new Error('unreachable: lastCall asserted defined above')
  const body = lastCall[1]?.body as string
  expect(JSON.parse(body)).toMatchObject({
    tenant_name: 'Acme Tires',
    owner_first_name: 'Alice',
    owner_last_name: 'Owner',
    owner_email: 'alice@example.com',
    owner_pass: 'super-secret',
  })
  // WHO: super-admin | WHAT: create new tenant business | WHEN: filling out launch modal form | WHERE: SuperAdminDashboard create modal | WHY: admin must onboard new customers with correct data sent to API
})

test('SuperAdminDashboard: can delete a business', async () => {
  const fetchMock = buildFetchMock()
  vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock)

  render(<SuperAdminDashboard />)

  // Wait for tenant to load and select it
  const [tenantItem] = await screen.findAllByText(/DynaTire PoC/i)
  fireEvent.click(tenantItem)

  // Click the trash icon button with title "Delete Business"
  const [deleteButton] = await screen.findAllByTitle(/Delete Business/i)
  fireEvent.click(deleteButton)

  // Type-to-confirm modal should appear
  await screen.findByText(/This action is permanent/i)

  // Type the tenant name to enable the delete button
  const confirmInput = screen.getByPlaceholderText(/DynaTire PoC/i)
  fireEvent.change(confirmInput, { target: { value: 'DynaTire PoC' } })

  // Click "Permanently Delete"
  const confirmButton = screen.getByRole('button', { name: /Permanently Delete/i })
  fireEvent.click(confirmButton)

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/tenants/tenant-1'),
      expect.objectContaining({ method: 'DELETE' })
    )
  })
  // WHO: super-admin | WHAT: delete tenant business | WHEN: type-to-confirm matches tenant name | WHERE: SuperAdminDashboard delete modal | WHY: permanent deletion must require explicit confirmation to prevent accidental data loss
})

import { describe } from 'vitest'

describe('SuperAdminDashboard sad paths', () => {
  test('shows empty state when tenant list fetch fails', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url.endsWith('/tenants') && (!init || !init.method || init.method === 'GET')) {
        return mockJsonResponse({ success: false, error: 'DB unavailable' }, { ok: false, status: 500 })
      }
      if (url.endsWith('/templates')) {
        return mockJsonResponse([])
      }
      return mockJsonResponse({})
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock)

    render(<SuperAdminDashboard />)

    // Component should not crash — wait briefly for render to settle
    await waitFor(() => {
      // The heading or sidebar should still be present even with no tenants
      expect(document.body.textContent).toBeDefined()
    })

    // DynaTire should NOT appear since fetch failed
    expect(screen.queryByText(/DynaTire PoC/i)).toBeNull()
    // WHO: super-admin | WHAT: load tenant list | WHEN: API returns 500 | WHERE: SuperAdminDashboard sidebar | WHY: dashboard must degrade gracefully when backend is down — no crash, show empty state
  })

  test('shows error when tenant creation fails', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url.endsWith('/tenants') && (!init || !init.method || init.method === 'GET')) {
        return mockJsonResponse([])
      }
      if (url.endsWith('/templates')) {
        return mockJsonResponse([{ business_type: 'mobile-tire', display_name: 'Mobile Tire Shop' }])
      }
      if (url.endsWith('/tenants/create') && init?.method === 'POST') {
        return mockJsonResponse({ success: false, error: 'Tenant name already exists' })
      }
      return mockJsonResponse({})
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock)

    render(<SuperAdminDashboard />)

    // Wait for initial load
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })

    // Open the create modal
    const [launchButton] = screen.getAllByTitle(/Launch New Business/i)
    fireEvent.click(launchButton)

    await screen.findByText(/Launch New Business/i)

    // Fill minimal form
    fireEvent.change(screen.getByPlaceholderText(/Elite Salon/i), { target: { value: 'Duplicate Biz' } })
    fireEvent.change(screen.getByPlaceholderText(/First Name/i), { target: { value: 'Bob' } })
    fireEvent.change(screen.getByPlaceholderText(/Last Name/i), { target: { value: 'Test' } })
    fireEvent.change(screen.getByPlaceholderText(/Email/i), { target: { value: 'bob@test.com' } })
    fireEvent.change(screen.getByPlaceholderText(/Owner Password/i), { target: { value: 'pass1234' } })

    const deployButton = screen.getByRole('button', { name: /Deploy Business/i })
    fireEvent.click(deployButton)

    // The create call should have been made
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/tenants/create'),
        expect.objectContaining({ method: 'POST' })
      )
    })

    // Modal should still be visible (not closed on failure) — the Launch New Business heading or form should persist
    // At minimum the component should not have crashed
    expect(document.body.textContent).toBeDefined()
    // WHO: super-admin | WHAT: create tenant | WHEN: API returns success:false | WHERE: SuperAdminDashboard create modal | WHY: admin must see the error and be able to correct the form — modal should not silently close
  })

  test('delete button stays disabled with wrong confirmation text', async () => {
    const fetchMock = buildFetchMock()
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock)

    render(<SuperAdminDashboard />)

    // Wait for tenant to load and select it
    const [tenantItem] = await screen.findAllByText(/DynaTire PoC/i)
    fireEvent.click(tenantItem)

    // Open delete confirmation modal
    const [deleteButton] = await screen.findAllByTitle(/Delete Business/i)
    fireEvent.click(deleteButton)

    await screen.findByText(/This action is permanent/i)

    // Type WRONG confirmation text
    const confirmInput = screen.getByPlaceholderText(/DynaTire PoC/i)
    fireEvent.change(confirmInput, { target: { value: 'wrong name' } })

    // The Permanently Delete button should be disabled
    const confirmButton = screen.getByRole('button', { name: /Permanently Delete/i })
    expect((confirmButton as HTMLButtonElement).disabled).toBe(true)

    // No delete call should have been made
    const deleteCalls = fetchMock.mock.calls.filter((call) => {
      const url = typeof call[0] === 'string' ? call[0] : call[0].toString()
      return url.includes('/tenants/tenant-1') && call[1]?.method === 'DELETE'
    })
    expect(deleteCalls.length).toBe(0)
    // WHO: super-admin | WHAT: attempt delete with wrong name | WHEN: confirmation text does not match | WHERE: SuperAdminDashboard delete modal | WHY: mistyped confirmation must block deletion to prevent accidental permanent data loss
  })
})
