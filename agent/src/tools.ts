/**
 * Tool definitions for the LiveKit agent.
 *
 * Each of the 23 backend /agent-tools/* routes is exposed to the LLM as a
 * function-tool. The `tenant_id` and (where relevant) `call_id` are
 * injected from the session context — the LLM never sees or supplies them.
 * This prevents an entire class of bugs where the LLM hallucinates or
 * drops the tenant scope.
 *
 * The tool factory takes (context, client) and returns a ToolContext map
 * keyed by the tool name the LLM will invoke. Attach it to the Agent via
 * `new voice.Agent({ tools: buildTools(ctx, client) })`.
 *
 * Execute functions always return a STRING (or JSON-stringified object)
 * because LiveKit feeds the return value straight back to the LLM as the
 * tool-result message. Returning rich objects would work but strings
 * surface nicely in traces.
 */
import { llm } from '@livekit/agents';
import type { SessionContext } from './sessionContext.js';
import type { ToolResponse, ToolsClient } from './toolsClient.js';
import type { TransferResult } from './transferClient.js';
import type { CallOutcomeTracker } from './callOutcome.js';
import { wrapToolExecute } from './tools/wrapTool.js';
import { getLogger } from './logger.js';

/**
 * Capability groups. Every tool belongs to exactly one; a customer agent can
 * compose a subset via `buildTools(..., { capabilities: [...] })` (e.g. a
 * message-taking line needs only 'knowledge' + 'messaging'). Default = all.
 * The grouping also documents which tools to lift together when copying a
 * capability into another agent.
 */
export type Capability =
  | 'knowledge'
  | 'messaging'
  | 'identity'
  | 'scheduling'
  | 'verification'
  | 'transfer';

const CAPABILITY_OF: Record<string, Capability> = {
  get_company_policy_answer: 'knowledge',
  take_message: 'messaging',
  capture_job_inquiry: 'messaging',
  page_owner_via_sms: 'messaging',
  get_customer_context: 'identity',
  get_detailed_customer_history: 'identity',
  send_self_service_link: 'scheduling',
  find_caller_by_name: 'identity',
  identify_caller: 'identity',
  save_customer_preference: 'identity',
  record_sms_consent: 'scheduling',
  get_service_catalog: 'scheduling',
  get_available_slots: 'scheduling',
  get_scheduling_options: 'scheduling',
  check_availability: 'scheduling',
  book_appointment: 'scheduling',
  book_with_scheduling: 'scheduling',
  get_my_appointments: 'scheduling',
  cancel_appointment: 'scheduling',
  reschedule_appointment: 'scheduling',
  send_verification_code: 'verification',
  verify_phone_code: 'verification',
  transfer_call: 'transfer',
};

/** Pull a UUID appointment_id out of a successful booking response, if present. */
function extractAppointmentId(res: ToolResponse): string | null {
  if (!res.ok || typeof res.result !== 'object' || res.result === null) return null;
  const id = (res.result as { appointment_id?: unknown }).appointment_id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * Live-transfer capability handed to buildTools. `forwardPhone` is the
 * destination (owner cell, NULL = unconfigured); `execute` performs the SIP
 * REFER and is null when the call lacks the room/participant context needed to
 * transfer. Kept separate from SessionContext so tools.ts never imports the
 * livekit-server-sdk and stays unit-testable with a plain mock.
 */
export interface TransferCapability {
  forwardPhone: string | null;
  execute: ((forwardPhone: string | null) => Promise<TransferResult>) | null;
}

/** Format a tool response for the LLM. Keeps success + error shapes uniform. */
function formatResponse(res: ToolResponse): string {
  if (res.ok) {
    if (typeof res.result === 'string') return res.result;
    // JSON.stringify(undefined) returns the JS value `undefined` (NOT the
    // string "undefined") — handing the LLM nothing to relay → a silent turn.
    // Guard so a success-with-no-result never produces dead air.
    const encoded = JSON.stringify(res.result);
    return encoded ?? 'Done.';
  }
  // Surface error_code for the LLM so the prompt's translation table fires.
  if (res.errorCode) {
    return JSON.stringify({ error: res.error, error_code: res.errorCode });
  }
  return JSON.stringify({ error: res.error });
}

/**
 * Spoken 12-hour clock from a local-naive datetime string
 * ("2026-07-15T16:00:00" → "4:00 PM"). Returns the raw input if it can't be
 * parsed, so the LLM still gets something to relay.
 */
function spokenClock(localNaive: string): string {
  const m = /T(\d{2}):(\d{2})/.exec(localNaive);
  if (!m) return localNaive;
  const h24 = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  // Guard out-of-range values (e.g. a malformed "T99:99") so we don't emit a
  // bogus "99:99" spoken time — fall back to the raw input as documented.
  if (h24 > 23 || min > 59) return localNaive;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${m[2]} ${ampm}`;
}

/**
 * True ONLY when both times parse cleanly AND differ to the minute (compared
 * on wall-clock: date + HH:MM). Uncertain input (unparseable) → false, so an
 * ambiguous value never fires a spurious "your time wasn't open" note.
 *
 * FRAME ASSUMPTION: both args are compared as LOCAL wall-clock digits. That is
 * correct because `requested_start` is prompted as local-naive (same as
 * window_from) and `booked_start` is backend-converted via toLocalWallClock →
 * local-naive. A trailing Z/offset on `requested_start` is stripped by the
 * regex, so a Z-suffix alone is harmless — BUT if the LLM ever sends a genuine
 * UTC *instant* (shifted digits, e.g. 21:30Z for 4:30pm local) this would false
 * "time_changed" on a correct booking. This is the live-call thing to watch.
 */
function bookedTimeDiffers(requested: string, booked: string): boolean {
  const norm = (s: string) => /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/.exec(s)?.[1] ?? null;
  const r = norm(requested);
  const b = norm(booked);
  if (r === null || b === null) return false;
  return r !== b;
}

/**
 * Format a book_with_scheduling response for the LLM. On success it names the
 * ACTUAL booked time (the backend returns it already converted to the tenant's
 * local wall-clock) so the agent confirms what was really booked — not the time
 * the caller asked for. `book_with_scheduling_atomic` takes the earliest open
 * slot at or after `window_from`, so a caller who asked for a specific time can
 * land on a different (usually earlier) slot; when `requestedStart` is supplied
 * and the booked slot differs, the returned payload carries an explicit
 * directive to tell the caller the real time + that their pick wasn't open.
 *
 * `requestedStart` MUST be the caller's specifically-requested start, NOT the
 * search-window bound — for "next available" requests the caller named no time,
 * so it's omitted and no mismatch note ever fires (the booked slot legitimately
 * differs from the window bound by design).
 *
 * Falls back to the generic formatter for errors or any legacy/no-booked_start
 * response shape (fail-safe: worst case the LLM still sees the raw result JSON).
 */
function formatBookingResponse(res: ToolResponse, requestedStart?: string): string {
  if (!res.ok || typeof res.result !== 'object' || res.result === null) {
    return formatResponse(res);
  }
  const r = res.result as {
    appointment_id?: string;
    employee_name?: string | null;
    booked_start?: string | null;
  };
  const bookedStart = typeof r.booked_start === 'string' ? r.booked_start : null;
  if (!bookedStart) return formatResponse(res);

  const spoken = spokenClock(bookedStart);
  const withWhom = r.employee_name ? ` with ${r.employee_name}` : '';
  const payload: Record<string, unknown> = {
    success: true,
    appointment_id: r.appointment_id ?? null,
    booked_time: spoken,
    employee: r.employee_name ?? null,
    instruction: `Booked${withWhom} for ${spoken}. Confirm THIS exact time (${spoken}) to the caller — it is the actual booked slot.`,
  };
  if (requestedStart && bookedTimeDiffers(requestedStart, bookedStart)) {
    payload.time_changed = true;
    payload.requested_time = spokenClock(requestedStart);
    payload.instruction =
      `Booked${withWhom} for ${spoken}, but the caller asked for ${spokenClock(requestedStart)}, which was NOT open. ` +
      `Tell the caller you booked the closest opening — ${spoken}${withWhom} — and ask if that works or if they'd like a different time.`;
  }
  return JSON.stringify(payload);
}

