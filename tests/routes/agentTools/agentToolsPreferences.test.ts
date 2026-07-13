/**
 * Real-DB round-trip tests for /agent-tools/save-customer-preference.
 *
 * This is the WRITE half of the customer-preference loop. The READ half
 * (get_customer_context_for_call surfacing the caller's preferences) already
 * shipped; these tests prove a preference saved by the agent comes back out
 * the read path on the next call — the whole point of the feature.
 *
 * Strategy mirrors knowledge-policy-answer.test.ts: a real Postgres pool +
 * createWithTenantClient + the actual route, so the upsert SQL and the read
 * function are exercised for real (not mocked). Skips when the test DB isn't up
 * (CI without a DB), same as the other real-DB suites.
 *
 * 2026-07-12: storage moved from a jsonb blob (customers.metadata.preferences)
 * to the customer_preferences table — one row per (customer_id, pref_key),
 * unbounded TEXT value, updated_at on re-save. The wire shape the LLM sees is
 * unchanged ({key: value}), which is exactly what these tests pin down.
 *
 * 5W for sad-path failures:
 *   WHO  — the LiveKit voice agent calling save_customer_preference mid-call
 *   WHAT — POST /agent-tools/save-customer-preference {tenant_id, phone, key, value}
 *   WHEN — after it learns a durable fact (preferred stylist, last service)
 *   WHERE — agentTools/identity.ts route → customer_preferences upsert
 *   WHY  — a broken upsert or wrong phone lookup means the AI "remembers"
 *          nothing and every returning caller is treated as a stranger
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { type Client, Pool } from 'pg';
import { API_DB_URL, getRootClient, createTenant, createCustomer, skipIfDbDown } from '../../utils';
import { createWithTenantClient } from '../../../src/database';
import { registerAgentToolRoutes } from '../../../src/routes/agentTools';

const AGENT_SECRET = 'test-preferences-secret';
const stubEmbedding = (): Promise<number[]> => Promise.resolve(new Array(1536).fill(0));
const stubNormalizer = async (text: string): Promise<string> => text;

// normalizePhone('5559990001') === '+15559990001'; the customer row is stored
// with the E.164 form so the route's `WHERE phone = normalized` lookup hits.
const CUSTOMER_PHONE_E164 = '+15559990001';
const CUSTOMER_PHONE_RAW = '5559990001';

let setup: Client;
let pool: Pool;
let app: FastifyInstance;
let dbAvailable = false;
let tenantId: string;
let customerId: string;
const tenantsToClean: string[] = [];

function post(path: string, payload: unknown, secret: string = AGENT_SECRET) {
  return app.inject({
    method: 'POST',
    url: path,
    headers: { 'x-agent-secret': secret },
    payload,
  });
}

/** Read the customer's preferences back via the same fn the agent uses on connect. */
async function readPreferences(): Promise<Record<string, unknown>> {
  const res = await setup.query<{ context: { preferences: Record<string, unknown> } }>(
    'SELECT get_customer_context_for_call($1, $2) as context',
    [tenantId, CUSTOMER_PHONE_E164]
  );
  return res.rows[0]?.context?.preferences ?? {};
}

beforeAll(async () => {
  try {
    setup = await getRootClient();
    await setup.query('SELECT 1');
    pool = new Pool({ connectionString: API_DB_URL, max: 5 });
    process.env.AGENT_SECRET = AGENT_SECRET;

    app = Fastify({ logger: false });
    const withTenantClient = createWithTenantClient(pool);
    registerAgentToolRoutes(app, pool, withTenantClient, stubEmbedding, stubNormalizer);
    await app.ready();

    tenantId = await createTenant(setup, 'Debbie Salon Prefs', 'salon');
    tenantsToClean.push(tenantId);
    customerId = await createCustomer(setup, tenantId, 'Returning Reba', CUSTOMER_PHONE_E164);

    dbAvailable = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[agentToolsPreferences.test] DB not available, skipping', err);
  }
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
  delete process.env.AGENT_SECRET;
});

beforeEach(async (ctx) => {
  skipIfDbDown(ctx, () => dbAvailable);
  if (!dbAvailable) return;
  // Reset the customer's preferences between tests so each owns its state.
  await setup.query(`DELETE FROM customer_preferences WHERE customer_id = $1`, [customerId]);
});

