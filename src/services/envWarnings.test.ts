/**
 * Tests for the startup-warning collector. Pure-function tests — no server
 * boot, no env mutation leaks between tests.
 *
 * These tests guard every environment-variable warning currently in
 * effect. When someone adds a new warning they'll also want to pin it
 * here so drift is impossible. 5W comments throughout.
 */
import { describe, it, expect } from 'vitest';
import { collectStartupWarnings } from './envWarnings';

/** Build a ctx with all vars set to "present" by default. */
function baseCtx(
  overrides: {
    env?: Record<string, string | undefined>;
    TELNYX_API_KEY?: string;
    TELNYX_SIP_CONNECTION_ID?: string;
  } = {}
) {
  return {
    env: {
      GOOGLE_CLIENT_ID: 'google-client-id',
      AGENT_SECRET: 'a'.repeat(40),
      STRIPE_WEBHOOK_SECRET: 'whsec_fake',
      EMAIL_USER: 'bot@example.com',
      EMAIL_PASS: 'app-password',
      TELEPHONY_PROVIDER: 'telnyx',
      TELNYX_PHONE_NUMBER: '+16308229086',
      CORS_ORIGIN: 'https://dashboard-production-cee3.up.railway.app',
      ...(overrides.env ?? {}),
    } as NodeJS.ProcessEnv,
    TELNYX_API_KEY: overrides.TELNYX_API_KEY ?? 'KEY01fake',
    TELNYX_SIP_CONNECTION_ID: overrides.TELNYX_SIP_CONNECTION_ID ?? '12345',
  };
}

describe('collectStartupWarnings — all present', () => {
  it('HAPPY: nothing is missing → no warnings returned', () => {
    // WHO: Fully configured production environment
    // WHAT: The function returns an empty array so startup emits no
    //        noise — the signal-to-noise ratio of WARNINGs matters
    // WHY: If the baseline case ever starts warning, someone added a
    //        check but didn't wire it into their default test ctx
    expect(collectStartupWarnings(baseCtx())).toEqual([]);
  });
});

describe('collectStartupWarnings — TELNYX_API_KEY', () => {
  it('SAD: missing TELNYX_API_KEY → warning mentions provisioning + OTP', () => {
    // WHO: Operator who hasn't configured the Telnyx API key
    // WHAT: Telnyx is responsible for both phone provisioning and SMS OTP, so the
    //        warning needs to mention both consequences so the operator understands
    //        the blast radius without consulting docs
    // WHY: Silent config failures are the slowest bugs to diagnose. The warning text
    //        is the test.
    const warnings = collectStartupWarnings(baseCtx({ TELNYX_API_KEY: '' }));
    const w = warnings.find((x) => x.includes('TELNYX_API_KEY'));
    expect(w).toBeDefined();
    expect(w).toContain('phone provisioning');
    expect(w).toContain('OTP');
  });

  it('SAD: TELNYX_API_KEY set but TELNYX_SIP_CONNECTION_ID missing → routing warning fires', () => {
    // WHO: Operator who has the API key but hasn't pasted the SIP Connection ID yet
    // WHAT: Provisioning will return 503 because purchased numbers can't be routed
    // WHY: This is the exact half-configured state we ship into when keys are added piecemeal —
    //        the warning is the only signal between "boot succeeded" and a 503 at first activation
    const warnings = collectStartupWarnings(baseCtx({ TELNYX_SIP_CONNECTION_ID: '' }));
    const w = warnings.find((x) => x.includes('TELNYX_SIP_CONNECTION_ID'));
    expect(w).toBeDefined();
    expect(w).toContain('503');
  });

  it('HAPPY: TELNYX_API_KEY missing suppresses the SIP connection warning', () => {
    // WHO: Operator with no Telnyx config at all
    // WHY: The SIP-connection warning is meaningless when the key itself is absent —
    //        we'd just be shouting twice for the same condition
    const warnings = collectStartupWarnings(
      baseCtx({ TELNYX_API_KEY: '', TELNYX_SIP_CONNECTION_ID: '' })
    );
    expect(warnings.filter((w) => w.includes('TELNYX_SIP_CONNECTION_ID'))).toHaveLength(0);
  });
});

describe('collectStartupWarnings — AGENT_SECRET', () => {
  it('SAD: missing AGENT_SECRET → warning about agent-tool rejection', () => {
    const warnings = collectStartupWarnings(
      baseCtx({ env: { AGENT_SECRET: undefined, GOOGLE_CLIENT_ID: 'x' } })
    );
    expect(warnings.find((w) => w.includes('AGENT_SECRET'))).toMatch(
      /reject all LiveKit worker calls/i
    );
  });
});

