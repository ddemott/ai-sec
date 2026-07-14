import * as dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: resolve(here, '../../.env') });
dotenv.config({ path: resolve(here, '../.env'), override: true });

const envSchema = z.object({
  LIVEKIT_URL: z.string().startsWith('wss://'),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),

  AGENT_SECRET: z.string().min(32),
  BACKEND_URL: z.string().url(),

  OPENAI_API_KEY: z.string().min(1),
  DEEPGRAM_API_KEY: z.string().min(1),
  // TTS is OpenAI. Voice + speed are per-tenant (dashboard → tenants.tts_voice/
  // tts_speed), not env. The old xAI/Grok TTS vars (XAI_API_KEY, XAI_TTS_VOICE/
  // SPEED/SOFT) were removed 2026-06-25 when the agent went fully OpenAI — they
  // are no longer required for the worker to boot (no XAI_API_KEY needed).

  // Output watchdog (the "never silent" backstop): when "true", a session-level
  // timer plays a cached holding phrase if no agent audio is produced within the
  // deadline after the caller's turn, then a recovery line. OFF by default — its
  // acoustic behavior can't be CI-verified, so it ships inert and is enabled on
  // Railway after a real-call validation. Instantly reversible.
  ENABLE_OUTPUT_WATCHDOG: z
    .string()
    .optional()
    .transform((v) => v === 'true'),

  // Thinking-sound bed: when "true", a looping keyboard-typing ambiance plays
  // while the agent is in the 'thinking' state and stops the instant it starts
  // speaking — covers the pipeline TTS gap / slow tool with a "receptionist is
  // typing" feel instead of dead air. Uses LiveKit's BackgroundAudioPlayer + the
  // bundled KEYBOARD_TYPING clip. OFF by default — acoustic + PSTN-mix behavior
  // can't be CI-verified; enable on Railway after a real-call check, instantly
  // reversible. NOTE: in pipeline mode the agent sits in 'thinking' ~2-3s every
  // reply, so the bed plays before essentially every turn (intended — ambient,
  // unlike a spoken filler that would read as broken). It MASKS dead air; it does
  // NOT fix a slow/failed turn (raise TPM / fix the tool for that — playbook §2.4).
  ENABLE_THINKING_SOUND: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  // Volume (0-1) of the thinking-sound bed. Env knob so it can be dialed in on a
  // real call with no code change (env edits auto-redeploy). Blank/invalid → 0.5.
  THINKING_SOUND_VOLUME: z
    .string()
    .optional()
    .transform((v) => {
      const n = v?.trim() ? Number(v.trim()) : NaN;
      return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.5;
    }),

  /**
   * Phone verification (the OTP flow). ON by default.
   *
   * Set ENABLE_PHONE_VERIFICATION=false to drop send_verification_code /
   * verify_phone_code from the toolset entirely. Because the system prompt is
   * capability-gated on the same value, the model is not merely discouraged from
   * running an OTP — it is never told the tools exist, so it cannot try.
   *
   * WHY THIS EXISTS (2026-07-14): the tenant's Telnyx number is not 10DLC-registered,
   * so US carriers silently DROP every A2P message. Telnyx accepts the send and
   * reports success; the carrier throws it away. No code has ever reached a handset.
   *
   * The agent therefore asked callers to read back a code that was never coming,
   * waited, apologised, and fell back to taking a message — killing the booking. And
   * that is the actual bug, independent of 10DLC: VERIFICATION GATES DISCLOSURE, NOT
   * CREATION. Proving you hold a number is required before we read a stranger's name
   * and history out loud. It has never been required to CREATE a booking, because a
   * booking reveals nothing — the caller supplies every fact in it.
   *
   * So an undeliverable text was blocking an appointment it had no business blocking.
   * This switch removes the OTP from the flow while 10DLC registration is pending, and
   * the disclosure gate keeps working exactly as before: a spoken number simply never
   * unlocks a returning customer's account. It reveals nothing; it just no longer
   * stops them booking.
   */
  ENABLE_PHONE_VERIFICATION: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
  // OpenAI Realtime (speech-to-speech) mode: when "true", the agent uses
  // openai.realtime.RealtimeModel as the llm instead of the STT→LLM→TTS pipeline,
  // removing the TTS synthesis step (measured 2–3s/reply, non-streaming = dead
  // air). OFF by default — A/B test on Railway, instantly reversible. MODEL/VOICE
  // are the realtime model id + voice (realtime has its own voice set).
  ENABLE_REALTIME: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  // Coerce unset/blank/whitespace → the default (a blank env var in a deploy UI
  // would otherwise bypass .default() and break RealtimeModel init).
  REALTIME_MODEL: z
    .string()
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : 'gpt-realtime')),
  REALTIME_VOICE: z
    .string()
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : 'shimmer')),

  // Barge-in. When false (the DEFAULT), the caller CANNOT cut the agent off:
  // every agent utterance plays to completion. Their speech is not lost — STT
  // still transcribes it and it becomes the next turn once the agent finishes.
  //
  // WHY off by default (product decision 2026-07-12, after a real call):
  // barge-in is what makes the conversation script combinatorially hard. A caller
  // who talks over the agent cancels a half-delivered sentence, and the agent must
  // then reason about a state it never finished reaching — "did she hear the times
  // I offered? did she hear the disclosure?" — so every reply needs a branch for
  // "interrupted mid-way" and there is no end to them. Worse, the AI-identity
  // disclosure is a COMPLIANCE line: if a caller talks over it, we legally did not
  // say it. On the 2026-07-12 call the greeting was cut off mid-disclosure
  // ("...I'm an AI") and the agent then composed a SECOND, different greeting.
  //
  // The cost is real and accepted: a caller cannot cut off a long reply. Mitigated
  // by keeping replies short (the prompt already mandates 1–2 sentences) and by
  // offering ~2 slots at a time, not six.
  //
  // Set ALLOW_BARGE_IN=true to restore interruptions (they are then governed by
  // turnHandling.interruption: adaptive mode, minWords 2, false-interruption
  // resume — see index.ts).
  //
  // NOT HONORED IN REALTIME MODE: OpenAI's speech-to-speech owns barge-in
  // server-side and LiveKit's plugin rejects allowInterruptions:false. Realtime +
  // ALLOW_BARGE_IN=false is a contradiction; index.ts logs a warning.
  ALLOW_BARGE_IN: z
    .string()
    .optional()
    .transform((v) => v === 'true'),

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Agent config validation failed:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
