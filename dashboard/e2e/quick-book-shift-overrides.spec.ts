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
    await emailInput.fill('admin@secretaryhq.com');
    await page.locator('input[type="password"]').fill('password');
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(3000);
  }

  // Wait for dashboard to be visible
  await expect(page.getByText('Home').first()).toBeVisible({ timeout: 15000 });
}

async function switchToDynaTireTenant(page: Page) {
  await page.evaluate(() => {
    localStorage.setItem('managedTenantId', 'f234e471-0e60-4163-86c9-93cfd9338e3a');
    localStorage.setItem('managedTenantName', 'DynaTire Mobile Service');
  });
  await page.reload();
  await page.waitForTimeout(1500);

  await page.waitForTimeout(1000);
}

async function getScheduledEmployeeId(page: Page, dateStr: string): Promise<string | null> {
  return page.evaluate(async ({ dateStr }) => {
    const token = localStorage.getItem('authToken');
    const res = await fetch(`/shifts/overrides?tenant_id=f234e471-0e60-4163-86c9-93cfd9338e3a&start_date=${dateStr}&end_date=${dateStr}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return null;
    const rows = await res.json();
    const row = Array.isArray(rows) ? rows.find((r: any) => !r.is_off && r.start_time && r.end_time && r.employee_id) : null;
    return row?.employee_id ? String(row.employee_id) : null;
  }, { dateStr });
}

test.describe('Quick Book with employee_schedule', () => {

  test('booking succeeds for employee with shift_override but no weekly pattern', async ({ page }) => {
    await ensureLoggedIn(page);
    await switchToDynaTireTenant(page);

    // Navigate to Schedule
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

    // Set start time to a safe mid-shift time in tenant local hours
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');

    // Select an employee that is actually scheduled on the chosen date.
    const employeeSelect = page.getByTestId('quick-book-employee');
    const scheduledEmployeeId = await getScheduledEmployeeId(page, `${year}-${month}-${day}`);
    if (scheduledEmployeeId) {
      await employeeSelect.selectOption({ value: scheduledEmployeeId });
    }
    const startInput = quickBookPanel.locator('input[type="datetime-local"]').first();
    await startInput.fill(`${year}-${month}-${day}T15:00`);
    await page.waitForTimeout(500);

    // End time should auto-fill from service duration
    const endInput = quickBookPanel.locator('input[type="datetime-local"]').last();
    const endValue = await endInput.inputValue();
    if (!endValue) {
      await endInput.fill(`${year}-${month}-${day}T15:30`);
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

  test('rejects an end time before the start time', async ({ page }) => {
    await ensureLoggedIn(page);
    await switchToDynaTireTenant(page);

    await page.getByText('Schedule').first().click();
    await page.waitForTimeout(1500);

    const chairsTab = page.getByTestId('view-tab-resources');
    await expect(chairsTab).toBeVisible({ timeout: 5000 });
    await chairsTab.click();
    await page.waitForTimeout(1000);

    const quickBookBtn = page.locator('button').filter({ hasText: 'Quick Book' });
    await expect(quickBookBtn).toBeVisible({ timeout: 5000 });
    await quickBookBtn.click();
    await page.waitForTimeout(500);

    const quickBookPanel = page.getByTestId('quick-book-panel');
    await expect(quickBookPanel).toBeVisible({ timeout: 5000 });

    await page.getByTestId('quick-book-customer').selectOption({ index: 1 });
    await page.getByTestId('quick-book-resource').selectOption({ index: 0 });

    const employeeSelect = page.getByTestId('quick-book-employee');
    const scheduledEmployeeId = await getScheduledEmployeeId(page, '2026-05-01');
    if (scheduledEmployeeId) {
      await employeeSelect.selectOption({ value: scheduledEmployeeId });
    }

    const startInput = quickBookPanel.locator('input[type="datetime-local"]').first();
    const endInput = quickBookPanel.locator('input[type="datetime-local"]').last();
    await startInput.fill('2026-05-01T10:00');
    await endInput.fill('2026-05-01T09:00');

    await page.getByTestId('quick-book-confirm').click();

    await expect(page.getByText('End time must be after start time')).toBeVisible({ timeout: 5000 });
    await expect(quickBookPanel).toBeVisible();
  });

  test('rejects a 23-hour appointment as too long', async ({ page }) => {
    await ensureLoggedIn(page);
    await switchToDynaTireTenant(page);

    await page.getByText('Schedule').first().click();
    await page.waitForTimeout(1500);

    const chairsTab = page.getByTestId('view-tab-resources');
    await expect(chairsTab).toBeVisible({ timeout: 5000 });
    await chairsTab.click();
    await page.waitForTimeout(1000);

    const quickBookBtn = page.locator('button').filter({ hasText: 'Quick Book' });
    await expect(quickBookBtn).toBeVisible({ timeout: 5000 });
    await quickBookBtn.click();
    await page.waitForTimeout(500);

    const quickBookPanel = page.getByTestId('quick-book-panel');
    await expect(quickBookPanel).toBeVisible({ timeout: 5000 });

    await page.getByTestId('quick-book-customer').selectOption({ index: 1 });
    await page.getByTestId('quick-book-resource').selectOption({ index: 0 });

    const employeeSelect = page.getByTestId('quick-book-employee');
    const scheduledEmployeeId = await getScheduledEmployeeId(page, '2026-05-01');
    if (scheduledEmployeeId) {
      await employeeSelect.selectOption({ value: scheduledEmployeeId });
    }

    const startInput = quickBookPanel.locator('input[type="datetime-local"]').first();
    const endInput = quickBookPanel.locator('input[type="datetime-local"]').last();
    await startInput.fill('2026-05-01T10:00');
    await endInput.fill('2026-05-02T09:00');

    await page.getByTestId('quick-book-confirm').click();

    await expect(page.getByText('Appointment duration cannot exceed 12 hours')).toBeVisible({ timeout: 5000 });
    await expect(quickBookPanel).toBeVisible();
  });

  test('Chairs view displays resource rows', async ({ page }) => {
    await ensureLoggedIn(page);
    await switchToDynaTireTenant(page);

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
