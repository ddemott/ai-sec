import React from 'react'
import { expect, test, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CRMView from './components/CRMView'

// Using vi.hoisted to ensure the mock object is available during hoisting
const { mockSupabase } = vi.hoisted(() => {
  return {
    mockSupabase: {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      then: vi.fn((resolve) => resolve({ 
        data: [{ id: '1', name: 'Test User', phone: '123', metadata: { notes: 'Initial Note' } }], 
        error: null 
      }))
    }
  }
})

vi.mock('@/lib/supabase', () => ({
  supabase: mockSupabase
}))

test('CRMView: should enter edit mode and update state', async () => {
  render(<CRMView />)
  
  // Wait for load
  await waitFor(() => expect(screen.getAllByText(/Test User/i)).toBeDefined())
  
  // Click Edit Info button
  const editBtn = screen.getByRole('button', { name: /Edit Info/i })
  fireEvent.click(editBtn)
  
  // Check if Save button appears
  expect(screen.getByRole('button', { name: /Save/i })).toBeDefined()
  
  // Change Internal Notes
  const notesInput = screen.getByPlaceholderText(/Add private notes/i)
  fireEvent.change(notesInput, { target: { value: 'Newly added secret note' } })
  
  // Mock the save response specifically for this call
  mockSupabase.then.mockImplementationOnce((resolve) => resolve({ error: null }))
  
  // Save
  fireEvent.click(screen.getByRole('button', { name: /Save/i }))
  
  // Wait for edit mode to close (Success)
  await waitFor(() => expect(screen.queryByPlaceholderText(/Add private notes/i)).toBeNull())
})
