import { llm } from '@livekit/agents';
import type { ToolMap } from './types.js';
import type { ToolBuildDeps } from './deps.js';
import { formatResponse } from './helpers.js';

export function smsTools(d: ToolBuildDeps): ToolMap {
  const { ctx, client } = d;
  return {
    record_sms_consent: llm.tool({
      description:
        'Record that the caller VERBALLY agreed to receive SMS appointment confirmations and reminders. Do NOT call this if sms_consent was already true — their permission is on file and does not expire. If sms_consent was false or absent, you DO need to ask and then call this. Call this ONLY after you have (1) asked permission, naming the business, (2) said it is for appointment messages only, (3) said "message and data rates may apply", (4) said they can reply STOP anytime — AND the caller clearly said yes. NEVER use this for marketing or promotions; appointment confirmations/reminders only. Pass the mobile number the caller confirmed for texts.',
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
  };
}
