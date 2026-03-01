import React from 'react'
import { expect, test, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AppointmentView from './components/AppointmentView'

const { mockSupabase } = vi.hoisted(() => {
  return {
    mockSupabase: {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      then: vi.fn((resolve) => resolve({ 
        data: [{ 
            id: 'apt-1', 
            description: 'Test Appointment', 
            start_time: '2026-03-01T10:00:00Z',
            end_time: '2026-03-01T11:00:00Z',
            customers: { name: 'Bob', phone: '123' },
            resources: { name: 'Truck 1' },
            status: 'scheduled'
        }], 
        error: null 
      }))
    }
  }
})

vi.mock('@/lib/supabase', () => ({
  supabase: mockSupabase
}))

test('AppointmentView: should reschedule an appointment', async () => {
  render(<AppointmentView />)
  
  // Wait for load and select the header specifically
  await waitFor(() => expect(screen.getAllByText(/Test Appointment/i).length).toBeGreaterThan(0))
  
  // Click Reschedule
  const rescheduleBtn = screen.getByRole('button', { name: /Reschedule/i })
  fireEvent.click(rescheduleBtn)
  
  // Verify date input exists
  const dateInput = screen.getByDisplayValue(/2026-03-01T10:00/i)
  expect(dateInput).toBeDefined()
  
  // Change time
  fireEvent.change(dateInput, { target: { value: '2026-03-01T11:00' } })
  
  // Mock success response
  mockSupabase.then.mockImplementationOnce((resolve) => resolve({ error: null }))
  
  // Confirm Change (using text match)
  const confirmBtn = screen.getByText(/Confirm/i)
  fireEvent.click(confirmBtn)
  
  // Verify modal/form closes
  await waitFor(() => expect(screen.queryByText(/Confirm/i)).toBeNull())
})
