import { test as setup, expect } from '@playwright/test';

/**
 * Login once and save auth state for all tests.
 */
setup('login as admin', async ({ page }) => {
  await page.goto('/dashboard');
  await page.waitForTimeout(2000);

  // Check if already logged in (dashboard visible)
  const alreadyLoggedIn = await page.locator('text=Home').first().isVisible({ timeout: 3000 }).catch(() => false);

  if (!alreadyLoggedIn) {
    // May have landed on the marketing page — click Log in if visible
    const loginLink = page.getByText('Log in', { exact: true }).first();
    if (await loginLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      await loginLink.click();
      await page.waitForTimeout(1000);
    }

    // Fill login form
    await page.locator('input[type="email"]').fill('daledemott@gmail.com');
    await page.locator('input[type="password"]').fill('password');
    await page.locator('button[type="submit"]').click();

    // Wait for dashboard to load
    await expect(page.locator('text=Home').first()).toBeVisible({ timeout: 15000 });
  }

  // Save auth state
  await page.context().storageState({ path: 'e2e/.auth/user.json' });
});
