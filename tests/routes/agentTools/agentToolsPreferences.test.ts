/**
 * Real-DB round-trip tests for /agent-tools/save-customer-preference.
 *
 * This is the WRITE half of the customer-preference loop. The READ half
 * (get_customer_context_for_call surfacing metadata.preferences) already
 * shipped; these tests prove a preference saved by the agent comes back out
 * the read path on the next call — the whole point of the feature.
 *
 * Strategy mirrors knowledge-policy-answer.test.ts: a real Postgres pool +
 * createWithTenantClient + the actual route, so the jsonb merge SQL and the
 * read function are exercised for real (not mocked). Skips when the test DB
 * isn't up (CI without a DB), same as the other real-DB suites.
 *
 * 5W for sad-path failures:
 *   WHO  — the LiveKit voice agent calling save_customer_preference mid-call
 *   WHAT — POST /agent-tools/save-customer-preference {tenant_id, phone, key, value}
 *   WHEN — after it learns a durable fact (preferred stylist, last service)
 *   WHERE — agentTools.ts route → customers.metadata.preferences jsonb merge
 *   WHY  — a broken merge or wrong phone lookup means the AI "remembers"
 *          nothing and every returning caller is treated as a stranger
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { type Client, Pool } from 'pg';
import {
  API_DB_URL,
  getRootClient,
  createTenant,
  createCustomer,
  skipIfDbDown,
} from '../../utils';
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
  await setup.query(
    `UPDATE customers SET metadata = metadata - 'preferences' WHERE customer_id = $1`,
    [customerId]
  );
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
