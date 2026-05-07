import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { getLogger, resetLoggerCacheForTesting } from './logger.js';

describe('agent logger', () => {
  const originalToken = process.env.BETTER_STACK_TOKEN;
  const originalLevel = process.env.LOG_LEVEL;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    delete process.env.BETTER_STACK_TOKEN;
    delete process.env.LOG_LEVEL;
    resetLoggerCacheForTesting();
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.BETTER_STACK_TOKEN;
    else process.env.BETTER_STACK_TOKEN = originalToken;
    if (originalLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = originalLevel;
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
    resetLoggerCacheForTesting();
  });

  test('returns a working logger when BETTER_STACK_TOKEN is unset', () => {
    const log = getLogger();
    expect(typeof log.info).toBe('function');
    expect(() => log.info({ event: 'test' }, 'msg')).not.toThrow();
    // WHO: agent worker booting in local dev / CI / a Railway slot whose token hasn't been set yet | WHAT: getLogger() returns a usable instance even with no Better Stack credentials | WHEN: BETTER_STACK_TOKEN absent (the default everywhere except prod after token rotation) | WHERE: agent/src/logger.ts token-absent branch | WHY: a logger crash at import-time would prevent the agent from registering with LiveKit Cloud, leaving every call to dead-air; pinning the silent-fallback contract is critical because the worker has no human nearby to read a stack trace
  });

  test('tags every log with service: ai-sec-agent so the backend and agent share one Better Stack source', () => {
    const log = getLogger();
    expect(log.bindings().service).toBe('ai-sec-agent');
    // WHO: support filtering across both services on one call | WHAT: agent log lines tagged distinct from backend (`ai-sec-backend`) | WHEN: a "the call dropped" question that involves both an agent-side STT failure AND a backend tool-call timeout | WHERE: agent logger base context | WHY: distinguishing the two services is the difference between "tool call X took 14 seconds" and "the agent waited 14 seconds for tool call X to return" — both are relevant; without the service tag they're indistinguishable
  });

  test('returns the same instance across multiple calls (singleton cache)', () => {
    const a = getLogger();
    const b = getLogger();
    expect(a).toBe(b);
    // WHO: per-call agent code paths that pull `getLogger()` from many modules | WHAT: a single Pino instance reused across the worker process | WHEN: every call (entry runs, fetches logger, builds children) | WHERE: agent/src/logger.ts module-level cache | WHY: each `pino.transport(...)` call spins up a new worker thread; building one per call would leak threads and saturate the agent process within a few hours of traffic — the cache is what keeps the worker stable under load
  });

  test('child logger inherits the agent service tag plus per-call bindings', () => {
    const log = getLogger();
    const callLog = log.child({ tenant_id: 't-123', call_id: 'c-456' });
    const bindings = callLog.bindings();
    expect(bindings.service).toBe('ai-sec-agent');
    expect(bindings.tenant_id).toBe('t-123');
    expect(bindings.call_id).toBe('c-456');
    // WHO: agent index.ts building a per-call child after sessionCtx resolves | WHAT: tenant_id + call_id propagate to every subsequent log line on that call | WHEN: voice session lifecycle (session_started, tenant_config_fetched, fallback_triggered) | WHERE: Pino child-logger pattern in agent/src/index.ts | WHY: this is the load-bearing piece for support — without per-call bindings the timeline of a specific call is buried in interleaved logs from every concurrent call on the worker; with them, one filter (`tenant_id=X AND call_id=Y`) recovers the full sequence
  });

  test('respects LOG_LEVEL env override even after first call', () => {
    process.env.LOG_LEVEL = 'warn';
    const log = getLogger();
    expect(log.level).toBe('warn');
    // WHO: ops engineer dialing back agent verbosity mid-incident | WHAT: LOG_LEVEL knob works the same on the agent as on the backend | WHEN: free-tier ingest cap approached or a noisy debug build deployed by mistake | WHERE: getLogger LOG_LEVEL handling | WHY: parity between backend and agent on the LOG_LEVEL contract means support runbooks are short — one knob, one env var, both services
  });

  test('resetLoggerCacheForTesting() lets tests get a fresh build for the next call', () => {
    process.env.LOG_LEVEL = 'info';
    const a = getLogger();
    expect(a.level).toBe('info');
    process.env.LOG_LEVEL = 'warn';
    // Without reset, cached instance would still report 'info'.
    resetLoggerCacheForTesting();
    const b = getLogger();
    expect(b.level).toBe('warn');
    // WHO: tests in this file (and any future test that mutates env to verify logger config) | WHAT: a controlled escape hatch to invalidate the singleton cache between tests | WHEN: a test changes BETTER_STACK_TOKEN / LOG_LEVEL / NODE_ENV and needs the next getLogger() call to honor it | WHERE: resetLoggerCacheForTesting export | WHY: singletons make tests order-dependent; without an explicit reset, test #2 inherits test #1's logger and false-passes / false-fails based on test order — the reset is what makes the suite deterministic
  });
});
