/**
 * E2E: what the VOICE AGENT saves about a meeting is VISIBLE ON THE DASHBOARD —
 * with the caller's NAME and PHONE next to it.
 *
 * WHY THIS EXISTS (Dale's question, 2026-07-16): the meeting-goals rung writes real
 * rows — `Caller notes: …` / `Job details: …` onto appointments.description, and
 * job_inquiries.appointment_id linking the inquiry to the meeting. The sim proves the
 * DATABASE writes; nothing proved the OWNER CAN SEE THEM. "Saved" that never renders
 * is a message in a bottle — this spec is the missing half of the verification.
 *
 * WHAT'S COVERED
 *   - POST /agent-tools/attach-meeting-notes (the real route, x-agent-secret) lands on
 *     the appointment and the note is VISIBLE in the Schedule tab's appointment popover.
 *   - POST /agent-tools/capture-job-inquiry with appointment_id links the inquiry row
 *     (DB assert) and its "Job details:" summary is VISIBLE in the same popover.
 *   - The caller's NAME and formatted PHONE are visible right next to that context.
 *   - The popover headline stays the SERVICE line — the stamps must not garble it
 *     (splitCallContext contract, shared/callContext.ts).
 *
 * WHAT'S NOT
 *   - The voice booking itself (sim-taskgroup covers the whole call: live-LLM caller,
 *     real tools, DB-verified). Here the appointment is pre-seeded via the owner API so
 *     the spec stays deterministic; the agent-tools WRITES under test are the real ones.
 *
 * Mechanism mirrors appointment-cancel-ui.spec.ts: fresh tenant per test (isolation
 * memory), real login through the UI, Schedule > List, popover assertions, cascade
 * cleanup in finally.
 */
import { test, expect } from './helpers/test';
import { type Page, type APIRequestContext } from '@playwright/test';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  BACKEND_URL,
  PG_URL,
  registerFreshTenant,
  seedBookingScenario,
  seedAppointment,
  cleanTenantData,
} from './helpers/fixtures';

const CALLER_NAME = 'Priya Nowak';
const CALLER_PHONE = '+15559010123';
const CALLER_PHONE_PRETTY = '(555) 901-0123';
const NOTE_TEXT = 'Bring the COBOL migration assessment before the meeting';
const SERVICE_NAME = 'Programming Consultation';

function readAgentSecret(): string {
  if (process.env.AGENT_SECRET) return process.env.AGENT_SECRET;
  try {
    const envPath = join(__dirname, '..', '..', '.env');
    const content = readFileSync(envPath, 'utf8');
    const match = content.match(/^AGENT_SECRET=(.+)$/m);
    if (match) return match[1].trim();
  } catch {
    // fall through
  }
  throw new Error('AGENT_SECRET not found — needed to drive the /agent-tools/* routes');
}
const AGENT_SECRET = readAgentSecret();

let pool: Pool;

test.beforeAll(() => {
  pool = new Pool({ connectionString: PG_URL, max: 3 });
});
test.afterAll(async () => {
  await pool.end();
});

