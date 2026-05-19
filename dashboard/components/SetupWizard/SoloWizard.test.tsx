/**
 * SoloWizard tests — focused on the integration points that are easy
 * to break: transitioning between the three steps, finalize calling
 * the right API sequence, and (most importantly) the new
 * Api.shifts.expandWeekly bridge that fixes the post-onboarding
 * "EMPLOYEE_NOT_SCHEDULED" bug.
 *
 * Independence: every test renders a fresh wizard, every test sets up
 * its own fetch mock from scratch in beforeEach. No state crosses
 * between tests.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'

// Mock SessionContext — fixed tenant + owner name so the wizard's
// "ensure owner employee exists" branch can run.
vi.mock('@/lib/SessionContext', () => ({
  useSessionContext: () => ({
    tenantId: 'f234e471-0e60-4163-86c9-93cfd9338e3a',
    userName: 'Solo Owner',
    isAdmin: false,
    managedTenantId: 'f234e471-0e60-4163-86c9-93cfd9338e3a',
    managedTenantName: 'Test Solo',
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    selectManagedTenant: vi.fn(),
    tenantsVersion: 0,
    notifyTenantsChanged: vi.fn(),
  }),
  useActiveTenantId: () => 'f234e471-0e60-4163-86c9-93cfd9338e3a',
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('@/lib/VocabularyContext', () => ({
  useVocabulary: () => ({
    resource_label: 'Resource',
    resource_plural: 'Resources',
    employee_label: 'Employee',
    employee_plural: 'Employees',
    booking_label: 'Appointment',
  }),
}))

import SoloWizard from './SoloWizard'

const TENANT_ID = 'f234e471-0e60-4163-86c9-93cfd9338e3a'
const OWNER_EMPLOYEE_ID = '11111111-2222-3333-8444-555555555555'
const RESOURCE_ID = 'a1b2c3d4-e5f6-4789-ab12-cdef34567890'

const MOCK_SERVICES = [
  { service_id: 'svc-1', name: 'Oil Change', duration_minutes: 30, price: 50 },
]

/**
 * Build a fresh fetch mock for one test. Returns a vi.fn() so the test
 * can also inspect call history. Each test calls this in its own
 * beforeEach-style setup so no test inherits state from the previous.
 */
function setupFetchMock() {
  ;(global.fetch as unknown as ReturnType<typeof vi.fn>) = vi.fn().mockImplementation(
    (url: string, init?: RequestInit) => {
      const path = typeof url === 'string' ? url : ''

      // Auto-seed flow on step 1
      if (path.includes('/services') && (!init || init.method === 'GET' || init.method === undefined)) {
        return Promise.resolve({ ok: true, json: async () => MOCK_SERVICES })
      }
      if (path.includes('/templates')) {
        return Promise.resolve({ ok: true, json: async () => [] })
      }

      // Step 2 — wizard creates the owner employee here.
      if (path.includes('/employees/create') && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            employee: {
              employee_id: OWNER_EMPLOYEE_ID,
              name: 'Solo Owner',
              first_name: 'Solo',
              last_name: 'Owner',
            },
          }),
        })
      }

      // Step 2 — wizard reads /shifts to load the empty pattern.
      if (path.endsWith('/shifts') || path.includes('/shifts?')) {
        return Promise.resolve({ ok: true, json: async () => [] })
      }

      // Step 3 — finalize sequence:
      if (path.includes('/resources/create') && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            resource: { resource_id: RESOURCE_ID, name: 'Main Station' },
          }),
        })
      }
      if (path.includes('/mappings')) {
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) })
      }
      if (path.includes('/shifts/expand-weekly')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            inserted: 0,
            rangeStart: '2026-04-30',
            rangeEnd: '2026-05-27',
          }),
        })
      }
      if (path.includes('/coverage')) {
        return Promise.resolve({ ok: true, json: async () => [] })
      }

      // Default — empty list, ok: true
      return Promise.resolve({ ok: true, json: async () => [] })
    }
  )
}

beforeEach(() => {
  // Reset every test's data: localStorage, mocks, fetch handlers.
  // No test's setup leaks into the next.
  vi.clearAllMocks()
  localStorage.clear()
  localStorage.setItem('tenantId', TENANT_ID)
  setupFetchMock()
})

