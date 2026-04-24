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

/**
 * Inject a POST to an agent-tool path with the standard auth header.
 * Every test hits /agent-tools/* with the same method + header combination,
 * so collapsing that into one call keeps the URL + payload explicit at the
 * call site (which is the meaningful part) without repeating boilerplate.
 *
 * Pass `secret: ''` to test auth failures (omit for happy-path auth).
 */
function post(
  app: FastifyInstance,
  path: string,
  payload: unknown,
  opts: { secret?: string } = {}
) {
  const headers: Record<string, string> =
    opts.secret === undefined
      ? { 'x-agent-secret': SECRET }
      : opts.secret === ''
        ? {}
        : { 'x-agent-secret': opts.secret };
  return app.inject({ method: 'POST', url: path, headers, payload });
}

/**
 * Assert a "validation failed before any DB call" response shape.
 * Every SAD-path test that rejects malformed input asserts the same three
 * things: 200 status (conversational), success:false, and zero DB queries.
 */
function expectValidationFailure(
  res: { statusCode: number; json: () => { success: boolean; error?: string } },
  queries: MockQuery[]
) {
  expect(res.statusCode).toBe(200);
  expect(res.json().success).toBe(false);
  expect(queries).toHaveLength(0);
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
    const res = await post(app, '/agent-tools/service-catalog', { tenant_id: TENANT_ID });
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
    const res = await post(app, '/agent-tools/service-catalog', {});
    expectValidationFailure(res, queries);
    expect(res.json().error).toContain('Validation failed');
  });

  it('SAD: non-UUID tenant_id fails validation', async () => {
    // WHO: Malformed tool-call argument from the LLM
    // WHAT: Fail at Zod, not at Postgres (clearer error for the agent)
    const { app, queries } = buildApp({ queryResponses: [] });
    const res = await post(app, '/agent-tools/service-catalog', { tenant_id: 'not-a-uuid' });
    expectValidationFailure(res, queries);
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
    const res = await post(app, '/agent-tools/customer-context', { tenant_id: TENANT_ID, phone: '5551234567' });
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
    const res = await post(app, '/agent-tools/customer-context', { tenant_id: TENANT_ID, phone: '5550000000' });
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
    const res = await post(app, '/agent-tools/customer-context', { tenant_id: TENANT_ID, phone: 'abc123' });
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
    const res = await post(app, '/agent-tools/check-availability', {
      tenant_id: TENANT_ID,
      resource_id: RESOURCE_ID,
      start_time: '2026-05-01T14:00:00',
      end_time: '2026-05-01T15:00:00',
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
    const res = await post(app, '/agent-tools/check-availability', {
      tenant_id: TENANT_ID,
      resource_id: RESOURCE_ID,
      start_time: '2026-05-01T15:00:00',
      end_time: '2026-05-01T14:00:00',
    });
    expectValidationFailure(res, queries);
    expect(res.json().error).toBe('End time must be after start time.');
  });

  it('SAD: unparseable date string fails before hitting DB', async () => {
    // WHAT: Date.parse NaN → conversational error, no DB call
    const { app, queries } = buildApp({ queryResponses: [] });
    const res = await post(app, '/agent-tools/check-availability', {
      tenant_id: TENANT_ID,
      resource_id: RESOURCE_ID,
      start_time: 'sometime next week',
      end_time: 'then plus an hour',
    });
    expectValidationFailure(res, queries);
    expect(res.json().error).toContain('Invalid date format');
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
    const res = await post(app, '/agent-tools/policy-answer', { tenant_id: TENANT_ID, question: 'What is your cancellation policy?' });
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
    const res = await post(app, '/agent-tools/policy-answer', { tenant_id: TENANT_ID, question: 'Do you accept Dogecoin?' });
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
    await post(app, '/agent-tools/policy-answer', { tenant_id: TENANT_ID, question: 'hours?' });
    expect(normalizer).toHaveBeenCalledWith('hours?', {
      context: 'customer phone inquiry',
    });
  });

  it('SAD: empty question fails validation', async () => {
    // WHAT: Zod min(1) on question; no DB call
    const { app, queries } = buildApp({ queryResponses: [] });
    const res = await post(app, '/agent-tools/policy-answer', { tenant_id: TENANT_ID, question: '' });
    expectValidationFailure(res, queries);
  });
});

