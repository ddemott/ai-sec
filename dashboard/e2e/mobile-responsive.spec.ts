/**
 * Mobile-responsiveness E2E. Pins that the three daily-use flows reachable
 * from the operator's phone — today's schedule, Quick Book, customer
 * lookup — render without horizontal overflow and surface clickable
 * affordances on common mobile viewports (iPhone 14 + Pixel 7).
 *
 * Why this exists: `docs/TODO.md` UX section "Mobile responsiveness
 * validated for shop owners" — tire shop / salon owners check schedules
 * on their phone between customers. The dashboard targets desktop
 * primarily; this spec catches the worst regressions (mobile nav
 * disappearing, primary buttons clipped offscreen, horizontal scroll
 * appearing because a fixed-width element snuck in) before a beta
 * customer notices.
 *
 * Design notes:
 *   - Uses Playwright's `devices` to emulate real iOS Safari (iPhone 14)
 *     + Android Chrome (Pixel 7) shapes. The mobile bottom nav becomes
 *     visible below the `md` Tailwind breakpoint (768px) — both emulated
 *     devices are narrower than that, so the mobile nav path is exercised.
 *   - Horizontal overflow check uses `document.documentElement.scrollWidth`
 *     vs viewport width. A few pixels of tolerance is allowed for
 *     subpixel rendering on retina-density screens.
 *   - Tests share the admin storage state set up by auth.setup.ts. We
 *     switch to the DynaTire tenant via localStorage so the seeded data
 *     is reachable.
 *   - These are *audit* tests — they assert the affordance EXISTS and is
 *     reachable, not that the underlying business action succeeded
 *     (the booking-/customer-/scheduler-spec files own those contracts).
 *     Keeps the mobile spec stable across seed-data changes.
 */
import { test, expect } from './helpers/test';
import { type Page } from '@playwright/test';
import { Pool } from 'pg';
const DYNATIRE_ID = 'f234e471-0e60-4163-86c9-93cfd9338e3a';
const PG_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/postgres';
let pool: Pool;
test.beforeAll(() => { pool = new Pool({ connectionString: PG_URL }); });
test.afterAll(async () => { await pool.end(); });

// Mobile viewports for the audit. Sizes lifted from the Playwright
// `devices['iPhone 14']` and `devices['Pixel 7']` descriptors. We set
// viewport directly via page.setViewportSize rather than test.use(devices)
// because the latter changes browser type at the describe level, which
// Playwright forbids inside a describe (would force a new worker).
// Viewport-only is sufficient for the no-overflow + responsive-class
// audit this spec performs; we're not exercising touch-specific behavior
// that would need the full device emulation (user agent, touch input).
const IPHONE_14 = { width: 390, height: 844 };
const PIXEL_7 = { width: 412, height: 915 };

async function switchToDynaTireTenant(page: Page) {
  await page.evaluate((id) => {
    localStorage.setItem('managedTenantId', id);
    localStorage.setItem('managedTenantName', 'DynaTire Mobile Service');
  }, DYNATIRE_ID);
  await page.reload();
  await page.waitForTimeout(1500);
}

/**
 * Read the actual horizontal scroll extent and compare to viewport. A
 * page that exceeds its viewport horizontally on mobile is the single
 * worst UX bug — every interaction inherits side-scroll, content gets
 * cut off, and tap targets land in unexpected places. 4px of tolerance
 * allows for subpixel rounding without masking real overflow.
 */
async function assertNoHorizontalOverflow(page: Page, contextLabel: string) {
  const result = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    innerWidth: window.innerWidth,
  }));
  expect(
    result.scrollWidth,
    `${contextLabel}: page overflows horizontally (scrollWidth=${result.scrollWidth} vs viewport ${result.innerWidth}); operator would have to side-scroll`
  ).toBeLessThanOrEqual(result.innerWidth + 4);
}

// ────────────────────────────────────────────────────────────────────────
// iPhone 14 viewport — primary mobile audit surface
// ────────────────────────────────────────────────────────────────────────

