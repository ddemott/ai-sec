/**
 * EVERY IDENTIFIED INBOUND CALL LANDS IN THE CRM — via the real
 * /agent-tools/voice-session-start route, against a real database.
 *
 * THE GAP (measured in production, 2026-07-27): 10 calls, all 10 carrying
 * caller ID, and ZERO linked to a customer.
 *
 *     calls | calls_linked_to_customer | unlinked_with_phone
 *        10 |                        0 |                  10
 *
 * The owner's phonebook did not contain a single person who had actually
 * telephoned the business. `start_voice_session` resolves context through
 * `get_customer_context_for_call`, which LOOKS UP a customer by phone and
 * stores NULL when there isn't one — so a caller was recorded only if they went
 * on to book, leave a message, page the owner, or file a job inquiry. Ask a
 * question and hang up, or drop the call mid-flow, and you existed nowhere but
 * the Calls tab.
 *
 * This is the same look-up-and-shrug shape as the messaging routes fixed earlier
 * the same day, one layer up — which is the tell that the defect was the lookup
 * HABIT, not any individual route.
 *
 * These tests own their tenant; afterAll deletes only it (cascade).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { type Client, Pool } from 'pg';

import { registerAgentToolRoutes } from '../../src/routes/agentTools';
import { createWithTenantClient } from '../../src/database/index';
import {
  getRootClient,
  createTenant,
  deleteTenantWithDeadlockRetry,
  skipIfDbDown,
  ROOT_DB_URL,
} from '../utils';

const SECRET = 'test-agent-secret';
const CALLER_PHONE = '+16305550142';

let db: Client;
let pool: Pool;
let app: FastifyInstance;
let dbAvailable = false;
let tenantId: string;
const tenantsToClean: string[] = [];

beforeAll(async () => {
  try {
    db = await getRootClient();
    await db.query('SELECT 1');
    dbAvailable = true;
  } catch {
    dbAvailable = false;
    return;
  }
  process.env.AGENT_SECRET = SECRET;
  tenantId = await createTenant(db, 'CRM Capture Co', 'automotive', 'America/Chicago');
  tenantsToClean.push(tenantId);

  // The route talks to the DB exactly as production does — same pool, same
  // withTenantClient. A mocked client here would prove nothing about whether
  // the row actually lands.
  // ROOT_DB_URL, not process.env.DATABASE_URL: the fixture tenant is created in
  // test_db, while .env points at the `postgres` database. Falling back to the
  // env var made every request 500 with TENANT_NOT_FOUND — the route was fine,
  // the test was pointed at the wrong database.
  pool = new Pool({ connectionString: ROOT_DB_URL });
  app = Fastify({ logger: false });
  registerAgentToolRoutes(app, pool, createWithTenantClient(pool), async () =>
    new Array(1536).fill(0)
  );
  await app.ready();
});

afterAll(async () => {
  if (!dbAvailable) return;
  await app?.close();
  await pool?.end();
  for (const t of tenantsToClean) await deleteTenantWithDeadlockRetry(db, t);
  await db.end();
  delete process.env.AGENT_SECRET;
});

function startCall(callId: string, phone: string | null) {
  return app.inject({
    method: 'POST',
    url: '/agent-tools/voice-session-start',
    headers: { 'x-agent-secret': SECRET },
    payload: {
      tenant_id: tenantId,
      call_id: callId,
      ...(phone ? { caller_phone: phone } : {}),
    },
  });
}

describe('an inbound call enters the CRM', () => {
  it('THE GAP: a first-time caller becomes a customer AND the call links to them', async (ctx) => {
    // WHO: anyone who dials the business for the first time.
    // WHAT: voice-session-start creates the customer and links voice_sessions.
    // WHEN: on connect — before the greeting has even finished.
    // WHERE: src/routes/agentTools/session.ts.
    // WHY: prod had 10 calls and 0 CRM records. A call you cannot attribute to a
    //      person is a call the owner cannot follow up.
    skipIfDbDown(ctx, () => dbAvailable);
    if (!dbAvailable) return;

    const res = await startCall('crm-capture-1', CALLER_PHONE);
    expect(res.statusCode).toBe(200);

    const cust = await db.query<{ customer_id: string; name: string; phone: string }>(
      'SELECT customer_id, name, phone FROM customers WHERE tenant_id = $1 AND phone = $2',
      [tenantId, CALLER_PHONE]
    );
    expect(cust.rows, 'the caller must exist in the CRM').toHaveLength(1);
    // A placeholder, deliberately: caller ID gives a number, not a person. It is
    // one of PLACEHOLDER_NAMES so the first rung that hears their real name
    // overwrites it instead of the phonebook keeping "Caller" forever.
    expect(cust.rows[0].name).toBe('Caller');

    const session = await db.query<{ customer_id: string | null }>(
      'SELECT customer_id FROM voice_sessions WHERE tenant_id = $1 AND call_id = $2',
      [tenantId, 'crm-capture-1']
    );
    expect(session.rows[0]?.customer_id, 'the CALL must link to the person').toBe(
      cust.rows[0].customer_id
    );
  });

  it('a second call from the same number reuses the record, never duplicates it', async (ctx) => {
    skipIfDbDown(ctx, () => dbAvailable);
    if (!dbAvailable) return;

    await startCall('crm-capture-2', CALLER_PHONE);

    const count = await db.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM customers WHERE tenant_id = $1 AND phone = $2',
      [tenantId, CALLER_PHONE]
    );
    expect(count.rows[0].n, 'one caller is one customer').toBe('1');

    // ...and BOTH calls hang off that one person, which is what makes the
    // customer's call history a history rather than a list of strangers.
    const linked = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM voice_sessions v
         JOIN customers c ON c.customer_id = v.customer_id
        WHERE v.tenant_id = $1 AND c.phone = $2`,
      [tenantId, CALLER_PHONE]
    );
    expect(linked.rows[0].n).toBe('2');
  });

  it('a real name given later REPLACES the placeholder (not a second row)', async (ctx) => {
    // The placeholder only earns its place if it is correctable — that is the
    // 2026-07-12 "Caller forever" bug, and the reason the name written here is
    // one the back-fill predicate recognises.
    skipIfDbDown(ctx, () => dbAvailable);
    if (!dbAvailable) return;

    const res = await app.inject({
      method: 'POST',
      url: '/agent-tools/take-message',
      headers: { 'x-agent-secret': SECRET },
      payload: {
        tenant_id: tenantId,
        call_id: 'crm-capture-2',
        caller_name: 'Dana Reyes',
        caller_phone: CALLER_PHONE,
        message: 'Please call me back about the quote',
      },
    });
    expect(res.statusCode).toBe(200);

    const cust = await db.query<{ name: string }>(
      'SELECT name FROM customers WHERE tenant_id = $1 AND phone = $2',
      [tenantId, CALLER_PHONE]
    );
    expect(cust.rows).toHaveLength(1);
    expect(cust.rows[0].name).toBe('Dana Reyes');
  });

  it('SAD: a withheld caller ID creates nothing — we do not invent an identity', async (ctx) => {
    // A blocked number (or a forwarded line, where caller ID is the forwarder)
    // gives us nothing to key a person on. The call is still logged; the CRM
    // stays honest.
    skipIfDbDown(ctx, () => dbAvailable);
    if (!dbAvailable) return;

    const before = await db.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM customers WHERE tenant_id = $1',
      [tenantId]
    );

    const res = await startCall('crm-capture-anon', null);
    expect(res.statusCode).toBe(200);

    const after = await db.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM customers WHERE tenant_id = $1',
      [tenantId]
    );
    expect(after.rows[0].n, 'no phone, no customer').toBe(before.rows[0].n);

    const session = await db.query<{ customer_id: string | null }>(
      'SELECT customer_id FROM voice_sessions WHERE tenant_id = $1 AND call_id = $2',
      [tenantId, 'crm-capture-anon']
    );
    expect(session.rows, 'the CALL is still recorded').toHaveLength(1);
    expect(session.rows[0].customer_id).toBeNull();
  });
});