describe('agentTools /book-appointment', () => {
  it('HAPPY: new customer is upserted then booked atomically', async () => {
    // WHO: First-time caller — agent passes a phone number it has never seen
    // WHAT: Route must SELECT for existing customer, INSERT when not found,
    //        then call book_appointment_atomic with the new customer_id
    // WHY: Two-step upsert (vs. UPSERT ON CONFLICT) lets the route keep the
    //       existing customer name if one is already on file
    const { app, queries } = buildApp({
      queryResponses: [
        { rows: [] },                           // existing-customer SELECT
        { rows: [{ id: 'new-customer-id' }] },  // INSERT new customer
        {
          rows: [
            { success: true, appointment_id: 'appt-1', error_message: null },
          ],
        },
      ],
    });
    const res = await post(app, '/agent-tools/book-appointment', {
      tenant_id: TENANT_ID,
      resource_id: RESOURCE_ID,
      phone: '5551234567',
      name: 'Bob',
      start_time: '2026-05-01T14:00:00',
      end_time: '2026-05-01T15:00:00',
      });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      success: true,
      result: { success: true, appointment_id: 'appt-1' },
    });
    // WHY: Phone must be normalized (+15551234567) to match how we store
    //       customers — inconsistency would cause duplicate-customer bugs
    expect(queries[0].params).toEqual([TENANT_ID, '+15551234567']);
    expect(queries[1].params).toEqual([TENANT_ID, '+15551234567', 'Bob']);
    // WHY: RPC gets the newly-created customer_id
    expect(queries[2].text).toContain('book_appointment_atomic');
    expect(queries[2].params?.[2]).toBe('new-customer-id');
  });

  it('HAPPY: existing customer reuses id — no INSERT', async () => {
    // WHAT: Route must short-circuit the INSERT when SELECT returns a row
    const { app, queries } = buildApp({
      queryResponses: [
        { rows: [{ id: 'existing-cust' }] },
        {
          rows: [
            { success: true, appointment_id: 'appt-2', error_message: null },
          ],
        },
      ],
    });
    const res = await post(app, '/agent-tools/book-appointment', {
      tenant_id: TENANT_ID,
      resource_id: RESOURCE_ID,
      phone: '5551234567',
      start_time: '2026-05-01T14:00:00',
      end_time: '2026-05-01T15:00:00',
      });
    expect(res.json().result.appointment_id).toBe('appt-2');
    // WHY: Exactly 2 queries — SELECT + RPC, no INSERT
    expect(queries).toHaveLength(2);
    expect(queries[1].params?.[2]).toBe('existing-cust');
  });

  it('SAD: RPC failure is surfaced verbatim so the agent can relay it', async () => {
    // WHO: Caller requesting a slot that just got taken
    // WHAT: Route must return { success: false, error: <RPC message> } at 200
    // WHY: Voice flow needs a string the LLM can speak — not an HTTP 500
    const { app } = buildApp({
      queryResponses: [
        { rows: [{ id: 'c1' }] },
        {
          rows: [
            {
              success: false,
              appointment_id: null,
              error_message: 'That time slot just got booked by another customer.',
            },
          ],
        },
      ],
    });
    const res = await post(app, '/agent-tools/book-appointment', {
      tenant_id: TENANT_ID,
      resource_id: RESOURCE_ID,
      phone: '5551234567',
      start_time: '2026-05-01T14:00:00',
      end_time: '2026-05-01T15:00:00',
      });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      success: false,
      error: 'That time slot just got booked by another customer.',
    });
  });

  it('SAD: invalid UUID fails validation before any DB call', async () => {
    const { app, queries } = buildApp({ queryResponses: [] });
    const res = await post(app, '/agent-tools/book-appointment', {
      tenant_id: 'not-a-uuid',
      resource_id: RESOURCE_ID,
      start_time: '2026-05-01T14:00:00',
      end_time: '2026-05-01T15:00:00',
    });
    expectValidationFailure(res, queries);
  });

  it('SAD: empty phone is rejected at the gate — no DB, LLM is told to ask', async () => {
    // WHO: Caller came in anonymously and no phone has been captured yet
    // WHAT: Route rejects with an ask-for-phone message before any DB
    //        call; the LLM agent reads this and pivots to the OTP flow
    //        (ask verbally, /send-verification-code, /verify-phone-code)
    // WHERE: /agent-tools/book-appointment when args.phone is empty
    //         (was previously the "anonymous booking" happy path)
    // WHEN: Policy decided 2026-04-23 — valid phone required for bookings
    //        so we can confirm, reschedule, and reach the caller if needed
    // WHY: Prior behavior would INSERT an empty-phone customer record,
    //        which muddied downstream CRM sync and made callback impossible
    const { app, queries } = buildApp({ queryResponses: [] });
    const res = await post(app, '/agent-tools/book-appointment', {
      tenant_id: TENANT_ID,
      resource_id: RESOURCE_ID,
      phone: '',
      start_time: '2026-05-01T14:00:00',
      end_time: '2026-05-01T15:00:00',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(false);
    expect(res.json().error).toContain('good phone number');
    // Critical: zero DB activity. The old code would have SELECTed+INSERTed.
    expect(queries).toHaveLength(0);
  });

  it('SAD: garbled phone (passes Zod min(5) but < 10 digits) is rejected at the gate', async () => {
    // WHO: LLM hallucinated a phone like 'abc123' or caller-ID came
    //       through as '+1' from a blocked-number carrier
    // WHAT: Route rejects — same gate as empty phone — so the OTP flow
    //        kicks in and the caller is asked verbally
    // WHY: Without this, 'abc123' would reach the customer SELECT and
    //        then get INSERTed as a phone value. Data quality disaster.
    const { app, queries } = buildApp({ queryResponses: [] });
    const res = await post(app, '/agent-tools/book-appointment', {
      tenant_id: TENANT_ID,
      resource_id: RESOURCE_ID,
      phone: 'abc123',
      start_time: '2026-05-01T14:00:00',
      end_time: '2026-05-01T15:00:00',
    });
    expect(res.json().success).toBe(false);
    expect(res.json().error).toContain('good phone number');
    expect(queries).toHaveLength(0);
  });

  it('SAD: 7-digit phone (caller read back without area code) is rejected at the gate', async () => {
    // WHO: Caller provided a local 7-digit number verbally after the
    //       agent asked — the /verify-phone-code flow confirmed it via
    //       SMS, BUT if somehow a partial number sneaks through (agent
    //       bug, OTP flow bypassed), this gate is the last line of defense
    // WHAT: Gate must reject any phone with fewer than 10 digits no
    //        matter how it got here — bookings require a full phone
    // WHY: The OTP flow is the primary guard; this test pins the gate
    //        as a belt-AND-suspenders check that a partial number can
    //        never end up in a booking even if other layers fail
    const { app, queries } = buildApp({ queryResponses: [] });
    const res = await post(app, '/agent-tools/book-appointment', {
      tenant_id: TENANT_ID,
      resource_id: RESOURCE_ID,
      phone: '5551234', // 7 digits
      start_time: '2026-05-01T14:00:00',
      end_time: '2026-05-01T15:00:00',
    });
    expect(res.json().success).toBe(false);
    expect(res.json().error).toContain('good phone number');
    expect(queries).toHaveLength(0);
  });
});

