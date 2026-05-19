import { describe, test, expect, vi, beforeEach } from 'vitest'
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
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
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

import SetupWizard from './SetupWizard'

// Seed data so wizard step guards allow navigation
const MOCK_SERVICES = [{ id: '1', name: 'Oil Change', duration_minutes: 30, price: 50 }]
const MOCK_EMPLOYEES = [{ id: '1', name: 'Mike', type: 'employee', is_active: true }]

// Mock fetch for API calls — return services/employees so step guards pass
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.setItem('tenantId', 'f234e471-0e60-4163-86c9-93cfd9338e3a')
  ;(global.fetch as unknown as ReturnType<typeof vi.fn>) = vi.fn().mockImplementation((url: string) => {
    const path = typeof url === 'string' ? url : ''
    let data: unknown[] = []
    if (path.includes('/services')) data = MOCK_SERVICES
    else if (path.includes('/employees')) data = MOCK_EMPLOYEES
    return Promise.resolve({ ok: true, json: async () => data })
  })
})

describe('SetupWizard: Shell', () => {
  test('does not render when isOpen is false', () => {
    const { container } = render(
      <SetupWizard isOpen={false} onClose={() => {}} />
    )
    expect(container.innerHTML).toBe('')
  })

  test('renders wizard when isOpen is true', () => {
    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    expect(screen.getByText('Setup Assistant')).toBeInTheDocument()
  })

  test('shows step 1 by default', () => {
    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    expect(screen.getByText('What services do you offer?')).toBeInTheDocument()
    expect(screen.getByText('Step 1 of 7')).toBeInTheDocument()
  })

  test('displays all 7 step labels in progress bar', () => {
    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    // Verb-form chip labels (see SetupWizard/index.tsx getStepLabels()).
    // The footer button still reads "Go Live" (imperative), which is what
    // the getAllByText assertion below covers — it appears at least once
    // (footer) plus the step-7 chip "You're live" is distinct.
    expect(screen.getByText('What you offer')).toBeInTheDocument()
    expect(screen.getByText('Where it happens')).toBeInTheDocument()
    expect(screen.getByText('Who works here')).toBeInTheDocument()
    expect(screen.getByText('When they work')).toBeInTheDocument()
    expect(screen.getByText('Who does what')).toBeInTheDocument()
    expect(screen.getByText('Look it over')).toBeInTheDocument()
    expect(screen.getByText("You're live")).toBeInTheDocument()
  })

  test('calls onClose when X button is clicked', () => {
    const onClose = vi.fn()
    render(<SetupWizard isOpen={true} onClose={onClose} />)
    fireEvent.click(screen.getByLabelText('Close wizard'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('SetupWizard: Navigation', () => {
  test('navigates to step 2 when Next is clicked', () => {
    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Next'))
    expect(screen.getByText('Step 2 of 7')).toBeInTheDocument()
    expect(screen.getByText('Where does work happen?')).toBeInTheDocument()
  })

  test('shows Back button on step 2', () => {
    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    expect(screen.queryByText('Back')).toBeNull()
    fireEvent.click(screen.getByText('Next'))
    expect(screen.getByText('Back')).toBeInTheDocument()
  })

  test('navigates back to step 1 from step 2', () => {
    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Next'))
    fireEvent.click(screen.getByText('Back'))
    expect(screen.getByText('Step 1 of 7')).toBeInTheDocument()
    expect(screen.getByText('What services do you offer?')).toBeInTheDocument()
  })

  test('shows Go Live button on step 6 and Done on step 7', () => {
    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    for (let i = 0; i < 5; i++) {
      fireEvent.click(screen.getByText('Next'))
    }
    expect(screen.getByText('Step 6 of 7')).toBeInTheDocument()
    // Footer button is the imperative "Go Live" (action). The step-7 chip
    // uses the outcome label "You're live" — distinct strings now, so a
    // simple getByText for "Go Live" matches only the footer button.
    fireEvent.click(screen.getByText('Go Live'))
    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.queryByText('Next')).toBeNull()
    // Step-7 chip is the verb-form "You're live" label.
    expect(screen.getByText("You're live")).toBeInTheDocument()
  })

  test('Done button calls onClose', () => {
    const onClose = vi.fn()
    render(<SetupWizard isOpen={true} onClose={onClose} />)
    for (let i = 0; i < 6; i++) {
      const nextBtn = screen.queryByText('Next')
      if (nextBtn) { fireEvent.click(nextBtn); continue }
      const goLiveBtns = screen.queryAllByText('Go Live')
      if (goLiveBtns.length > 0) fireEvent.click(goLiveBtns[goLiveBtns.length - 1])
    }
    fireEvent.click(screen.getByText('Done'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('clicking a completed step in progress bar navigates to it', () => {
    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    // Go to step 3
    fireEvent.click(screen.getByText('Next'))
    fireEvent.click(screen.getByText('Next'))
    expect(screen.getByText('Step 3 of 7')).toBeInTheDocument()
    // Click step 1 chip in progress bar (verb-form label)
    fireEvent.click(screen.getByText('What you offer'))
    expect(screen.getByText('Step 1 of 7')).toBeInTheDocument()
  })
})

describe('SetupWizard: Step 1 Services', () => {
  test('shows empty state when no services exist', async () => {
    // Override mock to return empty services
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>) = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    })
    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText('No services yet. Add your first service to get started.')).toBeInTheDocument()
    })
  })

  test('shows "Add a service" button', () => {
    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    expect(screen.getByText('Add a service')).toBeInTheDocument()
  })

  test('clicking "Add a service" shows the form', () => {
    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Add a service'))
    expect(screen.getByText('New Service')).toBeInTheDocument()
    expect(screen.getByLabelText('Service Name')).toBeInTheDocument()
    expect(screen.getByText('Duration (minutes)')).toBeInTheDocument()
  })

  test('form has Cancel button that hides the form', () => {
    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Add a service'))
    expect(screen.getByText('New Service')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByText('New Service')).toBeNull()
  })

  test('shows validation error for empty service name', async () => {
    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Add a service'))
    fireEvent.click(screen.getByText('Add Service'))
    await waitFor(() => {
      expect(screen.getByText('Service name is required')).toBeInTheDocument()
    })
  })

  test('shows validation error for zero duration', async () => {
    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Add a service'))
    const nameInput = screen.getByLabelText('Service Name')
    const durationInput = screen.getByDisplayValue('30')
    fireEvent.change(nameInput, { target: { value: 'Test Service' } })
    fireEvent.change(durationInput, { target: { value: '0' } })
    fireEvent.click(screen.getByText('Add Service'))
    await waitFor(() => {
      expect(screen.getByText('Duration must be at least 1 minute')).toBeInTheDocument()
    })
  })

  test('default duration is 30 minutes', () => {
    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Add a service'))
    expect(screen.getByDisplayValue('30')).toBeInTheDocument()
  })

  test('renders services from API data', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes('/services')) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: 1, name: 'Oil Change', duration_minutes: 30, description: 'Quick oil change' },
            { id: 2, name: 'Tire Rotation', duration_minutes: 45, description: '' },
          ],
        })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    render(<SetupWizard isOpen={true} onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.getByText('Oil Change')).toBeInTheDocument()
      expect(screen.getByText('Tire Rotation')).toBeInTheDocument()
    })
  })

  test('resets to step 1 when reopened', () => {
    const { rerender } = render(
      <SetupWizard isOpen={true} onClose={() => {}} />
    )
    // Navigate to step 3
    fireEvent.click(screen.getByText('Next'))
    fireEvent.click(screen.getByText('Next'))
    expect(screen.getByText('Step 3 of 7')).toBeInTheDocument()

    // Close and reopen
    rerender(<SetupWizard isOpen={false} onClose={() => {}} />)
    rerender(<SetupWizard isOpen={true} onClose={() => {}} />)
    expect(screen.getByText('Step 1 of 7')).toBeInTheDocument()
  })
})

