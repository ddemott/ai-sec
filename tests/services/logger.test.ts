import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { buildLogger } from '../../src/services/logger';

describe('buildLogger — observability factory', () => {
  const originalToken = process.env.BETTER_STACK_TOKEN;
  const originalLevel = process.env.LOG_LEVEL;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    delete process.env.BETTER_STACK_TOKEN;
    delete process.env.LOG_LEVEL;
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.BETTER_STACK_TOKEN;
    else process.env.BETTER_STACK_TOKEN = originalToken;
    if (originalLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = originalLevel;
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
  });

  test('builds a working logger when BETTER_STACK_TOKEN is unset', () => {
    const log = buildLogger({ service: 'ai-sec-backend' });
    expect(typeof log.info).toBe('function');
    expect(typeof log.error).toBe('function');
    expect(typeof log.child).toBe('function');
    // Calling info must not throw — local dev / tests run without a token.
    expect(() => log.info('hello')).not.toThrow();
    // WHO: any developer running `npm test` or `npm start` without prod credentials | WHAT: logger functions exist + don't crash | WHEN: BETTER_STACK_TOKEN is absent (the default for local dev) | WHERE: buildLogger token-absent branch | WHY: the moment a logger crashes on import or first call, the entire backend boot dies — observability code MUST never block the main flow; pin the silent-fallback contract so a future refactor can't accidentally make BETTER_STACK_TOKEN required
  });

  test('bakes the service name into every log line as a base context field', () => {
    const log = buildLogger({ service: 'ai-sec-backend' });
    // Pino exposes the base bindings via .bindings() on Pino v9+.
    const bindings = log.bindings();
    expect(bindings.service).toBe('ai-sec-backend');
    // WHO: support engineer filtering Better Stack for one of the two services | WHAT: every line carries `service: ai-sec-backend` (or `ai-sec-agent`) | WHEN: cross-service correlation across one Better Stack source | WHERE: logger base context | WHY: a single Better Stack source hosts both services to keep the free tier; without a service tag every filter requires manual routing logic and "the call dropped" support questions become unanswerable
  });

  test('reads NODE_ENV into the env tag', () => {
    process.env.NODE_ENV = 'production';
    const log = buildLogger({ service: 'ai-sec-backend' });
    expect(log.bindings().env).toBe('production');
    // WHO: engineer triaging a production-only issue | WHAT: env tag distinguishes prod vs staging vs dev logs in the same Better Stack source | WHEN: a noisy dev session and a real prod incident overlap in time | WHERE: logger base context | WHY: filtering on `env: production` is the first thing support does; mistakenly treating a dev log as a prod incident wastes paging time
  });

  test('respects LOG_LEVEL env override', () => {
    process.env.LOG_LEVEL = 'warn';
    const log = buildLogger({ service: 'ai-sec-backend' });
    expect(log.level).toBe('warn');
    // WHO: ops engineer responding to log volume cost spike | WHAT: env-var knob lets us turn down verbosity without redeploying | WHEN: Better Stack ingest approaches the free-tier 1GB cap mid-month | WHERE: buildLogger LOG_LEVEL handling | WHY: a code-only level flag forces a redeploy under a billing crunch; pinning the env-var path keeps a fast escape hatch
  });

  test('defaults to info level in production when LOG_LEVEL unset', () => {
    process.env.NODE_ENV = 'production';
    const log = buildLogger({ service: 'ai-sec-backend' });
    expect(log.level).toBe('info');
    // WHO: engineer reading prod logs | WHAT: default prod level is info, not debug — keeps the signal-to-noise ratio sane | WHEN: BETTER_STACK_TOKEN set, NODE_ENV=production, LOG_LEVEL absent | WHERE: buildLogger level resolution | WHY: shipping with debug-default in prod would 10× our log volume and burn the free-tier quota in days; the per-env default IS the safety net
  });

  test('defaults to debug level in development when LOG_LEVEL unset', () => {
    process.env.NODE_ENV = 'development';
    const log = buildLogger({ service: 'ai-sec-backend' });
    expect(log.level).toBe('debug');
    // WHO: developer running `npm start` locally | WHAT: dev default is debug so trace/info both flow to terminal during feature work | WHEN: NODE_ENV=development, LOG_LEVEL absent | WHERE: buildLogger level resolution | WHY: forcing local devs to set LOG_LEVEL=debug to see info-level lines is friction; the per-env default lets prod stay quiet and dev stay verbose without per-developer setup
  });

  test('child logger inherits service + env and adds the requested bindings', () => {
    const log = buildLogger({ service: 'ai-sec-backend' });
    const child = log.child({ tenant_id: 't-123', request_id: 'r-456' });
    const bindings = child.bindings();
    expect(bindings.service).toBe('ai-sec-backend');
    expect(bindings.tenant_id).toBe('t-123');
    expect(bindings.request_id).toBe('r-456');
    // WHO: per-request and per-call code paths (Fastify request loggers, agent's per-call child) | WHAT: child loggers add tenant_id / call_id / request_id without dropping the base service+env tags | WHEN: every Fastify request and every LiveKit agent call | WHERE: Pino child-logger contract | WHY: this is THE feature that makes "the call dropped at 2:14pm" support questions answerable — filtering on `tenant_id=X AND call_id=Y` returns the full timeline only because every line on that call inherits both the base context and the per-call bindings
  });
});
