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
  TELNYX_API_KEY: string;
  TELNYX_SIP_CONNECTION_ID: string;
}

export function collectStartupWarnings(ctx: EnvWarningContext): string[] {
  const warnings: string[] = [];
  const { env, TELNYX_API_KEY, TELNYX_SIP_CONNECTION_ID } = ctx;

  if (!TELNYX_API_KEY) {
    warnings.push(
      'TELNYX_API_KEY not set — phone provisioning and SMS OTP disabled (voice calls with blocked caller-ID cannot complete bookings)'
    );
  }
  if (TELNYX_API_KEY && !TELNYX_SIP_CONNECTION_ID) {
    warnings.push(
      'TELNYX_SIP_CONNECTION_ID not set — phone provisioning will return 503 (purchased numbers cannot be routed to LiveKit)'
    );
  }
  if (TELNYX_API_KEY && !env.TELNYX_PHONE_NUMBER) {
    warnings.push(
      'TELNYX_PHONE_NUMBER not set — reminder and notification SMS will be sent without a valid from number (messages will fail or be undeliverable)'
    );
  }
  if (!env.EMAIL_USER || !env.EMAIL_PASS) {
    warnings.push(
      'EMAIL_USER / EMAIL_PASS not set — email notifications are running in mock mode and will never deliver'
    );
  }
  if (!env.GOOGLE_CLIENT_ID) {
    warnings.push('GOOGLE_CLIENT_ID not set — Google Calendar sync disabled');
  }
  if (!env.AGENT_SECRET) {
    warnings.push(
      'AGENT_SECRET not set — /agent-tools/* routes will reject all LiveKit worker calls'
    );
  }

  return warnings;
}
