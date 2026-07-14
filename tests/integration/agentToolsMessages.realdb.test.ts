/**
 * Real-DB companion for the take-message + capture-job-inquiry agent tools.
 *
 * Motivation (docs/TEST_DB_AUDIT.md): both handlers INSERT (customer_messages
 * / job_inquiries) and take-message first resolves customer_id by phone with
 * an is_deleted filter. A mocked pg client proves the marshalling, not that
 * the columns exist, the FK resolves, or the row lands. This suite drives the
 * real routes → real Postgres and reads the stored row back.
 *
 * Strategy mirrors agentToolsBookingIntegration.test.ts: real pg.Pool on
 * API_DB_URL + registerAgentToolRoutes, driven via x-agent-secret. Fixtures
 * per-suite, cleaned in afterAll. Skips when DB down; hard-fails under
 * REQUIRE_DB_TESTS=1 (CI).
 *
 * 5W for sad-path failures:
 *   WHO  — the voice agent taking a message / logging a recruiter's inquiry
 *   WHAT — POST /agent-tools/{take-message,capture-job-inquiry}
 *   WHEN — mid-call, no booking made
 *   WHERE — agentTools.ts INSERT INTO customer_messages / job_inquiries
 *   WHY  — a dropped message or a 500 on a real recruiter call is lost business
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { type Client, Pool } from 'pg';
import {
  API_DB_URL,
  getRootClient,
  createTenant,
  createCustomerFull,
  skipIfDbDown,
} from '../utils';
import { createWithTenantClient } from '../../src/database';
import { registerAgentToolRoutes } from '../../src/routes/agentTools';

const AGENT_SECRET = 'test-messages-secret';
const stubEmbedding = (): Promise<number[]> => Promise.resolve(new Array(1536).fill(0));
const stubNormalizer = async (text: string): Promise<string> => text;

const KNOWN_PHONE_E164 = '+15556660001';

let setup: Client;
let pool: Pool;
let app: FastifyInstance;
let dbAvailable = false;
let tenantId: string;
let knownCustomerId: string;
let prevAgentSecret: string | undefined;
const tenantsToClean: string[] = [];

function post(path: string, payload: unknown) {
  return app.inject({
    method: 'POST',
    url: path,
    headers: { 'x-agent-secret': AGENT_SECRET },
    payload,
  });
}

beforeAll(async () => {
  try {
    setup = await getRootClient();
    await setup.query('SELECT 1');
    pool = new Pool({ connectionString: API_DB_URL, max: 5 });
    prevAgentSecret = process.env.AGENT_SECRET;
    process.env.AGENT_SECRET = AGENT_SECRET;

    app = Fastify({ logger: false });
    const withTenantClient = createWithTenantClient(pool);
    registerAgentToolRoutes(app, pool, withTenantClient, stubEmbedding, stubNormalizer);
    await app.ready();

    tenantId = await createTenant(setup, 'Messages Realdb Tenant', 'salon');
    tenantsToClean.push(tenantId);
    knownCustomerId = await createCustomerFull(setup, tenantId, KNOWN_PHONE_E164, 'Known Kim');

    dbAvailable = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[agentToolsMessages.realdb.test] DB not available, skipping', err);
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
  if (prevAgentSecret === undefined) delete process.env.AGENT_SECRET;
  else process.env.AGENT_SECRET = prevAgentSecret;
});

beforeEach((ctx) => {
  skipIfDbDown(ctx, () => dbAvailable);
});

describe('take-message → real customer_messages row', () => {
  it('HAPPY: known caller-phone resolves to customer_id and the message row lands', async () => {
    // WHY: the handler's SELECT customer_id … WHERE phone = $ (is_deleted
    // filtered) must resolve a real customer and the INSERT must store it.
    const res = await post('/agent-tools/take-message', {
      tenant_id: tenantId,
      caller_name: 'Known Kim',
      caller_phone: '5556660001', // raw → normalizePhone → +15556660001
      message: 'Please call me back about my invoice.',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);

    const row = await setup.query(
      `SELECT customer_id, caller_name, message FROM customer_messages
        WHERE tenant_id = $1 AND caller_phone = $2`,
      [tenantId, KNOWN_PHONE_E164]
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].customer_id).toBe(knownCustomerId);
    expect(row.rows[0].message).toContain('invoice');
  });

  it('HAPPY: an unknown caller-phone stores the message with a NULL customer_id (no crash)', async () => {
    // WHY: the customer lookup is best-effort; a stranger still gets a message
    // row, just unlinked.
    const res = await post('/agent-tools/take-message', {
      tenant_id: tenantId,
      caller_name: 'Stranger Sue',
      callback_phone: '5556669999',
      message: 'Do you have weekend hours?',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);

    const row = await setup.query(
      `SELECT customer_id FROM customer_messages
        WHERE tenant_id = $1 AND caller_name = 'Stranger Sue'`,
      [tenantId]
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].customer_id).toBeNull();
  });
});

describe('capture-job-inquiry → real job_inquiries row', () => {
  it('HAPPY: a recruiter inquiry with all fields lands as a row', async () => {
    const res = await post('/agent-tools/capture-job-inquiry', {
      tenant_id: tenantId,
      caller_name: 'Recruiter Rita',
      callback_phone: '5556667777',
      caller_company: 'Acme Staffing',
      client_company: 'Globex Health',
      represents_company: true,
      employment_type: 'contract',
      rate_range: '$80-100/hr',
      duration: '6 months',
      location_type: 'remote',
      timezone: 'America/Chicago',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);

    const row = await setup.query(
      `SELECT client_company, caller_company, employment_type, location_type, caller_name
         FROM job_inquiries WHERE tenant_id = $1 AND caller_name = 'Recruiter Rita'`,
      [tenantId]
    );
    expect(row.rows).toHaveLength(1);
    // TWO companies, kept apart. The agency that rang, and where the work is.
    expect(row.rows[0].caller_company).toBe('Acme Staffing');
    expect(row.rows[0].client_company).toBe('Globex Health');
    expect(row.rows[0].employment_type).toBe('contract');
    expect(row.rows[0].location_type).toBe('remote');
  });

  it('SAD: the spoken reply names the REAL inbox and the REAL owner — never "his inbox", never "Dale"', async () => {
    // WHO: a recruiter who called a business and was asked to send a job description.
    // WHAT: the `message` this route returns is spoken to the caller almost verbatim —
    //       the model relays it rather than composing its own. So every defect in this
    //       string is a defect a customer HEARS.
    // WHEN: found on a real call, 2026-07-14. The agent said, exactly:
    //         "Please also email a job description to HIS INBOX with your name and
    //          company in the subject line."
    //       To which inbox? The route has known the address the whole time — it emails
    //       the owner with it two lines earlier — and simply never put it in the
    //       sentence. We asked a recruiter to send us a job description and did not
    //       tell them where. They cannot follow that instruction. Nothing arrives.
    // WHY:  and it said "Dale" — a hardcoded first name, in a route EVERY tenant on
    //       the platform shares. A salon's assistant would have told its caller that
    //       the details were passed along to Dale.
    // This test OWNS its data (feedback_test_isolation): give the tenant a
    // recipient, and take it away again at the end.
    const recipient = 'hiring@example-test.com';
    await setup.query(`UPDATE tenants SET job_inquiry_email = $2 WHERE tenant_id = $1`, [
      tenantId,
      recipient,
    ]);

    const res = await post('/agent-tools/capture-job-inquiry', {
      tenant_id: tenantId,
      caller_name: 'Spoken Sam',
      callback_phone: '5553334444',
      caller_company: 'Insight Global',
      client_company: 'Blue Cross',
    });
    expect(res.statusCode).toBe(200);

    const spoken: string = res.json().result.message;
    expect(spoken).toContain(recipient); // the address, out loud
    expect(spoken).not.toMatch(/his inbox|her inbox|their inbox/i);
    expect(spoken).not.toContain('Dale'); // not on THIS tenant — it is not their owner

    await setup.query(`UPDATE tenants SET job_inquiry_email = NULL WHERE tenant_id = $1`, [
      tenantId,
    ]);
  });

  it('SAD: a lead nobody can answer is REFUSED, not saved', async () => {
    // WHO: a recruiter with a real job. WHAT: the agent captured every field except
    //      the two that matter.
    // WHEN: 2026-07-14, a real call. The ladder ran flawlessly — Blue Cross Blue
    //      Shield, contract, $65-72/hr, six months, hybrid, 300 Randolph Street — and
    //      the row saved with caller_name "Caller" and an EMPTY phone. The agent then
    //      told the caller "I now have all the information I need."
    // WHY: it did not. It had a six-month contract lead and no way on earth to reach
    //      the person offering it. "Caller" is not even a name the model invented — it
    //      is OUR placeholder (PLACEHOLDER_NAMES), which it had seen elsewhere and
    //      helpfully filled in. Every impressive field was captured; the only two that
    //      make the row USEFUL were not.
    //      A tool that cannot do its job must FAIL and say why — never save a hollow
    //      row and report success. The prompt asks; the route enforces.
    const noName = await post('/agent-tools/capture-job-inquiry', {
      tenant_id: tenantId,
      caller_name: 'Caller', // the exact placeholder from the real call
      callback_phone: '5551234567',
      caller_company: 'Insight Global',
      client_company: 'Blue Cross',
    });
    expect(noName.statusCode).toBe(200); // agent-tools speak failure at 200
    expect(noName.json().success).toBe(false);
    expect(noName.json().error).toMatch(/name/i);

    const noPhone = await post('/agent-tools/capture-job-inquiry', {
      tenant_id: tenantId,
      caller_name: 'Rita Reyes',
      caller_company: 'Insight Global',
      client_company: 'Blue Cross',
      // no callback_phone at all — exactly the real call
    });
    expect(noPhone.json().success).toBe(false);
    expect(noPhone.json().error).toMatch(/number/i);

    // NOTHING was written. A refusal must not leave a half-row behind.
    const rows = await setup.query(
      `SELECT 1 FROM job_inquiries WHERE tenant_id = $1 AND (caller_name = 'Caller' OR caller_name = 'Rita Reyes')`,
      [tenantId]
    );
    expect(rows.rows).toHaveLength(0);
  });

  it('SAD: with NO inbox configured, it does not ask the caller to email one', async () => {
    // WHO: a recruiter calling a tenant whose owner never set a job-inquiry email.
    // WHY: the old reply asked them to email "his inbox" UNCONDITIONALLY — even when
    //      there was no recipient at all and the route had just logged
    //      `job_inquiry_no_recipient`. So the caller is told to send a job description
    //      somewhere that does not exist. They go away, they send it (where?), and
    //      nothing ever arrives. An instruction the caller CANNOT follow is worse than
    //      no instruction: it manufactures a false belief that the ball is rolling.
    //      The inquiry row still saves — that is the durable record — but we stay
    //      silent about a channel we do not have.
    await setup.query(`UPDATE tenants SET job_inquiry_email = NULL WHERE tenant_id = $1`, [
      tenantId,
    ]);

    const res = await post('/agent-tools/capture-job-inquiry', {
      tenant_id: tenantId,
      caller_name: 'Voidless Vera',
      callback_phone: '5552221111',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result.saved).toBe(true); // the row still lands

    const spoken: string = res.json().result.message;
    expect(spoken).not.toMatch(/email/i); // no ask we cannot honour
    expect(spoken).toMatch(/passed those details along/i); // but we still confirm receipt
  });

  it('HAPPY: the true minimum is a NAME AND A NUMBER — the job details are optional', async () => {
    // CONTRACT CHANGE, 2026-07-14, and it is the point of the whole fix.
    //
    // This test used to be "a minimal inquiry (NAME ONLY) still lands", and that
    // contract is precisely what let a six-month Blue Cross contract at $65-72/hr save
    // itself with no phone number and the placeholder name "Caller". The route was
    // asked to record a lead nobody could answer, and it obliged.
    //
    // The details of the JOB are genuinely optional — a caller may not know the rate
    // yet, and half a lead is still a lead. The details of the PERSON are not: without
    // a name and a number there is no lead at all, only a story about one.
    const res = await post('/agent-tools/capture-job-inquiry', {
      tenant_id: tenantId,
      caller_name: 'Minimal Moe',
      callback_phone: '5559998888',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);

    const row = await setup.query(
      `SELECT client_company, employment_type FROM job_inquiries
        WHERE tenant_id = $1 AND caller_name = 'Minimal Moe'`,
      [tenantId]
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].client_company).toBeNull();
    expect(row.rows[0].employment_type).toBeNull();
  });
});
