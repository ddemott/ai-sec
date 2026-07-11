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
      company: 'Acme Staffing',
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
      `SELECT company, employment_type, location_type, caller_name
         FROM job_inquiries WHERE tenant_id = $1 AND caller_name = 'Recruiter Rita'`,
      [tenantId]
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].company).toBe('Acme Staffing');
    expect(row.rows[0].employment_type).toBe('contract');
    expect(row.rows[0].location_type).toBe('remote');
  });

  it('HAPPY: a minimal inquiry (name only) still lands — optional fields default NULL', async () => {
    const res = await post('/agent-tools/capture-job-inquiry', {
      tenant_id: tenantId,
      caller_name: 'Minimal Moe',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);

    const row = await setup.query(
      `SELECT company, employment_type FROM job_inquiries
        WHERE tenant_id = $1 AND caller_name = 'Minimal Moe'`,
      [tenantId]
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].company).toBeNull();
    expect(row.rows[0].employment_type).toBeNull();
  });
});
