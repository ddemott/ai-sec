/**
 * Tests for /agent-tools/take-message.
 *
 * Verifies message persistence, owner SMS notification, and input validation.
 * sendSms is mocked at the module level to avoid real Telnyx calls.
 *
 * Query sequence per call (when caller_phone provided):
 *   1. SELECT customer_id FROM customers (get-or-create step 1)
 *   1b. hit  → UPDATE customers SET name (placeholder back-fill; no-op on a real name)
 *       miss → INSERT INTO customers ... ON CONFLICT DO NOTHING RETURNING customer_id
 *   2. INSERT INTO customer_messages RETURNING message_id
 *   3. SELECT owner_phone, forward_phone, inbound_phone FROM tenants
 *
 * When no phone provided, queries 1/1b are skipped → only 2 + 3 fire.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';

import { registerAgentToolRoutes } from '../../../src/routes/agentTools';

// Hoisted before imports — intercepts all sendSms calls inside agentTools.ts
vi.mock('../../../src/services/telnyxSms', () => ({
  sendSms: vi.fn(async () => ({ ok: true })),
  generateVerificationCode: vi.fn(() => '1234'),
}));

import * as telnyxSms from '../../../src/services/telnyxSms';

const TENANT_ID = 'f234e471-0e60-4163-86c9-93cfd9338e3a';
const CUSTOMER_ID = 'dddddddd-0000-4000-8000-000000000004';
const MESSAGE_ID = '42'; // SERIAL — returned as string from pg
const SECRET = 'test-agent-secret';

interface MockQuery {
  text: string;
  params: unknown[];
}

function buildApp(opts: { queryResponses: Array<{ rows: unknown[]; rowCount?: number }> }): {
  app: FastifyInstance;
  queries: MockQuery[];
} {
  const queries: MockQuery[] = [];
  const responses = [...opts.queryResponses];

  const mockClient = {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      queries.push({ text, params: params || [] });
      return responses.shift() ?? { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  } as unknown as PoolClient;

  const withTenantClient = async <T>(
    _tenantId: string,
    fn: (client: PoolClient) => Promise<T>
  ): Promise<T> => fn(mockClient);

  const getEmbedding = async () => new Array(1536).fill(0);

  const app = Fastify({ logger: false });
  registerAgentToolRoutes(app, {} as never, withTenantClient, getEmbedding);
  return { app, queries };
}

function post(app: FastifyInstance, payload: unknown) {
  return app.inject({
    method: 'POST',
    url: '/agent-tools/take-message',
    headers: { 'x-agent-secret': SECRET },
    payload,
  });
}

beforeEach(() => {
  process.env.AGENT_SECRET = SECRET;
  vi.mocked(telnyxSms.sendSms).mockClear();
});

afterEach(() => {
  delete process.env.AGENT_SECRET;
  vi.restoreAllMocks();
});

describe('/agent-tools/take-message', () => {
  it('HAPPY: saves message and returns saved:true (no forward_phone → no SMS)', async () => {
    // WHO: Caller reaching out after-hours or when owner unavailable
    // WHAT: Message persists to customer_messages; SMS skipped (no forward_phone configured)
    // WHEN: Caller provides caller_phone → customer lookup fires, then INSERT, then tenant
    // WHERE: src/routes/agentTools.ts take-message toolRoute
    // WHY: "I'll take a message" must be real DB write, not LLM theater; saved:true confirms
    const { app, queries } = buildApp({
      queryResponses: [
        { rows: [{ customer_id: CUSTOMER_ID }] }, // customer lookup
        // 2026-07-23: name back-fill. A real caller_name overwrites a PLACEHOLDER
        // customer name ("Caller" from a nameless booking) so the phonebook stops
        // keeping the placeholder forever. Zero rows here = the stored name was
        // already real, which is the no-op case.
        { rows: [] },
        { rows: [{ message_id: MESSAGE_ID }] }, // INSERT customer_messages
        { rows: [{ forward_phone: null, inbound_phone: null }] }, // tenant fetch
      ],
    });

    const res = await post(app, {
      tenant_id: TENANT_ID,
      caller_name: 'Alice Smith',
      caller_phone: '+15551112222',
      message: 'Looking for a quote on four tires',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      success: boolean;
      result: { saved: boolean; notified: boolean; message_id: string };
    }>();
    expect(body.success).toBe(true);
    expect(body.result.saved).toBe(true);
    expect(body.result.notified).toBe(false);
    expect(body.result.message_id).toBe(MESSAGE_ID);
    const insert = queries.find((q) => q.text.includes('INSERT INTO customer_messages'));
    expect(insert).toBeDefined();
    expect(vi.mocked(telnyxSms.sendSms)).not.toHaveBeenCalled();
  });

  it('HAPPY: unknown caller is CREATED as a customer and the message links to them', async () => {
    // WHO: Camille, 2026-07-25 — asked for help with groceries, left a message,
    //       never booked, and never appeared in the CRM.
    // WHAT: no customer row for the phone → INSERT INTO customers, and the
    //       customer_messages row carries that new customer_id (not NULL).
    // WHEN: any message-only call from a number the tenant has never seen.
    // WHERE: getOrCreateCustomerByPhoneOnClient, called from take-message.
    // WHY: prod held 1 message and 0 customers. The owner had a callback to make
    //       and no lead record, and the caller was a stranger on her next call.
    const { app, queries } = buildApp({
      queryResponses: [
        { rows: [] }, // SELECT customers → miss
        { rows: [{ customer_id: CUSTOMER_ID }] }, // INSERT INTO customers
        { rows: [{ message_id: MESSAGE_ID }] }, // INSERT customer_messages
        { rows: [{ owner_phone: null, forward_phone: null, inbound_phone: null }] },
      ],
    });

    const res = await post(app, {
      tenant_id: TENANT_ID,
      caller_name: 'Camille',
      caller_phone: '+12624979039',
      message: 'Come and help me with the groceries',
    });

    expect(res.statusCode).toBe(200);
    const customerInsert = queries.find((q) => q.text.includes('INSERT INTO customers'));
    expect(customerInsert).toBeDefined();
    expect(customerInsert?.params).toEqual([TENANT_ID, '+12624979039', 'Camille']);
    // ON CONFLICT, so two in-flight retries of the same call converge on one row.
    expect(customerInsert?.text).toContain('ON CONFLICT (tenant_id, phone) DO NOTHING');
    const messageInsert = queries.find((q) => q.text.includes('INSERT INTO customer_messages'));
    expect(messageInsert?.params[1]).toBe(CUSTOMER_ID);
  });

  it('SAD: soft-deleted row holds the phone → message still saves, unlinked', async () => {
    // WHO: a number whose customer was deleted; same number calls and leaves a message.
    // WHAT: SELECT misses (soft-deleted excluded), INSERT hits the (tenant, phone)
    //       unique key and DO-NOTHINGs, the re-SELECT still misses → customer_id NULL.
    // WHEN: only after a customer purge/soft-delete on that number.
    // WHERE: getOrCreateCustomerByPhoneOnClient's null return.
    // WHY: reviving deleted customer data is a deliberate act, and losing the whole
    //       message to a unique-violation 500 is worse than saving it unlinked.
    const { app, queries } = buildApp({
      queryResponses: [
        { rows: [] }, // SELECT customers → miss (soft-deleted excluded)
        { rows: [] }, // INSERT ... ON CONFLICT DO NOTHING → no row
        { rows: [] }, // re-SELECT winner → still nothing live
        { rows: [{ message_id: MESSAGE_ID }] }, // INSERT customer_messages
        { rows: [{ owner_phone: null, forward_phone: null, inbound_phone: null }] },
      ],
    });

    const res = await post(app, {
      tenant_id: TENANT_ID,
      caller_name: 'Dana',
      caller_phone: '+15558675309',
      message: 'Call me back please',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ result: { saved: boolean } }>().result.saved).toBe(true);
    const messageInsert = queries.find((q) => q.text.includes('INSERT INTO customer_messages'));
    expect(messageInsert?.params[1]).toBeNull();
  });

  it('HAPPY: SMS-notifies owner when forward_phone + inbound_phone both valid', async () => {
    // WHO: Caller whose message triggers an immediate text to the business owner
    // WHAT: INSERT succeeds → fetch tenant phones → sendSms → notified:true
    // WHEN: Both forward_phone and inbound_phone are set and valid E.164 on the tenant row
    // WHERE: Fire-and-forget SMS block after DB write
    // WHY: Owner gets real-time alert; the DB write already succeeded, SMS is best-effort
    const { app } = buildApp({
      queryResponses: [
        { rows: [] }, // customer not found (new caller, no customer row yet)
        { rows: [{ customer_id: CUSTOMER_ID }] }, // INSERT INTO customers (get-or-create)
        { rows: [{ message_id: MESSAGE_ID }] },
        { rows: [{ forward_phone: '+16082175303', inbound_phone: '+16308229086' }] },
      ],
    });

    vi.mocked(telnyxSms.sendSms).mockResolvedValueOnce({ ok: true });

    const res = await post(app, {
      tenant_id: TENANT_ID,
      caller_name: 'Bob Jones',
      caller_phone: '+15559990000',
      message: 'Please call me back',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; result: { saved: boolean; notified: boolean } }>();
    expect(body.success).toBe(true);
    expect(body.result.saved).toBe(true);
    expect(body.result.notified).toBe(true);
    expect(vi.mocked(telnyxSms.sendSms)).toHaveBeenCalledOnce();
    const smsCall = vi.mocked(telnyxSms.sendSms).mock.calls[0][0];
    expect(smsCall.to).toBe('+16082175303');
    expect(smsCall.from).toBe('+16308229086');
    expect(smsCall.body).toContain('Bob Jones');
    expect(smsCall.body).toContain('Please call me back');
  });

  it('HAPPY: texts owner_phone (not forward_phone) when set — alerts decoupled from transfer', async () => {
    // WHO: a tenant who takes messages with NO live transfer (forward_phone blank)
    //       but still wants a text when a caller leaves a message
    // WHAT: the owner notification SMS goes to the dedicated owner_phone, even
    //       though forward_phone is null
    // WHEN: owner_phone set, forward_phone null (the "message-only" config)
    // WHERE: take-message owner-notification block (owner_phone ?? forward_phone)
    // WHY: forward_phone doubles as the live-transfer destination; coupling the
    //       alert to it meant message-only tenants got no text. owner_phone fixes that.
    const { app } = buildApp({
      queryResponses: [
        { rows: [] }, // customer not found
        { rows: [{ customer_id: CUSTOMER_ID }] }, // INSERT INTO customers (get-or-create)
        { rows: [{ message_id: MESSAGE_ID }] },
        {
          rows: [
            { owner_phone: '+16082175303', forward_phone: null, inbound_phone: '+16308229086' },
          ],
        },
      ],
    });

    vi.mocked(telnyxSms.sendSms).mockResolvedValueOnce({ ok: true });

    const res = await post(app, {
      tenant_id: TENANT_ID,
      caller_name: 'Carol Lin',
      callback_phone: '+15559991234',
      message: 'Interested in a meeting',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; result: { saved: boolean; notified: boolean } }>();
    expect(body.result.notified).toBe(true);
    const smsCall = vi.mocked(telnyxSms.sendSms).mock.calls[0][0];
    expect(smsCall.to).toBe('+16082175303'); // owner_phone, NOT forward_phone (null)
  });

  it('HAPPY: no phone provided → skips customer lookup, still saves message', async () => {
    // WHO: Anonymous caller (blocked CID, no callback number given)
    // WHAT: Customer lookup skipped entirely — customer_id is null in INSERT
    // WHY: Message is still worth saving; the lookup is a nice-to-have link, not required
    const { app, queries } = buildApp({
      queryResponses: [
        { rows: [{ message_id: MESSAGE_ID }] }, // INSERT — no lookup before it
        { rows: [{ forward_phone: null, inbound_phone: null }] }, // tenant
      ],
    });

    const res = await post(app, {
      tenant_id: TENANT_ID,
      caller_name: 'Anonymous',
      message: 'Need an appointment',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ success: boolean }>().success).toBe(true);
    // 2 queries only — no customer lookup
    expect(queries).toHaveLength(2);
    expect(queries[0].text).toContain('INSERT INTO customer_messages');
  });

  it('HAPPY: SMS failure does not un-save the message (notified:false, saved:true)', async () => {
    // WHO: Owner notification fails (Telnyx error, bad number format, etc.)
    // WHAT: INSERT already succeeded before SMS is attempted; failure is logged, not returned
    // WHY: Message is the source of truth; SMS is best-effort — a comms outage must not
    //       cause the endpoint to lie and say the message wasn't saved
    const { app } = buildApp({
      queryResponses: [
        { rows: [] }, // customer not found
        { rows: [{ message_id: MESSAGE_ID }] },
        { rows: [{ forward_phone: '+16082175303', inbound_phone: '+16308229086' }] },
      ],
    });

    vi.mocked(telnyxSms.sendSms).mockResolvedValueOnce({ ok: false, error: 'Telnyx error' });

    const res = await post(app, {
      tenant_id: TENANT_ID,
      caller_name: 'Carol',
      message: 'Urgent call needed',
      caller_phone: '+15550000001',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; result: { saved: boolean; notified: boolean } }>();
    expect(body.success).toBe(true);
    expect(body.result.saved).toBe(true);
    expect(body.result.notified).toBe(false);
  });

  it('SAD: missing caller_name fails validation, no DB call', async () => {
    // WHO: Malformed request missing the required caller name
    // WHAT: Zod rejects before any DB query — no INSERT, no SMS
    // WHY: caller_name is required; the owner notification body would be unusable without it
    const { app, queries } = buildApp({ queryResponses: [] });

    const res = await post(app, {
      tenant_id: TENANT_ID,
      message: 'Lost my keys',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ success: boolean }>().success).toBe(false);
    expect(queries).toHaveLength(0);
  });

  it('SAD: missing tenant_id fails validation, no DB call', async () => {
    const { app, queries } = buildApp({ queryResponses: [] });

    const res = await post(app, {
      caller_name: 'Alice',
      message: 'Hello',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ success: boolean }>().success).toBe(false);
    expect(queries).toHaveLength(0);
  });

  it('SAD: empty message fails validation, no DB call', async () => {
    // WHO: Malformed request with a blank message body
    // WHAT: Zod min(1) on message rejects before DB
    const { app, queries } = buildApp({ queryResponses: [] });

    const res = await post(app, {
      tenant_id: TENANT_ID,
      caller_name: 'Alice',
      message: '',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ success: boolean }>().success).toBe(false);
    expect(queries).toHaveLength(0);
  });
});