describe('collectStartupWarnings — GOOGLE_CLIENT_ID', () => {
  it('SAD: missing GOOGLE_CLIENT_ID → calendar-sync warning', () => {
    const warnings = collectStartupWarnings(
      baseCtx({
        env: {
          GOOGLE_CLIENT_ID: undefined,
          AGENT_SECRET: 'a'.repeat(40),
        },
      })
    );
    expect(warnings.find((w) => w.includes('GOOGLE_CLIENT_ID'))).toContain(
      'Google Calendar sync disabled'
    );
  });
});

describe('collectStartupWarnings — STRIPE_WEBHOOK_SECRET', () => {
  it('SAD: missing STRIPE_WEBHOOK_SECRET → subscription-activation warning', () => {
    // WHO: Operator who set STRIPE_SECRET_KEY but forgot the webhook secret
    // WHAT: Checkout works but webhooks 400 → subscriptions never flip active
    // WHY: Silent — no boot error, successful checkout, zero activations
    const warnings = collectStartupWarnings(baseCtx({ env: { STRIPE_WEBHOOK_SECRET: undefined } }));
    const w = warnings.find((x) => x.includes('STRIPE_WEBHOOK_SECRET'));
    expect(w).toBeDefined();
    expect(w).toContain('400');
    expect(w).toContain('never activate');
  });
});

describe('collectStartupWarnings — email credentials', () => {
  it('SAD: missing EMAIL_USER → mock-transporter warning', () => {
    // WHO: Operator who hasn't set up the Gmail app password yet
    // WHAT: emailService.ts installs a mock — sends succeed in code, no mail delivered
    // WHY: Silent failure — callers get no confirmation email with zero log noise
    const warnings = collectStartupWarnings(baseCtx({ env: { EMAIL_USER: undefined } }));
    const w = warnings.find((x) => x.includes('EMAIL_USER'));
    expect(w).toBeDefined();
    expect(w).toContain('mock transporter');
  });

  it('SAD: missing EMAIL_PASS → mock-transporter warning', () => {
    const warnings = collectStartupWarnings(baseCtx({ env: { EMAIL_PASS: undefined } }));
    expect(warnings.find((x) => x.includes('EMAIL_USER'))).toBeDefined();
  });
});

describe('collectStartupWarnings — SMS from-number', () => {
  it('SAD: TELEPHONY_PROVIDER=telnyx but TELNYX_PHONE_NUMBER missing → send-failure warning', () => {
    // WHO: Operator who wired Telnyx for voice but didn't set the SMS from number
    // WHAT: smsService.ts falls back to "AI_SECRETARY" which Telnyx rejects
    // WHY: Reminder SMS appear to succeed in code but all fail at the Telnyx API
    const warnings = collectStartupWarnings(
      baseCtx({ env: { TELEPHONY_PROVIDER: 'telnyx', TELNYX_PHONE_NUMBER: undefined } })
    );
    const w = warnings.find((x) => x.includes('TELNYX_PHONE_NUMBER'));
    expect(w).toBeDefined();
    expect(w).toContain('E.164');
  });

  it('SAD: Twilio provider missing credentials → mock-adapter warning', () => {
    // WHO: Operator on the default Twilio path without creds configured
    // WHAT: ProviderRegistry falls back to MockAdapter — SMS reported sent, nothing delivered
    const warnings = collectStartupWarnings(
      baseCtx({
        env: {
          TELEPHONY_PROVIDER: 'twilio',
          TWILIO_ACCOUNT_SID: undefined,
          TWILIO_AUTH_TOKEN: undefined,
        },
      })
    );
    const w = warnings.find((x) => x.includes('TWILIO_ACCOUNT_SID'));
    expect(w).toBeDefined();
    expect(w).toContain('mock adapter');
  });
});

describe('collectStartupWarnings — CORS_ORIGIN', () => {
  it('SAD: missing CORS_ORIGIN → browser-blocked warning', () => {
    // WHO: Operator who deployed without setting CORS_ORIGIN
    // WHAT: CORS defaults to localhost — prod dashboard requests rejected
    // WHY: The fix (replacing || true) is correct but still requires the env var in prod
    const warnings = collectStartupWarnings(baseCtx({ env: { CORS_ORIGIN: undefined } }));
    const w = warnings.find((x) => x.includes('CORS_ORIGIN'));
    expect(w).toBeDefined();
    expect(w).toContain('localhost');
  });
});
