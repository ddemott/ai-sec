import React from 'react'
import { expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import Home from './app/page'

test('Dashboard Home Page Smoke Test', () => {
  render(<Home />)
  
  // Verify that the Sidebar navigation exists
  // We look for the "Appointments" title or the text in the bottom nav
  expect(screen.getAllByText(/Appointments/i).length).toBeGreaterThan(0)
  expect(screen.getAllByText(/People/i).length).toBeGreaterThan(0)
})
