/**
 * Tool definitions for the LiveKit agent.
 *
 * Each of the 11 backend /agent-tools/* routes is exposed to the LLM as a
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

export function buildTools(
  ctx: SessionContext,
  client: ToolsClient,
  transfer?: TransferCapability,
  outcome?: CallOutcomeTracker,
  speakFiller?: (phrase: string) => void
): llm.ToolContext {
  return {
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
        const res = await client.call(
          '/agent-tools/customer-context',
          {
            tenant_id: ctx.tenantId,
            phone: lookupPhone,
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
        "Return a spoken description of open time slots for a specific service on a specific date. Use when the caller asks 'when can I come in for X' and has a day in mind.",
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
          },
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
          },
          { isReadOnly: true }
        );
        return formatResponse(res);
      },
    }),

    check_availability: llm.tool({
      description:
        'Check whether a specific resource is available at a specific time. Use when you have both a resource_id and a concrete start/end. (SLOW lookup — 2-4s; a short filler like "one sec while I check that" is spoken automatically before the result.)',
      parameters: {
        type: 'object',
        properties: {
          resource_id: { type: 'string' },
          start_time: { type: 'string', description: 'ISO datetime.' },
          end_time: { type: 'string', description: 'ISO datetime.' },
        },
        required: ['resource_id', 'start_time', 'end_time'],
        additionalProperties: false,
      },
      execute: async (args: { resource_id: string; start_time: string; end_time: string }) => {
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
        "Book an appointment at a specific slot. Requires a VERIFIED phone (either caller-ID or OTP-confirmed). If the response contains 'I'll need a good phone number', pivot to the Phone Verification flow in the instructions.",
      parameters: {
        type: 'object',
        properties: {
          resource_id: { type: 'string' },
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
        "Find a slot AND book it in one call using a time window and requirements. Prefer this over get_scheduling_options + book_appointment when the caller says 'book the next available'.",
      parameters: {
        type: 'object',
        properties: {
          service_type: { type: 'string' },
          required_resource_capabilities: { type: 'array', items: { type: 'string' } },
          required_employee_skills: { type: 'array', items: { type: 'string' } },
          preferred_resource_id: { type: 'string' },
          window_from: { type: 'string' },
          window_to: { type: 'string' },
          phone: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
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
        phone: string;
        name?: string;
        description?: string;
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
        });
        const bookedId = extractAppointmentId(res);
        if (bookedId) outcome?.recordBooking(bookedId);
        return formatResponse(res);
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
        'Send a 6-digit SMS verification code to the given phone. Use when a booking tool rejected for "I\'ll need a good phone number" and the caller has provided one verbally. Returns a message string to read VERBATIM to the caller.',
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
        'Verify a 6-digit code the caller just spoke back. On success the phone is trusted and the original booking can proceed. On failure the response tells you whether to ask again, resend, or pivot to taking a message.',
      parameters: {
        type: 'object',
        properties: {
          phone: {
            type: 'string',
            description: 'Must match the phone passed to send_verification_code.',
          },
          code: {
            type: 'string',
            description: 'The 6-digit code the caller read back. Digits only.',
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
        "Save or update the caller's contact record (phone + name). Call this as soon as the caller gives you their name and number — even if they're not booking. Pass the phone number the caller gave you verbally; it falls back to the caller-ID phone only when you have not collected one. Keeps the address book current without duplicating records.",
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
        const res = await client.call('/agent-tools/identify-caller', {
          tenant_id: ctx.tenantId,
          phone: contactPhone,
          name: args.name,
          // Link the verbally-captured number to THIS call so the Calls tab row +
          // detail show it (forwarded-line calls start with caller_phone null).
          // Truthy check (not ?? ) so an empty-string callId is omitted rather
          // than sent — the backend's call_id is min(1) and would 400 on ''.
          call_id: ctx.callId || undefined,
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
            description: 'True if the caller works for the hiring company (vs. a recruiter/agency).',
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
            description: 'Timezone of the position. Collect for remote roles (so the owner knows office hours).',
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
            error:
              "I can't look up appointments without caller-ID. If you'd like help canceling or rescheduling, I can transfer you or take a message.",
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
            error:
              "I can't cancel without caller-ID to verify ownership. Offer to transfer or take a message.",
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
            error:
              "I can't reschedule without caller-ID to verify ownership. Offer to transfer or take a message.",
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
}
