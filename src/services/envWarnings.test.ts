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
function baseCtx(overrides: {
  env?: Record<string, string | undefined>;
  VAPI_API_KEY?: string;
  VAPI_SERVER_URL_SECRET?: string;
  XAI_API_KEY?: string;
  XAI_TTS_SECRET?: string;
  BACKEND_URL?: string;
} = {}) {
  return {
    env: {
      GOOGLE_CLIENT_ID: 'google-client-id',
      AGENT_SECRET: 'a'.repeat(40),
      TELNYX_API_KEY: 'KEY01fake',
      ...(overrides.env ?? {}),
    } as NodeJS.ProcessEnv,
    VAPI_API_KEY: overrides.VAPI_API_KEY ?? 'vapi-key',
    VAPI_SERVER_URL_SECRET: overrides.VAPI_SERVER_URL_SECRET ?? 'vapi-secret',
    XAI_API_KEY: overrides.XAI_API_KEY ?? 'xai-key',
    XAI_TTS_SECRET: overrides.XAI_TTS_SECRET ?? 'xai-secret',
    BACKEND_URL: overrides.BACKEND_URL ?? 'https://backend.example.com',
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
  it('SAD: missing TELNYX_API_KEY → warning mentions OTP and blocked caller-ID', () => {
    // WHO: Tenant provisioned without a Telnyx key (common early misconfig)
    // WHAT: The warning text names the concrete symptom the operator
    //        will see — "SMS OTP verification will fail" — so a log
    //        grep during incident response surfaces the cause fast
    // WHY: BUG class — silent config failures are the longest-to-
    //        diagnose bugs. The warning text is the test.
    const warnings = collectStartupWarnings(
      baseCtx({ env: { TELNYX_API_KEY: undefined, AGENT_SECRET: 'a'.repeat(40), GOOGLE_CLIENT_ID: 'x' } })
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('TELNYX_API_KEY');
    expect(warnings[0]).toContain('OTP');
    expect(warnings[0]).toContain('blocked caller-ID');
  });

  it('HAPPY: TELNYX_API_KEY present → no Telnyx warning even if other keys missing', () => {
    // WHY: Each warning should be independent. A missing VAPI key must
    //        not spuriously also complain about Telnyx.
    const warnings = collectStartupWarnings(baseCtx({ VAPI_API_KEY: '' }));
    expect(warnings.some((w) => w.includes('TELNYX_API_KEY'))).toBe(false);
  });
});

describe('collectStartupWarnings — AGENT_SECRET', () => {
  it('SAD: missing AGENT_SECRET → warning about agent-tool rejection', () => {
    const warnings = collectStartupWarnings(
      baseCtx({ env: { AGENT_SECRET: undefined, TELNYX_API_KEY: 'x', GOOGLE_CLIENT_ID: 'x' } })
    );
    expect(warnings.find((w) => w.includes('AGENT_SECRET'))).toMatch(
      /reject all LiveKit worker calls/i
    );
  });
});

describe('collectStartupWarnings — XAI conditional warnings', () => {
  it('HAPPY: XAI_API_KEY unset → only one XAI warning; TTS_SECRET/BACKEND_URL warnings suppressed', () => {
    // WHY: If the XAI key itself is absent, we shouldn't also nag about
    //        XAI_TTS_SECRET — TTS is disabled anyway, so the sub-warnings
    //        would be noise. Pin this conditional to prevent regressions.
    const warnings = collectStartupWarnings(
      baseCtx({ XAI_API_KEY: '', XAI_TTS_SECRET: '', BACKEND_URL: '' })
    );
    const xaiRelated = warnings.filter((w) => w.includes('XAI') || w.includes('TTS'));
    expect(xaiRelated).toHaveLength(1);
    expect(xaiRelated[0]).toContain('Grok TTS proxy disabled');
  });

  it('SAD: XAI_API_KEY set but TTS_SECRET missing → TTS-auth warning fires', () => {
    // WHO: Partial Grok TTS setup — key present, proxy auth not yet wired
    // WHY: The sub-warning correctly fires only when the primary key is
    //        present — otherwise the TTS flow isn't active and nagging is
    //        wrong
    const warnings = collectStartupWarnings(baseCtx({ XAI_TTS_SECRET: '' }));
    expect(warnings.some((w) => w.includes('XAI_TTS_SECRET'))).toBe(true);
  });

  it('SAD: XAI_API_KEY set but BACKEND_URL missing → custom-voice warning fires', () => {
    const warnings = collectStartupWarnings(baseCtx({ BACKEND_URL: '' }));
    expect(warnings.some((w) => w.includes('BACKEND_URL'))).toBe(true);
  });
});

describe('collectStartupWarnings — VAPI + GOOGLE', () => {
  it('SAD: missing VAPI_API_KEY → phone-provisioning warning', () => {
    expect(
      collectStartupWarnings(baseCtx({ VAPI_API_KEY: '' })).find((w) => w.includes('VAPI_API_KEY'))
    ).toContain('phone provisioning disabled');
  });

  it('SAD: missing VAPI_SERVER_URL_SECRET → webhook auth warning', () => {
    expect(
      collectStartupWarnings(baseCtx({ VAPI_SERVER_URL_SECRET: '' })).find((w) =>
        w.includes('VAPI_SERVER_URL_SECRET')
      )
    ).toContain('webhook auth disabled');
  });

  it('SAD: missing GOOGLE_CLIENT_ID → calendar-sync warning', () => {
    const warnings = collectStartupWarnings(
      baseCtx({
        env: {
          GOOGLE_CLIENT_ID: undefined,
          AGENT_SECRET: 'a'.repeat(40),
          TELNYX_API_KEY: 'x',
        },
      })
    );
    expect(warnings.find((w) => w.includes('GOOGLE_CLIENT_ID'))).toContain(
      'Google Calendar sync disabled'
    );
  });
});
