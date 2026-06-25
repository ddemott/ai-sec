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

import { config, untrustedCallerIdTenants } from './config.js';
import { runFallback } from './fallback.js';
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

/** OpenAI TTS voices offered in the dashboard picker. Validate the tenant's
 *  saved voice against this set so a legacy Grok value (e.g. 'ara') or anything
 *  unexpected falls back to 'shimmer' instead of erroring at the OpenAI API. */
const OPENAI_VOICES = ['shimmer', 'nova', 'alloy', 'echo', 'onyx', 'fable'] as const;
function toOpenAIVoice(v: string | null | undefined): (typeof OPENAI_VOICES)[number] {
  return v && (OPENAI_VOICES as readonly string[]).includes(v)
    ? (v as (typeof OPENAI_VOICES)[number])
    : 'shimmer';
}

export default defineAgent({
  prewarm: async (proc) => {
    // Boot-version marker. Printed once when the worker process starts, so the
    // Railway logs unambiguously show WHICH code is live (vs guessing from a
    // redeploy). If you don't see build 'spoken-phone-v3-openai-tts' + these features in
    // the logs, the worker is running an older deployment.
    getLogger().info(
      {
        event: 'agent_boot',
        build: 'spoken-phone-v3-openai-tts',
        features: ['find_caller_by_name', 'untrusted_caller_id', 'spoken_phone_params'],
      },
      'ai-sec-agent worker booting'
    );
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

    // Forwarded-line guard: for tenants whose inbound number is a forwarded
    // line (env UNTRUSTED_CALLER_ID_TENANTS), the SIP caller ID is the
    // forwarding cell, NOT the caller. Null it BEFORE anything reads it — the
    // child logger, the fire-and-forget voice-session-start record, the prompt,
    // and every tool — so nothing ever keys off the forwarding number. The
    // agent collects the caller's real number verbally instead.
    if (untrustedCallerIdTenants.has(sessionCtx.tenantId) && sessionCtx.callerPhone) {
      log.info(
        { event: 'caller_id_ignored', tenant_id: sessionCtx.tenantId, room: ctx.room.name },
        'caller ID ignored for forwarded-line tenant — collecting number verbally'
      );
      sessionCtx.callerPhone = null;
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
    // Accumulates per-model AI usage (LLM tokens, STT audio, TTS chars) from
    // LiveKit's SessionUsageUpdated events. Updated during the call; read once
    // at shutdown to POST costs to /agent-tools/record-ai-cost.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sessionModelUsage: any[] = [];
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
      // finalizeCall is assigned inside the callId block below and invoked from
      // the session 'close' event (registered after session.start). Declared at
      // this scope so the close handler can see it. Null when there's no callId.
      let finalizeCall: ((hook: 'close' | 'shutdown') => Promise<void>) | null = null;
      // Skipped when callId is absent (nothing to key the session on).
      if (sessionCtx.callId) {
        const callId = sessionCtx.callId;
        const startedAtMs = Date.now();
        // 5W sad path: callLog already carries tenant_id/call_id/caller_phone/
        // room (WHO/WHERE). ToolsClient.call() does NOT throw on a backend 5xx —
        // it RESOLVES to { ok:false, error, status } — so we must inspect the
        // result, not only .catch() (which fires only on a network/throw). Both
        // branches log the breadcrumb that this call never created a
        // voice_sessions row (so it won't show in the Calls tab). The backend
        // logs the pg SQLSTATE/constraint; this is the agent-side marker.
        void client
          .call('/agent-tools/voice-session-start', {
            tenant_id: sessionCtx.tenantId,
            call_id: callId,
            caller_phone: sessionCtx.callerPhone ?? null,
          })
          .then((res) => {
            if (!res.ok) {
              callLog.error(
                {
                  event: 'voice_session_start_failed',
                  forwarded_line: sessionCtx.callerPhone == null,
                  status: res.status ?? null,
                  error_message: res.error,
                },
                'call-logging START failed (non-fatal to the live call) — this call will NOT appear in the Calls tab'
              );
            }
          })
          .catch((e: unknown) =>
            callLog.error(
              {
                event: 'voice_session_start_failed',
                forwarded_line: sessionCtx.callerPhone == null,
                error_message: e instanceof Error ? e.message : String(e),
              },
              'call-logging START threw (non-fatal to the live call) — this call will NOT appear in the Calls tab'
            )
          );
        // Fire-once writer of the call's completion record. Invoked from BOTH
        // the session 'close' event (participant hangup — the reliable signal)
        // and ctx.addShutdownCallback (job teardown — backstop). On a single
        // hangup the worker often stays alive for the next job, so the shutdown
        // callback may never run; 'close' is what actually fires. The guard makes
        // the first caller win; the other no-ops. (A server-side reaper catches
        // anything that still slips through.)
        // callFinalized flips true ONLY after a successful finalize write, so a
        // failed 'close' attempt leaves the shutdown backstop free to retry.
        // finalizing dedupes concurrent entry (close + shutdown firing together).
        let callFinalized = false;
        let finalizing = false;
        finalizeCall = async (hook: 'close' | 'shutdown'): Promise<void> => {
          if (callFinalized || finalizing) return;
          finalizing = true;
          callLog.info({ event: 'voice_session_finalize_entered', hook }, 'finalizing call record');
          try {
            const rendered = transcript.render();
            const { outcome: trackedOutcome, appointmentId } = outcomeTracker.result();
            const durationSeconds = Math.round((Date.now() - startedAtMs) / 1000);

            // 1. FINALIZE FIRST — close the row with the data we already have,
            //    BEFORE the slow LLM steps below. An abrupt disconnect/process
            //    teardown during summarize/classify must not strand the row
            //    'active' with no duration/transcript (the exact bug seen on the
            //    first real Beth call). end_voice_session overwrites by
            //    (tenant_id, call_id) with no status guard, so the enrich pass
            //    can safely add summary/outcome afterward. trackedOutcome is only
            //    ever a real tool outcome (booked/transferred) — never the
            //    classify-only price/no_availability that triggers the owner SMS
            //    — so this first write can't double-send that alert.
            const finalizeRes = await client.call('/agent-tools/voice-session-end', {
              tenant_id: sessionCtx.tenantId,
              call_id: callId,
              duration_seconds: durationSeconds,
              // null when nothing was spoken (e.g. silent hang-up) → SQL NULL.
              transcript: rendered,
              outcome: trackedOutcome,
              appointment_id: appointmentId,
            });
            // ToolsClient.call() resolves { ok:false } on a backend 5xx (does NOT
            // throw), so the catch below won't fire on a 500 — inspect the result
            // so a finalize failure (row left active, no duration/transcript) is
            // actually logged, not silently swallowed.
            if (!finalizeRes.ok) {
              callLog.error(
                {
                  event: 'voice_session_end_failed',
                  phase: 'finalize',
                  status: finalizeRes.status ?? null,
                  outcome: trackedOutcome,
                  has_transcript: rendered != null,
                  error_message: finalizeRes.error,
                },
                'call-logging FINALIZE failed — row may stay active with no duration/transcript'
              );
              // Leave callFinalized=false so the shutdown backstop (or, failing
              // everything, the server-side reaper) can still close this row.
              return;
            }
            // Finalize succeeded — safe to suppress retries now.
            callFinalized = true;

            // 2. Best-effort enrichment — bounded LLM summary + outcome class.
            //    Both are bounded + failsafe (resolve null on timeout/error), so
            //    they can never undo the finalize above. classifyCallOutcome
            //    names WHY the caller reached out when no tool set an outcome.
            const summaryResult = await summarizeCall(rendered ?? '', config.OPENAI_API_KEY);
            const summary = summaryResult.summary;
            const classifyResult = await classifyCallOutcome(rendered ?? '', config.OPENAI_API_KEY);
            const outcome = trackedOutcome ?? classifyResult.outcome;

            // 3. ENRICH PASS — re-call only when there's something new (a summary,
            //    or a classified outcome we didn't already have). Re-pass the
            //    durable fields because end_voice_session SETs every column — a
            //    partial call would null out the duration/transcript just saved.
            if (summary != null || outcome !== trackedOutcome) {
              const enrichRes = await client.call('/agent-tools/voice-session-end', {
                tenant_id: sessionCtx.tenantId,
                call_id: callId,
                duration_seconds: durationSeconds,
                transcript: rendered,
                outcome,
                appointment_id: appointmentId,
                summary,
              });
              if (!enrichRes.ok) {
                callLog.warn(
                  {
                    event: 'voice_session_enrich_failed',
                    status: enrichRes.status ?? null,
                    error_message: enrichRes.error,
                  },
                  'call-logging summary/outcome enrich failed — row already finalized, summary not attached'
                );
              }
            }
            // Fire-and-forget: POST session AI usage to the cost ledger.
            // sessionModelUsage is empty when the session never started (e.g.
            // fallback path) — skip silently rather than inserting a zero row.
            let finalModelUsage = sessionModelUsage;
            if (summaryResult.usage) {
              finalModelUsage = [
                ...finalModelUsage,
                {
                  type: 'llm_usage',
                  provider: 'openai',
                  model: 'gpt-4o-mini',
                  inputTokens: summaryResult.usage.inputTokens,
                  outputTokens: summaryResult.usage.outputTokens,
                  charactersCount: 0,
                  audioDurationMs: 0,
                },
              ];
            }
            if (classifyResult.usage) {
              finalModelUsage = [
                ...finalModelUsage,
                {
                  type: 'llm_usage',
                  provider: 'openai',
                  model: 'gpt-4o-mini',
                  inputTokens: classifyResult.usage.inputTokens,
                  outputTokens: classifyResult.usage.outputTokens,
                  charactersCount: 0,
                  audioDurationMs: 0,
                },
              ];
            }
            if (finalModelUsage.length > 0) {
              void client
                .call('/agent-tools/record-ai-cost', {
                  tenant_id: sessionCtx.tenantId,
                  call_id: callId,
                  source: 'voice_call',
                  model_usage: finalModelUsage,
                })
                .catch((e: unknown) =>
                  callLog.warn(
                    {
                      event: 'ai_cost_record_failed',
                      error_message: e instanceof Error ? e.message : String(e),
                    },
                    'AI cost record failed (non-fatal)'
                  )
                );
            }
          } catch (e) {
            // 5W sad path: callLog carries tenant_id/call_id/caller_phone/room.
            // Add WHY + which write was in flight so a stranded 'active' row (no
            // duration/transcript/summary) is diagnosable. Backend logs the pg
            // SQLSTATE; this is the agent-side breadcrumb at shutdown.
            callLog.error(
              {
                event: 'voice_session_end_failed',
                error_message: e instanceof Error ? e.message : String(e),
              },
              'call-logging END failed (non-fatal to the caller) — duration/transcript/summary NOT saved; row may stay active'
            );
            // callFinalized stays false (set only on success) → backstop retries.
          } finally {
            finalizing = false;
          }
        };
        // Hangup ('close') is the reliable finalize signal; job-shutdown is the
        // backstop. callFinalized (set only after a successful write) dedupes;
        // finalizing guards against the two hooks racing into a double-write.
        ctx.addShutdownCallback(() => finalizeCall?.('shutdown') ?? Promise.resolve());
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
          // TTS is OpenAI. The plugin is non-streaming (buffers the whole clip
          // before any audio plays), so model latency = dead air on every reply.
          // tts-1 measured 2–5s/sentence → multi-second silent gaps that callers
          // fill with "hello?", which cancelled the reply. gpt-4o-mini-tts is
          // ~1.3s and consistent. Per-tenant voice/speed from the dashboard;
          // tts_voice is an OpenAI voice id (unset/legacy → 'shimmer'). 2026-06-25.
          tts: new openai.TTS({
            apiKey: config.OPENAI_API_KEY,
            model: 'gpt-4o-mini-tts',
            voice: toOpenAIVoice(tenantConfig.ttsVoice),
            speed: tenantConfig.ttsSpeed ?? 1.0,
          }),
          // Don't let a short backchannel ("hello?", "ok") during the TTS gap
          // cancel/discard Beth's in-flight reply (the failure in the trace:
          // a 1-word turn pre-empted the generation, orphaning the tool output).
          turnHandling: {
            interruption: {
              // 'adaptive' = LiveKit's CNN barge-in model: it decides whether to
              // yield the turn from the ACOUSTICS of the overlapping speech, not
              // from a raw VAD/duration threshold — so a brief "hello?"/backchannel
              // during the TTS gap no longer cancels the in-flight reply. Default-on
              // for LiveKit Cloud + Node ≥1.2.0 + VAD (we have silero); set
              // explicitly so intent survives a self-host path. Requires a
              // non-realtime LLM + aligned-transcript STT (Deepgram qualifies).
              mode: 'adaptive',
              // minWords is the EFFECTIVE lever when STT is on: a verified LiveKit
              // maintainer note says STT-detected speech bypasses minDuration, so
              // raising duration alone does nothing — require ≥2 words to interrupt.
              minWords: 2,
              // If speech is detected but NO transcript follows within 2s (a false
              // trigger — line noise, a cough, a half-word), resume speaking from
              // where Beth left off instead of staying silent. Direct guard against
              // a phantom "interruption" killing the reply → dead air.
              falseInterruptionTimeout: 2000,
              resumeFalseInterruption: true,
            },
            // Endpointing = how long of a pause ends the caller's turn. Default
            // minDelay 500ms ends the turn on the brief pause BETWEEN spoken
            // fragments — so a phone number ("312 865" … "1186") or a multi-part
            // answer ("it's W2" … "in Chicago" … "$65/hr") arrives as several
            // turns, each starting a generation the next fragment then discards →
            // Beth never finishes a reply → freeze. Wait ~1.3s of silence so a
            // multi-part answer AGGREGATES into one turn → one reply. maxDelay
            // caps the wait so a truly-finished caller isn't left hanging.
            endpointing: {
              minDelay: 1300,
              maxDelay: 4000,
            },
          },
        });

        // Tools are built after the session exists. speakFiller is now a no-op
        // (it used to call session.say() from inside execute(), which stalled the
        // generation — see the no-op comment below), so it no longer depends on
        // session being initialized; the ordering is harmless either way.
        const tools = buildTools(
          sessionCtx,
          client,
          {
            forwardPhone: tenantConfig.forwardPhone,
            execute: transferExecutor,
          },
          outcomeTracker,
          // speakFiller is intentionally a NO-OP. It used to call
          // session.say('one moment…') from INSIDE a tool's execute() — but
          // injecting a say() into the middle of the LLM's function-call
          // generation is an unsupported LiveKit pattern that can stall the
          // generation loop (the agent froze exactly when a tool fired —
          // get_scheduling_options / policy-answer / take_message — and the
          // tool's HTTP call never reached the backend). Tools are fast; a brief
          // pause beats a frozen call. (Re-add a filler later via a supported
          // mechanism if perceived latency is an issue.) 2026-06-25.
          () => {
            /* no-op — see comment above */
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
          // Incremental durability: persist the transcript-so-far after EVERY
          // turn (fire-and-forget), not only at finalize. So a call that hangs or
          // never sends voice-session-end still shows its conversation in the DB
          // up to the last turn — the record reflects what was actually said,
          // regardless of agent lifecycle. status stays 'active'; finalize/reaper
          // fill duration/outcome later. Best-effort: a failed update just means
          // this turn isn't persisted yet; the next turn (or finalize) catches up.
          const cid = sessionCtx.callId;
          const soFar = transcript.render();
          if (cid && soFar) {
            void client
              .call('/agent-tools/voice-session-transcript', {
                tenant_id: sessionCtx.tenantId,
                call_id: cid,
                transcript: soFar,
              })
              .then((res) => {
                // ToolsClient.call() resolves { ok:false } on 5xx/401/{success:false}
                // (it does NOT throw), so .catch alone would hide a persistent
                // failure (auth/route-missing). Surface it — best-effort, but not
                // silent. Finalize/reaper remain the durability backstops.
                if (!res.ok) {
                  callLog.warn(
                    {
                      event: 'voice_session_transcript_failed',
                      status: res.status ?? null,
                      error_message: res.error,
                    },
                    'incremental transcript save failed (non-fatal; finalize/reaper backstop)'
                  );
                }
              })
              .catch((e: unknown) =>
                callLog.warn(
                  {
                    event: 'voice_session_transcript_failed',
                    error_message: e instanceof Error ? e.message : String(e),
                  },
                  'incremental transcript save threw (non-fatal)'
                )
              );
          }
        });

        // Accumulate per-model usage so the shutdown callback can POST it.
        // SessionUsageUpdated fires after each LLM/STT/TTS turn and carries
        // the running totals — keeping the last snapshot is sufficient.
        session.on(voice.AgentSessionEventTypes.SessionUsageUpdated, (ev) => {
          sessionModelUsage = ev.usage.modelUsage;
        });

        // ── Turn-state instrumentation (5W) ──────────────────────────────
        // Traces EXACTLY where a call stalls — the dead-air / name-loop bug.
        // callLog already carries WHO/WHERE (tenant_id/call_id/caller_phone/room).
        //  - user_input_transcribed: did STT capture the caller's speech at all?
        //    (If a short answer like a name never appears here → STT/turn-detection
        //     dropped it. If it appears but no agent_state→thinking follows →
        //     the LLM turn never started.)
        //  - agent_state_changed: listening→thinking→speaking. Stuck in 'speaking'
        //    = a TTS playout that never completed (agent stops listening) = dead air.
        //  - user_state_changed: caller speaking/listening/away.
        //  - function_tools_executed: which tools the LLM actually invoked — proves
        //    whether find_caller_by_name/identify_caller fired on the name turn.
        //  - error: STT/LLM/TTS/realtime errors surfaced by the session — the most
        //    likely direct cause of a mid-call hang.
        session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (ev) => {
          // Mask digit runs (phone numbers, card numbers) before logging the
          // caller's transcribed speech to centralized logs — keep the words
          // (names/intent, what we need to debug the turn) but not raw PII digits.
          const preview = (ev.transcript ?? '').slice(0, 300).replace(/\d/g, '•');
          callLog.info(
            {
              event: 'user_input_transcribed',
              is_final: ev.isFinal,
              text_len: ev.transcript?.length ?? 0,
              text_preview: preview,
            },
            'caller speech transcribed (STT)'
          );
        });
        session.on(voice.AgentSessionEventTypes.AgentStateChanged, (ev) => {
          callLog.info(
            { event: 'agent_state_changed', from: ev.oldState, to: ev.newState },
            `agent state ${ev.oldState} -> ${ev.newState}`
          );
        });
        session.on(voice.AgentSessionEventTypes.UserStateChanged, (ev) => {
          callLog.info(
            { event: 'user_state_changed', from: ev.oldState, to: ev.newState },
            `caller state ${ev.oldState} -> ${ev.newState}`
          );
        });
        session.on(voice.AgentSessionEventTypes.FunctionToolsExecuted, (ev) => {
          const tools = (ev.functionCalls ?? []).map((c) => c?.name ?? '(unknown)');
          callLog.info(
            { event: 'function_tools_executed', tools },
            `tools executed: ${tools.join(', ')}`
          );
        });
        session.on(voice.AgentSessionEventTypes.Error, (ev) => {
          const e: unknown = ev.error;
          callLog.error(
            {
              event: 'agent_session_error',
              error_message: e instanceof Error ? e.message : String(e),
              error_name: e instanceof Error ? e.name : typeof e,
            },
            'AgentSession error (STT/LLM/TTS/realtime) — a prime suspect for mid-call dead air'
          );
          captureSentry(e instanceof Error ? e : new Error(String(e)), {
            event: 'agent_session_error',
            tenant_id: sessionCtx.tenantId,
            call_id: sessionCtx.callId ?? null,
          });
        });

        // Finalize the call record the instant the caller hangs up. The job
        // often outlives a single call (worker reused for the next one), so the
        // 'close' event — not the job-shutdown backstop — is what normally writes
        // voice-session-end. Fire-once guard dedupes against the shutdown hook.
        session.on(voice.AgentSessionEventTypes.Close, () => {
          void finalizeCall?.('close');
        });

        // 6. Greeting. The owner-editable "First Message" (dashboard AI Persona)
        // is spoken verbatim when set; otherwise a short hardcoded fallback —
        // the LLM warms up from there either way.
        const greeting =
          tenantConfig.firstMessage?.trim() ||
          `Thanks for calling ${tenantConfig.name}. How can I help you today?`;
        // Greeting plays through uninterrupted — a caller's "hi?"/line noise at
        // pickup shouldn't truncate Beth's opening line (which sets the framing
        // for the whole call). Scoped to this one say(); normal turns re-enable.
        void session.say(greeting, {
          allowInterruptions: false,
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
