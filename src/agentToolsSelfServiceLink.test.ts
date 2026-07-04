/**
 * Tests for /agent-tools/send-self-service-link — text the caller a secure
 * cancel/reschedule link for one of their own upcoming appointments.
 *
 * ConsentService + SMSService are mocked at the module level (the route
 * constructs them internally); the link builders are REAL — the tokens come
 * from the same selfServiceToken machinery production uses (dev JWT secret
 * under NODE_ENV=test), so the asserted URLs prove the reuse, not a stub.
 *
 * Query sequence per call:
 *   1. SELECT appointment (ownership-gated by caller phone; optional
 *      appointment_id narrows, otherwise next upcoming)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';

import { registerAgentToolRoutes } from './routes/agentTools';

const { checkConsentMock, sendSMSMock } = vi.hoisted(() => ({
  checkConsentMock: vi.fn<(...args: unknown[]) => Promise<boolean>>(),
  sendSMSMock: vi.fn<(...args: unknown[]) => Promise<{ success: boolean; error?: string }>>(),
}));

// The route builds `new ConsentService(...)` / `new SMSService(...)` at
// registration time; mock the classes so tests control consent + delivery.
vi.mock('./services/consentService', () => ({
  ConsentService: class {
    checkConsent = (...args: unknown[]) => checkConsentMock(...args);
  },
}));
vi.mock('./services/communications/smsService', () => ({
  SMSService: class {
    sendSMS = (...args: unknown[]) => sendSMSMock(...args);
  },
}));

const TENANT_ID = 'f234e471-0e60-4163-86c9-93cfd9338e3a';
const APPOINTMENT_ID = 'bbbbbbbb-0000-4000-8000-000000000007';
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
    url: '/agent-tools/send-self-service-link',
    headers: { 'x-agent-secret': SECRET },
    payload,
  });
}

const APPT_ROW = {
  appointment_id: APPOINTMENT_ID,
  start_time: '2026-07-10T15:00:00Z',
  description: 'Haircut',
};

beforeEach(() => {
  process.env.AGENT_SECRET = SECRET;
  process.env.DASHBOARD_URL = 'https://dash.example.com';
  checkConsentMock.mockReset().mockResolvedValue(true);
  sendSMSMock.mockReset().mockResolvedValue({ success: true });
});

afterEach(() => {
  delete process.env.AGENT_SECRET;
  delete process.env.DASHBOARD_URL;
  vi.restoreAllMocks();
});

describe('/agent-tools/send-self-service-link', () => {
  it('HAPPY: texts real cancel + reschedule links for the resolved appointment', async () => {
    // WHO: Caller with an upcoming appointment who wants to handle it via text
    // WHAT: Ownership-gated SELECT resolves the appointment, consent passes,
    //       and the SMS body carries REAL /self/cancel + /self/reschedule
    //       token links (built by the production selfServiceToken path)
    // WHEN: The agent proactively offers the link during a cancel/reschedule ask
    // WHERE: src/routes/agentTools.ts send-self-service-link toolRoute
    // WHY: This is the GAPS.md "next-level voice tools" item — link-first
    //       self-service instead of always doing the change live
    const { app, queries } = buildApp({ queryResponses: [{ rows: [APPT_ROW] }] });

    const res = await post(app, {
      tenant_id: TENANT_ID,
      phone: '+15551112222',
      appointment_id: APPOINTMENT_ID,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      success: boolean;
      result: { sent: boolean; appointment_id: string };
    }>();
    expect(body.success).toBe(true);
    expect(body.result.sent).toBe(true);
    expect(body.result.appointment_id).toBe(APPOINTMENT_ID);

    // Ownership gate: the SELECT joins customers on the caller's phone and
    // narrows to the requested appointment_id.
    expect(queries[0].text).toContain('JOIN customers');
    expect(queries[0].params).toContain('+15551112222');
    expect(queries[0].params).toContain(APPOINTMENT_ID);

    expect(sendSMSMock).toHaveBeenCalledOnce();
    const [tenantArg, msgArg] = sendSMSMock.mock.calls[0] as [string, { to: string; body: string }];
    expect(tenantArg).toBe(TENANT_ID);
    expect(msgArg.to).toBe('+15551112222');
    expect(msgArg.body).toContain('https://dash.example.com/self/cancel?token=');
    expect(msgArg.body).toContain('https://dash.example.com/self/reschedule?token=');
    expect(msgArg.body).toContain('Reply STOP to opt out');
  });

  it('HAPPY: SMS date is formatted in the TENANT timezone, not the server/UTC date', async () => {
    // WHO: A tenant in a timezone west of UTC whose appointment falls on an
    //      earlier CALENDAR day locally than it does in UTC
    // WHAT: start_time 2026-07-10T02:00:00Z is July 10 in UTC but July 9 in
    //       Pacific/Honolulu (UTC-10) — the SMS body must show the caller's
    //       LOCAL date (July 9), proving the format uses the tenant's IANA zone
    // WHEN: The agent texts a self-service link for an early-morning-UTC slot
    // WHERE: send-self-service-link date formatting (Intl.DateTimeFormat with
    //        timeZone = tenants.timezone from the ownership SELECT)
    // WHY: Regression guard for the review finding — toLocaleDateString() used
    //      the SERVER default zone and could show the wrong calendar date
    const { app } = buildApp({
      queryResponses: [
        {
          rows: [
            {
              appointment_id: APPOINTMENT_ID,
              start_time: '2026-07-10T02:00:00Z',
              description: 'Haircut',
              tenant_timezone: 'Pacific/Honolulu',
            },
          ],
        },
      ],
    });

    const res = await post(app, { tenant_id: TENANT_ID, phone: '+15551112222' });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ success: boolean }>().success).toBe(true);
    const [, msgArg] = sendSMSMock.mock.calls[0] as [string, { to: string; body: string }];
    // Tenant-local date (Honolulu) is July 9; the UTC date would be July 10.
    expect(msgArg.body).toContain('July 9, 2026');
    expect(msgArg.body).not.toContain('July 10, 2026');
  });

  it('HAPPY: appointment_id omitted → next upcoming appointment is targeted (NULL param)', async () => {
    // WHO: Caller with one upcoming appointment — "just text me the link"
    // WHAT: The SELECT's $3 narrow param is null, so the ORDER BY start_time
    //       LIMIT 1 picks the caller's next upcoming appointment
    // WHY: The default path must work without the LLM juggling UUIDs
    const { app, queries } = buildApp({ queryResponses: [{ rows: [APPT_ROW] }] });

    const res = await post(app, { tenant_id: TENANT_ID, phone: '+15551112222' });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ success: boolean }>().success).toBe(true);
    expect(queries[0].params[2]).toBeNull();
  });

  it('SAD: no upcoming appointment under the caller phone → graceful error, no consent check, no SMS', async () => {
    // WHO: Caller with nothing scheduled (or an appointment_id they don't own)
    // WHAT: Empty SELECT → conversational error; the consent + send machinery
    //       is never touched
    // WHY: Phone-gated ownership is the security boundary — an unowned
    //       appointment_id behaves exactly like no appointment at all
    const { app } = buildApp({ queryResponses: [{ rows: [] }] });

    const res = await post(app, {
      tenant_id: TENANT_ID,
      phone: '+15551112222',
      appointment_id: APPOINTMENT_ID,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; error: string }>();
    expect(body.success).toBe(false);
    expect(body.error).toContain("couldn't find an upcoming appointment");
    expect(checkConsentMock).not.toHaveBeenCalled();
    expect(sendSMSMock).not.toHaveBeenCalled();
  });

  it('SAD: no SMS consent (or opted out) → relayable error, nothing sent', async () => {
    // WHO: Caller whose number never consented — or texted STOP (opt-outs
    //       revoke consent, so checkConsent returns false for them too)
    // WHAT: success:false with a message the LLM can relay + a live-handling
    //       steer; sendSMS is never called
    // WHERE: The consent gate ahead of link generation
    // WHY: TCPA — the agent tool must be structurally unable to text an
    //       opted-out number
    checkConsentMock.mockResolvedValue(false);
    const { app } = buildApp({ queryResponses: [{ rows: [APPT_ROW] }] });

    const res = await post(app, { tenant_id: TENANT_ID, phone: '+15551112222' });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; error: string }>();
    expect(body.success).toBe(false);
    expect(body.error).toContain("hasn't agreed to receive texts");
    expect(checkConsentMock).toHaveBeenCalledWith(TENANT_ID, undefined, '+15551112222', 'sms');
    expect(sendSMSMock).not.toHaveBeenCalled();
  });

  it('SAD: no public URL configured → graceful "handle it live" error, nothing sent', async () => {
    // WHO: Environment missing DASHBOARD_URL/BACKEND_PUBLIC_URL
    // WHAT: buildCancelLink returns null → conversational error + metric/log;
    //       the SMS path is never reached
    // WHY: A misconfigured env must degrade to live handling, not a 500 the
    //       TTS reads aloud
    delete process.env.DASHBOARD_URL;
    delete process.env.BACKEND_PUBLIC_URL;
    const { app } = buildApp({ queryResponses: [{ rows: [APPT_ROW] }] });

    const res = await post(app, { tenant_id: TENANT_ID, phone: '+15551112222' });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; error: string }>();
    expect(body.success).toBe(false);
    expect(body.error).toContain("can't send self-service links right now");
    expect(sendSMSMock).not.toHaveBeenCalled();
  });

  it('SAD: SMS send fails → graceful error so the agent pivots to live handling', async () => {
    // WHO: Consented caller, provider error at send time
    // WHAT: sendSMS resolves success:false → conversational error (the caller
    //       was promised a text and didn't get one — the agent must know)
    sendSMSMock.mockResolvedValue({ success: false, error: 'provider down' });
    const { app } = buildApp({ queryResponses: [{ rows: [APPT_ROW] }] });

    const res = await post(app, { tenant_id: TENANT_ID, phone: '+15551112222' });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; error: string }>();
    expect(body.success).toBe(false);
    expect(body.error).toContain("couldn't send the text");
  });

  it('SAD: SMS send THROWS (rate limiter) → still a graceful conversational error, never a 500', async () => {
    // WHO: Tenant whose per-tenant SMS token bucket is dry (RateLimitedError
    //       is re-thrown by SMSService by design for the reminder worker)
    // WHAT: The route catches the throw into the same graceful shape — a 500
    //       would be read to the caller as a technical error (RULE 5.4)
    sendSMSMock.mockRejectedValue(new Error('rate limited'));
    const { app } = buildApp({ queryResponses: [{ rows: [APPT_ROW] }] });

    const res = await post(app, { tenant_id: TENANT_ID, phone: '+15551112222' });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; error: string }>();
    expect(body.success).toBe(false);
    expect(body.error).toContain("couldn't send the text");
  });

  it('SAD: invalid phone fails before any query', async () => {
    // WHO: Agent-side gate bypassed with a garbage phone
    // WHAT: normalizePhone rejects → no SELECT, no consent, no SMS
    const { app, queries } = buildApp({ queryResponses: [] });

    const res = await post(app, { tenant_id: TENANT_ID, phone: 'abcde' });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; error: string }>();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Invalid phone number');
    expect(queries).toHaveLength(0);
  });

  it('SAD: non-UUID appointment_id fails validation, no DB call', async () => {
    // WHO: LLM hallucinating a non-UUID id
    // WHAT: Zod uuid() rejects before the SELECT — the ::uuid cast can never
    //       see a malformed value (no SQLSTATE 22P02 500s)
    const { app, queries } = buildApp({ queryResponses: [] });

    const res = await post(app, {
      tenant_id: TENANT_ID,
      phone: '+15551112222',
      appointment_id: 'tomorrow-at-3',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ success: boolean }>().success).toBe(false);
    expect(queries).toHaveLength(0);
  });
});
