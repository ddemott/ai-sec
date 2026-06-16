/**
 * Tests for the tool registry. Mocks ToolsClient at the constructor level
 * so tests exercise argument marshalling, context injection, and response
 * formatting without standing up a real HTTP client.
 *
 * These tests enforce the wire contract between the LLM and the backend —
 * if the backend expects `tenant_id` and we fail to inject it from
 * context, every tool call 400s at runtime. Critical coverage.
 */
import { describe, it, expect, vi } from 'vitest';
import { llm } from '@livekit/agents';
import { buildTools } from './tools.js';
import { CallOutcomeTracker } from './callOutcome.js';
import type { ToolsClient, ToolResponse } from './toolsClient.js';
import type { SessionContext } from './sessionContext.js';

const TENANT_ID = 'f234e471-0e60-4163-86c9-93cfd9338e3a';
const RESOURCE_ID = 'a1b2c3d4-e5f6-4789-ab12-cdef34567890';
const CALL_ID = 'sip-call-123';
const CALLER_PHONE = '+15551234567';

function makeClient(responses: Array<ToolResponse>) {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const queue = [...responses];
  const client = {
    call: vi.fn(async (path: string, body: Record<string, unknown>) => {
      calls.push({ path, body });
      const next = queue.shift();
      if (!next) throw new Error('makeClient: no more responses queued');
      return next;
    }),
  } as unknown as ToolsClient;
  return { client, calls };
}

function makeCtx(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    tenantId: TENANT_ID,
    callerPhone: CALLER_PHONE,
    callId: CALL_ID,
    roomName: 'sip-room-1',
    participantIdentity: 'sip_participant_1',
    ...overrides,
  };
}

// LiveKit's FunctionTool wraps the user-supplied execute in internal
// plumbing. To call .execute directly from tests we cast through the
// minimal runtime shape it expects.
async function exec(tool: unknown, args: unknown): Promise<string> {
  const fnTool = tool as {
    execute: (args: unknown, opts: unknown) => Promise<string>;
  };
  return fnTool.execute(args, { ctx: {}, toolCallId: 'test' });
}

describe('buildTools', () => {
  it('HAPPY: exposes exactly the 13 expected tool names', () => {
    // WHY: The system prompt in prompt.ts lists every tool by name. If
    //       these drift the LLM calls a name the router doesn't have
    //       and the call breaks. Pin the set.
    const tools = buildTools(makeCtx(), makeClient([]).client);
    expect(Object.keys(tools).sort()).toEqual(
      [
        'book_appointment',
        'book_with_scheduling',
        'check_availability',
        'get_available_slots',
        'get_company_policy_answer',
        'get_customer_context',
        'get_scheduling_options',
        'get_service_catalog',
        'identify_caller',
        'save_customer_preference',
        'send_verification_code',
        'transfer_call',
        'verify_phone_code',
      ].sort()
    );
  });

  it('HAPPY: every tool has a non-empty description and is recognized as a FunctionTool', () => {
    // WHY: Empty descriptions ship tools the LLM won't know when to use.
    //       isFunctionTool guards against accidentally returning a
    //       non-tool value from buildTools (e.g., a plain object).
    const tools = buildTools(makeCtx(), makeClient([]).client);
    for (const [name, tool] of Object.entries(tools)) {
      expect(llm.isFunctionTool(tool), `${name} must be a FunctionTool`).toBe(true);
      const t = tool as unknown as { description: string };
      expect(t.description.length, `${name} description empty`).toBeGreaterThan(20);
    }
  });
});

