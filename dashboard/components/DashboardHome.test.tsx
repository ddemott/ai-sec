/**
 * DashboardHome tests — the trust-critical behaviors:
 *   - Load failures are visible (not silently swallowed)
 *   - Retry works without a page reload
 *   - The "Today's Schedule" empty state offers next actions instead of
 *     being a dead end
 *
 * Each test carries 5W diagnostic context.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'

// ── Mocks ─────────────────────────────────────────────────────────────
vi.mock('../lib/SessionContext', () => ({
  useActiveTenantId: () => 'tenant-123',
  useSessionContext: () => ({ userName: 'Dale' }),
}))

vi.mock('@/lib/VocabularyContext', () => ({
  useVocabulary: () => ({
    resource_plural: 'Bays',
    employee_plural: 'Techs',
    employee_label: 'Tech',
    booking_label: 'Appointment',
  }),
  useVocabularyRefresh: () => vi.fn(),
}))

// Api mocks. vi.hoisted ensures the mock factory can reference these
// without tripping the "top-level variables in vi.mock factory" lint.
const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    appointments: { list: vi.fn() },
    employees: { list: vi.fn() },
    services: { list: vi.fn() },
    resources: { list: vi.fn() },
    templates: { listFull: vi.fn() },
    tenants: { updateConfig: vi.fn() },
    shifts: { schedule: { forDate: vi.fn() } },
  },
}))

vi.mock('../lib/api', () => ({
  Api: mockApi,
}))

// Dynamic import AFTER mocks are set up
import DashboardHome from './DashboardHome'

beforeEach(() => {
  // Reset all api mocks. Default: return [] so the component renders its
  // empty states without error. Individual tests override.
  mockApi.appointments.list.mockReset().mockResolvedValue([])
  // Return ONE employee so "needs setup" branch doesn't auto-open the wizard
  // and hide the dashboard content under test.
  mockApi.employees.list
    .mockReset()
    .mockResolvedValue([{ employee_id: 'e1', name: 'Alice', type: 'employee', is_active: true }])
  mockApi.services.list.mockReset().mockResolvedValue([{ service_id: 's1', name: 'Oil Change' }])
  mockApi.resources.list.mockReset().mockResolvedValue([{ resource_id: 'r1', name: 'Bay 1' }])
  mockApi.shifts.schedule.forDate.mockReset().mockResolvedValue([])
  mockApi.templates.listFull.mockReset().mockResolvedValue([])
})

describe('DashboardHome — load error visibility', () => {
  test('HAPPY: all calls succeed → no error banner', async () => {
    // WHO: Healthy backend, returning user
    // WHAT: No alert role in the DOM. Baseline for the failure tests below.
    render(<DashboardHome />)
    await screen.findByText(/today's schedule/i)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('SAD: one call fails → retryable error banner appears', async () => {
    // WHO: Owner opens the dashboard while the appointments API is flaky
    // WHAT: The component must NOT show an empty "no appointments" state
    //        — it must surface the failure with a retry option
    // WHY: Prior code used `.catch(() => [])` which made a network failure
    //        look identical to "no bookings today" — a trust-eroding lie
    mockApi.appointments.list.mockRejectedValue(new Error('network'))
    render(<DashboardHome />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/couldn't load/i)
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  test('HAPPY: retry button re-fetches and clears the error when it succeeds', async () => {
    // WHO: Owner hits Try Again after a transient network blip
    // WHAT: Fresh fetch, banner disappears, data renders normally
    mockApi.appointments.list
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue([])

    render(<DashboardHome />)
    const retryBtn = await screen.findByRole('button', { name: /try again/i })
    fireEvent.click(retryBtn)

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  test('HAPPY: dismiss button hides the error without re-fetching', async () => {
    // WHY: Sometimes the user knows the cause and doesn't want to retry
    //        (airplane mode, doing something else). Dismissal respects that.
    mockApi.appointments.list.mockRejectedValue(new Error('network'))
    render(<DashboardHome />)

    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: /dismiss error/i }))
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })
})

describe('DashboardHome — Today\'s Schedule click target (Fitts\'s Law)', () => {
  test('HAPPY: entire card header is a single button that navigates to schedule', async () => {
    // WHO: Owner glancing at Today's Schedule, wants the full view
    // WHAT: Clicking ANYWHERE on the "Today's Schedule" header (icon,
    //        title text, or "Full schedule" label) should navigate to the
    //        schedule tab. Previously only the 12px text link at the end
    //        was tappable — violates Fitts's Law.
    // WHY: Touch targets under ~24px are slow to hit and misfire often;
    //        promoting the whole header to one target (while preserving
    //        the chevron as visual affordance) is the canonical fix.
    const onNavigate = vi.fn()
    render(<DashboardHome onNavigate={onNavigate} />)
    const target = await screen.findByRole('button', { name: /view full schedule/i })
    fireEvent.click(target)
    expect(onNavigate).toHaveBeenCalledWith('schedule')
  })

  test('HAPPY: click target still has the "Full schedule" label + chevron affordance', async () => {
    // WHY: Making the whole row tappable is useless if the user can't
    //        SEE it's tappable. The chevron + text are the visual cue.
    render(<DashboardHome />)
    const target = await screen.findByRole('button', { name: /view full schedule/i })
    expect(target).toHaveTextContent(/full schedule/i)
  })
})

describe('DashboardHome — Today\'s Schedule empty state', () => {
  test('HAPPY: no bookings → CTA offers "View this week"', async () => {
    // WHO: Owner checking Monday morning with nothing on the books
    // WHAT: Instead of a dead-end "Nothing booked", offer a next action
    // WHY: Empty states without CTAs increase bounce and reduce feature
    //        discovery. Heuristic H10 + UX empty-state best practice.
    render(<DashboardHome />)
    await screen.findByText(/nothing booked for today yet/i)
    expect(screen.getByRole('button', { name: /view this week/i })).toBeInTheDocument()
  })

  test('HAPPY: solo operator sees no "See staff shifts" CTA (they ARE the staff)', async () => {
    // WHO: Solo tire shop owner with just themselves on staff
    // WHAT: The staff-shifts link is hidden when there's only one
    //        employee — it would just show them their own shift
    mockApi.employees.list.mockResolvedValue([
      { employee_id: 'e1', name: 'Solo', type: 'employee', is_active: true },
    ])
    render(<DashboardHome />)
    await screen.findByText(/nothing booked for today yet/i)
    expect(screen.queryByRole('button', { name: /see staff shifts/i })).not.toBeInTheDocument()
  })

  test('HAPPY: multi-employee tenant sees both CTAs', async () => {
    // WHO: Shop with 3+ techs
    // WHAT: Both "View this week" and "See staff shifts" are offered
    mockApi.employees.list.mockResolvedValue([
      { employee_id: 'e1', name: 'Alice', type: 'employee', is_active: true },
      { employee_id: 'e2', name: 'Bob', type: 'employee', is_active: true },
      { employee_id: 'e3', name: 'Charlie', type: 'employee', is_active: true },
    ])
    render(<DashboardHome />)
    await screen.findByText(/nothing booked for today yet/i)
    expect(screen.getByRole('button', { name: /view this week/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /see staff shifts/i })).toBeInTheDocument()
  })
})
