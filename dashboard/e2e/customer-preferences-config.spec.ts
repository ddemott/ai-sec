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
// The super-admin tenant this spec edits (auth.setup logs in as
// admin@secretaryhq.com). Scoping every write to it is the point — see afterAll.
const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000';

test.afterAll(async () => {
  // Reset ONLY the tenant this spec touched. This used to be an unconditional
  // `UPDATE tenants SET save_preferences_enabled = false,
  // preferences_instructions = NULL` with no WHERE clause — it reset the
  // preference config of EVERY tenant in the database, including any a
  // concurrently-developed spec had just set up. It is harmless today only
  // because playwright.config.ts pins `workers: 1` and `fullyParallel: false`;
  // the day anyone raises that for speed, this becomes a cross-spec data
  // corruption that presents as a flake somewhere else entirely. The house rule
  // is that a test owns its data and cleans up ITS OWN rows.
  await pool
    .query(
      `UPDATE tenants SET save_preferences_enabled = false, preferences_instructions = NULL
        WHERE tenant_id = $1`,
      [PLATFORM_TENANT_ID]
    )
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

  // Wait for the WRITE, not just the label. "Saved!" is UI state; the thing the
  // reload depends on is the update-config response having come back. Watching
  // the response makes the ordering explicit instead of inferred, and if the
  // save ever fails the test says so here rather than as a confusing empty
  // field two steps later.
  const saved = page.waitForResponse(
    (r) => /\/tenants\/.+\/update-config/.test(r.url()) && r.request().method() === 'POST',
    { timeout: 20000 }
  );
  await saveBtn.click();
  const saveRes = await saved;
  expect(saveRes.ok()).toBe(true);

  // Save flips the button to "Saved!" on success.
  await expect(page.getByRole('button', { name: /Saved!/i })).toBeVisible({ timeout: 10000 });

  // Prove the DB actually holds it before reloading. This spec has failed twice
  // in CI (2026-08-20, on two different PRs) with the toggle persisted and the
  // guidance coming back empty — so the interesting question is whether the
  // write landed or the read lost it. Asserting here splits those two cases
  // apart: a failure at this line is a WRITE bug, a failure after the reload is
  // a READ/render bug. The root cause is not yet proven either way; this makes
  // the next occurrence diagnostic instead of ambiguous.
  const stored = await pool.query<{ preferences_instructions: string | null }>(
    `SELECT preferences_instructions FROM tenants WHERE tenant_id = $1`,
    [PLATFORM_TENANT_ID]
  );
  expect(stored.rows[0]?.preferences_instructions).toBe(guidance);

  // Reload from scratch — re-fetches config from the backend/DB.
  await openAiPersona(page);

  await expect(page.getByRole('switch', { name: /save customer preferences/i })).toHaveAttribute(
    'aria-checked',
    'true'
  );
  await expect(page.getByTestId('preferences-instructions')).toHaveValue(guidance);
});
