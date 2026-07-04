/**
 * Tests for /agent-tools/page-owner — urgent mid-call SMS page to the owner.
 *
 * Verifies the pageability-first ordering (no DB write when the owner has no
 * SMS-capable number, so the LLM's take_message fallback can't double-record),
 * the "[URGENT PAGE]" customer_messages flag, and the SMS failure path.
 * sendSms is mocked at the module level to avoid real Telnyx calls.
 *
 * Query sequence per pageable call (when caller_phone provided):
 *   1. SELECT owner_phone, forward_phone, inbound_phone FROM tenants
 *   2. SELECT customer_id FROM customers (resolve link — optional)
 *   3. INSERT INTO customer_messages RETURNING message_id
 *
 * When the owner is NOT pageable, only query 1 fires.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';

import { registerAgentToolRoutes } from './routes/agentTools';

// Hoisted before imports — intercepts all sendSms calls inside agentTools.ts
vi.mock('./services/telnyxSms', () => ({
  sendSms: vi.fn(async () => ({ ok: true })),
  generateVerificationCode: vi.fn(() => '123456'),
}));

import * as telnyxSms from './services/telnyxSms';

const TENANT_ID = 'f234e471-0e60-4163-86c9-93cfd9338e3a';
const CUSTOMER_ID = 'dddddddd-0000-4000-8000-000000000004';
const MESSAGE_ID = 'aaaaaaaa-0000-4000-8000-000000000042';
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
    url: '/agent-tools/page-owner',
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

describe('/agent-tools/page-owner', () => {
  it('HAPPY: pages the owner and persists an [URGENT PAGE] customer_messages row', async () => {
    // WHO: Caller reporting something genuinely urgent (leak flooding the shop)
    // WHAT: Owner is pageable → customer_messages row with the [URGENT PAGE]
    //       prefix persists, SMS fires to owner_phone, paged:true returned
    // WHEN: Mid-call, the moment the agent judges the matter urgent
    // WHERE: src/routes/agentTools.ts page-owner toolRoute
    // WHY: An urgent page must be BOTH immediate (SMS) and durable (DB row)
    const { app, queries } = buildApp({
      queryResponses: [
        {
          rows: [
            { owner_phone: '+16082175303', forward_phone: null, inbound_phone: '+16308229086' },
          ],
        }, // tenant pageability check
        { rows: [{ customer_id: CUSTOMER_ID }] }, // customer lookup
        { rows: [{ message_id: MESSAGE_ID }] }, // INSERT customer_messages
      ],
    });

    vi.mocked(telnyxSms.sendSms).mockResolvedValueOnce({ ok: true });

    const res = await post(app, {
      tenant_id: TENANT_ID,
      caller_name: 'Alice Smith',
      caller_phone: '+15551112222',
      reason: 'water leak flooding the shop',
      call_id: 'sip-call-123',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      success: boolean;
      result: { paged: boolean; message_id: string };
    }>();
    expect(body.success).toBe(true);
    expect(body.result.paged).toBe(true);
    expect(body.result.message_id).toBe(MESSAGE_ID);

    const insert = queries.find((q) => q.text.includes('INSERT INTO customer_messages'));
    expect(insert).toBeDefined();
    expect(insert!.params).toContain('[URGENT PAGE] water leak flooding the shop');

    expect(vi.mocked(telnyxSms.sendSms)).toHaveBeenCalledOnce();
    const smsCall = vi.mocked(telnyxSms.sendSms).mock.calls[0][0];
    expect(smsCall.to).toBe('+16082175303'); // owner_phone preferred
    expect(smsCall.from).toBe('+16308229086');
    expect(smsCall.body).toContain('URGENT page from Alice Smith');
    expect(smsCall.body).toContain('water leak flooding the shop');
  });

  it('HAPPY: falls back to forward_phone when owner_phone is not set', async () => {
    // WHO: Tenant that only configured forward_phone (the take-message pattern)
    // WHAT: The page destination resolves owner_phone ?? forward_phone — same
    //       reuse of the take-message owner-notification path
    // WHY: Paging must work for every tenant take_message already works for
    const { app } = buildApp({
      queryResponses: [
        {
          rows: [
            { owner_phone: null, forward_phone: '+16082175303', inbound_phone: '+16308229086' },
          ],
        },
        { rows: [] }, // customer not found
        { rows: [{ message_id: MESSAGE_ID }] },
      ],
    });

    vi.mocked(telnyxSms.sendSms).mockResolvedValueOnce({ ok: true });

    const res = await post(app, {
      tenant_id: TENANT_ID,
      caller_name: 'Bob Jones',
      reason: 'angry customer threatening to leave',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ success: boolean }>().success).toBe(true);
    const smsCall = vi.mocked(telnyxSms.sendSms).mock.calls[0][0];
    expect(smsCall.to).toBe('+16082175303');
  });

  it('SAD: owner has no SMS-capable number → graceful error, NOTHING persisted', async () => {
    // WHO: Tenant with neither owner_phone nor forward_phone configured
    // WHAT: success:false with a "take a message instead" steer; no INSERT
    //       fires, so the LLM's take_message fallback can't double-record
    // WHEN: Pageability is checked BEFORE any write (ordering is the contract)
    // WHERE: page-owner pageability gate
    // WHY: The task contract: unpageable owner → graceful error the LLM relays
    const { app, queries } = buildApp({
      queryResponses: [
        { rows: [{ owner_phone: null, forward_phone: null, inbound_phone: '+16308229086' }] },
      ],
    });

    const res = await post(app, {
      tenant_id: TENANT_ID,
      caller_name: 'Carol Lin',
      reason: 'urgent supplier issue',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; error: string }>();
    expect(body.success).toBe(false);
    expect(body.error).toContain("doesn't have a text-capable number");
    expect(body.error).toContain('take a message');
    // Only the tenant pageability SELECT ran — no customer lookup, no INSERT.
    expect(queries).toHaveLength(1);
    expect(vi.mocked(telnyxSms.sendSms)).not.toHaveBeenCalled();
  });

  it('SAD: SMS send fails → success:false (owner NOT paged) but the row stays as a dashboard trace', async () => {
    // WHO: Pageable tenant whose Telnyx send errors mid-call
    // WHAT: The row is already persisted (dashboard trace) but the tool reports
    //       failure because the IMMEDIATE page — the whole point — didn't happen
    // WHERE: sendSms failure branch after the INSERT
    // WHY: Telling the LLM "paged" when the owner got nothing would be theater;
    //       it must pivot to take_message
    const { app, queries } = buildApp({
      queryResponses: [
        {
          rows: [
            { owner_phone: '+16082175303', forward_phone: null, inbound_phone: '+16308229086' },
          ],
        },
        { rows: [] },
        { rows: [{ message_id: MESSAGE_ID }] },
      ],
    });

    vi.mocked(telnyxSms.sendSms).mockResolvedValueOnce({ ok: false, error: 'Telnyx error' });

    const res = await post(app, {
      tenant_id: TENANT_ID,
      caller_name: 'Dave',
      reason: 'gas smell in the building',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; error: string }>();
    expect(body.success).toBe(false);
    expect(body.error).toContain("couldn't reach the owner");
    // The durable trace still landed.
    expect(queries.some((q) => q.text.includes('INSERT INTO customer_messages'))).toBe(true);
  });

  it('SAD: missing reason fails validation, no DB call', async () => {
    // WHO: Malformed request without the one-line reason
    // WHAT: Zod rejects before any DB query — no SELECT, no INSERT, no SMS
    // WHY: A page with no reason gives the owner nothing to act on
    const { app, queries } = buildApp({ queryResponses: [] });

    const res = await post(app, {
      tenant_id: TENANT_ID,
      caller_name: 'Eve',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ success: boolean }>().success).toBe(false);
    expect(queries).toHaveLength(0);
    expect(vi.mocked(telnyxSms.sendSms)).not.toHaveBeenCalled();
  });

  it('SAD: missing tenant_id fails validation, no DB call', async () => {
    // WHO: Malformed request missing tenant scope
    // WHAT: Zod rejects — tenant_id is the RLS key, nothing may run without it
    const { app, queries } = buildApp({ queryResponses: [] });

    const res = await post(app, {
      caller_name: 'Frank',
      reason: 'urgent',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ success: boolean }>().success).toBe(false);
    expect(queries).toHaveLength(0);
  });
});
