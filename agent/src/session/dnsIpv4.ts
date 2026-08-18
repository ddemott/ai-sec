/**
 * Opt-in workaround for a resolver that stalls on AAAA.
 *
 * MEASURED 2026-08-15 on the WSL dev host, which forwards DNS to the Windows
 * side (`nameserver 10.255.255.254`):
 *
 *   dns.lookup('api.deepgram.com')             → 11,069 ms
 *   dns.lookup('api.deepgram.com', {family:4}) →      19 ms
 *   dig AAAA … @10.255.255.254                 → 11,110 ms
 *   dig AAAA … @1.1.1.1                        →      46 ms
 *
 * getaddrinfo asks A and AAAA together and returns when BOTH answer. The A
 * record is instant; the AAAA answer takes 11 seconds. A greeting that was
 * already synthesised and cached still reached the caller 11.9 s after pickup,
 * because the FIRST https request in a job process paid that lookup — the
 * socket timeline says it plainly:
 *
 *   req1 { socket: 10, lookup: 11085, tcp: 11086, tls: 11195, done: 11607 }
 *   req2 { socket:  0,                              done:   358 }
 *
 * THE REAL FIX IS THE HOST'S RESOLVER, not this file. Point /etc/resolv.conf at
 * a resolver that answers AAAA (1.1.1.1 does, in 46 ms) and none of this is
 * needed. That needs root, so this exists to make a local voice call testable
 * without it.
 *
 * WHY THE GLOBAL AGENTS AND NOT `dns.lookup` ITSELF: patching the dns module
 * looks like it works and does nothing where it matters. `node:net` captures
 * its default lookup by reference when the module first loads — long before any
 * of our code runs — so a later patch never reaches an outgoing socket. It was
 * tried: `dns.lookup` measured 18 ms while the very next TTS request still took
 * 11.7 s. The agents' `options.lookup` is the seam sockets actually read.
 *
 * TWO SEAMS, NOT ONE — and the second is where the voice lives.
 *
 * The agents' `options.lookup` covers plain http/https requests, which is the
 * Deepgram TTS POST. It does NOT cover WEBSOCKETS: `ws` sets its own
 * `opts.createConnection` and calls `tls.connect(options)` directly
 * (node_modules/ws/lib/websocket.js), so the agent — and therefore its lookup —
 * is never consulted. Measured 2026-08-15 with the agent patch already in place:
 *
 *   ws open (agents patched only)          11,300 ms
 *   ws open (tls.connect patched too)         237 ms
 *
 * That is the streaming TTS socket and the streaming STT socket. Patching only
 * the agents fixed the greeting (an HTTP collect) and left every SPOKEN TURN
 * paying the stall — the caller heard ~10 s of nothing per reply and asked "are
 * you there?".
 *
 * So `tls.connect` and `net.connect` are patched as well, and the injection is
 * conditional: an explicit `lookup` from the caller is never overwritten.
 *
 * NOT COVERED: undici's `fetch`, which owns its own connector. The backend
 * (localhost) and api.openai.com (47 ms dual lookup, measured) both resolve fine
 * here, so nothing in the call path needed it.
 *
 * DEFAULT OFF, AND DELIBERATELY SO. Forcing IPv4 process-wide is a workaround
 * for a broken resolver, not an improvement: on an IPv6-only network it turns a
 * working lookup into ENOTFOUND. Production resolves both families in
 * milliseconds and must keep choosing for itself. Enable with
 * DNS_FORCE_IPV4=true (agent/package.json `dev:local` does).
 */
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

/** The shape `node:net` expects from a custom lookup. */
export type NetLookup = (
  hostname: string,
  options: dns.LookupOneOptions | dns.LookupAllOptions | ((...args: never[]) => void),
  callback?: (...args: never[]) => void
) => void;

export function forceIpv4Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DNS_FORCE_IPV4 === 'true';
}