describe('get_customer_context', () => {
  it('HAPPY: uses context caller phone (LLM never supplies it)', async () => {
    // WHO: Returning customer calls in, caller-ID intact
    // WHAT: Tool pulls phone from SessionContext, doesn't take it as
    //        an LLM-facing parameter. The backend expects `phone`.
    // WHY: The LLM doesn't know the phone; putting it in context
    //        removes an entire category of hallucination bugs
    const { client, calls } = makeClient([
      { ok: true, result: { name: 'Alice', history: 'Booked oil change' } },
    ]);
    const tools = buildTools(makeCtx(), client);

    await exec(tools.get_customer_context, {});

    expect(calls[0].path).toBe('/agent-tools/customer-context');
    expect(calls[0].body).toEqual({
      tenant_id: TENANT_ID,
      phone: CALLER_PHONE,
    });
  });

  it('HAPPY: anonymous caller → short-circuits, no backend call', async () => {
    // WHO: Caller-ID blocked → context.callerPhone is null
    // WHAT: Skip the backend call entirely and return the "new caller"
    //        string so the LLM moves on instead of waiting for an
    //        HTTP round trip that will also return "new caller"
    const { client, calls } = makeClient([]);
    const tools = buildTools(makeCtx({ callerPhone: null }), client);

    const result = await exec(tools.get_customer_context, {});

    expect(result).toContain('New caller');
    expect(calls).toHaveLength(0);
  });
});

describe('book_appointment', () => {
  it('HAPPY: injects tenant_id and call_id from context, forwards LLM args', async () => {
    // WHO: LLM found a slot and wants to book it
    // WHAT: tenant_id and call_id are from context, everything else is
    //        from the LLM arguments. This split is the ONLY thing
    //        separating us from "LLM hallucinates tenant_id" bugs.
    const { client, calls } = makeClient([
      { ok: true, result: { success: true, appointment_id: 'appt-1' } },
    ]);
    const tools = buildTools(makeCtx(), client);

    await exec(tools.book_appointment, {
      resource_id: RESOURCE_ID,
      start_time: '2026-05-01T14:00:00',
      end_time: '2026-05-01T15:00:00',
      phone: '+15559998888', // note: different from ctx.callerPhone — LLM may have an OTP-verified number
      name: 'Bob',
      description: 'Oil change',
    });

    expect(calls[0].body).toEqual({
      tenant_id: TENANT_ID,
      resource_id: RESOURCE_ID,
      start_time: '2026-05-01T14:00:00',
      end_time: '2026-05-01T15:00:00',
      phone: '+15559998888',
      name: 'Bob',
      employee_id: undefined,
      description: 'Oil change',
      call_id: CALL_ID,
    });
  });

  it('HAPPY: default description when LLM omits one', async () => {
    // WHY: The backend requires a description field. If the LLM forgets
    //        it the tool must supply a sensible default rather than
    //        erroring out mid-call.
    const { client, calls } = makeClient([
      { ok: true, result: { success: true, appointment_id: 'appt-2' } },
    ]);
    const tools = buildTools(makeCtx(), client);

    await exec(tools.book_appointment, {
      resource_id: RESOURCE_ID,
      start_time: '2026-05-01T14:00:00',
      end_time: '2026-05-01T15:00:00',
      phone: '+15559998888',
    });

    expect(calls[0].body.description).toBe('Booking via SecretaryHQ');
  });

  it('SAD: backend error with error_code → tool returns JSON including the code', async () => {
    // WHY: The prompt has a translation table for error codes
    //        (TIMESLOT_OCCUPIED → "that time just got taken"). If the
    //        code doesn't surface in the tool's return value, the LLM
    //        can't translate.
    const { client } = makeClient([
      {
        ok: false,
        error: 'That time slot is already booked.',
        errorCode: 'TIMESLOT_OCCUPIED',
      },
    ]);
    const tools = buildTools(makeCtx(), client);

    const result = await exec(tools.book_appointment, {
      resource_id: RESOURCE_ID,
      start_time: '2026-05-01T14:00:00',
      end_time: '2026-05-01T15:00:00',
      phone: '+15559998888',
    });

    const parsed = JSON.parse(result);
    expect(parsed.error).toBe('That time slot is already booked.');
    expect(parsed.error_code).toBe('TIMESLOT_OCCUPIED');
  });
});

