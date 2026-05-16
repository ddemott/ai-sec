/**
 * Verification-only spec for the 2026-05-16 UI rename pass:
 *   A1 — Advanced tabs renamed: My Business / My Team / Phone Assistant
 *   B2 — Sub-tab "Shifts" renamed to "Working Days" under My Team
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

const DYNATIRE_TENANT_ID = 'f234e471-0e60-4163-86c9-93cfd9338e3a';

async function landOnDynatireDashboard(page: Page) {
  await page.goto('/dashboard');
  // Super-admin admin@secretaryhq.com lands on the All-Businesses tile
  // grid — pick DynaTire so the owner-flavoured nav renders.
  const tenantBtn = page.getByTestId(`tenant-card-${DYNATIRE_TENANT_ID}`);
  if (await tenantBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await tenantBtn.click();
    await page.waitForTimeout(800);
  }
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

    await page.getByRole('tab', { name: /^My Team$/ }).first().click();
    await page.waitForTimeout(500);

    await expect(page.getByRole('tab', { name: /Working Days/ }).first()).toBeVisible();
    // Old sub-tab label should not appear — the parent "My Team" no longer
    // contains "Shifts" anywhere.
    await expect(page.getByRole('tab', { name: /^Shifts$/ })).toHaveCount(0);
  });
});

test.describe('Wizard launcher (D2 chip labels verified by unit tests)', () => {
  test('Setup Assistant button opens the wizard mode chooser with welcome copy', async ({ page }) => {
    await landOnDynatireDashboard(page);

    await page.getByRole('tab', { name: /^My Business$/ }).first().click();
    await page.waitForTimeout(500);

    // The Setup Assistant button lives in the FolderTabBar right slot.
    await page.getByRole('button', { name: /Setup Assistant/i }).click();
    await page.waitForTimeout(500);

    // WizardModeChooser welcome copy + two mode cards
    await expect(page.getByText('How is your business set up?')).toBeVisible();
    await expect(page.getByText('Just me')).toBeVisible();
    await expect(page.getByText('I have a team')).toBeVisible();

    // Close without picking a mode — stepping further opens
    // BusinessTypePicker which writes tenant config on select.
    await page.getByRole('button', { name: /Close wizard/i }).first().click();
  });
});

test.describe('Business Type move — Settings hosts it, AI Persona doesn\'t', () => {
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

    await page.getByRole('tab', { name: /^Phone Assistant$/ }).first().click();
    await page.waitForTimeout(500);
    // The AI Persona sub-tab is the default landing for Phone Assistant.

    // Header still present
    await expect(page.getByRole('heading', { name: /AI Persona Tuning/i })).toBeVisible();
    // Old section heading removed — the 24-card grid no longer here.
    await expect(page.getByRole('heading', { name: /^Business Type Templates$/ })).toHaveCount(0);
    // The new header subtitle directs the user where business-type now lives.
    await expect(page.getByText(/To change your industry template, go to Business Settings/i)).toBeVisible();
  });

  test('Apply-to-my-business is guarded by a confirmation modal (cancel exits cleanly)', async ({ page }) => {
    await landOnDynatireDashboard(page);

    await page.getByRole('button', { name: /Account menu/i }).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: /Business Settings/i }).click();
    await page.waitForTimeout(800);

    await page.getByRole('button', { name: /Change business type/i }).click();
    await page.waitForTimeout(500);

    // Picker modal: pick the first non-current template card. Excluding
    // DynaTire's current template ('automotive_v1' → "Automotive") avoids
    // the disabled "Already applied" path.
    const candidateCard = page
      .locator('button:has-text("Salon"), button:has-text("Mobile Tire"), button:has-text("Auto Bays")')
      .first();
    await candidateCard.click();
    await page.waitForTimeout(500);

    // Preview modal: Apply button visible, not yet a write.
    const applyBtn = page.getByRole('button', { name: /Apply to my business/i });
    await expect(applyBtn).toBeVisible();
    await applyBtn.click();
    await page.waitForTimeout(400);

    // Confirmation guard — copy mentions the destructive consequences.
    await expect(page.getByRole('heading', { name: /Change business type\?/i })).toBeVisible();
    await expect(page.getByText(/replaces your AI persona, voice, and first message/i)).toBeVisible();

    // Cancel — no write, no visible change to the page after the modals
    // close. We do NOT click "Change business type" inside the guard,
    // because that would rewrite the DynaTire tenant config.
    await page.getByRole('button', { name: /^Cancel$/ }).click();
    await page.waitForTimeout(400);
  });
});
