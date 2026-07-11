/**
 * Tests for /agent-tools/customer-history — deeper caller history than
 * customer-context: last ~10 appointments (any status), saved preferences,
 * and the last ~3 post-call summaries from voice_sessions.
 *
 * Query sequence per known-customer call:
 *   1. SELECT customer (customer_id, name, preferences) by tenant + phone
 *   2. SELECT last 10 appointments (any status) for that customer
 *   3. SELECT last 3 voice_sessions summaries (customer_id OR caller_phone)
 *
 * Unknown/unnormalizable phone short-circuits to the "new caller" string —
 * the same LLM-friendly shape customer-context uses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';

import { registerAgentToolRoutes } from '../../../src/routes/agentTools';

const TENANT_ID = 'f234e471-0e60-4163-86c9-93cfd9338e3a';
const CUSTOMER_ID = 'dddddddd-0000-4000-8000-000000000004';
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
    url: '/agent-tools/customer-history',
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

describe('/agent-tools/customer-history', () => {
  it('HAPPY: returns appointments (any status) + preferences + voice_sessions summaries', async () => {
    // WHO: Returning caller asking "when was I last in / what did I have done?"
    // WHAT: One response bundles name, saved preferences, last 10 appointments
    //       with service/employee/date/status, and last 3 call summaries
    // WHEN: The agent calls get_detailed_customer_history mid-call
    // WHERE: src/routes/agentTools.ts customer-history toolRoute
    // WHY: get_customer_context is deliberately shallow; this is the deep view
    const { app, queries } = buildApp({
      queryResponses: [
        {
          rows: [
            {
              customer_id: CUSTOMER_ID,
              name: 'Jane Doe',
              preferences: { preferred_stylist: 'Maria' },
            },
          ],
        },
        {
          rows: [
            {
              start_time: '2026-06-01T15:00:00Z',
              status: 'completed',
              description: 'Haircut',
              service_name: 'Haircut',
              employee_name: 'Maria',
            },
            {
              start_time: '2026-05-01T15:00:00Z',
              status: 'canceled',
              description: 'Color',
              service_name: 'Color',
              employee_name: null,
            },
          ],
        },
        {
          rows: [{ summary: 'Booked a haircut with Maria.', started_at: '2026-06-01T14:00:00Z' }],
        },
      ],
    });

    const res = await post(app, { tenant_id: TENANT_ID, phone: '+15551112222' });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      success: boolean;
      result: {
        name: string;
        preferences: Record<string, string>;
        appointments: Array<{ status: string; service_name: string | null }>;
        recent_call_summaries: Array<{ summary: string }>;
      };
    }>();
    expect(body.success).toBe(true);
    expect(body.result.name).toBe('Jane Doe');
    expect(body.result.preferences).toEqual({ preferred_stylist: 'Maria' });
    expect(body.result.appointments).toHaveLength(2);
    // Any-status is the point — a canceled appointment IS history.
    expect(body.result.appointments[1].status).toBe('canceled');
    expect(body.result.recent_call_summaries[0].summary).toContain('haircut');

    // The appointments query must NOT filter to scheduled-only (unlike
    // my-appointments) and must cap at 10.
    const apptQuery = queries[1];
    expect(apptQuery.text).toContain('FROM appointments');
    expect(apptQuery.text).not.toContain("status = 'scheduled'");
    expect(apptQuery.text).toContain('LIMIT 10');
    // Summaries come from voice_sessions (not the legacy call_summaries table).
    expect(queries[2].text).toContain('FROM voice_sessions');
    expect(queries[2].text).toContain('LIMIT 3');
  });

  it('HAPPY: unknown phone → "new caller" string, no further queries', async () => {
    // WHO: First-time caller with no CRM row
    // WHAT: The customer SELECT comes back empty → short LLM-friendly string,
    //       and the appointment/summary queries never fire
    // WHY: Same graceful shape as customer-context — never an alarming error
    const { app, queries } = buildApp({
      queryResponses: [{ rows: [] }],
    });

    const res = await post(app, { tenant_id: TENANT_ID, phone: '+15559998888' });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; result: string }>();
    expect(body.success).toBe(true);
    expect(body.result).toBe('New caller - no history found.');
    expect(queries).toHaveLength(1);
  });

  it('SAD: unnormalizable phone → "new caller" string, no DB call at all', async () => {
    // WHO: Garbage phone (STT mangled it below 10 digits)
    // WHAT: normalizePhone returns null → short-circuit before any query
    // WHY: A broken key must not produce a broken lookup or a scary error
    const { app, queries } = buildApp({ queryResponses: [] });

    const res = await post(app, { tenant_id: TENANT_ID, phone: 'abcdef' });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; result: string }>();
    expect(body.success).toBe(true);
    expect(body.result).toBe('New caller - no history found.');
    expect(queries).toHaveLength(0);
  });

  it('SAD: missing phone fails validation, no DB call', async () => {
    // WHO: Malformed request (the agent always injects the phone server-side,
    //       so this only happens if the agent-side gate is bypassed)
    // WHAT: Zod min(5) rejects before any query
    const { app, queries } = buildApp({ queryResponses: [] });

    const res = await post(app, { tenant_id: TENANT_ID });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ success: boolean }>().success).toBe(false);
    expect(queries).toHaveLength(0);
  });

  it('SAD: missing tenant_id fails validation, no DB call', async () => {
    const { app, queries } = buildApp({ queryResponses: [] });

    const res = await post(app, { phone: '+15551112222' });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ success: boolean }>().success).toBe(false);
    expect(queries).toHaveLength(0);
  });
});
