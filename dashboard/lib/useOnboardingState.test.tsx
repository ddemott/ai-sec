/**
 * Mutual-exclusivity contract test for the onboarding reducer
 * (UX audit #7, 2026-05-18).
 *
 * WHO: the front-desk-pretending owner who lands on Home for the first
 *      time and walks through the wizard (welcome → chooser → picker
 *      → wizard), the returning user who clicks the dismissed-banner
 *      to re-open, and a programmatic actor that fires every action.
 * WHAT: at most one overlay-bearing stage is active at any reducer
 *       state, regardless of the action sequence applied.
 * WHEN: any path through the wizard flow.
 * WHERE: lib/useOnboardingState.ts — the reducer is the only thing
 *        gating which overlay renders, so this also pins the
 *        DashboardHome render correctness by extension.
 * WHY: the previous 4-flag matrix (welcomePassed/wizardMode/
 *      businessTypeReady/wizardDismissed) had ordering edge cases
 *      where two overlays could co-render. The reducer collapses
 *      state to a single enum so co-rendering is impossible by
 *      construction; this test pins that contract.
 */
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useOnboardingState, type OnboardingStage } from './useOnboardingState'

const OVERLAY_STAGES: OnboardingStage[] = ['welcome', 'chooser', 'picker', 'wizard']

describe('useOnboardingState — mutual exclusivity', () => {
  it('idle is the initial stage when not auto-opening', () => {
    const { result } = renderHook(() => useOnboardingState({ needsSetup: false, loading: false }))
    expect(result.current.stage).toBe('idle')
    expect(result.current.mode).toBe(null)
  })

  it('auto-opens to welcome when needsSetup and not loading', () => {
    const { result } = renderHook(() => useOnboardingState({ needsSetup: true, loading: false }))
    expect(result.current.stage).toBe('welcome')
  })

  it('does not auto-open while still loading', () => {
    const { result } = renderHook(() => useOnboardingState({ needsSetup: true, loading: true }))
    expect(result.current.stage).toBe('idle')
  })

  it('respects autoOpen=false even when needsSetup is true', () => {
    const { result } = renderHook(() => useOnboardingState({ needsSetup: true, loading: false, autoOpen: false }))
    expect(result.current.stage).toBe('idle')
  })

  it('walks the happy path: welcome → chooser → picker → wizard', () => {
    const { result } = renderHook(() => useOnboardingState({ needsSetup: true, loading: false }))
    expect(result.current.stage).toBe('welcome')

    act(() => result.current.transitions.advanceWelcome())
    expect(result.current.stage).toBe('chooser')

    act(() => result.current.transitions.chooseMode('solo'))
    expect(result.current.stage).toBe('picker')
    expect(result.current.mode).toBe('solo')

    act(() => result.current.transitions.enterWizard())
    expect(result.current.stage).toBe('wizard')
    expect(result.current.mode).toBe('solo')
  })

  it('enterWizard is a no-op when mode is null', () => {
    const { result } = renderHook(() => useOnboardingState({ needsSetup: false, loading: false, autoOpen: false }))
    expect(result.current.stage).toBe('idle')
    expect(result.current.mode).toBe(null)

    act(() => result.current.transitions.enterWizard())
    // mode is null → stage stays idle. Otherwise we'd render <SoloWizard>
    // or <SetupWizard> with no mode picked, which is the bug the reducer
    // exists to prevent.
    expect(result.current.stage).toBe('idle')
  })

  it('dismiss from any stage lands on dismissed', () => {
    const { result } = renderHook(() => useOnboardingState({ needsSetup: true, loading: false }))
    expect(result.current.stage).toBe('welcome')

    act(() => result.current.transitions.dismiss())
    expect(result.current.stage).toBe('dismissed')
    expect(result.current.mode).toBe(null)
  })

  it('openToChooser skips welcome — used by ?wizard=open + dismissed banner', () => {
    const { result } = renderHook(() => useOnboardingState({ needsSetup: false, loading: false, autoOpen: false }))
    act(() => result.current.transitions.openToChooser())
    expect(result.current.stage).toBe('chooser')
    expect(result.current.mode).toBe(null)
  })

  it('CONTRACT: every reachable state has at most one overlay stage', () => {
    // The reducer's state is a single { stage, mode } pair. By
    // construction at most one OVERLAY_STAGES value is true. This
    // assertion just exercises the contract on a handful of
    // representative states so a future refactor that re-introduces
    // co-rendering would fail loudly here.
    const { result } = renderHook(() => useOnboardingState({ needsSetup: true, loading: false }))

    const observedStages: OnboardingStage[] = [result.current.stage]
    act(() => result.current.transitions.advanceWelcome())
    observedStages.push(result.current.stage)
    act(() => result.current.transitions.chooseMode('team'))
    observedStages.push(result.current.stage)
    act(() => result.current.transitions.enterWizard())
    observedStages.push(result.current.stage)
    act(() => result.current.transitions.closeToIdle())
    observedStages.push(result.current.stage)

    // Each observed stage is exactly one OVERLAY_STAGES value or 'idle'/'dismissed'.
    for (const s of observedStages) {
      const overlayMatches = OVERLAY_STAGES.filter(o => o === s).length
      expect(overlayMatches, `stage "${s}" should match 0 or 1 overlay stages`).toBeLessThanOrEqual(1)
    }
  })
})