// --- Step 2: Resources ---

describe('SetupWizard: Step 2 Resources', () => {
  function goToStep2() {
    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Next'))
  }

  test('shows resource step heading', () => {
    goToStep2()
    expect(screen.getByText('Where does work happen?')).toBeInTheDocument()
  })

  test('D3: auto-seeds a default resource on wizard open (no manual add for single-location teams)', async () => {
    // WHO: owner of a single-location shop (one bay, one chair, one room)
    // WHAT: opening the wizard against a tenant with zero resources must
    //       POST /resources/create once with the vocab-driven default name.
    //       The generic-vocab branch lands on "Main Location"; templated
    //       vocab (resource_label !== "Resource") uses "<label> 1".
    // WHERE: dashboard/components/SetupWizard/index.tsx seedFromTemplate effect.
    // WHY: removing the empty-state friction is the whole point of D3
    //      ("skip a step" for 1-location teams). Without this assertion,
    //      a regression that drops the resource-seed branch from
    //      seedFromTemplate would only surface when a beta customer
    //      complained about needing to manually create their first bay.
    const calls: { url: string; body: unknown }[] = []
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (url: string, init?: { method?: string; body?: string }) => {
        if (init?.method === 'POST' && init?.body) {
          try {
            calls.push({ url, body: JSON.parse(init.body) })
          } catch { /* non-JSON body — ignore */ }
        }
        const path = typeof url === 'string' ? url : ''
        let data: unknown = []
        if (path.includes('/services')) data = MOCK_SERVICES
        else if (path.includes('/employees')) data = MOCK_EMPLOYEES
        else if (path.includes('/tenants/') && path.includes('/config')) data = { business_type: 'automotive' }
        else if (path.includes('/templates')) data = []
        return Promise.resolve({ ok: true, json: async () => data })
      },
    )

    goToStep2()

    // The resource seed call must land — vocab.resource_label === 'Resource'
    // (the test mock returns the generic vocab), so the default is "Main Location".
    await waitFor(() => {
      const seed = calls.find((c) =>
        c.url.includes('/resources/create')
        && (c.body as { name?: string })?.name === 'Main Location',
      )
      expect(seed).toBeDefined()
    })
  })

  test('shows "Add a resource" button', () => {
    goToStep2()
    expect(screen.getByText('Add a resource')).toBeInTheDocument()
  })

  test('clicking "Add a resource" shows the form', () => {
    goToStep2()
    fireEvent.click(screen.getByText('Add a resource'))
    expect(screen.getByText('New Resource')).toBeInTheDocument()
    expect(screen.getByLabelText('Resource Name')).toBeInTheDocument()
  })

  test('form Cancel button hides the form', () => {
    goToStep2()
    fireEvent.click(screen.getByText('Add a resource'))
    expect(screen.getByText('New Resource')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByText('New Resource')).toBeNull()
  })

  test('shows validation error for empty resource name', async () => {
    goToStep2()
    fireEvent.click(screen.getByText('Add a resource'))
    fireEvent.click(screen.getByText('Add Resource'))
    await waitFor(() => {
      expect(screen.getByText('Resource name is required')).toBeInTheDocument()
    })
  })

  test('renders resources from API data', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes('/resources')) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: 'r1', name: 'Bay 1', description: 'Front bay', is_active: true },
            { id: 'r2', name: 'Bay 2', description: '', is_active: true },
          ],
        })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Next'))

    await waitFor(() => {
      expect(screen.getByText('Bay 1')).toBeInTheDocument()
      expect(screen.getByText('Bay 2')).toBeInTheDocument()
    })
  })
})

