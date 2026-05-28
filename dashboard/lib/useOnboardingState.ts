'use client';

import { useCallback, useEffect, useReducer } from 'react';

/**
 * Single source of truth for the setup-wizard overlay state
 * (UX audit #7, 2026-05-18).
 *
 * Before: DashboardHome (and MyBusinessView) tracked the wizard flow
 * via four independent flags — `welcomePassed`, `wizardMode`,
 * `businessTypeReady`, `wizardDismissed` — plus a FirstRunTour
 * localStorage flag. The combinations were correct in isolation but
 * the matrix was a foot-gun: certain orderings could render two
 * overlays at once (welcome + chooser, or chooser + picker on tab
 * remount).
 *
 * After: state is collapsed into a single `OnboardingStage` enum.
 * At most one stage is active at any time. Transitions go through
 * the reducer so they're observable and testable. Tests can pin
 * mutual exclusivity with one assertion (`expect(stages).toHaveLength(<=1)`).
 *
 * Stages:
 *   idle       — nothing showing
 *   welcome    — <WizardWelcome /> ("you can stop and come back" framing)
 *   chooser    — <WizardModeChooser /> (solo vs team)
 *   picker     — <BusinessTypePicker /> (after mode picked)
 *   wizard     — <SoloWizard /> or <SetupWizard /> (driven by mode)
 *   dismissed  — banner: "Open Setup Assistant" shown on Home
 */

export type WizardMode = 'solo' | 'team';

export type OnboardingStage = 'idle' | 'welcome' | 'chooser' | 'picker' | 'wizard' | 'dismissed';

interface OnboardingState {
  stage: OnboardingStage;
  mode: WizardMode | null;
}

type OnboardingAction =
  | { type: 'AUTO_OPEN' }
  /** "Let's go" on the welcome modal — advance to mode chooser. */
  | { type: 'ADVANCE_WELCOME' }
  /** Skip welcome (used by ?wizard=open URL param and the dismissed banner). */
  | { type: 'OPEN_TO_CHOOSER' }
  | { type: 'CHOOSE_MODE'; mode: WizardMode }
  /** Back arrow in the mode chooser → welcome. */
  | { type: 'BACK_TO_WELCOME' }
  /** Back arrow in the BusinessTypePicker → chooser. */
  | { type: 'BACK_TO_CHOOSER' }
  /** Back from inside the wizard → BusinessTypePicker (preserves mode). */
  | { type: 'BACK_TO_PICKER' }
  /** Business type confirmed → enter the wizard proper. */
  | { type: 'ENTER_WIZARD' }
  /** Wizard finished OR user dismissed at any stage. */
  | { type: 'DISMISS' }
  | { type: 'CLOSE_TO_IDLE' };

const INITIAL: OnboardingState = { stage: 'idle', mode: null };

function reducer(state: OnboardingState, action: OnboardingAction): OnboardingState {
  switch (action.type) {
    case 'AUTO_OPEN':
      // Only open from idle; if the user is already mid-flow we don't
      // re-stomp their stage.
      return state.stage === 'idle' ? { stage: 'welcome', mode: null } : state;
    case 'ADVANCE_WELCOME':
      return state.stage === 'welcome' ? { ...state, stage: 'chooser' } : state;
    case 'OPEN_TO_CHOOSER':
      // Used by ?wizard=open and the dismissed-banner button. Always
      // jumps to chooser so the user doesn't see welcome twice.
      return { stage: 'chooser', mode: null };
    case 'CHOOSE_MODE':
      return { stage: 'picker', mode: action.mode };
    case 'BACK_TO_WELCOME':
      // Reverse of ADVANCE_WELCOME. Only meaningful from the chooser
      // (any earlier-stage call is a no-op so we don't bounce idle/dismissed
      // back to welcome unexpectedly).
      return state.stage === 'chooser' ? { stage: 'welcome', mode: null } : state;
    case 'BACK_TO_CHOOSER':
      return { stage: 'chooser', mode: null };
    case 'BACK_TO_PICKER':
      // Reverse of ENTER_WIZARD. Mode is preserved so re-entering the
      // wizard after a re-pick doesn't dump the user back through the
      // chooser. Only meaningful from the 'wizard' stage.
      return state.stage === 'wizard' ? { ...state, stage: 'picker' } : state;
    case 'ENTER_WIZARD':
      // Mode must already be set from CHOOSE_MODE; if not we no-op
      // rather than enter the wizard with a null mode.
      return state.mode ? { ...state, stage: 'wizard' } : state;
    case 'DISMISS':
      return { stage: 'dismissed', mode: null };
    case 'CLOSE_TO_IDLE':
      return INITIAL;
    default:
      return state;
  }
}

