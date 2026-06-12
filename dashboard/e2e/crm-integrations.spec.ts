/**
 * E2E: the CRM Integrations settings UI after the competitor-CRM removal.
 *
 * WHY THIS EXISTS
 * 2026-06-12 removed Jobber/ServiceTitan/HubSpot (PR #11) — including their
 * cards in BusinessSettingsView. The sync orchestration is covered by
 * calendar-sync.spec.ts and the component has unit coverage, but nothing
 * proved the settings UI renders post-deletion: only Square remains, the three
 * removed providers are GONE, and the section doesn't crash (the error-boundary
 * watchdog in helpers/test guards the crash case). A regression that re-added a
 * removed provider's card, or broke the CRM section, would slip through without
 * this.
 *
 * Navigation: the CRM section lives in BusinessSettingsView, the
 * `business-settings` sub-tab of "My Business" (`setup`). `?tab=business-settings`
 * is transparently upgraded to `?tab=setup&subtab=business-settings`. Tests run
 * pre-authenticated as the platform admin via storageState.
 */
import { test, expect } from './helpers/test';

test.describe('CRM integrations settings (post competitor-CRM removal)', () => {
  test('shows the Square card and none of the removed competitor CRMs', async ({ page }) => {
    await page.goto('/dashboard?tab=business-settings');

    // The Square integration card renders (its description is unique to the card).
    await expect(
      page.getByText('Sync customers and bookings with your Square account.')
    ).toBeVisible({ timeout: 15000 });

    // The three removed competitor CRMs must NOT appear anywhere on the page.
    await expect(page.getByText('Jobber', { exact: false })).toHaveCount(0);
    await expect(page.getByText('HubSpot', { exact: false })).toHaveCount(0);
    await expect(page.getByText('ServiceTitan', { exact: false })).toHaveCount(0);
  });
});
