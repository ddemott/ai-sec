import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { formatSimCallBanner } from '../../agent/scripts/sim-call-format.mjs';
import {
  parseSimCallOutput,
  startBrowserCallerSession,
} from '../../src/services/browserCallerSession';

const SAMPLE_URL =
  'https://meet.livekit.io/custom?liveKitUrl=wss%3A%2F%2Fexample.livekit.cloud&token=abc123';

/**
 * WHO: developer using the browser call launcher
 * WHAT: parse sim-call stdout + propagate session-launch env overrides
 * WHEN: every browser call session start
 * WHERE: src/services/browserCallerSession.ts
 * WHY: launcher works only if the backend can reliably turn sim-call stdout into join metadata
 */
describe('browserCallerSession', () => {
  it('parses the dispatch-first banner the dashboard launcher still uses', () => {
    const output = formatSimCallBanner({
      joinUrl: SAMPLE_URL,
      room: 'sim-call-1750000000000',
      tenant: 'tenant-123',
      agent: 'secretary-hq-agent',
      joinFirst: false,
    });

    expect(parseSimCallOutput(output)).toEqual({
      join_url: SAMPLE_URL,
      livekit_url: 'wss://example.livekit.cloud',
      access_token: 'abc123',
      room: 'sim-call-1750000000000',
      tenant: 'tenant-123',
      agent: 'secretary-hq-agent',
      expires_in_minutes: 30,
    });
  });

  it('parses the join-first CLI banner — agent line is present BEFORE the wait', () => {
    // WHO: `simulate.sh call` (SIM_CALL_JOIN_FIRST=1)
    // WHY: 2026-08-13 join-first printed agent only after the human joined, so
    //      a 15s dashboard exec timed out / failed missing `agent:`.
    const output = formatSimCallBanner({
      joinUrl: SAMPLE_URL,
      room: 'sim-call-1786639565348',
      tenant: 'd5e3c6a1-7b9f-4e2a-bf30-8c11a5d8e9f0',
      agent: 'secretary-hq-agent',
      joinFirst: true,
    });
    expect(output).toMatch(/Agent joins AFTER you appear/);
    expect(output.indexOf('agent:')).toBeLessThan(
      output.indexOf('Waiting up to') === -1 ? output.length : output.indexOf('Waiting up to')
    );
    expect(parseSimCallOutput(output).agent).toBe('secretary-hq-agent');
    expect(parseSimCallOutput(output).room).toBe('sim-call-1786639565348');
  });

  it('SAD: refuses a join-first wait log that never printed agent', () => {
    const incomplete = `
      Open this URL NOW.
      ${SAMPLE_URL}
      room:    sim-call-1
      tenant:  t
      Waiting up to 3 minutes for you to join...
    `;
    expect(() => parseSimCallOutput(incomplete)).toThrow('sim-call output missing agent');
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
    expect(runner.mock.calls[0]?.[1]?.SIM_CALL_JOIN_FIRST).toBeUndefined();
    expect(session.tenant).toBe('tenant-override');
    expect(session.agent).toBe('secretary-hq-agent-dev');
  });

  it('fails loud when sim-call output is missing the join url', () => {
    expect(() => parseSimCallOutput('room: sim-call-1\ntenant: t\nagent: a')).toThrow(
      'sim-call output missing join URL'
    );
  });
});

describe('sim-call + simulate.sh contract (read off disk)', () => {
  // WHO: dashboard launcher (15s exec) vs CLI `simulate.sh call`
  // WHAT: the script source, not a live LiveKit session
  // WHY: join-first wait in the DEFAULT path hangs the dashboard; CLI must opt in.
  const simCall = readFileSync(resolve(__dirname, '../../agent/scripts/sim-call.mjs'), 'utf8');
  const simulateSh = readFileSync(resolve(__dirname, '../../scripts/simulate.sh'), 'utf8');

  it('default path dispatches and exits — wait is JOIN_FIRST only', () => {
    expect(simCall).toContain("process.env.SIM_CALL_JOIN_FIRST === '1'");
    expect(simCall).toContain('if (!JOIN_FIRST)');
    expect(simCall).toContain('process.exit(0)');
    // The wait exists and still defaults to three minutes. Pinned as the
    // DEFAULT rather than as literal banner text: the duration became
    // configurable (SIM_CALL_JOIN_WAIT_MS, 2026-08-15, after a tester was still
    // reading the instructions when the room lapsed) and this assertion failed
    // on the wording change while the behaviour it guards was intact.
    expect(simCall).toMatch(/Waiting up to \$\{JOIN_WAIT_LABEL\}/);
    expect(simCall).toMatch(/SIM_CALL_JOIN_WAIT_MS\) \|\| 180_000/);
  });

  it('prints the parseable banner before any wait or dispatch', () => {
    expect(simCall).toContain("from './sim-call-format.mjs'");
    expect(simCall).toContain('formatSimCallBanner');
    const bannerAt = simCall.indexOf('formatSimCallBanner');
    const waitAt = simCall.indexOf('Waiting up to');
    const dispatchFn = simCall.indexOf('async function dispatchAgent');
    expect(bannerAt).toBeGreaterThan(-1);
    expect(bannerAt).toBeLessThan(waitAt);
    expect(
      simCall.indexOf('console.log(\n  formatSimCallBanner') >= 0 || bannerAt < dispatchFn
    ).toBe(true);
  });

  it('CLI call command opts into join-first; dashboard runner does not', () => {
    expect(simulateSh).toMatch(/cmd_call\(\)/);
    expect(simulateSh).toMatch(/SIM_CALL_JOIN_FIRST=1/);
    const callBlock = simulateSh.slice(simulateSh.indexOf('cmd_call()'));
    expect(callBlock).toMatch(/SIM_CALL_JOIN_FIRST=1/);
  });
});
