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
    return typeof res.result === 'string' ? res.result : JSON.stringify(res.result);
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
  transfer?: TransferCapability
): llm.ToolContext {
  return {
    get_customer_context: llm.tool({
      description:
        "Look up the caller in the CRM by their caller-ID phone. Returns the customer's name, a short history, and any saved preferences (preferred staff, last service, likes) to personalize the call. Call this ONCE at the start of the call when a phone is available.",
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      execute: async () => {
        if (!ctx.callerPhone) {
          return 'New caller - no history found.';
        }
        const res = await client.call('/agent-tools/customer-context', {
          tenant_id: ctx.tenantId,
          phone: ctx.callerPhone,
        });
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
        const res = await client.call('/agent-tools/service-catalog', {
          tenant_id: ctx.tenantId,
        });
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
        const res = await client.call('/agent-tools/available-slots', {
          tenant_id: ctx.tenantId,
          service_type: args.service_type,
          date: args.date,
        });
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
        const res = await client.call('/agent-tools/scheduling-options', {
          tenant_id: ctx.tenantId,
          requirements: {
            serviceType: args.service_type,
            requiredResourceCapabilities: args.required_resource_capabilities,
            requiredEmployeeSkills: args.required_employee_skills,
          },
          window: { from: args.window_from, to: args.window_to },
        });
        return formatResponse(res);
      },
    }),

    check_availability: llm.tool({
      description:
        'Check whether a specific resource is available at a specific time. Use when you have both a resource_id and a concrete start/end.',
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
        const res = await client.call('/agent-tools/check-availability', {
          tenant_id: ctx.tenantId,
          resource_id: args.resource_id,
          start_time: args.start_time,
          end_time: args.end_time,
        });
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
        const res = await client.call('/agent-tools/book-appointment', {
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
        return formatResponse(res);
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
        const res = await client.call('/agent-tools/policy-answer', {
          tenant_id: ctx.tenantId,
          question: args.question,
        });
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
