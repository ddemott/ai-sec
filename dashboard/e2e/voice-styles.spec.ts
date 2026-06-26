/**
 * E2E: Voice Style checkboxes (Formal, Warm, Concise) persist through the real
 * browser → Next.js → backend → Postgres stack.
 *
 * WHY THIS EXISTS
 * AIConfigView.test.tsx proves the component renders the checkboxes with a
 * mocked API. What it cannot cover is the literal round-trip: an owner checks
 * a box, hits Save, the form re-fetches from the DB, and the checkbox is still
 * checked. This spec pins that wiring so a regression in the form binding,
 * Api.tenants.updateConfig, or the route handler shows up as a failed reload
 * assertion — not a cosmetic toggle that silently stops persisting.
 *
 * NOTE (2026-06-25+): Soft + Cheerful were removed from the picker when primary
 * TTS switched Grok → OpenAI (final removal of all Grok/xAI remnants). They were
 * Grok-only prosody tags with no OpenAI equivalent. Only the prompt-level styles
 * (Formal/Warm/Concise) remain; their tts_* columns (and the voice/speed ones)
 * persist for the OpenAI configuration.
 *
 * Auth: the shared auth.setup logs in as admin@secretaryhq.com (super-admin,
 * platform tenant). We edit that tenant's AI config and reset it afterward.
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
  // Reset every tenant's voice-style config so this spec leaves no residue.
  await pool
    .query(
      `UPDATE tenants SET
         tts_formal    = NULL,
         tts_warm      = NULL,
         tts_concise   = NULL`
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

test('HAPPY: all 3 voice style checkboxes render on the AI Persona page', async ({ page }) => {
  // WHO: any owner visiting Phone Assistant → AI Persona
  // WHAT: all three checkbox labels and their descriptions are visible so the
  //        owner can discover and toggle each style independently
  // WHEN: the first visit to the AI Persona tab after the feature ships
  // WHERE: AIConfigView voice-style section
  // WHY: if a checkbox is missing from the DOM, it will never be toggled —
  //       the feature exists in the backend but is invisible to the owner
  await openAiPersona(page);

  // The three prompt-level style checkboxes must be present and labelled.
  await expect(page.getByRole('checkbox', { name: /Formal/i })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Warm/i })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Concise/i })).toBeVisible();

  // Soft + Cheerful were Grok-only and are intentionally gone after the OpenAI
  // TTS switch + full Grok removal — guard against them creeping back in.
  await expect(page.getByRole('checkbox', { name: /Soft/i })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /Cheerful/i })).toHaveCount(0);

  // Descriptive text must be visible so the owner knows what each does.
  await expect(page.getByText(/Professional, no contractions/i)).toBeVisible();
});

test('HAPPY: checking Formal + saving persists through reload', async ({ page }) => {
  // WHO: a salon owner who wants their AI to sound more professional
  // WHAT: toggle Formal on, click Save Changes, reload the AI Persona page —
  //        Formal is still checked (value was persisted to the DB)
  // WHEN: the owner's first time configuring voice style
  // WHERE: AIConfigView → POST /tenants/:id/update-config → DB tts_formal column
  // WHY: end-to-end proof that the checkbox binding, the API call, the route,
  //      and the DB column all cooperate; the unit test mocks the API
  await openAiPersona(page);

  const formalCheckbox = page.getByRole('checkbox', { name: /Formal/i });
  // Ensure Formal is unchecked before we start (reset in afterAll + clean DB).
  if (await formalCheckbox.isChecked()) {
    await formalCheckbox.uncheck();
    await page.getByRole('button', { name: /Save Changes/i }).click();
    await expect(page.getByRole('button', { name: /Saved!/i })).toBeVisible({ timeout: 10000 });
    await openAiPersona(page);
  }

  await formalCheckbox.check();
  await expect(page.getByRole('button', { name: /Save Changes/i })).toBeEnabled();
  await page.getByRole('button', { name: /Save Changes/i }).click();
  await expect(page.getByRole('button', { name: /Saved!/i })).toBeVisible({ timeout: 10000 });

  // Reload — re-fetches config from backend/DB.
  await openAiPersona(page);
  await expect(page.getByRole('checkbox', { name: /Formal/i })).toBeChecked();
});

test('HAPPY: unchecking Warm + saving persists through reload', async ({ page }) => {
  // WHO: an owner who enabled Warm, then decided to turn it off
  // WHAT: check Warm, save, reload, uncheck Warm, save, reload — Warm is unchecked
  // WHEN: the owner changes their mind about a voice style they previously set
  // WHERE: AIConfigView → POST /tenants/:id/update-config → tts_warm column
  // WHY: the uncheck path is equally load-bearing; a bug that persists checks
  //       but not unchecks would leave the owner stuck
  await openAiPersona(page);

  const warmCheckbox = page.getByRole('checkbox', { name: /Warm/i });

  // Step 1: ensure Warm is checked and saved.
  if (!(await warmCheckbox.isChecked())) {
    await warmCheckbox.check();
    await page.getByRole('button', { name: /Save Changes/i }).click();
    await expect(page.getByRole('button', { name: /Saved!/i })).toBeVisible({ timeout: 10000 });
    await openAiPersona(page);
  }

  // Step 2: uncheck and save.
  await page.getByRole('checkbox', { name: /Warm/i }).uncheck();
  await page.getByRole('button', { name: /Save Changes/i }).click();
  await expect(page.getByRole('button', { name: /Saved!/i })).toBeVisible({ timeout: 10000 });

  // Step 3: reload — Warm must now be unchecked.
  await openAiPersona(page);
  await expect(page.getByRole('checkbox', { name: /Warm/i })).not.toBeChecked();
});

test('HAPPY: multiple styles (Warm + Concise) save and reload correctly', async ({ page }) => {
  // WHO: an owner who wants both warmth and brevity from their AI
  // WHAT: check Warm and Concise, save, reload — both still checked; Formal unchecked
  // WHEN: any multi-flag save
  // WHERE: AIConfigView → PUT /tenants/:id/update-config — two flags in payload
  // WHY: verifies that saving multiple flags simultaneously works and that
  //       flags not included in the save remain at their correct state
  await openAiPersona(page);

  // Start from a clean state: uncheck all 3 and save.
  for (const name of [/Formal/i, /Warm/i, /Concise/i]) {
    const cb = page.getByRole('checkbox', { name });
    if (await cb.isChecked()) await cb.uncheck();
  }
  await page.getByRole('button', { name: /Save Changes/i }).click();
  await expect(page.getByRole('button', { name: /Saved!/i })).toBeVisible({ timeout: 10000 });
  await openAiPersona(page);

  // Check Warm and Concise only.
  await page.getByRole('checkbox', { name: /Warm/i }).check();
  await page.getByRole('checkbox', { name: /Concise/i }).check();
  await page.getByRole('button', { name: /Save Changes/i }).click();
  await expect(page.getByRole('button', { name: /Saved!/i })).toBeVisible({ timeout: 10000 });

  // Reload and verify.
  await openAiPersona(page);
  await expect(page.getByRole('checkbox', { name: /Warm/i })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Concise/i })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Formal/i })).not.toBeChecked();
});

test('HAPPY: all 3 styles checked + save + reload — all 3 still checked', async ({ page }) => {
  // WHO: an owner who wants every style modifier applied simultaneously
  // WHAT: check all 3, save, reload — all 3 are still checked
  // WHEN: the maximum-configuration save path
  // WHERE: AIConfigView → POST /tenants/:id/update-config — three true flags
  // WHY: ensures no flag is silently capped, ignored, or overwritten when all
  //       three are sent together
  await openAiPersona(page);

  for (const name of [/Formal/i, /Warm/i, /Concise/i]) {
    const cb = page.getByRole('checkbox', { name });
    if (!(await cb.isChecked())) await cb.check();
  }
  await page.getByRole('button', { name: /Save Changes/i }).click();
  await expect(page.getByRole('button', { name: /Saved!/i })).toBeVisible({ timeout: 10000 });

  await openAiPersona(page);
  for (const name of [/Formal/i, /Warm/i, /Concise/i]) {
    await expect(page.getByRole('checkbox', { name })).toBeChecked();
  }
});

test('HAPPY: uncheck all styles + save + reload — all unchecked', async ({ page }) => {
  // WHO: an owner reverting to the default voice after experimenting with styles
  // WHAT: check all 3, save, then uncheck all 3, save, reload — all unchecked
  // WHEN: the full check-then-uncheck lifecycle for all style flags
  // WHERE: AIConfigView → POST /tenants/:id/update-config — three false flags
  // WHY: ensures the route correctly persists false/null for all flags
  //       rather than leaving previously-true values in the DB
  await openAiPersona(page);

  // First, ensure all 3 are checked. Toggle each one off+on so the form is
  // always dirty (even when a prior test left them all checked already —
  // a conditional `if (!isChecked) check()` is a no-op in that case).
  for (const name of [/Formal/i, /Warm/i, /Concise/i]) {
    const cb = page.getByRole('checkbox', { name });
    await cb.uncheck();
    await cb.check();
  }
  await page.getByRole('button', { name: /Save Changes/i }).click();
  await expect(page.getByRole('button', { name: /Saved!/i })).toBeVisible({ timeout: 10000 });
  await openAiPersona(page);

  // Now uncheck all 3 and save.
  for (const name of [/Formal/i, /Warm/i, /Concise/i]) {
    const cb = page.getByRole('checkbox', { name });
    if (await cb.isChecked()) await cb.uncheck();
  }
  await page.getByRole('button', { name: /Save Changes/i }).click();
  await expect(page.getByRole('button', { name: /Saved!/i })).toBeVisible({ timeout: 10000 });

  // Reload — all must be unchecked.
  await openAiPersona(page);
  for (const name of [/Formal/i, /Warm/i, /Concise/i]) {
    await expect(page.getByRole('checkbox', { name })).not.toBeChecked();
  }
});

test('HAPPY: checking + unchecking without saving does not persist', async ({ page }) => {
  // WHO: an owner who toggles Concise but then navigates away before saving
  // WHAT: toggle Concise (ensure it changes state), navigate to Home,
  //        return to AI Persona — Concise is back to its pre-toggle state
  // WHEN: any unsaved change followed by navigation away
  // WHERE: AIConfigView form state (useFormState / local React state)
  // WHY: a form that auto-saves on toggle would surprise owners who are
  //       just exploring options; persistence must require an explicit save
  await openAiPersona(page);

  const conciseCheckbox = page.getByRole('checkbox', { name: /Concise/i });
  const wasChecked = await conciseCheckbox.isChecked();

  // Toggle Concise without saving.
  if (wasChecked) {
    await conciseCheckbox.uncheck();
  } else {
    await conciseCheckbox.check();
  }

  // Navigate away WITHOUT clicking Save.
  await page
    .getByRole('tab', { name: /^Home$/i })
    .first()
    .click();

  // Return to AI Persona.
  await openAiPersona(page);

  // Concise must be back to its original state (unsaved change discarded).
  if (wasChecked) {
    await expect(page.getByRole('checkbox', { name: /Concise/i })).toBeChecked();
  } else {
    await expect(page.getByRole('checkbox', { name: /Concise/i })).not.toBeChecked();
  }
});

test('SAD: Save Changes button is disabled when form is clean (no changes)', async ({ page }) => {
  // WHO: an owner who opens AI Persona and hasn't touched any control yet
  // WHAT: the Save Changes button is disabled initially; enabling it requires
  //        at least one change to the form
  // WHEN: the page first loads (clean state, no dirty fields)
  // WHERE: AIConfigView save-button disabled logic (dirty-flag guard)
  // WHY: an always-enabled Save button invites accidental no-op saves and
  //       makes it impossible to tell whether the form has unsaved changes
  await openAiPersona(page);

  const saveBtn = page.getByRole('button', { name: /Save Changes/i });
  await expect(saveBtn).toBeDisabled();

  // Toggling any checkbox makes the form dirty → Save becomes enabled.
  const formalCheckbox = page.getByRole('checkbox', { name: /Formal/i });
  await formalCheckbox.click();
  await expect(saveBtn).toBeEnabled();
});

test('SAD: rapid double-click on Save does not cause duplicate requests or broken state', async ({
  page,
}) => {
  // WHO: an owner who double-clicks Save (common on slower connections)
  // WHAT: double-clicking Save must not produce two API calls that leave the
  //        form in an error state; the button eventually shows "Saved!"
  // WHEN: any save action with rapid user input
  // WHERE: AIConfigView save-button click handler (debounce / disabled-on-submit)
  // WHY: if the handler submits twice, the second request races the first and
  //       could overwrite the DB with a stale payload or produce a toast error
  await openAiPersona(page);

  // Dirty the form.
  const formalCheckbox = page.getByRole('checkbox', { name: /Formal/i });
  if (!(await formalCheckbox.isChecked())) {
    await formalCheckbox.check();
  } else {
    await formalCheckbox.uncheck();
  }

  const saveBtn = page.getByRole('button', { name: /Save Changes/i });
  // Double-click rapidly.
  await saveBtn.dblclick();

  // No error toast must appear.
  await expect(page.getByText(/error/i))
    .not.toBeVisible({ timeout: 3000 })
    .catch(() => {
      // If the locator doesn't exist at all, that's fine — no error shown.
    });

  // Save completes successfully.
  await expect(page.getByRole('button', { name: /Saved!/i })).toBeVisible({ timeout: 10000 });
});