// --- Step 3: Employees ---

describe('SetupWizard: Step 3 Employees', () => {
  function goToStep3() {
    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Next'))
    fireEvent.click(screen.getByText('Next'))
  }

  test('shows employee step heading', () => {
    goToStep3()
    expect(screen.getByText('Who works here?')).toBeInTheDocument()
  })

  test('shows empty state when no employees exist', async () => {
    // Override mock to return empty employees
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>) = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/services')) return Promise.resolve({ ok: true, json: async () => MOCK_SERVICES })
      return Promise.resolve({ ok: true, json: async () => [] })
    })
    goToStep3()
    await waitFor(() => {
      expect(screen.getByText('No employees yet. Add your first team member.')).toBeInTheDocument()
    })
  })

  test('shows "Add an employee" button', () => {
    goToStep3()
    expect(screen.getByText('Add an employee')).toBeInTheDocument()
  })

  test('clicking "Add an employee" shows the form with first/last name fields', () => {
    goToStep3()
    fireEvent.click(screen.getByText('Add an employee'))
    expect(screen.getByText('New Employee')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('First name')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Last name')).toBeInTheDocument()
  })

  test('form Cancel button hides the form', () => {
    goToStep3()
    fireEvent.click(screen.getByText('Add an employee'))
    expect(screen.getByText('New Employee')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByText('New Employee')).toBeNull()
  })

  test('shows validation error for empty first name', async () => {
    goToStep3()
    fireEvent.click(screen.getByText('Add an employee'))
    fireEvent.click(screen.getByText('Add Employee'))
    await waitFor(() => {
      expect(screen.getByText('First name is required')).toBeInTheDocument()
    })
  })

  test('renders employees from API data', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes('/employees')) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: 'e1', first_name: 'Mike', last_name: 'Smith', email: 'mike@test.com', is_active: true },
            { id: 'e2', first_name: 'Sarah', last_name: 'Jones', phone: '+15551234567', is_active: true },
          ],
        })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Next'))
    fireEvent.click(screen.getByText('Next'))

    await waitFor(() => {
      expect(screen.getByText('Mike Smith')).toBeInTheDocument()
      expect(screen.getByText('Sarah Jones')).toBeInTheDocument()
    })
  })

  test('shows email and phone fields in the form', () => {
    goToStep3()
    fireEvent.click(screen.getByText('Add an employee'))
    expect(screen.getByPlaceholderText('email@example.com')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('+1 (555) 555-5555')).toBeInTheDocument()
  })
})

// --- Step 4: Shifts ---

describe('SetupWizard: Step 4 Shifts', () => {
  test('shows shift step heading', () => {
    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Next'))
    fireEvent.click(screen.getByText('Next'))
    fireEvent.click(screen.getByText('Next'))
    expect(screen.getByText('When does everyone work?')).toBeInTheDocument()
  })

  test('shows empty message when no employees exist', async () => {
    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Next'))
    fireEvent.click(screen.getByText('Next'))
    fireEvent.click(screen.getByText('Next'))
    await waitFor(() => {
      expect(screen.getByText('No employees yet. Go back to Step 3 to add team members first.')).toBeInTheDocument()
    })
  })

  test('shows employee selector and schedule grid (ephemeral form state)', async () => {
    // WHO: owner stepping into Step 4 (Shifts) of the team wizard.
    // WHAT: employee selector lists active employees; schedule grid
    //       shows 7 day rows for the selected employee. Step 4 is now
    //       ephemeral form state — no shifts are pre-loaded from any
    //       server call. The user toggles days locally and the whole
    //       pattern is sent to /shifts/expand-weekly when they cross
    //       into step 7.
    // WHY: post-rip-out of employee_shifts (NEEDS-REFACTORING #4
    //       Phase 2), there's no backend representation of the wizard's
    //       weekly grid until finalize. This test pins the new
    //       ephemeral contract so a regression that re-introduces a
    //       fetch on step entry would be caught.
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>) = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/services')) {
        return Promise.resolve({ ok: true, json: async () => MOCK_SERVICES })
      }
      if (url.includes('/employees')) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: 'e1', first_name: 'Mike', last_name: 'Smith', name: 'Mike Smith', is_active: true },
            { id: 'e2', first_name: 'Sarah', last_name: 'Jones', name: 'Sarah Jones', is_active: true },
          ],
        })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    render(<SetupWizard isOpen={true} onClose={() => {}} />)

    // Wait for employees to load on step 1
    await waitFor(() => expect(screen.getByText('Add a service')).toBeInTheDocument())

    // Navigate to step 4
    fireEvent.click(screen.getByText('Next'))
    fireEvent.click(screen.getByText('Next'))
    fireEvent.click(screen.getByText('Next'))

    // Employee selector should show both names
    await waitFor(() => {
      expect(screen.getByText(/Mike Smith/)).toBeInTheDocument()
      expect(screen.getByText(/Sarah Jones/)).toBeInTheDocument()
    })

    // Prompt before selection
    expect(screen.getByText('Select an employee above to set their schedule.')).toBeInTheDocument()

    // Step 4 is ephemeral — no day-count badges should appear because
    // both employees start with zero shifts in form state.
    expect(screen.queryByText(/\(\dd\)/)).not.toBeInTheDocument()

    // Select Mike
    fireEvent.click(screen.getAllByText(/Mike Smith/)[0])

    // Should show 7 day rows
    await waitFor(() => {
      expect(screen.getByText('Sun')).toBeInTheDocument()
      expect(screen.getByText('Mon')).toBeInTheDocument()
      expect(screen.getByText('Sat')).toBeInTheDocument()
    })

    // All 7 days start as "Off" — ephemeral state begins empty.
    const offLabels = screen.getAllByText('Off')
    expect(offLabels.length).toBe(7)
  })
})

