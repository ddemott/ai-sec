import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'

// Mutable overrides for per-test session context changes
let mockTenantId: string | null = 'f234e471-0e60-4163-86c9-93cfd9338e3a'
let mockIsAdmin = false

// Mock SessionContext
vi.mock('@/lib/SessionContext', () => ({
  useSessionContext: () => ({
    tenantId: mockTenantId,
    userName: 'Test User',
    isAdmin: mockIsAdmin,
    managedTenantId: mockTenantId,
    managedTenantName: 'DynaTire',
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    selectManagedTenant: vi.fn(),
    tenantsVersion: 0,
    notifyTenantsChanged: vi.fn(),
  }),
  useActiveTenantId: () => mockTenantId,
  SessionProvider: ({ children }: any) => children,
}))

// Mock VocabularyContext
vi.mock('@/lib/VocabularyContext', () => ({
  useVocabulary: () => ({
    resource_label: 'Resource',
    resource_plural: 'Resources',
    employee_label: 'Employee',
    employee_plural: 'Employees',
    booking_label: 'Appointment',
  }),
}))

import SettingsView from './SettingsView'

beforeEach(() => {
  vi.clearAllMocks()
  mockTenantId = 'f234e471-0e60-4163-86c9-93cfd9338e3a'
  mockIsAdmin = false
  localStorage.setItem('tenantId', 'f234e471-0e60-4163-86c9-93cfd9338e3a')
  // Default fetch mock: return empty/null for all endpoints
  ;(global.fetch as unknown as ReturnType<typeof vi.fn>) = vi.fn().mockImplementation((url: string) => {
    if (url.includes('/calendar/settings')) {
      return Promise.resolve({
        ok: true,
        json: async () => null,
      })
    }
    return Promise.resolve({ ok: true, json: async () => [] })
  })
})

describe('SettingsView: Calendar Section', () => {
  test('renders calendar section for non-admin users', async () => {
    render(<SettingsView />)
    await waitFor(() => {
      expect(screen.getByText('Calendar Synchronization')).toBeInTheDocument()
    })
  })

  test('shows Connect Google Calendar and Connect Outlook Calendar buttons when not connected', async () => {
    render(<SettingsView />)
    await waitFor(() => {
      expect(screen.getByText('Connect Google Calendar')).toBeInTheDocument()
      expect(screen.getByText('Connect Outlook Calendar')).toBeInTheDocument()
    })
  })

  test('clicking Google Calendar button calls getAuthUrl API', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/calendar/auth/google')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ url: 'https://accounts.google.com/o/oauth2/auth?...' }),
        })
      }
      if (url.includes('/calendar/settings')) {
        return Promise.resolve({
          ok: true,
          json: async () => null,
        })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })
    ;(global.fetch as unknown) = mockFetch

    // Prevent actual navigation
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...originalLocation, href: originalLocation.href },
    })

    render(<SettingsView />)
    await waitFor(() => {
      expect(screen.getByText('Connect Google Calendar')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Connect Google Calendar'))

    await waitFor(() => {
      const authCall = mockFetch.mock.calls.find(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('/calendar/auth/google')
      )
      expect(authCall).toBeDefined()
    })

    // Restore
    Object.defineProperty(window, 'location', {
      writable: true,
      value: originalLocation,
    })
  })

  test('shows connected state when calendar settings exist', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>) = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/calendar/settings')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ provider: 'google', external_calendar_id: 'cal_abc123' }),
        })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    render(<SettingsView />)

    await waitFor(() => {
      // provider is lowercase in the data; CSS capitalize makes it visual-only
      expect(screen.getByText('google Calendar Connected')).toBeInTheDocument()
    })
    expect(screen.getByText('ID: cal_abc123')).toBeInTheDocument()
  })

  test('disconnect button calls disconnect API', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string, _options?: RequestInit) => {
      // Check disconnect first since it also matches /calendar/settings
      if (url.includes('/calendar/settings/disconnect')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        })
      }
      if (url.includes('/calendar/settings')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ provider: 'google', external_calendar_id: 'cal_abc123' }),
        })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })
    ;(global.fetch as unknown) = mockFetch

    render(<SettingsView />)

    await waitFor(() => {
      expect(screen.getByText('google Calendar Connected')).toBeInTheDocument()
    })

    const disconnectButtons = screen.getAllByText('Disconnect')
    fireEvent.click(disconnectButtons[0])

    await waitFor(() => {
      const disconnectCall = mockFetch.mock.calls.find(
        (call: any[]) =>
          typeof call[0] === 'string' && call[0].includes('/calendar/settings/disconnect')
      )
      expect(disconnectCall).toBeDefined()
    })
  })

  test('detects calendarError query param and logs error', async () => {
    const originalLocation = window.location
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState')
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...originalLocation,
        href: 'http://localhost:3001/dashboard?calendarError=access_denied',
        search: '?calendarError=access_denied',
        pathname: '/dashboard',
      },
    })

    render(<SettingsView />)

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Calendar connection failed:',
        'access_denied'
      )
    })

    // URL param should be cleaned up
    expect(replaceStateSpy).toHaveBeenCalled()

    // Component still renders normally — shows connect buttons (not connected)
    await waitFor(() => {
      expect(screen.getByText('Connect Google Calendar')).toBeInTheDocument()
    })

    consoleErrorSpy.mockRestore()
    replaceStateSpy.mockRestore()
    Object.defineProperty(window, 'location', {
      writable: true,
      value: originalLocation,
    })
  })

  test('detects calendarConnected query param and refreshes settings', async () => {
    // Set up URL with calendarConnected param
    const originalLocation = window.location
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState')

    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...originalLocation,
        href: 'http://localhost:3001/dashboard?calendarConnected=true',
        search: '?calendarConnected=true',
        pathname: '/dashboard',
      },
    })

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/calendar/settings')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ provider: 'google', external_calendar_id: 'cal_new' }),
        })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })
    ;(global.fetch as unknown) = mockFetch

    render(<SettingsView />)

    // The useEffect should detect calendarConnected=true and fetch calendar settings
    await waitFor(() => {
      const settingsCalls = mockFetch.mock.calls.filter(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('/calendar/settings')
      )
      // Should be called at least twice: once from initial mount useEffect, once from query param detection
      expect(settingsCalls.length).toBeGreaterThanOrEqual(2)
    })

    // Restore
    replaceStateSpy.mockRestore()
    Object.defineProperty(window, 'location', {
      writable: true,
      value: originalLocation,
    })
  })
})

