/**
 * Setup sub-tabs must be reachable all the way to the bottom.
 *
 * Reported bug (Dale, 2026-07-11): "on the tabs in SETUP I can't scroll when the
 * data goes below the bottom of the screen."
 *
 * Root cause: SetupView's sub-tab panel was a plain block `<div>` with
 * `overflow-hidden`. Two consequences, both fixed together:
 *   - The leaf views written as `flex-1 … overflow-y-auto` (Services, Resources,
 *     Employees, Business Settings…) rely on being flex CHILDREN to get a bounded
 *     height. Under a block parent, `flex-1` is inert — they sized to content, so
 *     their own overflow-y-auto never engaged and the parent simply CLIPPED them.
 *   - The plain-div views (Billing, Audit Log, Answer Debugger) have no scroll
 *     container at all, so the panel itself had to be the scroller.
 *
 * The assertion is deliberately behavioural — "can a short viewport actually
 * reach the bottom of the content" — rather than a class-name check, because the
 * bug was never about which classes were present; it was about whether any
 * ancestor established a scrollable box. A CSS-class assertion would have passed
 * against the broken build (`overflow-hidden` was, after all, "the intended class").
 */
import { test, expect } from '@playwright/test';

// A short viewport guarantees overflow on any tab with real content — this is the
// "data goes below the bottom of the screen" condition from the report.
test.use({ viewport: { width: 1280, height: 500 } });

// One self-scrolling view and one plain-div view: the two distinct failure modes.
const TABS = ['services', 'audit-log'] as const;

for (const subtab of TABS) {
  test(`Setup → ${subtab} can be scrolled to the bottom when content overflows`, async ({
    page,
  }) => {
    await page.goto(`/dashboard?tab=setup&subtab=${subtab}`);

    const panel = page.getByTestId('setup-panel');
    await expect(panel).toBeVisible();

    // The panel (or something inside it) must establish a scrollable box, and the
    // page body must NOT be the thing that grew — the layout is a fixed-height
    // app shell, so body growth would mean content pushed off-screen for good.
    const reachable = await panel.evaluate((el: HTMLElement) => {
      // Walk the panel and its descendants for anything that ACTUALLY scrolls.
      const candidates = [el, ...Array.from(el.querySelectorAll<HTMLElement>('*'))];
      const scroller = candidates.find((n) => {
        const style = getComputedStyle(n);
        const scrolls = /(auto|scroll)/.test(style.overflowY);
        return scrolls && n.scrollHeight > n.clientHeight + 1;
      });

      if (scroller) {
        const maxScroll = scroller.scrollHeight - scroller.clientHeight;
        scroller.scrollTop = maxScroll;
        return { state: 'scrollable', scrolledTo: scroller.scrollTop, maxScroll };
      }

      // No scroller. Two very different situations, and conflating them is what
      // made the first cut of this test worthless — it SKIPPED on the bug:
      //
      //   (a) the content genuinely fits  → nothing to prove, skip.
      //   (b) the content overflows the panel and nothing can scroll → THE BUG.
      //       `overflow-hidden` still reports scrollHeight > clientHeight; the
      //       overspill is simply clipped and unreachable.
      const clipped = el.scrollHeight > el.clientHeight + 1;
      return { state: clipped ? 'clipped' : 'fits', scrolledTo: 0, maxScroll: 0 };
    });

    if (reachable.state === 'fits') {
      test.skip(true, `${subtab} content fits in the viewport — no overflow to scroll`);
    }

    // The bug, stated directly: content ran past the bottom and no ancestor
    // established a scrollable box, so the overspill was unreachable.
    expect(
      reachable.state,
      `Setup → ${subtab}: content overflows the panel but nothing scrolls — the bottom rows are unreachable`
    ).not.toBe('clipped');

    // And the positive half: we asked to scroll to the bottom and got there.
    expect(reachable.scrolledTo).toBeGreaterThan(0);
    expect(reachable.scrolledTo).toBeCloseTo(reachable.maxScroll, 0);
  });
}
