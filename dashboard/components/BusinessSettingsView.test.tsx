/**
 * BusinessSettingsView Tests
 * Tests service management, resource management, calendar connection, CRM integrations, and availability.
 * Each section has happy + sad paths with 5W diagnostic context.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'

// Mock tenant context
let mockTenantId = 'test-tenant-123'
vi.mock('../lib/SessionContext', () => ({
  useActiveTenantId: () => mockTenantId,
}))

// Mock vocabulary
vi.mock('@/lib/VocabularyContext', () => ({
  useVocabulary: () => ({
    resource_label: 'Station',
    resource_plural: 'Stations',
    booking_label: 'Appointment',
  }),
}))

// Mock static data hook
const mockRefreshResources = vi.fn()
let mockResources: Array<{ id: string; name: string; description?: string; is_active?: boolean }> = []
let mockServices: Array<{ id: string; name: string; description?: string; duration_minutes: number }> = []
let mockEmployees: Array<{ id: string; name: string }> = []
let mockStaticLoading = false
let mockResourcesError: string | null = null

vi.mock('../lib/hooks', () => ({
  useStaticData: () => ({
    resources: mockResources,
    services: mockServices,
    employees: mockEmployees,
    loading: mockStaticLoading,
    error: mockResourcesError,
    refresh: mockRefreshResources,
  }),
}))

// Mock API
const mockGetConfig = vi.fn()
const mockGetCalendarSettings = vi.fn()
const mockGetAuthUrl = vi.fn()
const mockDisconnect = vi.fn()
const mockCreateService = vi.fn()
const mockUpdateService = vi.fn()
const mockDeleteService = vi.fn()
const mockCreateResource = vi.fn()
const mockUpdateResource = vi.fn()
const mockGetShiftSchedule = vi.fn()

vi.mock('../lib/api', () => ({
  Api: {
    tenants: {
      getConfig: (...args: unknown[]) => mockGetConfig(...args),
    },
    calendar: {
      getSettings: (...args: unknown[]) => mockGetCalendarSettings(...args),
      getAuthUrl: (...args: unknown[]) => mockGetAuthUrl(...args),
      disconnect: (...args: unknown[]) => mockDisconnect(...args),
    },
    services: {
      create: (...args: unknown[]) => mockCreateService(...args),
      update: (...args: unknown[]) => mockUpdateService(...args),
      delete: (...args: unknown[]) => mockDeleteService(...args),
    },
    resources: {
      create: (...args: unknown[]) => mockCreateResource(...args),
      update: (...args: unknown[]) => mockUpdateResource(...args),
    },
    shifts: {
      schedule: {
        forDate: (...args: unknown[]) => mockGetShiftSchedule(...args),
      },
    },
    jobber: { getSettings: vi.fn(), getAuthUrl: vi.fn(), disconnect: vi.fn(), triggerSync: vi.fn() },
    hubspot: { getSettings: vi.fn(), getAuthUrl: vi.fn(), disconnect: vi.fn(), triggerSync: vi.fn() },
    square: { getSettings: vi.fn(), getAuthUrl: vi.fn(), disconnect: vi.fn(), triggerSync: vi.fn() },
    servicetitan: { getSettings: vi.fn(), getAuthUrl: vi.fn(), disconnect: vi.fn(), triggerSync: vi.fn() },
  },
}))

// Mock CRMIntegrationCard to simplify tests
vi.mock('./CRMIntegrationCard', () => ({
  CRMIntegrationCard: ({ provider }: { provider: { name: string } }) => (
    <div data-testid={`crm-card-${provider.name}`}>{provider.name} Integration</div>
  ),
}))

import BusinessSettingsView from './BusinessSettingsView'

describe('BusinessSettingsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTenantId = 'test-tenant-123'
    mockResources = []
    mockServices = []
    mockEmployees = []
    mockStaticLoading = false
    mockResourcesError = null

    // Default team mode (team_size > 1)
    mockGetConfig.mockResolvedValue({ team_size: 3 })
    mockGetCalendarSettings.mockResolvedValue(null)
    mockGetAuthUrl.mockResolvedValue({ url: 'https://oauth.example.com' })
    mockDisconnect.mockResolvedValue({ success: true })
    mockCreateService.mockResolvedValue({ success: true })
    mockUpdateService.mockResolvedValue({ success: true })
    mockDeleteService.mockResolvedValue({ success: true })
    mockCreateResource.mockResolvedValue({ success: true })
    mockUpdateResource.mockResolvedValue({ success: true })
    mockGetShiftSchedule.mockResolvedValue([])

    // Mock window.location for OAuth redirect tests
    delete (window as typeof window & { location?: Location }).location
    window.location = { ...window.location, href: '', search: '' } as Location
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Happy Paths - Team Mode', () => {
    test('renders business settings header', async () => {
      render(<BusinessSettingsView />)
      await waitFor(() => {
        expect(screen.getByText('Business Settings')).toBeInTheDocument()
      })
      // WHO: business owners | WHAT: settings page header
      // WHEN: navigating to settings | WHERE: BusinessSettingsView
      // WHY: users need to identify the settings page
    })

    test('shows calendar sync section in team mode', async () => {
      render(<BusinessSettingsView />)
      await waitFor(() => {
        expect(screen.getByText('Calendar Synchronization')).toBeInTheDocument()
      })
      // WHO: team businesses | WHAT: calendar sync header
      // WHEN: team_size > 1 | WHERE: calendar section
      // WHY: team mode has different wording than solo
    })

    test('shows resources section in team mode', async () => {
      render(<BusinessSettingsView />)
      await waitFor(() => {
        expect(screen.getByText('Stations & Capacity Units')).toBeInTheDocument()
      })
      // WHO: team businesses | WHAT: resource management
      // WHEN: team_size > 1 | WHERE: resources section
      // WHY: team mode manages workstations/bays
    })

    test('displays Google and Outlook calendar connection buttons when not connected', async () => {
      render(<BusinessSettingsView />)
      await waitFor(() => {
        expect(screen.getByText('Connect Google Calendar')).toBeInTheDocument()
        expect(screen.getByText('Connect Outlook Calendar')).toBeInTheDocument()
      })
      // WHO: users | WHAT: calendar connection options
      // WHEN: no calendar connected | WHERE: calendar section
      // WHY: offer both major calendar providers
    })

    test('redirects to OAuth URL when connecting Google Calendar', async () => {
      render(<BusinessSettingsView />)
      await waitFor(() => {
        expect(screen.getByText('Connect Google Calendar')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Connect Google Calendar'))

      await waitFor(() => {
        expect(mockGetAuthUrl).toHaveBeenCalledWith('test-tenant-123', 'google')
      })
      // WHO: users connecting calendar | WHAT: OAuth redirect
      // WHEN: clicking connect | WHERE: calendar buttons
      // WHY: initiate OAuth flow for Google
    })

    test('shows connected state and disconnect button when calendar is connected', async () => {
      mockGetCalendarSettings.mockResolvedValue({
        provider: 'google',
        external_calendar_id: 'calendar@gmail.com',
      })

      render(<BusinessSettingsView />)
      await waitFor(() => {
        // Check for disconnect button as it only appears when connected
        expect(screen.getByText('Disconnect')).toBeInTheDocument()
        // Check for calendar ID display
        expect(screen.getByText('ID: calendar@gmail.com')).toBeInTheDocument()
      })
      // WHO: users with connected calendar | WHAT: connected state
      // WHEN: calendar already connected | WHERE: calendar section
      // WHY: show current connection and allow disconnect
    })

    test('disconnects calendar when clicking disconnect', async () => {
      mockGetCalendarSettings.mockResolvedValue({
        provider: 'google',
        external_calendar_id: 'calendar@gmail.com',
      })

      render(<BusinessSettingsView />)
      await waitFor(() => {
        expect(screen.getByText('Disconnect')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Disconnect'))

      await waitFor(() => {
        expect(mockDisconnect).toHaveBeenCalledWith('test-tenant-123')
      })
      // WHO: users | WHAT: calendar disconnect
      // WHEN: clicking disconnect | WHERE: connected state
      // WHY: allow users to unlink calendar
    })

    test('displays CRM integration cards', async () => {
      render(<BusinessSettingsView />)
      await waitFor(() => {
        expect(screen.getByTestId('crm-card-Jobber')).toBeInTheDocument()
        expect(screen.getByTestId('crm-card-HubSpot')).toBeInTheDocument()
        expect(screen.getByTestId('crm-card-Square')).toBeInTheDocument()
        expect(screen.getByTestId('crm-card-ServiceTitan')).toBeInTheDocument()
      })
      // WHO: users | WHAT: CRM integration options
      // WHEN: viewing settings | WHERE: CRM section
      // WHY: connect to external CRM systems
    })

    test('creates new resource when form is submitted', async () => {
      render(<BusinessSettingsView />)
      await waitFor(() => {
        expect(screen.getByPlaceholderText('Station Name (e.g. Station 2)')).toBeInTheDocument()
      })

      fireEvent.change(screen.getByPlaceholderText('Station Name (e.g. Station 2)'), { target: { value: 'Bay 1' } })
      fireEvent.change(screen.getByPlaceholderText('Optional description'), { target: { value: 'Main bay' } })
      fireEvent.click(screen.getByText('Add Station'))

      await waitFor(() => {
        expect(mockCreateResource).toHaveBeenCalledWith('test-tenant-123', {
          name: 'Bay 1',
          description: 'Main bay',
        })
        expect(mockRefreshResources).toHaveBeenCalled()
      })
      // WHO: business owners | WHAT: resource creation
      // WHEN: submitting resource form | WHERE: resources section
      // WHY: add new workstations/capacity
    })

    test('displays existing resources', async () => {
      mockResources = [
        { id: 'res-1', name: 'Bay 1', description: 'Main bay', is_active: true },
        { id: 'res-2', name: 'Bay 2', is_active: false },
      ]

      render(<BusinessSettingsView />)
      await waitFor(() => {
        expect(screen.getByText('Bay 1')).toBeInTheDocument()
        expect(screen.getByText('Main bay')).toBeInTheDocument()
        expect(screen.getByText('Bay 2')).toBeInTheDocument()
      })
      // WHO: users | WHAT: resource list
      // WHEN: viewing settings | WHERE: resources section
      // WHY: show existing capacity units
    })

    test('toggles resource active status', async () => {
      mockResources = [{ id: 'res-1', name: 'Bay 1', is_active: true }]

      render(<BusinessSettingsView />)
      await waitFor(() => {
        expect(screen.getByText('Active')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Active'))

      await waitFor(() => {
        expect(mockUpdateResource).toHaveBeenCalledWith('res-1', { is_active: false })
      })
      // WHO: users managing capacity | WHAT: toggle resource
      // WHEN: clicking status badge | WHERE: resource row
      // WHY: temporarily disable a workstation
    })
  })

  describe('Happy Paths - Solo Mode', () => {
    beforeEach(() => {
      mockGetConfig.mockResolvedValue({ team_size: 1 })
      mockEmployees = [{ id: 'emp-1', name: 'Dale' }]
      mockServices = [{ id: 'svc-1', name: 'Haircut', duration_minutes: 30, description: 'Standard cut' }]
    })

    test('shows solo-specific header text', async () => {
      render(<BusinessSettingsView />)
      await waitFor(() => {
        expect(screen.getByText('Your services, availability, and calendar')).toBeInTheDocument()
      })
      // WHO: solo practitioners | WHAT: personalized header
      // WHEN: team_size = 1 | WHERE: header subtitle
      // WHY: solo users see personalized wording
    })

    test('shows My Services section in solo mode', async () => {
      render(<BusinessSettingsView />)
      await waitFor(() => {
        expect(screen.getByText('My Services')).toBeInTheDocument()
        expect(screen.getByText('What you offer and how long each takes.')).toBeInTheDocument()
      })
      // WHO: solo practitioners | WHAT: services section
      // WHEN: team_size = 1 | WHERE: services card
      // WHY: solo mode shows simplified service management
    })

    test('shows My Availability section in solo mode', async () => {
      mockGetShiftSchedule.mockResolvedValue([
        { shift_date: '2026-04-09', start_time: '09:00:00', end_time: '17:00:00', is_off: false },
      ])

      render(<BusinessSettingsView />)
      await waitFor(() => {
        expect(screen.getByText('My Availability')).toBeInTheDocument()
      })
      // WHO: solo practitioners | WHAT: availability section
      // WHEN: team_size = 1 | WHERE: availability card
      // WHY: show weekly schedule overview
    })

    test('shows My Calendar in solo mode', async () => {
      render(<BusinessSettingsView />)
      await waitFor(() => {
        expect(screen.getByText('My Calendar')).toBeInTheDocument()
      })
      // WHO: solo practitioners | WHAT: personalized calendar header
      // WHEN: team_size = 1 | WHERE: calendar section
      // WHY: solo users see personalized wording
    })

    test('displays existing services list', async () => {
      render(<BusinessSettingsView />)
      await waitFor(() => {
        expect(screen.getByText('Haircut')).toBeInTheDocument()
        expect(screen.getByText('30 min · Standard cut')).toBeInTheDocument()
      })
      // WHO: solo users | WHAT: service list
      // WHEN: services exist | WHERE: My Services card
      // WHY: show what services are offered
    })

    test('opens add service form when Add is clicked', async () => {
      render(<BusinessSettingsView />)
      await waitFor(() => {
        expect(screen.getByText('Add')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Add'))

      expect(screen.getByPlaceholderText('Service name')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('Minutes')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('Description (optional)')).toBeInTheDocument()
      // WHO: solo users | WHAT: add service form
      // WHEN: clicking Add | WHERE: My Services section
      // WHY: create new service offerings
    })

    test('creates new service when form is submitted', async () => {
      render(<BusinessSettingsView />)
      await waitFor(() => {
        expect(screen.getByText('Add')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Add'))
      fireEvent.change(screen.getByPlaceholderText('Service name'), { target: { value: 'Beard Trim' } })
      fireEvent.change(screen.getByPlaceholderText('Minutes'), { target: { value: '15' } })
      fireEvent.click(screen.getByText('Add Service'))

      await waitFor(() => {
        expect(mockCreateService).toHaveBeenCalledWith('test-tenant-123', {
          name: 'Beard Trim',
          description: undefined,
          duration_minutes: 15,
        })
        expect(mockRefreshResources).toHaveBeenCalled()
      })
      // WHO: solo users | WHAT: service creation
      // WHEN: submitting service form | WHERE: add form
      // WHY: expand service offerings
    })

    test('opens edit form when clicking edit button', async () => {
      render(<BusinessSettingsView />)
      await waitFor(() => {
        expect(screen.getByText('Haircut')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTitle('Edit'))

      expect(screen.getByDisplayValue('Haircut')).toBeInTheDocument()
      expect(screen.getByDisplayValue('30')).toBeInTheDocument()
      // WHO: solo users | WHAT: edit service form
      // WHEN: clicking edit | WHERE: service row
      // WHY: modify existing services
    })

    test('updates service when save is clicked', async () => {
      render(<BusinessSettingsView />)
      await waitFor(() => {
        expect(screen.getByText('Haircut')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTitle('Edit'))
      fireEvent.change(screen.getByDisplayValue('Haircut'), { target: { value: 'Premium Haircut' } })
      fireEvent.click(screen.getByText('Save'))

      await waitFor(() => {
        expect(mockUpdateService).toHaveBeenCalledWith('svc-1', 'test-tenant-123', expect.objectContaining({
          name: 'Premium Haircut',
        }))
      })
      // WHO: solo users | WHAT: service update
      // WHEN: saving edit | WHERE: edit form
      // WHY: modify service details
    })

    test('cancels edit when cancel is clicked', async () => {
      render(<BusinessSettingsView />)
      await waitFor(() => {
        expect(screen.getByText('Haircut')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTitle('Edit'))
      expect(screen.getByDisplayValue('Haircut')).toBeInTheDocument()

      fireEvent.click(screen.getByText('Cancel'))

      expect(screen.queryByDisplayValue('Haircut')).not.toBeInTheDocument()
      // WHO: users | WHAT: cancel edit
      // WHEN: clicking cancel | WHERE: edit form
      // WHY: discard changes
    })
  })

  describe('Sad Paths', () => {
    test('shows loading state while fetching team size', async () => {
      mockGetConfig.mockImplementation(() => new Promise(() => {})) // Never resolves
      render(<BusinessSettingsView />)
      expect(screen.getByText('Loading settings...')).toBeInTheDocument()
      // WHO: users | WHAT: loading indicator
      // WHEN: fetching config | WHERE: main view
      // WHY: feedback while determining team size
    })

    test('handles team size fetch error gracefully', async () => {
      mockGetConfig.mockRejectedValue(new Error('Network error'))
      render(<BusinessSettingsView />)
      await waitFor(() => {
        // Should fall back to team mode (teamSize = null treated as team)
        expect(screen.queryByText('My Services')).not.toBeInTheDocument()
      })
      // WHO: users | WHAT: error fallback
      // WHEN: config API fails | WHERE: view rendering
      // WHY: default to team mode on error
    })

    test('shows service name required error when adding empty service', async () => {
      mockGetConfig.mockResolvedValue({ team_size: 1 })
      mockEmployees = [{ id: 'emp-1', name: 'Dale' }]
      mockServices = []

      render(<BusinessSettingsView />)
      await waitFor(() => {
        expect(screen.getByText('Add')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Add'))
      fireEvent.click(screen.getByText('Add Service'))

      expect(screen.getByText('Service name is required')).toBeInTheDocument()
      expect(mockCreateService).not.toHaveBeenCalled()
      // WHO: users | WHAT: validation error
      // WHEN: submitting empty form | WHERE: add service form
      // WHY: prevent empty service names
    })

    test('shows error when service creation fails', async () => {
      mockGetConfig.mockResolvedValue({ team_size: 1 })
      mockEmployees = [{ id: 'emp-1', name: 'Dale' }]
      mockServices = []
      mockCreateService.mockResolvedValue({ success: false })

      render(<BusinessSettingsView />)
      await waitFor(() => {
        expect(screen.getByText('Add')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Add'))
      fireEvent.change(screen.getByPlaceholderText('Service name'), { target: { value: 'Test' } })
      fireEvent.click(screen.getByText('Add Service'))

      await waitFor(() => {
        expect(screen.getByText('Failed to create service')).toBeInTheDocument()
      })
      // WHO: users | WHAT: API error display
      // WHEN: creation fails | WHERE: add form
      // WHY: inform user of failure
    })

    test('shows connection error when service creation throws', async () => {
      mockGetConfig.mockResolvedValue({ team_size: 1 })
      mockEmployees = [{ id: 'emp-1', name: 'Dale' }]
      mockServices = []
      mockCreateService.mockRejectedValue(new Error('Network error'))

      render(<BusinessSettingsView />)
      await waitFor(() => {
        expect(screen.getByText('Add')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Add'))
      fireEvent.change(screen.getByPlaceholderText('Service name'), { target: { value: 'Test' } })
      fireEvent.click(screen.getByText('Add Service'))

      await waitFor(() => {
        expect(screen.getByText('Connection error')).toBeInTheDocument()
      })
      // WHO: users | WHAT: network error display
      // WHEN: API throws | WHERE: add form
      // WHY: distinguish network vs API errors
    })

    test('shows empty services message when no services exist', async () => {
      mockGetConfig.mockResolvedValue({ team_size: 1 })
      mockEmployees = [{ id: 'emp-1', name: 'Dale' }]
      mockServices = []

      render(<BusinessSettingsView />)
      await waitFor(() => {
        expect(screen.getByText('No services yet. Add what you offer so clients can book.')).toBeInTheDocument()
      })
      // WHO: new solo users | WHAT: empty state
      // WHEN: no services | WHERE: services list
      // WHY: guide user to add services
    })

    test('shows empty resources message in team mode', async () => {
      mockResources = []

      render(<BusinessSettingsView />)
      await waitFor(() => {
        expect(screen.getByText('No stations yet. Add your first station above.')).toBeInTheDocument()
      })
      // WHO: new team users | WHAT: empty resources state
      // WHEN: no resources | WHERE: resources list
      // WHY: guide user to add resources
    })

    test('shows no schedule message when shifts are empty', async () => {
      mockGetConfig.mockResolvedValue({ team_size: 1 })
      mockEmployees = [{ id: 'emp-1', name: 'Dale' }]
      mockGetShiftSchedule.mockResolvedValue([])

      render(<BusinessSettingsView />)
      await waitFor(() => {
        expect(screen.getByText('No schedule set yet. Set your hours in Staff & Shifts.')).toBeInTheDocument()
      })
      // WHO: solo users | WHAT: empty schedule state
      // WHEN: no shifts | WHERE: availability section
      // WHY: direct user to set schedule
    })

    test('prevents resource creation without name', async () => {
      render(<BusinessSettingsView />)
      await waitFor(() => {
        expect(screen.getByText('Add Station')).toBeInTheDocument()
      })

      // Button should be disabled when name is empty
      const addButton = screen.getByText('Add Station')
      expect(addButton).toBeDisabled()
      // WHO: users | WHAT: form validation
      // WHEN: empty resource name | WHERE: resource form
      // WHY: prevent empty resource names
    })

    test('displays resources error message', async () => {
      mockResourcesError = 'Failed to load resources'

      render(<BusinessSettingsView />)
      await waitFor(() => {
        expect(screen.getByText('Failed to load resources')).toBeInTheDocument()
      })
      // WHO: users | WHAT: error display
      // WHEN: static data hook error | WHERE: resources section
      // WHY: inform user of data loading issue
    })
  })

  describe('Edge Cases', () => {
    test('hides My Services and My Availability in team mode', async () => {
      mockGetConfig.mockResolvedValue({ team_size: 5 })

      render(<BusinessSettingsView />)
      await waitFor(() => {
        expect(screen.queryByText('My Services')).not.toBeInTheDocument()
        expect(screen.queryByText('My Availability')).not.toBeInTheDocument()
      })
    })

    test('hides Resources section in solo mode', async () => {
      mockGetConfig.mockResolvedValue({ team_size: 1 })
      mockEmployees = [{ id: 'emp-1', name: 'Dale' }]

      render(<BusinessSettingsView />)
      await waitFor(() => {
        expect(screen.queryByText('Stations & Capacity Units')).not.toBeInTheDocument()
      })
    })

    test('shows shifts loading state', async () => {
      mockGetConfig.mockResolvedValue({ team_size: 1 })
      mockEmployees = [{ id: 'emp-1', name: 'Dale' }]
      mockGetShiftSchedule.mockImplementation(() => new Promise(() => {}))

      render(<BusinessSettingsView />)
      await waitFor(() => {
        expect(screen.getByText('Loading schedule...')).toBeInTheDocument()
      })
    })

    test('fetches shifts for solo employee', async () => {
      mockGetConfig.mockResolvedValue({ team_size: 1 })
      mockEmployees = [{ id: 'emp-1', name: 'Dale' }]
      mockGetShiftSchedule.mockResolvedValue([
        { shift_date: '2026-04-09', start_time: '09:00:00', end_time: '17:00:00', is_off: false },
      ])

      render(<BusinessSettingsView />)

      // Wait for solo mode to be detected and shifts to be fetched
      await waitFor(() => {
        expect(mockGetShiftSchedule).toHaveBeenCalled()
      }, { timeout: 3000 })
      // WHO: solo users | WHAT: shift schedule display
      // WHEN: solo mode detected | WHERE: availability section
      // WHY: show working hours for the solo practitioner
    })

    test('shows Off indicator for days off', async () => {
      mockGetConfig.mockResolvedValue({ team_size: 1 })
      mockEmployees = [{ id: 'emp-1', name: 'Dale' }]
      mockGetShiftSchedule.mockResolvedValue([
        { shift_date: '2026-04-09', is_off: true },
      ])

      render(<BusinessSettingsView />)
      await waitFor(() => {
        expect(screen.getByText('Off')).toBeInTheDocument()
      })
    })

    test('shows Connected badge when calendar is connected', async () => {
      mockGetCalendarSettings.mockResolvedValue({
        provider: 'outlook',
        external_calendar_id: 'user@outlook.com',
      })

      render(<BusinessSettingsView />)
      await waitFor(() => {
        expect(screen.getByText('Connected')).toBeInTheDocument()
      })
    })

    test('clears service error when canceling add form', async () => {
      mockGetConfig.mockResolvedValue({ team_size: 1 })
      mockEmployees = [{ id: 'emp-1', name: 'Dale' }]
      mockServices = []

      render(<BusinessSettingsView />)
      await waitFor(() => {
        fireEvent.click(screen.getByText('Add'))
      })

      // Trigger validation error
      fireEvent.click(screen.getByText('Add Service'))
      expect(screen.getByText('Service name is required')).toBeInTheDocument()

      // Cancel should clear error
      fireEvent.click(screen.getByText('Cancel'))
      expect(screen.queryByText('Service name is required')).not.toBeInTheDocument()
    })

    test('handles service without description', async () => {
      mockGetConfig.mockResolvedValue({ team_size: 1 })
      mockEmployees = [{ id: 'emp-1', name: 'Dale' }]
      mockServices = [{ id: 'svc-1', name: 'Quick Trim', duration_minutes: 15 }]

      render(<BusinessSettingsView />)
      await waitFor(() => {
        expect(screen.getByText('Quick Trim')).toBeInTheDocument()
        expect(screen.getByText('15 min')).toBeInTheDocument()
      })
    })

    test('switches from add mode to edit mode when edit is clicked', async () => {
      mockGetConfig.mockResolvedValue({ team_size: 1 })
      mockEmployees = [{ id: 'emp-1', name: 'Dale' }]
      mockServices = [{ id: 'svc-1', name: 'Haircut', duration_minutes: 30 }]

      render(<BusinessSettingsView />)
      await waitFor(() => {
        fireEvent.click(screen.getByText('Add'))
      })

      // Should be in add mode
      expect(screen.getByText('Add Service')).toBeInTheDocument()

      // Click edit
      fireEvent.click(screen.getByTitle('Edit'))

      // Should now be in edit mode, not add mode
      expect(screen.queryByText('Add Service')).not.toBeInTheDocument()
      expect(screen.getByText('Save')).toBeInTheDocument()
    })
  })
})
