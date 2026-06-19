import React from 'react'
import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import DashboardPage from './app/dashboard/page'
import { SessionProvider } from './lib/SessionContext'

test('Dashboard Page Smoke Test', () => {
  render(<SessionProvider><DashboardPage /></SessionProvider>)

  // Verify that the login screen renders correctly.
  // Copy updated 2026-04-24 from "Secretary HQ Portal" / "Sign In to
  // Dashboard" to the customer-facing form — "Secretary HQ" + "Sign in".
  expect(screen.getByRole('heading', { name: /Secretary HQ/i })).toBeTruthy()
  expect(screen.getByRole('button', { name: /^Sign in$/i })).toBeTruthy()
  // WHO: unauthenticated visitor | WHAT: loads dashboard page | WHEN: first visit, no session | WHERE: DashboardPage | WHY: login portal must render so users can authenticate
})

describe('Sad Paths', () => {
  test('Dashboard Page throws when no SessionProvider wraps it', () => {
    // Rendering without SessionProvider throws because useSessionContext
    // requires the provider. This test pins that exact contract so a future
    // refactor that silently swallows the error (returning stale/undefined
    // context instead of throwing) is caught immediately.
    // WHO: misconfigured app tree | WHAT: DashboardPage rendered without SessionProvider
    // WHEN: provider accidentally removed from layout | WHERE: useSessionContext
    // WHY: a silent undefined-context is harder to debug than an explicit throw
    expect(() => render(<DashboardPage />)).toThrow(
      'useSessionContext must be used within a SessionProvider'
    )
  })
})