// --- Step 5: Assignments ---

describe('SetupWizard: Step 5 Assignments', () => {
  function goToStep5() {
    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByText('Next'))
  }

  test('shows assignment step heading', () => {
    goToStep5()
    expect(screen.getByText('Connect everything together')).toBeInTheDocument()
  })

  test('shows empty state when no services exist', async () => {
    goToStep5()
    await waitFor(() => {
      expect(screen.getByText('No services yet. Go back to Step 1 to add services first.')).toBeInTheDocument()
    })
  })

  test('shows service cards with employee and resource toggles', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>) = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/services')) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: 1, name: 'Oil Change', duration_minutes: 30 },
          ],
        })
      }
      if (url.includes('/employees')) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: 'e1', first_name: 'Mike', last_name: 'Smith', is_active: true },
          ],
        })
      }
      if (url.includes('/resources')) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: 'r1', name: 'Bay 1', is_active: true },
          ],
        })
      }
      if (url.includes('/mappings/service-employee')) {
        return Promise.resolve({
          ok: true,
          json: async () => [{ service_id: 1, employee_id: 'e1' }],
        })
      }
      if (url.includes('/mappings/service-resource')) {
        return Promise.resolve({ ok: true, json: async () => [] })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    await waitFor(() => expect(screen.getAllByText('Oil Change').length).toBeGreaterThan(0))

    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByText('Next'))

    await waitFor(() => {
      // Service card with Oil Change
      expect(screen.getAllByText('Oil Change').length).toBeGreaterThan(0)
      // Staff and Resources section headers
      expect(screen.getAllByText('Employees').length).toBeGreaterThan(0)
      // Employee toggle
      expect(screen.getByText(/Mike Smith/)).toBeInTheDocument()
      // Resource toggle
      expect(screen.getByText('Bay 1')).toBeInTheDocument()
      // Description text
      // Description text about assigning employees/resources
      expect(screen.getAllByText(/assign|employees|resources/i).length).toBeGreaterThan(0)
    })
  })
})

// --- Step 6: Review ---

describe('SetupWizard: Step 6 Review', () => {
  function goToStep6() {
    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByText('Next'))
  }

  test('shows review step heading', () => {
    goToStep6()
    expect(screen.getByText('Review your setup')).toBeInTheDocument()
  })

  test('shows summary counts', () => {
    goToStep6()
    // With empty data, all counts should be 0
    const zeros = screen.getAllByText('0')
    expect(zeros.length).toBe(3)
  })

  test('shows coverage badges from API data', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>) = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/services')) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: 1, name: 'Oil Change' },
            { id: 2, name: 'Brakes' },
          ],
        })
      }
      if (url.includes('/employees')) {
        return Promise.resolve({ ok: true, json: async () => MOCK_EMPLOYEES })
      }
      if (url.includes('/coverage')) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { service_id: 1, service_name: 'Oil Change', coverage_pct: 100, status: 'full' },
            { service_id: 2, service_name: 'Brakes', coverage_pct: 0, status: 'uncovered' },
          ],
        })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('Oil Change')).toBeInTheDocument())

    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByText('Next'))

    await waitFor(() => {
      expect(screen.getByText('Full Coverage')).toBeInTheDocument()
      expect(screen.getByText('Uncovered')).toBeInTheDocument()
    })
  })

  test('shows success message when all services fully covered', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>) = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/services')) {
        return Promise.resolve({
          ok: true,
          json: async () => [{ id: 1, name: 'Oil Change' }],
        })
      }
      if (url.includes('/employees')) {
        return Promise.resolve({ ok: true, json: async () => MOCK_EMPLOYEES })
      }
      if (url.includes('/coverage')) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { service_id: 1, service_name: 'Oil Change', coverage_pct: 100, status: 'full' },
          ],
        })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('Oil Change')).toBeInTheDocument())
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByText('Next'))

    await waitFor(() => {
      expect(screen.getByText("You're ready to go! All services are fully covered.")).toBeInTheDocument()
    })
  })

  test('shows warning message when services are not fully staffed', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>) = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/services')) {
        return Promise.resolve({
          ok: true,
          json: async () => [{ id: 1, name: 'Brakes' }],
        })
      }
      if (url.includes('/employees')) {
        return Promise.resolve({ ok: true, json: async () => MOCK_EMPLOYEES })
      }
      if (url.includes('/coverage')) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { service_id: 1, service_name: 'Brakes', coverage_pct: 50, status: 'partial' },
          ],
        })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('Brakes')).toBeInTheDocument())
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByText('Next'))

    await waitFor(() => {
      expect(screen.getByText(/Some services aren't fully staffed yet/)).toBeInTheDocument()
    })
  })

  test('shows "No services configured" when empty', async () => {
    // Override to return empty services (step guard allows during loading)
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>) = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    })
    goToStep6()
    await waitFor(() => {
      expect(screen.getByText('No services configured yet.')).toBeInTheDocument()
    })
  })
})

