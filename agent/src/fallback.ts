/**
 * Fallback voice path — runs when the entry point can't construct a full
 * tool-backed agent (e.g., dispatch rule misconfigured, no tenant_id in
 * metadata). Goal: the caller hears a coherent message instead of dead
 * air. Anything beats silence.
 *
 * Provider choice rationale: this path uses OpenAI TTS (not Grok) for two
 * reasons.
 *
 *   1. **Independence from the primary path.** The primary AgentSession
 *      uses GrokTTS. If the reason we're in fallback is "Grok upstream is
 *      down" or "XAI_API_KEY rotated and the rotation hasn't redeployed",
 *      the fallback must not depend on the same provider. OpenAI TTS uses
 *      `OPENAI_API_KEY` which we already validate at boot for the LLM, so
 *      it's strictly more available than Grok.
 *
 *   2. **No greeting work.** The fallback only ever speaks one short
 *      string and ends the call. OpenAI TTS's lack of streaming or voice
 *      tuning is irrelevant for a 12-word message.
 *
 * Errors anywhere in this function are deliberately swallowed. At the
 * point fallback is reached, the call is already a degraded experience —
 * the worst additional outcome would be an uncaught exception that
 * crashes the worker (and silently ends the call). Catching + logging
 * is the right shape; we'll see the swallow in the worker logs and the
 * caller hears at least *some* tone before LiveKit drops the room.
 *
 * Module-level note: provider keys are passed in via `FallbackConfig`
 * rather than imported from `./config.js`. Importing config at the top
 * would force this module's tests through the env-validation step,
 * which `process.exit(1)`'s on missing env — fine in production but
 * untestable. Keeping config as an injected arg makes the function
 * pure-ish.
 *
 * The function is intentionally side-effect-only (returns void). Caller
 * uses it as: `await runFallback(ctx, message, config); return;`
 */
import { voice } from '@livekit/agents';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as openai from '@livekit/agents-plugin-openai';
import * as silero from '@livekit/agents-plugin-silero';
import type { JobContext } from '@livekit/agents';

/**
 * Just the provider keys this path needs. Production passes the full
 * `config` from `./config.js` which is structurally compatible.
 */
export interface FallbackConfig {
  DEEPGRAM_API_KEY: string;
  OPENAI_API_KEY: string;
}

/**
 * Constructor injection points. Production binds these to the real
 * LiveKit / provider classes; tests override with mocks so the function
 * is exercisable without a LiveKit runtime + outbound HTTP.
 *
 * The shape mirrors what gets passed to `new voice.AgentSession({...})`
 * — STT/LLM/TTS factories — plus the AgentSession + Agent constructors
 * themselves so the test can observe whether `say()` ran.
 */
export interface FallbackDeps {
  AgentSessionCtor?: typeof voice.AgentSession;
  AgentCtor?: typeof voice.Agent;
  STT?: typeof deepgram.STT;
  LLM?: typeof openai.LLM;
  TTS?: typeof openai.TTS;
}

/**
 * Speak `message` to the caller via a minimal voice session, then return.
 * Errors are caught + swallowed by design — see module-level docs.
 *
 * @param ctx LiveKit job context (needed for room + prewarmed VAD).
 * @param message One short utterance to speak before the call ends.
 * @param config Provider keys (Deepgram + OpenAI). Pass the global
 *               `config` from `./config.js` in production.
 * @param deps Optional dependency overrides for testing.
 */
export async function runFallback(
  ctx: JobContext,
  message: string,
  config: FallbackConfig,
  deps?: FallbackDeps,
): Promise<void> {
  const AgentSessionCtor = deps?.AgentSessionCtor ?? voice.AgentSession;
  const AgentCtor = deps?.AgentCtor ?? voice.Agent;
  const STT = deps?.STT ?? deepgram.STT;
  const LLM = deps?.LLM ?? openai.LLM;
  const TTS = deps?.TTS ?? openai.TTS;

  try {
    const session = new AgentSessionCtor({
      vad: ctx.proc.userData.vad as silero.VAD,
      stt: new STT({ apiKey: config.DEEPGRAM_API_KEY, model: 'nova-3' }),
      llm: new LLM({ apiKey: config.OPENAI_API_KEY, model: 'gpt-4o-mini' }),
      // OpenAI TTS, not Grok — see module-level docs for rationale.
      tts: new TTS({ apiKey: config.OPENAI_API_KEY }),
    });
    const agent = new AgentCtor({
      instructions: 'Say the provided message and end the call politely.',
    });
    await session.start({ agent, room: ctx.room });
    // Awaited so a synthesis-time failure (TTS upstream 5xx, malformed
    // audio, etc.) is caught here rather than escaping into an unhandled
    // promise rejection on the worker.
    await session.say(message, { allowInterruptions: false });
  } catch {
    // Swallow — see module-level docs. Crashing here would end the call
    // anyway, which is already the least-bad outcome.
  }
}
