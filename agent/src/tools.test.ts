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
  it('HAPPY: exposes exactly the 20 expected tool names', () => {
    // WHY: The system prompt in prompt.ts lists every tool by name. If
    //       these drift the LLM calls a name the router doesn't have
    //       and the call breaks. Pin the set.
    const tools = buildTools(makeCtx(), makeClient([]).client);
    expect(Object.keys(tools).sort()).toEqual(
      [
        'book_appointment',
        'book_with_scheduling',
        'cancel_appointment',
        'capture_job_inquiry',
        'check_availability',
        'find_caller_by_name',
        'get_available_slots',
        'get_company_policy_answer',
        'get_customer_context',
        'get_my_appointments',
        'get_scheduling_options',
        'get_service_catalog',
        'identify_caller',
        'record_sms_consent',
        'reschedule_appointment',
        'save_customer_preference',
        'send_verification_code',
        'take_message',
        'transfer_call',
        'verify_phone_code',
      ].sort()
    );
  });

  it('HAPPY: capabilities filter returns only the selected groups (composability for other agents)', () => {
    // WHO: a customer agent (e.g. a message-only line) composing a subset.
    // WHAT: buildTools({capabilities}) returns only tools in those groups, so a
    //        simpler agent can reuse just RAG + message-taking.
    // WHY: the reuse contract — pick capabilities, not copy-paste the whole set.
    const tools = buildTools(makeCtx(), makeClient([]).client, undefined, undefined, undefined, {
      capabilities: ['knowledge', 'messaging'],
    });
    expect(Object.keys(tools).sort()).toEqual(
      ['capture_job_inquiry', 'get_company_policy_answer', 'take_message'].sort()
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

describe('formatResponse (never-empty guard)', () => {
  it('SAD: an ok response with an undefined result yields a non-empty string, never silence', async () => {
    // WHO: a tool whose backend returned { success:true } with no result field.
    // WHAT: formatResponse must not hand the LLM JSON.stringify(undefined) (the JS
    //        value `undefined`) — that gives the model nothing to relay → a silent
    //        turn. It returns a non-empty fallback instead.
    // WHERE: agent/src/tools.ts formatResponse, via any tool's execute().
    // WHY: never-silent contract — a success-with-no-payload must still speak.
    const { client } = makeClient([{ ok: true, result: undefined }]);
    const tools = buildTools(makeCtx(), client);
    const out = await exec(tools.get_service_catalog, {});
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
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

  it('HAPPY: looks up by the LLM-supplied spoken phone when provided', async () => {
    // WHO: Returning caller on a forwarded line — caller ID is the forwarding cell
    // WHAT: When the LLM passes a phone (the number the caller said), the lookup
    //        uses THAT number, not ctx.callerPhone, so repeat callers are
    //        recognized by their real number
    // WHY: Caller ID on a forwarded line is not the caller; the spoken number is
    const { client, calls } = makeClient([
      { ok: true, result: { name: 'Bob', history: 'Spoke last week' } },
    ]);
    const tools = buildTools(makeCtx(), client);

    await exec(tools.get_customer_context, { phone: '+16125559999' });

    expect(calls[0].body).toEqual({
      tenant_id: TENANT_ID,
      phone: '+16125559999',
    });
  });

  it('HAPPY: anonymous caller, no spoken phone → short-circuits, no backend call', async () => {
    // WHO: Caller-ID blocked → context.callerPhone is null, no number collected yet
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

describe('find_caller_by_name', () => {
  it('HAPPY: posts tenant_id + name, returns matches for confirmation', async () => {
    // WHO: Caller on the forwarded line who gives their name first
    // WHAT: Tool posts tenant_id (context) + name (LLM) to find-customer-by-name
    //        and surfaces the matches so __PERSONA_NAME__ can confirm the number on file
    // WHEN: Right after the caller states their name — caller ID is the
    //        forwarding cell, so name is the only trustworthy first identifier
    // WHERE: agent/src/tools.ts find_caller_by_name → /agent-tools/find-customer-by-name
    // WHY: Name-first identification is the whole point of this tool
    const { client, calls } = makeClient([
      { ok: true, result: { matches: [{ name: 'Jane Doe', phone: '+16125551234' }] } },
    ]);
    const tools = buildTools(makeCtx(), client);

    const result = await exec(tools.find_caller_by_name, { name: 'Jane Doe' });

    expect(calls[0].path).toBe('/agent-tools/find-customer-by-name');
    expect(calls[0].body).toEqual({ tenant_id: TENANT_ID, name: 'Jane Doe' });
    expect(result).toContain('Jane Doe');
  });

  it('HAPPY: empty match list relays cleanly so the LLM treats them as new', async () => {
    // WHO: First-time caller whose name is not in the CRM
    // WHAT: Backend returns an empty matches array; tool relays it
    // WHY: An empty list is the signal to create a new entry, not an error
    const { client, calls } = makeClient([{ ok: true, result: { matches: [] } }]);
    const tools = buildTools(makeCtx(), client);

    const result = await exec(tools.find_caller_by_name, { name: 'Nobody Known' });

    expect(calls).toHaveLength(1);
    expect(result).toContain('matches');
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

  it('GUARD: empty resource_id → redirects to book_with_scheduling, no backend call (prod bug #3)', async () => {
    // WHO: LLM ran get_available_slots (spoken times, NO resource_id), the
    //       caller picked one, and the LLM tries to book it here.
    // WHAT: book_appointment requires a resource_id that only
    //       get_scheduling_options returns. With an empty resource_id the tool
    //       must NOT hit the backend (would 400 / risk an invented id) — it
    //       returns a RESOURCE_ID_REQUIRED redirect so the LLM re-routes to
    //       book_with_scheduling. This is the exact prod dead-end (bug #3).
    const { client, calls } = makeClient([]); // no responses queued — asserting no call
    const tools = buildTools(makeCtx(), client);

    const result = await exec(tools.book_appointment, {
      resource_id: '   ',
      start_time: '2026-05-01T14:00:00',
      end_time: '2026-05-01T15:00:00',
      phone: '+15559998888',
    });

    expect(calls).toHaveLength(0);
    const parsed = JSON.parse(result);
    expect(parsed.error_code).toBe('RESOURCE_ID_REQUIRED');
    expect(parsed.error).toContain('book_with_scheduling');
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

describe('check_availability', () => {
  it('HAPPY: forwards tenant_id + args when a real resource_id is present', async () => {
    const { client, calls } = makeClient([{ ok: true, result: 'That resource is free.' }]);
    const tools = buildTools(makeCtx(), client);
    await exec(tools.check_availability, {
      resource_id: RESOURCE_ID,
      start_time: '2026-05-01T14:00:00',
      end_time: '2026-05-01T15:00:00',
    });
    expect(calls[0].path).toBe('/agent-tools/check-availability');
    expect(calls[0].body).toEqual({
      tenant_id: TENANT_ID,
      resource_id: RESOURCE_ID,
      start_time: '2026-05-01T14:00:00',
      end_time: '2026-05-01T15:00:00',
    });
  });

  it('GUARD: empty resource_id → redirects to book_with_scheduling, no backend call (prod bug #3)', async () => {
    // Same dead-end as book_appointment: check_availability needs a resource_id
    // that only get_scheduling_options returns. An empty one must short-circuit
    // to a RESOURCE_ID_REQUIRED redirect, never touching the backend.
    const { client, calls } = makeClient([]);
    const tools = buildTools(makeCtx(), client);
    const result = await exec(tools.check_availability, {
      resource_id: '',
      start_time: '2026-05-01T14:00:00',
      end_time: '2026-05-01T15:00:00',
    });
    expect(calls).toHaveLength(0);
    const parsed = JSON.parse(result);
    expect(parsed.error_code).toBe('RESOURCE_ID_REQUIRED');
    expect(parsed.error).toContain('book_with_scheduling');
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

describe('book_with_scheduling — confirm the ACTUAL booked time', () => {
  // WHO/WHY: prod bug — caller asked for 4:30, agent booked 4:00 (RPC takes the
  //   earliest open slot >= window_from) yet CONFIRMED "4:30" back, because the
  //   old formatter dumped raw JSON with no directive to read booked_start.
  //   These pin the formatBookingResponse contract: name the real slot, and flag
  //   a mismatch ONLY when the caller named a specific time (requested_start).

  const bookedResult = (overrides: Record<string, unknown> = {}) => ({
    ok: true as const,
    result: {
      success: true,
      appointment_id: 'appt-confirm',
      employee_name: 'Carlos',
      booked_start: '2026-07-15T16:00:00',
      booked_end: '2026-07-15T16:30:00',
      error_message: null,
      ...overrides,
    },
  });

  it('SPECIFIC time booked exactly as requested → confirms the real slot, no mismatch flag', async () => {
    const { client } = makeClient([
      bookedResult({ booked_start: '2026-07-15T16:30:00', booked_end: '2026-07-15T17:00:00' }),
    ]);
    const tools = buildTools(makeCtx(), client);
    const out = await exec(tools.book_with_scheduling, {
      service_type: 'Oil Change',
      window_from: '2026-07-15T16:30:00',
      window_to: '2026-07-15T17:00:00',
      requested_start: '2026-07-15T16:30:00',
      phone: '+15559998888',
    });
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed.booked_time).toBe('4:30 PM');
    expect(parsed.employee).toBe('Carlos');
    expect(parsed.time_changed).toBeUndefined();
    expect(String(parsed.instruction)).toContain('4:30 PM');
  });

  it('SPECIFIC time but booked EARLIER → flags the change + names the real time (prod bug)', async () => {
    // Caller asked 4:30; the only opening was 4:00. Must NOT parrot 4:30.
    const { client } = makeClient([bookedResult()]); // booked_start 4:00
    const tools = buildTools(makeCtx(), client);
    const out = await exec(tools.book_with_scheduling, {
      service_type: 'Oil Change',
      window_from: '2026-07-15T16:30:00',
      window_to: '2026-07-15T17:00:00',
      requested_start: '2026-07-15T16:30:00',
      phone: '+15559998888',
    });
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed.time_changed).toBe(true);
    expect(parsed.booked_time).toBe('4:00 PM');
    expect(parsed.requested_time).toBe('4:30 PM');
    const instruction = String(parsed.instruction);
    expect(instruction).toContain('4:00 PM'); // the actual slot
    expect(instruction).toContain('4:30 PM'); // what they asked
    expect(instruction).toMatch(/not open|wasn't open|NOT open/i);
  });

  it('NEXT-AVAILABLE (no requested_start) → NO mismatch flag even when slot != window bound', async () => {
    // REGRESSION GUARD: window_from is a wide SEARCH BOUND here, not a request.
    //   booked_start (4:00) differs from window_from (9:00) by design — firing a
    //   "your 9:00 wasn't open" note would be wrong/confusing.
    const { client } = makeClient([bookedResult()]); // booked 4:00
    const tools = buildTools(makeCtx(), client);
    const out = await exec(tools.book_with_scheduling, {
      service_type: 'Oil Change',
      window_from: '2026-07-15T09:00:00',
      window_to: '2026-07-15T17:00:00',
      phone: '+15559998888',
      // requested_start intentionally omitted (open-ended "next available")
    });
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed.time_changed).toBeUndefined();
    expect(parsed.requested_time).toBeUndefined();
    expect(parsed.booked_time).toBe('4:00 PM');
  });

  it('LEGACY shape (no booked_start) → falls back to the generic formatter, never throws', async () => {
    const { client } = makeClient([
      { ok: true, result: { success: true, appointment_id: 'appt-legacy' } },
    ]);
    const tools = buildTools(makeCtx(), client);
    const out = await exec(tools.book_with_scheduling, {
      service_type: 'Oil Change',
      window_from: '2026-07-15T16:30:00',
      window_to: '2026-07-15T17:00:00',
      requested_start: '2026-07-15T16:30:00',
      phone: '+15559998888',
    });
    const parsed = JSON.parse(out) as Record<string, unknown>;
    // Generic formatter passthrough: raw result JSON, no booked_time/instruction.
    expect(parsed.appointment_id).toBe('appt-legacy');
    expect(parsed.booked_time).toBeUndefined();
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

describe('reschedule_appointment', () => {
  const APPT_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
  const NEW_START = '2026-07-15T10:00:00';
  const NEW_END = '2026-07-15T11:00:00';

  it('HAPPY: injects phone from context and forwards appointment + times to backend', async () => {
    // WHO: Caller with caller-ID wanting to move their appointment
    // WHAT: Tool sends phone from SessionContext (never from LLM) + appointment_id + new times
    // WHY: Phone ownership guard on the backend requires the server-injected
    //      phone to match the appointment's customer — LLM must never supply it
    const { client, calls } = makeClient([{ ok: true, result: { rescheduled: true } }]);
    const tools = buildTools(makeCtx(), client);

    await exec(tools.reschedule_appointment, {
      appointment_id: APPT_ID,
      new_start_time: NEW_START,
      new_end_time: NEW_END,
    });

    expect(calls[0].path).toBe('/agent-tools/reschedule-appointment');
    expect(calls[0].body).toEqual({
      tenant_id: TENANT_ID,
      phone: CALLER_PHONE,
      appointment_id: APPT_ID,
      new_start_time: NEW_START,
      new_end_time: NEW_END,
    });
  });

  it('SAD: no caller-ID → short-circuits, no backend call', async () => {
    // WHO: Caller with blocked caller-ID
    // WHAT: Tool returns error string without hitting backend
    // WHY: Backend ownership guard requires a real phone; null would
    //      fail validation and waste an HTTP round-trip mid-call
    const { client, calls } = makeClient([]);
    const tools = buildTools(makeCtx({ callerPhone: null }), client);

    const result = await exec(tools.reschedule_appointment, {
      appointment_id: APPT_ID,
      new_start_time: NEW_START,
      new_end_time: NEW_END,
    });

    expect(JSON.parse(result).error).toMatch(/without caller-ID/i);
    expect(calls).toHaveLength(0);
  });
});

describe('get_my_appointments', () => {
  it('HAPPY: injects tenant_id + phone from context, returns appointments', async () => {
    // WHO: Returning caller who wants to see or cancel/reschedule their appointments
    // WHAT: Tool sends tenant_id + callerPhone (never LLM-supplied) to backend
    // WHEN: Caller says "can I see my appointments" or "I want to reschedule"
    // WHERE: agent/src/tools.ts get_my_appointments → /agent-tools/my-appointments
    // WHY: Phone must come from caller-ID so a caller can only see their own appointments
    const mockAppts = [
      {
        appointment_id: 'aaaaaaaa-0000-4000-8000-000000000001',
        start_time: '2099-07-01T14:00:00Z',
        service_name: 'Oil Change',
        employee_name: 'Mike',
      },
    ];
    const { client, calls } = makeClient([{ ok: true, result: { appointments: mockAppts } }]);
    const tools = buildTools(makeCtx(), client);

    const result = await exec(tools.get_my_appointments, {});

    expect(calls[0].path).toBe('/agent-tools/my-appointments');
    expect(calls[0].body).toEqual({ tenant_id: TENANT_ID, phone: CALLER_PHONE });
    expect(JSON.parse(result).appointments).toHaveLength(1);
    expect(JSON.parse(result).appointments[0].service_name).toBe('Oil Change');
  });

  it('SAD: anonymous caller → short-circuits, no backend call', async () => {
    // WHO: Caller with blocked caller-ID
    // WHAT: Tool returns error without hitting backend — no phone to lookup with
    // WHY: Backend would return empty results for null phone; better to tell the
    //       caller we can't identify them before wasting the round-trip
    const { client, calls } = makeClient([]);
    const tools = buildTools(makeCtx({ callerPhone: null }), client);

    const result = await exec(tools.get_my_appointments, {});

    expect(JSON.parse(result).error).toMatch(/caller-ID/i);
    expect(calls).toHaveLength(0);
  });
});

describe('cancel_appointment', () => {
  const APPT_ID = 'cccccccc-0000-4000-8000-000000000003';

  it('HAPPY: injects phone from context and forwards appointment_id to backend', async () => {
    // WHO: Caller who confirmed they want to cancel their appointment
    // WHAT: Tool posts to cancel-appointment with server-injected phone (not LLM's)
    // WHEN: LLM supplies appointment_id from a prior get_my_appointments call
    // WHERE: agent/src/tools.ts cancel_appointment → /agent-tools/cancel-appointment
    // WHY: Phone ownership gate on the backend requires the correct caller phone;
    //       LLM must never supply it — prevents canceling another caller's appointment
    const { client, calls } = makeClient([
      { ok: true, result: { cancelled: true, appointment_id: APPT_ID } },
    ]);
    const tools = buildTools(makeCtx(), client);

    await exec(tools.cancel_appointment, { appointment_id: APPT_ID });

    expect(calls[0].path).toBe('/agent-tools/cancel-appointment');
    expect(calls[0].body).toEqual({
      tenant_id: TENANT_ID,
      phone: CALLER_PHONE,
      appointment_id: APPT_ID,
    });
  });

  it('SAD: no caller-ID → short-circuits, no backend call', async () => {
    // WHO: Caller with blocked caller-ID trying to cancel
    // WHAT: Tool returns error without hitting backend
    // WHY: Backend phone ownership gate would reject an empty/null phone anyway;
    //       short-circuit avoids the wasted roundtrip mid-call
    const { client, calls } = makeClient([]);
    const tools = buildTools(makeCtx({ callerPhone: null }), client);

    const result = await exec(tools.cancel_appointment, { appointment_id: APPT_ID });

    expect(JSON.parse(result).error).toMatch(/caller-ID/i);
    expect(calls).toHaveLength(0);
  });
});

describe('take_message', () => {
  it('HAPPY: forwards name, message, and optional callback_phone to backend', async () => {
    // WHO: Caller the agent could not immediately help (owner unavailable, after-hours, etc.)
    // WHAT: Tool collects name + message + optional callback number and persists to DB
    // WHEN: transfer_call returns no_number, or owner is unavailable
    // WHERE: agent/src/tools.ts take_message → /agent-tools/take-message
    // WHY: Ensures the caller's need is recorded even when voice booking can't resolve it
    const { client, calls } = makeClient([{ ok: true, result: { saved: true } }]);
    const tools = buildTools(makeCtx(), client);

    await exec(tools.take_message, {
      caller_name: 'Alice Smith',
      message: 'Need a quote for four tires',
      callback_phone: '+15559990000',
    });

    expect(calls[0].path).toBe('/agent-tools/take-message');
    expect(calls[0].body).toMatchObject({
      tenant_id: TENANT_ID,
      caller_name: 'Alice Smith',
      message: 'Need a quote for four tires',
      callback_phone: '+15559990000',
    });
  });

  it('HAPPY: callback_phone is optional — tool works without it', async () => {
    // WHO: Caller who didn't provide a callback number (or same as caller-ID)
    // WHAT: Tool omits callback_phone from body when not supplied
    const { client, calls } = makeClient([{ ok: true, result: { saved: true } }]);
    const tools = buildTools(makeCtx(), client);

    await exec(tools.take_message, {
      caller_name: 'Bob',
      message: 'Looking for weekend availability',
    });

    expect(calls[0].path).toBe('/agent-tools/take-message');
    // callback_phone is undefined (dropped on JSON serialization) when not supplied
    expect(calls[0].body.callback_phone).toBeUndefined();
  });
});

describe('identify_caller', () => {
  it('HAPPY: injects tenant_id + phone from context, forwards LLM-supplied name', async () => {
    // WHO: Caller who gives their name mid-call before or instead of booking
    // WHAT: Tool posts tenant_id + callerPhone (from context) + name (from LLM) to identify-caller
    // WHEN: Agent hears the caller say their name and calls identify_caller immediately
    // WHERE: agent/src/tools.ts identify_caller → /agent-tools/identify-caller
    // WHY: Phone and tenant must come from context; name is the only LLM-supplied arg
    const { client, calls } = makeClient([{ ok: true, result: { identified: true } }]);
    const tools = buildTools(makeCtx(), client);

    await exec(tools.identify_caller, { name: 'Dale DeMott' });

    expect(calls[0].path).toBe('/agent-tools/identify-caller');
    expect(calls[0].body).toEqual({
      tenant_id: TENANT_ID,
      phone: CALLER_PHONE,
      name: 'Dale DeMott',
      call_id: CALL_ID,
    });
  });

  it('HAPPY: prefers the LLM-supplied spoken phone over caller ID', async () => {
    // WHO: Forwarded-line caller whose caller ID is NOT their own number
    // WHAT: When the LLM passes a phone (the number the caller said out loud),
    //        the tool saves the contact under THAT number, not ctx.callerPhone
    // WHEN: __PERSONA_NAME__ asks for the number, reads it back, then calls identify_caller(name, phone)
    // WHERE: agent/src/tools.ts identify_caller → /agent-tools/identify-caller
    // WHY: On a forwarded line the caller ID is the forwarding cell; the spoken
    //        number is the caller's true number and must be what lands in the CRM
    const { client, calls } = makeClient([{ ok: true, result: { identified: true } }]);
    const tools = buildTools(makeCtx(), client);

    await exec(tools.identify_caller, { name: 'Jane Doe', phone: '+16125551234' });

    expect(calls[0].body).toEqual({
      tenant_id: TENANT_ID,
      phone: '+16125551234',
      name: 'Jane Doe',
      call_id: CALL_ID,
    });
  });

  it('SAD: no spoken phone and no caller ID → asks for a number, no backend call', async () => {
    // WHO: Caller with blocked caller-ID who has not yet given a number
    // WHAT: Tool returns a plain string (not JSON) and skips the backend
    // WHY: Backend requires a real phone to upsert; null phone would fail validation
    const { client, calls } = makeClient([]);
    const tools = buildTools(makeCtx({ callerPhone: null }), client);

    const result = await exec(tools.identify_caller, { name: 'Jane Doe' });

    expect(result).toContain('ask the caller for their number');
    expect(calls).toHaveLength(0);
  });
});
