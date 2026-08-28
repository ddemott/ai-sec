import { llm } from '@livekit/agents';
import type { ToolMap } from './types.js';
import type { ToolBuildDeps } from './deps.js';
import { formatResponse } from './helpers.js';

export function verificationTools(d: ToolBuildDeps): ToolMap {
  const { ctx, client } = d;
  return {
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
          // Binds the code to THIS call. The server will only accept a
          // verification whose call_id matches the live call — without this the
          // code is issued unattributable and can never open the gate.
          call_id: ctx.callId,
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
          call_id: ctx.callId,
        });

        // ADOPT THE PROVEN NUMBER.
        //
        // The caller just read back a code we texted to this handset — that is
        // strictly stronger evidence than caller-ID, which the carrier asserts
        // and nobody confirms. Yet ctx.callerPhone was set once at session start
        // and never reassigned, and on a forwarded line it is null. So every
        // tool that guards on `if (!ctx.callerPhone)` — get_my_appointments,
        // send_self_service_link, cancel_appointment, reschedule_appointment —
        // kept refusing AFTER a successful verification. The caller proved who
        // they were and the agent still said "I can't do that without caller-ID."
        //
        // The OTP flow proved the number and then threw the proof away. This is
        // the line that keeps it. (Thinking Hammer's live line IS the forwarded
        // one, so this was every returning customer, every call.)
        if (res.ok) {
          const verified = res.result as { verified?: boolean; phone?: string } | undefined;
          if (verified?.verified) {
            // Take the SERVER's normalized E.164 form, not the raw string the LLM
            // transcribed from speech — every downstream tool looks the customer
            // up by exact phone match, so "(630) 822-9086" and "+16308229086" are
            // not interchangeable here.
            ctx.callerPhone = verified.phone ?? args.phone;
          }
        }

        return formatResponse(res);
      },
    }),
  };
}