test.describe('iPhone 14 viewport', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(IPHONE_14);
  });

  test('today\'s schedule: mobile nav renders, scheduler view reachable, no horizontal overflow', async ({ page }) => {
    // WHO: shop owner pulling up today's schedule between customers
    // WHAT: dashboard loads on a phone, the mobile bottom nav surfaces
    //        the Schedule tab, tapping it renders the scheduler view
    //        + date display without overflowing the viewport
    // WHEN: any time the operator opens the dashboard on their phone
    // WHERE: OutlookLayout's `<nav aria-label="Mobile navigation">`
    //        + SchedulerView + SchedulerDateNav
    // WHY: if the mobile nav disappears (md:hidden regression on a
    //        sibling class, viewport meta tag broken, fixed-width
    //        element pushing content offscreen) the operator has no
    //        path to today's schedule — the most common reason they'd
    //        pick up their phone. Pin the affordance + the visual
    //        contract (no overflow) on one viewport so a regression
    //        surfaces here before a beta customer reports it.
    await page.goto('/dashboard');
    await switchToDynaTireTenant(page);

    // Mobile bottom nav renders below md breakpoint
    const mobileNav = page.getByRole('navigation', { name: 'Mobile navigation' });
    await expect(mobileNav).toBeVisible({ timeout: 10_000 });

    // Schedule tab exists in the mobile nav (not just the desktop tabs)
    const scheduleBtn = mobileNav.getByRole('button', { name: /Schedule/i });
    await expect(scheduleBtn).toBeVisible();
    await scheduleBtn.click();
    await page.waitForTimeout(800);

    // Scheduler renders + date display visible (proves SchedulerView
    // mounted its sub-components, not just the outer container)
    await expect(page.locator('[data-testid="scheduler-view"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="scheduler-date-display"]')).toBeVisible({ timeout: 10_000 });

    await assertNoHorizontalOverflow(page, 'iPhone 14 — schedule view');
  });

  test('quick book: panel reachable on mobile, form inputs render without overflow', async ({ page }) => {
    // WHO: front-desk operator booking a walk-in from their phone
    // WHAT: navigate to Schedule's Resources sub-view, open Quick Book,
    //        verify the panel and its primary form controls render
    //        on-screen + no horizontal overflow
    // WHEN: walk-in booking on mobile — happens often in shop settings
    // WHERE: SchedulerView Resources sub-view → QuickBookPanel
    // WHY: a Quick Book panel that overflows or hides its inputs
    //        offscreen is functionally broken on mobile. Don't submit
    //        (the workflows.spec.ts quick-book test owns submission);
    //        just prove the operator can REACH the form.
    await page.goto('/dashboard');
    await switchToDynaTireTenant(page);

    // Navigate via mobile nav
    const mobileNav = page.getByRole('navigation', { name: 'Mobile navigation' });
    await mobileNav.getByRole('button', { name: /Schedule/i }).click();
    await page.waitForTimeout(800);

    // Resources sub-view holds Quick Book
    const resourcesTab = page.getByTestId('view-tab-resources');
    await expect(resourcesTab).toBeVisible({ timeout: 10_000 });
    await resourcesTab.click();
    await page.waitForTimeout(500);

    const quickBookBtn = page.locator('button').filter({ hasText: 'Quick Book' }).first();
    await expect(quickBookBtn).toBeVisible({ timeout: 10_000 });
    await quickBookBtn.click();

    const panel = page.getByTestId('quick-book-panel');
    await expect(panel).toBeVisible({ timeout: 5_000 });

    // Primary form controls render — customer + resource + confirm button
    await expect(page.getByTestId('quick-book-customer')).toBeVisible();
    await expect(page.getByTestId('quick-book-resource')).toBeVisible();
    await expect(page.getByTestId('quick-book-confirm')).toBeVisible();

    await assertNoHorizontalOverflow(page, 'iPhone 14 — quick book panel open');
  });

  test('customer lookup: list renders and a customer is visible without overflow', async ({ page }) => {
    // WHO: front-desk operator looking up a customer who just walked in
    // WHAT: tap Customers in the mobile nav → list renders with at
    //        least one customer name visible
    // WHEN: customer-lookup is the second-most-common flow (after
    //        viewing today's schedule)
    // WHERE: CRMView customer list
    // WHY: a regression where the list panel takes the full mobile
    //        width but the detail panel is also visible would split
    //        the layout and make the list unreadable; or a regression
    //        where the list scroll is broken would prevent finding
    //        customers past the fold. Smoke-asserts the list shape +
    //        reads a test-owned customer so the data path is exercised
    //        on mobile. Pre-2026-05-18 this test depended on a seeded
    //        "James Kowalski" — the seed was stripped of customers
    //        (transactional data must be created+destroyed per test);
    //        this spec now owns its own data lifecycle.
    const customerName = `MR-Test ${Date.now()}`
    let createdId: string | null = null
    try {
      const insert = await pool.query(
        `INSERT INTO customers (tenant_id, phone, name, first_name, last_name)
         VALUES ($1, $2, $3, $4, $5) RETURNING customer_id`,
        [DYNATIRE_ID, `+1${String(Date.now()).slice(-10)}`, customerName, 'MR-Test', String(Date.now())]
      )
      createdId = insert.rows[0].customer_id

      await page.goto('/dashboard');
      await switchToDynaTireTenant(page);

      const mobileNav = page.getByRole('navigation', { name: 'Mobile navigation' });
      await mobileNav.getByRole('button', { name: /Customers/i }).click();
      await page.waitForTimeout(1500);

      // Test-owned customer renders in the list (data path works on mobile too)
      await expect(page.getByText(customerName).first()).toBeVisible({ timeout: 10_000 });

      await assertNoHorizontalOverflow(page, 'iPhone 14 — customer list');
    } finally {
      if (createdId) {
        await pool.query('DELETE FROM customers WHERE customer_id = $1', [createdId])
      }
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Pixel 7 viewport — Android coverage smoke
// ────────────────────────────────────────────────────────────────────────

test.describe('Pixel 7 viewport', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PIXEL_7);
  });

  test('smoke: schedule reachable + no horizontal overflow on Android viewport', async ({ page }) => {
    // WHO: shop owner on Android (Pixel 7's 412×915 viewport differs
    //        slightly from iPhone 14's 390×844 — catches issues that
    //        only show at one width)
    // WHAT: same first-flow contract as the iPhone 14 schedule test;
    //        if this passes after iPhone passes we have confidence the
    //        Tailwind `md:hidden` breakpoint + the no-overflow contract
    //        hold across the iOS/Android width range
    // WHEN: Android operators access the dashboard
    // WHERE: OutlookLayout responsive nav + SchedulerView
    // WHY: maintaining a separate Pixel test (vs only testing the
    //        widest mobile) catches the case where a layout works at
    //        one width but breaks at another — typically because a
    //        component uses `max-w-[400px]` or similar that's safe at
    //        390 but cuts off at 412.
    await page.goto('/dashboard');
    await switchToDynaTireTenant(page);

    const mobileNav = page.getByRole('navigation', { name: 'Mobile navigation' });
    await expect(mobileNav).toBeVisible({ timeout: 10_000 });
    await mobileNav.getByRole('button', { name: /Schedule/i }).click();
    await page.waitForTimeout(800);

    await expect(page.locator('[data-testid="scheduler-view"]')).toBeVisible({ timeout: 10_000 });
    await assertNoHorizontalOverflow(page, 'Pixel 7 — schedule view');
  });
});
