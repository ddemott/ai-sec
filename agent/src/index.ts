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
import { buildGreeting } from './greeting.js';
import { getLogger } from './logger.js';
import { sanitizeStream } from './speechSanitizer.js';
import { summarizeToolCalls } from './redactToolArgs.js';
import { buildSessionContext, callerIdIsForwardNumber } from './sessionContext.js';
import { fetchCustomerContext } from './customerContext.js';
import { fetchTenantConfig } from './tenantConfig.js';
import { ToolsClient } from './toolsClient.js';
import { buildTools } from './tools.js';
import { toolsForPhase, type CallPhase } from './toolPhases.js';
import { warmFillers, getFillerFrame, frameStream } from './session/fillerCache.js';
import { HOLD_LINE, THINKING_LINE, RECOVERY_LINE, HOLD_LINES } from './session/holdLines.js';
import { attachOutputWatchdog } from './session/watchdog.js';
import { attachThinkingSound } from './session/thinkingSound.js';
import { TranscriptRecorder } from './transcript.js';
import { CallOutcomeTracker } from './callOutcome.js';
import { summarizeCall } from './callSummary.js';
import { classifyCallOutcome } from './callClassify.js';
import { createTransferExecutor } from './transferClient.js';
import { buildSystemPrompt, formatDateForPrompt } from './prompt.js';

/**
 * The tenant's saved voice, mapped to its nearest Deepgram Aura equivalent.
 *
 * The dashboard picker stores OpenAI voice ids (shimmer/nova/…), and owners have
 * already chosen one. Switching the TTS engine must not silently reset their voice
 * or make the picker meaningless, so the saved value is honoured — translated, not
 * discarded. Matched on timbre: the two feminine-bright voices go to Asteria/Luna,
 * the neutral ones to Stella/Athena, the masculine ones to Orion/Arcas.
 *
 * Anything unknown (a legacy Grok id, a typo) falls back to Asteria rather than
 * erroring at the API — the same fail-soft contract toOpenAIVoice has always had.
 */
const AURA_BY_OPENAI_VOICE: Record<string, DeepgramVoice> = {
  shimmer: 'aura-asteria-en',
  nova: 'aura-luna-en',
  alloy: 'aura-stella-en',
  echo: 'aura-athena-en',
  onyx: 'aura-orion-en',
  fable: 'aura-arcas-en',
};
type DeepgramVoice =
  | 'aura-asteria-en'
  | 'aura-luna-en'
  | 'aura-stella-en'
  | 'aura-athena-en'
  | 'aura-orion-en'
  | 'aura-arcas-en';

function toAuraVoice(v: string | null | undefined): DeepgramVoice {
  return (v && AURA_BY_OPENAI_VOICE[v]) || 'aura-asteria-en';
}

