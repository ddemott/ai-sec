/**
 * LiveKit agent worker entry point.
 *
 * On every dispatched call:
 *   1. Connect to the room
 *   2. Parse room.metadata for tenant_id (set by the SIP dispatch rule)
 *   3. Wait for the SIP participant, extract caller-ID phone + call_id
 *   4. Build tool handlers (closure-scoped over tenant + call context)
 *   5. Build system prompt with runtime context baked in
 *   6. Start the voice session; say a greeting
 *
 * Critical design: `tenant_id` is NEVER passed to the LLM — the LLM never
 * sees it, the prompt never references it. It lives in closure scope on
 * every tool handler. Same for `call_id`. The only things the LLM
 * provides are conversation-level values (phone, service name, times).
 */
// Initialize Sentry BEFORE other imports so an early bootstrap error
// still gets captured. No-op when SENTRY_DSN is unset.
import { initSentry, captureException as captureSentry } from './sentry.js';
initSentry();

import { type JobContext, WorkerOptions, cli, defineAgent, voice } from '@livekit/agents';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as openai from '@livekit/agents-plugin-openai';
import * as silero from '@livekit/agents-plugin-silero';
import { fileURLToPath } from 'node:url';

import { config } from './config.js';
import { runFallback } from './fallback.js';
import { GrokTTS } from './grokTTS.js';
import { getLogger } from './logger.js';
import { buildSessionContext } from './sessionContext.js';
import { fetchTenantConfig } from './tenantConfig.js';
import { ToolsClient } from './toolsClient.js';
import { buildTools } from './tools.js';
import { TranscriptRecorder } from './transcript.js';
import { CallOutcomeTracker } from './callOutcome.js';
import { summarizeCall } from './callSummary.js';
import { classifyCallOutcome } from './callClassify.js';
import { createTransferExecutor } from './transferClient.js';
import { buildSystemPrompt, formatDateForPrompt } from './prompt.js';

// Startup check: BACKEND_URL defaulting to localhost silently misroutes all
// agent-tools calls in prod. Log at boot so Railway surfaces it immediately.
if (config.BACKEND_URL === 'http://localhost:4001') {
  console.warn(
    'WARNING: BACKEND_URL defaults to http://localhost:4001 — set BACKEND_URL on the ai-sec-agent Railway service or every /agent-tools/* call will misroute'
  );
}

