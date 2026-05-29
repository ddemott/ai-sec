/**
 * D1 — Wizard welcome screen, AUTO-OPEN path (2026-05-17).
 *
 * ui-rename-verification.spec.ts already covers the explicit-launch path:
 * MyBusinessView → Setup Assistant button → welcome → mode chooser. That
 * is NOT the primary D1 flow. The primary flow is the new-tenant landing:
 * an owner who has just registered lands on Home with `needsSetup === true`,
 * and the welcome dialog auto-opens.
 *
 * This spec exercises that auto-open path against the real backend by
 *   1. registering a fresh tenant via POST /register (no services /
 *      employees / resources → needsSetup === true),
 *   2. driving the super-admin browser into that tenant via the same
 *      localStorage shape OutlookLayout uses for managed-tenant switching,
 *   3. asserting the welcome dialog appears WITHOUT a click, and that
 *      the mode chooser is NOT yet visible (the staged flow gate),
 *   4. exercising the two exit paths (Let's go advances; "set up later"
 *      dismisses to the in-page banner, which on re-entry skips welcome).
 *
 * Tenant cleanup via `cleanTenantData(pool, tenantId)` in `finally`
 * (single DELETE cascades the entire fresh-tenant tree).
 */
import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';
import { Pool } from 'pg';
import {
  PG_URL,
  registerFreshTenant,
  cleanTenantData,
  type RegisteredTenant,
} from './helpers/fixtures';

let pool: Pool;
test.beforeAll(() => {
  pool = new Pool({ connectionString: PG_URL });
});
test.afterAll(async () => {
  await pool.end();
});

/**
 * Switch the super-admin's "managed tenant" to the fresh tenant via the
 * same localStorage keys OutlookLayout reads on mount, then reload so
 * the dashboard re-bootstraps against the new active tenant.
 *
 * Why localStorage and not the All-Businesses tile click: the tile grid
 * caches the tenant list and would need a forced refresh after register.
 * The localStorage path is what the production All-Businesses click ends
 * up writing anyway — using it directly isolates this spec from the tile-
 * refresh surface and keeps the assertions focused on D1 behavior.
 */
async function switchToFreshTenant(page: Page, tenantId: string, tenantName: string) {
  // Land on the dashboard once to access localStorage on its origin.
  await page.goto('/dashboard');
  await page.evaluate(
    ({ id, name }) => {
      localStorage.setItem('managedTenantId', id);
      localStorage.setItem('managedTenantName', name);
    },
    { id: tenantId, name: tenantName }
  );

  // The super-admin auth state can leave the active tab anywhere
  // (often All Businesses after a previous spec's tile-grid run).
  // Force ?tab=home so DashboardHome mounts for the fresh tenant, then
  // click the Home tab too — internal-state tabs ignore the URL after
  // first mount, so the click guarantees we end up where we want.
  await page.goto('/dashboard?tab=home');
  // page.goto waits for 'load' by default — the tab click can fire immediately.
  await page
    .getByRole('tab', { name: /^Home$/ })
    .first()
    .click();
  // Wait for the dashboard's loadData() round-trip to settle so the
  // needsSetup calculation reflects the fresh tenant's empty state.
  // networkidle = no pending requests for 500ms, which means all 6
  // parallel loadData() calls have returned and loading=false has been
  // set — the auto-open effect fires synchronously after that.
  await page.waitForLoadState('networkidle');
}

