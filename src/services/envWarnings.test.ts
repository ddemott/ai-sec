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