describe('CallOutcomeTracker wiring (call -> appointment link + outcome)', () => {
  // WHO: the booking/transfer tools recording what happened for session-end.
  // WHAT: a successful booking records outcome='booked' + the appointment_id;
  //        a successful transfer records 'transferred'; failures record nothing.
  // WHEN: during the call, read by the shutdown hook.
  // WHERE: buildTools 4th param -> tools.ts extractAppointmentId/recordBooking.
  // WHY: this is the exact link that was hardcoded null before — the harness
  //        (HTTP-only) can't prove the AGENT sends it, so it's pinned here.
  it('book_appointment success records outcome=booked + appointment_id', async () => {
    const tracker = new CallOutcomeTracker();
    const { client } = makeClient([
      { ok: true, result: { success: true, appointment_id: 'appt-xyz' } },
    ]);
    const tools = buildTools(makeCtx(), client, undefined, tracker);
    await exec(tools.book_appointment, {
      resource_id: RESOURCE_ID,
      start_time: '2026-05-01T14:00:00',
      end_time: '2026-05-01T15:00:00',
      phone: '+15559998888',
    });
    expect(tracker.result()).toEqual({ outcome: 'booked', appointmentId: 'appt-xyz' });
  });

  it('book_with_scheduling success records the appointment_id', async () => {
    const tracker = new CallOutcomeTracker();
    const { client } = makeClient([
      { ok: true, result: { success: true, appointment_id: 'appt-sched' } },
    ]);
    const tools = buildTools(makeCtx(), client, undefined, tracker);
    await exec(tools.book_with_scheduling, {
      service_type: 'Oil Change',
      window_from: '2026-05-01T13:00:00Z',
      window_to: '2026-05-08T13:00:00Z',
      phone: '+15559998888',
    });
    expect(tracker.result().appointmentId).toBe('appt-sched');
  });

  it('a failed booking records NOTHING (no appointment_id present)', async () => {
    const tracker = new CallOutcomeTracker();
    const { client } = makeClient([{ ok: false, error: 'taken', errorCode: 'TIMESLOT_OCCUPIED' }]);
    const tools = buildTools(makeCtx(), client, undefined, tracker);
    await exec(tools.book_appointment, {
      resource_id: RESOURCE_ID,
      start_time: '2026-05-01T14:00:00',
      end_time: '2026-05-01T15:00:00',
      phone: '+15559998888',
    });
    expect(tracker.result()).toEqual({ outcome: null, appointmentId: null });
  });

  it('a successful transfer records outcome=transferred', async () => {
    const tracker = new CallOutcomeTracker();
    const { client } = makeClient([]);
    const tools = buildTools(
      makeCtx(),
      client,
      { forwardPhone: '+16085551212', execute: async () => ({ ok: true }) },
      tracker
    );
    await exec(tools.transfer_call, {});
    expect(tracker.result()).toEqual({ outcome: 'transferred', appointmentId: null });
  });
});

describe('book_with_scheduling', () => {
  it('HAPPY: flattens LLM args into nested requirements + window shape', async () => {
    // WHY: The backend expects a nested body shape:
    //        `{ requirements: { serviceType, ... }, window: { from, to } }`
    //        but the LLM-facing arg schema is flat. This test pins the
    //        flatten-to-nest transformation.
    const { client, calls } = makeClient([
      { ok: true, result: { success: true, appointment_id: 'appt-3' } },
    ]);
    const tools = buildTools(makeCtx(), client);

    await exec(tools.book_with_scheduling, {
      service_type: 'Oil Change',
      required_employee_skills: ['oil_change'],
      required_resource_capabilities: ['oil'],
      window_from: '2026-05-01T14:00:00Z',
      window_to: '2026-05-01T16:00:00Z',
      phone: '+15559998888',
      name: 'Bob',
    });

    expect(calls[0].body).toMatchObject({
      tenant_id: TENANT_ID,
      phone: '+15559998888',
      name: 'Bob',
      requirements: {
        serviceType: 'Oil Change',
        requiredEmployeeSkills: ['oil_change'],
        requiredResourceCapabilities: ['oil'],
      },
      window: { from: '2026-05-01T14:00:00Z', to: '2026-05-01T16:00:00Z' },
    });
  });
});

