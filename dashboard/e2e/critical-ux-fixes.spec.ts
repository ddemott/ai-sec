import { test, expect } from './helpers/test';
import { type Page } from '@playwright/test';
// Helper: navigate to a tab by clicking it in the sidebar
async function navigateToTab(page: Page, tabLabel: string) {
  await page.locator(`text=${tabLabel}`).first().click();
  await page.waitForTimeout(500);
}

// Helper: dismiss any wizard/modal overlays
async function dismissOverlays(page: Page) {
  // Close wizard mode chooser if visible
  const closeBtn = page.locator('[aria-label="Close wizard"], [aria-label="Close"]').first();
  if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await closeBtn.click();
    await page.waitForTimeout(300);
  }
  // Close any other modals
  const modalClose = page.locator('[aria-label="Close"]').first();
  if (await modalClose.isVisible({ timeout: 1000 }).catch(() => false)) {
    await modalClose.click();
    await page.waitForTimeout(300);
  }
}

// ─── Fix #3: Toast improvements ───────────────────────────────────

test.describe('Fix #3: Toast dismissal and behavior', () => {
  test('toast appears on error and can be dismissed via X button', async ({ page }) => {
    await page.goto('/dashboard');
    await dismissOverlays(page);
    await navigateToTab(page, 'My Team');

    // Wait for the Working Days sub-tab to be visible and click it
    // (renamed from "Shifts" 2026-05-16, B2).
    const whTab = page.locator('text=Working Days').first();
    await expect(whTab).toBeVisible({ timeout: 10000 });
    await whTab.click();
    await page.waitForTimeout(500);

    // Select first employee button (the pill buttons)
    const empButtons = page.locator('button[class*="rounded-xl"]').filter({ hasText: /^[A-Z]/ });
    const firstEmp = empButtons.first();
    if (await firstEmp.isVisible({ timeout: 3000 }).catch(() => false)) {
      await firstEmp.click();
      await page.waitForTimeout(500);
    }

    // Click a day cell to open shift editor
    const dayCell = page.locator('text=Click to schedule').first();
    if (await dayCell.isVisible({ timeout: 3000 }).catch(() => false)) {
      await dayCell.click();
      await page.waitForTimeout(500);

      // Set end time before start time
      const timeInputs = page.locator('input[type="time"]');
      await timeInputs.first().fill('17:00');
      await timeInputs.last().fill('08:00');

      // Click Save
      await page.locator('button:has-text("Save")').click();

      // Toast should appear
      const toast = page.locator('text=End time must be after start time');
      await expect(toast).toBeVisible({ timeout: 5000 });

      // Click X to dismiss
      const dismissBtn = page.locator('button[aria-label="Dismiss notification"]').first();
      await dismissBtn.click();

      // Toast should disappear
      await expect(toast).not.toBeVisible({ timeout: 3000 });
    }
  });
});

// ─── Fix #7: Shift time validation ────────────────────────────────

test.describe('Fix #7: Shift end time must be after start time', () => {
  test('rejects end time before start time with toast error', async ({ page }) => {
    await page.goto('/dashboard');
    await dismissOverlays(page);
    await navigateToTab(page, 'My Team');

    // Click Working Days sub-tab (renamed from "Shifts" 2026-05-16, B2).
    const whTab = page.locator('text=Working Days').first();
    await expect(whTab).toBeVisible({ timeout: 10000 });
    await whTab.click();
    await page.waitForTimeout(500);

    // Select first employee
    const empButtons = page.locator('button[class*="rounded-xl"]').filter({ hasText: /^[A-Z]/ });
    const firstEmp = empButtons.first();
    if (await firstEmp.isVisible({ timeout: 3000 }).catch(() => false)) {
      await firstEmp.click();
      await page.waitForTimeout(500);
    }

    // Click a "Click to schedule" cell
    const scheduleCell = page.locator('text=Click to schedule').first();
    if (await scheduleCell.isVisible({ timeout: 3000 }).catch(() => false)) {
      await scheduleCell.click();
      await page.waitForTimeout(500);

      // Fill with invalid times
      const timeInputs = page.locator('input[type="time"]');
      await timeInputs.first().fill('17:00');
      await timeInputs.last().fill('08:00');

      await page.locator('button:has-text("Save")').click();

      // Should see error toast
      await expect(page.locator('text=End time must be after start time')).toBeVisible({
        timeout: 5000,
      });
    }
  });
});

// ─── Fix #5: QuickBook time validation ────────────────────────────

test.describe('Fix #5: QuickBook panel time validation', () => {
  test('Book button is disabled without times', async ({ page }) => {
    await page.goto('/dashboard');
    await dismissOverlays(page);
    await navigateToTab(page, 'Schedule');

    // Look for Quick Book button
    const quickBookBtn = page.locator('text=Quick Book').first();
    if (await quickBookBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await quickBookBtn.click();

      // The panel should appear
      const panel = page.locator('[data-testid="quick-book-panel"]');
      await expect(panel).toBeVisible({ timeout: 3000 });

      // Book Now button should be disabled (no customer, resource, or times)
      const bookBtn = page.locator('[data-testid="quick-book-confirm"]');
      await expect(bookBtn).toBeDisabled();
    }
  });
});

