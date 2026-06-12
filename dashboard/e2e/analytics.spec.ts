/**
 * E2E: the Analytics view (gap #2).
 *
 * WHY THIS EXISTS
 * gap #2 replaced three hardcoded "Phase 2 / Requires call log integration"
 * stub panels in AnalyticsView with REAL data wired to /analytics/calls
 * (Call Volume, Booking Conversion, Caller Abandonment + a WHY outcome
 * breakdown). The backend route + the React component have unit coverage, but
 * nothing proved the tab loads in a browser, mounts, renders real call data,
 * and no longer shows the stub text. This is that proof — and the
 * error-boundary watchdog in helpers/test fails the test if the view throws.
 *
 * APPROACH
 * The seeded admin tenant has no calls, so AnalyticsView would show its global
 * "No data yet" empty state (no panels). To exercise the REAL panels we seed a
 * couple of voice_sessions via /agent-tools/voice-session-start for the admin
 * tenant (the same agent-secret pattern as auth-flows / calendar-sync specs),
 * then assert the call panels render. Cleaned up after.
 *
 * Navigation: Analytics is the "Analytics" sub-tab (role="tab") inside
 * "Phone Assistant" (main tab id `ai-insights`). Tests run pre-authenticated as
 * the platform admin (tenant 0000…0000) via storageState.
 */
import { test, expect } from './helpers/test';
import { request } from '@playwright/test';
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const BACKEND_URL = process.env.BACKEND_URL ?? 'https://localhost:4001';
const PG_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/postgres';
const ADMIN_TENANT = '00000000-0000-0000-0000-000000000000';

function readAgentSecret(): string {
  if (process.env.AGENT_SECRET) return process.env.AGENT_SECRET;
  try {
    const content = readFileSync(join(__dirname, '../../.env'), 'utf8');
    const match = content.match(/^AGENT_SECRET=(.+)$/m);
    if (match) return match[1].trim();
  } catch {
    /* fall through */
  }
  throw new Error('AGENT_SECRET not found in .env or process.env — needed to seed calls');
}

const AGENT_SECRET = readAgentSecret();
// Unique call ids so we only clean up what we created.
const CALL_IDS = [`e2e-analytics-${Date.now()}-a`, `e2e-analytics-${Date.now()}-b`];

test.beforeAll(async () => {
  // Seed two logged calls for the admin tenant so the call panels have data.
  const ctx = await request.newContext({ ignoreHTTPSErrors: true });
  for (const callId of CALL_IDS) {
    await ctx.post(`${BACKEND_URL}/agent-tools/voice-session-start`, {
      headers: { 'x-agent-secret': AGENT_SECRET, 'content-type': 'application/json' },
      data: { tenant_id: ADMIN_TENANT, call_id: callId, caller_phone: '+16305550000' },
    });
  }
  await ctx.dispose();
});

test.afterAll(async () => {
  // Remove only the rows we created (the E2E DB is ephemeral, but be tidy).
  const c = new Client({ connectionString: PG_URL });
  await c.connect();
  await c.query('DELETE FROM voice_sessions WHERE tenant_id = $1 AND call_id = ANY($2)', [
    ADMIN_TENANT,
    CALL_IDS,
  ]);
  await c.end();
});

test.describe('Analytics view (gap #2)', () => {
  test('renders the real call panels and no longer shows the Phase-2 stubs', async ({ page }) => {
    await page.goto('/dashboard?tab=ai-insights');

    // Open the Analytics sub-tab (FolderTab renders role="tab").
    const analyticsTab = page.getByRole('tab', { name: 'Analytics' }).first();
    await expect(analyticsTab).toBeVisible({ timeout: 15000 });
    await analyticsTab.click();

    // The view mounted (header renders — not the global empty state, since we
    // seeded calls; and not the error boundary, which helpers/test also guards).
    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible({ timeout: 15000 });

    // The real call panels render.
    await expect(page.getByText('Call Volume')).toBeVisible();
    await expect(page.getByText('Booking Conversion')).toBeVisible();
    await expect(page.getByText('Caller Abandonment')).toBeVisible();
    await expect(page.getByText('Why Callers Reached Out')).toBeVisible();

    // The retired stub phrasing must be gone — its presence = a regression to
    // the pre-gap-#2 placeholders.
    await expect(page.getByText('Requires call log integration')).toHaveCount(0);
    await expect(page.getByText('Coming in Phase 2')).toHaveCount(0);
  });
});
