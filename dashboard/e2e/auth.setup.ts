import { test as setup, expect } from '@playwright/test';

/**
 * Login once and save auth state for all tests.
 */
setup('login as admin', async ({ page }) => {
  await page.goto('/dashboard');

  // Check if already logged in (dashboard visible)
  const alreadyLoggedIn = await page.locator('text=Home').first().isVisible({ timeout: 5000 }).catch(() => false);

  if (!alreadyLoggedIn) {
    // Fill login form
    await page.locator('input[type="email"]').fill('dale@ai-sec.com');
    await page.locator('input[type="password"]').fill('password');
    await page.locator('button[type="submit"]').click();

    // Wait for dashboard to load
    await expect(page.locator('text=Home').first()).toBeVisible({ timeout: 15000 });
  }

  // Save auth state
  await page.context().storageState({ path: 'e2e/.auth/user.json' });
});