// --- Step 7: Go Live ---

describe('SetupWizard: Step 7 Go Live', () => {
  function goToStep7() {
    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByText('Next'))
    // Step 6 → click "Go Live" footer button
    const goLiveBtns = screen.getAllByText('Go Live')
    fireEvent.click(goLiveBtns[goLiveBtns.length - 1])
  }

  test('shows Go Live heading and description', () => {
    goToStep7()
    expect(screen.getByText('Activate your AI phone line. Once active, callers will reach your AI receptionist who can book appointments, answer questions, and manage your schedule.')).toBeInTheDocument()
    expect(screen.getByText('Step 7 of 7')).toBeInTheDocument()
  })

  test('fans weekly availability into employee_schedule on transition to step 7', async () => {
    // WHO: owner who finished setting weekly hours in step 4 and is
    //      progressing through Review → Go Live.
    // WHAT: transitioning into step 7 must POST /shifts/expand-weekly
    //      once per active employee. Without this the booking RPCs
    //      (which only read employee_schedule) reject every request
    //      from the just-onboarded tenant with EMPLOYEE_NOT_SCHEDULED.
    // WHERE: dashboard/components/SetupWizard/index.tsx goNext() —
    //      the if (next === 7) hook that calls Api.shifts.expandWeekly.
    // WHEN: on the click that advances from step 6 (Review) to step 7.
    // WHY: this is the bridge between weekly-pattern onboarding and
    //      date-specific booking storage. Pre-fix, owners hit a
    //      silent failure mode after completing the wizard.
    render(<SetupWizard isOpen={true} onClose={() => {}} />)

    // Wait for static data to load — without this, activeEmployees is
    // captured empty in the goNext closure and the fan-out loop runs
    // zero iterations (the actual production code is gated on
    // activeEmployees so this matches the live behavior).
    await waitFor(() => {
      expect(screen.getByText('Add a service')).toBeInTheDocument()
    })

    // Step 1 → 6 via Next, awaiting between clicks so each async
    // goNext settles before the next click reads stale state.
    for (let i = 0; i < 5; i++) {
      fireEvent.click(screen.getByText('Next'))
      // Tick the microtask queue
      await Promise.resolve()
    }

    // Step 6 → 7 via the footer "Go Live" button. The fan-out fires
    // here (next === 7 branch in goNext).
    const goLiveBtns = screen.getAllByText('Go Live')
    fireEvent.click(goLiveBtns[goLiveBtns.length - 1])

    await waitFor(() => {
      expect(screen.getByText('Step 7 of 7')).toBeInTheDocument()
    })

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    const expandCalls = fetchMock.mock.calls.filter((call) => {
      const url = String(call[0] ?? '')
      const init = call[1] as RequestInit | undefined
      return url.includes('/shifts/expand-weekly') && init?.method === 'POST'
    })
    expect(expandCalls.length).toBe(MOCK_EMPLOYEES.length)
  })

  test('shows area code input and activate button', () => {
    goToStep7()
    expect(screen.getByPlaceholderText('e.g. 312')).toBeInTheDocument()
    expect(screen.getByText('Activate AI Phone Line')).toBeInTheDocument()
  })

  test('area code input only accepts digits and max 3 chars', () => {
    goToStep7()
    const input = screen.getByPlaceholderText<HTMLInputElement>('e.g. 312')
    fireEvent.change(input, { target: { value: 'abc123xyz' } })
    expect(input.value).toBe('123')
    fireEvent.change(input, { target: { value: '12345' } })
    expect(input.value).toBe('123')
  })

  test('shows skip message', () => {
    goToStep7()
    expect(screen.getByText('You can skip this step and activate later from Settings.')).toBeInTheDocument()
  })

  test('shows provisioning state when activating', async () => {
    // Mock fetch to delay the provisioning response
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes('/provisioning/status')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ phone_status: null, inbound_phone: null, telnyx_phone_number_id: null }),
        })
      }
      if (url.includes('/provisioning/activate')) {
        return new Promise(() => {}) // Never resolves — stuck in provisioning
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    goToStep7()
    await waitFor(() => expect(screen.getByText('Activate AI Phone Line')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Activate AI Phone Line'))

    await waitFor(() => {
      expect(screen.getByText('Setting up your phone line...')).toBeInTheDocument()
    })
  })

  test('shows success state with phone number after activation', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes('/provisioning/status')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ phone_status: null, inbound_phone: null, telnyx_phone_number_id: null }),
        })
      }
      if (url.includes('/provisioning/activate')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            phone_number: '+1 (630) 555-1234',
            assistant_id: 'asst_123',
            phone_number_id: 'pn_456',
          }),
        })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    goToStep7()
    await waitFor(() => expect(screen.getByText('Activate AI Phone Line')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Activate AI Phone Line'))

    await waitFor(() => {
      expect(screen.getByText('Your AI line is live')).toBeInTheDocument()
      expect(screen.getByText('+1 (630) 555-1234')).toBeInTheDocument()
      expect(screen.getByText('Try calling this number to test your AI receptionist.')).toBeInTheDocument()
    })
  })

  test('shows error state when activation fails', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes('/provisioning/status')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ phone_status: null, inbound_phone: null, telnyx_phone_number_id: null }),
        })
      }
      if (url.includes('/provisioning/activate')) {
        return Promise.reject(new Error('Business type not configured'))
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    goToStep7()
    await waitFor(() => expect(screen.getByText('Activate AI Phone Line')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Activate AI Phone Line'))

    await waitFor(() => {
      expect(screen.getByText('Activation failed')).toBeInTheDocument()
      expect(screen.getByText('Business type not configured')).toBeInTheDocument()
    })
  })

  test('shows already active state when phone is provisioned', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes('/provisioning/status')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ phone_status: 'active', inbound_phone: '+1 (312) 555-9999', telnyx_phone_number_id: 'tnum_abc' }),
        })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    goToStep7()

    await waitFor(() => {
      expect(screen.getByText('Your AI line is live')).toBeInTheDocument()
      expect(screen.getByText('+1 (312) 555-9999')).toBeInTheDocument()
    })
  })

  test('area code is passed to the API', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/provisioning/status')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ phone_status: null, inbound_phone: null, telnyx_phone_number_id: null }),
        })
      }
      if (url.includes('/provisioning/activate')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            phone_number: '+1 (630) 555-0001',
            assistant_id: 'asst_test',
            phone_number_id: 'pn_test',
          }),
        })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })
    ;(global.fetch as unknown) = mockFetch

    goToStep7()
    await waitFor(() => expect(screen.getByText('Activate AI Phone Line')).toBeInTheDocument())

    const input = screen.getByPlaceholderText<HTMLInputElement>('e.g. 312')
    fireEvent.change(input, { target: { value: '630' } })

    fireEvent.click(screen.getByText('Activate AI Phone Line'))

    await waitFor(() => {
      const activateCall = mockFetch.mock.calls.find(
        (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('/provisioning/activate')
      )
      expect(activateCall).toBeDefined()
      const body = JSON.parse(activateCall![1]?.body as string)
      expect(body.area_code).toBe('630')
    })
  })

  test('handles status API failure on mount gracefully', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes('/provisioning/status')) {
        return Promise.reject(new Error('Network error'))
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    goToStep7()

    // Component should still render the activate button without crashing
    await waitFor(() => {
      expect(screen.getByText('Activate AI Phone Line')).toBeInTheDocument()
    })
    expect(screen.getByPlaceholderText('e.g. 312')).toBeInTheDocument()
  })
})

