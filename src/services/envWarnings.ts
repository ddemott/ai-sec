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
  if (!env.GOOGLE_CLIENT_ID) {
    warnings.push('GOOGLE_CLIENT_ID not set — Google Calendar sync disabled');
  }
  if (!env.AGENT_SECRET) {
    warnings.push(
      'AGENT_SECRET not set — /agent-tools/* routes will reject all LiveKit worker calls'
    );
  }

  // Billing: missing webhook secret means checkout works but subscriptions never activate
  if (!env.STRIPE_WEBHOOK_SECRET) {
    warnings.push(
      'STRIPE_WEBHOOK_SECRET not set — all Stripe billing webhooks will return 400 and subscriptions will never activate after checkout'
    );
  }

  // Email: missing creds silently install a mock transporter (no mail sent, no error)
  if (!env.EMAIL_USER || !env.EMAIL_PASS) {
    warnings.push(
      'EMAIL_USER/EMAIL_PASS not set — email notifications disabled (mock transporter active, no mail will be sent)'
    );
  }

  // SMS: provider-specific from-number must be set or sends fail / use wrong sender
  const telephonyProvider = env.TELEPHONY_PROVIDER || 'twilio';
  if (telephonyProvider === 'telnyx' && !env.TELNYX_PHONE_NUMBER) {
    warnings.push(
      "TELNYX_PHONE_NUMBER not set — SMS reminders will fail (Telnyx requires a valid E.164 from number; fallback is 'AI_SECRETARY' which the API rejects)"
    );
  }
  if (telephonyProvider !== 'telnyx' && (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN)) {
    warnings.push(
      'TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN not set — SMS reminders routed to mock adapter (no SMS sent, no error)'
    );
  }

  // CORS: without CORS_ORIGIN the backend defaults to localhost — prod dashboard requests blocked
  if (!env.CORS_ORIGIN) {
    warnings.push(
      'CORS_ORIGIN not set — CORS defaults to localhost only; set it to the dashboard URL or browser requests from prod will be blocked'
    );
  }

  return warnings;
}
