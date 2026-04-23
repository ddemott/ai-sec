/**
 * Tests for /agent-tools/* routes — the Fastify replacement for the
 * Supabase Edge Function that backs voice AI tool calls (Phase 2 of the
 * Vapi → LiveKit migration). Covers auth, validation, and the four
 * routes implemented so far (service-catalog, customer-context,
 * check-availability, policy-answer).
 *
 * Strategy: mock withTenantClient + getEmbedding, inject HTTP requests
 * via Fastify. Happy + sad paths with 5W diagnostics.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';

import { registerAgentToolRoutes } from './routes/agentTools';

// Zod v4's .uuid() requires a proper version/variant nibble, so these
// are real v4 UUIDs — not pattern fillers.
const TENANT_ID = 'f234e471-0e60-4163-86c9-93cfd9338e3a';
const RESOURCE_ID = 'a1b2c3d4-e5f6-4789-ab12-cdef34567890';
const SECRET = 'test-agent-secret';

interface MockQuery {
  text: string;
  params: unknown[];
}

function buildApp(opts: {
  queryResponses: Array<{ rows: unknown[]; rowCount?: number }>;
  embedding?: number[];
  normalizer?: (text: string) => Promise<string>;
}): { app: FastifyInstance; queries: MockQuery[] } {
  const queries: MockQuery[] = [];
  const responses = [...opts.queryResponses];

  const mockClient = {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      queries.push({ text, params: params || [] });
      return responses.shift() || { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  } as unknown as PoolClient;

  const withTenantClient = async <T>(
    _tenantId: string,
    fn: (client: PoolClient) => Promise<T>
  ): Promise<T> => fn(mockClient);

  const getEmbedding = async () => opts.embedding ?? new Array(1536).fill(0);

  const app = Fastify({ logger: false });
  registerAgentToolRoutes(
    app,
    {} as never,
    withTenantClient,
    getEmbedding,
    opts.normalizer
  );
  return { app, queries };
}

beforeEach(() => {
  process.env.AGENT_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.AGENT_SECRET;
  vi.restoreAllMocks();
});

describe('agentTools auth', () => {
  it('SAD: missing x-agent-secret header returns 401', async () => {
    // WHO: Random HTTP client hitting the agent tools without auth
    // WHAT: Must 401 — these routes bypass tenantMiddleware, so this is
    //        the only protection against public access
    // WHY: Leak would expose booking + customer-context to the internet
    const { app } = buildApp({ queryResponses: [] });
    const res = await app.inject({
      method: 'POST',
      url: '/agent-tools/service-catalog',
      payload: { tenant_id: TENANT_ID },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ success: false, error: 'Unauthorized' });
  });

  it('SAD: wrong x-agent-secret header returns 401', async () => {
    // WHAT: Any mismatch is treated as unauthorized (no timing-attack
    //        protection needed at this layer — rate limiting handles that)
    const { app } = buildApp({ queryResponses: [] });
    const res = await app.inject({
      method: 'POST',
      url: '/agent-tools/service-catalog',
      headers: { 'x-agent-secret': 'wrong' },
      payload: { tenant_id: TENANT_ID },
    });
    expect(res.statusCode).toBe(401);
  });

  it('SAD: unset AGENT_SECRET rejects everything (fail-closed)', async () => {
    // WHO: Misconfigured production where AGENT_SECRET never got set
    // WHAT: Must still reject — empty-matches-empty would be a vuln
    // WHY: Prior code that threw on startup was safer but broke local
    //        dev without the env var; this is the fail-closed compromise
    delete process.env.AGENT_SECRET;
    const { app } = buildApp({ queryResponses: [] });
    const res = await app.inject({
      method: 'POST',
      url: '/agent-tools/service-catalog',
      headers: { 'x-agent-secret': '' },
      payload: { tenant_id: TENANT_ID },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('agentTools /service-catalog', () => {
  it('HAPPY: returns services with expected columns', async () => {
    // WHO: LiveKit agent asked "what services do you offer?"
    // WHAT: Route should SELECT catalog columns, return them under result.services
    const { app, queries } = buildApp({
      queryResponses: [
        {
          rows: [
            { id: 'svc1', name: 'Oil Change', duration_minutes: 30, price: 45 },
            { id: 'svc2', name: 'Tire Rotation', duration_minutes: 45, price: 30 },
          ],
        },
      ],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/agent-tools/service-catalog',
      headers: { 'x-agent-secret': SECRET },
      payload: { tenant_id: TENANT_ID },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.result.services).toHaveLength(2);
    expect(body.result.services[0].name).toBe('Oil Change');
    // WHY: Must filter is_deleted — survey the generated SQL
    expect(queries[0].text).toContain('is_deleted = false');
    expect(queries[0].params).toEqual([TENANT_ID]);
  });

  it('SAD: missing tenant_id fails validation', async () => {
    // WHAT: Route should reject with a validation error, not hit DB
    const { app, queries } = buildApp({ queryResponses: [] });
    const res = await app.inject({
      method: 'POST',
      url: '/agent-tools/service-catalog',
      headers: { 'x-agent-secret': SECRET },
      payload: {},
    });
    expect(res.statusCode).toBe(200); // voice tools use conversational 200s
    expect(res.json()).toMatchObject({
      success: false,
      error: expect.stringContaining('Validation failed'),
    });
    expect(queries).toHaveLength(0); // never touched DB
  });

  it('SAD: non-UUID tenant_id fails validation', async () => {
    // WHO: Malformed tool-call argument from the LLM
    // WHAT: Fail at Zod, not at Postgres (clearer error for the agent)
    const { app, queries } = buildApp({ queryResponses: [] });
    const res = await app.inject({
      method: 'POST',
      url: '/agent-tools/service-catalog',
      headers: { 'x-agent-secret': SECRET },
      payload: { tenant_id: 'not-a-uuid' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(false);
    expect(queries).toHaveLength(0);
  });
});

describe('agentTools /customer-context', () => {
  it('HAPPY: existing customer returns name + joined summaries', async () => {
    // WHO: Returning customer calling back about their oil change
    // WHAT: Route should find them by normalized phone and stitch 3
    //        recent summaries together
    const { app, queries } = buildApp({
      queryResponses: [
        { rows: [{ id: 'cust1', name: 'Alice' }] },
        { rows: [{ summary: 'Booked oil change' }, { summary: 'Asked about winter tires' }] },
      ],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/agent-tools/customer-context',
      headers: { 'x-agent-secret': SECRET },
      payload: { tenant_id: TENANT_ID, phone: '5551234567' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toEqual({
      name: 'Alice',
      history: 'Booked oil change; Asked about winter tires',
    });
    // WHY: Phone must be normalized to +1 form before the lookup
    expect(queries[0].params).toEqual([TENANT_ID, '+15551234567']);
  });

  it('HAPPY: unknown customer returns "new caller" message', async () => {
    // WHO: First-time caller
    // WHAT: Route should short-circuit before the summaries query
    const { app, queries } = buildApp({
      queryResponses: [{ rows: [] }],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/agent-tools/customer-context',
      headers: { 'x-agent-secret': SECRET },
      payload: { tenant_id: TENANT_ID, phone: '5550000000' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toBe('New caller - no history found.');
    expect(queries).toHaveLength(1); // did not run summaries query
  });

  it('SAD: unnormalizable phone short-circuits to new-caller message', async () => {
    // WHO: Caller-ID was garbled — passes Zod (min 5 chars) but has
    //       fewer than 10 digits so normalizePhone returns null
    // WHAT: No DB lookup; treat as new caller immediately
    // WHY: Avoids wasted round-trip and prevents "+1"-style short numbers
    //       from matching spurious customer records
    const { app, queries } = buildApp({ queryResponses: [] });
    const res = await app.inject({
      method: 'POST',
      url: '/agent-tools/customer-context',
      headers: { 'x-agent-secret': SECRET },
      payload: { tenant_id: TENANT_ID, phone: 'abc123' },
    });
    expect(res.json().result).toBe('New caller - no history found.');
    expect(queries).toHaveLength(0);
  });
});

describe('agentTools /check-availability', () => {
  it('HAPPY: RPC returns available=true with local times', async () => {
    // WHO: Agent checking if 2pm next Friday is open
    // WHAT: First query fetches tenant timezone; second calls the RPC
    //        with zone-applied timestamps
    const { app, queries } = buildApp({
      queryResponses: [
        { rows: [{ timezone: 'America/Chicago' }] },
        {
          rows: [
            {
              available: true,
              tenant_timezone: 'America/Chicago',
              local_start: '2026-05-01 14:00',
              local_end: '2026-05-01 15:00',
            },
          ],
        },
      ],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/agent-tools/check-availability',
      headers: { 'x-agent-secret': SECRET },
      payload: {
        tenant_id: TENANT_ID,
        resource_id: RESOURCE_ID,
        start_time: '2026-05-01T14:00:00',
        end_time: '2026-05-01T15:00:00',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result.available).toBe(true);
    // WHY: RPC must receive zone-applied timestamps (-05:00 CDT in May)
    expect(queries[1].text).toContain('check_availability_with_tz');
    expect(queries[1].params[2]).toBe('2026-05-01T14:00:00-05:00');
    expect(queries[1].params[3]).toBe('2026-05-01T15:00:00-05:00');
  });

  it('SAD: end_time before start_time fails before hitting DB', async () => {
    // WHO: LLM passed the times reversed
    // WHAT: Route validates ordering before any DB query
    const { app, queries } = buildApp({ queryResponses: [] });
    const res = await app.inject({
      method: 'POST',
      url: '/agent-tools/check-availability',
      headers: { 'x-agent-secret': SECRET },
      payload: {
        tenant_id: TENANT_ID,
        resource_id: RESOURCE_ID,
        start_time: '2026-05-01T15:00:00',
        end_time: '2026-05-01T14:00:00',
      },
    });
    expect(res.json()).toMatchObject({
      success: false,
      error: 'End time must be after start time.',
    });
    expect(queries).toHaveLength(0);
  });

  it('SAD: unparseable date string fails before hitting DB', async () => {
    // WHAT: Date.parse NaN → conversational error, no DB call
    const { app, queries } = buildApp({ queryResponses: [] });
    const res = await app.inject({
      method: 'POST',
      url: '/agent-tools/check-availability',
      headers: { 'x-agent-secret': SECRET },
      payload: {
        tenant_id: TENANT_ID,
        resource_id: RESOURCE_ID,
        start_time: 'sometime next week',
        end_time: 'then plus an hour',
      },
    });
    expect(res.json().success).toBe(false);
    expect(res.json().error).toContain('Invalid date format');
    expect(queries).toHaveLength(0);
  });
});

describe('agentTools /policy-answer', () => {
  it('HAPPY: matches found returns joined context string', async () => {
    // WHO: Caller asking about cancellation policy
    // WHAT: Embedding-based RPC returns top matches; route joins them
    const { app, queries } = buildApp({
      queryResponses: [
        {
          rows: [
            { content: 'Cancellations require 24 hours notice.', similarity: 0.9 },
            { content: 'No-show fee is $25.', similarity: 0.8 },
          ],
        },
      ],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/agent-tools/policy-answer',
      headers: { 'x-agent-secret': SECRET },
      payload: { tenant_id: TENANT_ID, question: 'What is your cancellation policy?' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toContain('24 hours notice');
    expect(res.json().result).toContain('No-show fee');
    // WHY: RPC call receives JSON-stringified embedding vector
    expect(queries[0].text).toContain('search_tenant_docs_normalized');
  });

  it('HAPPY: no matches returns fallback message AND logs the gap', async () => {
    // WHO: Caller asking about something the KB doesn't cover
    // WHAT: Route should return the conversational fallback AND fire-
    //        and-forget an INSERT into unanswered_questions so the owner
    //        can fill the gap
    const { app, queries } = buildApp({
      queryResponses: [
        { rows: [] }, // embedding search returns nothing
        { rows: [] }, // INSERT into unanswered_questions (fire-and-forget)
      ],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/agent-tools/policy-answer',
      headers: { 'x-agent-secret': SECRET },
      payload: { tenant_id: TENANT_ID, question: 'Do you accept Dogecoin?' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toContain("don't have specific information");
    // Wait a tick for the fire-and-forget insert to enqueue
    await new Promise((r) => setImmediate(r));
    expect(queries.some((q) => q.text.includes('unanswered_questions'))).toBe(true);
  });

  it('HAPPY: uses normalizer when provided', async () => {
    // WHO: Phase 12E added a query normalizer in front of embedding gen
    // WHAT: If the normalizer is passed, it transforms the question
    //        before getEmbedding runs — proven by observing the fallback
    //        path with an empty result set
    const normalizer = vi.fn(async (text: string) => `normalized:${text}`);
    const { app } = buildApp({
      queryResponses: [{ rows: [{ content: 'match', similarity: 0.9 }] }],
      normalizer,
    });
    await app.inject({
      method: 'POST',
      url: '/agent-tools/policy-answer',
      headers: { 'x-agent-secret': SECRET },
      payload: { tenant_id: TENANT_ID, question: 'hours?' },
    });
    expect(normalizer).toHaveBeenCalledWith('hours?', {
      context: 'customer phone inquiry',
    });
  });

  it('SAD: empty question fails validation', async () => {
    // WHAT: Zod min(1) on question; no DB call
    const { app, queries } = buildApp({ queryResponses: [] });
    const res = await app.inject({
      method: 'POST',
      url: '/agent-tools/policy-answer',
      headers: { 'x-agent-secret': SECRET },
      payload: { tenant_id: TENANT_ID, question: '' },
    });
    expect(res.json().success).toBe(false);
    expect(queries).toHaveLength(0);
  });
});

describe('agentTools stubs', () => {
  it('SAD: book-appointment returns not-implemented (Phase 2 in progress)', async () => {
    // WHO: LiveKit agent trying to book before Phase 2 port is complete
    // WHAT: Return a validation-passed, not-yet-implemented response so
    //        the agent can relay a sensible message to the caller
    const { app } = buildApp({ queryResponses: [] });
    const res = await app.inject({
      method: 'POST',
      url: '/agent-tools/book-appointment',
      headers: { 'x-agent-secret': SECRET },
      payload: {
        tenant_id: TENANT_ID,
        resource_id: RESOURCE_ID,
        start_time: '2026-05-01T14:00:00',
        end_time: '2026-05-01T15:00:00',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      success: false,
      error: 'Not yet implemented: /agent-tools/book-appointment',
    });
  });
});
