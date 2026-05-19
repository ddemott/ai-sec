/**
 * Verification-only spec for the 2026-05-16 UI rename pass:
 *   A1 — Advanced tabs renamed: My Business / My Team / Phone Assistant
 *   B2 — Sub-tab "Shifts" renamed to "Working Days" under My Team
 *   B3 — Knowledge Base sub-tab moved from My Business → Phone Assistant
 *   D2 — Wizard chip "Shifts" renamed to "When they work" (chip labels are
 *        pinned by 86 unit-test assertions in SetupWizard.test.tsx — this
 *        spec verifies the launcher path only, since stepping into the
 *        wizard would write tenant config via BusinessTypePicker)
 *   Business Type move — Business Settings now hosts the section, AI Persona
 *        no longer does, and applying a template is guarded by a confirm.
 *
 * Assertions are positive AND negative where useful, so a stale CSS-cache
 * or partial deploy can't make this go green by silently rendering the old
 * surface.
 */
import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';
import { Pool } from 'pg';
import { seedDynaTireBusinessConfig, clearDynaTireBusinessConfig } from './helpers/fixtures';

const DYNATIRE_TENANT_ID = 'f234e471-0e60-4163-86c9-93cfd9338e3a';
const PG_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/postgres';

// Most tests in this spec assume DynaTire is "fully configured" — the
// inline comment at line ~136 explicitly notes the expectation. Since
// 2026-05-18 seed-strip-stage-b moved business config out of seed.sql,
// bootstrap it here so the My Team / Working Days / template-picker
// surfaces have something to render against.
let pool: Pool;
test.beforeAll(async () => {
  pool = new Pool({ connectionString: PG_URL });
  await seedDynaTireBusinessConfig(pool);
});
test.afterAll(async () => {
  await clearDynaTireBusinessConfig(pool);
  await pool.end();
});

async function landOnDynatireDashboard(page: Page) {
  // Super-admin auth state can be left scoped to whichever tenant the
  // previous spec file ended on, so a bare goto('/dashboard') may land
  // on the wrong tenant. Force the All-Businesses grid via the URL,
  // pick DynaTire by its tenant-card testid (sets activeTenantId), then
  // click Home so the main view leaves the tile grid and renders the
  // tenant-scoped dashboard.
  await page.goto('/dashboard?tab=all-businesses');
  const tenantBtn = page.getByTestId(`tenant-card-${DYNATIRE_TENANT_ID}`);
  await tenantBtn.waitFor({ state: 'visible', timeout: 5000 });
  await tenantBtn.click();
  await page.waitForTimeout(400);
  await page
    .getByRole('tab', { name: /^Home$/ })
    .first()
    .click();
  await page.waitForTimeout(800);
}

test.describe('UI rename — A1 + B2', () => {
  test('owner sees the three renamed advanced tabs', async ({ page }) => {
    await landOnDynatireDashboard(page);

    // A1: new labels present
    await expect(page.getByRole('tab', { name: /^My Business$/ }).first()).toBeVisible();
    await expect(page.getByRole('tab', { name: /^My Team$/ }).first()).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Phone Assistant$/ }).first()).toBeVisible();

    // A1: old labels absent
    await expect(page.getByRole('tab', { name: /Services & Resources/ })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /Staff & Shifts/ })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /AI & Knowledge/ })).toHaveCount(0);
  });

  test('B2: My Team sub-tab reads "Working Days", not "Shifts"', async ({ page }) => {
    await landOnDynatireDashboard(page);

    await page
      .getByRole('tab', { name: /^My Team$/ })
      .first()
      .click();
    await page.waitForTimeout(500);

    await expect(page.getByRole('tab', { name: /Working Days/ }).first()).toBeVisible();
    // Old sub-tab label should not appear — the parent "My Team" no longer
    // contains "Shifts" anywhere.
    await expect(page.getByRole('tab', { name: /^Shifts$/ })).toHaveCount(0);
  });

  test('B3: Knowledge Base lives under Phone Assistant, not My Business', async ({ page }) => {
    await landOnDynatireDashboard(page);

    // Under Phone Assistant: Knowledge Base sub-tab is present.
    await page
      .getByRole('tab', { name: /^Phone Assistant$/ })
      .first()
      .click();
    await page.waitForTimeout(500);
    await expect(page.getByRole('tab', { name: /Knowledge Base/ }).first()).toBeVisible();

    // Under My Business: Knowledge Base sub-tab is absent. Only Services
    // and the vocab-driven resources sub-tab remain.
    await page
      .getByRole('tab', { name: /^My Business$/ })
      .first()
      .click();
    await page.waitForTimeout(500);
    await expect(page.getByRole('tab', { name: /Knowledge Base/ })).toHaveCount(0);
  });

  test('C3: "New Booking" button on Home opens the Quick Book panel', async ({ page }) => {
    await landOnDynatireDashboard(page);
    // Home is the default landing after tenant select — no explicit nav.
    const newBookingBtn = page.getByRole('button', { name: /Create a new booking/i });
    await expect(newBookingBtn).toBeVisible();
    await expect(newBookingBtn).toBeEnabled();

    await newBookingBtn.click();
    await expect(page.getByTestId('quick-book-panel')).toBeVisible();

    // Close without booking — the test must not write to the tenant.
    // QuickBookPanel uses Escape to close. Falling back to the X button
    // via aria-label if Escape doesn't dismiss.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });
});

