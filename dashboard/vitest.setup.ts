import { configure } from '@testing-library/react';

// Vitest global setup (dashboard).
//
// Some sad-path tests deliberately throw to exercise the ErrorBoundary fallback
// and the SessionContext "must be used within a SessionProvider" guard. React 18
// catches the render error in the boundary but then RE-THROWS it to the global
// jsdom `window` 'error' event (via reportError). Vitest listens on that event
// and tallies it as an "Errors: N" line — which makes a run with all assertions
// passing still exit non-zero, nondeterministically (the rethrow fires after the
// test completes, so it races the suite teardown). That false-failure blocked the
// pre-push hook even though every test passed.
//
// Fix: swallow ONLY these explicitly-expected error messages by calling
// preventDefault() on the window 'error' event (vitest skips defaultPrevented
// events). Anything not on this allowlist still surfaces as a real failure, so a
// genuine unhandled error in any other test is never hidden.

const EXPECTED_UNHANDLED_ERROR_MESSAGES = [
  // ErrorBoundary tests (components/critical-fixes.test.tsx — ThrowingComponent)
  'Test component error',
  // SessionContext guard (lib/SessionContext.tsx)
  'useSessionContext must be used within a SessionProvider',
];

function isExpected(message: unknown): boolean {
  return (
    typeof message === 'string' &&
    EXPECTED_UNHANDLED_ERROR_MESSAGES.some((m) => message.includes(m))
  );
}

if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    if (isExpected(event.message) || isExpected(event.error?.message)) {
      // Mark as handled so vitest does not count it as an unhandled error.
      event.preventDefault();
    }
  });
}

// ---------------------------------------------------------------------------
// Async-utility timeout (T-007: E2E/unit flakiness that terminally SKIPs deploys)
//
// Testing Library's `waitFor`/`findBy*` default to a 1000ms ceiling. That is a
// WALL-CLOCK budget, not a behavioural assertion: on an unloaded dev machine the
// whole 68-test SetupWizard file runs in ~1.7s, but on a loaded GitHub Actions
// runner a single async chain can exceed 1s on its own. It did — CI run
// 33249344101 (2026-08-29, `main`) failed
// `SetupWizard > shows success state with phone number after activation` after
// 1110ms with "Unable to find an element with the text: Your number is ready".
// The component was correct; the runner was slow.
//
// That is not a cosmetic red. A red CI run on `main` makes Railway mark that
// commit's deployments SKIPPED, and SKIPPED is TERMINAL — turning CI green
// afterwards does not retry it. So a 110ms overshoot on a shared runner can stop
// a merged commit from ever reaching production.
//
// Raising the ceiling changes no assertion: a genuinely broken component still
// fails, just later. Nothing here waits out a real bug, because every call site
// polls for a CONDITION and returns the instant it holds — the number is only
// the point at which we give up. Per-test overrides still win over this default.
configure({ asyncUtilTimeout: 10_000 });