describe('agentTools /scheduling-options', () => {
  it('HAPPY: returns options + diagnostics for a satisfiable request', async () => {
    // WHO: Agent asking "what do we have Friday morning for an oil change?"
    // WHAT: Route loads resources/employees/appointments/shifts, runs the
    //        shared selector, returns option list + diagnostics
    const { app } = buildApp({
      queryResponses: [
        { rows: [{ id: 'bay-1', capabilities: ['lift', 'oil'] }] },
        { rows: [{ id: 'emp-1', skills: ['oil_change'] }] },
        { rows: [] }, // no existing appointments
        {
          rows: [
            {
              employee_id: 'emp-1',
              start_time: '08:00:00',
              end_time: '17:00:00',
              is_off: false,
            },
          ],
        },
      ],
    });
    const res = await post(app, '/agent-tools/scheduling-options', {
      tenant_id: TENANT_ID,
      requirements: {
        serviceType: 'Oil Change',
        requiredResourceCapabilities: ['oil'],
        requiredEmployeeSkills: ['oil_change'],
      },
      window: { from: '2026-05-01T14:00:00Z', to: '2026-05-01T15:00:00Z' },
      });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.result.options).toEqual([{ resourceId: 'bay-1', employeeId: 'emp-1' }]);
    expect(body.result.diagnostics.reason).toBe('ok');
  });

  it('HAPPY: empty options carry a diagnostic reason', async () => {
    // WHO: Agent asking for a skill nobody has
    // WHAT: Options must be empty; diagnostics.reason must say *why*
    // WHY: The agent reads the reason aloud to steer the caller
    const { app } = buildApp({
      queryResponses: [
        { rows: [{ id: 'bay-1', capabilities: ['lift'] }] },
        { rows: [{ id: 'emp-1', skills: ['oil_change'] }] }, // lacks tire_rotation
        { rows: [] },
        {
          rows: [
            {
              employee_id: 'emp-1',
              start_time: '08:00:00',
              end_time: '17:00:00',
              is_off: false,
            },
          ],
        },
      ],
    });
    const res = await post(app, '/agent-tools/scheduling-options', {
      tenant_id: TENANT_ID,
      requirements: {
        serviceType: 'Tire Rotation',
        requiredEmployeeSkills: ['tire_rotation'],
      },
      window: { from: '2026-05-01T14:00:00Z', to: '2026-05-01T15:00:00Z' },
      });
    const body = res.json();
    expect(body.result.options).toEqual([]);
    expect(body.result.diagnostics.reason).toContain('tire_rotation');
  });

  it('SAD: reversed window fails before any DB call', async () => {
    const { app, queries } = buildApp({ queryResponses: [] });
    const res = await post(app, '/agent-tools/scheduling-options', {
      tenant_id: TENANT_ID,
      requirements: { serviceType: 'Oil Change' },
      window: { from: '2026-05-01T15:00:00Z', to: '2026-05-01T14:00:00Z' },
    });
    expectValidationFailure(res, queries);
    expect(res.json().error).toBe('Window end must be after window start.');
  });

  it('HAPPY: employee with is_off=true override is excluded from options', async () => {
    // WHO: Owner marked Jane as "off" for May 1 via the dashboard's
    //       date-override UI — that row lands in employee_schedule with
    //       is_off=true and null start/end times
    // WHAT: The is_off override must propagate through the route's
    //        filter (s.is_off || (s.start_time && s.end_time)) into
    //        shiftOverrides, and selectAssignments must then exclude Jane
    // WHERE: /agent-tools/scheduling-options on the day Jane is off
    // WHEN: Any booking request for a service only Jane is skilled at
    // WHY: If this filter chain breaks, we'd tell the agent Jane is
    //        available — and the downstream book call would then 500 or
    //        worse, actually book her on her day off. High-blast-radius
    //        bug; must be pinned.
    const { app } = buildApp({
      queryResponses: [
        { rows: [{ id: 'bay-1', capabilities: ['oil'] }] },
        { rows: [{ id: 'emp-1', skills: ['oil_change'] }] },
        { rows: [] }, // no existing appointments
        {
          rows: [
            {
              employee_id: 'emp-1',
              start_time: null,
              end_time: null,
              is_off: true,
            },
          ],
        },
      ],
    });
    const res = await post(app, '/agent-tools/scheduling-options', {
      tenant_id: TENANT_ID,
      requirements: {
        serviceType: 'Oil Change',
        requiredResourceCapabilities: ['oil'],
        requiredEmployeeSkills: ['oil_change'],
      },
      window: { from: '2026-05-01T14:00:00Z', to: '2026-05-01T15:00:00Z' },
      });
    const body = res.json();
    expect(body.result.options).toEqual([]);
    // WHY: Diagnostics must explain *why* — this is the signal the agent
    //       uses to ask "would another day work?" instead of guessing
    expect(body.result.diagnostics.onShiftEmployees).toBe(0);
    expect(body.result.diagnostics.skilledEmployees).toBe(1);
    expect(body.result.diagnostics.reason).toContain('off-shift');
  });

  it('SAD: override with null times AND is_off=false is treated as no coverage', async () => {
    // WHO: Defensive path — a malformed override row with is_off=false and
    //       null start/end times somehow reaches us (shouldn't happen but
    //       has shown up in prod data before)
    // WHAT: The route's filter `s.is_off || (s.start_time && s.end_time)`
    //        must drop this row from shiftOverrides; with overrides empty
    //        and shifts empty, selectAssignments considers the employee
    //        on-shift-by-default — which would be wrong
    // WHERE: /agent-tools/scheduling-options when the DB returns garbage
    // WHY: Pinning this test documents the current behavior: we fall back
    //        to "on shift by default" when there's zero scheduling data.
    //        If we ever tighten that default, this test should flip to
    //        the opposite assertion — the test becomes a canary for the
    //        policy change rather than a silent regression.
    const { app } = buildApp({
      queryResponses: [
        { rows: [{ id: 'bay-1', capabilities: ['oil'] }] },
        { rows: [{ id: 'emp-1', skills: ['oil_change'] }] },
        { rows: [] },
        {
          rows: [
            {
              employee_id: 'emp-1',
              start_time: null,
              end_time: null,
              is_off: false,
            },
          ],
        },
      ],
    });
    const res = await post(app, '/agent-tools/scheduling-options', {
      tenant_id: TENANT_ID,
      requirements: {
        serviceType: 'Oil Change',
        requiredResourceCapabilities: ['oil'],
        requiredEmployeeSkills: ['oil_change'],
      },
      window: { from: '2026-05-01T14:00:00Z', to: '2026-05-01T15:00:00Z' },
      });
    const body = res.json();
    // Garbage row filtered → no overrides → no shifts → default on-shift=true
    // Current behavior: employee IS included. This documents that behavior.
    expect(body.result.options).toEqual([
      { resourceId: 'bay-1', employeeId: 'emp-1' },
    ]);
  });
});

