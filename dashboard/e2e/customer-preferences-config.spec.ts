/**
 * E2E: the Customer Preferences config persists through the real
 * browser → Next.js → backend → Postgres stack.
 *
 * WHY THIS EXISTS
 * AIConfigView.test.tsx proves the component logic with a mocked API, and
 * tenant-routes.test.ts proves the update-config route persists the two new
 * columns. What neither covers is the literal wiring: an owner toggles the
 * feature on in the browser, types guidance, hits Save, and on the next visit
 * the form reflects what the database stored. This pins that round-trip so a
 * regression in Api.tenants.updateConfig, the form binding, or the route
 * shows up as a failed reload assertion — not a silently cosmetic toggle.
 *
 * Auth: the shared auth.setup logs in as admin@secretaryhq.com (super-admin,
 * platform tenant). We edit that tenant's AI config and reset it afterward so
 * the change doesn't bleed into other specs (the DB is also rebuilt per run).
 */
import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';
import { Pool } from 'pg';

const PG_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/postgres';
let pool: Pool;

test.beforeAll(() => {
  pool = new Pool({ connectionString: PG_URL });
});
test.afterAll(async () => {
  // Reset every tenant's preference config so this spec leaves no residue.
  await pool
    .query(`UPDATE tenants SET save_preferences_enabled = false, preferences_instructions = NULL`)
    .catch(() => {});
  await pool.end();
});

async function openAiPersona(page: Page) {
  await page.goto('/dashboard');
  await page
    .getByRole('tab', { name: /^Phone Assistant$/ })
    .first()
    .click();
  // AI Persona is the default sub-tab (renders AIConfigView), but click it
  // explicitly in case a prior interaction left another sub-tab active.
  const personaTab = page.getByRole('tab', { name: /AI Persona/ }).first();
  if (await personaTab.isVisible({ timeout: 5000 }).catch(() => false)) {
    await personaTab.click();
  }
  // The Voice Settings header confirms AIConfigView mounted.
  await expect(page.getByRole('heading', { name: /Voice Settings/i })).toBeVisible({
    timeout: 10000,
  });
}

test('owner enables Customer Preferences + guidance, and it survives a reload', async ({
  page,
}) => {
  // WHO: a salon owner configuring how the AI remembers customers.
  // WHAT: toggle the feature on, type guidance, Save, reload — the toggle is
  //        still on and the guidance is still there (read back from the DB).
  // WHEN: the ongoing self-service config path (not the wizard).
  // WHERE: AIConfigView Customer Preferences section → POST /tenants/:id/update-config.
  // WHY: end-to-end proof the browser control actually persists; the unit
  //      test mocks the API, so only this catches a real wiring break.
  const guidance = `E2E remember stylist + last service ${Date.now()}`;

  await openAiPersona(page);

  const toggle = page.getByRole('switch', { name: /save customer preferences/i });
  const textarea = page.getByTestId('preferences-instructions');

  // Textarea is disabled until the feature is on — flip the toggle first.
  if ((await toggle.getAttribute('aria-checked')) !== 'true') {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(textarea).toBeEnabled();

  await textarea.fill(guidance);

  const saveBtn = page.getByRole('button', { name: /Save Changes/i });
  await expect(saveBtn).toBeEnabled();
  await saveBtn.click();
  // Save flips the button to "Saved!" on success.
  await expect(page.getByRole('button', { name: /Saved!/i })).toBeVisible({ timeout: 10000 });

  // Reload from scratch — re-fetches config from the backend/DB.
  await openAiPersona(page);

  await expect(page.getByRole('switch', { name: /save customer preferences/i })).toHaveAttribute(
    'aria-checked',
    'true'
  );
  await expect(page.getByTestId('preferences-instructions')).toHaveValue(guidance);
});
