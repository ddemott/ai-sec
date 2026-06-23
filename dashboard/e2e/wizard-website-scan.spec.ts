/**
 * Browser click-path E2E for the setup wizard's "Import from website" step
 * (Step7WebsiteScan). Complements the API-level scan coverage in
 * knowledge-base.spec.ts (`kb-website-import-happy`) by driving the ACTUAL UI an
 * owner clicks: welcome → mode chooser → business-type picker → wizard → the
 * scan step → type a URL → Scan → see the success message.
 *
 * Requires KNOWLEDGE_IMPORT_E2E_STUB=1 (CI sets it on both the backend and the
 * Playwright process) so the scan returns deterministic stub data — no real
 * OpenAI call or external site fetch. Skipped when the stub is off so a local
 * `npx playwright test` never makes a live network/LLM call.
 *
 * Why pre-seed exactly one employee: the wizard gates the step-7 chip on
 * `canAdvanceTo(7)` which needs BOTH services and employees to exist. Picking a
 * business type in the picker auto-seeds the template's services, and the
 * pre-seeded employee satisfies the rest — while keeping `needsSetup` true
 * (services are still empty until the picker runs) so the welcome dialog
 * auto-opens, which is the entry point this test drives.
 *
 * Tenant cleanup via cleanTenantData in finally (one DELETE cascades the tree).
 */
import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';
import { Pool } from 'pg';
import {
  PG_URL,
  registerFreshTenant,
  createEmployeeAs,
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
 * Point the super-admin browser at a fresh tenant via the same localStorage
 * keys OutlookLayout reads for managed-tenant switching, then land on Home so
 * the needsSetup calculation (and the welcome auto-open) reflects it. Mirrors
 * the helper in wizard-welcome-auto-open.spec.ts.
 */
async function switchToFreshTenant(page: Page, tenantId: string, tenantName: string) {
  await page.goto('/dashboard');
  await page.evaluate(
    ({ id, name }) => {
      localStorage.setItem('managedTenantId', id);
      localStorage.setItem('managedTenantName', name);
    },
    { id: tenantId, name: tenantName }
  );
  await page.goto('/dashboard?tab=home');
  await page
    .getByRole('tab', { name: /^Home$/ })
    .first()
    .click();
  await page.waitForLoadState('networkidle');
}

test.describe('Setup wizard — Import from website step (browser click-path)', () => {
  test('owner scans their site in the wizard and sees answers saved', async ({ page, request }) => {
    // WHO: a new owner walking the setup wizard during onboarding.
    // WHAT: on the "Import from website" step they paste a URL, click Scan, and
    //       the step reports it extracted + saved answers from their site.
    // WHEN: the deterministic scan stub is active (CI).
    // WHERE: SetupWizard → Step7WebsiteScan → POST /knowledge/import-website.
    // WHY: the API + component layers are covered; this pins the real UI path an
    //       owner clicks, so a wizard-navigation or wiring regression is caught.
    test.skip(
      process.env.KNOWLEDGE_IMPORT_E2E_STUB !== '1',
      'wizard scan click-path requires KNOWLEDGE_IMPORT_E2E_STUB=1 (no live OpenAI/network)'
    );

    let tenant: RegisteredTenant | null = null;
    try {
      tenant = await registerFreshTenant(request);
      // Pre-seed one employee so canAdvanceTo(7) only needs the services the
      // picker will auto-seed. Resources/services stay empty → needsSetup stays
      // true → welcome auto-opens.
      await createEmployeeAs(request, tenant.token, tenant.tenantId, 'Wizard Tech');

      await switchToFreshTenant(page, tenant.tenantId, `Scan ${tenant.tenantId.slice(0, 6)}`);

      // Welcome auto-opens → start setup.
      await expect(page.getByRole('dialog', { name: /welcome/i })).toBeVisible({ timeout: 8000 });
      await page.getByRole('button', { name: /Let's go/i }).click();

      // Mode chooser → pick "I have a team" (the SetupWizard path whose step 7 is
      // the website scan; solo uses a different wizard).
      await expect(page.getByText('How is your business set up?')).toBeVisible({ timeout: 4000 });
      await page.getByRole('button', { name: /I have a team/i }).click();

      // Business-type picker → search to expand the lists, then pick the first
      // available type (its template auto-seeds services).
      await expect(page.getByPlaceholder('Search business types...')).toBeVisible({
        timeout: 4000,
      });
      await page.getByPlaceholder('Search business types...').fill('a');
      const firstType = page.getByTestId('wizard-biztype-option').first();
      await expect(firstType).toBeVisible({ timeout: 4000 });
      await firstType.click();

      // The wizard opens. Jump to the "Import from website" step via its chip
      // (enabled now that services + the seeded employee exist). Playwright waits
      // for the chip to become actionable while the seeded services load.
      const scanChip = page.getByRole('button', { name: /Import from website/i });
      await expect(scanChip).toBeEnabled({ timeout: 10000 });
      await scanChip.click();

      // The scan step body.
      await expect(page.getByText(/Import from your website/i)).toBeVisible({ timeout: 4000 });

      // Type a URL + scan.
      await page.getByPlaceholder('https://www.yourbusiness.com').fill('https://example-shop.com');
      await page.getByRole('button', { name: /Scan website & pre-fill answers/i }).click();

      // The stub extracts + saves the starter answers → success message.
      await expect(page.getByText(/extracted and saved/i)).toBeVisible({ timeout: 15000 });
    } finally {
      if (tenant) await cleanTenantData(pool, tenant.tenantId);
    }
  });
});