export interface UseOnboardingOptions {
  /** Whether the tenant still needs setup data filled in. */
  needsSetup: boolean;
  /** Initial data load — we don't auto-open while still loading. */
  loading: boolean;
  /**
   * When the user is on a page that's NOT supposed to auto-open the
   * wizard (e.g. MyBusinessView opens the wizard only on explicit
   * click), pass false to suppress the AUTO_OPEN dispatch. The page
   * still gets all the transition methods.
   */
  autoOpen?: boolean;
}

export function useOnboardingState({ needsSetup, loading, autoOpen = true }: UseOnboardingOptions) {
  const [state, dispatch] = useReducer(reducer, INITIAL);

  // URL-param plumbing. ?trial=true is the marketing landing tag —
  // cleanup-only. ?wizard=open is the SetupProgressPill (D4) click,
  // and IS an explicit "open the wizard" signal — jump straight to
  // chooser so we don't show welcome twice to a returning user.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    let changed = false;
    if (params.get('trial') === 'true') {
      params.delete('trial');
      changed = true;
    }
    if (params.get('wizard') === 'open') {
      dispatch({ type: 'OPEN_TO_CHOOSER' });
      params.delete('wizard');
      changed = true;
    }
    if (changed) {
      const qs = params.toString();
      const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
      window.history.replaceState({}, '', next);
    }
  }, []);

  // Auto-open the welcome modal for fresh tenants once loading
  // settles. Only fires when stage is 'idle' (the reducer protects
  // against re-stomp regardless).
  useEffect(() => {
    if (!autoOpen) return;
    if (loading) return;
    if (!needsSetup) return;
    if (state.stage !== 'idle') return;
    dispatch({ type: 'AUTO_OPEN' });
  }, [autoOpen, loading, needsSetup, state.stage]);

  // Stable callbacks for transition wiring in components.
  const advanceWelcome = useCallback(() => dispatch({ type: 'ADVANCE_WELCOME' }), []);
  const openToChooser = useCallback(() => dispatch({ type: 'OPEN_TO_CHOOSER' }), []);
  const chooseMode = useCallback((mode: WizardMode) => dispatch({ type: 'CHOOSE_MODE', mode }), []);
  const backToWelcome = useCallback(() => dispatch({ type: 'BACK_TO_WELCOME' }), []);
  const backToChooser = useCallback(() => dispatch({ type: 'BACK_TO_CHOOSER' }), []);
  const backToPicker = useCallback(() => dispatch({ type: 'BACK_TO_PICKER' }), []);
  const enterWizard = useCallback(() => dispatch({ type: 'ENTER_WIZARD' }), []);
  const dismiss = useCallback(() => dispatch({ type: 'DISMISS' }), []);
  const closeToIdle = useCallback(() => dispatch({ type: 'CLOSE_TO_IDLE' }), []);

  return {
    stage: state.stage,
    mode: state.mode,
    transitions: {
      advanceWelcome,
      openToChooser,
      chooseMode,
      backToWelcome,
      backToChooser,
      backToPicker,
      enterWizard,
      dismiss,
      closeToIdle,
    },
  };
}
