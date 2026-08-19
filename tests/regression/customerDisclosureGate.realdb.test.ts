/**
 * SECURITY REGRESSION — a caller who merely CLAIMS a phone number learns nothing.
 *
 * THE ORIGINAL LEAK (2026-07-12, mine): on a forwarded line there is no caller-ID,
 * so the agent asks the caller to say their number. That number is a CLAIM, not a
 * credential — anyone can say anyone's number. We then looked them up and read back
 * their name, their preferences and their call history. A stranger who knew Camille's
 * number could ring the shop and be told who she is and what she last had done.
 *
 * THE INCOMPLETE FIX (2026-07-13, also mine): I gated `identify-caller` and stopped.
 * But the LLM decides which tool to call, and `get_customer_context` takes a phone
 * number straight from the model. So identify_caller would correctly refuse... and
 * the very next tool call fetched the same data through an ungated sibling. A gate on
 * one of three doors is not a gate. It was found by review, not by exploitation, and
 * it never shipped to a live customer.
 *
 * THE RULE, now enforced server-side in ONE place (callerMayHearCustomerData):
 *   carrier-attested caller-ID → nothing to prove.
 *   spoken number             → prove possession by SMS code first, or hear nothing.
 *
 * Enumerated, because the failure mode is "we forgot a door":
 *   /agent-tools/identify-caller
 *   /agent-tools/customer-context
 *   /agent-tools/customer-history
 *
 * A new disclosure route MUST be added to this list and to the gate. If you are here
 * because you added one and this file didn't fail, that is the bug.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { type Client, Pool } from 'pg';
import { ROOT_DB_URL, getRootClient, createTenant, skipIfDbDown } from '../utils';
import { createWithTenantClient } from '../../src/database';
import { registerAgentToolRoutes } from '../../src/routes/agentTools';

const SECRET = 'test-agent-secret';
const VICTIM_PHONE = '+16305550134';
const VICTIM_NAME = 'Camille Rousseau';

let setup: Client;
let pool: Pool;
let app: FastifyInstance;
let dbAvailable = false;
let tenantId: string;
const tenantsToClean: string[] = [];

async function post(url: string, payload: unknown) {
  return app.inject({ method: 'POST', url, headers: { 'x-agent-secret': SECRET }, payload });
}

beforeAll(async () => {
  process.env.AGENT_SECRET = SECRET;
  try {
    setup = await getRootClient();
    await setup.query('SELECT 1');
    pool = new Pool({ connectionString: ROOT_DB_URL, max: 5 });
    dbAvailable = true;
  } catch {
    dbAvailable = false;
    return;
  }
  app = Fastify({ logger: false });
  registerAgentToolRoutes(app, pool, createWithTenantClient(pool), (async () => []));
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
  if (setup) {
    for (const id of tenantsToClean) {
      await setup.query('DELETE FROM tenants WHERE tenant_id = $1', [id]).catch(() => {});
    }
    await setup.end();
  }
});

beforeEach(async (ctx) => {
  skipIfDbDown(ctx, () => dbAvailable);
  if (!dbAvailable) return;
  tenantId = await createTenant(setup, `Gate ${Date.now()}`, 'salon');
  tenantsToClean.push(tenantId);

  // A real, returning customer with something worth stealing.
  await setup.query(
    `INSERT INTO customers (tenant_id, phone, name) VALUES ($1, $2, $3)`,
    [tenantId, VICTIM_PHONE, VICTIM_NAME]
  );
  const { rows } = await setup.query<{ customer_id: string }>(
    `SELECT customer_id FROM customers WHERE tenant_id = $1 AND phone = $2`,
    [tenantId, VICTIM_PHONE]
  );
  await setup.query(
    `INSERT INTO customer_preferences (tenant_id, customer_id, pref_key, pref_value)
     VALUES ($1, $2, 'preferred_stylist', 'Maria')`,
    [tenantId, rows[0].customer_id]
  );
});

/**
 * Mark the number as having proved possession ON A GIVEN CALL — what
 * verify_phone_code does. `call_id` is load-bearing: a verification that is not
 * bound to a call can never open the gate (see migration 20260714000000).
 */
async function markVerified(callId: string) {
  await setup.query(
    `INSERT INTO phone_verifications (tenant_id, phone, code_hash, expires_at, verified_at, call_id)
     VALUES ($1, $2, 'x', now() + interval '10 min', now(), $3)`,
    [tenantId, VICTIM_PHONE, callId]
  );
}