describe('send_verification_code + verify_phone_code', () => {
  it('HAPPY: send uses LLM-provided phone (NOT context phone)', async () => {
    // WHO: Caller gave a phone verbally that differs from caller-ID
    //       (or caller-ID was blocked and ctx.callerPhone is null)
    // WHAT: Tool uses the LLM-provided phone verbatim; tenant_id still
    //        comes from context
    // WHY: The whole point of this tool is to verify a phone the LLM
    //        just collected. Using context.callerPhone would defeat it.
    const { client, calls } = makeClient([
      {
        ok: true,
        result: { sent: true, phone: '+15551234567', message: 'I just sent you a text...' },
      },
    ]);
    const tools = buildTools(makeCtx({ callerPhone: null }), client);

    await exec(tools.send_verification_code, { phone: '5551234567' });

    expect(calls[0].path).toBe('/agent-tools/send-verification-code');
    expect(calls[0].body).toEqual({ tenant_id: TENANT_ID, phone: '5551234567' });
  });

  it('HAPPY: verify forwards both phone and code', async () => {
    const { client, calls } = makeClient([
      { ok: true, result: { verified: true, phone: '+15551234567' } },
    ]);
    const tools = buildTools(makeCtx(), client);

    await exec(tools.verify_phone_code, { phone: '+15551234567', code: '123456' });

    expect(calls[0].path).toBe('/agent-tools/verify-phone-code');
    expect(calls[0].body).toEqual({
      tenant_id: TENANT_ID,
      phone: '+15551234567',
      code: '123456',
    });
  });
});

describe('response formatting', () => {
  it('HAPPY: string result passes through verbatim (avoids JSON.stringify quoting)', async () => {
    // WHY: /available-slots returns a spoken string ("Oil change takes
    //        about 30 minutes..."). If we JSON.stringified it, the LLM
    //        would see \"quoted\" text and sometimes speak the quotes.
    const { client } = makeClient([
      { ok: true, result: 'Oil change takes about 30 minutes. Openings at 2 PM.' },
    ]);
    const tools = buildTools(makeCtx(), client);

    const result = await exec(tools.get_available_slots, {
      service_type: 'oil change',
      date: '2030-01-01',
    });

    expect(result).toBe('Oil change takes about 30 minutes. Openings at 2 PM.');
  });

  it('HAPPY: object result is JSON-stringified for structured tool output', async () => {
    // WHY: scheduling-options returns { options, diagnostics } — the
    //        LLM handles JSON fine, and this preserves structure the
    //        system prompt knows about
    const { client } = makeClient([
      { ok: true, result: { options: [{ resourceId: 'bay-1' }], diagnostics: { reason: 'ok' } } },
    ]);
    const tools = buildTools(makeCtx(), client);

    const result = await exec(tools.get_scheduling_options, {
      service_type: 'oil change',
      window_from: '2026-05-01T14:00:00Z',
      window_to: '2026-05-01T16:00:00Z',
    });

    const parsed = JSON.parse(result);
    expect(parsed.options[0].resourceId).toBe('bay-1');
    expect(parsed.diagnostics.reason).toBe('ok');
  });

  it('SAD: error without code → JSON with just error field', async () => {
    // WHY: Network errors / 5xx have no error_code; we still need to
    //        surface the message so the LLM can say something sensible
    const { client } = makeClient([{ ok: false, error: 'Backend returned 500' }]);
    const tools = buildTools(makeCtx(), client);

    const result = await exec(tools.get_service_catalog, {});

    const parsed = JSON.parse(result);
    expect(parsed.error).toBe('Backend returned 500');
    expect(parsed.error_code).toBeUndefined();
  });
});

