/**
 * Tests for /agent-tools/my-appointments and /agent-tools/cancel-appointment.
 *
 * These routes enforce caller ownership via server-injected phone — the LLM
 * never supplies the phone, so a hallucinated appointment_id can never cancel
 * another caller's appointment.
 *
 * Happy + sad paths with 5W diagnostics.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';

import { registerAgentToolRoutes } from './routes/agentTools';

const TENANT_ID = 'f234e471-0e60-4163-86c9-93cfd9338e3a';
const APPT_ID_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const APPT_ID_B = 'bbbbbbbb-0000-4000-8000-000000000002';
const CALLER_A_PHONE = '+16305550101';
const CALLER_B_PHONE = '+16305550102';
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
      return responses.shift() || { rows: [], rowCount: 0 };
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

function post(app: FastifyInstance, path: string, payload: unknown) {
  return app.inject({
    method: 'POST',
    url: path,
    headers: { 'x-agent-secret': SECRET },
    payload,
  });
}

beforeEach(() => {
  process.env.AGENT_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.AGENT_SECRET;
  vi.restoreAllMocks();
});

// ── /agent-tools/my-appointments ──────────────────────────────────────────

describe('/agent-tools/my-appointments', () => {
  it('HAPPY: returns upcoming appointments for the caller phone', async () => {
    // WHO: Caller with a scheduled appointment wanting to review or cancel
    // WHAT: Route joins appointments + customers on phone and returns matching rows
    // WHEN: Called with a valid tenant_id and phone matching a scheduled appointment
    // WHERE: src/routes/agentTools.ts my-appointments toolRoute
    // WHY: Must show the caller their own appointments before any cancel/reschedule
    const mockAppt = {
      appointment_id: APPT_ID_A,
      start_time: '2026-07-01T14:00:00Z',
      end_time: '2026-07-01T15:00:00Z',
      description: 'Oil Change',
      status: 'scheduled',
    };
    const { app, queries } = buildApp({ queryResponses: [{ rows: [mockAppt] }] });

    const res = await post(app, '/agent-tools/my-appointments', {
      tenant_id: TENANT_ID,
      phone: CALLER_A_PHONE,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; result: { appointments: unknown[] } }>();
    expect(body.success).toBe(true);
    expect(body.result.appointments).toHaveLength(1);
    expect(body.result.appointments[0]).toMatchObject({ appointment_id: APPT_ID_A });
    // Verify phone was normalized before DB query
    expect(queries[0].params[1]).toBe(CALLER_A_PHONE);
  });

  it('HAPPY: returns empty array when caller has no upcoming appointments', async () => {
    // WHO: Caller who has no future scheduled appointments
    // WHAT: Returns success with empty appointments array — not an error
    // WHY: LLM needs to tell the caller "I don't see any upcoming bookings" gracefully
    const { app } = buildApp({ queryResponses: [{ rows: [] }] });

    const res = await post(app, '/agent-tools/my-appointments', {
      tenant_id: TENANT_ID,
      phone: CALLER_A_PHONE,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; result: { appointments: unknown[] } }>();
    expect(body.success).toBe(true);
    expect(body.result.appointments).toHaveLength(0);
  });

  it('SAD: rejects missing tenant_id (validation, no DB call)', async () => {
    // WHO: Malformed agent request
    // WHAT: Zod rejects before any DB query
    // WHY: All agent-tool routes must validate inputs before touching DB
    const { app, queries } = buildApp({ queryResponses: [] });

    const res = await post(app, '/agent-tools/my-appointments', {
      phone: CALLER_A_PHONE,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ success: boolean }>().success).toBe(false);
    expect(queries).toHaveLength(0);
  });
});

// ── /agent-tools/cancel-appointment ───────────────────────────────────────

describe('/agent-tools/cancel-appointment', () => {
  it('HAPPY: cancels own appointment and returns cancelled:true', async () => {
    // WHO: Caller A canceling their own scheduled appointment
    // WHAT: UPDATE sets status=canceled, returns the appointment_id
    // WHEN: Caller's phone matches the appointment's customer_id join
    // WHERE: src/routes/agentTools.ts cancel-appointment toolRoute
    // WHY: Core cancel flow — must confirm ownership + soft-cancel in one query
    const { app, queries } = buildApp({
      queryResponses: [{ rows: [{ appointment_id: APPT_ID_A }] }],
    });

    const res = await post(app, '/agent-tools/cancel-appointment', {
      tenant_id: TENANT_ID,
      phone: CALLER_A_PHONE,
      appointment_id: APPT_ID_A,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      success: boolean;
      result: { cancelled: boolean; appointment_id: string };
    }>();
    expect(body.success).toBe(true);
    expect(body.result.cancelled).toBe(true);
    expect(body.result.appointment_id).toBe(APPT_ID_A);
    // Verify phone is injected as ownership guard in the query
    expect(queries[0].params[2]).toBe(CALLER_A_PHONE);
  });

  it("SAD (CRITICAL): caller B cannot cancel caller A's appointment", async () => {
    // WHO: Caller B attempting to cancel an appointment_id belonging to caller A
    // WHAT: UPDATE finds zero rows because phone=$3 (caller B) doesn't match
    //        the customer_id on appointment APPT_ID_A (owned by caller A)
    // WHEN: appointment_id is valid but phone does not match ownership
    // WHERE: src/routes/agentTools.ts cancel-appointment — the phone ownership gate
    // WHY: THE authorization boundary. Without this check any caller could cancel
    //        any appointment in the business by supplying an arbitrary UUID.
    //        Zero rows on the ownership-joined UPDATE must surface as an error,
    //        never as a silent success.
    const { app, queries } = buildApp({
      queryResponses: [{ rows: [] }], // zero rows = ownership mismatch
    });

    const res = await post(app, '/agent-tools/cancel-appointment', {
      tenant_id: TENANT_ID,
      phone: CALLER_B_PHONE, // caller B's phone
      appointment_id: APPT_ID_A, // belongs to caller A
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; error?: string }>();
    expect(body.success).toBe(false);
    expect(body.error).toBeTruthy();
    // Confirm caller B's phone was used — not caller A's
    expect(queries[0].params[2]).toBe(CALLER_B_PHONE);
  });

  it('SAD: rejects non-UUID appointment_id before DB call', async () => {
    // WHO: Malformed agent request with bad appointment_id
    // WHAT: Zod uuid() validation rejects before any DB query
    // WHY: Prevents a bad id from crashing the ::uuid cast inside Postgres
    const { app, queries } = buildApp({ queryResponses: [] });

    const res = await post(app, '/agent-tools/cancel-appointment', {
      tenant_id: TENANT_ID,
      phone: CALLER_A_PHONE,
      appointment_id: 'not-a-uuid',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ success: boolean }>().success).toBe(false);
    expect(queries).toHaveLength(0);
  });

  it('SAD: rejects missing tenant_id before DB call', async () => {
    // WHO: Malformed request missing required tenant_id
    // WHAT: Zod rejects before any DB query
    const { app, queries } = buildApp({ queryResponses: [] });

    const res = await post(app, '/agent-tools/cancel-appointment', {
      phone: CALLER_A_PHONE,
      appointment_id: APPT_ID_B,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ success: boolean }>().success).toBe(false);
    expect(queries).toHaveLength(0);
  });
});
