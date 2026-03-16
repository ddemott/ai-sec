import React from 'react'
import { expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import Home from './app/page'
import { SessionProvider } from './lib/SessionContext'

test('Dashboard Home Page Smoke Test', () => {
  render(<SessionProvider><Home /></SessionProvider>)

  // Verify that the login portal renders correctly
  expect(screen.getByText(/AI Secretary Portal/i)).toBeTruthy()
  expect(screen.getByText(/Sign In to Dashboard/i)).toBeTruthy()
})