describe('agentTools /book-with-scheduling', () => {
  it('HAPPY: RPC returns success with resource + employee names', async () => {
    // WHO: Happy-path booking where the RPC found a matching slot
    // WHAT: Route returns the booked details for the agent to confirm aloud
    const { app, queries } = buildApp({
      queryResponses: [
        {
          rows: [
            {
              success: true,
              appointment_id: 'appt-9',
              resource_id: 'bay-1',
              resource_name: 'Bay 1',
              employee_id: 'emp-1',
              employee_name: 'Jane',
              booked_start: '2026-05-01T14:00:00Z',
              booked_end: '2026-05-01T15:00:00Z',
              customer_id: 'cust-1',
              error_message: null,
              error_code: null,
            },
          ],
        },
      ],
    });
    const res = await post(app, '/agent-tools/book-with-scheduling', {
      tenant_id: TENANT_ID,
      phone: '5551234567',
      name: 'Bob',
      requirements: { serviceType: 'Oil Change', requiredEmployeeSkills: ['oil_change'] },
      window: { from: '2026-05-01T14:00:00Z', to: '2026-05-01T15:00:00Z' },
      });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toMatchObject({
      success: true,
      appointment_id: 'appt-9',
      resource_name: 'Bay 1',
      employee_name: 'Jane',
    });
    // WHY: Normalized phone must reach the RPC so the customer upsert path
    //       inside it matches previously-stored records
    expect(queries[0].params?.[1]).toBe('+15551234567');
  });

  it('SAD: RPC error_code is surfaced so the agent can be specific', async () => {
    // WHO: Caller requesting a slot that's already taken
    // WHAT: Route must include error_code: 'TIMESLOT_OCCUPIED' in response
    // WHY: BUG-064 — agent needs to say "that slot is taken" specifically,
    //       not the generic "no availability" fallback
    const { app } = buildApp({
      queryResponses: [
        {
          rows: [
            {
              success: false,
              appointment_id: null,
              resource_id: null,
              resource_name: null,
              employee_id: null,
              employee_name: null,
              booked_start: null,
              booked_end: null,
              customer_id: null,
              error_message: 'That time slot is already booked.',
              error_code: 'TIMESLOT_OCCUPIED',
            },
          ],
        },
      ],
    });
    const res = await post(app, '/agent-tools/book-with-scheduling', {
      tenant_id: TENANT_ID,
      phone: '5551234567',
      requirements: { serviceType: 'Oil Change' },
      window: { from: '2026-05-01T14:00:00Z', to: '2026-05-01T15:00:00Z' },
      });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      success: false,
      error: 'That time slot is already booked.',
      error_code: 'TIMESLOT_OCCUPIED',
    });
  });

  it('SAD: missing RPC row falls back to NO_AVAILABILITY', async () => {
    // WHO: RPC returned nothing (should not happen, but be defensive)
    // WHAT: Route must never crash the agent — fall back cleanly
    const { app } = buildApp({ queryResponses: [{ rows: [] }] });
    const res = await post(app, '/agent-tools/book-with-scheduling', {
      tenant_id: TENANT_ID,
      phone: '5551234567',
      requirements: { serviceType: 'Oil Change' },
      window: { from: '2026-05-01T14:00:00Z', to: '2026-05-01T15:00:00Z' },
      });
    expect(res.json().error_code).toBe('NO_AVAILABILITY');
  });

  it('SAD: invalid phone is rejected at the gate before the RPC is called', async () => {
    // WHO: Agent called book-with-scheduling with a blocked caller-ID
    //       phone (came through as '+1' after digit-strip)
    // WHAT: Route rejects with the ask-for-phone message — same gate as
    //        book-appointment, consistent policy across both routes
    // WHY: Without the gate the RPC would receive the raw unvalidated
    //        string and either fail internally or store garbage
    const { app, queries } = buildApp({ queryResponses: [] });
    const res = await post(app, '/agent-tools/book-with-scheduling', {
      tenant_id: TENANT_ID,
      phone: '+1',
      requirements: { serviceType: 'Oil Change' },
      window: { from: '2026-05-01T14:00:00Z', to: '2026-05-01T15:00:00Z' },
    });
    expect(res.json().success).toBe(false);
    expect(res.json().error).toContain('good phone number');
    expect(queries).toHaveLength(0);
  });
});

