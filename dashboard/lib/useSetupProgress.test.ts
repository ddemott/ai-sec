/**
 * useSetupProgress tests — pins the six-step counting model that powers
 * the SetupProgressPill (D4, 2026-05-17). Failing any of these means the
 * pill either lies to the owner (says "3/6 done" when only 2 are) or
 * gets stranded (refuses to vanish after the wizard finishes).
 *
 * Each test carries 5W context.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    services: { list: vi.fn() },
    resources: { list: vi.fn() },
    employees: { list: vi.fn() },
    shifts: { schedule: { bulkForDate: vi.fn() } },
    mappings: { listServiceEmployee: vi.fn() },
  },
}))

vi.mock('./api', () => ({ Api: mockApi }))

import { useSetupProgress, notifySetupProgressChanged } from './useSetupProgress'

beforeEach(() => {
  mockApi.services.list.mockReset().mockResolvedValue([])
  mockApi.resources.list.mockReset().mockResolvedValue([])
  mockApi.employees.list.mockReset().mockResolvedValue([])
  mockApi.shifts.schedule.bulkForDate.mockReset().mockResolvedValue([])
  mockApi.mappings.listServiceEmployee.mockReset().mockResolvedValue([])
})

describe('useSetupProgress — count model', () => {
  test('HAPPY: fresh tenant with nothing seeded → 0 of 6, complete === false', async () => {
    // WHO: new owner whose tenant was just registered
    // WHAT: all five fetches return empty arrays → done count is 0 and
    //       the "Look it over" step is NOT auto-credited.
    // WHY:  zero-state must not flicker as 1/6 because of an undefined
    //       array. The hook must treat .length === 0 as "not done."
    const { result } = renderHook(() => useSetupProgress('tenant-a'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.done).toBe(0)
    expect(result.current.total).toBe(6)
    expect(result.current.complete).toBe(false)
    expect(result.current.items.every((i) => !i.done)).toBe(true)
  })

  test('HAPPY: services + resources + employees → 3 of 6 (steps 1-3 done, 4-6 pending)', async () => {
    // WHO: owner who used the wizard's first three steps but stopped
    //      before scheduling shifts.
    // WHAT: done count is exactly 3 (services, resources, employees) and
    //       "Look it over" (step 6) stays pending because steps 4 and 5 aren't done.
    // WHY:  auto-crediting step 6 prematurely would flip the pill to
    //       4/6 — a lie that would let the user think they're nearly done.
    mockApi.services.list.mockResolvedValue([{ service_id: 's1', name: 'Oil Change' }])
    mockApi.resources.list.mockResolvedValue([{ resource_id: 'r1', name: 'Bay 1' }])
    mockApi.employees.list.mockResolvedValue([{ employee_id: 'e1', name: 'Alice', type: 'employee', is_active: true }])

    const { result } = renderHook(() => useSetupProgress('tenant-b'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.done).toBe(3)
    expect(result.current.complete).toBe(false)
    expect(result.current.items.find((i) => i.step === 6)?.done).toBe(false)
  })

  test('HAPPY: ALL five measurables present → 6 of 6 (step 6 auto-credits, complete === true)', async () => {
    // WHO: owner who completed every wizard step
    // WHAT: with services + resources + employees + shifts + mappings
    //       all returning at least one row, step 6 "Look it over"
    //       auto-credits and the pill is allowed to vanish.
    // WHY:  the auto-credit gate is what prevents the pill from being
    //       stranded at 5/6 forever — step 6 has no persistent state of
    //       its own to detect "the user actually reviewed."
    mockApi.services.list.mockResolvedValue([{ service_id: 's1', name: 'Oil Change' }])
    mockApi.resources.list.mockResolvedValue([{ resource_id: 'r1', name: 'Bay 1' }])
    mockApi.employees.list.mockResolvedValue([{ employee_id: 'e1', name: 'Alice', type: 'employee', is_active: true }])
    mockApi.shifts.schedule.bulkForDate.mockResolvedValue([{ employee_id: 'e1', shift_date: '2026-05-20', start_time: '09:00', end_time: '17:00' }])
    mockApi.mappings.listServiceEmployee.mockResolvedValue([{ service_id: 's1', employee_id: 'e1' }])

    const { result } = renderHook(() => useSetupProgress('tenant-c'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.done).toBe(6)
    expect(result.current.complete).toBe(true)
    expect(result.current.items.find((i) => i.step === 6)?.done).toBe(true)
  })

  test('SAD: archived/invited employees do NOT count as "Who works here"', async () => {
    // WHO: owner who has an invited-but-not-yet-active teammate
    // WHAT: an employee row with type !== 'employee' OR is_active === false
    //       must NOT count toward step 3. The pill should still say the
    //       tenant has no active staff yet.
    // WHY: the wizard's onboarding gates "you have a team" on active
    //      employees only — counting invited/archived rows here would
    //      misrepresent setup status and let a tenant call the wizard
    //      complete before they have a bookable staff member.
    mockApi.employees.list.mockResolvedValue([
      { employee_id: 'e1', name: 'Pending Bob', type: 'employee', is_active: false },
      { employee_id: 'e2', name: 'Guest Account', type: 'guest', is_active: true },
    ])

    const { result } = renderHook(() => useSetupProgress('tenant-d'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.items.find((i) => i.step === 3)?.done).toBe(false)
  })

  test('SAD: API failure for one fetch leaves that step pending but does not crash the hook', async () => {
    // WHO: owner whose dashboard hits a transient backend error
    // WHAT: services rejected → step 1 is "not done" but the other steps
    //       still report correctly. The hook resolves to loading=false,
    //       not stuck loading forever.
    // WHY:  Promise.allSettled guarantees independent failure handling.
    //       A regression that swaps it for Promise.all would crash the
    //       hook and freeze the pill UI in a "loading" state.
    mockApi.services.list.mockRejectedValue(new Error('network'))
    mockApi.resources.list.mockResolvedValue([{ resource_id: 'r1', name: 'Bay 1' }])

    const { result } = renderHook(() => useSetupProgress('tenant-e'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.items.find((i) => i.step === 1)?.done).toBe(false)
    expect(result.current.items.find((i) => i.step === 2)?.done).toBe(true)
  })

  test('HAPPY: tenantId === null short-circuits to zero progress without firing any fetches', async () => {
    // WHO: super-admin sitting on the All-Businesses grid (no active tenant)
    // WHAT: with tenantId null, the hook should NOT hit the API at all
    //       AND should report 0 of 6 / loading=false.
    // WHY:  fetching tenant-scoped data without a tenant_id would 400
    //       (or worse, leak across tenants on a misbehaving server).
    //       The null guard pins that we never make the call.
    const { result } = renderHook(() => useSetupProgress(null))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.done).toBe(0)
    expect(mockApi.services.list).not.toHaveBeenCalled()
    expect(mockApi.resources.list).not.toHaveBeenCalled()
  })

  test('HAPPY: notifySetupProgressChanged event triggers a refetch and updates state', async () => {
    // WHO: owner who just finished the wizard — DashboardHome's
    //      handleCloseWizard fires notifySetupProgressChanged()
    // WHAT: the pill's hook should refetch and reflect the post-finalize
    //       state without a navigation or reload.
    // WHY:  without the event-driven refetch the pill would stay stuck
    //       at its pre-finalize count until the user manually navigated,
    //       breaking the auto-dismiss behavior D4 promises.
    mockApi.services.list.mockResolvedValue([])

    const { result } = renderHook(() => useSetupProgress('tenant-f'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.done).toBe(0)

    // Wizard finalize lands — mock now returns data, then the event fires.
    mockApi.services.list.mockResolvedValue([{ service_id: 's1', name: 'Oil Change' }])
    act(() => { notifySetupProgressChanged() })

    await waitFor(() => expect(result.current.items.find((i) => i.step === 1)?.done).toBe(true))
  })
})