export function buildTools(
  ctx: SessionContext,
  client: ToolsClient,
  transfer?: TransferCapability,
  outcome?: CallOutcomeTracker,
  speakFiller?: (phrase: string) => void,
  opts?: { capabilities?: readonly Capability[] }
): llm.ToolContext {
  // Only offer a live transfer in the no-caller-ID fallbacks when one can
  // actually happen: the 'transfer' capability is active for this session, a
  // destination number is configured (forwardPhone), AND this call has transfer
  // wiring (transfer.execute — null when the SIP participant never joined / no
  // LiveKit context). Otherwise the agent would promise "I can transfer you" the
  // runtime can't honor (transfer_call returns not_configured / "not available"
  // → dead-end). Mirrors the prompt's capability gating (PR #114). When transfer
  // is unavailable we offer only a message.
  const canOfferTransfer =
    (!opts?.capabilities || opts.capabilities.includes('transfer')) &&
    !!transfer?.forwardPhone &&
    !!transfer?.execute;
  const transferOrMessage = canOfferTransfer ? 'transfer or take a message' : 'take a message';

  const allTools: llm.ToolContext = {
    get_customer_context: llm.tool({
      description:
        "Look up a caller in the CRM by phone. Returns the customer's name, a short history, and any saved preferences (preferred staff, last service, likes) to personalize the call. Pass the phone number the caller gave you verbally when you have it; otherwise it falls back to the caller-ID phone. Use this to recognize returning callers.",
      parameters: {
        type: 'object',
        properties: {
          phone: {
            type: 'string',
            description:
              "The caller's phone number, preferably the one they gave you out loud. Omit only if you have not collected one yet (the caller-ID phone is used as a fallback).",
          },
        },
        additionalProperties: false,
      },
      execute: async (args: { phone?: string }) => {
        const lookupPhone = args.phone?.trim() || ctx.callerPhone;
        if (!lookupPhone) {
          return 'New caller - no history found.';
        }
        // Trust is a property of the NUMBER, not of the session. The carrier
        // attested ctx.callerPhone; anything the LLM hands us is a claim the
        // caller made out loud — even on a call that HAS caller ID, since the
        // model can pass a different number than the one that rang us.
        const usingCarrierNumber =
          Boolean(ctx.callerPhone) && (!args.phone || lookupPhone === ctx.callerPhone);
        const res = await client.call(
          '/agent-tools/customer-context',
          {
            tenant_id: ctx.tenantId,
            phone: lookupPhone,
            phone_source: usingCarrierNumber ? 'caller_id' : 'spoken',
            call_id: ctx.callId,
          },
          { isReadOnly: true }
        );
        return formatResponse(res);
      },
    }),

    find_caller_by_name: llm.tool({
      description:
        "Look up callers by name in the CRM. Call this right after the caller gives you their name. Returns matching contacts with the phone number on file so you can confirm 'is this still your number?'. An empty list means no match — treat them as a new caller. Use this for name-first identification on this forwarded line, since caller ID is not the caller's own number.",
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The caller\'s name as they stated it, e.g. "Jane Doe".',
          },
        },
        required: ['name'],
        additionalProperties: false,
      },
      execute: async (args: { name: string }) => {
        const res = await client.call(
          '/agent-tools/find-customer-by-name',
          {
            tenant_id: ctx.tenantId,
            name: args.name,
          },
          { isReadOnly: true }
        );
        return formatResponse(res);
      },
    }),

    get_service_catalog: llm.tool({
      description:
        "List every service this business offers with duration and price. Use when the caller asks 'what do you offer' or you need service names/IDs.",
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      execute: async () => {
        const res = await client.call(
          '/agent-tools/service-catalog',
          {
            tenant_id: ctx.tenantId,
          },
          { isReadOnly: true }
        );
        return formatResponse(res);
      },
    }),

    get_available_slots: llm.tool({
      description:
        "Return a spoken description of open time slots for a specific service on a specific date. Use when the caller asks 'when can I come in for X' and has a day in mind. This returns spoken times ONLY — it does NOT return a bookable resource_id. To book one of these times, call book_with_scheduling with a tight window around the time the caller chose; do NOT call book_appointment or check_availability afterward (they need a resource_id this tool never yields).",
      parameters: {
        type: 'object',
        properties: {
          service_type: {
            type: 'string',
            description: 'Service name or partial match, e.g., "oil change" or "tire rotation".',
          },
          date: {
            type: 'string',
            description: 'Date in YYYY-MM-DD format in the tenant timezone.',
            pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          },
        },
        required: ['service_type', 'date'],
        additionalProperties: false,
      },
      execute: async (args: { service_type: string; date: string }) => {
        speakFiller?.('Let me check what we have open...');
        const res = await client.call(
          '/agent-tools/available-slots',
          {
            tenant_id: ctx.tenantId,
            service_type: args.service_type,
            date: args.date,
            // Attribute a pure availability inquiry to this call so a caller
            // who never books still counts toward abandonment-by-service.
            call_id: ctx.callId || undefined,
          },
          // Still retry-safe: the backend's requested_service_id capture is a
          // best-effort, COALESCE-guarded, deterministic UPDATE — replaying it
          // sets the same service_id, so an auto-retry can't corrupt state.
          { isReadOnly: true }
        );
        return formatResponse(res);
      },
    }),

    get_scheduling_options: llm.tool({
      description:
        'Compute valid (resource, employee) combinations for a service within a time window. Use for open-ended scheduling questions or to pre-check feasibility before booking.',
      parameters: {
        type: 'object',
        properties: {
          service_type: { type: 'string' },
          required_resource_capabilities: {
            type: 'array',
            items: { type: 'string' },
            description:
              "Optional capability tags the resource must have, e.g., ['lift', 'alignment'].",
          },
          required_employee_skills: {
            type: 'array',
            items: { type: 'string' },
            description: "Optional skill tags the employee must have, e.g., ['oil_change'].",
          },
          window_from: {
            type: 'string',
            description: 'ISO datetime start of the search window.',
          },
          window_to: {
            type: 'string',
            description: 'ISO datetime end of the search window.',
          },
        },
        required: ['service_type', 'window_from', 'window_to'],
        additionalProperties: false,
      },
      execute: async (args: {
        service_type: string;
        required_resource_capabilities?: string[];
        required_employee_skills?: string[];
        window_from: string;
        window_to: string;
      }) => {
        const res = await client.call(
          '/agent-tools/scheduling-options',
          {
            tenant_id: ctx.tenantId,
            requirements: {
              serviceType: args.service_type,
              requiredResourceCapabilities: args.required_resource_capabilities,
              requiredEmployeeSkills: args.required_employee_skills,
            },
            window: { from: args.window_from, to: args.window_to },
            // Attribute a pure availability inquiry to this call (see above).
            call_id: ctx.callId || undefined,
          },
          // Retry-safe — the capture UPDATE is idempotent (see available-slots).
          { isReadOnly: true }
        );
        return formatResponse(res);
      },
    }),

    check_availability: llm.tool({
      description:
        'Check whether a specific resource is available at a specific time. Use ONLY when you already have a resource_id from get_scheduling_options. get_available_slots does NOT return a resource_id — if you only have a time the caller picked, use book_with_scheduling instead of this tool. (SLOW lookup — 2-4s; a short filler like "one sec while I check that" is spoken automatically before the result.)',
      parameters: {
        type: 'object',
        properties: {
          resource_id: {
            type: 'string',
            description:
              'A resource_id from get_scheduling_options output (not from get_available_slots).',
          },
          start_time: { type: 'string', description: 'ISO datetime.' },
          end_time: { type: 'string', description: 'ISO datetime.' },
        },
        required: ['resource_id', 'start_time', 'end_time'],
        additionalProperties: false,
      },
      execute: async (args: { resource_id: string; start_time: string; end_time: string }) => {
        // Guardrail (prod bug #3): check_availability needs a resource_id that
        // ONLY get_scheduling_options returns. get_available_slots yields spoken
        // times with no resource_id, so the LLM sometimes reaches here empty-
        // handed. Fail loudly with a redirect instead of 400ing the backend or
        // letting the LLM invent an id.
        if (!args.resource_id || !args.resource_id.trim()) {
          return JSON.stringify({
            error:
              'check_availability needs a resource_id from get_scheduling_options. If you only have a time the caller chose, call book_with_scheduling with a tight window around that time instead.',
            error_code: 'RESOURCE_ID_REQUIRED',
          });
        }
        const res = await client.call(
          '/agent-tools/check-availability',
          {
            tenant_id: ctx.tenantId,
            resource_id: args.resource_id,
            start_time: args.start_time,
            end_time: args.end_time,
          },
          { isReadOnly: true }
        );
        return formatResponse(res);
      },
    }),

    book_appointment: llm.tool({
      description:
        "Book an appointment at a specific slot when you ALREADY have a resource_id from get_scheduling_options. The resource_id MUST come from get_scheduling_options — get_available_slots does NOT return one, so if you only have a date/time the caller chose, call book_with_scheduling instead of this tool. Requires a good phone number (caller-ID or one the caller gives you). If the response contains 'I'll need a good phone number', collect and confirm a number from the caller per the phone-handling guidance in the instructions, then retry.",
      parameters: {
        type: 'object',
        properties: {
          resource_id: {
            type: 'string',
            description:
              'A resource_id from get_scheduling_options output (not from get_available_slots).',
          },
          start_time: { type: 'string' },
          end_time: { type: 'string' },
          phone: {
            type: 'string',
            description:
              'Caller phone (E.164 preferred). Pass the caller-ID phone unless the caller gave you a different one verbally.',
          },
          name: { type: 'string', description: "Caller's name if known." },
          employee_id: { type: 'string', description: 'Optional — bind to a specific employee.' },
          description: {
            type: 'string',
            description: "Short description of what the caller wants, e.g., 'oil change'.",
          },
        },
        required: ['resource_id', 'start_time', 'end_time', 'phone'],
        additionalProperties: false,
      },
      execute: async (args: {
        resource_id: string;
        start_time: string;
        end_time: string;
        phone: string;
        name?: string;
        employee_id?: string;
        description?: string;
      }) => {
        // Guardrail (prod bug #3): book_appointment needs a resource_id that
        // ONLY get_scheduling_options returns. get_available_slots yields spoken
        // times with no resource_id, so the LLM sometimes reaches here empty-
        // handed and dead-ends. Fail loudly with a redirect to the one-call
        // path instead of 400ing the backend or letting the LLM invent an id.
        if (!args.resource_id || !args.resource_id.trim()) {
          return JSON.stringify({
            error:
              'book_appointment needs a resource_id from get_scheduling_options. If you only have a date and time the caller chose, call book_with_scheduling with a tight window around that time instead.',
            error_code: 'RESOURCE_ID_REQUIRED',
          });
        }
        speakFiller?.('One moment while I get that booked...');
        const bookRes = await client.call('/agent-tools/book-appointment', {
          tenant_id: ctx.tenantId,
          resource_id: args.resource_id,
          start_time: args.start_time,
          end_time: args.end_time,
          phone: args.phone,
          name: args.name,
          employee_id: args.employee_id,
          description: args.description ?? 'Booking via SecretaryHQ',
          call_id: ctx.callId ?? '',
        });
        const bookedId = extractAppointmentId(bookRes);
        if (bookedId) outcome?.recordBooking(bookedId);
        return formatResponse(bookRes);
      },
    }),

    book_with_scheduling: llm.tool({
      description:
        "Find a slot AND book it in one call using a time window and requirements. The default booking tool — use it after get_available_slots and when the caller says 'book the next available'. It books the EARLIEST open slot at or after window_from, so when the caller picked a SPECIFIC time, set window_from to exactly that time (a window that starts earlier will book them earlier than they asked). When the caller named a specific time, ALSO pass requested_start so the response can flag if the booked slot ended up different. The response returns the ACTUAL booked time (booked_time) — confirm THAT to the caller, not the time they requested.",
      parameters: {
        type: 'object',
        properties: {
          service_type: { type: 'string' },
          required_resource_capabilities: { type: 'array', items: { type: 'string' } },
          required_employee_skills: { type: 'array', items: { type: 'string' } },
          preferred_resource_id: { type: 'string' },
          window_from: { type: 'string' },
          window_to: { type: 'string' },
          requested_start: {
            type: 'string',
            description:
              'The exact start time the caller specifically asked for, local-naive ISO (e.g. 2026-07-15T16:30:00). Set ONLY when the caller named a specific time; OMIT for "next available" / open-ended requests. Lets the response tell the caller if the booked slot differs from their request.',
          },
          phone: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          reminder_lead_minutes: {
            type: 'number',
            description:
              'How many minutes BEFORE the appointment to text a reminder. Set ONLY when the caller agreed to a text reminder (after the SMS-consent disclosures — see "Text reminders"). Use 30 when they say yes without naming a time; use their number when they name one ("an hour before" → 60, "the day before" → 1440). OMIT entirely if they declined or were not asked.',
          },
        },
        required: ['service_type', 'window_from', 'window_to', 'phone'],
        additionalProperties: false,
      },
      execute: async (args: {
        service_type: string;
        required_resource_capabilities?: string[];
        required_employee_skills?: string[];
        preferred_resource_id?: string;
        window_from: string;
        window_to: string;
        requested_start?: string;
        phone: string;
        name?: string;
        description?: string;
        reminder_lead_minutes?: number;
      }) => {
        speakFiller?.('One moment while I find and book a slot...');
        const res = await client.call('/agent-tools/book-with-scheduling', {
          tenant_id: ctx.tenantId,
          phone: args.phone,
          name: args.name,
          description: args.description ?? 'Booking via SecretaryHQ',
          call_id: ctx.callId ?? '',
          requirements: {
            serviceType: args.service_type,
            requiredResourceCapabilities: args.required_resource_capabilities,
            requiredEmployeeSkills: args.required_employee_skills,
            preferredResourceId: args.preferred_resource_id,
          },
          window: { from: args.window_from, to: args.window_to },
          // Absent → backend falls back to the caller's stored lead preference,
          // then to the standard bundle. Never invent a value here.
          reminder_lead_minutes: args.reminder_lead_minutes ?? null,
        });
        const bookedId = extractAppointmentId(res);
        if (bookedId) outcome?.recordBooking(bookedId);
        return formatBookingResponse(res, args.requested_start);
      },
    }),

    get_company_policy_answer: llm.tool({
      description:
        "Semantic search the knowledge base for policy/FAQ answers. Use BEFORE inventing any answer about hours, pricing, policies, warranties, etc. Returns plain text to read to the caller, or a fallback 'don't have that info' message.",
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: "The caller's question as a natural-language string.",
          },
        },
        required: ['question'],
        additionalProperties: false,
      },
      execute: async (args: { question: string }) => {
        speakFiller?.('Let me look that up for you...');
        const res = await client.call(
          '/agent-tools/policy-answer',
          {
            tenant_id: ctx.tenantId,
            question: args.question,
          },
          { isReadOnly: true }
        );
        return formatResponse(res);
      },
    }),

    send_verification_code: llm.tool({
      description:
        'Send a 4-digit SMS verification code to the given phone. Use when a booking tool rejected for "I\'ll need a good phone number" and the caller has provided one verbally. Returns a message string to read VERBATIM to the caller.',
      parameters: {
        type: 'object',
        properties: {
          phone: {
            type: 'string',
            description:
              'The full phone number the caller gave you. Must include area code (10+ digits).',
          },
        },
        required: ['phone'],
        additionalProperties: false,
      },
      execute: async (args: { phone: string }) => {
        const res = await client.call('/agent-tools/send-verification-code', {
          tenant_id: ctx.tenantId,
          phone: args.phone,
        });
        return formatResponse(res);
      },
    }),

    verify_phone_code: llm.tool({
      description:
        'Verify a 4-digit code the caller just spoke back. On success the phone is trusted and the original booking can proceed. On failure the response tells you whether to ask again, resend, or pivot to taking a message.',
      parameters: {
        type: 'object',
        properties: {
          phone: {
            type: 'string',
            description: 'Must match the phone passed to send_verification_code.',
          },
          code: {
            type: 'string',
            description: 'The 4-digit code the caller read back. Digits only.',
            pattern: '^\\d+$',
          },
        },
        required: ['phone', 'code'],
        additionalProperties: false,
      },
      execute: async (args: { phone: string; code: string }) => {
        const res = await client.call('/agent-tools/verify-phone-code', {
          tenant_id: ctx.tenantId,
          phone: args.phone,
          code: args.code,
        });
        return formatResponse(res);
      },
    }),

    identify_caller: llm.tool({
      description:
        "Save or update the caller's contact record, and look them up. Call this as soon as you have their number — you do not need their name first. Keeps the address book current without duplicating records.\n\nIf the number is one we already have, the response may come back with returning_customer:true plus their NAME, saved preferences and recent history — USE it (greet them by name, offer their usual). You then do NOT need to ask their name: you have it. Confirm it instead ('I have you as Camille — still right?') rather than asking them to repeat it; a name you read from the record is more reliable than one heard over a phone line.\n\nIf it returns requires_verification:true, the number was one THEY SPOKE (we had no caller ID), so we cannot trust it yet and will tell you nothing about the account. Send them a code (send_verification_code) and verify it (verify_phone_code) BEFORE calling this again — never greet them by name or mention any account until it is verified.",
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The caller\'s full name as they stated it, e.g. "Dale DeMott".',
          },
          phone: {
            type: 'string',
            description:
              "The caller's phone number as they gave it to you out loud. Always pass this when you have it — do not rely on caller ID.",
          },
        },
        required: ['name'],
        additionalProperties: false,
      },
      execute: async (args: { name: string; phone?: string }) => {
        const contactPhone = args.phone?.trim() || ctx.callerPhone;
        if (!contactPhone) {
          return 'No phone number available — ask the caller for their number, then save the contact.';
        }
        // WHERE DID THIS NUMBER COME FROM? This decides whether the backend will
        // reveal the caller's name, preferences and history — or demand OTP first.
        //
        //   ctx.callerPhone set  → the CARRIER gave us the number. Trustworthy.
        //   ctx.callerPhone null → we had no caller ID (forwarded line / blocked),
        //                          so any number here is one the CALLER SPOKE. It is
        //                          a claim, and anyone can claim anyone's number.
        //
        // Sending 'spoken' when unsure is the safe failure: worst case the caller
        // does an extra 20-second verification. Sending 'caller_id' when unsure
        // hands a stranger someone else's name and history.
        // phone_source describes THE NUMBER WE ARE SENDING — not the session's mood.
        //
        // A caller can have a perfectly good caller-ID and still give us a DIFFERENT
        // number ("actually, use my mobile"). That number is SPOKEN: they said it, we
        // cannot verify it, and it must not unlock someone else's account. Only the
        // number the CARRIER handed us is carrier-attested.
        //
        // Caught by a test that passed a spoken phone on a session that had caller-ID
        // — the first version of this line said 'caller_id' and would have trusted it.
        const usingCarrierNumber =
          Boolean(ctx.callerPhone) && (!args.phone || args.phone === ctx.callerPhone);
        const phoneSource = usingCarrierNumber ? 'caller_id' : 'spoken';
        const res = await client.call('/agent-tools/identify-caller', {
          tenant_id: ctx.tenantId,
          phone: args.phone ?? ctx.callerPhone,
          name: args.name,
          phone_source: phoneSource,
          call_id: ctx.callId ?? undefined,
        });
        return formatResponse(res);
      },
    }),

    save_customer_preference: llm.tool({
      description:
        "Remember a durable fact about the caller for future calls — preferred staff member, the service they just had, a like/dislike, an allergy, a standing request. Only use when the business has asked you to track preferences and the fact will still matter next time. Saving is silent; don't announce it. No-op if the caller isn't a known customer yet.",
      parameters: {
        type: 'object',
        properties: {
          phone: {
            type: 'string',
            description:
              "The caller's phone. Pass the caller-ID phone unless they gave a different verified one.",
          },
          key: {
            type: 'string',
            description:
              'Short stable label for the preference, e.g. "preferred_stylist", "last_service", "dislikes". Reuse the same key to update an existing preference.',
          },
          value: {
            type: 'string',
            description: 'The preference itself in plain text, e.g. "Maria" or "balayage".',
          },
        },
        required: ['phone', 'key', 'value'],
        additionalProperties: false,
      },
      execute: async (args: { phone: string; key: string; value: string }) => {
        const res = await client.call('/agent-tools/save-customer-preference', {
          tenant_id: ctx.tenantId,
          phone: args.phone,
          key: args.key,
          value: args.value,
        });
        return formatResponse(res);
      },
    }),

    record_sms_consent: llm.tool({
      description:
        'Record that the caller VERBALLY agreed to receive SMS appointment confirmations and reminders. Call this ONLY after you have (1) asked permission, naming the business, (2) said it is for appointment messages only, (3) said "message and data rates may apply", (4) said they can reply STOP anytime — AND the caller clearly said yes. NEVER use this for marketing or promotions; appointment confirmations/reminders only. Pass the mobile number the caller confirmed for texts.',
      parameters: {
        type: 'object',
        properties: {
          phone: {
            type: 'string',
            description:
              'The mobile number the caller confirmed for appointment text reminders (the number they will actually be texted).',
          },
        },
        required: ['phone'],
        additionalProperties: false,
      },
      execute: async (args: { phone: string }) => {
        const res = await client.call('/agent-tools/record-consent', {
          tenant_id: ctx.tenantId,
          phone: args.phone,
          call_id: ctx.callId || undefined,
        });
        return formatResponse(res);
      },
    }),

    page_owner_via_sms: llm.tool({
      description:
        "URGENTLY page the business owner by text, mid-call, with the caller's name, callback number, and a one-line reason. Use ONLY for genuinely urgent or escalation-worthy matters the owner should see immediately (an emergency at the property, an angry customer threatening to leave, a time-critical business issue) — for ordinary requests use take_message instead. You may page the owner AT MOST ONCE per call. If it reports it can't page, offer to take a message instead.",
      parameters: {
        type: 'object',
        properties: {
          caller_name: {
            type: 'string',
            description: "The caller's name as they gave it.",
          },
          callback_phone: {
            type: 'string',
            description:
              "Number the owner should call back. Omit if the caller didn't give one (caller-ID is used).",
          },
          reason: {
            type: 'string',
            description:
              "ONE short line saying why this is urgent, e.g. 'water leak flooding the shop'. Be specific.",
          },
        },
        required: ['caller_name', 'reason'],
        additionalProperties: false,
      },
      execute: async (args: { caller_name: string; callback_phone?: string; reason: string }) => {
        // Per-call guard: one successful page maximum. The flag lives on the
        // session context so it survives across turns for the whole call.
        if (ctx.ownerPaged) {
          return JSON.stringify({
            error:
              'The owner has already been paged once on this call — do not page again. Offer to take a message with any additional details instead.',
          });
        }
        const res = await client.call('/agent-tools/page-owner', {
          tenant_id: ctx.tenantId,
          caller_name: args.caller_name,
          callback_phone: args.callback_phone,
          caller_phone: ctx.callerPhone ?? undefined,
          reason: args.reason,
          // Truthy check (not ??) so an empty-string callId is omitted — the
          // backend call_id is min(1) and would 400 on ''.
          call_id: ctx.callId || undefined,
        });
        if (res.ok) ctx.ownerPaged = true;
        return formatResponse(res);
      },
    }),

    take_message: llm.tool({
      description:
        "Record a message from the caller for the business owner and send the owner an SMS alert. Use when the caller has a question you can't answer, wants a callback, or asks to leave a message. Always collect a name and the message content before calling this. A callback number is optional if you already have caller-ID.",
      parameters: {
        type: 'object',
        properties: {
          caller_name: {
            type: 'string',
            description: "The caller's name as they gave it.",
          },
          callback_phone: {
            type: 'string',
            description:
              "Phone number the owner should call back. Omit if the caller didn't give one (caller-ID will be used).",
          },
          message: {
            type: 'string',
            description:
              'The substance of what the caller wants the owner to know or do. Be specific — capture exactly what they said.',
          },
        },
        required: ['caller_name', 'message'],
        additionalProperties: false,
      },
      execute: async (args: { caller_name: string; callback_phone?: string; message: string }) => {
        speakFiller?.('One moment while I pass that along...');
        const res = await client.call('/agent-tools/take-message', {
          tenant_id: ctx.tenantId,
          caller_name: args.caller_name,
          callback_phone: args.callback_phone,
          caller_phone: ctx.callerPhone ?? undefined,
          message: args.message,
          call_id: ctx.callId ?? undefined,
        });
        return formatResponse(res);
      },
    }),

    capture_job_inquiry: llm.tool({
      description:
        "Record a work/job inquiry for the business owner and email it to them. Use when a caller asks whether the owner is available for work or about a specific position, AFTER you have walked through the intake questions (company, whether they work there, contract vs full-time, rate/salary range, contract length if applicable, onsite/remote/hybrid, and address or timezone). Always collect at least the caller's name. You MUST call this tool once you have the answers — do not tell the caller you'll pass it along without calling it. Fields you didn't get may be omitted.",
      parameters: {
        type: 'object',
        properties: {
          caller_name: { type: 'string', description: "The caller's name as they gave it." },
          callback_phone: {
            type: 'string',
            description: 'Phone number the owner should call back, if given.',
          },
          company: {
            type: 'string',
            description: 'The hiring company the caller represents.',
          },
          represents_company: {
            type: 'boolean',
            description:
              'True if the caller works for the hiring company (vs. a recruiter/agency).',
          },
          employment_type: {
            type: 'string',
            enum: ['contract', 'full_time'],
            description: 'Whether the position is a contract or full time.',
          },
          rate_range: {
            type: 'string',
            description: 'The rate range (contract) or salary range (full time) offered.',
          },
          duration: {
            type: 'string',
            description: 'Length of the contract. Omit for full-time roles.',
          },
          location_type: {
            type: 'string',
            enum: ['onsite', 'remote', 'hybrid'],
            description: 'Whether the position is onsite, remote, or hybrid.',
          },
          address: {
            type: 'string',
            description: 'Address of the position. Collect for onsite or hybrid roles.',
          },
          timezone: {
            type: 'string',
            description:
              'Timezone of the position. Collect for remote roles (so the owner knows office hours).',
          },
        },
        required: ['caller_name'],
        additionalProperties: false,
      },
      execute: async (args: {
        caller_name: string;
        callback_phone?: string;
        company?: string;
        represents_company?: boolean;
        employment_type?: 'contract' | 'full_time';
        rate_range?: string;
        duration?: string;
        location_type?: 'onsite' | 'remote' | 'hybrid';
        address?: string;
        timezone?: string;
      }) => {
        speakFiller?.('One moment while I pass that along to Dale...');
        const res = await client.call('/agent-tools/capture-job-inquiry', {
          tenant_id: ctx.tenantId,
          caller_name: args.caller_name,
          callback_phone: args.callback_phone ?? ctx.callerPhone ?? undefined,
          company: args.company,
          represents_company: args.represents_company,
          employment_type: args.employment_type,
          rate_range: args.rate_range,
          duration: args.duration,
          location_type: args.location_type,
          address: args.address,
          timezone: args.timezone,
          // Truthy check (not ??) so an empty-string callId is omitted — the
          // backend call_id is min(1) and would 400 on ''.
          call_id: ctx.callId || undefined,
        });
        return formatResponse(res);
      },
    }),

    get_detailed_customer_history: llm.tool({
      description:
        "Pull the caller's FULL history: their last ~10 appointments (any status, with service, staff member, date, and status), all saved preferences, and summaries of their last few calls. Deeper than get_customer_context — use when the caller asks about past visits ('when was I last in?', 'what did I have done last time?') or you need real history to answer well. Uses the verified caller phone automatically — no input needed.",
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      execute: async () => {
        // Phone is SERVER-INJECTED from session context (same trust model as
        // get_my_appointments) — the LLM never supplies it, so it can never
        // enumerate another caller's history.
        if (!ctx.callerPhone) {
          return JSON.stringify({
            error:
              'No verified caller phone yet — identify the caller first (confirm their name and number, e.g. via find_caller_by_name or identify_caller), then I can pull their history.',
          });
        }
        const res = await client.call(
          '/agent-tools/customer-history',
          {
            tenant_id: ctx.tenantId,
            phone: ctx.callerPhone,
            // This tool only ever sends ctx.callerPhone — the number the CARRIER
            // gave us. The LLM cannot substitute one here (there is no phone
            // parameter), which is why this is 'caller_id'. The server no longer
            // takes that on faith; it just happens to be true.
            phone_source: 'caller_id',
            call_id: ctx.callId,
          },
          { isReadOnly: true }
        );
        return formatResponse(res);
      },
    }),

    send_self_service_link: llm.tool({
      description:
        "Text the caller a secure link to cancel or reschedule one of their upcoming appointments THEMSELVES. Offer this proactively when a caller wants to cancel or reschedule — many prefer a link over doing it live. Pass the appointment_id from get_my_appointments; omit it to target the caller's next upcoming appointment. Requires the caller's verified phone (caller-ID) and their prior consent to receive texts; on failure, handle the cancel/reschedule live on the call instead.",
      parameters: {
        type: 'object',
        properties: {
          appointment_id: {
            type: 'string',
            description:
              "UUID of the appointment, exactly as returned by get_my_appointments. Omit to use the caller's next upcoming appointment.",
          },
        },
        additionalProperties: false,
      },
      execute: async (args: { appointment_id?: string }) => {
        // Ownership is phone-gated server-side, same as cancel/reschedule —
        // the phone comes from session context, never from the LLM.
        if (!ctx.callerPhone) {
          return JSON.stringify({
            error:
              "I can't text a link without caller-ID to verify the appointment is theirs. Handle the cancel or reschedule on the call instead.",
          });
        }
        const res = await client.call('/agent-tools/send-self-service-link', {
          tenant_id: ctx.tenantId,
          phone: ctx.callerPhone,
          appointment_id: args.appointment_id,
        });
        return formatResponse(res);
      },
    }),

    get_my_appointments: llm.tool({
      description:
        "Fetch the caller's upcoming scheduled appointments. Call this when the caller says they want to cancel or reschedule — show them their appointments before acting. Does not require any input from the caller; phone is from caller-ID.",
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      execute: async () => {
        if (!ctx.callerPhone) {
          return JSON.stringify({
            error: `I can't look up appointments without caller-ID. If you'd like help canceling or rescheduling, I can ${transferOrMessage}.`,
          });
        }
        const res = await client.call(
          '/agent-tools/my-appointments',
          { tenant_id: ctx.tenantId, phone: ctx.callerPhone },
          { isReadOnly: true }
        );
        return formatResponse(res);
      },
    }),

    cancel_appointment: llm.tool({
      description:
        "Cancel one of the caller's upcoming appointments. ALWAYS call get_my_appointments first and read the result back so the caller can confirm which appointment they want to cancel. Ask them to confirm BEFORE calling this. For rescheduling use reschedule_appointment instead.",
      parameters: {
        type: 'object',
        properties: {
          appointment_id: {
            type: 'string',
            description:
              'UUID of the appointment to cancel, exactly as returned by get_my_appointments.',
          },
        },
        required: ['appointment_id'],
        additionalProperties: false,
      },
      execute: async (args: { appointment_id: string }) => {
        if (!ctx.callerPhone) {
          return JSON.stringify({
            error: `I can't cancel without caller-ID to verify ownership. Offer to ${transferOrMessage}.`,
          });
        }
        const res = await client.call('/agent-tools/cancel-appointment', {
          tenant_id: ctx.tenantId,
          phone: ctx.callerPhone,
          appointment_id: args.appointment_id,
        });
        return formatResponse(res);
      },
    }),

    reschedule_appointment: llm.tool({
      description:
        "Move an existing appointment to a new date and time. ALWAYS call get_my_appointments first so the caller can confirm which appointment to move. Confirm the new time verbally before calling this. Use book_with_scheduling to find an available slot if the caller doesn't have one yet.",
      parameters: {
        type: 'object',
        properties: {
          appointment_id: {
            type: 'string',
            description:
              'UUID of the appointment to reschedule, exactly as returned by get_my_appointments.',
          },
          new_start_time: {
            type: 'string',
            description: 'New start time in ISO 8601 format (e.g. 2026-07-15T10:00:00).',
          },
          new_end_time: {
            type: 'string',
            description: 'New end time in ISO 8601 format (e.g. 2026-07-15T11:00:00).',
          },
        },
        required: ['appointment_id', 'new_start_time', 'new_end_time'],
        additionalProperties: false,
      },
      execute: async (args: {
        appointment_id: string;
        new_start_time: string;
        new_end_time: string;
      }) => {
        if (!ctx.callerPhone) {
          return JSON.stringify({
            error: `I can't reschedule without caller-ID to verify ownership. Offer to ${transferOrMessage}.`,
          });
        }
        speakFiller?.('One moment while I move that for you...');
        const res = await client.call('/agent-tools/reschedule-appointment', {
          tenant_id: ctx.tenantId,
          phone: ctx.callerPhone,
          appointment_id: args.appointment_id,
          new_start_time: args.new_start_time,
          new_end_time: args.new_end_time,
        });
        return formatResponse(res);
      },
    }),

    transfer_call: llm.tool({
      description:
        'Transfer the live call to a real person (the business owner / staff cell). Use ONLY when the caller clearly needs a human — a personal call for the owner, an urgent issue you cannot handle, or an explicit request to be connected to someone. Before calling this, tell the caller you are connecting them (e.g. "One moment, connecting you now."). On success the call leaves this assistant; on failure or when transfer is unavailable, apologize briefly and offer to take a message.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      execute: async () => {
        // No transfer wiring on this call (missing LiveKit creds or the SIP
        // participant never joined) — tell the LLM to fall back to a message.
        if (!transfer?.execute) {
          return JSON.stringify({
            error: 'Transfer is not available right now. Offer to take a message instead.',
          });
        }
        const result = await transfer.execute(transfer.forwardPhone);
        if (result.ok) {
          outcome?.recordTransfer();
          return 'Transfer started — the caller is being connected to a team member now. Do not keep talking; the call is leaving this assistant.';
        }
        if (result.reason === 'not_configured') {
          return JSON.stringify({
            error:
              'No transfer number is set up for this business, so you cannot connect the caller. Offer to take a message instead.',
          });
        }
        return JSON.stringify({
          error:
            'The transfer did not go through. Apologize briefly and offer to take a message instead.',
        });
      },
    }),
  };

  // Harden + compose. Wrap every tool's execute with the never-freeze contract
  // (timeout + catch→string + never-empty) IN PLACE, then return only the
  // selected capabilities (default: all). Wrapping at this one boundary means a
  // tool a customer adds is non-freezing BY CONSTRUCTION — it can't stall the
  // turn or hand the model an empty result.
  const wanted = opts?.capabilities;
  const result: llm.ToolContext = {};
  for (const [name, ft] of Object.entries(allTools)) {
    const cap = CAPABILITY_OF[name];
    if (wanted && (cap === undefined || !wanted.includes(cap))) continue;
    const mutable = ft as unknown as { execute: (args: never, opts: never) => Promise<unknown> };
    mutable.execute = wrapToolExecute(name, mutable.execute, {
      onError: ({ tool, reason, error }) =>
        getLogger().warn(
          {
            event: 'tool_contract_fallback',
            tool,
            reason,
            error_message: error instanceof Error ? error.message : undefined,
          },
          `tool ${tool} ${reason} — returned a graceful fallback so the caller is not left in silence`
        ),
    });
    result[name] = ft;
  }
  return result;
}