test.describe('Wizard welcome — auto-open on fresh-tenant landing', () => {
  test('D1: fresh tenant lands on Home → welcome auto-opens, mode chooser is NOT yet visible', async ({
    page,
    request,
  }) => {
    // WHO: a new owner who just walked the register form and clicked through to /dashboard.
    // WHAT: the welcome dialog must appear on Home WITHOUT any further click,
    //       and the WizardModeChooser must NOT be co-rendered (the staged
    //       flow gates the chooser behind the user's "Let's go").
    // WHEN: every successful registration through the public marketing site.
    //       Empty pickers without a welcome framing was the H3 (user
    //       control) violation D1 is supposed to fix.
    // WHERE: dashboard/components/DashboardHome.tsx (showWelcome / showWizardChooser
    //       split) + dashboard/components/SetupWizard/WizardWelcome.tsx.
    // WHY: ui-rename-verification.spec.ts only covers the MyBusinessView
    //       "Setup Assistant button" launch path. The auto-open path on
    //       Home is the PRIMARY D1 case ("Done signal: new tenants see
    //       welcome → mode chooser → BusinessTypePicker → wizard") and
    //       has zero E2E coverage without this spec.
    let tenant: RegisteredTenant | null = null;
    try {
      tenant = await registerFreshTenant(request);
      await switchToFreshTenant(
        page,
        tenant.tenantId,
        `D1 Auto-Open ${tenant.tenantId.slice(0, 6)}`
      );

      // Welcome dialog auto-opens. The Home tab is the default landing.
      await expect(page.getByRole('dialog', { name: /welcome/i })).toBeVisible({ timeout: 8000 });
      await expect(page.getByText(/10 minutes from going live/i)).toBeVisible();
      await expect(page.getByText(/stop and come back any time/i)).toBeVisible();

      // The staged flow gate: mode chooser is NOT yet rendered. A
      // regression that bypasses welcomePassed and double-stacks both
      // modals (or skips welcome entirely) would fail here.
      await expect(page.getByText('How is your business set up?')).toHaveCount(0);

      // Both exits are present and the X close button is keyboard-reachable.
      await expect(page.getByRole('button', { name: /Let's go/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /set up later/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /close welcome/i })).toBeVisible();
    } finally {
      if (tenant) await cleanTenantData(pool, tenant.tenantId);
    }
  });

  test('D1: "Let\'s go" advances welcome → mode chooser; welcome disappears', async ({
    page,
    request,
  }) => {
    // WHO: owner ready to set up after the scope-setting framing
    // WHAT: clicking "Let's go" must hide the welcome AND show the mode
    //       chooser. They cannot be visible at the same time.
    // WHERE: DashboardHome.tsx — welcomePassed gate flips, showWelcome
    //       becomes false and showWizardChooser becomes true on the same render.
    // WHY: a regression that left welcome rendered after the advance
    //       (or rendered chooser BEFORE the user clicked Let's go) would
    //       create a confusing double-modal or skip the scope framing
    //       entirely. This assertion pins both behaviors.
    let tenant: RegisteredTenant | null = null;
    try {
      tenant = await registerFreshTenant(request);
      await switchToFreshTenant(page, tenant.tenantId, `D1 LetsGo ${tenant.tenantId.slice(0, 6)}`);

      await expect(page.getByRole('dialog', { name: /welcome/i })).toBeVisible({ timeout: 8000 });
      await page.getByRole('button', { name: /Let's go/i }).click();

      // Mode chooser is now visible AND welcome is gone.
      await expect(page.getByText('How is your business set up?')).toBeVisible({ timeout: 4000 });
      await expect(page.getByRole('dialog', { name: /welcome/i })).toHaveCount(0);

      // Close cleanly without stepping into BusinessTypePicker, which
      // would call /tenants/.../config and mutate this tenant's config.
      await page
        .getByRole('button', { name: /Close wizard/i })
        .first()
        .click();
    } finally {
      if (tenant) await cleanTenantData(pool, tenant.tenantId);
    }
  });

  test('D1: dismissing welcome shows the in-page Setup Assistant banner', async ({
    page,
    request,
  }) => {
    // WHO: owner who wants to explore the dashboard before setting up
    // WHAT: "I'll set up later" must close BOTH the welcome and any
    //       chooser, AND surface the post-dismiss banner on Home so the
    //       user isn't stranded with no path back to setup.
    // WHERE: DashboardHome.tsx — the `needsSetup && wizardDismissed`
    //       banner renders below the load-error region.
    // WHY: dismissing without surfacing a re-entry path is a UX dead-
    //       end. The H3 (user control) win of D1 depends on this
    //       fallback existing.
    let tenant: RegisteredTenant | null = null;
    try {
      tenant = await registerFreshTenant(request);
      await switchToFreshTenant(page, tenant.tenantId, `D1 Dismiss ${tenant.tenantId.slice(0, 6)}`);

      await expect(page.getByRole('dialog', { name: /welcome/i })).toBeVisible({ timeout: 8000 });
      await page.getByRole('button', { name: /set up later/i }).click();

      // Welcome closed; mode chooser never appeared.
      await expect(page.getByRole('dialog', { name: /welcome/i })).toHaveCount(0);
      await expect(page.getByText('How is your business set up?')).toHaveCount(0);

      // Banner offers the way back.
      await expect(page.getByRole('button', { name: /open setup assistant/i })).toBeVisible();
      await expect(page.getByText(/finish setting up your business/i)).toBeVisible();
    } finally {
      if (tenant) await cleanTenantData(pool, tenant.tenantId);
    }
  });

  test('D4: setup-progress pill renders "Setup: 0 of 6 done" for a fresh tenant and opens the wizard on click', async ({
    page,
    request,
  }) => {
    // WHO: fresh tenant whose owner is exploring the dashboard chrome
    //      (not Home — any tab) and notices the persistent pill.
    // WHAT: the pill is mounted in OutlookLayout's top utility row and
    //       reads "Setup: 0 of 6 done" because nothing's been configured
    //       yet. Clicking the pill jumps to Home with the wizard already
    //       opened past the welcome (welcome was the user's first auto-
    //       open framing — pill clicks are second-touch and skip it).
    // WHERE: dashboard/components/SetupProgressPill.tsx +
    //       dashboard/components/DashboardHome.tsx (the ?wizard=open
    //       URL-param consumer).
    // WHY: the pill is the only ambient setup affordance once the auto-
    //      open welcome has been dismissed. If the click handler dropped
    //      the wizard=open param OR forgot to mark welcomePassed=true,
    //      the user would either land on Home with no wizard, or see
    //      the welcome screen again on every pill click.
    let tenant: RegisteredTenant | null = null;
    try {
      tenant = await registerFreshTenant(request);
      await switchToFreshTenant(page, tenant.tenantId, `D4 Pill ${tenant.tenantId.slice(0, 6)}`);

      // Dismiss the auto-opened welcome so the pill is the only path
      // back to setup — this is the exact scenario the pill exists for.
      await expect(page.getByRole('dialog', { name: /welcome/i })).toBeVisible({ timeout: 8000 });
      await page.getByRole('button', { name: /set up later/i }).click();
      await page.waitForTimeout(400);
      await expect(page.getByRole('dialog', { name: /welcome/i })).toHaveCount(0);

      // Pill is now mounted in the utility row. Five fetches have to
      // settle before it renders (no zero-flash), so allow a small wait.
      const pill = page.getByRole('button', { name: /Setup 0 of 6 done/i });
      await expect(pill).toBeVisible({ timeout: 5000 });

      // Navigate away from Home so the click has to bring us back via
      // the URL push — this tests the navigation behavior, not just the
      // wizard state. Schedule is a safe primary tab to land on first.
      await page
        .getByRole('tab', { name: /^Schedule$/ })
        .first()
        .click();
      await page.waitForTimeout(400);

      // Pill still visible from the Schedule tab — it's chrome-level.
      await expect(pill).toBeVisible();

      await pill.click();
      await page.waitForTimeout(800);

      // Mode chooser appears DIRECTLY (welcome was already dismissed
      // and pill click sets welcomePassed=true so it doesn't reappear).
      await expect(page.getByText('How is your business set up?')).toBeVisible({ timeout: 5000 });
      await expect(page.getByRole('dialog', { name: /welcome/i })).toHaveCount(0);

      // URL has the wizard=open param stripped by DashboardHome on mount.
      const url = new URL(page.url());
      expect(url.searchParams.get('wizard')).toBeNull();

      await page
        .getByRole('button', { name: /Close wizard/i })
        .first()
        .click();
    } finally {
      if (tenant) await cleanTenantData(pool, tenant.tenantId);
    }
  });

  test('D1: clicking "Open Setup Assistant" banner skips welcome and goes straight to the mode chooser', async ({
    page,
    request,
  }) => {
    // WHO: owner who dismissed welcome earlier and now decides to set up
    // WHAT: the banner click jumps directly to the mode chooser WITHOUT
    //       re-showing welcome. Welcome's job is one-time scope framing
    //       on auto-open; the banner click IS the explicit "yes, set me
    //       up" signal — re-showing welcome there would be redundant friction.
    // WHERE: DashboardHome.tsx — the banner's onClick sets welcomePassed=true
    //       in addition to clearing wizardDismissed.
    // WHY: pinning this means a future refactor that forgets the
    //       welcomePassed=true flag on the banner click would be caught
    //       here, not in production after a beta customer complains.
    let tenant: RegisteredTenant | null = null;
    try {
      tenant = await registerFreshTenant(request);
      await switchToFreshTenant(page, tenant.tenantId, `D1 Reentry ${tenant.tenantId.slice(0, 6)}`);

      await expect(page.getByRole('dialog', { name: /welcome/i })).toBeVisible({ timeout: 8000 });
      await page.getByRole('button', { name: /set up later/i }).click();

      const reopenBtn = page.getByRole('button', { name: /open setup assistant/i });
      await expect(reopenBtn).toBeVisible();
      await reopenBtn.click();

      // Mode chooser shows immediately, welcome stays gone.
      await expect(page.getByText('How is your business set up?')).toBeVisible({ timeout: 4000 });
      await expect(page.getByRole('dialog', { name: /welcome/i })).toHaveCount(0);

      await page
        .getByRole('button', { name: /Close wizard/i })
        .first()
        .click();
    } finally {
      if (tenant) await cleanTenantData(pool, tenant.tenantId);
    }
  });
});
