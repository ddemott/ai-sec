/**
 * Wrapped Playwright `test` with two safety nets every test gets
 * automatically. Drop-in replacement for `@playwright/test`:
 *
 *   import { test, expect } from './helpers/test';
 *
 * Two safety nets attached to every `page` fixture:
 *
 * 1. **pageerror watchdog** — any uncaught JavaScript exception in
 *    the browser fails the test at end-of-body. Pre-watchdog, an
 *    uncaught throw → React error boundary → "Something went wrong"
 *    screen → tests that didn't explicitly look for that text stayed
 *    green while the page was visibly broken.
 *
 * 2. **error-boundary visibility watchdog** — at end of every test,
 *    asserts the "Something went wrong" boundary text isn't rendered.
 *    Catches the case where a child component throw was caught by
 *    the boundary (so pageerror didn't fire at the page level) but
 *    the page is still broken.
 *
 * To opt OUT for a specific test (e.g., a test that intentionally
 * exercises an error path), import from the unwrapped library:
 *   import { test, expect } from '@playwright/test';
 *
 * Origin: 2026-05-13 — the May 12 PK rename sprint introduced a
 * regression in `TenantCard.tsx` where the bundled JS still read
 * `tenant.id` (renamed to `tenant.tenant_id` in the source). The
 * error boundary caught the resulting `Cannot read properties of
 * undefined (reading 'slice')`, the full existing E2E suite
 * stayed green, and the regression was only caught when a human
 * clicked the affected path during live testing. The watchdog
 * makes future regressions of the same shape visible immediately.
 *
 * Migration: 19 existing specs still import from `@playwright/test`
 * directly. They can be migrated one at a time — change the import
 * line, run the spec, address any new failures (which are real
 * regressions the watchdog has been masking). New specs should
 * always use this wrapper unless they have a clear reason not to.
 */
import { test as base, expect } from '@playwright/test';

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const errors: string[] = [];

    page.on('pageerror', (err) => {
      errors.push(`pageerror: ${err.message}\n${err.stack ?? '(no stack)'}`);
    });

    await use(page);

    // Surface uncaught JS errors as a test attachment for CI visibility.
    if (errors.length > 0) {
      await testInfo.attach('browser-errors.log', {
        body: errors.join('\n\n---\n\n'),
        contentType: 'text/plain',
      });
    }
    expect(
      errors,
      `Browser fired ${errors.length} uncaught JavaScript error(s) — see attached browser-errors.log`,
    ).toHaveLength(0);

    // Error-boundary watchdog. Short timeout so a closed page or
    // navigated-away test doesn't slow the suite down; we only need to
    // know whether the boundary text is currently on screen.
    let boundaryVisible = false;
    try {
      boundaryVisible = await page
        .getByText('Something went wrong')
        .isVisible({ timeout: 250 });
    } catch {
      // Page already closed or navigated away — not a watchdog failure.
    }
    expect(
      boundaryVisible,
      'Page rendered the generic error boundary — a child component threw silently',
    ).toBe(false);
  },
});

export { expect };
