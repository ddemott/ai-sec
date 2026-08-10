import { describe, expect, it, vi } from 'vitest';

import {
  parseSimCallOutput,
  startBrowserCallerSession,
} from '../../src/services/browserCallerSession';

/**
 * WHO: developer using the browser call launcher
 * WHAT: parse sim-call stdout + propagate session-launch env overrides
 * WHEN: every browser call session start
 * WHERE: src/services/browserCallerSession.ts
 * WHY: launcher works only if the backend can reliably turn sim-call stdout into join metadata
 */
describe('browserCallerSession', () => {
  it('parses sim-call stdout into structured session data', () => {
    const output = `
      Agent dispatched. Open this URL, allow the mic, and talk to the agent:

      https://meet.livekit.io/custom?liveKitUrl=wss%3A%2F%2Fexample.livekit.cloud&token=abc123

      room:    sim-call-1750000000000
      tenant:  tenant-123
      agent:   secretary-hq-agent
      (real STT/LLM/TTS/booking — no phone. Token valid 30 min.)
    `;

    expect(parseSimCallOutput(output)).toEqual({
      join_url:
        'https://meet.livekit.io/custom?liveKitUrl=wss%3A%2F%2Fexample.livekit.cloud&token=abc123',
      livekit_url: 'wss://example.livekit.cloud',
      access_token: 'abc123',
      room: 'sim-call-1750000000000',
      tenant: 'tenant-123',
      agent: 'secretary-hq-agent',
      expires_in_minutes: 30,
    });
  });

  it('passes tenant and agent overrides into sim-call env', async () => {
    const runner = vi.fn(async (_scriptPath: string, env: NodeJS.ProcessEnv) => ({
      stdout: `
        https://meet.livekit.io/custom?liveKitUrl=wss%3A%2F%2Fexample.livekit.cloud&token=abc123
        room:    sim-call-1750000000000
        tenant:  ${env.SIM_TENANT}
        agent:   ${env.AGENT_NAME}
      `,
      stderr: '',
    }));

    const session = await startBrowserCallerSession(
      { tenantId: 'tenant-override', agentName: 'secretary-hq-agent-dev' },
      runner
    );

    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0]?.[1]?.SIM_TENANT).toBe('tenant-override');
    expect(runner.mock.calls[0]?.[1]?.AGENT_NAME).toBe('secretary-hq-agent-dev');
    expect(session.tenant).toBe('tenant-override');
    expect(session.agent).toBe('secretary-hq-agent-dev');
  });

  it('fails loud when sim-call output is missing the join url', () => {
    expect(() => parseSimCallOutput('room: sim-call-1\ntenant: t\nagent: a')).toThrow(
      'sim-call output missing join URL'
    );
  });
});