async function postAgentTool(
  req: APIRequestContext,
  path: string,
  body: Record<string, unknown>
): Promise<{ success: boolean; result?: Record<string, unknown>; error?: string }> {
  const res = await req.post(`${BACKEND_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', 'x-agent-secret': AGENT_SECRET },
    data: body,
  });
  expect(res.status(), `${path} must answer 200 (agent tools speak failure in-band)`).toBe(200);
  return res.json();
}

// Same login helper shape as appointment-cancel-ui.spec.ts — the registered owner
// logs in through the real UI, then the dashboard is switched to their tenant.
async function loginAsFreshTenant(page: Page, email: string) {
  await page.goto('/dashboard');
  await page.waitForTimeout(800);
  const loginLink = page.getByText('Log in', { exact: true }).first();
  if (await loginLink.isVisible({ timeout: 2000 }).catch(() => false)) {
    await loginLink.click();
    await page.waitForTimeout(400);
  }
  const emailInput = page.locator('input[type="email"]');
  if (await emailInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await emailInput.fill(email);
    await page.locator('input[type="password"]').fill('password123');
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(2000);
  }
  await expect(page.getByText('Home').first()).toBeVisible({ timeout: 15000 });
}

async function switchToTenant(page: Page, tenantId: string, tenantName: string) {
  await page.evaluate(
    ({ id, name }) => {
      localStorage.setItem('managedTenantId', id);
      localStorage.setItem('managedTenantName', name);
    },
    { id: tenantId, name: tenantName }
  );
  await page.reload();
  await expect(page.getByText('Home').first()).toBeVisible({ timeout: 15000 });
}

test('voice-saved notes + job summary show on the dashboard WITH the caller name and phone', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const tenant = await registerFreshTenant(request);
  try {
    // ── Arrange: a bookable shape + the CALLER as the customer ──────────────
    // Browser-LOCAL today, not UTC: the List view shows the scheduler's current
    // selectedDate (local `new Date()`), and during the evening US window UTC is
    // already tomorrow — the appointment-cancel-ui spec documents this exact flake.
    const date = new Date().toLocaleDateString('en-CA');
    const scenario = await seedBookingScenario(request, pool, tenant.token, tenant.tenantId, {
      shiftDates: [date],
    });

    // The caller the voice agent identified — their NAME and PHONE must surface on
    // the dashboard next to the meeting. Created via the real customers route.
    const custRes = await request.post(`${BACKEND_URL}/customers/create`, {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tenant.token}` },
      data: { tenant_id: tenant.tenantId, name: CALLER_NAME, phone: CALLER_PHONE },
    });
    expect(custRes.status()).toBe(200);
    const callerId = (await custRes.json()).customer.customer_id as string;

    // Direct row INSERT (same as the cancel-ui List test): the booking PATH is the
    // sim's job; this spec needs a deterministic appointment on the visible day.
    const apptId = await seedAppointment(pool, tenant.tenantId, {
      resourceId: scenario.resourceIds[0],
      customerId: callerId,
      employeeId: scenario.employeeIds[0],
      startTime: `${date}T14:00:00.000Z`,
      endTime: `${date}T14:30:00.000Z`,
      description: SERVICE_NAME,
    });
    expect(apptId).toBeTruthy();

    // ── Act: the REAL agent-tools writes the meeting-goals rung performs ────
    const noted = await postAgentTool(request, '/agent-tools/attach-meeting-notes', {
      tenant_id: tenant.tenantId,
      appointment_id: apptId,
      notes: NOTE_TEXT,
    });
    expect(noted.success, `attach-meeting-notes must save: ${noted.error ?? ''}`).toBe(true);

    const captured = await postAgentTool(request, '/agent-tools/capture-job-inquiry', {
      tenant_id: tenant.tenantId,
      caller_name: CALLER_NAME,
      callback_phone: CALLER_PHONE,
      caller_company: 'Insight Global',
      client_company: 'Blue Cross',
      represents_company: false,
      employment_type: 'contract',
      rate_range: '$65-82/hr',
      duration: '6 months',
      appointment_id: apptId,
    });
    expect(captured.success, `capture-job-inquiry must save: ${captured.error ?? ''}`).toBe(true);

    // ── Assert the DB truth first (the writes, independent of rendering) ────
    const desc = await pool.query<{ description: string }>(
      `SELECT description FROM appointments WHERE appointment_id = $1`,
      [apptId]
    );
    expect(desc.rows[0].description).toContain(`Caller notes: ${NOTE_TEXT}`);
    expect(desc.rows[0].description).toContain('Job details:');
    const link = await pool.query<{ appointment_id: string | null }>(
      `SELECT appointment_id FROM job_inquiries WHERE tenant_id = $1 AND callback_phone = $2`,
      [tenant.tenantId, CALLER_PHONE]
    );
    expect(link.rows[0]?.appointment_id, 'inquiry must link to THE meeting').toBe(apptId);

    // ── Assert the OWNER'S VIEW: Schedule > List > popover ──────────────────
    await loginAsFreshTenant(page, tenant.email);
    await switchToTenant(page, tenant.tenantId, 'E2E Test');
    await page
      .getByRole('tab', { name: /^Schedule$/ })
      .first()
      .click();

    await expect(page.getByTestId('day-mode-list')).toBeVisible({ timeout: 8000 });
    await page.getByTestId('day-mode-list').click();
    await expect(page.getByRole('button', { name: /Refresh/i }).first()).toBeVisible({
      timeout: 8000,
    });

    const row = page.getByTestId(`list-item-${apptId}`);
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.click();

    const popover = page.getByTestId('appointment-popover');
    await expect(popover).toBeVisible({ timeout: 8000 });

    // WHO the meeting is with — name and phone, right there.
    await expect(popover.getByText(CALLER_NAME)).toBeVisible();
    await expect(popover.getByText(CALLER_PHONE_PRETTY)).toBeVisible();

    // WHAT the caller said — both stamps, in the dedicated call-context block.
    const context = popover.getByTestId('popover-call-context');
    await expect(context).toBeVisible();
    await expect(context.getByText(`Caller notes: ${NOTE_TEXT}`)).toBeVisible();
    await expect(context.getByText(/Job details: contract, \$65-82\/hr, 6 months/)).toBeVisible();
    await expect(context.getByText(/Blue Cross via Insight Global/)).toBeVisible();

    // And the headline stays the SERVICE — the stamps must not garble it.
    await expect(
      popover.getByText(SERVICE_NAME, { exact: true }),
      'popover headline is the service line, not the stamped description'
    ).toBeVisible();

    if (process.env.SCREENSHOT_DIR) {
      await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/popover.png` });
    }
  } finally {
    await cleanTenantData(pool, tenant.tenantId);
  }
});
