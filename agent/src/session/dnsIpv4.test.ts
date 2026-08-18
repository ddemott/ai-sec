/**
 * Tests for the opt-in IPv4-only lookup shim. The agents are fakes — installing
 * on the real global agents would leak into every other suite in the process,
 * and the thing under test is the wiring, not Node's resolver.
 */
import { describe, it, expect, vi } from 'vitest';
import type dns from 'node:dns';
import {
  forceIpv4Enabled,
  ipv4Lookup,
  makeIpv4Lookup,
  installIpv4OnlyLookup,
  withIpv4ConnectOptions,
  patchConnect,
  type AgentLookupTarget,
  type ConnectModule,
} from './dnsIpv4.js';

const fakeAgent = (): AgentLookupTarget => ({ options: {} });

describe('forceIpv4Enabled', () => {
  it('SAD-BY-DEFAULT: off unless explicitly set to the string true', () => {
    // WHY: forcing IPv4 process-wide is a workaround for a broken resolver, not
    //      an improvement — on an IPv6-only network it turns a working lookup
    //      into ENOTFOUND. Production must keep choosing for itself.
    expect(forceIpv4Enabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(forceIpv4Enabled({ DNS_FORCE_IPV4: '1' } as NodeJS.ProcessEnv)).toBe(false);
    expect(forceIpv4Enabled({ DNS_FORCE_IPV4: 'TRUE' } as NodeJS.ProcessEnv)).toBe(false);
    expect(forceIpv4Enabled({ DNS_FORCE_IPV4: 'true' } as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe('installIpv4OnlyLookup', () => {
  it('HAPPY: both global agents get the IPv4 lookup', () => {
    // WHO: the Deepgram TTS POST and the Deepgram STT WebSocket — every socket
    //      the call path opens goes out through one of these two agents.
    // WHAT: options.lookup is the seam node:net actually reads per connection.
    // WHEN: module load, before any plugin dials.
    // WHERE: agent/src/index.ts, gated on DNS_FORCE_IPV4.
    // WHY: patching dns.lookup itself measured 18 ms and changed nothing — net
    //      captured its default lookup by reference when the module loaded, and
    //      the next TTS request still took 11.7 s.
    const [a, b] = [fakeAgent(), fakeAgent()];

    installIpv4OnlyLookup([a, b]);

    expect(a.options.lookup).toBe(ipv4Lookup);
    expect(b.options.lookup).toBe(ipv4Lookup);
  });

  it('undo restores the previous state, including "there was none"', () => {
    // WHY: a shim that cannot be removed is a shim that owns the process. The
    //      absent case matters — writing `undefined` back is not the same as
    //      never having set it, and node treats a present-but-undefined lookup
    //      differently from an absent one.
    const agent = fakeAgent();
    const withPrior = { options: { lookup: 'prior' } } as unknown as AgentLookupTarget;

    const undo = installIpv4OnlyLookup([agent, withPrior]);
    undo();

    expect('lookup' in agent.options).toBe(false);
    expect(withPrior.options.lookup).toBe('prior');
  });
});

describe('makeIpv4Lookup', () => {
  it('HAPPY: forces family 4 and keeps the caller’s other options', () => {
    // WHAT: family:4 is the whole fix — it is what turns an 11,069 ms lookup
    //       into a 19 ms one on a host whose resolver stalls on AAAA.
    const resolver = vi.fn();
    const lookup = makeIpv4Lookup(resolver as unknown as typeof dns.lookup);
    const cb = vi.fn();

    lookup('api.deepgram.com', { hints: 1024 } as never, cb as never);

    expect(resolver).toHaveBeenCalledWith('api.deepgram.com', { hints: 1024, family: 4 }, cb);
  });

  it('SAD: the (hostname, callback) form keeps the callback in the callback slot', () => {
    // WHY: node calls a custom lookup both ways depending on the socket path.
    //      Treating the callback as options drops it entirely and the socket
    //      never connects — a worse failure than the slow DNS being worked
    //      around, and a silent one.
    const resolver = vi.fn();
    const lookup = makeIpv4Lookup(resolver as unknown as typeof dns.lookup);
    const cb = vi.fn();

    lookup('api.deepgram.com', cb as never);

    expect(resolver).toHaveBeenCalledWith('api.deepgram.com', { family: 4 }, cb);
  });

  it('the exported singleton is what gets installed', () => {
    expect(typeof ipv4Lookup).toBe('function');
  });
});

describe('withIpv4ConnectOptions', () => {
  it('HAPPY: injects the lookup into an options object that has none', () => {
    // WHO: `ws`, opening the streaming TTS/STT socket.
    // WHAT: it calls tls.connect(options) directly — no agent is consulted, so
    //       options.lookup is the ONLY seam left.
    // WHEN: every spoken turn of every call.
    // WHERE: agent/src/session/dnsIpv4.ts, installed from index.ts at boot.
    // WHY: measured 2026-08-15 with the agent patch already in place, a WS open
    //      took 11,300 ms; with this one it took 237 ms, and TTS
    //      time-to-first-frame went 11,445 ms → 318 ms. That difference is the
    //      caller asking "are you there?" after every question.
    const [patched] = withIpv4ConnectOptions([{ host: 'api.deepgram.com', port: 443 }]) as [
      Record<string, unknown>,
    ];

    expect(patched.lookup).toBe(ipv4Lookup);
    expect(patched.host).toBe('api.deepgram.com');
  });

  it('SAD: an explicit lookup from the caller is never overwritten', () => {
    const mine = () => {};
    const [patched] = withIpv4ConnectOptions([{ host: 'x', lookup: mine }]) as [
      Record<string, unknown>,
    ];

    expect(patched.lookup).toBe(mine);
  });

  it('SAD: the (port, host) and (path) forms are passed through untouched', () => {
    // WHY: those forms take no lookup at all. Inventing an options object for
    //      them would change a call the caller never made.
    expect(withIpv4ConnectOptions([443, 'api.deepgram.com'])).toEqual([443, 'api.deepgram.com']);
    expect(withIpv4ConnectOptions(['/tmp/socket'])).toEqual(['/tmp/socket']);
    expect(withIpv4ConnectOptions([])).toEqual([]);
  });

  it('does not mutate the caller’s object', () => {
    const original = { host: 'api.deepgram.com' };
    withIpv4ConnectOptions([original]);
    expect('lookup' in original).toBe(false);
  });
});

describe('patchConnect', () => {
  it('HAPPY: forwards to the original connect with the lookup added, and undo restores', () => {
    const calls: unknown[][] = [];
    const original = (...args: unknown[]) => {
      calls.push(args);
      return 'socket';
    };
    const target = { connect: original } as ConnectModule;

    const undo = patchConnect(target);
    const result = target.connect({ host: 'api.deepgram.com' }, 'extra');

    expect(result).toBe('socket');
    expect((calls[0][0] as Record<string, unknown>).lookup).toBe(ipv4Lookup);
    expect(calls[0][1]).toBe('extra');

    undo();
    expect(target.connect).toBe(original);
  });
});

describe('installIpv4OnlyLookup — both seams', () => {
  it('patches the agents AND the direct socket constructors, and undoes both', () => {
    // WHY: patching only the agents fixed the greeting (an HTTP collect) and
    //      left every spoken turn on the stalled path. One seam was not enough.
    const agent = fakeAgent();
    const originalConnect = () => 'socket';
    const connectTarget = { connect: originalConnect } as ConnectModule;

    const undo = installIpv4OnlyLookup([agent], [connectTarget]);
    expect(agent.options.lookup).toBe(ipv4Lookup);
    expect(connectTarget.connect).not.toBe(originalConnect);

    undo();
    expect('lookup' in agent.options).toBe(false);
    expect(connectTarget.connect).toBe(originalConnect);
  });
});
