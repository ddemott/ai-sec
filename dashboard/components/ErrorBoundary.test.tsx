/**
 * ErrorBoundary tests — friendly fallback, retry semantics, dev/prod gating.
 *
 * A render-time exception in a child component must:
 *   - Be caught (no white screen)
 *   - Show a user-facing message that doesn't leak the raw Error
 *   - Offer a way out (retry or reload)
 * Each test carries 5W context.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ErrorBoundary } from './ErrorBoundary';

function Boom({
  message = 'internal error: cannot read property x of undefined',
}: {
  message?: string;
}): never {
  throw new Error(message);
}

// ErrorBoundary's componentDidCatch logs via console.error — silence it
// in tests so the output stays readable.
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe('ErrorBoundary — user-facing message', () => {
  test('HAPPY: renders children when no error', () => {
    // WHAT: Baseline — boundary is transparent until something throws
    render(
      <ErrorBoundary>
        <div>all good</div>
      </ErrorBoundary>
    );
    expect(screen.getByText(/all good/i)).toBeInTheDocument();
  });

  test('SAD: shows a friendly message, not the raw Error', () => {
    // WHO: User whose session hits an unexpected render error
    // WHAT: They see reassurance ("your work is safe") instead of
    //        "cannot read property x of undefined"
    // WHY: Raw error strings leak implementation details, scare users,
    //        and sometimes reveal PII or internal paths. Production
    //        must hide them.
    vi.stubEnv('NODE_ENV', 'production');
    try {
      render(
        <ErrorBoundary>
          <Boom message="cannot read property x of undefined at /api/internal/secret-path" />
        </ErrorBoundary>
      );
      expect(screen.getByRole('alert')).toHaveTextContent(/something unexpected happened/i);
      expect(screen.getByRole('alert')).toHaveTextContent(/your work is safe/i);
      // WHY: The internal error message must NOT appear in the rendered DOM
      expect(screen.queryByText(/cannot read property x/)).not.toBeInTheDocument();
      expect(screen.queryByText(/secret-path/)).not.toBeInTheDocument();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test('HAPPY (dev only): shows raw error in development for debugging', () => {
    // WHO: Developer running npm run dev
    // WHAT: The dev-details block renders with the actual error message
    // WHY: Hiding the error entirely would hurt debugging. The dev
    //        branch is gated on process.env.NODE_ENV !== 'production'.
    vi.stubEnv('NODE_ENV', 'development');
    try {
      render(
        <ErrorBoundary>
          <Boom message="dev-only diagnostic detail" />
        </ErrorBoundary>
      );
      expect(screen.getByTestId('error-boundary-dev-details')).toHaveTextContent(
        /dev-only diagnostic detail/
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('ErrorBoundary — recovery affordances', () => {
  test('HAPPY: "Try again" button resets the boundary state', () => {
    // WHO: User who hit a transient render error and wants to retry
    //       without losing their page
    // WHAT: Clicking Try again resets the boundary so children re-render.
    //        If the child still throws, the boundary catches again — if
    //        it doesn't (transient), the child renders normally.
    let throws = true;
    function Maybe() {
      if (throws) throw new Error('transient');
      return <div>recovered</div>;
    }
    render(
      <ErrorBoundary>
        <Maybe />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    throws = false;
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(screen.getByText(/recovered/i)).toBeInTheDocument();
  });

  test('HAPPY: "Reload page" button calls window.location.reload', () => {
    // WHO: User whose error persists (state corruption in-memory, stale
    //       bundle, etc.) — Try again won't help, they need a fresh page
    // WHAT: Clicking Reload page triggers a full reload
    const reloadSpy = vi.fn();
    const originalLocation = window.location;
    // @ts-expect-error — intentional test-only override
    delete window.location;
    // @ts-expect-error — intentional test-only override
    window.location = { ...originalLocation, reload: reloadSpy };

    try {
      render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>
      );
      fireEvent.click(screen.getByRole('button', { name: /reload page/i }));
      expect(reloadSpy).toHaveBeenCalled();
    } finally {
      // @ts-expect-error — restore
      window.location = originalLocation;
    }
  });

  test('HAPPY: custom fallback is honored when provided', () => {
    // WHY: Callers can provide their own fallback UI (e.g., inline error
    //        in a card instead of the page-level default)
    render(
      <ErrorBoundary fallback={<div>custom-fallback</div>}>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByText('custom-fallback')).toBeInTheDocument();
    // Default UI should NOT render alongside the custom fallback
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
