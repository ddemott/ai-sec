/**
 * POST /tenants/:id/update-config — call-routing loop guard.
 *
 * WHO: owner saving call-routing config. WHAT: the update-config route rejects
 * a forward_phone that collides with forwarded_from_phone or inbound_phone.
 * WHEN: on POST /tenants/:id/update-config. WHERE: the handler's loop guard
 * (src/routes/tenants.ts → phonesWouldLoop). WHY: prevents a transfer that
 * loops the live call back into the assistant (forward target == the line that
 * forwards INTO the AI, or == the AI's own DID).
 *
 * Uses the same mock-pg Fastify harness as tenant-routes.test.ts so the
 * loop guard is exercised through the real route + Zod validation.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerTenantRoutes } from '../../src/routes/tenants';
import {
  createMockClient,
  createMockPool,
  type MockClient,
  type MockResponse,
} from '../mock';

// Real v4 UUID — the route's tenant gate + Zod reject pattern fillers.
const TENANT_ID = 'd5e3c6a1-7b9f-4e2a-bf30-8c11a5d8e9f0';

let app: FastifyInstance;
let mockClient: MockClient;
let queryResponses: MockResponse[];
let queries: { text: string; params: unknown[] }[];
let authStub: {
  user_id: string;
  tenant_id: string;
  email: string;
  role: 'owner' | 'front_desk';
} | null;

function buildApp() {
  const handle = createMockClient();
  mockClient = handle.mockClient;
  queryResponses = handle.queryResponses;
  queries = handle.queries;
  const mockPool = createMockPool(mockClient);

  const fastify = Fastify({ logger: false });
  fastify.addHook('preHandler', async (request) => {
    (request as unknown as { auth: typeof authStub }).auth = authStub;
  });

  // Stand-in for withTenantClient — hands the mock client to the callback.
  const withTenantClient = async <T>(
    _tenantId: string,
    fn: (client: typeof mockClient) => Promise<T>
  ): Promise<T> => fn(mockClient);

  registerTenantRoutes(
    fastify,
    mockPool,
    withTenantClient as unknown as Parameters<typeof registerTenantRoutes>[2]
  );
  return fastify;
}

// A prior tenant row with every column the handler's FOR UPDATE select reads.
function priorRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    business_type: 'salon',
    system_prompt: null,
    voice_id: null,
    first_message: null,
    save_preferences_enabled: false,
    preferences_instructions: null,
    tts_voice: null,
    tts_speed: null,
    tts_soft: null,
    tts_cheerful: null,
    tts_formal: null,
    tts_warm: null,
    tts_concise: null,
    forward_phone: null,
    owner_phone: null,
    forwarded_from_phone: null,
    inbound_phone: null,
    ...overrides,
  };
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  queries.length = 0;
  queryResponses.length = 0;
  // Owner of TENANT_ID saving their own config (tenant-self gate passes).
  authStub = {
    user_id: 'owner-user',
    tenant_id: TENANT_ID,
    email: 'owner@test',
    role: 'owner',
  };
});

describe('POST /tenants/:id/update-config loop guard', () => {
  it('SAD: forward_phone == forwarded_from_phone (different format) → 400, no UPDATE', async () => {
    // WHO: owner whose published line forwards INTO the AI, mistakenly setting
    //      the same line as the "talk to a person" transfer target.
    // WHAT: the guard normalizes both to E.164, sees they match, ROLLBACKs and
    //      returns 400 with no UPDATE executed.
    // WHEN: the body's forward_phone normalizes equal to the stored
    //      forwarded_from_phone.
    // WHERE: src/routes/tenants.ts update-config → phonesWouldLoop.
    // WHY: transferring to the forwarding line forwards the call right back into
    //      the AI — an infinite loop the caller can never escape.
    queryResponses.push({ rows: [], rowCount: 0 }); // BEGIN
    queryResponses.push({
      rows: [priorRow({ forwarded_from_phone: '+16082175303', inbound_phone: '+16308229086' })],
      rowCount: 1,
    }); // SELECT FOR UPDATE
    queryResponses.push({ rows: [], rowCount: 0 }); // ROLLBACK

    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${TENANT_ID}/update-config`,
      payload: { forward_phone: '608-217-5303' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/loop the call back/i);
    expect(queries.some((q) => /UPDATE tenants SET/.test(q.text))).toBe(false);
  });

  it('SAD: forward_phone == inbound DID → 400', async () => {
    // WHO: owner setting the transfer target to the AI's own Telnyx DID.
    // WHAT: the guard matches forward_phone against inbound_phone and rejects.
    // WHEN: forward_phone normalizes equal to the stored inbound_phone.
    // WHERE: src/routes/tenants.ts update-config → phonesWouldLoop (inbound arm).
    // WHY: transferring to the AI's own number is a degenerate self-loop.
    queryResponses.push({ rows: [], rowCount: 0 }); // BEGIN
    queryResponses.push({
      rows: [priorRow({ forwarded_from_phone: null, inbound_phone: '+16308229086' })],
      rowCount: 1,
    }); // SELECT FOR UPDATE
    queryResponses.push({ rows: [], rowCount: 0 }); // ROLLBACK

    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${TENANT_ID}/update-config`,
      payload: { forward_phone: '+1 630 822 9086' },
    });

    expect(res.statusCode).toBe(400);
    expect(queries.some((q) => /UPDATE tenants SET/.test(q.text))).toBe(false);
  });

  it('HAPPY: distinct forward_phone + forwarded_from_phone → 200, both persisted', async () => {
    // WHO: owner whose forwarded line and human-transfer line are different
    //      numbers (the supported config).
    // WHAT: no loop → the UPDATE runs and forwarded_from_phone reaches param $16.
    // WHEN: the two numbers normalize distinct and neither equals inbound.
    // WHERE: src/routes/tenants.ts update-config → UPDATE tenants SET.
    // WHY: the guard must NOT block a legitimate distinct pairing — that would
    //      make the whole feature unusable.
    queryResponses.push({ rows: [], rowCount: 0 }); // BEGIN
    queryResponses.push({
      rows: [priorRow({ forwarded_from_phone: '+16082175303', inbound_phone: '+16308229086' })],
      rowCount: 1,
    }); // SELECT FOR UPDATE
    queryResponses.push({ rows: [{ tenant_id: TENANT_ID }], rowCount: 1 }); // UPDATE
    queryResponses.push({ rows: [], rowCount: 0 }); // COMMIT

    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${TENANT_ID}/update-config`,
      payload: { forward_phone: '+16305551234', forwarded_from_phone: '+16082175303' },
    });

    expect(res.statusCode).toBe(200);
    const updateQuery = queries.find((q) => q.text.includes('UPDATE tenants SET'));
    expect(updateQuery!.text).toContain('forwarded_from_phone');
    // Param order ends: ... forward_phone[13], owner_phone[14],
    // forwarded_from_phone[15], tenant_id[16].
    expect(updateQuery!.params[13]).toBe('+16305551234');
    expect(updateQuery!.params[15]).toBe('+16082175303');
  });
});
