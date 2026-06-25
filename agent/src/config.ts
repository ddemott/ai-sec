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
  // are no longer required for the worker to boot.

  // Comma-separated tenant IDs whose inbound line is a FORWARDED number (e.g.
  // the owner's cell forwards to the AI), so the SIP caller ID is the
  // forwarding line — NOT the caller. For these tenants the agent ignores
  // caller ID entirely (treats it as absent) and collects the caller's real
  // number verbally. Runtime toggle set on Railway — no schema change, instantly
  // reversible. Empty (default) = trust caller ID as before for every tenant.
  UNTRUSTED_CALLER_ID_TENANTS: z.string().default(''),

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

/**
 * Tenants whose SIP caller ID must NOT be trusted (forwarded inbound lines).
 * Parsed once from UNTRUSTED_CALLER_ID_TENANTS. The agent nulls callerPhone for
 * any tenant in this set so it collects the caller's real number verbally.
 */
export const untrustedCallerIdTenants = new Set(
  config.UNTRUSTED_CALLER_ID_TENANTS.split(',')
    .map((id) => id.trim())
    .filter(Boolean)
);
