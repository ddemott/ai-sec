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
  ReportDispatchNoParticipantSchema,
} from './schemas';
import { ok, fail, toolRoute, pgErrorFields, type AgentToolDeps } from './helpers';
import { getBusinessHours } from '../../services/businessHours';
import { normalizePhone, isValidPhone } from '../../services/phoneUtils';
// Direct from shared/ per phoneUtils' own note ("all new code should import
// directly from shared/phone"). canTransfer is THE resolved transfer capability
// — see the transfer_available field below for why the agent gets a boolean
// rather than the two raw numbers.
import { canTransfer } from '../../../shared/phone';
import { sendSms } from '../../services/telnyxSms';
import { errorsTotal } from '../../services/metrics';

/**
 * How long a call must last before "the caller never spoke" is evidence of a
 * fault rather than of a caller who hung up. The cached greeting runs ~12s, so
 * anything under that never gave them a turn; 20s clears the greeting plus a
 * beat. Deliberately conservative — a false "your phone line is broken" alarm
 * is worse than a missed short call, and a genuinely broken audio path repeats.
 */
const SILENT_CALL_MIN_SECONDS = 20;

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
          inbound_phone: string | null;
          call_disclosure: string | null;
          greeting_menu: string | null;
          greeting_closer: string | null;
        }>(
          `SELECT name, timezone, system_prompt, persona_name, first_message, save_preferences_enabled, preferences_instructions, tts_voice, tts_speed, tts_soft, tts_cheerful, tts_formal, tts_warm, tts_concise, forward_phone, forwarded_from_phone, inbound_phone, call_disclosure, greeting_menu, greeting_closer FROM tenants WHERE tenant_id = $1`,
          [args.tenant_id]
        );
        if (!res.rows[0]) return null;
        // The shop's opening hours, derived from who is actually on the schedule
        // (there is no business-hours config — the open window IS the union of
        // staff shifts). Handed to the agent so it can LEAD with them instead of
        // asking "what day and time were you thinking?" against a calendar the
        // caller cannot see — the open-ended question that made the 2026-07-12
        // caller name two impossible dates in a row. 2026-07-12.
        const hours = await getBusinessHours(client, args.tenant_id);
        return { ...res.rows[0], hours };
      });
      if (!row) {
        return fail(reply, 'Tenant not found');
      }
      return ok(reply, {
        // Spoken hours ("Monday to Friday, 1:00 PM to 5:00 PM") + how far out we
        // can actually be booked. Empty string / null when nobody is scheduled —
        // the agent must then NOT claim to be open.
        business_hours: row.hours.spoken || null,
        bookable_through: row.hours.bookableThrough,
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
        // agent uses platform defaults, so tenants who haven't picked a voice are
        // unaffected. Post-2026-06-25 tts_voice/tts_speed are OpenAI voice/speed.
        //
        // The tts_soft/cheerful/formal/warm/concise flags are NOT inert — this
        // comment said they were until 2026-07-13, and it was wrong. They started
        // as Grok prosody knobs and were repurposed as LLM PROMPT-STYLE flags: the
        // dashboard still renders toggles for them and agent/src/prompt.ts injects
        // a "# Voice style" section from them. They ride this route to get there.
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
        // 2026-07-23: THE resolved transfer capability, decided here so the
        // agent never re-derives it from raw numbers.
        //
        // "Is forwarding on?" is the WRONG question — a tenant may forward from
        // a home line and transfer to a shop line, which is two different
        // numbers and a perfectly valid setup. The disqualifying condition is
        // SAMENESS: a transfer target equal to the line that forwards in (or to
        // our own inbound number) rings straight back into the assistant.
        // canTransfer() owns that comparison for every caller, normalized.
        //
        // Handed over as ONE boolean on purpose. The agent already received
        // forward_phone and forwarded_from_phone and did nothing with them; a
        // prompt that re-derives the rule is a second copy of the rule, and a
        // second copy drifts.
        transfer_available: canTransfer(
          row.forward_phone,
          row.forwarded_from_phone,
          row.inbound_phone
        ),
        // 2026-07-11: owner-editable spoken caller disclosure (AI + transcription
        // notice). NULL/blank means the agent speaks the platform default from
        // greeting.ts; a set value is spoken verbatim (attestation-gated on write).
        call_disclosure: row.call_disclosure ?? null,
        // 2026-07-21: owner-editable spoken services menu ("I can help with a
        // job opportunity, a drop-off computer repair…") — spoken between the
        // disclosure and "How can I help you today?". NULL/blank = no menu line.
        greeting_menu: row.greeting_menu ?? null,
        greeting_closer: row.greeting_closer ?? null,
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
        // DUPLICATE-DISPATCH DETECTOR (2026-07-23). The double-dispatch bug can
        // create TWO sessions for one inbound call — the 1:46 PM call had two
        // SIP legs 3s apart, both with the same caller_phone. The participant
        // guard in the agent kills the EMPTY-room variant, but a genuine
        // two-leg fork (both legs have a participant) still reaches here twice.
        // When a second live session appears for the same tenant+phone within a
        // short window, bump errors_total{event="duplicate_dispatch_detected"}
        // so the fork RATE is visible on /metrics. Observability ONLY — never
        // affects the session start (own try/catch, swallowed), because a false
        // positive (a real quick call-back) must not break call logging.
        if (args.caller_phone) {
          try {
            const dup = await withTenantClient(args.tenant_id, (client) =>
              client.query<{ n: number }>(
                `SELECT count(*)::int AS n FROM voice_sessions
                  WHERE tenant_id = $1 AND caller_phone = $2 AND call_id <> $3
                    AND started_at > now() - interval '30 seconds'
                    AND (is_deleted IS NULL OR is_deleted = false)`,
                [args.tenant_id, args.caller_phone, args.call_id]
              )
            );
            const priorCount = dup.rows[0]?.n ?? 0;
            if (priorCount > 0) {
              errorsTotal.inc({ event: 'duplicate_dispatch_detected' });
              app.log.warn(
                {
                  event: 'duplicate_dispatch_detected',
                  tenant_id: args.tenant_id,
                  call_id: args.call_id,
                  prior_sessions: priorCount,
                  caller_phone_last4: args.caller_phone.slice(-4),
                },
                'a second voice session opened for the same caller within 30s — likely a duplicate/forked dispatch'
              );
            }
          } catch {
            // Detector is best-effort; a failed observability query must never
            // fail the call-logging write above.
          }
        }
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

  // report-dispatch-no-participant — the agent posts this when a dispatch landed
  // on a room that never got a SIP participant (a ghost/duplicate dispatch) and
  // it left without opening a session. Observability ONLY: bumps
  // errors_total{event="dispatch_no_participant"} so the ghost-leg RATE is on the
  // /metrics board and alertable, and writes a 5W line. No DB write — there is
  // deliberately no voice_sessions row for a call nobody was on. (2026-07-23.)
  toolRoute(
    app,
    '/agent-tools/report-dispatch-no-participant',
    ReportDispatchNoParticipantSchema,
    // eslint-disable-next-line @typescript-eslint/require-await
    async (args, reply) => {
      errorsTotal.inc({ event: 'dispatch_no_participant' });
      app.log.warn(
        {
          event: 'dispatch_no_participant',
          tenant_id: args.tenant_id,
          room: args.room,
        },
        'agent left a dispatch with no SIP participant (ghost/duplicate dispatch) — no session opened'
      );
      return ok(reply, { recorded: true });
    },
    'Failed to record dispatch-no-participant'
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

      // SILENT CALL — the caller was on the line long enough to speak and not
      // one word of theirs reached us. The call still finalizes 'completed'
      // with a transcript holding only the agent's own greeting, which reads
      // like a caller who hung up. It is not: it is the shape a BROKEN INBOUND
      // AUDIO PATH makes.
      //
      // ORIGIN (2026-07-24, tenant Thinking Hammer): three of four real calls
      // arrived this way. Dale's wife called twice, spoke both times, and the
      // agent received 15 seconds of digital silence per call — Silero VAD
      // (local, on raw frames) never fired once, so nothing reached Deepgram
      // and the transcript held the greeting alone. Telnyx was offering
      // codecs LiveKit SIP cannot decode (G729 outright; G722 suspected),
      // negotiated per-caller — so it broke for mobile callers and worked for
      // the one overseas VoIP dialer. Nothing in the product said a word about
      // it. We found out because his wife mentioned the call in conversation.
      //
      // A call that produces zero caller speech is never a success. Count it
      // and say so, so the next one surfaces in `errors_total` within minutes
      // instead of being discovered socially.
      if (ended && (args.duration_seconds ?? 0) >= SILENT_CALL_MIN_SECONDS) {
        const transcript = args.transcript ?? '';
        // Anchored to line start — "Caller:" inside the assistant's own words
        // must not count as a caller turn. Mirrors renderedHasCallerTurn() in
        // agent/src/transcript.ts, which owns the rendering side of this
        // contract; the two regexes must stay in step.
        if (!/^Caller: /m.test(transcript)) {
          errorsTotal.inc({ event: 'no_caller_audio' });
          app.log.warn(
            {
              event: 'no_caller_audio',
              tenant_id: args.tenant_id,
              call_id: args.call_id,
              duration_seconds: args.duration_seconds ?? null,
              has_transcript: args.transcript != null,
              transcript_chars: transcript.length,
            },
            'call completed with ZERO caller speech after the greeting — inbound audio path is likely broken (codec negotiation / RTP), not a caller who hung up'
          );
        }
      }

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
