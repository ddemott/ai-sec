import { test, expect } from './helpers/test';
import { type Page } from '@playwright/test';
/**
 * Full functional audit of SecretaryHQ dashboard.
 * Tests every major feature end-to-end and logs what's broken or incomplete.
 */

const issues: string[] = [];

function logIssue(area: string, description: string) {
  const msg = `[${area}] ${description}`;
  issues.push(msg);
  console.log(`⚠️  ${msg}`);
}

async function navigateToTab(page: Page, tabLabel: string) {
  await page.locator(`text=${tabLabel}`).first().click();
  await page.waitForTimeout(1000);
}

// ─── LOGIN ──────────────────────────────────────────────────────

test.describe.serial('Full Functional Audit', () => {

  test('1. Login flow', async ({ page }) => {
    await page.goto('/dashboard');

    // Should see dashboard (already logged in from setup)
    const home = page.locator('text=Home').first();
    if (await home.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Already logged in
    } else {
      logIssue('LOGIN', 'Dashboard did not load — may need fresh login');
    }
  });

  // ─── FRONT DESK: HOME ──────────────────────────────────────────

  test('2. Dashboard Home', async ({ page }) => {
    await page.goto('/dashboard');

    // Admin lands on All Businesses — switch to a tenant first to see the home dashboard
    const tenantBtn = page.getByTestId('tenant-card-00000000-0000-0000-0000-000000000000');
    if (await tenantBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await tenantBtn.click();
      await page.waitForTimeout(1000);
    }

    // Navigate to Home tab
    const homeTab = page.getByRole('tab', { name: /^Home$/i });
    if (await homeTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await homeTab.click();
      await page.waitForTimeout(1000);
    }

    // Should show greeting
    const greeting = page.locator('text=/Good (morning|afternoon|evening)/');
    if (!await greeting.isVisible({ timeout: 5000 }).catch(() => false)) {
      logIssue('HOME', 'No greeting visible — dashboard home may not be loading');
    }

    // Should show Today's Schedule card
    const scheduleCard = page.locator('text=/Today|Schedule/i').first();
    if (!await scheduleCard.isVisible({ timeout: 3000 }).catch(() => false)) {
      logIssue('HOME', 'Today\'s Schedule card not visible');
    }

    // Check for week view
    const weekView = page.locator('text=/Mon|Tue|Wed|Thu|Fri/').first();
    if (!await weekView.isVisible({ timeout: 3000 }).catch(() => false)) {
      logIssue('HOME', 'Week view not rendering');
    }
  });

  // ─── FRONT DESK: SCHEDULE ────────────────────────────────────

  test('3. Front Desk Scheduler', async ({ page }) => {
    await page.goto('/dashboard');
    await navigateToTab(page, 'Schedule');

    // Should show SCHEDULE header
    const header = page.locator('text=Schedule').first();
    await expect(header).toBeVisible({ timeout: 10000 });

    // Check for staff tab (default view)
    const staffTab = page.locator('[data-testid="view-tab-staff"]');
    if (await staffTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await staffTab.click();
      await page.waitForTimeout(500);
    }

    // Hour header should render
    const hourHeader = page.locator('[data-testid="hour-header"]');
    if (!await hourHeader.isVisible({ timeout: 5000 }).catch(() => false)) {
      logIssue('SCHEDULER', 'Hour header not rendering in staff view');
    }

    // Zoom controls
    const zoomIn = page.locator('[data-testid="zoom-in"]');
    if (await zoomIn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await zoomIn.click();
      // No crash
    } else {
      logIssue('SCHEDULER', 'Zoom controls not visible');
    }

    // Date navigation
    const dateNav = page.locator('text=Today');
    if (await dateNav.isVisible({ timeout: 2000 }).catch(() => false)) {
      await dateNav.click();
    } else {
      logIssue('SCHEDULER', 'Date navigation Today button missing');
    }

    // Refresh button
    const refresh = page.locator('[data-testid="scheduler-refresh"]');
    if (await refresh.isVisible({ timeout: 2000 }).catch(() => false)) {
      await refresh.click();
      await page.waitForTimeout(1000);
    }

    // Check other view tabs (Staff, Resources, List, Calendar)
    for (const tab of ['resources', 'list', 'calendar']) {
      const tabBtn = page.locator(`[data-testid="view-tab-${tab}"]`);
      if (await tabBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await tabBtn.click();
        await page.waitForTimeout(500);
        // Verify no crash
        await expect(page.locator('text=Schedule').first()).toBeVisible();
      } else {
        logIssue('SCHEDULER', `View tab "${tab}" not visible`);
      }
    }
    // Switch back to staff view
    const staffBtn = page.locator('[data-testid="view-tab-staff"]');
    if (await staffBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await staffBtn.click();
    }
  });

  // ─── FRONT DESK: CUSTOMERS ───────────────────────────────────

  test('4. CRM / Customers', async ({ page }) => {
    await page.goto('/dashboard');
    await navigateToTab(page, 'Customers');

    // Should show customer list or empty state
    const heading = page.locator('text=/Customer|CRM/i').first();
    if (!await heading.isVisible({ timeout: 10000 }).catch(() => false)) {
      logIssue('CRM', 'Customer view did not load');
    }

    // Search box
    const search = page.locator('input[placeholder*="Search"], input[placeholder*="search"]').first();
    if (await search.isVisible({ timeout: 3000 }).catch(() => false)) {
      await search.fill('nonexistent-customer-xyz');
      await page.waitForTimeout(500);
      // Should show "no results" or empty list
      const noResults = page.locator('text=/No customers match|No customers/i');
      if (!await noResults.isVisible({ timeout: 3000 }).catch(() => false)) {
        logIssue('CRM', 'No "no results" message when searching for nonexistent customer');
      }
      await search.clear();
    } else {
      logIssue('CRM', 'Search input not visible');
    }

    // Add customer button
    const addBtn = page.getByRole('button', { name: /Add Customer|New Customer/i }).first();
    if (!await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      logIssue('CRM', 'Add customer button not visible');
    }
  });

  // ─── FRONT DESK: CALLS ───────────────────────────────────────

  test('5. Voice Calls', async ({ page }) => {
    await page.goto('/dashboard');
    await navigateToTab(page, 'Calls');

    // Should show Voice Calls header
    const heading = page.locator('text=Voice Calls');
    if (!await heading.isVisible({ timeout: 10000 }).catch(() => false)) {
      logIssue('CALLS', 'Voice Calls view did not load');
    }

    // Call History section (includes count, e.g., "Call History (0)")
    const history = page.locator('text=/Call History/');
    if (!await history.isVisible({ timeout: 3000 }).catch(() => false)) {
      logIssue('CALLS', 'Call History section not visible');
    }

    // Outcome filter (we added this)
    const filter = page.locator('select').first();
    if (await filter.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Verify it has options
      const options = await filter.locator('option').count();
      if (options < 2) {
        logIssue('CALLS', 'Outcome filter has no options');
      }
    } else {
      logIssue('CALLS', 'Outcome filter dropdown not visible');
    }
  });

  // ─── BACK OFFICE: SERVICES & RESOURCES ───────────────────────

  test('6. My Business', async ({ page }) => {
    await page.goto('/dashboard');
    await navigateToTab(page, 'My Business');

    await page.waitForTimeout(1000);

    // Should show service catalog heading
    const services = page.locator('text=/Service Catalog|SERVICE CATALOG/i').first();
    if (!await services.isVisible({ timeout: 10000 }).catch(() => false)) {
      logIssue('SERVICES', 'Service Catalog section did not load');
    }

    // Service Wizard link
    const wizard = page.locator('text=/Service Wizard|Setup Wizard/i').first();
    if (!await wizard.isVisible({ timeout: 3000 }).catch(() => false)) {
      logIssue('SERVICES', 'Service Wizard link not visible');
    }

    // Verify at least one service card is visible (or empty state)
    const serviceCard = page.locator('text=/Follow-Up Call|In-Person Meeting|Phone Consultation|No services yet|No services/i').first();
    if (!await serviceCard.isVisible({ timeout: 3000 }).catch(() => false)) {
      logIssue('SERVICES', 'No service cards or empty state visible');
    }
  });

  // ─── BACK OFFICE: STAFF & SHIFTS ─────────────────────────────

  test('7. My Team', async ({ page }) => {
    await page.goto('/dashboard');
    await navigateToTab(page, 'My Team');

    await page.waitForTimeout(1000);

    // Should show Staff heading
    const staff = page.locator('text=/STAFF|Staff/').first();
    if (!await staff.isVisible({ timeout: 10000 }).catch(() => false)) {
      logIssue('STAFF', 'Staff view did not load');
    }

    const teamTabs = page.getByRole('tablist', { name: /Team sections/i });

    // Check sub-tabs: Staff, Shifts, Skill Matrix, Skill Map
    for (const sub of [/Staff|Employees/i, /Shifts/i, /Skill Matrix/i, /Skill Map/i]) {
      const subTab = teamTabs.getByRole('tab', { name: sub }).first();
      if (await subTab.isVisible({ timeout: 2000 }).catch(() => false)) {
        await subTab.click();
        await page.waitForTimeout(500);
        // No crash
      } else {
        logIssue('STAFF', `Sub-tab "${sub}" not visible`);
      }
    }

    // Go to the Working Days tab and verify shift management.
    const shiftsTab = teamTabs.getByRole('tab', { name: /Working Days/i }).first();
    if (await shiftsTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await shiftsTab.click();
      await page.waitForTimeout(500);

      // Employee selector should show
      const empSelector = page.locator('[data-testid="shift-employee-selector"]');
      if (!await empSelector.isVisible({ timeout: 3000 }).catch(() => false)) {
        logIssue('SHIFTS', 'Employee selector not visible in Shifts view');
      }
    }
  });

  // ─── BACK OFFICE: AI & KNOWLEDGE ─────────────────────────────

  test('8. Phone Assistant', async ({ page }) => {
    await page.goto('/dashboard');
    await navigateToTab(page, 'Phone Assistant');

    await page.waitForTimeout(1000);

    // Should show knowledge base or AI tab
    const heading = page.locator('text=/Knowledge|AI|Persona/i').first();
    if (!await heading.isVisible({ timeout: 10000 }).catch(() => false)) {
      logIssue('AI', 'Phone Assistant view did not load');
    }
  });

  // ─── THEME SWITCHER ──────────────────────────────────────────

  test('9. Theme switching', async ({ page }) => {
    await page.goto('/dashboard');

    // Find theme selector
    const themeSelect = page.locator('select').filter({ hasText: /Navy|Dark|Light|Nord/i }).first();
    if (await themeSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Switch to a different theme
      await themeSelect.selectOption({ index: 1 });
      await page.waitForTimeout(500);
      // No crash — theme applied
    } else {
      logIssue('THEME', 'Theme selector not found');
    }
  });

  // ─── URL TAB NAVIGATION ──────────────────────────────────────

  test('10. URL-based tab navigation', async ({ page }) => {
    // Navigate directly to schedule tab via URL
    await page.goto('/dashboard?tab=schedule');
    await page.waitForTimeout(2000);

    const scheduleHeader = page.locator('text=Schedule').first();
    if (!await scheduleHeader.isVisible({ timeout: 5000 }).catch(() => false)) {
      logIssue('NAVIGATION', 'URL param ?tab=schedule did not navigate to Schedule tab');
    }

    // Navigate to customers via URL
    await page.goto('/dashboard?tab=customers');
    await page.waitForTimeout(2000);

    const crmHeader = page.locator('text=/Customer|CRM/i').first();
    if (!await crmHeader.isVisible({ timeout: 5000 }).catch(() => false)) {
      logIssue('NAVIGATION', 'URL param ?tab=customers did not navigate to CRM tab');
    }
  });

  // ─── REPORT ──────────────────────────────────────────────────

  test('11. Final Report', async () => {
    console.log('\n' + '='.repeat(60));
    console.log('FUNCTIONAL AUDIT REPORT');
    console.log('='.repeat(60));

    if (issues.length === 0) {
      console.log('\n✅ All functional checks passed — no issues found.\n');
    } else {
      console.log(`\n❌ Found ${issues.length} issue(s):\n`);
      issues.forEach((issue, i) => {
        console.log(`  ${i + 1}. ${issue}`);
      });
      console.log('');
    }

    console.log('='.repeat(60) + '\n');

    // This test always passes — it's just the report
    expect(true).toBe(true);
  });
});