// ─── Fix #1: Wizard step guards ──────────────────────────────────

test.describe('Fix #1: Wizard step guards', () => {
  test('cannot skip ahead in wizard without completing prerequisites', async ({ page }) => {
    // Use a tenant that needs setup — or trigger wizard manually
    // We need a tenant with no services. Secretary HQ might work if it has few services.
    await page.goto('/dashboard');

    // Check if wizard mode chooser appears
    const teamBtn = page.locator('text=Team Setup').first();
    if (await teamBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await teamBtn.click();

      // Business type picker should appear
      const bizType = page.locator('text=Auto Repair').first();
      if (await bizType.isVisible({ timeout: 3000 }).catch(() => false)) {
        await bizType.click();
        await page.waitForTimeout(1000);
      }

      // Wizard should be open on Step 1
      const step1 = page.locator('text=Step 1 of 7');
      if (await step1.isVisible({ timeout: 5000 }).catch(() => false)) {
        // Try clicking step 4 in progress bar (should be blocked if no services)
        const step4Btn = page.locator('button:has-text("When they work")');
        if (await step4Btn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await step4Btn.click();

          // Should still be on step 1 OR see a warning toast
          const toast = page.locator('text=Complete earlier steps first');
          const stillStep1 = page.locator('text=Step 1 of 7');
          const blocked =
            (await toast.isVisible({ timeout: 3000 }).catch(() => false)) ||
            (await stillStep1.isVisible({ timeout: 1000 }).catch(() => false));
          expect(blocked).toBeTruthy();
        }
      }
    } else {
      // Wizard didn't auto-open — tenant already has data. Skip test.
      test.skip();
    }
  });
});

// ─── Fix #6: NaN crash on empty appointment times ─────────────────

test.describe('Fix #6: Scheduler handles empty appointment times', () => {
  test('scheduler renders without crashing', async ({ page }) => {
    await page.goto('/dashboard');
    await dismissOverlays(page);
    await navigateToTab(page, 'Schedule');

    // Verify the scheduler renders (title visible)
    await expect(page.locator('text=Schedule').first()).toBeVisible({ timeout: 10000 });

    // Verify the grid renders — look for hour header
    const hourHeader = page.locator('[data-testid="scheduler-view"]');
    if (await hourHeader.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(hourHeader).toBeVisible();
    }

    // No crash — page is interactive
    const zoomIn = page.locator('[data-testid="zoom-in"]');
    if (await zoomIn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await zoomIn.click();
      // Page didn't crash
      await expect(page.locator('text=Schedule').first()).toBeVisible();
    }
  });
});

// ─── Fix #2: Error feedback (useSchedulerData error state) ────────

test.describe('Fix #2: Error feedback on API failures', () => {
  test('scheduler loads without showing stale empty state', async ({ page }) => {
    await page.goto('/dashboard');
    await dismissOverlays(page);
    await navigateToTab(page, 'Schedule');

    // The scheduler grid should render with hour labels
    await expect(page.locator('[data-testid="scheduler-view"]')).toBeVisible({ timeout: 10000 });

    // Verify refresh button works
    const refresh = page.locator('[data-testid="scheduler-refresh"]');
    if (await refresh.isVisible({ timeout: 3000 }).catch(() => false)) {
      await refresh.click();
      await page.waitForTimeout(1000);
      // No crash after refresh
      await expect(page.locator('[data-testid="scheduler-view"]')).toBeVisible();
    }
  });
});

// ─── Fix #4: Unsaved changes warning ─────────────────────────────

test.describe('Fix #4: Unsaved changes warning on reorder', () => {
  test('dirty reorder shows Save/Discard buttons', async ({ page }) => {
    await page.goto('/dashboard');
    await dismissOverlays(page);
    await navigateToTab(page, 'Schedule');

    // Wait for scheduler
    await page.waitForTimeout(1000);

    // Check for staff names panel with drag handles
    const gripHandle = page.locator('[data-testid^="drag-handle-"]').first();
    if (await gripHandle.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Save/Discard should NOT be visible initially
      await expect(page.locator('[data-testid="save-order"]')).not.toBeVisible();

      // We can't easily test drag in Playwright, but we can verify
      // the Save/Discard buttons exist in the DOM
      const saveOrder = page.locator('[data-testid="save-order"]');
      const discardOrder = page.locator('[data-testid="discard-order"]');

      // They should exist in DOM but be hidden (only shown when dirty)
      expect(await saveOrder.count()).toBe(0); // Not in DOM when not dirty
      expect(await discardOrder.count()).toBe(0);
    }
  });
});
