/**
 * Resolve the call path's hostnames BEFORE a caller is on the line.
 *
 * WHY THIS EXISTS (2026-08-15, measured — not guessed at).
 *
 * A browser sim call on this dev host greeted the caller 11,765 ms after the
 * participant joined, with `pregenerated: true` — the frame was cached, the
 * greeting was ready, and the caller still sat in ~12 seconds of dead air. The
 * wait was inside the greeting WARM, and the warm was slow for one reason:
 *
 *   dns.lookup('api.deepgram.com')      → 11,069 ms
 *   dns.resolve4('api.deepgram.com')    →      24 ms
 *   dig AAAA … @10.255.255.254 (WSL)    → 11,110 ms
 *   dig AAAA … @1.1.1.1                 →      46 ms
 *
 * getaddrinfo asks for A and AAAA together and waits for both. The A answer is
 * instant; the AAAA answer from the WSL host resolver takes 11 seconds. So every
 * FIRST outbound connection in a fresh process pays 11 seconds before a single
 * byte of audio is requested — TTS, LLM, and the backend alike.
 *
 * That is an environment fault, not a Deepgram fault, and the environment fix
 * (a resolver that answers AAAA) belongs to the host. But the shape of the
 * failure is general and applies in production too: a job process is spawned
 * cold, and whatever DNS/TLS/handshake cost the first connection carries is paid
 * with the caller listening. Doing it here, in prewarm, moves that cost into the
 * idle process — where nobody is waiting.
 *
 * DELIBERATELY BEST-EFFORT: every lookup is bounded and every failure is
 * swallowed. A warm that throws, blocks, or fails MUST NOT stop a call from
 * being answered — the call path re-resolves on its own regardless. This is a
 * head start, never a precondition.
 */
import dns from 'node:dns/promises';

export const DEFAULT_WARM_TIMEOUT_MS = 8_000;

/** Result of one host's warm attempt. `ms` is measured even when it fails. */
export interface DnsWarmResult {
  host: string;
  ok: boolean;
  ms: number;
}

/** Minimal slice of `dns.promises` we depend on — keeps this unit-testable. */
export type LookupFn = (hostname: string) => Promise<unknown>;

/**
 * Hostnames worth resolving before pickup, derived from the env the worker is
 * already running with. Only the hosts the CALL path touches: the two media
 * vendors, the tool backend, and the LiveKit signalling host.
 *
 * Returns unique, syntactically valid hostnames. Anything unparseable is
 * dropped silently — a malformed URL is a config problem that other code
 * already reports, and a warm is not the place to fail a boot over it.
 */
export function callPathHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  const hosts = new Set<string>();
  // Fixed vendor endpoints. Hardcoded because they are what the plugins dial;
  // reading them from env would let a typo silently warm the wrong host.
  hosts.add('api.deepgram.com');
  hosts.add('api.openai.com');
  for (const raw of [env.BACKEND_URL, env.LIVEKIT_URL]) {
    if (!raw) continue;
    try {
      const { hostname } = new URL(raw);
      if (hostname) hosts.add(hostname);
    } catch {
      // Not a URL — nothing to warm, and not our error to raise.
    }
  }
  return [...hosts];
}

/**
 * Resolve each host once, in parallel, with a hard per-host cap.
 *
 * The cap is what makes this safe to call from prewarm: a resolver that hangs
 * (exactly the fault this exists for) cannot hold the process. We stop waiting
 * and let the call path deal with DNS itself, which is what it did before.
 */
export async function warmDns(
  hosts: readonly string[],
  opts: { timeoutMs?: number; lookup?: LookupFn; now?: () => number } = {}
): Promise<DnsWarmResult[]> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_WARM_TIMEOUT_MS;
  const lookup: LookupFn = opts.lookup ?? ((h) => dns.lookup(h));
  const now = opts.now ?? Date.now;

  return Promise.all(
    hosts.map(async (host) => {
      const startedAt = now();
      try {
        await Promise.race([
          lookup(host),
          new Promise((_, reject) =>
            // unref so a pending timer can never hold the process open — this
            // runs in a worker that must be able to exit between jobs.
            setTimeout(() => reject(new Error('dns_warm_timeout')), timeoutMs).unref?.()
          ),
        ]);
        return { host, ok: true, ms: now() - startedAt };
      } catch {
        return { host, ok: false, ms: now() - startedAt };
      }
    })
  );
}

/**
 * True when a warm result set is worth logging at WARNING rather than INFO: a
 * host that took longer than a second to resolve is a caller-visible pause
 * waiting to happen, and the number is the whole point of logging it.
 */
export function slowOrFailed(results: readonly DnsWarmResult[], slowMs = 1_000): DnsWarmResult[] {
  return results.filter((r) => !r.ok || r.ms >= slowMs);
}