export default defineAgent({
  prewarm: async (proc) => {
    // WHAT CODE IS THIS WORKER ACTUALLY RUNNING?
    //
    // This used to be a hand-written string: build:'spoken-phone-v3-openai-tts',
    // features:[…,'untrusted_caller_id',…]. UNTRUSTED_CALLER_ID was deleted from this
    // codebase weeks ago. The stamp had been lying ever since, which makes it worse
    // than no stamp: it answers the question confidently and wrongly.
    //
    // It cost a real call. On 2026-07-14 the owner was told the voice fix was live
    // because `simulate.sh --deep` reported "dispatch picked up" — which proves the
    // worker is ALIVE, not that it is NEW. His call ran on the old binary; the worker
    // did not actually restart until five minutes after he hung up. This is the exact
    // stale-binary trap CLAUDE.md warns about, and a hand-maintained version string is
    // no defence against it, because nobody remembers to bump it.
    //
    // Railway injects the deployed commit. Print THAT. A stamp that a human has to
    // remember to update is a stamp that will eventually lie.
    const commit =
      process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 8) ??
      process.env.GIT_COMMIT_SHA?.slice(0, 8) ??
      'unknown';
    getLogger().info(
      {
        event: 'agent_boot',
        commit,
        booted_at: new Date().toISOString(),
        // NOT hardcoded. Realtime mode is speech-to-speech and has NO Deepgram TTS at
        // all — a stamp that says "deepgram-aura" on a Realtime worker is a NEW lying
        // stamp inside the PR that fixes a lying stamp. Report what will actually run.
        tts: process.env.ENABLE_REALTIME === 'true' ? 'openai-realtime (s2s)' : 'deepgram-aura',
      },
      `ai-sec-agent worker booting — commit ${commit}`
    );
    // LET PEOPLE FINISH THEIR SENTENCES.
    //
    // We were running Silero's defaults, and its minSilenceDuration is 550ms. Half a
    // second of silence is not the end of a thought — it is a person RECALLING
    // something. On the 2026-07-14 call Dale said "I was hoping to speak to him about
    // a contract that I possibly have from…", paused to bring the company name to
    // mind, and the agent decided he was done and asked him what the company was. He
    // had to stop it and say "hey, you didn't get the company name."
    //
    // It is worse than an ordinary interruption because BARGE-IN IS OFF by product
    // decision (ALLOW_BARGE_IN, default false): once the agent starts talking the
    // caller cannot talk over it. So an early endpoint is unrecoverable — they must
    // sit and listen to a question they were already answering.
    //
    // 900ms costs ~350ms of extra latency before the agent replies. That is a good
    // trade: a beat of silence reads as "listening"; cutting someone off reads as
    // "not listening", and it is the single rudest thing a receptionist can do.
    // Tunable on a real call without a code change.
    // 1300ms, not 900. And 900 was already up from Silero's 550 default.
    //
    // The thing that keeps breaking is PHONE NUMBERS. Nobody says a phone number as
    // one continuous run of sound — they say it in chunks, with a beat between them:
    // "eight eight eight … six five six … one one eight two". Those beats are a
    // SECOND long, easily. At 900ms the endpointer decided the caller was finished
    // after the area code, and the agent talked over the rest of his own number. He
    // reported it twice: "you never took my phone number", and "doesn't wait for me to
    // say my phone number."
    //
    // A phone number is the single most important string a receptionist collects, and
    // it is the one most likely to contain a pause. Bias the whole call toward
    // patience: 1300ms costs a beat before every reply, and buys us never cutting
    // someone off mid-number. Being a little slow reads as "listening". Talking over
    // someone reads as "not listening", and here it is unrecoverable — barge-in is off,
    // so once the agent starts, the caller must sit and listen to the end.
    const minSilenceMs = Number(process.env.VAD_MIN_SILENCE_MS ?? 1300);
    proc.userData.vad = await silero.VAD.load({
      minSilenceDuration: Number.isFinite(minSilenceMs) ? minSilenceMs : 900,
    });
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

        // DIAGNOSTIC (2026-07-12): log the SIP attribute KEYS the carrier actually
        // sent, plus whether the one we key caller-ID off is among them.
        //
        // Why this exists: on the 2026-07-12 call the caller dialed the number
        // DIRECTLY, yet caller_phone landed NULL — so the agent asked a caller who
        // had a perfectly good caller ID to read out her own number. We could not
        // tell from the data whether (a) Telnyx/LiveKit never sent
        // `sip.phoneNumber`, or (b) one of our own guards nulled it. `sip.callID`
        // DID arrive (the call is in the Calls tab), so the attribute bag was
        // present — which makes (a) a real possibility, not a stretch.
        //
        // Keys only, never values: an attribute bag can carry PII and this line
        // runs on every call. The presence flags are what disambiguate; the values
        // would tell us nothing extra.
        log.info(
          {
            event: 'sip_attributes_received',
            attribute_keys: Object.keys(participantAttributes ?? {}).sort(),
            has_sip_phone_number: Boolean(participantAttributes?.['sip.phoneNumber']),
            has_sip_from: Boolean(participantAttributes?.['sip.from']),
            has_sip_call_id: Boolean(participantAttributes?.['sip.callID']),
          },
          'SIP participant attributes — what the carrier actually sent'
        );
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
    // Resolved the INSTANT the tenant is known, so the greeting can be synthesised
    // while the phone is still ringing. See the warm block below.
    let ttsVoiceKey: DeepgramVoice;
    let greeting: string;
    // Resolves when the GREETING's audio is in the cache. Awaited (with a hard cap)
    // right before we speak, so the opener actually USES the pre-generation instead
    // of racing it and losing. See the warm block and the say() below.
    let greetingWarm: Promise<unknown> = Promise.resolve();
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
            //    first real __PERSONA_NAME__ call). end_voice_session overwrites by
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

      // ── WARM THE VOICE WHILE THE PHONE IS STILL RINGING ──────────────────────
      //
      // Dale's observation, and it is the right one: the work should start when the
      // phone starts ringing, not when we pick it up.
      //
      // This warm used to sit ~700 lines further down, immediately before the
      // greeting's say(). Fire-and-forget, racing a call it could not win: the say()
      // fired microseconds later, the cache was empty, and the greeting synthesised
      // LIVE on every cold worker — an audible pause at pickup, on the very first
      // thing a customer ever hears. The log said so on this branch's first test
      // call: greeting_spoken pregenerated=false "audible pause at pickup".
      //
      // Everything between here and session.start — building the prompt, the tools,
      // the LLM/STT/TTS plugins, starting the session — is time the caller is already
      // spending. The tenant (and therefore the voice, and therefore the greeting) is
      // fully known RIGHT NOW. So spend that window synthesising instead of idling.
      //
      // Still fire-and-forget: a caller must never wait on OUR cache-fill. If the
      // warm loses the race anyway, getFillerFrame returns null and the greeting
      // synthesises live exactly as before — the old behaviour is the floor, not the
      // failure mode.
      ttsVoiceKey = toAuraVoice(tenantConfig.ttsVoice);
      greeting = buildGreeting(tenantConfig);
      {
        const tts = new deepgram.TTS({
          apiKey: config.DEEPGRAM_API_KEY,
          model: ttsVoiceKey,
        }) as unknown as Parameters<typeof warmFillers>[0];

        // THE GREETING GETS ITS OWN PROMISE, and it is warmed FIRST and ALONE.
        //
        // Bundling it with the hold lines made it hostage to them: warmFillers
        // resolves when ALL four clips are done, so the greeting — the one line we
        // need in the next few hundred milliseconds — waited on three lines nobody
        // needs until a tool goes slow. Warm what you are about to say, first.
        greetingWarm = warmFillers(tts, ttsVoiceKey, [greeting]);

        // The hold lines stay fire-and-forget. Nothing waits on them: the earliest
        // they can possibly be needed is 2.5s into a slow tool, several turns away,
        // and if they somehow miss, getFillerFrame returns null and the watchdog
        // synthesises live. They must never delay the opener.
        void greetingWarm
          .then(() => warmFillers(tts, ttsVoiceKey, [...HOLD_LINES]))
          .then(
            ({ warmed, failed }) =>
              callLog.info(
                { event: 'pregen_warmed', warmed: warmed.length, failed: failed.length },
                `pre-generated ${warmed.length} hold line(s); ${failed.length} failed (they fall back to live synthesis)`
              ),
            () => undefined
          );
      }

      // Forwarded-line guard (number match): when the SIP caller-ID equals the
      // tenant's forwarded-from line (the published number the carrier forwards
      // INTO the assistant), the call was forwarded — so the caller-ID is the
      // forwarding line, NOT the customer. Null it so the agent collects the real
      // number verbally instead (identify_caller then saves name + number to the CRM).
      //
      // THIS IS THE ONLY CALLER-ID GUARD (2026-07-13). It replaced a per-TENANT env
      // kill switch (UNTRUSTED_CALLER_ID_TENANTS) that had been a five-day stopgap in
      // June and then outlived its own replacement by three weeks — still set on
      // Railway, still running FIRST, and still nulling the caller ID of EVERY call to
      // the tenant, direct or forwarded, because it keyed off the BUSINESS rather than
      // the CALL. It had no phone number to compare against; a tenant UUID cannot tell
      // you how a call arrived. It therefore starved this guard of a number to check,
      // so this line has never once fired in production.
      //
      // The cost was real: a customer who dialed the number DIRECTLY had her caller ID
      // destroyed, was asked to read out her own phone number, never got a preference
      // prefetch, and was saved to the CRM as "Caller" (2026-07-12). Deleted, config
      // and all, so it cannot shadow this again.
      //
      // Keys off forwarded_from_phone (a dedicated field), so it's independent of
      // forward_phone (the live-transfer target) and the two can be distinct numbers
      // without looping. Known v1 gap: this runs after fetchTenantConfig, so a
      // forwarding number still reaches the child logger + voice-session-start record
      // for that call.
      if (callerIdIsForwardNumber(sessionCtx.callerPhone, tenantConfig.forwardedFromPhone)) {
        callLog.info(
          {
            event: 'caller_id_decision',
            decision: 'DISCARDED_forwarded_line',
            reason:
              'caller-ID equals the tenant forwarded_from_phone — this call came IN through the owner line, so the number we see is the OWNER, not the customer',
            had_caller_id: true,
            forwarded_from_configured: true,
            next: 'agent must collect BOTH name and number verbally, then OTP-verify before revealing any account',
          },
          'CALLER ID: discarded (forwarded line) — will collect number verbally'
        );
        sessionCtx.callerPhone = null;
      } else if (sessionCtx.callerPhone) {
        callLog.info(
          {
            event: 'caller_id_decision',
            decision: 'TRUSTED_carrier_attested',
            reason:
              'the carrier gave us this number and it is NOT the forwarding line — the caller supplied nothing, so there is nothing to prove',
            had_caller_id: true,
            forwarded_from_configured: Boolean(tenantConfig.forwardedFromPhone),
            next: 'agent must NOT ask for the number; it only needs the name. Preferences load without OTP.',
          },
          'CALLER ID: trusted (direct call) — number known, no verification needed'
        );
      } else {
        callLog.info(
          {
            event: 'caller_id_decision',
            decision: 'ABSENT_blocked_or_withheld',
            reason:
              'the carrier sent no caller-ID at all (blocked/withheld), or Telnyx did not populate sip.phoneNumber',
            had_caller_id: false,
            forwarded_from_configured: Boolean(tenantConfig.forwardedFromPhone),
            next: 'agent must collect BOTH name and number verbally, then OTP-verify before revealing any account',
          },
          'CALLER ID: absent — will collect number verbally'
        );
      }

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
      // Realtime is token-constrained — expose only the lean message+meeting
      // capability subset. The SAME array drives BOTH the tool set (buildTools
      // below) AND the system prompt (buildSystemPrompt) so the prompt never
      // advertises a tool that isn't in the ToolContext — a mismatch makes the
      // model call a non-existent tool → error/hallucination → dead air on a
      // voice call (GH issue #113). undefined = all capabilities (pipeline mode).
      // ONE list, driving BOTH the toolset and the prompt (GH #113 — if they drift,
      // the model is told about a tool it cannot call, tries anyway, and the caller
      // gets dead air).
      //
      // 'sms' is absent unless ENABLE_SMS=true, and it is absent TODAY: the number is
      // not 10DLC-registered, so no text this product sends has ever reached a handset.
      // The agent nevertheless closed a real booking with "you'll receive a text
      // confirmation shortly." Removing the capability removes record_sms_consent AND
      // swaps the prompt's texting section for one that says, plainly, that it cannot
      // text. It cannot promise what it has no means to do.
      const ALL_CAPS = [
        'identity',
        'scheduling',
        'messaging',
        'knowledge',
        'verification',
        'transfer',
        'sms',
      ] as const;
      const REALTIME_CAPS = ['identity', 'scheduling', 'messaging', 'sms'] as const;
      const activeCapabilities = (config.ENABLE_REALTIME ? REALTIME_CAPS : ALL_CAPS).filter(
        (c) =>
          (c !== 'sms' || config.ENABLE_SMS) &&
          // OTP is a security control, so it defaults ON and is only removed by an explicit
          // decision — but it works by TEXTING a code, and no text reaches a handset until
          // 10DLC lands. On a forwarded line the agent asks the caller to read back a code
          // that will never arrive, they wait, nothing comes, and the booking dies.
          //
          // Verification gates DISCLOSURE, not CREATION. A booking reveals nothing — the
          // caller supplies every fact in it.
          (c !== 'verification' || config.ENABLE_PHONE_VERIFICATION)
      );

      // 3b. Prefetch the caller's CRM record so the prompt can carry their name,
      //     saved preferences, and recent history into turn one. Runs AFTER both
      //     forwarded-line guards above, so it never keys off a forwarding number.
      //     Bounded (1.5s) and soft-failing: on timeout/5xx/unknown caller it
      //     returns null and the prompt tells the model to call
      //     get_customer_context itself. Adds one round-trip before the greeting —
      //     the deadline is what keeps that from becoming dead air.
      const knownCustomer = await fetchCustomerContext(
        client,
        sessionCtx.tenantId,
        sessionCtx.callerPhone
      );
      callLog.info(
        {
          event: 'customer_context_prefetched',
          known_customer: knownCustomer !== null,
          preference_count: knownCustomer ? Object.keys(knownCustomer.preferences).length : 0,
        },
        knownCustomer
          ? 'returning caller — name/preferences/history baked into the prompt'
          : 'no prefetched context (new caller, blocked ID, or lookup missed the deadline)'
      );

      // 4. Build prompt with runtime context
      const instructions = buildSystemPrompt({
        tenantName: tenantConfig.name,
        callerPhone: sessionCtx.callerPhone,
        currentDate: formatDateForPrompt(new Date(), tenantConfig.timezone),
        timezone: tenantConfig.timezone,
        capabilities: activeCapabilities,
        // 2026-05-18: feed the tenant's customized persona (from
        // tenants.system_prompt, displayed/edited in the dashboard's AI
        // Persona page) into the prompt's identity section. NULL falls
        // back to the hardcoded "You are Clara, ..." line.
        customPrompt: tenantConfig.systemPrompt,
        // 2026-06-30: owner-editable assistant name (dashboard "Assistant
        // Name"). Prepends an authoritative "Your name is X" line that
        // overrides any name in the custom prompt. NULL = no change.
        personaName: tenantConfig.personaName,
        // 2026-06-06: per-tenant customer-preference capture. When enabled, the
        // prompt gains a "Customer preferences" section + save tool guidance.
        savePreferencesEnabled: tenantConfig.savePreferencesEnabled,
        preferencesInstructions: tenantConfig.preferencesInstructions,
        // 2026-07-12: the shop's real opening hours + booking horizon, so the
        // agent LEADS with them ("we're open weekdays one to five — what day
        // works?") instead of asking an open question against a calendar the
        // caller cannot see. NULL = nobody scheduled; the prompt then omits the
        // section and the agent must not claim to be open.
        businessHours: tenantConfig.businessHours,
        bookableThrough: tenantConfig.bookableThrough,
        // 2026-07-12: the caller's prefetched CRM record (name + saved
        // preferences + recent calls). NULL = unknown/blocked caller, or the
        // lookup missed its deadline — the prompt then tells the model to fetch.
        knownCustomer,
        ttsFormal: tenantConfig.ttsFormal,
        ttsWarm: tenantConfig.ttsWarm,
        ttsConcise: tenantConfig.ttsConcise,
        ttsSoft: tenantConfig.ttsSoft,
        ttsCheerful: tenantConfig.ttsCheerful,
      });

      // 5. Start the voice session. Wrapped in try/catch → runFallback: a
      //    throw here (LiveKit session.start, a plugin constructor, an STT/LLM/
      //    TTS upstream that rejects at init) would otherwise propagate out of
      //    `entry`, kill the job, and leave the caller in dead air. The fallback
      //    speaks a short message so the call degrades to "sorry" instead of
      //    silence. (2026-05-21 — closes the gap-1 outer-throw dead-air path.)
      // Realtime + no-barge-in is a CONTRADICTION we cannot honor. OpenAI's
      // speech-to-speech owns barge-in server-side, and LiveKit's plugin rejects
      // allowInterruptions:false on generateReply (it left the session deaf after
      // the greeting the last time it was tried). So under Realtime the caller CAN
      // cut the agent off, including mid-disclosure, no matter what ALLOW_BARGE_IN
      // says. Say so loudly rather than let the operator believe the greeting is
      // protected when it isn't — that belief is exactly what the 2026-07-12 call
      // cost us.
      if (config.ENABLE_REALTIME && !config.ALLOW_BARGE_IN) {
        callLog.warn(
          {
            event: 'barge_in_setting_ignored',
            enable_realtime: true,
            allow_barge_in: false,
          },
          'ENABLE_REALTIME=true IGNORES ALLOW_BARGE_IN=false — the caller CAN interrupt the agent, including the AI disclosure. Turn ENABLE_REALTIME off to get an uninterruptible greeting.'
        );
      }

      try {
        // ttsVoiceKey + greeting were resolved the moment the tenant was known (see
        // the warm block above) — the live TTS, the pre-generation cache and the
        // watchdog all read the SAME value, or the cache misses and the hold line
        // comes out in a different voice from the rest of the call.

        const session = config.ENABLE_REALTIME
          ? new voice.AgentSession({
              // OpenAI Realtime (speech-to-speech) — one model does STT+LLM+TTS
              // over a streamed connection with server-side VAD/turn detection,
              // removing the separate TTS synthesis step whose 2–3s non-streaming
              // latency was the dead air on every reply. Pass it as the llm and
              // omit stt/tts/turnHandling. inputAudioTranscription keeps the
              // caller-side transcript populated for the Calls tab. A/B behind a
              // flag (2026-06-25) — default OFF, set ENABLE_REALTIME on Railway.
              llm: new openai.realtime.RealtimeModel({
                apiKey: config.OPENAI_API_KEY,
                model: config.REALTIME_MODEL,
                voice: config.REALTIME_VOICE,
                inputAudioTranscription: { model: 'whisper-1' },
              }),
            })
          : new voice.AgentSession({
              vad: ctx.proc.userData.vad as silero.VAD,
              stt: new deepgram.STT({ apiKey: config.DEEPGRAM_API_KEY, model: 'nova-3' }),
              // temperature: 0 — PICKING A TOOL IS NOT A CREATIVE ACT.
              //
              // We never passed a temperature, so every call ran at OpenAI's default
              // of 1.0: full sampling randomness, applied to a 23-way tool-selection
              // decision. Then we called the resulting run-to-run variance "flaky" and
              // went looking for the bug in the prompt.
              //
              // The variance WAS the bug. At temperature 1 the model can sample its way
              // into narrating a lookup instead of performing one, or into the wrong one
              // of two similar tools, and it will do it on some calls and not others —
              // which is exactly the signature we spent days chasing. Warmth in this
              // product comes from the persona and the voice, not from the token
              // sampler.
              llm: new openai.LLM({
                apiKey: config.OPENAI_API_KEY,
                model: 'gpt-4o-mini',
                temperature: 0,
              }),
              // TTS IS DEEPGRAM AURA — native WebSocket streaming.
              // This is the "voice isn't smooth" fix, take two.
              //
              // THE HISTORY, because it is the whole lesson:
              //
              //   tts-1              — 2–5s per sentence. Multi-second dead air; callers
              //                        said "hello?" and cancelled the reply.
              //   gpt-4o-mini-tts    — ~1.3s and consistent, but the OpenAI plugin is
              //                        NON-STREAMING: it buffers the ENTIRE reply and
              //                        emits audio only when the whole clip is done. So
              //                        every turn was: silence … silence … [paragraph].
              //                        The owner called it "broken up / not natural".
              //   + StreamAdapter    — my first fix. It splits the reply into SENTENCES
              //                        and synthesises each one separately. Time-to-first-
              //                        word improved — but every sentence became its own
              //                        HTTP round-trip, so I traded one gap at the start
              //                        for a small gap between EVERY sentence. The owner's
              //                        verdict: "a bit choppy still, not as smooth as it
              //                        once was." He was right. I had moved the stutter,
              //                        not removed it.
              //
              // You cannot make a non-streaming engine stream by chopping its input
              // finer. Each chop is another round-trip. The only real fix is an engine
              // that streams audio as it generates it.
              //
              // Deepgram Aura does: a WebSocket connection, audio flowing continuously as
              // the words are produced. No buffering, no per-sentence handshake. We
              // already pay Deepgram for STT, so the key and the vendor relationship
              // already exist — this adds no new dependency, only removes a bad one.
              //
              // The tenant's saved voice is honoured, translated to its nearest Aura
              // timbre (see toAuraVoice) — an engine swap must not silently reset a
              // choice the owner made in the dashboard.
              tts: new deepgram.TTS({
                apiKey: config.DEEPGRAM_API_KEY,
                model: ttsVoiceKey,
                // NO `speed`. Aura's WebSocket REJECTS it — the plugin appends
                // ?speed=… to the upgrade URL and Deepgram answers 400, so the socket
                // never opens, so there is NO TTS AT ALL. That is not a degraded voice;
                // it is a SILENT PHONE LINE. Measured:
                //
                //     WITHOUT speed  -> OPEN
                //     WITH speed=1   -> Unexpected server response: 400
                //
                // The first version of this passed `speed: tenantConfig.ttsSpeed ?? 1.0`, so EVERY
                // call sent speed=1 and every call was silent. The owner rang his own
                // business, said "Hello… Hello…", heard nothing, and hung up.
                //
                // tenants.tts_speed is therefore INERT for Aura. It stays in the schema
                // and the dashboard (it is meaningful again the moment we move to a
                // TTS that honours it) but it is not passed here, and pretending
                // otherwise is what caused the outage.
              }),
              turnHandling: {
                // LET PEOPLE FINISH. THEN LET THEM FINISH AGAIN.
                //
                // "No time to answer questions." — the owner, after the agent asked his
                // name, closed his turn while he was still saying it, and talked over
                // him. He had to start again. Barge-in is OFF, so he could not even cut
                // back in: he had to sit and listen to the interruption.
                //
                // minDelay is how long the silence must last before the turn is declared
                // over, and in VAD mode the effective wait is max(VAD silence, minDelay).
                // Both are raised: a person answering a question pauses to THINK, and a
                // person reading out a phone number pauses between the groups of digits.
                // Those pauses are not the end of a sentence, and treating them as one is
                // how you lose half a phone number.
                //
                // maxDelay caps the wait so a caller who genuinely stops mid-thought is
                // not left hanging forever.
                //
                // The cost is real and accepted: every reply now starts a beat later. A
                // beat of silence reads as LISTENING. Talking over someone reads as not
                // listening — and here it is unrecoverable.
                interruption: {
                  // HALF-DUPLEX BY DEFAULT (product decision 2026-07-12, after a real
                  // call). The caller CANNOT cut the agent off — every utterance plays
                  // to completion.
                  //
                  // Why: barge-in is what makes the conversation script combinatorially
                  // hard. A caller who talks over a half-delivered sentence leaves the
                  // agent reasoning about a state it never finished reaching ("did she
                  // hear the times I offered? did she hear the disclosure?"), so every
                  // reply needs an "interrupted mid-way" branch and there is no end to
                  // them. And the AI-identity disclosure is a COMPLIANCE line: if the
                  // caller talks over it, we legally did not say it. On the 2026-07-12
                  // call the greeting was cut off mid-disclosure ("...I'm an AI") and
                  // the agent then composed a SECOND, different greeting — the caller
                  // heard two openings, neither complete.
                  //
                  // The accepted cost: a caller cannot cut off a long reply. Mitigated
                  // by keeping replies to 1–2 sentences (the prompt mandates it) and
                  // offering ~2 slots at a time, not six.
                  enabled: config.ALLOW_BARGE_IN,
                  // KEEP what she says while the agent is talking. LiveKit's default is
                  // TRUE — it DISCARDS buffered audio whenever the agent is
                  // uninterruptible — which would mean "I changed my mind" spoken over a
                  // reply is silently thrown away and she has to say it twice. Instead we
                  // buffer it and answer it as the next turn: she can't derail a sentence
                  // mid-way, but nothing she says is lost.
                  //
                  // The GREETING is the deliberate exception — see the say() below, which
                  // calls session.clearUserTurn() once the opener finishes. Nothing said
                  // over a fixed script is actionable, and keeping it is what turned her
                  // "Bye." into a phantom turn that produced the second greeting.
                  discardAudioIfUninterruptible: false,

                  // Everything below governs barge-in only when ALLOW_BARGE_IN=true
                  // restores it; it is inert in the default half-duplex mode. Kept
                  // because the tuning was hard-won and we want it back verbatim if the
                  // no-interruption experiment is reversed.
                  //
                  // 'adaptive' = LiveKit's CNN barge-in model: it decides whether to
                  // yield the turn from the ACOUSTICS of the overlapping speech, not
                  // from a raw VAD/duration threshold — so a brief "hello?"/backchannel
                  // during the TTS gap no longer cancels the in-flight reply.
                  mode: 'adaptive',
                  // minWords is the EFFECTIVE lever when STT is on: a verified LiveKit
                  // maintainer note says STT-detected speech bypasses minDuration, so
                  // raising duration alone does nothing — require ≥2 words to interrupt.
                  minWords: 2,
                  // If speech is detected but NO transcript follows within 2s (a false
                  // trigger — line noise, a cough, a half-word), resume speaking from
                  // where __PERSONA_NAME__ left off instead of staying silent. Direct guard against
                  // a phantom "interruption" killing the reply → dead air.
                  falseInterruptionTimeout: 2000,
                  resumeFalseInterruption: true,
                },
                // Endpointing = how long of a pause ends the caller's turn. Default
                // minDelay 500ms ends the turn on the brief pause BETWEEN spoken
                // fragments — so a phone number ("312 865" … "1186") or a multi-part
                // answer ("it's W2" … "in Chicago" … "$65/hr") arrives as several
                // turns, each starting a generation the next fragment then discards →
                // __PERSONA_NAME__ never finishes a reply → freeze. Wait ~1.3s of silence so a
                // multi-part answer AGGREGATES into one turn → one reply. maxDelay
                // caps the wait so a truly-finished caller isn't left hanging.
                //
                // RAISED 1300 -> 1500 / 4000 -> 6000 on 2026-07-14. "No time to answer
                // questions." The agent asked the owner his name, closed his turn while
                // he was still saying it, and talked over him — and barge-in is OFF, so
                // he could not cut back in. He had to sit through the interruption and
                // start again.
                //
                // A person answering a question pauses to THINK, and a person reading out
                // a phone number pauses between the groups of digits. Those pauses are not
                // the end of a sentence. Treating them as one is how you lose half a phone
                // number — which is exactly what happened, twice.
                //
                // The cost is accepted: every reply starts a beat later. A beat of silence
                // reads as LISTENING; talking over someone reads as not listening, and
                // here it cannot be undone. Tunable on a real call without a deploy.
                endpointing: {
                  minDelay: Number(process.env.ENDPOINTING_MIN_DELAY_MS ?? 1500),
                  maxDelay: Number(process.env.ENDPOINTING_MAX_DELAY_MS ?? 6000),
                },
              },
            });

        // Tools are built after the session exists. speakFiller is now a no-op
        // (it used to call session.say() from inside execute(), which stalled the
        // generation — see the no-op comment below), so it no longer depends on
        // session being initialized; the ordering is harmless either way.
        // THE MODEL SEES ONE PHASE OF THE CALL AT A TIME (toolPhases.ts).
        //
        // Handing gpt-4o-mini all 23 tools on every turn is over every published
        // ceiling (OpenAI: "<20 at the start of a turn"; LiveKit: 5-12), and our own
        // eval shows what it costs — asked to take a message, the model called NO
        // tool at all and told the caller "I've sent the owner a message". Prompt
        // rules did not fix that. Neither did temperature 0. A model cannot pick the
        // wrong tool from a set that does not contain it, and it picks the right one
        // far more often from six candidates than from twenty-three.
        //
        // The agent starts in 'intake' and moves when the model calls a router
        // (start_booking / manage_appointment). The routers are the ONLY door out:
        // the scheduling tools are not visible during intake, so the model cannot
        // TALK its way to get_available_slots — the cheapest path to what the caller
        // asked for now runs THROUGH a tool call instead of around it.
        //
        // Late-bound on purpose: the tools must exist before the Agent, and the
        // Agent must exist before a tool can swap its toolset. `phaseAgent` closes
        // that loop. A router that fires before the Agent exists (impossible today —
        // the model cannot call a tool before session.start) is a no-op, not a crash.
        let phaseAgent: voice.Agent | null = null;
        let phase: CallPhase = 'intake';
        const applyPhase = async (next: CallPhase): Promise<void> => {
          phase = next;
          if (!phaseAgent) return;
          const scoped = toolsForPhase(allTools, next);
          await phaseAgent.updateTools(scoped);
          callLog.info(
            {
              event: 'tool_phase_changed',
              phase: next,
              tool_count: Object.keys(scoped).length,
              tools: Object.keys(scoped),
            },
            `tool phase → ${next} (${Object.keys(scoped).length} tools visible)`
          );
        };

        const allTools = buildTools(
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
          },
          // Realtime is rate-limited on tokens/min (Tier-1 = 40k TPM); audio +
          // a growing context burn fast. For the lean "message + meeting" flow we
          // expose ONLY the tools that flow needs — identity (who's calling),
          // scheduling (book a meeting), messaging (take a message) — dropping
          // knowledge/RAG, transfer, and OTP to shrink the per-turn schema tokens.
          // `activeCapabilities` (computed once above) drives this AND the system
          // prompt, so the two can never drift (GH issue #113). Pipeline = all tools.
          //
          // Capabilities and phases compose, and the order matters: capabilities are
          // authoritative and decide what this SESSION has at all; phases only ever
          // narrow that further, per turn. A phase can never hand back a tool a
          // capability withheld — toolsForPhase intersects, it does not union. So
          // ENABLE_PHONE_VERIFICATION=false still means no OTP tool exists, in any
          // phase, no matter what toolPhases.ts lists.
          {
            ...(activeCapabilities ? { capabilities: activeCapabilities } : {}),
            onPhaseChange: applyPhase,
          }
        );

        // MARKDOWN MUST NEVER REACH THE VOICE.
        //
        // On the 2026-07-13 call the model emitted, inside one turn:
        //
        //   "Let me check ... Just a moment.   *One moment while I look that up...*"
        //
        // The asterisks are literal characters handed to TTS, and gpt-4o-mini-tts
        // does not quietly ignore them — they distort prosody and insert pauses.
        // The owner's report was "voice was broken up, did not sound natural", and
        // that is what he was hearing.
        //
        // The prompt has forbidden markdown the entire time ("no markdown, no
        // bullet points, no formatting"). The model did it anyway. A prompt is a
        // REQUEST; ttsNode is where we can make it a GUARANTEE. Overriding it means
        // no future prompt regression, and no new model's habits, can put
        // punctuation into a customer's ear.
        class SpeakingAgent extends voice.Agent {
          override async ttsNode(
            text: ReadableStream<string>,
            modelSettings: Parameters<typeof voice.Agent.default.ttsNode>[2]
          ): ReturnType<typeof voice.Agent.default.ttsNode> {
            return voice.Agent.default.ttsNode(this, sanitizeStream(text), modelSettings);
          }
        }

        // Open in INTAKE: identity, the catalog, the policy answerer, every way to
        // reach a human — and the two routers. Not the calendar. The model cannot
        // offer, refuse, or invent a time before it has called a tool that returns
        // one, because the tools that return times are not in the room yet.
        const intakeTools = toolsForPhase(allTools, 'intake');
        const agent = new SpeakingAgent({
          instructions,
          tools: intakeTools,
        });
        phaseAgent = agent;

        await session.start({ agent, room: ctx.room });
        callLog.info(
          {
            event: 'session_started',
            phase,
            tool_count: Object.keys(intakeTools).length,
            // The count the model actually sees. If this creeps back toward 23,
            // the narrowing has silently regressed and the hallucinations return.
            tool_count_all: Object.keys(allTools).length,
          },
          'voice session started — agent ready to greet'
        );

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
          // Log ARGS too (PII-redacted), not just names — a 2026-07-01 live
          // incident was undiagnosable because nothing showed what time
          // string the LLM sent. is_error pairs each call with its output.
          const toolCalls = summarizeToolCalls(
            ev.functionCalls ?? [],
            ev.functionCallOutputs ?? []
          );
          callLog.info(
            { event: 'function_tools_executed', tools, tool_calls: toolCalls },
            `tools executed: ${tools.join(', ')}`
          );
        });
        session.on(voice.AgentSessionEventTypes.Error, (ev) => {
          const e: unknown = ev.error;
          // Surface the provider error body too — a RealtimeModel APIError carries
          // a `body` with the precise cause (e.g. token/context-limit details);
          // without it the message is just "...error type: tokens" with no numbers.
          let errorBody: string | undefined;
          try {
            const b = (e as { body?: unknown }).body;
            if (b != null) errorBody = JSON.stringify(b).slice(0, 1000);
          } catch {
            /* body not serializable — skip */
          }
          callLog.error(
            {
              event: 'agent_session_error',
              error_message: e instanceof Error ? e.message : String(e),
              error_name: e instanceof Error ? e.name : typeof e,
              error_body: errorBody,
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

        // Output watchdog (never-silent backstop) — OFF unless ENABLE_OUTPUT_WATCHDOG.
        // Pre-synthesize the fixed hold lines once (per voice, async — never blocks
        // the call; until warm, the watchdog falls back to live TTS), then attach
        // the session-level deadline timer.
        if (config.ENABLE_OUTPUT_WATCHDOG) {
          // Same voice AND same cache key as the main pre-generation above, or the
          // watchdog would synthesise its own copies under a different key — paying
          // twice for identical audio, and (worse) speaking the hold line in a
          // DIFFERENT VOICE from the rest of the call. Both lines are already in
          // PREGEN_LINES; this warm is now a no-op cache hit in the normal case.
          const watchdogVoice = ttsVoiceKey;
          // ONE definition (session/holdLines.ts). These used to be string literals
          // here AND in PREGEN_LINES below — and the filler cache is keyed BY THE
          // TEXT, so a one-character drift between the two copies would silently
          // miss the cache and put live TTS latency back on the line whose only job
          // is to cover latency. Nothing would error. It would just get slow again.
          const fillerText = HOLD_LINE;
          const thinkingText = THINKING_LINE;
          const recoveryText = RECOVERY_LINE;
          const fillerTts = new deepgram.TTS({
            apiKey: config.DEEPGRAM_API_KEY,
            model: ttsVoiceKey,
          }) as unknown as Parameters<typeof warmFillers>[0];
          void warmFillers(fillerTts, watchdogVoice, [fillerText, recoveryText]).then(
            ({ failed }) => {
              if (failed.length > 0) {
                callLog.warn(
                  { event: 'watchdog_filler_warm_failed', failed_count: failed.length },
                  'watchdog filler pre-synthesis failed — will fall back to live TTS on the hold line'
                );
              }
            },
            () => undefined
          );
          const detachWatchdog = attachOutputWatchdog(session, {
            voice: watchdogVoice,
            thinkingText,
            // 3.5s, not 2.5s. At 2.5s it fired SEVEN TIMES in one call — the pipeline
            // (STT → gpt-4o-mini → TTS) routinely takes longer than that to produce a
            // first word, so the "backstop" became the normal case and the caller was
            // held on nearly every turn. A backstop that fires every turn is not a
            // backstop, it is a stutter. Tunable without a deploy.
            // 2800ms. It was 2500 (fired 7x in one call, and LIED each time — "let me
            // check that for you" when nothing was being checked), then 3500 to shut it
            // up, which traded the lying for LONG SILENCES the caller filled with
            // "Hello?".
            //
            // The line is HONEST now — "Just a moment." when no tool is running — so
            // firing is cheap again, and the right move is to cover the gap sooner
            // rather than leave a caller wondering if the line dropped. The real cure
            // is the agent being faster; this is the dressing on the wound.
            deadline1Ms: Number(process.env.WATCHDOG_DEADLINE_1_MS ?? 2800),
            fillerText,
            recoveryText,
            log: callLog,
          });
          session.on(voice.AgentSessionEventTypes.Close, detachWatchdog);
        }

        // Thinking-sound bed (never-silent polish) — OFF unless ENABLE_THINKING_SOUND.
        // A looping keyboard-typing ambiance plays while the agent is 'thinking'
        // and stops on 'speaking' (LiveKit BackgroundAudioPlayer owns the track,
        // loop, mix, and agent_state wiring). ctx.room is connected (ctx.connect
        // above) and the session is started, so the bed's track can publish.
        if (config.ENABLE_THINKING_SOUND) {
          const detachThinkingSound = attachThinkingSound(session, ctx.room, {
            volume: config.THINKING_SOUND_VOLUME,
            log: callLog,
          });
          session.on(voice.AgentSessionEventTypes.Close, detachThinkingSound);
        }

        // 6. Greeting = tenant opener + fixed disclosure + fixed closer.
        // The owner's "First Message" is the OPENER only; it is no longer spoken
        // verbatim as the whole greeting. The AI-identity + transcription
        // disclosure is appended by the platform on every call for every tenant
        // and cannot be edited or removed from the dashboard. See greeting.ts for
        // the wording rules and why each clause is worded the way it is.
        //
        // `greeting` and `ttsVoiceKey` were resolved — and their audio warmed — the
        // moment the tenant was known, while the phone was still ringing. By the time
        // we get here the frame is usually already in the cache, so the opener plays
        // instantly instead of synthesising live at pickup.
        // Greeting. Pipeline mode plays it via say() uninterrupted (a caller's
        // "hi?"/line noise at pickup shouldn't truncate the opening line); Realtime
        // mode speaks it via generateReply with server-side turn-taking (it rejects
        // allowInterruptions:false — see the Realtime branch below).
        // Fire-and-forget (don't block entry on full playout), but guard the
        // rejection: a say()/TTS failure here is OUTSIDE the enclosing try/catch,
        // so unguarded it becomes an unhandled promise rejection that can
        // destabilize the worker. SpeechHandle is a thenable WITHOUT a .catch
        // method, so wrap in an async IIFE + try/catch (await uses .then). Log
        // and continue; the session lives on.
        void (async () => {
          try {
            if (config.ENABLE_REALTIME) {
              // Realtime is speech-to-speech with NO TTS plugin, so say(text)
              // throws "trying to generate speech from text without a TTS model".
              // Have the model SPEAK the opener via generateReply instead.
              // NOTE: no allowInterruptions here — RealtimeModel uses server-side
              // turn detection and rejects allowInterruptions:false on
              // generateReply ("...cannot be false..."), which left the session
              // not listening after the greeting → the caller's next turn was
              // dropped → silence. Let server VAD own turn-taking.
              await session.generateReply({
                // Greeting on its own lines (not quote-wrapped) so a tenant
                // greeting containing a " or newline can't make the instruction
                // ambiguous.
                instructions: `Greet the caller now by speaking this exact opening line verbatim, then wait for their reply:\n\n${greeting}`,
              });
            } else {
              // Uninterruptible: the opener carries the AI-identity + transcription
              // disclosure, which is a COMPLIANCE line. If the caller talks over it,
              // we legally did not say it. allowInterruptions:false here is belt-and-
              // braces on top of the session-level interruption.enabled:false — this
              // one utterance must survive even if barge-in is ever re-enabled.
              // PRE-GENERATED GREETING — zero TTS latency on pickup.
              //
              // The greeting is the ONE line that is fully deterministic: it is built
              // from the tenant's own config and is byte-identical on every call this
              // worker ever answers. Synthesising it live meant every caller heard a
              // beat of silence at pickup — the worst possible place for it, because a
              // caller who has just been connected and hears nothing assumes the line is
              // dead. It is also the longest single utterance of the call.
              //
              // So we synthesise it ONCE and replay the frame. session.say(text, {audio})
              // skips synthesis entirely. The machinery already existed (fillerCache, built
              // for the watchdog's hold lines) and was simply never pointed at the one
              // utterance that needed it most.
              //
              // Warming is best-effort and off the hot path: if it hasn't landed yet (first
              // call after a deploy) or the synth failed, `frame` is undefined and say()
              // falls back to live synthesis — slower, but never silent. A cache miss must
              // degrade to the old behaviour, never to dead air.
              // WAIT FOR THE VOICE TO BE READY — but never longer than it would have
              // taken to just synthesise it live.
              //
              // Starting the warm early was not enough. Fire-and-forget means the
              // say() fires microseconds later and reads an EMPTY cache, so the
              // pre-generation lost its own race on every cold worker and the greeting
              // synthesised live anyway — measured, twice, on this branch:
              // `greeting_spoken pregenerated=false`. Work started but not awaited is
              // work wasted.
              //
              // So await it, with a hard cap. The cap is what makes this safe: if the
              // synth is slow or Deepgram is having a bad day, we stop waiting and
              // stream live exactly as before. Worst case is TODAY'S behaviour; best
              // case the opener plays instantly from a frame. There is no case where a
              // caller waits longer than they already do.
              //
              // On a real PSTN call this is nearly free — the phone is RINGING through
              // ctx.connect() and waitForParticipant(), and the warm started back when
              // the tenant resolved. By here it is usually already done.
              const GREETING_WARM_CAP_MS = 1500;
              await Promise.race([
                greetingWarm.catch(() => undefined),
                new Promise((r) => setTimeout(r, GREETING_WARM_CAP_MS)),
              ]);

              const greetingFrame = getFillerFrame(ttsVoiceKey, greeting);
              const opener = greetingFrame
                ? session.say(greeting, {
                    allowInterruptions: false,
                    audio: frameStream(greetingFrame),
                  })
                : session.say(greeting, { allowInterruptions: false });
              callLog.info(
                {
                  event: 'greeting_spoken',
                  pregenerated: Boolean(greetingFrame),
                  chars: greeting.length,
                },
                greetingFrame
                  ? 'greeting played from cache — no TTS latency'
                  : 'greeting synthesised live (warm missed the cap) — audible pause at pickup'
              );
              await opener.waitForPlayout();

              // Drop whatever the caller said OVER the greeting.
              //
              // The session keeps buffered audio by default (discardAudioIfUninterruptible
              // = false, above) so nothing a caller says mid-reply is ever lost. The
              // greeting is the ONE place we don't want that: it is a fixed script where
              // nothing the caller says is actionable, and keeping it is exactly what
              // broke the 2026-07-12 call — she made a noise over the opener, it landed
              // as a turn ("Bye."), and the model answered it by composing a SECOND,
              // different greeting. The caller heard two openings, neither complete.
              //
              // After this line, everything she says is buffered and answered in order.
              session.clearUserTurn();
            }
          } catch (e) {
            callLog.error(
              {
                event: 'greeting_say_failed',
                error_message: e instanceof Error ? e.message : String(e),
              },
              'greeting failed — caller may not hear the opening line; session continues'
            );
          }
        })();
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
    //
    // OVERRIDABLE so a BRANCH can be heard without racing production.
    //
    // LiveKit load-balances a dispatch across every worker registered under the
    // same agentName. So running a local worker on a feature branch — the only way
    // to actually LISTEN to a change before merging it — silently entered it into a
    // coin-flip with the Railway worker running main. Whichever won the job is the
    // code you heard, and nothing in the output told you which.
    //
    // That is not hypothetical. On 2026-07-14 the owner was told a fix was live
    // because a dispatch "picked up"; it had landed on the OLD binary, and the
    // worker did not actually restart until five minutes after he hung up. A test
    // whose result you cannot attribute to a specific commit is not a test.
    //
    // Set AGENT_NAME=ai-secretary-agent-dev on both the worker and the dispatcher
    // (scripts/sim-call.mjs reads the same var) and the job can ONLY land on yours.
    agentName: process.env.AGENT_NAME ?? 'ai-secretary-agent',
  })
);
