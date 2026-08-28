/**
 * SetupProgressPill tests — pins the visibility + click behavior of the
 * persistent setup-progress affordance in OutlookLayout's utility row
 * (D4, 2026-05-17).
 *
 * What we test:
 *   1. Pill is hidden when there's no active tenant (super-admin grid view).
 *   2. Pill is hidden during loading (no zero-flash before fetches return).
 *   3. Pill is hidden when complete (auto-dismiss).
 *   4. Pill renders "Setup: N of 6 done" with N matching the hook's count.
 *   5. Click pushes ?tab=home&wizard=open and dispatches popstate so the
 *      app's URL-driven tab state picks it up without a hard reload.
 *
 * Each test carries 5W context.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

// Mock the hook so the component tests don't need to mock five different
// API surfaces — that's already covered in useSetupProgress.test.ts.
const { mockProgress } = vi.hoisted(() => ({
  mockProgress: {
    fn: vi.fn(),
  },
}));

vi.mock('../../lib/useSetupProgress', () => ({
  useSetupProgress: (tenantId: string | null) => mockProgress.fn(tenantId),
}));

vi.mock('../../lib/SessionContext', () => ({
  useActiveTenantId: () => globalTenantId,
}));

let globalTenantId: string | null = 'tenant-x';

import { SetupProgressPill } from './SetupProgressPill';

beforeEach(() => {
  mockProgress.fn.mockReset();
  globalTenantId = 'tenant-x';
});

describe('SetupProgressPill — visibility', () => {
  test('SAD: no active tenant → pill renders nothing', () => {
    // WHO: super-admin sitting on the All-Businesses grid before
    //      activating any tenant
    // WHAT: the pill must not render at all — there's nothing to count
    //       progress against. A zero-state pill in this view would look
    //       broken ("Setup: 0 of 6" against no tenant).
    // WHY:  the OutlookLayout utility row stays clean during cross-
    //       tenant admin work; the pill is per-tenant context.
    globalTenantId = null;
    mockProgress.fn.mockReturnValue({
      done: 0,
      total: 6,
      complete: false,
      items: [],
      loading: false,
      refresh: vi.fn(),
    });

    const { container } = render(<SetupProgressPill />);
    expect(container.firstChild).toBeNull();
  });

  test('SAD: hook still loading → pill renders nothing (no zero-flash)', () => {
    // WHO: owner whose dashboard just mounted; the 5 fetches are still in flight
    // WHAT: with loading=true the pill must NOT briefly render "0 of 6"
    //       only to disappear once the data arrives.
    // WHY:  a flash of "0 of 6" on a fully-configured tenant would be
    //       jarring and would erode trust in the pill's accuracy.
    mockProgress.fn.mockReturnValue({
      done: 0,
      total: 6,
      complete: false,
      items: [],
      loading: true,
      refresh: vi.fn(),
    });

    const { container } = render(<SetupProgressPill />);
    expect(container.firstChild).toBeNull();
  });

  test('SAD: progress complete → pill auto-dismisses (renders nothing)', () => {
    // WHO: owner who finished every wizard step
    // WHAT: complete=true must remove the pill from the DOM
    // WHY:  D4's done signal is "auto-dismisses on completion." A pill
    //       that stayed at "6 of 6" would be visual clutter — exactly
    //       what a fully-configured tenant should never see.
    mockProgress.fn.mockReturnValue({
      done: 6,
      total: 6,
      complete: true,
      items: [],
      loading: false,
      refresh: vi.fn(),
    });

    const { container } = render(<SetupProgressPill />);
    expect(container.firstChild).toBeNull();
  });
});

describe('SetupProgressPill — rendering', () => {
  test('HAPPY: pill renders "Setup: 3 of 6 done" for a partially-configured tenant', () => {
    // WHO: owner who set up services + resources + employees but stopped
    // WHAT: the pill is visible, contains the literal "Setup: 3 of 6 done",
    //       and exposes an accessible name describing the action.
    // WHERE: top utility row of OutlookLayout
    // WHY:  the literal "N of 6 done" text is the spec contract from
    //       state.md ("Pin Setup: N of 6 done"). A regression that
    //       changes the format ("3/6", "Setup 3/6", "halfway done")
    //       would break user mental models AND any analytics that
    //       grep for this string.
    mockProgress.fn.mockReturnValue({
      done: 3,
      total: 6,
      complete: false,
      items: [],
      loading: false,
      refresh: vi.fn(),
    });

    render(<SetupProgressPill />);

    const button = screen.getByRole('button', { name: /setup 3 of 6 done/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent(/Setup: 3 of 6 done/);
  });
});

describe('SetupProgressPill — click behavior', () => {
  test('HAPPY: click pushes ?tab=home&wizard=open and dispatches popstate', () => {
    // WHO: owner who dismissed the welcome earlier and now clicks the pill
    //      to come back to setup later
    // WHAT: clicking must add ?tab=home&wizard=open to the URL AND
    //       dispatch a popstate event so the SPA's URL listener sees
    //       the new tab. DashboardHome consumes ?wizard=open on mount
    //       and force-opens past the welcome.
    // WHY:  hard navigation (window.location =) would flash the page
    //       and re-bootstrap auth; pushState + popstate is the SPA-
    //       friendly path. A regression that drops the popstate would
    //       leave the URL updated but the app on whatever tab the user
    //       was on, with no wizard.
    mockProgress.fn.mockReturnValue({
      done: 2,
      total: 6,
      complete: false,
      items: [],
      loading: false,
      refresh: vi.fn(),
    });

    // Start from a known clean URL. JSDOM history is per-test.
    window.history.replaceState({}, '', '/dashboard?tab=schedule');

    const popstateSpy = vi.fn();
    window.addEventListener('popstate', popstateSpy);

    render(<SetupProgressPill />);
    fireEvent.click(screen.getByRole('button', { name: /setup 2 of 6 done/i }));

    expect(window.location.search).toContain('tab=dashboard');
    expect(window.location.search).toContain('wizard=open');
    expect(popstateSpy).toHaveBeenCalledTimes(1);

    window.removeEventListener('popstate', popstateSpy);
  });
});
