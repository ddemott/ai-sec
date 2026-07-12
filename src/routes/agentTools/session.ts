/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method, @typescript-eslint/no-explicit-any */
/**
 * ESLint rules disabled for this file as part of historical full cleanup (REFACTORING_TODO item 10; see RESOLVED.md for details).
 * These are the remaining dynamic/any-heavy areas after previous tranches.
 */

/**
 * Call-lifecycle agent tools: the tenant config the worker reads on connect,
 * and the voice_sessions row it opens, incrementally updates, and finalizes.
 */
import {
  GetTenantConfigSchema,
  VoiceSessionStartSchema,
  VoiceSessionEndSchema,
  VoiceSessionTranscriptSchema,
} from './schemas';
import { ok, fail, toolRoute, pgErrorFields, type AgentToolDeps } from './helpers';
import { normalizePhone, isValidPhone } from '../../services/phoneUtils';
import { sendSms } from '../../services/telnyxSms';
import { errorsTotal } from '../../services/metrics';

export function registerSessionRoutes({ app, withTenantClient }: AgentToolDeps): void {
  // tenant-config — minimal display info the agent worker needs at the
  // start of every call (business name + IANA timezone). Read on connect
  // before the system prompt is built so the LLM greets with the real
  // business name and reasons about "today" in the tenant's local zone.
  toolRoute(
    app,
    '/agent-tools/tenant-config',
    GetTenantConfigSchema,
    async (args, reply) => {
      const row = await withTenantClient(args.tenant_id, async (client) => {
        const res = await client.query<{
          name: string;
          timezone: string | null;
          system_prompt: string | null;
          persona_name: string | null;
          first_message: string | null;
          save_preferences_enabled: boolean | null;
          preferences_instructions: string | null;
          tts_voice: string | null;
          tts_speed: number | null;
          tts_soft: boolean | null;
          tts_cheerful: boolean | null;
          tts_formal: boolean | null;
          tts_warm: boolean | null;
          tts_concise: boolean | null;
          forward_phone: string | null;
          forwarded_from_phone: string | null;
          call_disclosure: string | null;
        }>(
          `SELECT name, timezone, system_prompt, persona_name, first_message, save_preferences_enabled, preferences_instructions, tts_voice, tts_speed, tts_soft, tts_cheerful, tts_formal, tts_warm, tts_concise, forward_phone, forwarded_from_phone, call_disclosure FROM tenants WHERE tenant_id = $1`,
          [args.tenant_id]
        );
        return res.rows[0] ?? null;
      });
      if (!row) {
        return fail(reply, 'Tenant not found');
      }
      return ok(reply, {
        name: row.name,
        timezone: row.timezone || 'America/Chicago',
        // 2026-05-18: surface the tenant's custom prompt template so the agent
        // worker can substitute placeholders and use it as the role/identity
        // section. NULL means "use the agent's hardcoded fallback" — preserves
        // backwards compatibility with tenants that haven't customized.
        system_prompt: row.system_prompt,
        // 2026-06-30: owner-editable assistant name (dashboard "Assistant Name").
        // The agent injects "Your name is X" so it overrides any name baked into
        // the system_prompt text. NULL = keep whatever the prompt already says.
        persona_name: row.persona_name ?? null,
        // 2026-06-11: the owner-editable greeting (dashboard "First Message").
        // NULL means the agent speaks its hardcoded "Thanks for calling…"
        // fallback, so a tenant that never set one is unaffected.
        first_message: row.first_message ?? null,
        // 2026-06-06: customer-preference capture config. When enabled, the
        // agent injects preferences_instructions into the prompt and is told
        // to call save_customer_preference. Default false / null is "off".
        save_preferences_enabled: row.save_preferences_enabled ?? false,
        preferences_instructions: row.preferences_instructions ?? null,
        // 2026-06-10 (Grok era): per-tenant TTS voice + delivery. NULL means the
        // agent uses platform defaults. Post-2026-06-25 these are OpenAI voice/speed
        // (the columns were kept; legacy Grok-only prosody flags tts_soft etc. are inert).
        // env defaults, so tenants who haven't picked a voice are unaffected.
        tts_voice: row.tts_voice ?? null,
        tts_speed: row.tts_speed ?? null,
        tts_soft: row.tts_soft ?? null,
        tts_cheerful: row.tts_cheerful ?? null,
        tts_formal: row.tts_formal ?? null,
        tts_warm: row.tts_warm ?? null,
        tts_concise: row.tts_concise ?? null,
        // 2026-06-11: live-transfer destination (owner cell). NULL means no
        // forwarding configured — the agent's transfer_call tool stays inert
        // and falls back to taking a message.
        forward_phone: row.forward_phone ?? null,
        // The line the tenant forwards INTO the assistant — caller-ID match
        // tells the agent to collect the caller's real number by voice.
        forwarded_from_phone: row.forwarded_from_phone ?? null,
        // 2026-07-11: owner-editable spoken caller disclosure (AI + transcription
        // notice). NULL/blank means the agent speaks the platform default from
        // greeting.ts; a set value is spoken verbatim (attestation-gated on write).
        call_disclosure: row.call_disclosure ?? null,
      });
    },
    'Failed to fetch tenant config'
  );

  // voice-session-start — agent calls this on connect to create the
  // voice_sessions row (and resolve customer context). start_voice_session
  // does a plain INSERT (not idempotent) — the agent calls it once per call
  // and treats failure as non-fatal, so a duplicate/transient error can't
  // affect the live call.
  toolRoute(
    app,
    '/agent-tools/voice-session-start',
    VoiceSessionStartSchema,
    async (args, reply) => {
      try {
        await withTenantClient(args.tenant_id, (client) =>
          client.query('SELECT start_voice_session($1, $2, $3) AS context', [
            args.tenant_id,
            args.call_id,
            args.caller_phone ?? null,
          ])
        );
      } catch (err) {
        // 5W sad-path log so a call that fails to log is diagnosable from ONE
        // line. WHO: tenant_id. WHAT: voice_session_start (caller_phone null =
        // forwarded/anonymous line). WHEN: now (call connect). WHERE: this RPC.
        // WHY: the pg SQLSTATE/constraint/column. Plus errors_total{event} so the
        // failure survives log truncation. The agent calls this fire-and-forget,
        // so without this the call simply vanishes (Calls tab empty, no trace).
        errorsTotal.inc({ event: 'voice_session_start_failed' });
        app.log.error(
          {
            event: 'voice_session_start_failed',
            tenant_id: args.tenant_id,
            call_id: args.call_id,
            caller_phone_present: args.caller_phone != null,
            ...pgErrorFields(err),
          },
          'voice-session-start failed — call will NOT appear in the Calls tab'
        );
        return fail(reply, 'Failed to start voice session', 500);
      }
      return ok(reply, { started: true });
    },
    'Failed to start voice session'
  );

  // voice-session-end — agent calls this from its shutdown callback when the
  // call ends, recording duration, outcome, the rendered transcript, a post-call
  // summary, and the appointment_id booked during the call (all optional; the
  // agent fills what it has). Returns ended:false if no open row matched.
  toolRoute(
    app,
    '/agent-tools/voice-session-end',
    VoiceSessionEndSchema,
    async (args, reply) => {
      let sessionEnd: { ended: boolean; forwardPhone: string | null; inboundPhone: string | null };
      try {
        sessionEnd = await withTenantClient(args.tenant_id, async (client) => {
          const res = await client.query<{ ended: boolean }>(
            'SELECT end_voice_session($1, $2, $3, $4, $5, $6, $7) AS ended',
            [
              args.tenant_id,
              args.call_id,
              args.duration_seconds ?? null,
              args.outcome ?? null,
              args.transcript ?? null,
              args.summary ?? null,
              args.appointment_id ?? null,
            ]
          );
          if (!['price', 'no_availability'].includes(args.outcome ?? '')) {
            return { ended: res.rows[0]?.ended ?? false, forwardPhone: null, inboundPhone: null };
          }
          const tenant = await client.query<{
            forward_phone: string | null;
            inbound_phone: string | null;
          }>('SELECT forward_phone, inbound_phone FROM tenants WHERE tenant_id = $1', [
            args.tenant_id,
          ]);
          return {
            ended: res.rows[0]?.ended ?? false,
            forwardPhone: tenant.rows[0]?.forward_phone ?? null,
            inboundPhone: tenant.rows[0]?.inbound_phone ?? null,
          };
        });
      } catch (err) {
        // 5W sad-path log: an end failure means duration/transcript/outcome/
        // summary never persisted and the row is stranded 'active'. WHO tenant,
        // WHAT voice_session_end, WHERE this RPC, WHY the pg SQLSTATE/constraint.
        errorsTotal.inc({ event: 'voice_session_end_failed' });
        app.log.error(
          {
            event: 'voice_session_end_failed',
            tenant_id: args.tenant_id,
            call_id: args.call_id,
            outcome: args.outcome ?? null,
            has_transcript: args.transcript != null,
            ...pgErrorFields(err),
          },
          'voice-session-end failed — transcript/duration/summary NOT saved; row left active'
        );
        return fail(reply, 'Failed to end voice session', 500);
      }
      const { ended, forwardPhone, inboundPhone } = sessionEnd;

      if (ended && forwardPhone && inboundPhone) {
        const normalizedForward = normalizePhone(forwardPhone);
        const normalizedInbound = normalizePhone(inboundPhone);
        if (
          normalizedForward &&
          normalizedInbound &&
          isValidPhone(normalizedForward) &&
          isValidPhone(normalizedInbound)
        ) {
          const outcomeMsg =
            args.outcome === 'price'
              ? 'had concerns about pricing'
              : 'could not find an available time';
          const body = `SecretaryHQ: A recent caller ${outcomeMsg}. They may be worth a follow-up. — via SecretaryHQ`;
          sendSms({ from: normalizedInbound, to: normalizedForward, body }).catch(
            (err: unknown) => {
              app.log.error({ err }, 'Failed to send outcome-follow-up SMS to owner');
            }
          );
        }
      }

      return ok(reply, { ended });
    },
    'Failed to end voice session'
  );

  // voice-session-transcript — incremental transcript save. The agent posts the
  // transcript-so-far after EVERY turn so a call that hangs or never sends
  // voice-session-end still has its conversation persisted up to the last turn.
  // Updates ONLY while the row is still 'active' (a finalized row's transcript is
  // authoritative — don't let a late straggler overwrite it). status is NOT
  // changed here; finalize/reaper own that.
  toolRoute(
    app,
    '/agent-tools/voice-session-transcript',
    VoiceSessionTranscriptSchema,
    async (args, reply) => {
      try {
        const res = await withTenantClient(args.tenant_id, (client) =>
          client.query(
            `UPDATE voice_sessions SET transcript = $3, updated_at = now()
             WHERE tenant_id = $1 AND call_id = $2 AND status = 'active'`,
            [args.tenant_id, args.call_id, args.transcript]
          )
        );
        return ok(reply, { updated: (res.rowCount ?? 0) > 0 });
      } catch (err) {
        // 5W sad-path: a failed incremental save is non-fatal (the next turn or
        // finalize/reaper catches up) but still worth a counter + named cause.
        errorsTotal.inc({ event: 'voice_session_transcript_failed' });
        app.log.error(
          {
            event: 'voice_session_transcript_failed',
            tenant_id: args.tenant_id,
            call_id: args.call_id,
            transcript_len: args.transcript.length,
            ...pgErrorFields(err),
          },
          'voice-session-transcript incremental save failed (non-fatal)'
        );
        return fail(reply, 'Failed to save transcript', 500);
      }
    },
    'Failed to save transcript'
  );
}
