import React from 'react'
import { expect, test, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CRMView from './components/CRMView'
import { MOCK_CUSTOMERS } from './lib/mockData'

// Mock fetch
global.fetch = vi.fn()

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

// Mock Supabase for the history fetch
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    then: vi.fn((resolve) => resolve({ data: [], error: null }))
  }
}))

beforeEach(() => {
  vi.clearAllMocks()
  // Set tenantId so useSession/fetchCustomers trigger
  window.localStorage.setItem('tenantId', 'f234e471-0e60-4163-86c9-93cfd9338e3a')
  // Default successful fetch for customers
  ;(global.fetch as any).mockResolvedValue({
    ok: true,
    json: async () => MOCK_CUSTOMERS
  })
})

test('CRMView: should enter edit mode and update state', async () => {
  render(<CRMView />)
  
  // Wait for load - Bob Smith is in MOCK_CUSTOMERS
  // We use findByText to wait for it, and then specifically click the one in the list
  const customerItem = await screen.findByText(/Bob Smith/i, { selector: 'p' })
  fireEvent.click(customerItem)
  
  // Click Edit Info button
  const editBtn = await screen.findByRole('button', { name: /Edit Info/i })
  fireEvent.click(editBtn)
  
  // Check if Save button appears
  expect(screen.getByRole('button', { name: /Save Changes/i })).toBeDefined()
  
  // Change Internal Notes
  const notesInput = screen.getByPlaceholderText(/Add private notes/i)
  fireEvent.change(notesInput, { target: { value: 'Newly added secret note' } })
  
  // Mock the save response specifically for this call
  ;(global.fetch as any).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ success: true })
  })
  
  // Save
  fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }))
  
  // Wait for edit mode to close (Success)
  await waitFor(() => expect(screen.queryByPlaceholderText(/Add private notes/i)).toBeNull())
})
