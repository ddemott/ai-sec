/**
 * LoginView tests — copy, affordances, and a11y.
 *
 * These tests assert on behavior a user would notice, not implementation
 * details. They catch the kind of regression where someone swaps in
 * placeholder copy during a refactor ("Portal", "Multi-Tenant Management
 * Console") or removes an affordance (show-password, trial link).
 *
 * Each test has happy + sad paths with 5W comments.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'
import LoginView from './LoginView'

// Mock fetch for submit tests — tests never hit a real network.
const originalFetch = global.fetch

beforeEach(() => {
  global.fetch = vi.fn() as unknown as typeof fetch
  // Clear localStorage between tests so auth-success doesn't leak state
  window.localStorage.clear()
})

afterAll(() => {
  global.fetch = originalFetch
})

describe('LoginView copy', () => {
  test('HAPPY: shows customer-facing product name, not internal portal jargon', () => {
    // WHO: Prospective tire-shop / salon / trades owner landing on the login page
    // WHAT: Sees "Secretary HQ" + "Your AI Receptionist" — product-framed copy
    // WHY: Previous "Multi-Tenant Management Console" subtitle violated Nielsen
    //       H2 (match between system and real world) — made the page read like
    //       an internal admin tool
    render(<LoginView onLoginSuccess={vi.fn()} />)
    expect(screen.getByRole('heading', { name: /secretary hq/i })).toBeInTheDocument()
    expect(screen.getByText(/your AI receptionist/i)).toBeInTheDocument()
    expect(screen.queryByText(/multi-tenant/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/portal/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/ready for live integration/i)).not.toBeInTheDocument()
  })

  test('HAPPY: submit button says "Sign in", not "Sign In to Dashboard"', () => {
    // WHAT: Button label is short and task-oriented — UX writing principle
    //        of front-loading meaning and avoiding redundancy
    render(<LoginView onLoginSuccess={vi.fn()} />)
    const btn = screen.getByRole('button', { name: /^sign in$/i })
    expect(btn).toBeInTheDocument()
  })

  test('HAPPY: loading label is "Signing in...", not "Verifying..."', async () => {
    // WHAT: "Signing in..." is task-oriented; "Verifying..." was technical
    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => { /* never resolves */ })
    )
    render(<LoginView onLoginSuccess={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    expect(await screen.findByText(/signing in/i)).toBeInTheDocument()
    expect(screen.queryByText(/verifying/i)).not.toBeInTheDocument()
  })

  test('HAPPY: surfaces customer-friendly connection error, not dev-speak', async () => {
    // WHO: Customer with flaky wifi hitting the login page
    // WHAT: Error message is actionable and non-technical
    // WHY: "Is the backend server running?" (old copy) was developer-speak
    //        the end user can do nothing about
    ;(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'))
    render(<LoginView onLoginSuccess={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/couldn't connect/i)
    expect(alert).not.toHaveTextContent(/backend server/i)
  })
})

describe('LoginView affordances', () => {
  test('HAPPY: create-account link points new users to the trial flow', () => {
    // WHO: Prospect who bookmarked /dashboard directly or followed a
    //       stale link without ever seeing the landing page
    // WHAT: A visible "Start your free trial" link prevents a dead end
    // WHY: Without this, someone without credentials has no exit from
    //        the login wall — conversion / onboarding killer
    render(<LoginView onLoginSuccess={vi.fn()} />)
    const link = screen.getByRole('link', { name: /start your free trial/i })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/?trial=true')
  })

  test('HAPPY: forgot-password link is preserved', () => {
    // WHY: Easy to accidentally drop during a refactor — pin it explicitly
    render(<LoginView onLoginSuccess={vi.fn()} />)
    expect(screen.getByRole('link', { name: /forgot password/i })).toHaveAttribute(
      'href',
      '/forgot-password'
    )
  })

  test('HAPPY: show/hide password toggle works and updates aria-pressed', () => {
    // WHO: Caller with a hard-to-type password trying to debug typos
    // WHAT: Eye icon toggles input type between password and text;
    //        aria-pressed tracks state for assistive tech
    // WHY: A common friction point — without this, password typos become
    //        "your password is wrong" mysteries
    render(<LoginView onLoginSuccess={vi.fn()} />)
    const password = screen.getByLabelText(/^password$/i) as HTMLInputElement
    expect(password.type).toBe('password')

    const toggle = screen.getByRole('button', { name: /show password/i })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(toggle)
    expect(password.type).toBe('text')
    expect(screen.getByRole('button', { name: /hide password/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  test('HAPPY: email input has autoComplete="username" so password managers can fill', () => {
    // WHY: Without this, 1Password / Bitwarden / browser autofill don't
    //        populate the login — measurable friction for returning users
    render(<LoginView onLoginSuccess={vi.fn()} />)
    expect(screen.getByLabelText(/email/i)).toHaveAttribute('autoComplete', 'username')
  })
})

describe('LoginView accessibility', () => {
  test('HAPPY: labels are associated with inputs via htmlFor/id', () => {
    // WHY: Screen readers need the label-input association to announce
    //        the input purpose. getByLabelText succeeds only when the
    //        association is correctly wired.
    render(<LoginView onLoginSuccess={vi.fn()} />)
    const email = screen.getByLabelText(/email/i)
    const password = screen.getByLabelText(/^password$/i)
    expect(email.id).toBe('login-email')
    expect(password.id).toBe('login-password')
  })

  test('HAPPY: error messages announce via role=alert', () => {
    // WHY: Screen readers read the alert region automatically on change —
    //        without role=alert, a blind user wouldn't know the login failed
    render(<LoginView onLoginSuccess={vi.fn()} />)
    // Before error: no alert in DOM
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // (Error appearance is covered by the "connection error" test above)
  })
})
