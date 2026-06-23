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
