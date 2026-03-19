import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'
import SetupWizard from './SetupWizard'

// Mock fetch for API calls
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.setItem('tenantId', 'f234e471-0e60-4163-86c9-93cfd9338e3a')
  ;(global.fetch as any) = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => [],
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
    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument()
  })

  test('displays all 6 step labels in progress bar', () => {
    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    expect(screen.getByText('Services')).toBeInTheDocument()
    expect(screen.getByText('Resources')).toBeInTheDocument()
    expect(screen.getByText('Employees')).toBeInTheDocument()
    expect(screen.getByText('Shifts')).toBeInTheDocument()
    expect(screen.getByText('Assignments')).toBeInTheDocument()
    expect(screen.getByText('Review')).toBeInTheDocument()
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
    expect(screen.getByText('Step 2 of 6')).toBeInTheDocument()
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
    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument()
    expect(screen.getByText('What services do you offer?')).toBeInTheDocument()
  })

  test('shows Done button on step 6', () => {
    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    for (let i = 0; i < 5; i++) {
      fireEvent.click(screen.getByText('Next'))
    }
    expect(screen.getByText('Step 6 of 6')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.queryByText('Next')).toBeNull()
  })

  test('Done button calls onClose', () => {
    const onClose = vi.fn()
    render(<SetupWizard isOpen={true} onClose={onClose} />)
    for (let i = 0; i < 5; i++) {
      fireEvent.click(screen.getByText('Next'))
    }
    fireEvent.click(screen.getByText('Done'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('clicking a completed step in progress bar navigates to it', () => {
    render(<SetupWizard isOpen={true} onClose={() => {}} />)
    // Go to step 3
    fireEvent.click(screen.getByText('Next'))
    fireEvent.click(screen.getByText('Next'))
    expect(screen.getByText('Step 3 of 6')).toBeInTheDocument()
    // Click step 1 in progress bar
    fireEvent.click(screen.getByText('Services'))
    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument()
  })
})

describe('SetupWizard: Step 1 Services', () => {
  test('shows empty state when no services exist', async () => {
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
    expect(screen.getByPlaceholderText('e.g. Oil Change, Haircut, Tire Rotation')).toBeInTheDocument()
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
    const nameInput = screen.getByPlaceholderText('e.g. Oil Change, Haircut, Tire Rotation')
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
    ;(global.fetch as any).mockImplementation((url: string) => {
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
    expect(screen.getByText('Step 3 of 6')).toBeInTheDocument()

    // Close and reopen
    rerender(<SetupWizard isOpen={false} onClose={() => {}} />)
    rerender(<SetupWizard isOpen={true} onClose={() => {}} />)
    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument()
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

  test('shows empty state when no resources exist', async () => {
    goToStep2()
    await waitFor(() => {
      expect(screen.getByText('No resources yet. Add your first bay, chair, or station.')).toBeInTheDocument()
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
    expect(screen.getByPlaceholderText('e.g. Bay 1, Chair A, Room 3')).toBeInTheDocument()
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
    ;(global.fetch as any).mockImplementation((url: string) => {
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
    ;(global.fetch as any).mockImplementation((url: string) => {
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
    expect(screen.getByPlaceholderText('+1 (555) 000-0000')).toBeInTheDocument()
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

  test('shows employee selector and schedule grid with data', async () => {
    ;(global.fetch as any) = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/employees')) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: 'e1', first_name: 'Mike', last_name: 'Smith', name: 'Mike Smith', is_active: true },
            { id: 'e2', first_name: 'Sarah', last_name: 'Jones', name: 'Sarah Jones', is_active: true },
          ],
        })
      }
      if (url.includes('/shifts')) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: 1, employee_id: 'e1', day_of_week: 1, start_time: '08:00:00', end_time: '17:00:00', is_active: true },
            { id: 2, employee_id: 'e1', day_of_week: 2, start_time: '09:00:00', end_time: '15:00:00', is_active: true },
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

    // Mike has 2 shifts — badge shows (2d)
    expect(screen.getByText('(2d)')).toBeInTheDocument()

    // Select Mike
    fireEvent.click(screen.getAllByText(/Mike Smith/)[0])

    // Should show 7 day rows
    await waitFor(() => {
      expect(screen.getByText('Sun')).toBeInTheDocument()
      expect(screen.getByText('Mon')).toBeInTheDocument()
      expect(screen.getByText('Sat')).toBeInTheDocument()
    })

    // Mike works Mon and Tue — other 5 days show "Off"
    const offLabels = screen.getAllByText('Off')
    expect(offLabels.length).toBe(5)
  })
})
