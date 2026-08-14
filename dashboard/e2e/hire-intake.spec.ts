/**
 * E2E: hire-intake writes the owner can actually see.
 *
 * WHY (2026-08-13 browser call, Jack Smith): "a position I had for him that's
 * in Chicago" + "talk to y'all" landed as take_message only. Zero job_inquiries
 * row. The selector miss is pinned in agent unit/journey tests. This spec proves
 * BOTH writes the host can still make — message fallback AND a real job capture
 * with position/contract role text — reach the owner's inbox.
 *
 * WHAT'S COVERED
 *   - POST /agent-tools/take-message with the live-call position wording →
 *     Calls › Messages shows the text.
 *   - POST /agent-tools/capture-job-inquiry with role_description = position +
 *     employment_type = contract → Calls › Messages shows the job lead.
 *   - SAD: capture without a role still saves (declined role is honest).
 *
 * WHAT'S NOT
 *   - The LLM picking `job` vs `message` (non-deterministic; agent prompt
 *     pins + toolselect eval).
 */
import { test, expect } from './helpers/test';
import { type Page, type APIRequestContext } from '@playwright/test';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import { BACKEND_URL, PG_URL, registerFreshTenant, cleanTenantData } from './helpers/fixtures';

const POSITION_MESSAGE = "I have a position for him that's in Chicago.";
const CONTRACT_ROLE = 'contract React position in Chicago';

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

async function openMessagesInbox(page: Page) {
  const callsTab = page.getByRole('tab', { name: /^Calls$/ }).first();
  await expect(callsTab).toBeVisible({ timeout: 15000 });
  await callsTab.click();
  await page.getByText('Messages', { exact: true }).first().click();
}

test('message fallback: a position left as a note is visible in Messages', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const tenant = await registerFreshTenant(request);
  const callId = `e2e-hire-msg-${Date.now()}`;
  try {
    const started = await postAgentTool(request, '/agent-tools/voice-session-start', {
      tenant_id: tenant.tenantId,
      call_id: callId,
      caller_phone: '+16301112222',
    });
    expect(started.success, started.error ?? '').toBe(true);

    const took = await postAgentTool(request, '/agent-tools/take-message', {
      tenant_id: tenant.tenantId,
      call_id: callId,
      caller_name: 'Jack Smith',
      caller_phone: '+16301112222',
      message: POSITION_MESSAGE,
    });
    expect(took.success, took.error ?? '').toBe(true);

    const row = await pool.query<{ message: string }>(
      `SELECT message FROM customer_messages WHERE tenant_id = $1 AND call_id = $2`,
      [tenant.tenantId, callId]
    );
    expect(row.rows[0]?.message).toBe(POSITION_MESSAGE);

    await loginAsFreshTenant(page, tenant.email);
    await switchToTenant(page, tenant.tenantId, 'E2E Test');
    await openMessagesInbox(page);
    await expect(page.getByText(POSITION_MESSAGE).first()).toBeVisible({ timeout: 10000 });
  } finally {
    await cleanTenantData(pool, tenant.tenantId);
  }
});

test('job capture: a position/contract role is a visible job lead, not just a message', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const tenant = await registerFreshTenant(request);
  const callId = `e2e-hire-job-${Date.now()}`;
  try {
    const captured = await postAgentTool(request, '/agent-tools/capture-job-inquiry', {
      tenant_id: tenant.tenantId,
      call_id: callId,
      caller_name: 'Jack Smith',
      callback_phone: '+16301113333',
      caller_company: 'Northgate',
      represents_company: true,
      employment_type: 'contract',
      role_description: CONTRACT_ROLE,
      rate_range: '$80/hr',
      duration: '6 months',
      location_type: 'remote',
      timezone: 'America/Chicago',
    });
    expect(captured.success, captured.error ?? '').toBe(true);

    const row = await pool.query<{
      role_description: string | null;
      employment_type: string;
    }>(
      `SELECT role_description, employment_type FROM job_inquiries
        WHERE tenant_id = $1 AND callback_phone = $2`,
      [tenant.tenantId, '+16301113333']
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].role_description).toBe(CONTRACT_ROLE);
    expect(row.rows[0].employment_type).toBe('contract');

    await loginAsFreshTenant(page, tenant.email);
    await switchToTenant(page, tenant.tenantId, 'E2E Test');
    await openMessagesInbox(page);
    await expect(page.getByText(/job lead/i).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(CONTRACT_ROLE).first()).toBeVisible({ timeout: 10000 });
  } finally {
    await cleanTenantData(pool, tenant.tenantId);
  }
});

test('SAD: capture without a role still saves — an honest blank beats a dropped lead', async ({
  request,
}) => {
  test.setTimeout(60_000);
  const tenant = await registerFreshTenant(request);
  try {
    const captured = await postAgentTool(request, '/agent-tools/capture-job-inquiry', {
      tenant_id: tenant.tenantId,
      caller_name: 'Rita Contract',
      callback_phone: '+15551112233',
      caller_company: 'Apex',
      represents_company: true,
      employment_type: 'contract',
    });
    expect(captured.success, captured.error ?? '').toBe(true);

    const row = await pool.query<{ role_description: string | null }>(
      `SELECT role_description FROM job_inquiries
        WHERE tenant_id = $1 AND caller_name = $2`,
      [tenant.tenantId, 'Rita Contract']
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].role_description == null || row.rows[0].role_description === '').toBe(true);
  } finally {
    await cleanTenantData(pool, tenant.tenantId);
  }
});