describe('save_customer_preference', () => {
  it('HAPPY: forwards tenant_id + phone + key + value to the route', async () => {
    // WHO: the agent learned a durable fact mid-call and saves it.
    // WHAT: the tool posts to /agent-tools/save-customer-preference with the
    //        injected tenant_id plus the LLM-supplied phone/key/value.
    // WHY: tenant_id must come from context (never the LLM); the rest is the
    //        preference the LLM heard. A drift here means saves silently miss.
    const { client, calls } = makeClient([
      { ok: true, result: { saved: true, key: 'preferred_stylist' } },
    ]);
    const tools = buildTools(makeCtx(), client);

    const result = await exec(tools.save_customer_preference, {
      phone: '+15551112222',
      key: 'preferred_stylist',
      value: 'Maria',
    });

    expect(calls[0].path).toBe('/agent-tools/save-customer-preference');
    expect(calls[0].body).toEqual({
      tenant_id: TENANT_ID,
      phone: '+15551112222',
      key: 'preferred_stylist',
      value: 'Maria',
    });
    expect(JSON.parse(result).saved).toBe(true);
  });
});

describe('transfer_call', () => {
  // WHO: caller asks for a human / personal call for the owner
  // WHAT: the tool invokes the SIP-REFER executor and maps its result to an
  //        LLM-facing string. No backend HTTP call — transfer is LiveKit-side.
  // WHEN: every time the LLM decides to connect the caller to a person
  // WHERE: agent/src/tools.ts transfer_call → transferClient executor
  // WHY: a transfer that silently fails would drop the caller into dead air;
  //        each failure mode must steer the LLM to take a message instead.

  it('HAPPY: successful transfer tells the LLM the call is leaving', async () => {
    const execute = vi.fn(async () => ({ ok: true }) as const);
    const tools = buildTools(makeCtx(), makeClient([]).client, {
      forwardPhone: '+16082175303',
      execute,
    });
    const result = await exec(tools.transfer_call, {});
    expect(execute).toHaveBeenCalledWith('+16082175303');
    expect(result).toContain('Transfer started');
  });

  it('SAD: no executor (missing room/participant) → take a message', async () => {
    // execute null = the call lacked room/participant context to REFER
    const tools = buildTools(makeCtx(), makeClient([]).client, {
      forwardPhone: '+16082175303',
      execute: null,
    });
    const result = await exec(tools.transfer_call, {});
    expect(JSON.parse(result).error).toMatch(/not available/i);
  });

  it('SAD: no transfer capability passed at all → take a message', async () => {
    // buildTools called without the 3rd arg (e.g. transfer wiring absent)
    const tools = buildTools(makeCtx(), makeClient([]).client);
    const result = await exec(tools.transfer_call, {});
    expect(JSON.parse(result).error).toMatch(/not available/i);
  });

  it('SAD: forward number unconfigured → tells LLM no number is set', async () => {
    const execute = vi.fn(async () => ({ ok: false, reason: 'not_configured' }) as const);
    const tools = buildTools(makeCtx(), makeClient([]).client, {
      forwardPhone: null,
      execute,
    });
    const result = await exec(tools.transfer_call, {});
    expect(execute).toHaveBeenCalledWith(null);
    expect(JSON.parse(result).error).toMatch(/no transfer number/i);
  });

  it('SAD: REFER throws/fails → apologize and take a message', async () => {
    const execute = vi.fn(async () => ({ ok: false, reason: 'transfer_failed' }) as const);
    const tools = buildTools(makeCtx(), makeClient([]).client, {
      forwardPhone: '+16082175303',
      execute,
    });
    const result = await exec(tools.transfer_call, {});
    expect(JSON.parse(result).error).toMatch(/did not go through/i);
  });
});
