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
    expect(screen.getByText('Resources — coming soon')).toBeInTheDocument()
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
