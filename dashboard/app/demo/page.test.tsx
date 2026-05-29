/**
 * Tests for dashboard/app/demo/page.tsx
 *
 * WHO: anonymous visitor clicking "Try live demo" on the landing page
 * WHAT: fetch call to /demo/start, localStorage population, redirect
 * WHEN: component mounts
 * WHERE: dashboard/app/demo/page.tsx
 * WHY: this is the only entry-point to the demo; if the fetch or
 *      localStorage write fails silently, visitors land on a blank/broken
 *      dashboard with no token and no error message
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// vi.mock must be at top-level so Vitest can hoist it before the import below.
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

import DemoPage from './page';

function mockFetch(response: Partial<Response>): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response as Response));
}

function mockFetchReject(err: Error): void {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(err));
}

describe('DemoPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('HAPPY: sets auth token and redirects to /dashboard on success', async () => {
    // WHO: visitor clicking "Try live demo"
    // WHAT: token + tenant_id stored in localStorage, router.push('/dashboard') called
    // WHEN: /demo/start returns 200 with success=true
    // WHERE: useEffect fetch in DemoPage
    // WHY: without these localStorage writes the dashboard renders the login screen
    mockFetch({
      ok: true,
      json: async () => ({
        success: true,
        token: 'test-demo-jwt',
        tenant_id: 'demo-uuid-1234',
        user_id: 'user-uuid-5678',
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        ttl_minutes: 30,
      }),
    });

    render(<DemoPage />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/dashboard');
    });

    expect(localStorage.getItem('authToken')).toBe('test-demo-jwt');
    expect(localStorage.getItem('tenantId')).toBe('demo-uuid-1234');
    expect(localStorage.getItem('userRole')).toBe('owner');
    expect(localStorage.getItem('demoTenantId')).toBe('demo-uuid-1234');
    expect(localStorage.getItem('demoExpiresAt')).toBeTruthy();
  });

  it('HAPPY: shows loading spinner while fetch is in-flight', async () => {
    // WHO: visitor on a slow connection
    // WHAT: spinner visible before fetch resolves
    // WHEN: immediately after mount
    // WHERE: initial render before fetch resolves
    // WHY: a blank page during setup would look broken
    let resolvePromise!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValueOnce(
        new Promise<Response>((res) => {
          resolvePromise = res;
        })
      )
    );

    render(<DemoPage />);

    // Spinner should be visible before fetch resolves
    const spinner = document.querySelector('[style*="border"]');
    expect(spinner).not.toBeNull();

    // Resolve to avoid hanging — error branch is fine here
    await act(async () => {
      resolvePromise({
        ok: false,
        json: async () => ({ success: false, error: 'Test' }),
      } as Response);
    });
  });

  it('SAD: shows error when /demo/start returns success=false', async () => {
    // WHO: visitor hitting the demo when capacity is full
    // WHAT: error message rendered instead of redirect
    // WHEN: server returns { success: false, error: 'Demo capacity is full...' }
    // WHERE: error branch in useEffect
    // WHY: a silent failure redirects to a broken dashboard; error is better UX
    mockFetch({
      ok: false,
      json: async () => ({
        success: false,
        error: 'Demo capacity is full. Please try again in a few minutes.',
      }),
    });

    render(<DemoPage />);

    await waitFor(() => {
      expect(screen.getByText(/demo unavailable/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/demo capacity is full/i)).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
    expect(localStorage.getItem('authToken')).toBeNull();
  });

  it('SAD: shows error on 429 rate-limit response', async () => {
    // WHO: visitor hammering the demo button
    // WHAT: "Demo unavailable" with the rate-limit message
    // WHEN: server returns 429
    // WHERE: error branch in useEffect
    // WHY: visitors should be told to wait, not see a blank error state
    mockFetch({
      ok: false,
      json: async () => ({
        success: false,
        error: 'Too many demo sessions from this IP. Try again in 15 minutes.',
      }),
    });

    render(<DemoPage />);

    await waitFor(() => {
      expect(screen.getByText(/demo unavailable/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/too many demo sessions/i)).toBeInTheDocument();
  });

  it('SAD: shows error on network failure', async () => {
    // WHO: visitor with no internet / backend down
    // WHAT: "Demo unavailable" shown; no redirect, no auth stored
    // WHEN: fetch rejects (TypeError: Failed to fetch)
    // WHERE: catch block in useEffect
    // WHY: unhandled promise rejection would show a blank spinner forever
    mockFetchReject(new Error('Failed to fetch'));

    render(<DemoPage />);

    await waitFor(() => {
      expect(screen.getByText(/demo unavailable/i)).toBeInTheDocument();
    });

    // The catch block sets errorMsg from the Error — verify error state is shown
    // and no auth side-effects occurred.
    expect(screen.getByRole('link', { name: /back to home/i })).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
    expect(localStorage.getItem('authToken')).toBeNull();
  });

  it('HAPPY: "Back to home" link is visible on error', async () => {
    // WHO: visitor seeing the error state
    // WHAT: link to navigate back to landing page
    // WHEN: any error (capacity, rate-limit, network)
    // WHERE: error render branch in DemoPage
    // WHY: visitors must have an exit path from the error screen
    mockFetch({
      ok: false,
      json: async () => ({ success: false, error: 'Something went wrong' }),
    });

    render(<DemoPage />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /back to home/i })).toBeInTheDocument();
    });

    const link = screen.getByRole('link', { name: /back to home/i });
    expect(link).toHaveAttribute('href', '/');
  });
});
