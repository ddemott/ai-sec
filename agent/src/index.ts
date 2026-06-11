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
import { buildSystemPrompt, formatDateForPrompt } from './prompt.js';

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
    try {
      const sipParticipant = await Promise.race([
        ctx.waitForParticipant(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
      ]);
      if (sipParticipant) {
        participantAttributes = sipParticipant.attributes;
      }
    } catch {
      // Non-fatal — we can still greet without a caller phone
      participantAttributes = null;
    }

    const sessionCtx = buildSessionContext({
      jobMetadata,
      roomMetadata,
      participantAttributes,
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
    try {
      client = new ToolsClient({
        backendUrl: config.BACKEND_URL,
        agentSecret: config.AGENT_SECRET,
      });
      const tools = buildTools(sessionCtx, client);
      tenantConfig = await fetchTenantConfig(client, sessionCtx.tenantId);
      callLog.info(
        {
          event: 'tenant_config_fetched',
          tenant_name: tenantConfig.name,
          timezone: tenantConfig.timezone,
        },
        'tenant config resolved'
      );

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
          }),
        });

        const agent = new voice.Agent({
          instructions,
          tools,
        });

        await session.start({ agent, room: ctx.room });
        callLog.info({ event: 'session_started' }, 'voice session started — agent ready to greet');

        // 6. Greeting. Kept short — the LLM will warm up from here.
        void session.say(`Thanks for calling ${tenantConfig.name}. How can I help you today?`, {
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
