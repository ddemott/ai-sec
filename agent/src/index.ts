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
import {
  type JobContext,
  WorkerOptions,
  cli,
  defineAgent,
  voice,
} from '@livekit/agents';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as openai from '@livekit/agents-plugin-openai';
import * as silero from '@livekit/agents-plugin-silero';
import { fileURLToPath } from 'node:url';

import { config } from './config.js';
import { runFallback } from './fallback.js';
import { GrokTTS } from './grokTTS.js';
import { buildSessionContext } from './sessionContext.js';
import { ToolsClient } from './toolsClient.js';
import { buildTools } from './tools.js';
import { buildSystemPrompt, formatDateForPrompt } from './prompt.js';

// ── Tenant display/timezone lookup ─────────────────────────────────────
// TODO (Phase 3 polish): fetch tenant name + timezone from the backend on
// connect so the prompt has real values. For the first live test call we
// hard-code DynaTire's values — matches the only tenant we can actually
// SIP-route today.
const DYNATIRE_TENANT_ID = 'f234e471-0e60-4163-86c9-93cfd9338e3a';
const TENANT_DEFAULTS: Record<string, { name: string; timezone: string }> = {
  [DYNATIRE_TENANT_ID]: { name: 'DynaTire', timezone: 'America/Chicago' },
};

export default defineAgent({
  prewarm: async (proc) => {
    proc.userData.vad = await silero.VAD.load();
  },

  entry: async (ctx: JobContext) => {
    await ctx.connect();

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
      await runFallback(ctx, "I'm sorry, we're having a system issue. Please try calling back in a moment.", config);
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
      await runFallback(ctx, "I'm sorry, we're having a system issue.", config);
      return;
    }

    // 3. Build tools with context injected
    const client = new ToolsClient({
      backendUrl: config.BACKEND_URL,
      agentSecret: config.AGENT_SECRET,
    });
    const tools = buildTools(sessionCtx, client);

    // 4. Build prompt with runtime context
    const defaults = TENANT_DEFAULTS[sessionCtx.tenantId] ?? {
      name: 'this business',
      timezone: 'America/Chicago',
    };
    const instructions = buildSystemPrompt({
      tenantName: defaults.name,
      callerPhone: sessionCtx.callerPhone,
      currentDate: formatDateForPrompt(new Date(), defaults.timezone),
      timezone: defaults.timezone,
    });

    // 5. Start the voice session
    const session = new voice.AgentSession({
      vad: ctx.proc.userData.vad as silero.VAD,
      stt: new deepgram.STT({ apiKey: config.DEEPGRAM_API_KEY, model: 'nova-3' }),
      llm: new openai.LLM({ apiKey: config.OPENAI_API_KEY, model: 'gpt-4o-mini' }),
      tts: new GrokTTS({ apiKey: config.XAI_API_KEY, voice: config.XAI_TTS_VOICE }),
    });

    const agent = new voice.Agent({
      instructions,
      tools,
    });

    await session.start({ agent, room: ctx.room });

    // 6. Greeting. Kept short — the LLM will warm up from here.
    session.say(`Thanks for calling ${defaults.name}. How can I help you today?`, {
      allowInterruptions: true,
    });
  },
});

cli.runApp(
  new WorkerOptions({
    agent: fileURLToPath(import.meta.url),
    // Must match the agentName in the LiveKit dispatch rule
    // (SDR_if97ky4Zf7e6 / dynatire-dispatch). If these drift, dispatched
    // jobs won't route to this worker and calls will hit dead air.
    agentName: 'ai-secretary-agent',
  }),
);