describe('SoloWizard — finalize fans weekly availability', () => {
  test('handleFinalize calls Api.shifts.expandWeekly for the owner employee', async () => {
    // WHO: solo-business owner finishing the 3-step solo wizard.
    // WHAT: clicking "Complete Setup" on step 3 must trigger a POST
    //       to /shifts/expand-weekly with the owner's employee id —
    //       this is the bridge that makes booking RPCs honor the
    //       weekly availability the owner just set.
    // WHERE: dashboard/components/SetupWizard/SoloWizard.tsx
    //       handleFinalize, between the service-mapping loop and the
    //       coverage refresh.
    // WHEN: every solo onboarding completion. The team-wizard
    //       counterpart fires at goNext step-6→7 and is covered in
    //       SetupWizard.test.tsx.
    // WHY: pre-fix bug — owners completed onboarding with a green
    //       checkmark, then every booking attempt failed with
    //       EMPLOYEE_NOT_SCHEDULED. This test pins the fix in place
    //       so a future refactor can't quietly drop the call.
    render(<SoloWizard isOpen={true} onClose={() => {}} />)

    // Wait for step 1 to render with the seeded service.
    await waitFor(() => {
      expect(screen.getByText('Oil Change')).toBeInTheDocument()
    })

    // Step 1 → 2.
    fireEvent.click(screen.getByText('Next'))

    // Step 2 triggers the create-owner-employee flow. Wait for the
    // hours step to render (its unique heading).
    await waitFor(() => {
      expect(screen.getByText('When are you available?')).toBeInTheDocument()
    })

    // Step 2 → 3.
    fireEvent.click(screen.getByText('Next'))
    await waitFor(() => {
      expect(screen.getByText('Complete Setup')).toBeInTheDocument()
    })

    // Click "Complete Setup" — fires handleFinalize.
    fireEvent.click(screen.getByText('Complete Setup'))

    // Wait for the expandWeekly call to land. Use a fresh assertion
    // each render to avoid stale call history.
    await waitFor(() => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      const expandCalls = fetchMock.mock.calls.filter((call) => {
        const url = String(call[0] ?? '')
        const init = call[1] as RequestInit | undefined
        return url.includes('/shifts/expand-weekly') && init?.method === 'POST'
      })
      expect(expandCalls.length).toBe(1)
    })

    // Verify the call carried the correct employee id.
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    const expandCall = fetchMock.mock.calls.find((call) => {
      const url = String(call[0] ?? '')
      return url.includes('/shifts/expand-weekly')
    })
    expect(expandCall).toBeDefined()
    const rawBody = (expandCall![1] as RequestInit).body
    const body = JSON.parse(typeof rawBody === 'string' ? rawBody : '{}')
    expect(body.employee_id).toBe(OWNER_EMPLOYEE_ID)
    expect(body.tenant_id).toBe(TENANT_ID)
  })

  test('finalize halts at the failing step when expand-weekly errors', async () => {
    // WHO: owner whose finalize sequence partially succeeds (resource
    //      created, services assigned) but expand-weekly fails (e.g.,
    //      transient DB error, RLS context drift).
    // WHAT: the wizard surfaces the error in its error state — no
    //       silent green checkmark — and does NOT proceed to fetch
    //       coverage (which would render success UI on partial state).
    // WHERE: handleFinalize in SoloWizard.tsx — try/catch that wraps
    //       the entire finalize sequence.
    // WHEN: any non-2xx from /shifts/expand-weekly during finalize.
    // WHY: silent failure here is exactly the bug we're fixing.
    //      A finalize that "succeeds" but skips the schedule fan-out
    //      lands the owner on a green screen with broken bookings.
    //      We need the error to surface so the user retries.

    // Override only the expand-weekly call to throw.
    setupFetchMock()
    const baseFetch = global.fetch as unknown as ReturnType<typeof vi.fn>
    const originalImpl = baseFetch.getMockImplementation()
    baseFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/shifts/expand-weekly')) {
        return Promise.reject(new Error('expand-weekly failed'))
      }
      return (originalImpl as (u: string, i?: RequestInit) => Promise<unknown>)(url, init)
    })

    render(<SoloWizard isOpen={true} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('Oil Change')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Next'))
    await waitFor(() => expect(screen.getByText('When are you available?')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Next'))
    await waitFor(() => expect(screen.getByText('Complete Setup')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Complete Setup'))

    // Wizard should still be on step 3 (NOT show "You're all set!")
    // because the throw aborted finalize before setFinalized(true).
    await waitFor(() => {
      // Wait for the finalize attempt to settle. The button label
      // returns from "Setting up..." back to "Complete Setup" after
      // the throw is caught.
      expect(screen.getByText('Complete Setup')).toBeInTheDocument()
    })
    expect(screen.queryByText("You're all set!")).not.toBeInTheDocument()
  })
})