describe('SettingsView: Sad Paths', () => {
  test('calendar settings fetch fails — component renders fallback (connect buttons)', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>) = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/calendar/settings')) {
        return Promise.resolve({
          ok: false,
          status: 500,
          text: async () => 'Internal Server Error',
        })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    render(<SettingsView />)

    // Component should not crash — should show connect buttons as fallback (no settings loaded)
    await waitFor(() => {
      expect(screen.getByText('Calendar Synchronization')).toBeInTheDocument()
      expect(screen.getByText('Connect Google Calendar')).toBeInTheDocument()
      expect(screen.getByText('Connect Outlook Calendar')).toBeInTheDocument()
    })

    expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to fetch calendar settings')
    consoleErrorSpy.mockRestore()
  })

  test('calendar disconnect fails — connected state is preserved', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/calendar/settings/disconnect')) {
        return Promise.resolve({
          ok: false,
          status: 500,
          text: async () => 'Disconnect failed',
        })
      }
      if (url.includes('/calendar/settings')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ provider: 'google', external_calendar_id: 'cal_abc123' }),
        })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })
    ;(global.fetch as unknown) = mockFetch

    render(<SettingsView />)

    await waitFor(() => {
      expect(screen.getByText('google Calendar Connected')).toBeInTheDocument()
    })

    const disconnectButtons = screen.getAllByText('Disconnect')
    fireEvent.click(disconnectButtons[0])

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith('Disconnect failed')
    })

    // Connected state should still be shown (not cleared on error)
    expect(screen.getByText('google Calendar Connected')).toBeInTheDocument()
    expect(screen.getByText('ID: cal_abc123')).toBeInTheDocument()

    // Disconnect button should be re-enabled (calLoading reset in finally block)
    await waitFor(() => {
      const calDisconnectBtn = screen.getAllByText('Disconnect')[0].closest('button')
      expect(calDisconnectBtn).not.toBeDisabled()
    })

    consoleErrorSpy.mockRestore()
  })

  test('calendar auth URL fetch fails — calLoading resets and buttons re-enable', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/calendar/auth/google')) {
        return Promise.resolve({
          ok: false,
          status: 500,
          text: async () => 'Auth URL generation failed',
        })
      }
      if (url.includes('/calendar/settings')) {
        return Promise.resolve({
          ok: true,
          json: async () => null,
        })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })
    ;(global.fetch as unknown) = mockFetch

    render(<SettingsView />)

    await waitFor(() => {
      expect(screen.getByText('Connect Google Calendar')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Connect Google Calendar'))

    // calLoading should reset after the error
    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to get google auth URL')
    })

    // Buttons should be re-enabled (calLoading set to false in catch block)
    await waitFor(() => {
      const googleBtn = screen.getByText('Connect Google Calendar').closest('button')
      expect(googleBtn).not.toBeDisabled()
    })

    consoleErrorSpy.mockRestore()
  })

  test('renders correctly when no tenantId is available', async () => {
    mockTenantId = null
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    ;(global.fetch as unknown as ReturnType<typeof vi.fn>) = vi.fn().mockImplementation(() => {
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    render(<SettingsView />)

    // Component should render the non-admin view without crashing
    await waitFor(() => {
      expect(screen.getByText('Business Settings')).toBeInTheDocument()
      expect(screen.getByText('Calendar Synchronization')).toBeInTheDocument()
    })

    // Calendar settings fetch should NOT have been called (tenantId is null)
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    const calendarCalls = fetchMock.mock.calls.filter(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('/calendar/settings')
    )
    expect(calendarCalls.length).toBe(0)

    // Add Resource button should be disabled (no tenantId)
    const addBtn = screen.getByText('Add Resource').closest('button')
    expect(addBtn).toBeDisabled()

    consoleErrorSpy.mockRestore()
  })

  test('resource creation fails (network error) — logs error and preserves form input', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>) = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/resources/create') && options?.method === 'POST') {
        return Promise.reject(new TypeError('Failed to fetch'))
      }
      if (url.includes('/calendar/settings')) {
        return Promise.resolve({
          ok: true,
          json: async () => null,
        })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    render(<SettingsView />)

    await waitFor(() => {
      expect(screen.getByText('Calendar Synchronization')).toBeInTheDocument()
    })

    // Fill in the resource name input
    const nameInput = screen.getByPlaceholderText('Resource Name (e.g. Station 2)')
    fireEvent.change(nameInput, { target: { value: 'Bay 1' } })

    // Submit the form
    const addBtn = screen.getByText('Add Resource').closest('button')!
    fireEvent.click(addBtn)

    // Error should be logged (catch block in handleCreateResource)
    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to create resource',
        expect.any(Error)
      )
    })

    // Form input should NOT be cleared (only clears on success)
    expect(nameInput).toHaveValue('Bay 1')

    consoleErrorSpy.mockRestore()
  })

  test('resource creation fails (API returns success:false) — form input preserved', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>) = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/resources/create') && options?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          status: 400,
          json: async () => ({ success: false, error: 'Resource name already exists' }),
        })
      }
      if (url.includes('/calendar/settings')) {
        return Promise.resolve({
          ok: true,
          json: async () => null,
        })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    render(<SettingsView />)

    await waitFor(() => {
      expect(screen.getByText('Calendar Synchronization')).toBeInTheDocument()
    })

    const nameInput = screen.getByPlaceholderText('Resource Name (e.g. Station 2)')
    fireEvent.change(nameInput, { target: { value: 'Bay 1' } })

    const addBtn = screen.getByText('Add Resource').closest('button')!
    fireEvent.click(addBtn)

    // Wait for the mutation to complete
    await waitFor(() => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      const createCalls = fetchMock.mock.calls.filter(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('/resources/create')
      )
      expect(createCalls.length).toBe(1)
    })

    // Form input should NOT be cleared (res.success is false, so reset doesn't happen)
    expect(nameInput).toHaveValue('Bay 1')
  })

  test('resource toggle (active/inactive) fails (network error) — logs error', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>) = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/update') && options?.method === 'POST') {
        return Promise.reject(new TypeError('Failed to fetch'))
      }
      if (url.includes('/calendar/settings')) {
        return Promise.resolve({
          ok: true,
          json: async () => null,
        })
      }
      if (url.includes('/resources')) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: 'res-1', name: 'Bay 1', is_active: true, tenant_id: 'f234e471-0e60-4163-86c9-93cfd9338e3a' },
          ],
        })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    render(<SettingsView />)

    // Wait for resources to load
    await waitFor(() => {
      expect(screen.getByText('Bay 1')).toBeInTheDocument()
    })

    // Click the Active badge button to toggle
    const activeButton = screen.getByText('Active').closest('button')!
    fireEvent.click(activeButton)

    // Error should be logged (catch block in toggleResourceActive)
    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to update resource',
        expect.any(Error)
      )
    })

    // Resource should still show as Active (not toggled)
    expect(screen.getByText('Active')).toBeInTheDocument()

    consoleErrorSpy.mockRestore()
  })

  test('resource toggle (active/inactive) fails (API returns success:false) — resource unchanged', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>) = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/update') && options?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: async () => ({ success: false, error: 'Database error' }),
        })
      }
      if (url.includes('/calendar/settings')) {
        return Promise.resolve({
          ok: true,
          json: async () => null,
        })
      }
      if (url.includes('/resources')) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: 'res-1', name: 'Bay 1', is_active: true, tenant_id: 'f234e471-0e60-4163-86c9-93cfd9338e3a' },
          ],
        })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    render(<SettingsView />)

    await waitFor(() => {
      expect(screen.getByText('Bay 1')).toBeInTheDocument()
    })

    const activeButton = screen.getByText('Active').closest('button')!
    fireEvent.click(activeButton)

    // Wait for mutation to complete
    await waitFor(() => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      const updateCalls = fetchMock.mock.calls.filter(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('/update')
      )
      expect(updateCalls.length).toBe(1)
    })

    // Resource should still show as Active (refreshResources not called since success is false)
    expect(screen.getByText('Active')).toBeInTheDocument()
  })
})