/**
 * Build a lookup that asks for A records only, over the given resolver.
 *
 * Node calls a custom lookup either as (hostname, options, callback) or as
 * (hostname, callback); both forms appear depending on the socket path, so both
 * are handled rather than assumed. Mistaking the callback for an options object
 * drops the callback and the connection hangs forever — a worse failure than
 * the slow DNS this works around.
 *
 * The resolver is injectable so the shuffling above can be tested without
 * touching real DNS.
 */
export function makeIpv4Lookup(resolver: typeof dns.lookup = dns.lookup): NetLookup {
  return (hostname, options, callback) => {
    const cb = (typeof options === 'function' ? options : callback) as (...args: never[]) => void;
    const opts = typeof options === 'function' ? {} : options;
    return (resolver as unknown as (h: string, o: unknown, c: unknown) => void)(
      hostname,
      { ...opts, family: 4 },
      cb
    );
  };
}

export const ipv4Lookup: NetLookup = makeIpv4Lookup();

/**
 * The promise-style lookup the DNS warm should use, so the warm measures the
 * same resolution the call path will do. Undefined when the shim is off — the
 * warm then uses node's default and reports the real, dual-family number.
 */
export function warmLookupFor(
  env: NodeJS.ProcessEnv = process.env
): ((hostname: string) => Promise<unknown>) | undefined {
  if (!forceIpv4Enabled(env)) return undefined;
  return (hostname: string) => dns.promises.lookup(hostname, { family: 4 });
}

/** The two agents whose sockets we redirect. Injectable so tests stay local. */
export interface AgentLookupTarget {
  options: { lookup?: unknown };
}

/** A module whose `connect` builds sockets directly, bypassing any agent. */
export interface ConnectModule {
  connect: (...args: unknown[]) => unknown;
}

/**
 * Add the IPv4 lookup to a `connect(options, …)` call that did not specify one.
 *
 * Only the object-options form is touched. `connect(port, host)` and
 * `connect(path)` take no lookup at all, and inventing one for them would change
 * a call the caller never made.
 */
export function withIpv4ConnectOptions(args: unknown[], lookup: NetLookup = ipv4Lookup): unknown[] {
  const [first, ...rest] = args;
  if (!first || typeof first !== 'object') return args;
  const options = first as Record<string, unknown>;
  if (options.lookup) return args;
  return [{ ...options, lookup }, ...rest];
}

/**
 * Patch a module's `connect` so socket creation inherits the IPv4 lookup.
 * Returns an undo function.
 *
 * This is what reaches WEBSOCKETS. `ws` never asks an agent for a socket — it
 * sets `createConnection` and calls `tls.connect` itself — so the agent patch
 * alone left every streaming TTS/STT connection paying the stalled AAAA lookup.
 */
export function patchConnect(target: ConnectModule, lookup: NetLookup = ipv4Lookup): () => void {
  const original = target.connect;
  target.connect = (...args: unknown[]) => original(...withIpv4ConnectOptions(args, lookup));
  return () => {
    target.connect = original;
  };
}

/**
 * Point the global http/https agents AND the direct socket constructors at the
 * IPv4-only lookup. Returns an undo function (tests use it; a worker never
 * un-installs).
 */
export function installIpv4OnlyLookup(
  // `options` is declared protected on node's Agent types, but it is a plain
  // public property at runtime and is exactly what createConnection reads.
  targets: readonly AgentLookupTarget[] = [
    http.globalAgent as unknown as AgentLookupTarget,
    https.globalAgent,
  ],
  connectTargets: readonly ConnectModule[] = [
    tls as unknown as ConnectModule,
    net as unknown as ConnectModule,
  ]
): () => void {
  const undoConnects = connectTargets.map((target) => patchConnect(target));
  const previous = targets.map((t) => t.options.lookup);
  for (const target of targets) {
    target.options.lookup = ipv4Lookup;
  }
  return () => {
    targets.forEach((target, i) => {
      const before = previous[i];
      if (before === undefined) delete target.options.lookup;
      else target.options.lookup = before;
    });
    for (const undo of undoConnects) undo();
  };
}