export default defineAgent({
  prewarm: async (proc) => {
    proc.userData.vad = await silero.VAD.load();
  },

  entry: async (ctx: JobContext) => {
    await ctx.connect();

    const log = getLogger();
    log.info({ event: 'call_start', room: ctx.room.name }, 'agent entry — call dispatched');

    // 1. Tenant_id from dispatch metadata (preferred — set on the agent
    //    job by the LiveKit dispatch rule's "Dispatch metadata" field)
    //    falling back to room metadata. Robust to either wiring.
    const jobMetadata = ctx.job.metadata;
    const roomMetadata = ctx.room.metadata;
    const preliminaryCtx = buildSessionContext({
      jobMetadata,
      roomMetadata,
      participantAttributes: null, // SIP participant not joined yet
    });
    if (!preliminaryCtx) {
      // Dispatch rule misconfigured — no tenant_id means we can't safely
      // do anything. Start a bare session and say a fallback message.
      log.error(
        { event: 'fallback_triggered', reason: 'dispatch_metadata_invalid', room: ctx.room.name },
        'no tenant_id in dispatch/room metadata — running fallback'
      );
      captureSentry(new Error('dispatch_metadata_invalid'), {
        event: 'fallback_triggered',
        reason: 'dispatch_metadata_invalid',
        room: ctx.room.name,
      });
      await runFallback(
        ctx,
        "I'm sorry, we're having a system issue. Please try calling back in a moment.",
        config
      );
      return;
    }

    // 2. Wait for SIP participant to get caller-ID phone + callID
    //    Timeout is short — if it doesn't come in quickly the call is
    //    probably malformed and we should bail rather than hang silent.
    let participantAttributes: Record<string, string> | null = null;
    let participantIdentity: string | null = null;
    try {
      const sipParticipant = await Promise.race([
        ctx.waitForParticipant(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
      ]);
      if (sipParticipant) {
        participantAttributes = sipParticipant.attributes;
        // Identity is the handle the SIP transfer (cold REFER) targets — capture
        // it now so transfer_call can hand the live leg off to a human.
        participantIdentity = sipParticipant.identity;
      }
    } catch {
      // Non-fatal — we can still greet without a caller phone
      participantAttributes = null;
    }

    const sessionCtx = buildSessionContext({
      jobMetadata,
      roomMetadata,
      participantAttributes,
      roomName: ctx.room.name,
      participantIdentity,
    });
    if (!sessionCtx) {
      // Shouldn't happen — preliminaryCtx already succeeded — but be safe
      log.error(
        {
          event: 'fallback_triggered',
          reason: 'session_context_lost',
          tenant_id: preliminaryCtx.tenantId,
          room: ctx.room.name,
        },
        'session context unexpectedly null after participant join — running fallback'
      );
      captureSentry(new Error('session_context_lost'), {
        event: 'fallback_triggered',
        reason: 'session_context_lost',
        tenant_id: preliminaryCtx.tenantId,
        room: ctx.room.name,
      });
      await runFallback(ctx, "I'm sorry, we're having a system issue.", config);
      return;
    }

    // Per-call child logger — every subsequent line on this call carries
    // tenant_id + call_id + caller_phone so a Better Stack filter pulls
    // the full timeline for "the call at 2:14pm" support questions.
    const callLog = log.child({
      tenant_id: sessionCtx.tenantId,
      call_id: sessionCtx.callId,
      caller_phone: sessionCtx.callerPhone ?? null,
      room: ctx.room.name,
    });
    callLog.info({ event: 'session_context_resolved' }, 'tenant + caller resolved');

    // 3. Build tools client + fetch the tenant's display config. The
    //    fetch is a single round-trip to /agent-tools/tenant-config; on
    //    any failure (5xx, 401, missing fields, unknown tenant) it
    //    soft-falls to "this business" / America/Chicago so a config
    //    blip never hangs up a live caller. See agent/src/tenantConfig.ts.
    //
    //    Outer try/catch: if anything from here through session.start throws
    //    unexpectedly (e.g. a constructor error, a rejected promise slipping
    //    past fetchTenantConfig's internal guard), propagation out of entry
    //    kills the LiveKit job and leaves the caller in dead air. The outer
    //    catch degrades to a fallback message instead of silence.
    let client: ToolsClient;
    let tenantConfig: Awaited<ReturnType<typeof fetchTenantConfig>>;
    // Accumulates the spoken conversation (caller STT + agent replies) so the
    // shutdown callback can persist it as the call's transcript. Declared here
    // — above both the shutdown registration and the session listener — so both
    // close over the same recorder.
    const transcript = new TranscriptRecorder();
    // Tracks what happened on the call (booked / transferred + appointment_id),
    // mutated by the booking/transfer tools, read at shutdown for session-end.
    const outcomeTracker = new CallOutcomeTracker();
    try {
      client = new ToolsClient({
        backendUrl: config.BACKEND_URL,
        agentSecret: config.AGENT_SECRET,
      });

      // Call logging (2026-06-11): persist a voice_sessions row so the
      // dashboard Calls tab + customer call history populate. START is
      // fire-and-forget — it must NEVER delay the greeting or risk dead air,
      // so a failure is logged and swallowed. END is awaited inside the
      // shutdown callback so duration lands before the job tears down.
      // Skipped when callId is absent (nothing to key the session on).
      if (sessionCtx.callId) {
        const callId = sessionCtx.callId;
        const startedAtMs = Date.now();
        void client
          .call('/agent-tools/voice-session-start', {
            tenant_id: sessionCtx.tenantId,
            call_id: callId,
            caller_phone: sessionCtx.callerPhone ?? null,
          })
          .catch((e: unknown) =>
            callLog.warn(
              {
                event: 'voice_session_start_failed',
                error_message: e instanceof Error ? e.message : String(e),
              },
              'call-logging start failed (non-fatal)'
            )
          );
        ctx.addShutdownCallback(async () => {
          try {
            const rendered = transcript.render();
            const { outcome: trackedOutcome, appointmentId } = outcomeTracker.result();
            // Post-call summary is best-effort: summarizeCall is bounded + never
            // throws (resolves null on timeout/error), so it can never drop the
            // duration/transcript/outcome write below.
            const summary = await summarizeCall(rendered ?? '', config.OPENAI_API_KEY);
            // If no booking/transfer tool already set the outcome, classify WHY
            // the caller reached out (no_availability / wrong_service / price /
            // message / info). classifyCallOutcome is bounded + failsafe and
            // returns null when unclear — a null outcome stays 'no_outcome'
            // server-side, i.e. counted as abandoned. So we never guess.
            const outcome =
              trackedOutcome ?? (await classifyCallOutcome(rendered ?? '', config.OPENAI_API_KEY));
            await client.call('/agent-tools/voice-session-end', {
              tenant_id: sessionCtx.tenantId,
              call_id: callId,
              duration_seconds: Math.round((Date.now() - startedAtMs) / 1000),
              // null when nothing was spoken (e.g. silent hang-up) → SQL NULL.
              transcript: rendered,
              outcome,
              appointment_id: appointmentId,
              summary,
            });
          } catch (e) {
            callLog.warn(
              {
                event: 'voice_session_end_failed',
                error_message: e instanceof Error ? e.message : String(e),
              },
              'call-logging end failed (non-fatal)'
            );
          }
        });
      }

      // Fetch tenant config first — the transfer destination (forward_phone)
      // and the prompt both depend on it.
      tenantConfig = await fetchTenantConfig(client, sessionCtx.tenantId);
      callLog.info(
        {
          event: 'tenant_config_fetched',
          tenant_name: tenantConfig.name,
          timezone: tenantConfig.timezone,
        },
        'tenant config resolved'
      );

      // Live-transfer capability. The executor is null when the call lacks the
      // room/participant context needed to REFER (SIP participant never joined),
      // in which case transfer_call gracefully reports it can't transfer. The
      // forward number comes from the tenant config (NULL = no destination).
      const transferExecutor = createTransferExecutor({
        livekitUrl: config.LIVEKIT_URL,
        livekitApiKey: config.LIVEKIT_API_KEY,
        livekitApiSecret: config.LIVEKIT_API_SECRET,
        roomName: sessionCtx.roomName ?? undefined,
        participantIdentity: sessionCtx.participantIdentity ?? undefined,
      });
      // 4. Build prompt with runtime context
      const instructions = buildSystemPrompt({
        tenantName: tenantConfig.name,
        callerPhone: sessionCtx.callerPhone,
        currentDate: formatDateForPrompt(new Date(), tenantConfig.timezone),
        timezone: tenantConfig.timezone,
        // 2026-05-18: feed the tenant's customized persona (from
        // tenants.system_prompt, displayed/edited in the dashboard's AI
        // Persona page) into the prompt's identity section. NULL falls
        // back to the hardcoded "You are Clara, ..." line.
        customPrompt: tenantConfig.systemPrompt,
        // 2026-06-06: per-tenant customer-preference capture. When enabled, the
        // prompt gains a "Customer preferences" section + save tool guidance.
        savePreferencesEnabled: tenantConfig.savePreferencesEnabled,
        preferencesInstructions: tenantConfig.preferencesInstructions,
        ttsFormal: tenantConfig.ttsFormal,
        ttsWarm: tenantConfig.ttsWarm,
        ttsConcise: tenantConfig.ttsConcise,
      });

      // 5. Start the voice session. Wrapped in try/catch → runFallback: a
      //    throw here (LiveKit session.start, a plugin constructor, an STT/LLM/
      //    TTS upstream that rejects at init) would otherwise propagate out of
      //    `entry`, kill the job, and leave the caller in dead air. The fallback
      //    speaks a short message so the call degrades to "sorry" instead of
      //    silence. (2026-05-21 — closes the gap-1 outer-throw dead-air path.)
      try {
        const session = new voice.AgentSession({
          vad: ctx.proc.userData.vad as silero.VAD,
          stt: new deepgram.STT({ apiKey: config.DEEPGRAM_API_KEY, model: 'nova-3' }),
          llm: new openai.LLM({ apiKey: config.OPENAI_API_KEY, model: 'gpt-4o-mini' }),
          tts: new GrokTTS({
            apiKey: config.XAI_API_KEY,
            // Per-tenant Grok voice + delivery (2026-06-10), falling back to the
            // platform env defaults when the tenant hasn't picked one.
            voice: tenantConfig.ttsVoice ?? config.XAI_TTS_VOICE,
            speed: tenantConfig.ttsSpeed ?? config.XAI_TTS_SPEED,
            soft: tenantConfig.ttsSoft ?? config.XAI_TTS_SOFT,
            cheerful: tenantConfig.ttsCheerful ?? false,
          }),
        });

        // Tools built here so speakFiller can reference session.say —
        // execute() closures fire only after session.start(), so session is
        // always initialized by the time a filler phrase is spoken.
        const tools = buildTools(
          sessionCtx,
          client,
          {
            forwardPhone: tenantConfig.forwardPhone,
            execute: transferExecutor,
          },
          outcomeTracker,
          (phrase) => {
            void session.say(phrase, { allowInterruptions: true });
          }
        );

        const agent = new voice.Agent({
          instructions,
          tools,
        });

        await session.start({ agent, room: ctx.room });
        callLog.info({ event: 'session_started' }, 'voice session started — agent ready to greet');

        // Record every finalized turn (caller STT + agent replies) for the
        // call transcript. Attached BEFORE the greeting `say()` below — which
        // itself emits a `conversation_item_added` (addToChatCtx defaults true)
        // — so the transcript opens with the actual first line, no manual add.
        session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (ev) => {
          if (ev.item.type !== 'message') return;
          transcript.add(ev.item.role, ev.item.textContent);
        });

        // 6. Greeting. The owner-editable "First Message" (dashboard AI Persona)
        // is spoken verbatim when set; otherwise a short hardcoded fallback —
        // the LLM warms up from there either way.
        const greeting =
          tenantConfig.firstMessage?.trim() ||
          `Thanks for calling ${tenantConfig.name}. How can I help you today?`;
        void session.say(greeting, {
          allowInterruptions: true,
        });
      } catch (err) {
        callLog.error(
          {
            event: 'fallback_triggered',
            reason: 'session_start_failed',
            tenant_id: sessionCtx.tenantId,
            room: ctx.room.name,
            error_message: err instanceof Error ? err.message : String(err),
          },
          'voice session failed to start — running fallback so the caller is not left in dead air'
        );
        captureSentry(err instanceof Error ? err : new Error(String(err)), {
          event: 'fallback_triggered',
          reason: 'session_start_failed',
          tenant_id: sessionCtx.tenantId,
          room: ctx.room.name,
        });
        await runFallback(ctx, "I'm sorry, we're having a system issue.", config);
        return;
      }
    } catch (err) {
      // Outer catch: unexpected throw from tool-client setup, buildTools,
      // fetchTenantConfig, or buildSystemPrompt. Inner session.start errors
      // are caught above and never reach here. Log + degrade to fallback so
      // the caller is not left in silence.
      callLog.error(
        {
          event: 'fallback_triggered',
          reason: 'entry_setup_failed',
          tenant_id: sessionCtx.tenantId,
          room: ctx.room.name,
          error_message: err instanceof Error ? err.message : String(err),
        },
        'unexpected error in agent entry setup — running fallback'
      );
      captureSentry(err instanceof Error ? err : new Error(String(err)), {
        event: 'fallback_triggered',
        reason: 'entry_setup_failed',
        tenant_id: sessionCtx.tenantId,
        room: ctx.room.name,
      });
      await runFallback(ctx, "I'm sorry, we're having a system issue.", config);
    }
  },
});

cli.runApp(
  new WorkerOptions({
    agent: fileURLToPath(import.meta.url),
    // Must match the agentName in the LiveKit dispatch rule
    // (SDR_if97ky4Zf7e6 / dynatire-dispatch). If these drift, dispatched
    // jobs won't route to this worker and calls will hit dead air.
    agentName: 'ai-secretary-agent',
  })
);
