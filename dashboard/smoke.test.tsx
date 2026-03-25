import React from 'react'
import { expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import DashboardPage from './app/dashboard/page'
import { SessionProvider } from './lib/SessionContext'

test('Dashboard Page Smoke Test', () => {
  render(<SessionProvider><DashboardPage /></SessionProvider>)

  // Verify that the login portal renders correctly
  expect(screen.getByText(/Secretary HQ Portal/i)).toBeTruthy()
  expect(screen.getByText(/Sign In to Dashboard/i)).toBeTruthy()
})
