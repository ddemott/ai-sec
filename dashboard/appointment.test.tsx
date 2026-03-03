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
            customers: { name: 'Bob', phone: '123', metadata: {} },
            resources: { name: 'Truck 1' },
            status: 'scheduled',
            tenant_id: 'tenant-1'
        }], 
        error: null 
      }))
    }
  }
})

vi.mock('@/lib/supabase', () => ({
  supabase: mockSupabase
}))

test('AppointmentView: clicking calendar event opens detail view', async () => {
  const fetchMock = vi
    .spyOn(globalThis, 'fetch' as any)
    .mockResolvedValue({ ok: true, json: async () => ([] as any) } as any)

  render(<AppointmentView />)

  // Wait for the calendar event for Bob to render
  const eventButton = await screen.findByRole('button', { name: /Bob/i })
  fireEvent.click(eventButton)

  // Detail header should now show the appointment description
  const heading = await screen.findByRole('heading', { name: /Test Appointment/i })
  expect(heading).toBeTruthy()

  fetchMock.mockRestore()
})

test('AppointmentView: can modify and save an appointment', async () => {
  // Ensure the component believes a tenant is logged in so updates are allowed
  window.localStorage.setItem('tenantId', 'tenant-1')

  const fetchMock = vi
    .spyOn(globalThis, 'fetch' as any)
    .mockResolvedValue({ ok: true, json: async () => ({ success: true }) } as any)

  render(<AppointmentView />)

  // Select the appointment via the calendar event
  const eventButton = await screen.findByRole('button', { name: /Bob/i })
  fireEvent.click(eventButton)

  // Enter edit mode (there may be more than one Modify button rendered)
  const [modifyButton] = await screen.findAllByRole('button', { name: /Modify/i })
  fireEvent.click(modifyButton)

  // Change the start time via the datetime-local input bound to start_time
  const startInput = screen.getByDisplayValue(/2026-03-01T10:00/i) as HTMLInputElement
  expect(startInput.value).toContain('10:00')
  fireEvent.change(startInput, { target: { value: '2026-03-01T11:00' } })

  const updateButton = screen.getByRole('button', { name: /Update Appointment/i })
  fireEvent.click(updateButton)

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/appointments/apt-1/update'),
      expect.objectContaining({ method: 'POST' })
    )
  })
  fetchMock.mockRestore()
})
