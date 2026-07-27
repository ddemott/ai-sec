/**
 * E2E: a caller who only LEAVES A MESSAGE still becomes a customer the owner can
 * see — and the call is labelled by what the tool DID, not by what a model guessed.
 *
 * WHY THIS EXISTS (Camille, a real call on 2026-07-25): she rang the live line,
 * asked for help with groceries, gave her name, and left a message. The message
 * row landed. Production ended that day with ONE message and ZERO customers,
 * because take-message only ever ran `SELECT customer_id … LIMIT 1` and, on a
 * miss, wrote the row with customer_id NULL — only the BOOKING path had ever
 * created a customer. The owner had a callback to make and no lead record, and
 * she was a stranger again on her next call.
 *
 * The same call was then filed outcome='wrong_service' by the post-call LLM
 * classifier — true (groceries are not a service here) and an answer to a
 * different question, which erased the fact that a message was taken.
 *
 * Unit + realdb tests pin both fixes at the route and tracker level. Nothing
 * proved THE OWNER CAN SEE THE RESULT, which is the half that matters to them:
 * a lead that never renders is a message in a bottle.
 *
 * WHAT'S COVERED
 *   - POST /agent-tools/take-message (the real route, x-agent-secret) for a phone
 *     the tenant has NEVER seen creates a customers row and links the message to it.
 *   - That caller is VISIBLE in the Customers tab, by name.
 *   - The message itself is VISIBLE in Calls › Messages, with its text.
 *   - A voice session finalized with outcome='message' (what the agent's
 *     CallOutcomeTracker now sends, instead of leaving it to the classifier)
 *     renders as "Left a message" in Calls › Recent Calls — NOT "Wrong service".
 *
 * WHAT'S NOT
 *   - The agent choosing to call take_message (agent unit tests + the toolselect
 *     eval own that). Here the tool call is made directly, so the spec is
 *     deterministic; the WRITES and the RENDERING under test are the real ones.
 *
 * Mechanism mirrors voice-call-context.spec.ts: fresh tenant per test, real login
 * through the UI, cascade cleanup in finally.
 */
import { test, expect } from './helpers/test';
import { type Page, type APIRequestContext } from '@playwright/test';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import { BACKEND_URL, PG_URL, registerFreshTenant, cleanTenantData } from './helpers/fixtures';

// Her call, minus the name. The phone is deliberately one the fresh tenant has
// never seen — the whole point is the MISS path that used to write a NULL.
const CALLER_NAME = 'Camille Groceries';
const CALLER_PHONE = '+12624970001';
const MESSAGE_TEXT = 'Come and help me with the groceries';

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

test('a message-only caller becomes a visible customer, and the call reads "Left a message"', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const tenant = await registerFreshTenant(request);
  const callId = `e2e-msg-${Date.now()}`;
  try {
    // ── Act 1: the call starts, then the caller leaves a message ────────────
    // voice-session-start opens the row the Calls tab reads; take-message is the
    // rung under test. Both are the REAL agent-tools routes.
    const started = await postAgentTool(request, '/agent-tools/voice-session-start', {
      tenant_id: tenant.tenantId,
      call_id: callId,
      caller_phone: CALLER_PHONE,
    });
    expect(started.success, `voice-session-start must open the row: ${started.error ?? ''}`).toBe(
      true
    );

    const took = await postAgentTool(request, '/agent-tools/take-message', {
      tenant_id: tenant.tenantId,
      call_id: callId,
      caller_name: CALLER_NAME,
      caller_phone: CALLER_PHONE,
      message: MESSAGE_TEXT,
    });
    expect(took.success, `take-message must save: ${took.error ?? ''}`).toBe(true);

    // ── Assert the DB truth first (independent of any rendering) ────────────
    // THE REGRESSION: before 2026-07-27 this join returned a NULL customer_id and
    // the customers table stayed empty for a message-only caller.
    const linked = await pool.query<{
      customer_id: string | null;
      customer_name: string | null;
      phone: string | null;
    }>(
      `SELECT m.customer_id, c.name AS customer_name, c.phone
         FROM customer_messages m
         LEFT JOIN customers c ON c.customer_id = m.customer_id
        WHERE m.tenant_id = $1 AND m.call_id = $2`,
      [tenant.tenantId, callId]
    );
    expect(linked.rows).toHaveLength(1);
    expect(linked.rows[0].customer_id, 'the message must LINK to a customer row').not.toBeNull();
    expect(linked.rows[0].customer_name).toBe(CALLER_NAME);
    expect(linked.rows[0].phone).toBe(CALLER_PHONE);

    // ── Act 2: the call ends carrying the TOOL-RECORDED outcome ─────────────
    // 'message' is what CallOutcomeTracker.recordMessage() now sends. Before the
    // fix the tracker knew only booked/transferred, so this field arrived null and
    // the post-call LLM classifier's guess ('wrong_service' on the real call) won
    // by default.
    const ended = await postAgentTool(request, '/agent-tools/voice-session-end', {
      tenant_id: tenant.tenantId,
      call_id: callId,
      duration_seconds: 43,
      transcript: `Assistant: Thanks for calling!\nCaller: I need help with the groceries.\nAssistant: May I have your name, please?\nCaller: Camille.`,
      outcome: 'message',
    });
    expect(ended.success, `voice-session-end must finalize: ${ended.error ?? ''}`).toBe(true);

    const session = await pool.query<{ outcome: string | null }>(
      `SELECT outcome FROM voice_sessions WHERE tenant_id = $1 AND call_id = $2`,
      [tenant.tenantId, callId]
    );
    expect(session.rows[0]?.outcome, 'the tool outcome must be what is stored').toBe('message');

    // ── Assert the OWNER'S VIEW ─────────────────────────────────────────────
    await loginAsFreshTenant(page, tenant.email);
    await switchToTenant(page, tenant.tenantId, 'E2E Test');

    // (a) Customers tab — the lead exists and is findable by name.
    const customersTab = page.getByRole('tab', { name: /^Customers$/ }).first();
    await expect(customersTab).toBeVisible({ timeout: 15000 });
    await customersTab.click();
    await expect(page.getByText(CALLER_NAME).first()).toBeVisible({ timeout: 10000 });

    // (b) Calls › Messages — the message itself, in the owner's inbox.
    const callsTab = page.getByRole('tab', { name: /^Calls$/ }).first();
    await expect(callsTab).toBeVisible({ timeout: 15000 });
    await callsTab.click();
    await page.getByText('Messages', { exact: true }).first().click();
    await expect(page.getByText(MESSAGE_TEXT).first()).toBeVisible({ timeout: 10000 });

    // (c) Calls › Recent Calls — the outcome badge on THE CALL ROW reads
    //     "Left a message" (OUTCOME_LABELS.message), not the classifier's
    //     "Wrong service".
    //
    // Scoped to the row on purpose: the outcome FILTER is a <select> carrying
    // every label as a hidden <option>, so a bare getByText('Left a message')
    // matches an invisible option and a getByText('Wrong service') count of 0
    // can never hold. Asserting on the row is both the precise claim and the
    // one an owner would make — "the call in my list says X".
    await page.getByText('Recent Calls', { exact: true }).first().click();
    const callRow = page.getByRole('button', { name: /View call from/ }).first();
    await expect(callRow).toBeVisible({ timeout: 10000 });
    await expect(callRow).toContainText('Left a message');
    await expect(callRow).not.toContainText('Wrong service');
  } finally {
    await cleanTenantData(pool, tenant.tenantId);
  }
});
