/**
 * Collects startup warnings for missing-but-optional environment variables.
 *
 * Pure function so it's trivially testable — index.ts calls it at boot
 * and emits each string via console.warn. Separating the decision from
 * the side-effect means a new contributor who adds a warning can't
 * accidentally forget a test, and the existing ones can't silently rot.
 */
export interface EnvWarningContext {
  env: NodeJS.ProcessEnv;
  /** Resolved values the caller already computed (defaults applied). */
  VAPI_API_KEY: string;
  VAPI_SERVER_URL_SECRET: string;
  XAI_API_KEY: string;
  XAI_TTS_SECRET: string;
  BACKEND_URL: string;
}

export function collectStartupWarnings(ctx: EnvWarningContext): string[] {
  const warnings: string[] = [];
  const { env, VAPI_API_KEY, VAPI_SERVER_URL_SECRET, XAI_API_KEY, XAI_TTS_SECRET, BACKEND_URL } = ctx;

  if (!VAPI_API_KEY) {
    warnings.push('VAPI_API_KEY not set — phone provisioning disabled');
  }
  if (!VAPI_SERVER_URL_SECRET) {
    warnings.push('VAPI_SERVER_URL_SECRET not set — webhook auth disabled');
  }
  if (!env.GOOGLE_CLIENT_ID) {
    warnings.push('GOOGLE_CLIENT_ID not set — Google Calendar sync disabled');
  }
  if (!XAI_API_KEY) {
    warnings.push('XAI_API_KEY not set — Grok TTS proxy disabled');
  }
  if (XAI_API_KEY && !XAI_TTS_SECRET) {
    warnings.push('XAI_TTS_SECRET not set — TTS proxy has no auth');
  }
  if (XAI_API_KEY && !BACKEND_URL) {
    warnings.push('BACKEND_URL not set — Vapi custom-voice cannot reach TTS proxy');
  }
  if (!env.AGENT_SECRET) {
    warnings.push('AGENT_SECRET not set — /agent-tools/* routes will reject all LiveKit worker calls');
  }
  if (!env.TELNYX_API_KEY) {
    warnings.push(
      'TELNYX_API_KEY not set — SMS OTP verification (/agent-tools/send-verification-code) will fail and voice calls with blocked caller-ID cannot complete bookings'
    );
  }

  return warnings;
}
