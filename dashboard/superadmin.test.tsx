/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react'
import { expect, test, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import SuperAdminDashboard from './components/SuperAdminDashboard'

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
  SessionProvider: ({ children }: any) => children,
}))

// Helper to build a fetch mock that returns tenants, templates, then a success for create/delete
function buildFetchMock() {
  const tenants = [
    {
      id: 'tenant-1',
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

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()

    if (url.endsWith('/tenants') && (!init || init.method === undefined || init.method === 'GET')) {
      return {
        ok: true,
        json: async () => tenants,
      } as any
    }

    if (url.endsWith('/templates')) {
      return {
        ok: true,
        json: async () => templates,
      } as any
    }

    if (url.endsWith('/tenants/create') && init?.method === 'POST') {
      return {
        ok: true,
        json: async () => ({ success: true, tenant_id: 'new-tenant-id' }),
      } as any
    }

    if (url.includes('/tenants/') && init?.method === 'DELETE') {
      return {
        ok: true,
        json: async () => ({ success: true }),
      } as any
    }

    return {
      ok: true,
      json: async () => ({}),
    } as any
  })

  return fetchMock
}

test('SuperAdminDashboard: lists tenants and selects one', async () => {
  const fetchMock = buildFetchMock()
  vi.spyOn(globalThis, 'fetch' as any).mockImplementation(fetchMock as any)

  render(<SuperAdminDashboard />)

  // Wait for the DynaTire tenant to appear in the sidebar
  const [tenantItem] = await screen.findAllByText(/DynaTire PoC/i)
  expect(tenantItem).toBeTruthy()

  // Clicking the tenant should show its detail header
  fireEvent.click(tenantItem)
  const heading = await screen.findByRole('heading', { name: /DynaTire PoC/i })
  expect(heading).toBeTruthy()
})

test('SuperAdminDashboard: can launch new business via modal', async () => {
  const fetchMock = buildFetchMock()
  vi.spyOn(globalThis, 'fetch' as any).mockImplementation(fetchMock as any)

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

  const lastCall = (fetchMock as any).mock.calls.find((call: any[]) =>
    (typeof call[0] === 'string' ? call[0] : call[0].toString()).includes('/tenants/create')
  )

  expect(lastCall).toBeTruthy()
  const body = lastCall[1]?.body as string
  expect(JSON.parse(body)).toMatchObject({
    tenant_name: 'Acme Tires',
    owner_first_name: 'Alice',
    owner_last_name: 'Owner',
    owner_email: 'alice@example.com',
    owner_pass: 'super-secret',
  })
})

test('SuperAdminDashboard: can delete a business', async () => {
  const fetchMock = buildFetchMock()
  vi.spyOn(globalThis, 'fetch' as any).mockImplementation(fetchMock as any)

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
})