// =============================================================================
// SAD PATH TESTS
// =============================================================================

describe('SetupWizard: Sad Paths — Service Creation Failure', () => {
  test('shows error when service creation throws a network error', async () => {
    // First call to /services (list) returns empty, then POST to /services/create rejects
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/services/create') && options?.method === 'POST') {
        return Promise.reject(new Error('Network request failed'))
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Add a service'))

    const nameInput = screen.getByLabelText('Service Name')
    fireEvent.change(nameInput, { target: { value: 'Brake Pad Replacement' } })
    fireEvent.click(screen.getByText('Add Service'))

    await waitFor(() => {
      expect(screen.getByText('Network request failed')).toBeInTheDocument()
    })
  })

  test('form remains open after service creation failure so user can retry', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/services/create') && options?.method === 'POST') {
        return Promise.reject(new Error('Server unavailable'))
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Add a service'))

    const nameInput = screen.getByLabelText('Service Name')
    fireEvent.change(nameInput, { target: { value: 'Oil Change' } })
    fireEvent.click(screen.getByText('Add Service'))

    await waitFor(() => {
      expect(screen.getByText('Server unavailable')).toBeInTheDocument()
    })
    // Form should still be open with the name filled in
    expect(screen.getByText('New Service')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Oil Change')).toBeInTheDocument()
  })

  test('saving indicator resets after service creation failure', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/services/create') && options?.method === 'POST') {
        return Promise.reject(new Error('Timeout'))
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Add a service'))

    fireEvent.change(screen.getByLabelText('Service Name'), { target: { value: 'Test' } })
    fireEvent.click(screen.getByText('Add Service'))

    await waitFor(() => {
      expect(screen.getByText('Timeout')).toBeInTheDocument()
    })
    // Button should not be stuck in "Saving..." state
    expect(screen.getByText('Add Service')).toBeInTheDocument()
    expect(screen.queryByText('Saving...')).toBeNull()
  })
})

describe('SetupWizard: Sad Paths — Resource Creation Failure', () => {
  test('shows error when resource creation throws a network error', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/resources/create') && options?.method === 'POST') {
        return Promise.reject(new Error('Failed to create resource'))
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Next')) // Go to Step 2
    fireEvent.click(screen.getByText('Add a resource'))

    const nameInput = screen.getByLabelText('Resource Name')
    fireEvent.change(nameInput, { target: { value: 'Bay 3' } })
    fireEvent.click(screen.getByText('Add Resource'))

    await waitFor(() => {
      expect(screen.getByText('Failed to create resource')).toBeInTheDocument()
    })
  })

  test('resource form remains open after creation failure', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/resources/create') && options?.method === 'POST') {
        return Promise.reject(new Error('DB connection lost'))
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Next'))
    fireEvent.click(screen.getByText('Add a resource'))

    fireEvent.change(screen.getByLabelText('Resource Name'), { target: { value: 'Bay 3' } })
    fireEvent.click(screen.getByText('Add Resource'))

    await waitFor(() => {
      expect(screen.getByText('DB connection lost')).toBeInTheDocument()
    })
    expect(screen.getByText('New Resource')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Bay 3')).toBeInTheDocument()
  })
})