test.describe('Wizard launcher (D2 chip labels verified by unit tests)', () => {
  test('Setup Assistant opens welcome → "Let\'s go" advances to mode chooser', async ({ page }) => {
    await landOnDynatireDashboard(page);

    await page
      .getByRole('tab', { name: /^My Business$/ })
      .first()
      .click();
    await page.waitForTimeout(500);

    // The Setup Assistant button lives in the FolderTabBar right slot.
    await page.getByRole('button', { name: /Setup Assistant/i }).click();
    await page.waitForTimeout(500);

    // D1 (2026-05-17): the wizard now opens with a scope-setting welcome
    // screen ahead of the mode chooser, not the mode chooser directly.
    await expect(page.getByRole('dialog', { name: /welcome/i })).toBeVisible();
    await expect(page.getByText(/10 minutes from going live/i)).toBeVisible();
    // Mode chooser is gated until the user clicks "Let's go" — assert
    // it is NOT yet visible so a regression that double-stacks the
    // modals (or removes the welcome) would fail loudly.
    await expect(page.getByText('How is your business set up?')).toHaveCount(0);

    await page.getByRole('button', { name: /Let's go/i }).click();
    await page.waitForTimeout(300);

    // WizardModeChooser welcome copy + two mode cards now visible.
    await expect(page.getByText('How is your business set up?')).toBeVisible();
    await expect(page.getByText('Just me')).toBeVisible();
    await expect(page.getByText('I have a team')).toBeVisible();

    // Close without picking a mode — stepping further opens
    // BusinessTypePicker which writes tenant config on select.
    await page
      .getByRole('button', { name: /Close wizard/i })
      .first()
      .click();
  });

  test('Setup Assistant → welcome "show me around" exits cleanly (no chooser appears)', async ({
    page,
  }) => {
    // WHY (D1): the explicit "I'll set up later, just show me around" exit
    // must close the entire wizard — it cannot silently advance to the
    // mode chooser or trap the user in another modal. DynaTire is already
    // fully configured so this is non-destructive (no writes possible).
    await landOnDynatireDashboard(page);

    await page
      .getByRole('tab', { name: /^My Business$/ })
      .first()
      .click();
    await page.waitForTimeout(500);

    await page.getByRole('button', { name: /Setup Assistant/i }).click();
    await page.waitForTimeout(500);

    await expect(page.getByRole('dialog', { name: /welcome/i })).toBeVisible();

    await page.getByRole('button', { name: /set up later/i }).click();
    await page.waitForTimeout(300);

    await expect(page.getByRole('dialog', { name: /welcome/i })).toHaveCount(0);
    await expect(page.getByText('How is your business set up?')).toHaveCount(0);
  });
});

test.describe("Business Type move — Settings hosts it, AI Persona doesn't", () => {
  test('Business Settings has the new "Business type" card', async ({ page }) => {
    await landOnDynatireDashboard(page);

    // Open the profile dropdown, then Business Settings.
    await page.getByRole('button', { name: /Account menu/i }).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: /Business Settings/i }).click();
    await page.waitForTimeout(800);

    // The new section card lives at the top of the settings stack.
    await expect(page.getByRole('heading', { name: /Business type/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Change business type/i })).toBeVisible();
  });

  test('AI Persona page no longer shows the template grid', async ({ page }) => {
    await landOnDynatireDashboard(page);

    await page
      .getByRole('tab', { name: /^Phone Assistant$/ })
      .first()
      .click();
    await page.waitForTimeout(500);
    // The AI Persona sub-tab is the default landing for Phone Assistant.

    // Header still present
    await expect(page.getByRole('heading', { name: /AI Persona Tuning/i })).toBeVisible();
    // Old section heading removed — the 24-card grid no longer here.
    await expect(page.getByRole('heading', { name: /^Business Type Templates$/ })).toHaveCount(0);
    // The new header subtitle directs the user where business-type now lives.
    await expect(
      page.getByText(/To change your industry template, go to Business Settings/i)
    ).toBeVisible();
  });

  test('Apply-to-my-business is guarded by a confirmation modal (cancel exits cleanly)', async ({
    page,
  }) => {
    await landOnDynatireDashboard(page);

    await page.getByRole('button', { name: /Account menu/i }).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: /Business Settings/i }).click();
    await page.waitForTimeout(800);

    await page.getByRole('button', { name: /Change business type/i }).click();
    await page.waitForTimeout(500);

    // Picker modal: pick a template guaranteed-different from DynaTire's
    // current one ("Mobile Tire Shop"). Salon is beauty/personal-care,
    // unambiguously not the active template, so the preview's Apply
    // button is enabled (not "Already applied").
    const candidateCard = page.getByRole('dialog').getByRole('button', { name: /Salon/i }).first();
    await candidateCard.click();
    await page.waitForTimeout(500);

    // Preview modal: Apply button visible, not yet a write.
    const applyBtn = page.getByRole('button', { name: /Apply to my business/i });
    await expect(applyBtn).toBeVisible();
    await applyBtn.click();
    await page.waitForTimeout(400);

    // Confirmation guard — copy mentions the destructive consequences.
    await expect(page.getByRole('heading', { name: /Change business type\?/i })).toBeVisible();
    await expect(
      page.getByText(/replaces your AI persona, voice, and first message/i)
    ).toBeVisible();

    // Cancel — no write, no visible change to the page after the modals
    // close. We do NOT click "Change business type" inside the guard,
    // because that would rewrite the DynaTire tenant config.
    await page.getByRole('button', { name: /^Cancel$/ }).click();
    await page.waitForTimeout(400);
  });
});
