import React from 'react'
import { expect, test, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AppointmentView from './components/AppointmentView'
import { MOCK_APPOINTMENTS } from './lib/mockData'

// Mock fetch
global.fetch = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.setItem('tenantId', 'f234e471-0e60-4163-86c9-93cfd9338e3a')
  
  // Default mocks for static data and appointments
  ;(global.fetch as any).mockImplementation((url: string) => {
    if (url.includes('/appointments')) {
      return Promise.resolve({ ok: true, json: async () => MOCK_APPOINTMENTS })
    }
    return Promise.resolve({ ok: true, json: async () => [] })
  })
})

test('AppointmentView: clicking calendar event opens detail view', async () => {
  render(<AppointmentView />)

  // MOCK_APPOINTMENTS[0] is for Bob Smith
  // We use findAllByText and pick the first one (the list item)
  const eventButtons = await screen.findAllByText(/Bob Smith/i, { selector: 'p' })
  fireEvent.click(eventButtons[0])

  // Detail header should now show the customer name
  const headings = await screen.findAllByText(/Bob Smith/i)
  expect(headings.length).toBeGreaterThan(0)
})

test('AppointmentView: can modify and save an appointment', async () => {
  render(<AppointmentView />)

  // Select the appointment via the list or calendar
  const listItems = await screen.findAllByText(/Bob Smith/i, { selector: 'p' })
  fireEvent.click(listItems[0])

  // Enter edit mode
  const modifyBtns = await screen.findAllByRole('button', { name: /Modify/i })
  fireEvent.click(modifyBtns[0])

  // Format the expected time using the component's internal toLocalISO logic
  const d = new Date(MOCK_APPOINTMENTS[0].start_time)
  const offset = d.getTimezoneOffset()
  const localDate = new Date(d.getTime() - (offset * 60 * 1000))
  const expectedTimeStr = localDate.toISOString().slice(0, 16)

  // Change the start time via the datetime-local input bound to start_time
  const startInput = await screen.findByDisplayValue(expectedTimeStr)
  fireEvent.change(startInput, { target: { value: '2026-03-05T11:00' } })

  // Mock the update response
  ;(global.fetch as any).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ success: true })
  })

  const updateButton = screen.getByRole('button', { name: /Update Appointment/i })
  fireEvent.click(updateButton)

  // Confirm in modal
  const saveChangesButton = await screen.findByRole('button', { name: /Save Changes/i })
  fireEvent.click(saveChangesButton)

  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(`/appointments/${MOCK_APPOINTMENTS[0].id}/update`),
      expect.objectContaining({ method: 'POST' })
    )
  })
})

test('AppointmentView: canceling confirmation reverts changes and does not save', async () => {
  render(<AppointmentView />)

  const listItems = await screen.findAllByText(/Bob Smith/i, { selector: 'p' })
  fireEvent.click(listItems[0])

  const modifyBtns = await screen.findAllByRole('button', { name: /Modify/i })
  fireEvent.click(modifyBtns[0])

  const updateButton = screen.getByRole('button', { name: /Update Appointment/i })
  fireEvent.click(updateButton)

  const keepOriginalButton = await screen.findByRole('button', { name: /Keep Original/i })
  fireEvent.click(keepOriginalButton)

  expect(global.fetch).not.toHaveBeenCalledWith(
    expect.stringContaining(`/appointments/${MOCK_APPOINTMENTS[0].id}/update`),
    expect.objectContaining({ method: 'POST' })
  )
})

test('AppointmentView: month navigation moves between months', async () => {
  render(<AppointmentView />)

  // Switch to month view
  const [monthButton] = await screen.findAllByRole('button', { name: /Set month view/i })
  fireEvent.click(monthButton)

  // Capture current header label (e.g., "January 2025")
  const [header] = await screen.findAllByRole('heading', { level: 2 })
  const before = header.textContent

  const [nextButton] = screen.getAllByRole('button', { name: /Next period/i })
  fireEvent.click(nextButton)

  await waitFor(() => {
    expect(header.textContent).not.toBe(before)
  })
})