describe('SetupWizard: Sad Paths — Employee Creation Failure', () => {
  test('shows error when employee creation throws a network error', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/employees/create') && options?.method === 'POST') {
        return Promise.reject(new Error('Employee creation failed'))
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Next'))
    fireEvent.click(screen.getByText('Next')) // Go to Step 3
    fireEvent.click(screen.getByText('Add an employee'))

    fireEvent.change(screen.getByPlaceholderText('First name'), { target: { value: 'John' } })
    fireEvent.change(screen.getByPlaceholderText('Last name'), { target: { value: 'Doe' } })
    fireEvent.click(screen.getByText('Add Employee'))

    await waitFor(() => {
      expect(screen.getByText('Employee creation failed')).toBeInTheDocument()
    })
  })

  test('employee form remains open after creation failure', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/employees/create') && options?.method === 'POST') {
        return Promise.reject(new Error('Duplicate email'))
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Next'))
    fireEvent.click(screen.getByText('Next'))
    fireEvent.click(screen.getByText('Add an employee'))

    fireEvent.change(screen.getByPlaceholderText('First name'), { target: { value: 'Jane' } })
    fireEvent.change(screen.getByPlaceholderText('Last name'), { target: { value: 'Smith' } })
    fireEvent.click(screen.getByText('Add Employee'))

    await waitFor(() => {
      expect(screen.getByText('Duplicate email')).toBeInTheDocument()
    })
    expect(screen.getByText('New Employee')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Jane')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Smith')).toBeInTheDocument()
  })
})

describe('SetupWizard: Sad Paths — Validation (Empty Form Submissions)', () => {
  test('service: empty name and valid duration prevents submission', async () => {
    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Add a service'))

    // Leave name empty, keep default duration
    fireEvent.click(screen.getByText('Add Service'))

    await waitFor(() => {
      expect(screen.getByText('Service name is required')).toBeInTheDocument()
    })
    // Form should still be open
    expect(screen.getByText('New Service')).toBeInTheDocument()
  })

  test('service: whitespace-only name is treated as empty', async () => {
    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Add a service'))

    fireEvent.change(screen.getByLabelText('Service Name'), { target: { value: '   ' } })
    fireEvent.click(screen.getByText('Add Service'))

    await waitFor(() => {
      expect(screen.getByText('Service name is required')).toBeInTheDocument()
    })
  })

  test('service: negative duration shows validation error', async () => {
    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Add a service'))

    fireEvent.change(screen.getByLabelText('Service Name'), { target: { value: 'Haircut' } })
    fireEvent.change(screen.getByDisplayValue('30'), { target: { value: '-5' } })
    fireEvent.click(screen.getByText('Add Service'))

    await waitFor(() => {
      expect(screen.getByText('Duration must be at least 1 minute')).toBeInTheDocument()
    })
  })

  test('resource: empty name prevents submission', async () => {
    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Next'))
    fireEvent.click(screen.getByText('Add a resource'))

    fireEvent.click(screen.getByText('Add Resource'))

    await waitFor(() => {
      expect(screen.getByText('Resource name is required')).toBeInTheDocument()
    })
    expect(screen.getByText('New Resource')).toBeInTheDocument()
  })

  test('resource: whitespace-only name is treated as empty', async () => {
    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Next'))
    fireEvent.click(screen.getByText('Add a resource'))

    fireEvent.change(screen.getByLabelText('Resource Name'), { target: { value: '   ' } })
    fireEvent.click(screen.getByText('Add Resource'))

    await waitFor(() => {
      expect(screen.getByText('Resource name is required')).toBeInTheDocument()
    })
  })

  test('employee: empty first name prevents submission', async () => {
    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Next'))
    fireEvent.click(screen.getByText('Next'))
    fireEvent.click(screen.getByText('Add an employee'))

    // Fill last name but leave first name empty
    fireEvent.change(screen.getByPlaceholderText('Last name'), { target: { value: 'Doe' } })
    fireEvent.click(screen.getByText('Add Employee'))

    await waitFor(() => {
      expect(screen.getByText('First name is required')).toBeInTheDocument()
    })
    expect(screen.getByText('New Employee')).toBeInTheDocument()
  })

  test('employee: whitespace-only first name is treated as empty', async () => {
    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Next'))
    fireEvent.click(screen.getByText('Next'))
    fireEvent.click(screen.getByText('Add an employee'))

    fireEvent.change(screen.getByPlaceholderText('First name'), { target: { value: '   ' } })
    fireEvent.click(screen.getByText('Add Employee'))

    await waitFor(() => {
      expect(screen.getByText('First name is required')).toBeInTheDocument()
    })
  })
})

