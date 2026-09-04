/**
 * Shared navigation + save helpers for the Phone Assistant → AI Persona page.
 *
 * WHY THIS EXISTS (T-007 — the `voice-styles` / `customer-preferences-config` flake)
 *
 * Both specs drove this form, both kept their own copy of `openAiPersona`, and
 * both intermittently reddened `main` with the same shape of failure: the save
 * returns 200, the button says "Saved!", and after the reload the value is gone
 * (`voice-styles`, CI run 33203910276, 2026-08-28: `toBeChecked()` → "unexpected
 * value unchecked"; `customer-preferences-config`, 2026-08-20, twice: toggle
 * persisted, guidance came back empty).
 *
 * The cause is NOT slowness. It is that the specs and the browser disagreed
 * about WHICH TENANT was being edited:
 *
 *   - The form writes to `useActiveTenantId()` = `managedTenantId || tenantId`.
 *   - For a super-admin, `managedTenantId` is empty on a fresh session, and
 *     `useSuperAdminTenants` then AUTO-SELECTS `tenantsArray[0]` and persists it
 *     (lib/useSuperAdminTenants.ts:80-84).
 *   - So the page edits whichever tenant happens to sort first — observed here
 *     as `d5e3c6a1…` (Thinking Hammer), NOT the platform tenant.
 *   - Both specs hard-coded the PLATFORM tenant for their reset and their DB
 *     assertions. They were resetting and reading a different row than the
 *     browser was writing.
 *
 * It passed as often as it did only because the resets were unqualified
 * `UPDATE tenants SET …` with no WHERE clause, which happened to clear the real
 * row too. Whether the auto-select lands before or after AIConfigView's first
 * `fetchConfig()` is a timing question — hence flaky, and hence worse on a
 * loaded CI runner. (Proven locally: with the reset correctly scoped to the
 * platform tenant, the save POSTed to `d5e3c6a1…/update-config` and the platform
 * row was still NULL immediately afterwards.)
 *
 * So these helpers do three things the per-spec copies did not:
 *   1. PIN the managed tenant before the page loads, so the tenant under test is
 *      chosen by the test rather than by a list ordering.
 *   2. Wait on the config GET, and assert it was for the pinned tenant — a
 *      session editing the wrong business now fails here, by name.
 *   3. Assert the Save button is ENABLED before clicking, and wait on the POST
 *      response rather than the "Saved!" label.
 */
import { expect } from './test';
import type { Page } from '@playwright/test';

/** The super-admin's own tenant (auth.setup logs in as admin@secretaryhq.com). */
export const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000';

const CONFIG_GET = (url: string) => /\/tenants\/([^/]+)\/config(\?|$)/.exec(url);
const CONFIG_POST = (url: string) => /\/tenants\/[^/]+\/update-config/.test(url);

/**
 * Navigate to Phone Assistant → AI Persona for `tenantId`, and return only once
 * the form is populated from THAT tenant's server data.
 */
export async function openAiPersona(
  page: Page,
  tenantId: string = PLATFORM_TENANT_ID
): Promise<void> {
  // Pin the managed tenant BEFORE any navigation. Without this, a super-admin
  // session with no selection auto-selects tenantsArray[0], and the form edits
  // a business the test never intended to touch. Init scripts run before page
  // scripts on every navigation, so this survives the reloads below.
  await page.addInitScript((id) => {
    localStorage.setItem('managedTenantId', id as string);
    localStorage.setItem('managedTenantName', 'E2E pinned tenant');
  }, tenantId);

  // Armed BEFORE navigating: a fast response must not land before we listen.
  const configLoaded = page.waitForResponse(
    (r) => !!CONFIG_GET(r.url()) && r.request().method() === 'GET',
    { timeout: 20_000 }
  );

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

  // The Voice Settings header confirms AIConfigView mounted...
  await expect(page.getByRole('heading', { name: /Voice Settings/i })).toBeVisible({
    timeout: 10_000,
  });

  // ...and this confirms the form holds SERVER data for the tenant we pinned.
  // Naming the tenant here is the whole point: a wrong-tenant session used to
  // surface three steps later as a value that "didn't persist".
  const res = await configLoaded;
  const loadedTenantId = CONFIG_GET(res.url())?.[1];
  expect(
    loadedTenantId,
    'AI Persona loaded a different tenant than the test pinned — the form would ' +
      'read and write that other business, and every DB assertion below would be ' +
      'about the wrong row'
  ).toBe(tenantId);

  // A second, later fetchConfig() (tenantId settling) calls setConfig(server) and
  // setDirty(false), silently discarding whatever the test types next. Waiting
  // for the network to go quiet closes that window.
  await page.waitForLoadState('networkidle');
}

/**
 * Click Save Changes and return only once the write has actually come back 2xx.
 *
 * Asserting the button is ENABLED first is load-bearing: it is
 * `disabled={!dirty}`, so an enabled button proves React registered the edit.
 * Without it, a toggle that never reached component state (a `check()` that
 * no-ops on an already-checked box, an edit clobbered by a late refetch) sails
 * through the save and only surfaces as a wrong value after the reload.
 */
export async function saveAiPersona(page: Page): Promise<void> {
  const saveBtn = page.getByRole('button', { name: /Save Changes/i });
  await expect(saveBtn).toBeEnabled();

  const saved = page.waitForResponse(
    (r) => CONFIG_POST(r.url()) && r.request().method() === 'POST',
    { timeout: 20_000 }
  );
  await saveBtn.click();
  const res = await saved;
  expect(res.ok()).toBe(true);

  // Save flips the button label to "Saved!" on success.
  await expect(page.getByRole('button', { name: /Saved!/i })).toBeVisible({ timeout: 10_000 });
}