describe('SECURITY: spoken phone numbers must prove possession before we disclose anything', () => {
  // ── The attack, against each door ───────────────────────────────────────────

  it('SAD: identify-caller reveals nothing for an unverified SPOKEN number', async () => {
    // WHO: a stranger on the forwarded line who knows Camille's number.
    // WHY: the number is a claim. Until proven, her name/preferences stay ours.
    const res = await post('/agent-tools/identify-caller', {
      tenant_id: tenantId,
      phone: VICTIM_PHONE,
      phone_source: 'spoken',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.stringify(res.json());
    expect(body).not.toContain(VICTIM_NAME);
    expect(body).not.toContain('Maria');
  });

  it('SAD: customer-context reveals nothing for an unverified SPOKEN number (the bypass)', async () => {
    // WHY THIS EXISTS: this route was the hole. identify_caller refused, and the
    // LLM simply asked this one instead — same phone, same data, no gate.
    const res = await post('/agent-tools/customer-context', {
      tenant_id: tenantId,
      phone: VICTIM_PHONE,
      phone_source: 'spoken',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.stringify(res.json());
    expect(body).not.toContain(VICTIM_NAME);
    expect(body).not.toContain('Maria');
    expect(res.json().result.requires_verification).toBe(true);
  });

  it('SAD: customer-history reveals nothing for an unverified SPOKEN number', async () => {
    const res = await post('/agent-tools/customer-history', {
      tenant_id: tenantId,
      phone: VICTIM_PHONE,
      phone_source: 'spoken',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.stringify(res.json());
    expect(body).not.toContain(VICTIM_NAME);
    expect(body).not.toContain('Maria');
  });

  it('SAD: omitting phone_source entirely FAILS CLOSED (defaults to spoken)', async () => {
    // WHY: a caller that forgets the field must get the gate, never a bypass. The
    //      default is the cautious value, so the safe path is the lazy path.
    const res = await post('/agent-tools/customer-context', {
      tenant_id: tenantId,
      phone: VICTIM_PHONE,
    });

    expect(JSON.stringify(res.json())).not.toContain(VICTIM_NAME);
  });

  // ── The legitimate paths still work ─────────────────────────────────────────

  it('HAPPY: carrier-attested caller-ID discloses immediately — nothing to prove', async () => {
    // WHY: the phone network vouched for this number. The caller supplied nothing
    //      and cannot lie about it. Gating it would punish every normal customer.
    const res = await post('/agent-tools/customer-context', {
      tenant_id: tenantId,
      phone: VICTIM_PHONE,
      phone_source: 'caller_id',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().result.name).toBe(VICTIM_NAME);
    expect(res.json().result.preferences).toEqual({ preferred_stylist: 'Maria' });
  });

  it('HAPPY: a SPOKEN number discloses once the caller proves possession by OTP on THIS call', async () => {
    // WHY: this is the whole point of the code. Camille on a forwarded line says her
    //      number, reads back the 4 digits we texted, and gets her account — the
    //      gate must open for the real person, not just close on the impostor.
    await markVerified('call-camille-1');

    const res = await post('/agent-tools/customer-context', {
      tenant_id: tenantId,
      phone: VICTIM_PHONE,
      phone_source: 'spoken',
      call_id: 'call-camille-1',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().result.name).toBe(VICTIM_NAME);
    expect(res.json().result.preferences).toEqual({ preferred_stylist: 'Maria' });
  });

  it("SAD: a verification from ANOTHER call does not open the gate (the 24h replay hole)", async () => {
    // WHO: a stranger who rings the forwarded line minutes after Camille did.
    // WHAT: they speak her number. There IS a fresh, valid, verified row for it.
    // WHY THIS EXISTS: the gate used to accept any row verified for
    //      (tenant, phone) within 24 HOURS, with nothing tying it to the call in
    //      progress. So Camille's own legitimate verification at 09:00 opened a
    //      24-hour window in which ANY caller who spoke her number was handed her
    //      name, preferences and history — no code, no challenge. One real
    //      verification became a skeleton key for a day.
    //
    //      A code proves you held the handset AT THAT MOMENT. It does not make
    //      the number yours until tomorrow.
    await markVerified('call-camille-1');

    const res = await post('/agent-tools/customer-context', {
      tenant_id: tenantId,
      phone: VICTIM_PHONE,
      phone_source: 'spoken',
      call_id: 'call-stranger-2', // a DIFFERENT call
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.stringify(res.json());
    expect(body).not.toContain(VICTIM_NAME);
    expect(body).not.toContain('Maria');
    expect(res.json().result.requires_verification).toBe(true);
  });

  it('SAD: a verification with NO call binding can never open the gate (fail closed)', async () => {
    // WHY: an unattributable proof is not a proof. Legacy rows (and any row
    //      written by a path that forgets call_id) must be inert, not trusted.
    await setup.query(
      `INSERT INTO phone_verifications (tenant_id, phone, code_hash, expires_at, verified_at, call_id)
       VALUES ($1, $2, 'x', now() + interval '10 min', now(), NULL)`,
      [tenantId, VICTIM_PHONE]
    );

    const res = await post('/agent-tools/customer-context', {
      tenant_id: tenantId,
      phone: VICTIM_PHONE,
      phone_source: 'spoken',
      call_id: 'call-whoever-3',
    });

    expect(JSON.stringify(res.json())).not.toContain(VICTIM_NAME);
  });

  it('HAPPY: a genuinely NEW caller on a forwarded line is not challenged for a code', async () => {
    // WHY: gate what we would REVEAL, not everyone who calls. An unknown number has
    //      nothing to leak, and on a forwarded line every first-time caller's number
    //      is 'spoken' — demanding an SMS code from all of them would break the
    //      primary flow to protect data that does not exist.
    const res = await post('/agent-tools/customer-context', {
      tenant_id: tenantId,
      phone: '+16305559999',
      phone_source: 'spoken',
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.json())).toContain('New caller');
  });
});
