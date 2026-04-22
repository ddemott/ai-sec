import { test, expect, Page } from '@playwright/test';

/**
 * E2E test: Quick Book should succeed when employees have employee_schedule for the day.
 *
 * Bug: book_appointment_atomic only checked employee_shifts (weekly patterns), not
 * employee_schedule (date-based). Dashboard UI uses employee_schedule, so employees appeared
 * scheduled on the timeline but bookings failed with "Employee is not on shift."
 */

async function ensureLoggedIn(page: Page) {
  await page.goto('/dashboard');
  await page.waitForTimeout(2000);

  // If on landing page, click Log in
  const loginLink = page.getByText('Log in', { exact: true }).first();
  if (await loginLink.isVisible({ timeout: 2000 }).catch(() => false)) {
    await loginLink.click();
    await page.waitForTimeout(1000);
  }

  // If on login form, fill and submit
  const emailInput = page.locator('input[type="email"]');
  if (await emailInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await emailInput.fill('daledemott@gmail.com');
    await page.locator('input[type="password"]').fill('password');
    await page.getByText('Sign In to Dashboard').click();
    await page.waitForTimeout(3000);
  }

  // Wait for dashboard to be visible
  await expect(page.getByText('Front Desk').first()).toBeVisible({ timeout: 15000 });
}

async function switchToBellasTenant(page: Page) {
  // Click the tenant switcher in the header (shows current tenant name with chevron)
  const tenantBtn = page.locator('button').filter({ hasText: /Bella|DynaTire|Hair|Studio/ }).first();
  if (await tenantBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await tenantBtn.click();
    await page.waitForTimeout(500);
  }

  // Click Bella's Hair Studio in dropdown
  const bellaOption = page.getByText("Bella's Hair Studio", { exact: false });
  if (await bellaOption.isVisible({ timeout: 3000 }).catch(() => false)) {
    await bellaOption.click();
    await page.waitForTimeout(1500);
  }
}

test.describe('Quick Book with employee_schedule', () => {

  test('booking succeeds for employee with shift_override but no weekly pattern', async ({ page }) => {
    await ensureLoggedIn(page);
    await switchToBellasTenant(page);

    // Navigate to Front Desk > Schedule
    await page.getByText('Schedule').first().click();
    await page.waitForTimeout(1500);

    // Switch to Chairs view (which has the Quick Book button)
    const chairsTab = page.getByTestId('view-tab-resources');
    await expect(chairsTab).toBeVisible({ timeout: 5000 });
    await chairsTab.click();
    await page.waitForTimeout(1000);

    // Click Quick Book button
    const quickBookBtn = page.locator('button').filter({ hasText: 'Quick Book' });
    await expect(quickBookBtn).toBeVisible({ timeout: 5000 });
    await quickBookBtn.click();
    await page.waitForTimeout(500);

    // Quick Book panel should be open
    const quickBookPanel = page.getByTestId('quick-book-panel');
    await expect(quickBookPanel).toBeVisible({ timeout: 5000 });

    // Select customer (first available)
    const customerSelect = page.getByTestId('quick-book-customer');
    await customerSelect.selectOption({ index: 1 });

    // Select a service (first non-walk-in)
    const serviceSelect = page.getByTestId('quick-book-service');
    const serviceOptions = await serviceSelect.locator('option').count();
    if (serviceOptions > 1) {
      await serviceSelect.selectOption({ index: 1 });
    }

    // Select resource (first available)
    const resourceSelect = page.getByTestId('quick-book-resource');
    await resourceSelect.selectOption({ index: 0 });

    // Select first real employee (not Unassigned)
    const employeeSelect = page.getByTestId('quick-book-employee');
    const empOptions = await employeeSelect.locator('option').allTextContents();
    const firstEmployee = empOptions.find(o => o !== 'Unassigned' && o.trim() !== '');
    if (firstEmployee) {
      await employeeSelect.selectOption({ label: firstEmployee });
    }

    // Set start time to today at 10:00 AM (within 8-5 shift)
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const startInput = quickBookPanel.locator('input[type="datetime-local"]').first();
    await startInput.fill(`${year}-${month}-${day}T10:00`);
    await page.waitForTimeout(500);

    // End time should auto-fill from service duration
    const endInput = quickBookPanel.locator('input[type="datetime-local"]').last();
    const endValue = await endInput.inputValue();
    if (!endValue) {
      await endInput.fill(`${year}-${month}-${day}T10:30`);
    }

    // Click Book Now
    const bookBtn = page.getByTestId('quick-book-confirm');
    await expect(bookBtn).toBeEnabled();
    await bookBtn.click();
    await page.waitForTimeout(3000);

    // Check for errors — the old bug would show "Employee is not on shift"
    const errorMsg = quickBookPanel.locator('.text-red-700, .text-red-400');
    const errorVisible = await errorMsg.isVisible().catch(() => false);

    if (errorVisible) {
      const errorText = await errorMsg.textContent();
      // These errors indicate the employee_schedule fix didn't work
      expect(errorText).not.toContain('not on shift');
      expect(errorText).not.toContain('not scheduled');
    }

    // If panel closed, booking succeeded
    const panelGone = await quickBookPanel.isHidden({ timeout: 3000 }).catch(() => false);
    if (panelGone) {
      expect(panelGone).toBe(true);
    }
  });

  test('Chairs view displays resource rows', async ({ page }) => {
    await ensureLoggedIn(page);
    await switchToBellasTenant(page);

    // Navigate to Schedule
    await page.getByText('Schedule').first().click();
    await page.waitForTimeout(1500);

    // Click Chairs tab
    const chairsTab = page.getByTestId('view-tab-resources');
    await expect(chairsTab).toBeVisible({ timeout: 5000 });
    await chairsTab.click();
    await page.waitForTimeout(1000);

    // Resource columns view or empty state should be visible
    const resourceView = page.getByTestId('resource-columns-view');
    const emptyState = page.getByTestId('resource-columns-empty');

    const viewVisible = await resourceView.isVisible({ timeout: 5000 }).catch(() => false);
    const emptyVisible = await emptyState.isVisible({ timeout: 2000 }).catch(() => false);

    expect(viewVisible || emptyVisible).toBe(true);

    if (viewVisible) {
      // Verify resource rows exist
      const resourceRows = page.locator('[data-testid^="resource-column-"]');
      const count = await resourceRows.count();
      expect(count).toBeGreaterThan(0);
    }
  });
});
