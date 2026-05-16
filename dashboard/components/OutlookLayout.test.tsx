/**
 * OutlookLayout role-gating tests.
 *
 * The dashboard now uses a single flattened nav. Front-desk-only logins
 * (`role === 'front_desk'`) should only see the daily-use tabs and be
 * snapped back to Home if they land on a management tab via a stale URL or
 * back-button.
 *
 * Owners (and super-admins, who keep full access regardless of `role`)
 * should still see the management tabs.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'
import { OutlookLayout } from './OutlookLayout'

// Stub the API the layout uses on mount (knowledge badge + tenants list).
// Without this, the layout fires a real fetch on render and littles the
// console with rejected promises.
vi.mock('../lib/api', () => ({
  Api: {
    knowledge: { unanswered: vi.fn().mockResolvedValue({ questions: [] }) },
    tenants: { list: vi.fn().mockResolvedValue([]) },
  },
}))

vi.mock('@/lib/ThemeContext', () => ({
  useTheme: () => ({
    theme: 'dark',
    setTheme: vi.fn(),
    themeInfo: { name: 'Dark' },
  }),
  THEMES: [{ id: 'dark', name: 'Dark' }],
}))

vi.mock('@/lib/SessionContext', async () => {
  // OutlookLayout pulls tenantsVersion off useSessionContext; the
  // FeedbackButton (rendered inside the layout) pulls useActiveTenantId.
  // We don't need a real provider — just enough exports to satisfy the
  // imports.
  return {
    useSessionContext: () => ({ tenantsVersion: 0 }),
    useActiveTenantId: () => null,
  }
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('OutlookLayout role gating', () => {
  test('HAPPY: owner sees management tabs', async () => {
    // WHO: Shop owner / manager with the default 'owner' role.
    // WHAT: Daily-use tabs plus management tabs render.
    // WHERE: Desktop nav (FolderTabBar with size="lg").
    // WHEN: On every page load while signed in as an owner.
    // WHY: Owners need access to Services, Staff, and AI/knowledge setup.
    render(
      <OutlookLayout activeTab="dashboard" setActiveTab={vi.fn()} role="owner">
        <div>content</div>
      </OutlookLayout>
    )
    expect(screen.getByRole('tab', { name: /home/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /schedule/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /my business/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /my team/i })).toBeInTheDocument()
  })

  test('SAD: front_desk user does NOT see management tabs', () => {
    // WHO: Shop staff member promoted to a 'front_desk' role.
    // WHAT: Only the daily-use tabs render; management tabs are hidden.
    // WHERE: Desktop nav and the mobile nav.
    // WHY: Non-technical staff shouldn't have to choose between setup
    //      surfaces to do their daily work.
    render(
      <OutlookLayout activeTab="dashboard" setActiveTab={vi.fn()} role="front_desk">
        <div>content</div>
      </OutlookLayout>
    )
    expect(screen.getByRole('tab', { name: /home/i })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /my business/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /my team/i })).not.toBeInTheDocument()
    // Mobile nav has plain <button>s rather than role="tab"; assert by name.
    expect(screen.queryByRole('button', { name: /^businesses$/i })).not.toBeInTheDocument()
  })

  test('SAD: front_desk user landing on a management tab is redirected to dashboard', async () => {
    // WHO: Front-desk user who clicked a stale ?tab=my-business link or
    //      hit the back-button after an admin demoted them.
    // WHAT: The layout snaps activeTab back to 'dashboard' on mount.
    // WHERE: useEffect inside OutlookLayout that watches isFrontDeskOnly +
    //        activeTab.
    // WHY: Without this guard the user would see a management view even
    //      though the tab to switch back is gone — a dead-end for the user.
    const setActiveTab = vi.fn()
    render(
      <OutlookLayout activeTab="my-business" setActiveTab={setActiveTab} role="front_desk">
        <div>content</div>
      </OutlookLayout>
    )
    await waitFor(() => {
      expect(setActiveTab).toHaveBeenCalledWith('dashboard')
    })
  })

  test('HAPPY: super-admin with role=front_desk still sees management tabs', async () => {
    // WHO: Platform super-admin (tenant_id = 00000000...). The role
    //      column doesn't apply to them — admin status is identified by
    //      tenant_id, not by users.role. A super-admin with a stray
    //      'front_desk' role on their user record still needs full UI.
    // WHAT: Management tabs still render because isAdmin overrides role.
    // WHY: Without this, demoting a super-admin's user record would
    //      lock them out of the very dashboard they manage tenants from.
    render(
      <OutlookLayout
        activeTab="dashboard"
        setActiveTab={vi.fn()}
        role="front_desk"
        isAdmin
      >
        <div>content</div>
      </OutlookLayout>
    )
    expect(await screen.findByRole('tab', { name: /my business/i })).toBeInTheDocument()
  })
})
