import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'

// Mock SessionContext
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
    const mockFetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
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

    fireEvent.click(screen.getByText('Disconnect'))

    await waitFor(() => {
      const disconnectCall = mockFetch.mock.calls.find(
        (call: any[]) =>
          typeof call[0] === 'string' && call[0].includes('/calendar/settings/disconnect')
      )
      expect(disconnectCall).toBeDefined()
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