describe('save-customer-preference → get_customer_context round-trip (real DB)', () => {
  it('HAPPY: a saved preference comes back out the read path the agent uses next call', async () => {
    const res = await post('/agent-tools/save-customer-preference', {
      tenant_id: tenantId,
      phone: CUSTOMER_PHONE_RAW,
      key: 'preferred_stylist',
      value: 'Maria',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      success: true,
      result: { saved: true, key: 'preferred_stylist' },
    });

    const prefs = await readPreferences();
    expect(prefs.preferred_stylist).toBe('Maria');
  });

  it('HAPPY: saved preference is recalled by /agent-tools/customer-context (the real agent path)', async () => {
    // WHO: the SAME caller on a later call. The agent's get_customer_context
    //      tool hits /agent-tools/customer-context — NOT the dashboard's
    //      get_customer_context_for_call. This is the path that actually
    //      reaches the LLM, so the preference MUST come back here or the
    //      feature is write-only in production.
    // WHY: regression guard — an earlier version of this route returned only
    //      {name, history} and dropped preferences entirely.
    await post('/agent-tools/save-customer-preference', {
      tenant_id: tenantId,
      phone: CUSTOMER_PHONE_RAW,
      key: 'preferred_stylist',
      value: 'Maria',
    });

    const res = await post('/agent-tools/customer-context', {
      tenant_id: tenantId,
      phone: CUSTOMER_PHONE_RAW,
      // The carrier gave us this number (normal inbound call with caller-ID), so
      // there is nothing for the caller to prove. Omitting phone_source would
      // default to 'spoken' — the safe value — and the disclosure gate would
      // (correctly) withhold Reba's preferences. See identity.ts
      // callerMayHearCustomerData.
      phone_source: 'caller_id',
    });
    expect(res.statusCode).toBe(200);
    const result = res.json().result;
    expect(result.name).toBe('Returning Reba');
    expect(result.preferences).toEqual({ preferred_stylist: 'Maria' });
  });

  it('HAPPY: a second key merges alongside the first (no clobber of existing prefs)', async () => {
    // WHY: jsonb merge must concat, not replace — the salon use case saves
    //      stylist AND last service AND dislikes over multiple turns/calls.
    await post('/agent-tools/save-customer-preference', {
      tenant_id: tenantId,
      phone: CUSTOMER_PHONE_RAW,
      key: 'preferred_stylist',
      value: 'Maria',
    });
    await post('/agent-tools/save-customer-preference', {
      tenant_id: tenantId,
      phone: CUSTOMER_PHONE_RAW,
      key: 'last_service',
      value: 'balayage',
    });

    const prefs = await readPreferences();
    expect(prefs.preferred_stylist).toBe('Maria');
    expect(prefs.last_service).toBe('balayage');
  });

  it('HAPPY: re-saving the same key updates the value in place', async () => {
    await post('/agent-tools/save-customer-preference', {
      tenant_id: tenantId,
      phone: CUSTOMER_PHONE_RAW,
      key: 'preferred_stylist',
      value: 'Maria',
    });
    await post('/agent-tools/save-customer-preference', {
      tenant_id: tenantId,
      phone: CUSTOMER_PHONE_RAW,
      key: 'preferred_stylist',
      value: 'Jordan',
    });

    const prefs = await readPreferences();
    expect(prefs.preferred_stylist).toBe('Jordan');
    expect(Object.keys(prefs)).toEqual(['preferred_stylist']);
  });

  it('HAPPY: a human-readable key is slugified to a short stable key', async () => {
    // WHY: "Preferred Stylist" and "preferred_stylist" must collapse onto one
    //      jsonb key instead of accreting near-duplicate entries.
    const res = await post('/agent-tools/save-customer-preference', {
      tenant_id: tenantId,
      phone: CUSTOMER_PHONE_RAW,
      key: 'Preferred Stylist!',
      value: 'Maria',
    });
    expect(res.json().result.key).toBe('preferred_stylist');
    const prefs = await readPreferences();
    expect(prefs.preferred_stylist).toBe('Maria');
  });

  it('SAD: unknown phone is a graceful no-op (saved:false), not an error', async () => {
    // WHO: the AI tries to save before the caller is a known customer.
    // WHY: it must relay "noted" conversationally, never read a scary error.
    const res = await post('/agent-tools/save-customer-preference', {
      tenant_id: tenantId,
      phone: '5550000000', // no customer with this number
      key: 'preferred_stylist',
      value: 'Maria',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.result.saved).toBe(false);
  });

  it('SAD: an unusable phone fails validation-style (success:false), no crash', async () => {
    const res = await post('/agent-tools/save-customer-preference', {
      tenant_id: tenantId,
      phone: '123', // < 10 digits → normalizePhone returns null
      key: 'preferred_stylist',
      value: 'Maria',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(false);
  });

  it('SAD: missing key is rejected by schema before any DB write', async () => {
    const res = await post('/agent-tools/save-customer-preference', {
      tenant_id: tenantId,
      phone: CUSTOMER_PHONE_RAW,
      value: 'Maria',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(false);
  });

  it('HAPPY: a value well past the old 500-char cap is stored whole, not truncated', async () => {
    // WHO: a caller with a long standing request ("for my color, use the ammonia-
    //      free line, I'm allergic to lavender, and…").
    // WHAT: pref_value is unbounded TEXT; the API guard is 4000, up from 500.
    // WHEN: 2026-07-12 — the jsonb blob became the customer_preferences table.
    // WHY: the old 500 cap silently rejected long values at the schema layer, so
    //      the agent got a failure it could only relay as "I couldn't save that."
    //      Storage must not be the thing that decides what a preference can say.
    const longValue = 'no fragrance, allergic to lavender. '.repeat(50); // ~1,800 chars
    expect(longValue.length).toBeGreaterThan(500);

    const res = await post('/agent-tools/save-customer-preference', {
      tenant_id: tenantId,
      phone: CUSTOMER_PHONE_RAW,
      key: 'standing_request',
      value: longValue,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);

    // Round-trips through the read path the agent actually uses, whole.
    const prefs = await readPreferences();
    expect(prefs.standing_request).toBe(longValue.trim());
  });

  it('SECURITY REGRESSION: the forwarded-line path no longer leaks preferences on an UNVERIFIED number', async () => {
    // THIS TEST USED TO ASSERT THE OPPOSITE, and that was the bug.
    //
    // Written 2026-07-12, it pinned the behavior "a caller on a forwarded line says a
    // number we know → hand back their name, preferences and history." That IS the
    // data leak: on a forwarded line there is no caller ID, so the number is only ever
    // a CLAIM. A stranger who knows Camille's number could ring the shop, say it, and
    // be told her name and her stylist.
    //
    // The recall itself is right and stays — it is what makes a forwarded-line regular
    // feel recognized. What was missing is that the caller must PROVE the number is
    // theirs first (4-digit code, read back live). See the "must prove itself" suite
    // below, including the case where verification succeeds and everything unlocks.
    await post('/agent-tools/save-customer-preference', {
      tenant_id: tenantId,
      phone: CUSTOMER_PHONE_RAW,
      key: 'preferred_stylist',
      value: 'Maria',
    });

    const res = await post('/agent-tools/identify-caller', {
      tenant_id: tenantId,
      phone: CUSTOMER_PHONE_RAW, // the number they SPOKE — unproven
      name: 'Returning Reba',
    });

    expect(res.statusCode).toBe(200);
    const result = res.json().result;
    expect(result.saved).toBe(true); // contact still saved — writing is not leaking
    expect(result.returning_customer).toBe(false); // but nothing is revealed
    expect(result.requires_verification).toBe(true);
    expect(result.preferences).toBeUndefined();
  });
  it('SAD: identify-caller on a NEW number reports returning_customer:false (no false familiarity)', async () => {
    // WHY: the xmax=0 branch must actually distinguish INSERT from UPDATE against
    //      real Postgres. If it got this backwards, the agent would greet every
    //      first-time caller with "welcome back" and no preferences to show.
    const freshPhone = '5559990002';
    const res = await post('/agent-tools/identify-caller', {
      tenant_id: tenantId,
      phone: freshPhone,
      name: 'Brand New Nina',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().result).toEqual({ saved: true, returning_customer: false });

    // Own our data: this test created a customer, so this test removes it.
    await setup.query(`DELETE FROM customers WHERE tenant_id = $1 AND phone = $2`, [
      tenantId,
      '+15559990002',
    ]);
  });

  it('HAPPY: re-saving a key UPDATES it in place and bumps updated_at (one row, not two)', async () => {
    // WHO: a caller who changes stylists — "actually, I see Jordan now."
    // WHAT: the (customer_id, pref_key) PK means the second save is an upsert:
    //        the value is replaced and updated_at moves forward.
    // WHY: staleness is a real signal — a "preferred stylist" confirmed 2 years
    //       ago deserves a re-ask, not a confident assertion. That's only
    //       possible if re-saves bump the timestamp instead of inserting a
    //       duplicate row (which the blob couldn't express at all).
    await post('/agent-tools/save-customer-preference', {
      tenant_id: tenantId,
      phone: CUSTOMER_PHONE_RAW,
      key: 'preferred_stylist',
      value: 'Maria',
    });
    const first = await setup.query<{ updated_at: Date }>(
      `SELECT updated_at FROM customer_preferences
        WHERE customer_id = $1 AND pref_key = 'preferred_stylist'`,
      [customerId]
    );

    await post('/agent-tools/save-customer-preference', {
      tenant_id: tenantId,
      phone: CUSTOMER_PHONE_RAW,
      key: 'preferred_stylist',
      value: 'Jordan',
    });

    const rows = await setup.query<{ pref_value: string; updated_at: Date }>(
      `SELECT pref_value, updated_at FROM customer_preferences
        WHERE customer_id = $1 AND pref_key = 'preferred_stylist'`,
      [customerId]
    );
    expect(rows.rowCount).toBe(1); // upserted, not duplicated
    expect(rows.rows[0].pref_value).toBe('Jordan');
    expect(rows.rows[0].updated_at.getTime()).toBeGreaterThanOrEqual(
      first.rows[0].updated_at.getTime()
    );

    // And the LLM-facing read path shows the NEW value, not the old one.
    const prefs = await readPreferences();
    expect(prefs.preferred_stylist).toBe('Jordan');
  });
});

describe('tenant-config surfaces the preference config to the agent', () => {
  it('HAPPY: returns save_preferences_enabled + preferences_instructions', async () => {
    // WHO: the agent worker fetching tenant config at call start.
    // WHY: these two fields drive whether the prompt gets the preferences
    //      section — if the route drops them the dashboard toggle no-ops.
    await setup.query(
      `UPDATE tenants SET save_preferences_enabled = true, preferences_instructions = $2 WHERE tenant_id = $1`,
      [tenantId, 'Remember the stylist and last service.']
    );

    const res = await post('/agent-tools/tenant-config', { tenant_id: tenantId });
    expect(res.statusCode).toBe(200);
    const result = res.json().result;
    expect(result.save_preferences_enabled).toBe(true);
    expect(result.preferences_instructions).toBe('Remember the stylist and last service.');

    // Reset so it doesn't bleed into other tests' tenant state.
    await setup.query(
      `UPDATE tenants SET save_preferences_enabled = false, preferences_instructions = NULL WHERE tenant_id = $1`,
      [tenantId]
    );
  });

  it('HAPPY: returns forward_phone so the agent can cold-transfer to a human', async () => {
    // WHO: the agent worker fetching tenant config at call start.
    // WHAT: tenant-config must surface tenants.forward_phone so transfer_call
    //        knows the destination cell to SIP-REFER the live leg to.
    // WHEN: every dispatched call; the value is read once into the executor.
    // WHERE: src/routes/agentTools.ts tenant-config SELECT/response.
    // WHY: a drop here makes the dashboard "forward to my cell" field a no-op —
    //        the agent would always fall back to taking a message.
    await setup.query(`UPDATE tenants SET forward_phone = $2 WHERE tenant_id = $1`, [
      tenantId,
      '+16082175303',
    ]);

    const res = await post('/agent-tools/tenant-config', { tenant_id: tenantId });
    expect(res.statusCode).toBe(200);
    expect(res.json().result.forward_phone).toBe('+16082175303');

    // Reset so it doesn't bleed into other tests' tenant state.
    await setup.query(`UPDATE tenants SET forward_phone = NULL WHERE tenant_id = $1`, [tenantId]);
  });

  it('HAPPY: forward_phone defaults to null when unset', async () => {
    // WHAT: an owner who never configured forwarding gets null back, so the
    //        transfer_call tool reports "no number set" and takes a message.
    const res = await post('/agent-tools/tenant-config', { tenant_id: tenantId });
    expect(res.statusCode).toBe(200);
    expect(res.json().result.forward_phone).toBeNull();
  });
});

describe('voice-session-start → -end against the real DB functions', () => {
  it('HAPPY: start inserts an active row; end completes it with the duration', async () => {
    // WHO: the LiveKit agent logging an inbound call start→end.
    // WHAT: /voice-session-start INSERTs a voice_sessions row (status 'active')
    //        and /voice-session-end UPDATEs it to 'completed' with the duration.
    // WHEN: once per call — start fire-and-forget on connect, end awaited on
    //        shutdown.
    // WHERE: start_voice_session / end_voice_session, exercised through the
    //        agent-tools routes against a real Postgres (mocked unit tests
    //        can't catch a column/signature drift in these SECURITY DEFINER
    //        functions — exactly the class of bug CLAUDE.md warns about).
    // WHY: this is the path that makes the dashboard Calls tab populate; if the
    //        function shape drifts from the route's args, every real call would
    //        silently fail to log.
    const callId = `e2e-call-${tenantId.slice(0, 8)}-1`;

    const startRes = await post('/agent-tools/voice-session-start', {
      tenant_id: tenantId,
      call_id: callId,
      caller_phone: CUSTOMER_PHONE_E164,
    });
    expect(startRes.statusCode).toBe(200);
    expect(startRes.json().success).toBe(true);

    const afterStart = await setup.query<{ status: string; duration_seconds: number | null }>(
      `SELECT status, duration_seconds FROM voice_sessions WHERE tenant_id = $1 AND call_id = $2`,
      [tenantId, callId]
    );
    expect(afterStart.rowCount).toBe(1);
    expect(afterStart.rows[0].status).toBe('active');

    const endRes = await post('/agent-tools/voice-session-end', {
      tenant_id: tenantId,
      call_id: callId,
      duration_seconds: 142,
    });
    expect(endRes.statusCode).toBe(200);
    expect(endRes.json()).toEqual({ success: true, result: { ended: true } });

    const afterEnd = await setup.query<{ status: string; duration_seconds: number | null }>(
      `SELECT status, duration_seconds FROM voice_sessions WHERE tenant_id = $1 AND call_id = $2`,
      [tenantId, callId]
    );
    expect(afterEnd.rows[0].status).toBe('completed');
    expect(afterEnd.rows[0].duration_seconds).toBe(142);

    // Clean up this test's row (afterAll's tenant delete would cascade too,
    // but keep the table bare-bones between tests per the isolation rule).
    await setup.query(`DELETE FROM voice_sessions WHERE tenant_id = $1 AND call_id = $2`, [
      tenantId,
      callId,
    ]);
  });

  it('HAPPY: end on an unknown call_id is a benign no-op (ended:false)', async () => {
    // WHO: a late/duplicate shutdown for a call that was never started.
    // WHAT: end_voice_session matches no row → FOUND false → ended:false at 200.
    // WHY: teardown must never error on a missing row; the agent swallows it.
    const res = await post('/agent-tools/voice-session-end', {
      tenant_id: tenantId,
      call_id: `e2e-call-${tenantId.slice(0, 8)}-never-started`,
      duration_seconds: 1,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, result: { ended: false } });
  });
});

describe('identify-caller — a SPOKEN number must prove itself before we reveal anything', () => {
  it('SECURITY: an unverified spoken number gets NO name, NO preferences, NO history', async () => {
    // WHO: anyone. That is the point.
    // WHAT: on a forwarded/blocked call we have no caller ID, so the number is
    //        whatever the caller SAYS it is. It is a claim, not a fact.
    // WHY: without this gate, a stranger who knows (or guesses) a customer's phone
    //       number rings the forwarded line, says it, and the AI answers "Welcome
    //       back, Camille — still seeing Maria for your balayage?" They have just
    //       been handed her name, her stylist and her service history, and the only
    //       "credential" they supplied is a number they made up.
    //
    //       This is a data leak, and it was introduced on 2026-07-12 by the very
    //       feature that makes forwarded-line preference recall work. The fix is not
    //       to remove the recall — it is to make the caller PROVE the number is
    //       theirs (4-digit code, read back on the live call) before we say a word.
    await post('/agent-tools/save-customer-preference', {
      tenant_id: tenantId,
      phone: CUSTOMER_PHONE_RAW,
      key: 'preferred_stylist',
      value: 'Maria',
    });

    const res = await post('/agent-tools/identify-caller', {
      tenant_id: tenantId,
      phone: CUSTOMER_PHONE_RAW,
      name: 'Definitely Not Reba',
      phone_source: 'spoken', // ← the caller SAID this number. Unproven.
    });

    expect(res.statusCode).toBe(200);
    const result = res.json().result;

    // The contact is still saved — writing is not leaking.
    expect(result.saved).toBe(true);
    // But NOTHING about her comes back.
    expect(result.returning_customer).toBe(false);
    expect(result.requires_verification).toBe(true);
    expect(result.name).toBeUndefined(); // not even a hint of who she is
    expect(result.preferences).toBeUndefined();
    expect(result.history).toBeUndefined();
    // And the "verify first" message must not name her either — "Welcome back,
    // Camille, just verify" would ALREADY have leaked her name.
    expect(JSON.stringify(result)).not.toMatch(/Reba/i);
  });

  it('SECURITY: the DEFAULT (no phone_source given) is the safe one', async () => {
    // A caller that forgets to declare where the number came from must get the
    // CAUTIOUS treatment, never the leaky one. Failing open here would mean one
    // forgotten parameter re-opens the leak silently.
    const res = await post('/agent-tools/identify-caller', {
      tenant_id: tenantId,
      phone: CUSTOMER_PHONE_RAW,
      // phone_source omitted entirely
    });

    expect(res.json().result.returning_customer).toBe(false);
    expect(res.json().result.requires_verification).toBe(true);
  });

  it('HAPPY: a CARRIER-ATTESTED number (caller ID) is trusted — no verification needed', async () => {
    // WHY: when the phone network hands us the number, the caller supplied nothing.
    //       They cannot lie about it, so there is nothing to prove. Forcing OTP on a
    //       normal direct call would tax every honest customer to stop an attack
    //       that cannot happen on that path.
    await post('/agent-tools/save-customer-preference', {
      tenant_id: tenantId,
      phone: CUSTOMER_PHONE_RAW,
      key: 'preferred_stylist',
      value: 'Maria',
    });

    const res = await post('/agent-tools/identify-caller', {
      tenant_id: tenantId,
      phone: CUSTOMER_PHONE_RAW,
      name: 'Returning Reba',
      phone_source: 'caller_id', // ← the carrier said so
    });

    const result = res.json().result;
    expect(result.returning_customer).toBe(true);
    expect(result.preferences).toEqual({ preferred_stylist: 'Maria' });
  });

  it('HAPPY: once the spoken number is VERIFIED, everything unlocks', async () => {
    // The whole point of the gate is that it OPENS. Prove possession, get your
    // account — which is exactly what a returning caller on a forwarded line needs.
    await post('/agent-tools/save-customer-preference', {
      tenant_id: tenantId,
      phone: CUSTOMER_PHONE_RAW,
      key: 'preferred_stylist',
      value: 'Maria',
    });

    // Simulate a completed OTP — proved ON THIS CALL.
    //
    // call_id is load-bearing (2026-07-13). The gate used to accept any row
    // verified for this number in the last 24 HOURS, with nothing tying it to the
    // call in progress — so one caller's legitimate verification opened a day-long
    // window in which ANY caller who spoke that number was handed the account. A
    // code proves you held the handset at a MOMENT; it does not make the number
    // yours until tomorrow. A row with no call_id can never open the gate.
    await setup.query(
      `INSERT INTO phone_verifications (tenant_id, phone, code_hash, expires_at, verified_at, call_id)
       VALUES ($1, $2, 'x', now() + interval '10 minutes', now(), $3)`,
      [tenantId, CUSTOMER_PHONE_E164, 'SCL_verified_call']
    );

    const res = await post('/agent-tools/identify-caller', {
      tenant_id: tenantId,
      phone: CUSTOMER_PHONE_RAW,
      phone_source: 'spoken', // still spoken — but now PROVEN, on this call
      call_id: 'SCL_verified_call',
    });

    const result = res.json().result;
    expect(result.returning_customer).toBe(true);
    expect(result.name).toBe('Returning Reba');
    expect(result.preferences).toEqual({ preferred_stylist: 'Maria' });

    await setup.query(`DELETE FROM phone_verifications WHERE tenant_id = $1`, [tenantId]);
  });
});
