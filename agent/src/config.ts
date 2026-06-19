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
  XAI_API_KEY: z.string().min(1),
  // ara = warm & friendly (recommended default for AI secretary)
  XAI_TTS_VOICE: z.enum(['eve', 'ara', 'rex', 'sal', 'leo']).default('ara'),
  // Speech pace multiplier (xAI /v1/tts `speed`, range 0.7–1.5). <1 = slower,
  // calmer delivery. Default 0.85 = unhurried "caring friend" pace; tune by ear.
  XAI_TTS_SPEED: z.coerce.number().min(0.7).max(1.5).default(0.85),
  // When true, the synthesized text is wrapped in xAI's <soft> prosody tag for a
  // softer, soothing delivery. Env arrives as a string; transform to boolean.
  XAI_TTS_SOFT: z
    .enum(['true', 'false'])
    .default('true')
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