describe('SetupWizard: Sad Paths — Phone Provisioning Failure', () => {
  function goToStep7() {
    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByText('Next'))
    const goLiveBtns = screen.getAllByText('Go Live')
    fireEvent.click(goLiveBtns[goLiveBtns.length - 1])
  }

  test('shows error state with descriptive message when activation network fails', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes('/provisioning/status')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ phone_status: null, inbound_phone: null, telnyx_phone_number_id: null }),
        })
      }
      if (url.includes('/provisioning/activate')) {
        return Promise.reject(new Error('Connection timed out'))
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    goToStep7()
    await waitFor(() => expect(screen.getByText('Activate AI Phone Line')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Activate AI Phone Line'))

    await waitFor(() => {
      expect(screen.getByText('Activation failed')).toBeInTheDocument()
      expect(screen.getByText('Connection timed out')).toBeInTheDocument()
    })
  })

  test('activate button is re-enabled after provisioning failure so user can retry', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes('/provisioning/status')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ phone_status: null, inbound_phone: null, telnyx_phone_number_id: null }),
        })
      }
      if (url.includes('/provisioning/activate')) {
        return Promise.reject(new Error('Telnyx API error'))
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    goToStep7()
    await waitFor(() => expect(screen.getByText('Activate AI Phone Line')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Activate AI Phone Line'))

    await waitFor(() => {
      expect(screen.getByText('Activation failed')).toBeInTheDocument()
    })
    // Activate button should still be visible (not stuck in spinner)
    expect(screen.getByText('Activate AI Phone Line')).toBeInTheDocument()
  })

  test('skip message is hidden when error is shown', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes('/provisioning/status')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ phone_status: null, inbound_phone: null, telnyx_phone_number_id: null }),
        })
      }
      if (url.includes('/provisioning/activate')) {
        return Promise.reject(new Error('No numbers available'))
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    goToStep7()
    await waitFor(() => expect(screen.getByText('Activate AI Phone Line')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Activate AI Phone Line'))

    await waitFor(() => {
      expect(screen.getByText('Activation failed')).toBeInTheDocument()
    })
    // Skip message should be replaced by the error
    expect(screen.queryByText('You can skip this step and activate later from Settings.')).toBeNull()
  })

  test('generic error message used when error is not an Error instance', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes('/provisioning/status')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ phone_status: null, inbound_phone: null, telnyx_phone_number_id: null }),
        })
      }
      if (url.includes('/provisioning/activate')) {
        return Promise.reject('string error without Error wrapper')
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    goToStep7()
    await waitFor(() => expect(screen.getByText('Activate AI Phone Line')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Activate AI Phone Line'))

    await waitFor(() => {
      expect(screen.getByText('Activation failed')).toBeInTheDocument()
      expect(screen.getByText('Failed to activate phone')).toBeInTheDocument()
    })
  })
})

describe('SetupWizard: Sad Paths — Empty Lists Handled Gracefully', () => {
  test('step 4 (shifts) shows empty message when no employees exist', async () => {
    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByText('Next'))

    await waitFor(() => {
      expect(screen.getByText('No employees yet. Go back to Step 3 to add team members first.')).toBeInTheDocument()
    })
  })

  test('step 5 (assignments) shows empty message when no services exist', async () => {
    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByText('Next'))

    await waitFor(() => {
      expect(screen.getByText('No services yet. Go back to Step 1 to add services first.')).toBeInTheDocument()
    })
  })

  test('step 6 (review) shows "No services configured" with empty data', async () => {
    // Override to return empty data (step guard allows during loading)
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>) = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    })
    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByText('Next'))

    await waitFor(() => {
      expect(screen.getByText('No services configured yet.')).toBeInTheDocument()
    })
  })

  test('step 6 (review) shows zero counts with empty data', () => {
    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByText('Next'))

    const zeros = screen.getAllByText('0')
    expect(zeros.length).toBe(3)
  })

  test('wizard does not crash when API returns non-array for services', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes('/services')) {
        return Promise.resolve({ ok: true, json: async () => ({ unexpected: 'object' }) })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    // Should not crash — should show empty state
    await waitFor(() => {
      expect(screen.getByText('What services do you offer?')).toBeInTheDocument()
    })
  })
})

describe('SetupWizard: Sad Paths — Service Deletion Failure', () => {
  test('deletion error does not crash the wizard and service remains in list', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/services') && !url.includes('delete')) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: 1, name: 'Oil Change', duration_minutes: 30, description: '' },
          ],
        })
      }
      if (url.includes('/delete') && options?.method === 'DELETE') {
        return Promise.reject(new Error('Cannot delete: service has appointments'))
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    render(<SetupWizard isOpen={true} onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.getByText('Oil Change')).toBeInTheDocument()
    })

    // Click the delete button (trash icon)
    const deleteBtn = screen.getByTitle('Delete')
    fireEvent.click(deleteBtn)

    // Wizard should not crash — service should still be visible
    await waitFor(() => {
      expect(screen.getByText('Oil Change')).toBeInTheDocument()
    })
    // Step heading still visible
    expect(screen.getByText('What services do you offer?')).toBeInTheDocument()
  })
})

describe('SetupWizard: Sad Paths — Navigation After Error', () => {
  test('error clears when opening add form after a previous error', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/services/create') && options?.method === 'POST') {
        return Promise.reject(new Error('Save failed'))
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    render(<SetupWizard isOpen={true} onClose={() => {}} />)

    // Trigger an error
    fireEvent.click(screen.getByText('Add a service'))
    fireEvent.change(screen.getByLabelText('Service Name'), { target: { value: 'Test' } })
    fireEvent.click(screen.getByText('Add Service'))

    await waitFor(() => {
      expect(screen.getByText('Save failed')).toBeInTheDocument()
    })

    // Cancel and re-open the form — error should be cleared
    fireEvent.click(screen.getByText('Cancel'))
    fireEvent.click(screen.getByText('Add a service'))

    expect(screen.queryByText('Save failed')).toBeNull()
  })

  test('navigating back then forward preserves wizard state without crash', () => {
    render(<SetupWizard isOpen={true} onClose={() => {}} />)

    // Navigate forward to step 4
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByText('Next'))
    expect(screen.getByText('Step 4 of 7')).toBeInTheDocument()

    // Navigate back to step 2
    fireEvent.click(screen.getByText('Back'))
    fireEvent.click(screen.getByText('Back'))
    expect(screen.getByText('Step 2 of 7')).toBeInTheDocument()

    // Navigate forward again
    fireEvent.click(screen.getByText('Next'))
    fireEvent.click(screen.getByText('Next'))
    expect(screen.getByText('Step 4 of 7')).toBeInTheDocument()
    expect(screen.getByText('When does everyone work?')).toBeInTheDocument()
  })
})