describe('agentTools /available-slots', () => {
  it('HAPPY: produces spoken slot string with service + open windows', async () => {
    // WHO: Caller asking "when can you fit me in for an oil change Friday?"
    // WHAT: Single union-all returns service row + shift rows + appointment
    //        rows; route merges shifts, subtracts bookings, speaks result
    const { app, queries } = buildApp({
      queryResponses: [
        {
          rows: [
            // service row
            {
              source: 'service',
              name: 'Oil Change',
              duration_minutes: 30,
              price: 45,
              start_time: null,
              end_time: null,
            },
            // one shift 08:00-17:00
            {
              source: 'shift',
              name: null,
              duration_minutes: null,
              price: null,
              start_time: '08:00:00',
              end_time: '17:00:00',
            },
            // one appointment 12:00-13:00 blocks lunch slot
            {
              source: 'appointment',
              name: null,
              duration_minutes: null,
              price: null,
              start_time: '2030-01-01T12:00:00',
              end_time: '2030-01-01T13:00:00',
            },
          ],
        },
      ],
    });
    // Use a far-future date so "today" filtering doesn't kick in
    const res = await post(app, '/agent-tools/available-slots', {
      tenant_id: TENANT_ID,
      service_type: 'Oil Change',
      date: '2030-01-01',
      });
    expect(res.statusCode).toBe(200);
    const text = res.json().result as string;
    expect(text).toContain('Oil Change takes about 30 minutes');
    expect(text).toContain('$45');
    // WHY: The 12-13 appointment splits the day into 8-12 and 13-17
    expect(text).toMatch(/8 AM to 12 PM/);
    expect(text).toMatch(/1 PM to 5 PM/);
    expect(queries[0].params).toEqual([TENANT_ID, 'Oil Change', '2030-01-01']);
  });

  it('HAPPY: no shifts for the day returns "no one scheduled" message', async () => {
    // WHAT: If the shift array is empty, short-circuit with a friendly
    //        message before doing interval math
    const { app } = buildApp({
      queryResponses: [
        {
          rows: [
            {
              source: 'service',
              name: 'Oil Change',
              duration_minutes: 30,
              price: null,
              start_time: null,
              end_time: null,
            },
          ],
        },
      ],
    });
    const res = await post(app, '/agent-tools/available-slots', {
      tenant_id: TENANT_ID,
      service_type: 'Oil Change',
      date: '2030-01-01',
      });
    const text = res.json().result as string;
    expect(text).toContain("don't have anyone scheduled");
  });

  it('SAD: unknown service returns catalog-suggestion message', async () => {
    // WHO: Agent asked about a service that doesn't exist in the tenant
    //       catalog (LLM hallucination or typo from the caller)
    const { app } = buildApp({ queryResponses: [{ rows: [] }] });
    const res = await post(app, '/agent-tools/available-slots', {
      tenant_id: TENANT_ID,
      service_type: 'Unicorn Polishing',
      date: '2030-01-01',
      });
    expect(res.json().result).toContain("couldn't find a service");
  });

  it('SAD: malformed date fails Zod regex before DB call', async () => {
    const { app, queries } = buildApp({ queryResponses: [] });
    const res = await post(app, '/agent-tools/available-slots', {
      tenant_id: TENANT_ID,
      service_type: 'Oil Change',
      date: 'tomorrow',
    });
    expectValidationFailure(res, queries);
  });

  it('HAPPY: today + partial day elapsed → only future slots quoted', async () => {
    // WHO: Caller at 2:30 PM asking "can I come in today for an oil change?"
    // WHAT: Shift is 8 AM–5 PM with no bookings. Naive logic would offer
    //        "8 AM to 5 PM"; correct logic offers only "2:30 PM to 5 PM"
    //        because AM is already past
    // WHERE: /agent-tools/available-slots when args.date === today's date
    //         in en-CA (YYYY-MM-DD) format
    // WHEN: The date matches today — `isToday` branch activates and
    //        currentMinutes is clamped to the floor of each usable slot
    // WHY: Quoting a past slot is the single worst UX failure here — the
    //        caller could agree to "8 AM" and then the booking RPC would
    //        reject it. This test nails down the time-of-day filter
    //        against a mocked system clock.
    vi.useFakeTimers({ toFake: ['Date'] });
    // Local-time-constructed Date: 2:30 PM on June 15, 2030 in whatever TZ
    // the test runner uses. `toLocaleDateString('en-CA')` then returns the
    // matching YYYY-MM-DD string, so isToday flips true.
    vi.setSystemTime(new Date(2030, 5, 15, 14, 30, 0));
    try {
      const { app } = buildApp({
        queryResponses: [
          {
            rows: [
              {
                source: 'service',
                name: 'Oil Change',
                duration_minutes: 30,
                price: null,
                start_time: null,
                end_time: null,
              },
              {
                source: 'shift',
                name: null,
                duration_minutes: null,
                price: null,
                start_time: '08:00:00',
                end_time: '17:00:00',
              },
            ],
          },
        ],
      });
      const res = await post(app, '/agent-tools/available-slots', {
        tenant_id: TENANT_ID,
        service_type: 'Oil Change',
        date: '2030-06-15',
      });
      const text = res.json().result as string;
      // The response has two phrases: "our hours are X to Y" (full coverage
      // for context) and "We have openings ..." (only the future slots).
      // The today filter is ONLY about the openings phrase — the context
      // hours line legitimately quotes the shift's full span.
      expect(text).toMatch(/We have openings 2:30 PM to 5 PM/);
      expect(text).not.toMatch(/openings 8 AM/);
      expect(text).not.toMatch(/openings all day from 8/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('SAD: today + whole day elapsed → "fully booked" message (not a crash)', async () => {
    // WHO: Caller at 6 PM asking "any chance today?" for a shop that
    //       closes at 5 PM
    // WHAT: All usable slots fall before currentMinutes → futureSlots is
    //        empty → route must return the "fully booked" fallback
    //        instead of crashing on an empty array index
    // WHERE: /agent-tools/available-slots, today's date
    // WHEN: Current time ≥ coverage[coverage.length-1].end
    // WHY: Before this test existed, nothing exercised the empty-
    //       futureSlots branch on the isToday path. A bug there would
    //       throw on `coverage[0].start` access and return HTTP 500 mid-
    //       call — the agent would hear a tool error and confuse the
    //       caller. This pins the graceful-fallback behavior.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2030, 5, 15, 18, 0, 0)); // 6 PM, shop closed
    try {
      const { app } = buildApp({
        queryResponses: [
          {
            rows: [
              {
                source: 'service',
                name: 'Oil Change',
                duration_minutes: 30,
                price: null,
                start_time: null,
                end_time: null,
              },
              {
                source: 'shift',
                name: null,
                duration_minutes: null,
                price: null,
                start_time: '08:00:00',
                end_time: '17:00:00',
              },
            ],
          },
        ],
      });
      const res = await post(app, '/agent-tools/available-slots', {
        tenant_id: TENANT_ID,
        service_type: 'Oil Change',
        date: '2030-06-15',
      });
      expect(res.statusCode).toBe(200);
      const text = res.json().result as string;
      expect(text).toContain("fully booked");
      expect(text).toContain('try a different day');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('agentTools /send-verification-code', () => {
  beforeEach(() => {
    process.env.TELNYX_API_KEY = 'test-telnyx-key';
    // Default fetch mock: Telnyx returns 200
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  });
  afterEach(() => {
    delete process.env.TELNYX_API_KEY;
  });

  it('HAPPY: valid phone under rate limits → inserts row, sends SMS, returns script', async () => {
    // WHO: Caller gave a phone number verbally after caller-ID was blocked
    // WHAT: Route looks up tenant's inbound_phone, checks both rate limits
    //        are under threshold, INSERTs a phone_verifications row, and
    //        sends the Telnyx SMS with the code
    // WHY: Wire-level contract — the agent relays the returned `message`
    //        verbatim so the SMS body and the spoken prompt must stay in
    //        lockstep with the TCPA opt-out language
    const { app, queries } = buildApp({
      queryResponses: [
        { rows: [{ inbound_phone: '+15550001000' }] }, // tenant lookup
        { rows: [{ c: '0' }] }, // per-phone count (0 sends in last hour)
        { rows: [{ c: '5' }] }, // per-tenant count (well under 100/day)
        { rows: [{ id: 'verif-1' }] }, // INSERT phone_verifications
      ],
    });
    const res = await post(app, '/agent-tools/send-verification-code', {
      tenant_id: TENANT_ID,
      phone: '5551234567',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.result.sent).toBe(true);
    expect(body.result.phone).toBe('+15551234567');
    expect(body.result.message).toContain('read it back');

    // Queries: tenant lookup, rate-limit counts, INSERT. bcrypt call is
    // not a client.query so it doesn't appear in queries[].
    expect(queries).toHaveLength(4);
    expect(queries[3].text).toContain('INSERT INTO phone_verifications');

    // SMS was sent with the correct shape
    const fetchCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(fetchCalls).toHaveLength(1);
    const smsBody = JSON.parse((fetchCalls[0][1] as RequestInit).body as string);
    expect(smsBody.from).toBe('+15550001000');
    expect(smsBody.to).toBe('+15551234567');
    expect(smsBody.text).toMatch(/Your SecretaryHQ verification code is: \d{6}\. Reply STOP to opt out\./);
  });

  it('SAD: invalid phone (under 10 digits after strip) never touches DB or Telnyx', async () => {
    // WHO: LLM passed a garbled phone like "abc123"
    // WHAT: Route rejects before any side effect — the agent hears the
    //        "couldn't catch that number" message and re-prompts the caller
    // WHY: Defensive — if this branch didn't exist the invalid phone would
    //        reach the SMS send and either fail at Telnyx or (worse) send
    //        to whatever string the LLM hallucinated
    const { app, queries } = buildApp({ queryResponses: [] });
    const res = await post(app, '/agent-tools/send-verification-code', {
      tenant_id: TENANT_ID,
      phone: 'abc123',
    });
    expect(res.json().success).toBe(false);
    expect(res.json().error).toContain('area code');
    expect(queries).toHaveLength(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('SAD: caller read back a 7-digit local number (no area code) — rejected', async () => {
    // WHO: Caller says "my number is five-five-five, one-two-three-four"
    //       and the LLM dutifully passes "5551234" (7 digits) to the tool
    // WHAT: Route must reject because we can't actually text a 7-digit
    //        string — SMS routing requires area code. Re-prompt with
    //        "starting with the area code" so the LLM asks the caller again.
    // WHERE: /agent-tools/send-verification-code — this is the exact moment
    //         a caller reads a phone number aloud for verification
    // WHEN: Every time caller-ID is blocked/garbled and we ask verbally
    // WHY: Policy established 2026-04-23 — a phone number must be full
    //        (10+ digits) before we'll text a code. Without this test,
    //        a 7-digit number could silently reach Telnyx and either
    //        be rejected there (dead-air UX) or sent to the wrong recipient
    //        if some carrier happened to route it.
    const { app, queries } = buildApp({ queryResponses: [] });
    const res = await post(app, '/agent-tools/send-verification-code', {
      tenant_id: TENANT_ID,
      phone: '5551234', // 7 digits — local number, caller forgot area code
    });
    expect(res.json().success).toBe(false);
    expect(res.json().error).toContain('area code');
    expect(queries).toHaveLength(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('SAD: 9-digit number (one digit missed in transcription) — rejected', async () => {
    // WHO: STT dropped a digit — caller said 10, transcript has 9
    // WHAT: Same gate catches this as the 7-digit case; we don't send a
    //        code to a short-one number that would resolve to some other
    //        party's phone
    // WHY: Different mechanism than the 7-digit case (transcription loss
    //        vs. caller omission) but same outcome — reject, re-ask. Tests
    //        both endpoints of the < 10-digit space so the whole branch
    //        is pinned.
    const { app, queries } = buildApp({ queryResponses: [] });
    const res = await post(app, '/agent-tools/send-verification-code', {
      tenant_id: TENANT_ID,
      phone: '555123456', // 9 digits
    });
    expect(res.json().success).toBe(false);
    expect(res.json().error).toContain('area code');
    expect(queries).toHaveLength(0);
  });

  it('SAD: rate-limited per-phone → refuses, offers to take a message', async () => {
    // WHO: Same number has already received 3 codes in the last hour
    //       (possibly a retry loop, possibly abuse)
    // WHAT: Route must not send a 4th — returns a graceful message the
    //        agent can relay to pivot to "take a message" flow
    // WHY: Without this, we become a free SMS relay — cost + abuse risk
    const { app, queries } = buildApp({
      queryResponses: [
        { rows: [{ inbound_phone: '+15550001000' }] }, // tenant
        { rows: [{ c: '3' }] }, // already 3 sends this hour
      ],
    });
    const res = await post(app, '/agent-tools/send-verification-code', {
      tenant_id: TENANT_ID,
      phone: '5551234567',
    });
    expect(res.json().success).toBe(false);
    expect(res.json().error).toContain('take a message');
    // No INSERT, no SMS
    expect(queries).toHaveLength(2); // tenant + phone count only
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('SAD: rate-limited per-tenant → refuses even if per-phone count is fine', async () => {
    // WHO: A single tenant has blown past 100 SMS sends in a day (either
    //       a busy day or a bug/abuse spiking volume)
    // WHAT: Route caps at the tenant level too — not just per-phone
    // WHY: Prevents a single tenant's bug/compromise from racking up a
    //       multi-hundred-dollar SMS bill before anyone notices
    const { app, queries } = buildApp({
      queryResponses: [
        { rows: [{ inbound_phone: '+15550001000' }] },
        { rows: [{ c: '0' }] }, // per-phone under limit
        { rows: [{ c: '100' }] }, // per-tenant at limit
      ],
    });
    const res = await post(app, '/agent-tools/send-verification-code', {
      tenant_id: TENANT_ID,
      phone: '5551234567',
    });
    expect(res.json().success).toBe(false);
    expect(res.json().error).toContain('take a message');
    expect(queries).toHaveLength(3);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('SAD: tenant has no inbound_phone configured → cannot send from', async () => {
    // WHO: Newly-provisioned tenant whose Telnyx number activation hasn't
    //       completed yet, or an admin removed it
    // WHAT: Route must handle this cleanly — the SMS API requires a
    //        validated `from` number and will 422 without one
    const { app, queries } = buildApp({
      queryResponses: [{ rows: [{ inbound_phone: null }] }],
    });
    const res = await post(app, '/agent-tools/send-verification-code', {
      tenant_id: TENANT_ID,
      phone: '5551234567',
    });
    expect(res.json().success).toBe(false);
    expect(res.json().error).toContain("can't send a text");
    expect(queries).toHaveLength(1); // tenant only, no rate-limit or INSERT
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('SAD: Telnyx send failure surfaces a graceful message to the caller', async () => {
    // WHO: Telnyx returned 422 / 500 / etc. (carrier reject, bad number,
    //       throttling)
    // WHAT: Row was already inserted (we can't transactionally couple the
    //        SMS to the DB) — route returns the "trouble sending" message
    //        so the agent can re-prompt or pivot
    // WHY: Prior code would have crashed silently and left the caller in
    //        an awkward voice dead-air while waiting for a code that
    //        never arrives
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"bad"}', { status: 422 })));
    const { app } = buildApp({
      queryResponses: [
        { rows: [{ inbound_phone: '+15550001000' }] },
        { rows: [{ c: '0' }] },
        { rows: [{ c: '0' }] },
        { rows: [{ id: 'verif-1' }] }, // INSERT still happens
      ],
    });
    const res = await post(app, '/agent-tools/send-verification-code', {
      tenant_id: TENANT_ID,
      phone: '5551234567',
    });
    expect(res.json().success).toBe(false);
    expect(res.json().error).toContain('trouble sending');
  });
});

describe('agentTools /verify-phone-code', () => {
  // Real bcrypt hash of "123456" — precomputed so tests don't wait on hash
  // cost. Matches bcrypt.hash('123456', 10) output format.
  const CODE = '123456';
  let CODE_HASH: string;

  beforeEach(async () => {
    // Compute once per test; 10ms at cost factor 10 is fine.
    const bcrypt = await import('bcrypt');
    CODE_HASH = await bcrypt.hash(CODE, 10);
  });

  it('HAPPY: correct code within TTL → marks verified and returns phone', async () => {
    // WHO: Caller read back the 6-digit code correctly
    // WHAT: Route compares hash, flips verified_at to now(), returns the
    //        normalized phone so the booking flow can continue with a
    //        trusted number
    // WHY: This is the single successful path for OTP — the verified
    //        phone then flows back into /book-appointment with isValidPhone
    //        already true, bypassing the gate
    const futureExpiry = new Date(Date.now() + 5 * 60_000).toISOString();
    const { app, queries } = buildApp({
      queryResponses: [
        {
          rows: [
            {
              id: 'verif-1',
              code_hash: CODE_HASH,
              expires_at: futureExpiry,
              attempt_count: 0,
            },
          ],
        },
        { rows: [] }, // UPDATE SET verified_at
      ],
    });
    const res = await post(app, '/agent-tools/verify-phone-code', {
      tenant_id: TENANT_ID,
      phone: '5551234567',
      code: CODE,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toEqual({ verified: true, phone: '+15551234567' });
    expect(queries[1].text).toContain('verified_at = now()');
  });

  it('SAD: wrong code → increments attempt_count, surfaces remaining tries', async () => {
    // WHO: Caller misheard or misread the code (happens — "3" vs "E",
    //       "9" vs "nine" phonetic ambiguity)
    // WHAT: Route increments attempt_count and tells the agent how many
    //        tries remain so it can say "you have 4 tries left"
    const futureExpiry = new Date(Date.now() + 5 * 60_000).toISOString();
    const { app, queries } = buildApp({
      queryResponses: [
        {
          rows: [
            {
              id: 'verif-1',
              code_hash: CODE_HASH,
              expires_at: futureExpiry,
              attempt_count: 1,
            },
          ],
        },
        { rows: [] }, // UPDATE SET attempt_count
      ],
    });
    const res = await post(app, '/agent-tools/verify-phone-code', {
      tenant_id: TENANT_ID,
      phone: '5551234567',
      code: '999999',
    });
    expect(res.json().success).toBe(false);
    // attempt_count was 1, now 2, max is 5 → 3 remaining
    expect(res.json().error).toContain('3 tries left');
    expect(queries[1].text).toContain('attempt_count = attempt_count + 1');
  });

  it('SAD: expired code → refuses, offers to resend', async () => {
    // WHO: Caller took longer than 10 minutes to read the code back
    //       (found their phone, got interrupted, etc.)
    // WHAT: Route refuses even if the code would have matched — expired
    //        codes must not verify, full stop
    const pastExpiry = new Date(Date.now() - 60_000).toISOString();
    const { app } = buildApp({
      queryResponses: [
        {
          rows: [
            {
              id: 'verif-1',
              code_hash: CODE_HASH,
              expires_at: pastExpiry,
              attempt_count: 0,
            },
          ],
        },
      ],
    });
    const res = await post(app, '/agent-tools/verify-phone-code', {
      tenant_id: TENANT_ID,
      phone: '5551234567',
      code: CODE,
    });
    expect(res.json().success).toBe(false);
    expect(res.json().error).toContain('expired');
  });

  it('SAD: attempt_count at max → refuses, pivots to "take a message"', async () => {
    // WHO: Caller has already guessed 5 times and still hasn't gotten it
    // WHAT: Route refuses to check the hash at all — prevents brute-force
    //        of a 6-digit code over a long call (1-in-a-million per try,
    //        5 tries is the safe cap)
    const futureExpiry = new Date(Date.now() + 5 * 60_000).toISOString();
    const { app, queries } = buildApp({
      queryResponses: [
        {
          rows: [
            {
              id: 'verif-1',
              code_hash: CODE_HASH,
              expires_at: futureExpiry,
              attempt_count: 5,
            },
          ],
        },
      ],
    });
    const res = await post(app, '/agent-tools/verify-phone-code', {
      tenant_id: TENANT_ID,
      phone: '5551234567',
      code: CODE, // even the RIGHT code should be refused
    });
    expect(res.json().success).toBe(false);
    expect(res.json().error).toContain('take a message');
    expect(queries).toHaveLength(1); // no UPDATE — route bailed
  });

  it('SAD: no pending verification for this phone → tells agent to resend', async () => {
    // WHO: Agent called verify without first calling send (or the caller
    //       switched phones mid-call)
    // WHAT: Route can't verify a code that doesn't exist; must respond
    //        cleanly so the agent can recover by calling send
    const { app } = buildApp({ queryResponses: [{ rows: [] }] });
    const res = await post(app, '/agent-tools/verify-phone-code', {
      tenant_id: TENANT_ID,
      phone: '5551234567',
      code: CODE,
    });
    expect(res.json().success).toBe(false);
    expect(res.json().error).toContain('pending code');
  });

  it('SAD: non-numeric code fails Zod before any DB call', async () => {
    // WHO: LLM hallucinated a word-like code ("onenine..." instead of digits)
    const { app, queries } = buildApp({ queryResponses: [] });
    const res = await post(app, '/agent-tools/verify-phone-code', {
      tenant_id: TENANT_ID,
      phone: '5551234567',
      code: 'abcdef',
    });
    expectValidationFailure(res, queries);
  });
});
