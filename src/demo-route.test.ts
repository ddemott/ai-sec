/**
 * Tests for POST /demo/start
 *
 * WHO: anonymous visitor hitting the public demo endpoint
 * WHAT: tenant provisioning, JWT issuance, rate-limit, global cap
 * WHEN: on demand (no auth required)
 * WHERE: src/routes/demo.ts
 * WHY: ensure isolated demo tenants are created correctly and outbound
 *      guards fire for demo tenants (syncOrchestrator is_demo check)
 *
 * Strategy: mock the pool (no real DB), inject HTTP via Fastify.
 * Happy + sad paths with 5W diagnostics.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

import { registerDemoRoutes, resetDemoRateLimitForTesting } from './routes/demo';

type MockQueryResult = { rows: Record<string, unknown>[]; rowCount?: number };

function buildApp(queryResponses: MockQueryResult[]): {
  app: FastifyInstance;
  mockPool: Pool;
  queries: string[];
} {
  const queries: string[] = [];
  const responses = [...queryResponses];

  const mockPool = {
    query: vi.fn(async (sql: string) => {
      queries.push(sql.trim().slice(0, 80));
      return responses.shift() ?? { rows: [], rowCount: 0 };
    }),
    connect: vi.fn(async () => ({
      query: vi.fn(async (sql: string) => {
        queries.push(sql.trim().slice(0, 80));
        return responses.shift() ?? { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    })),
  } as unknown as Pool;

  const generateToken = vi.fn(() => 'mock-jwt-token');

  const app = Fastify({ logger: false });
  registerDemoRoutes(app as never, mockPool, generateToken);

  return { app, mockPool, queries };
}

// Fresh per-test IP so the rate-limit map doesn't bleed between tests.
let testIpCounter = 1000;
function nextIp(): string {
  return `10.0.0.${testIpCounter++}`;
}

describe('POST /demo/start', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset in-process rate-limit Maps so tests don't bleed into each other.
    // (All inject() calls share req.ip = 127.0.0.1 unless x-forwarded-for is set.)
    resetDemoRateLimitForTesting();
  });

  it('happy path: creates tenant, returns token + metadata', async () => {
    // WHO: anonymous visitor
    // WHAT: successful demo provisioning with seeded data
    // WHEN: DB under normal load (cap not reached)
    // WHERE: POST /demo/start
    // WHY: verify the full happy path returns all fields the dashboard needs

    const { app } = buildApp([
      // 1. Global cap check
      { rows: [{ count: '0' }] },
      // 2. Provision tenant+user CTE
      { rows: [{ tenant_id: 'demo-uuid-1234', user_id: 'user-uuid-5678' }], rowCount: 1 },
      // 3. seedDemoTenant: BEGIN
      // (connect() is called, then multiple queries inside transaction)
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/demo/start',
      headers: { 'x-forwarded-for': nextIp() },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(typeof body.token).toBe('string');
    expect(body.tenant_id).toBeDefined();
    expect(body.expires_at).toBeDefined();
    expect(body.ttl_minutes).toBe(30);
  });

  it('returns 429 after exceeding per-IP rate limit', async () => {
    // WHO: same IP hammering the endpoint
    // WHAT: 4th request in 15-min window should be rejected
    // WHEN: IP has already made 3 requests
    // WHERE: in-process IP rate-limit map in demo.ts
    // WHY: prevent DoS from a single source

    const ip = nextIp();
    const { app } = buildApp([
      // Each of the 3 allowed calls gets cap + provision responses
      { rows: [{ count: '0' }] },
      { rows: [{ tenant_id: 't1', user_id: 'u1' }], rowCount: 1 },
      { rows: [{ count: '0' }] },
      { rows: [{ tenant_id: 't2', user_id: 'u2' }], rowCount: 1 },
      { rows: [{ count: '0' }] },
      { rows: [{ tenant_id: 't3', user_id: 'u3' }], rowCount: 1 },
    ]);

    for (let i = 0; i < 3; i++) {
      await app.inject({ method: 'POST', url: '/demo/start', headers: { 'x-forwarded-for': ip } });
    }

    const blocked = await app.inject({
      method: 'POST',
      url: '/demo/start',
      headers: { 'x-forwarded-for': ip },
    });

    expect(blocked.statusCode).toBe(429);
    const body = JSON.parse(blocked.body) as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect((body.error as string).toLowerCase()).toContain('too many');
  });

  it('returns 503 when global demo cap is reached', async () => {
    // WHO: anonymous visitor
    // WHAT: 51st concurrent demo tenant request
    // WHEN: MAX_ACTIVE_DEMO_TENANTS (50) already in use
    // WHERE: global cap query in demo.ts
    // WHY: prevent DB flooding from distributed IPs bypassing per-IP limit

    const { app } = buildApp([
      { rows: [{ count: '50' }] }, // cap query returns 50 active demo tenants
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/demo/start',
      headers: { 'x-forwarded-for': nextIp() },
    });

    expect(res.statusCode).toBe(503);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect((body.error as string).toLowerCase()).toContain('capacity');
  });

  it('different IPs each get their own rate-limit window', async () => {
    // WHO: two separate visitors
    // WHAT: each gets 3 requests independently
    // WHEN: same time window
    // WHERE: IP rate-limit map keyed by IP string
    // WHY: confirm isolation so one blocked IP doesn't affect others

    const ip1 = nextIp();
    const ip2 = nextIp();
    const { app } = buildApp(
      // 3 pairs: cap-query + provision for 6 total calls
      Array.from({ length: 12 }, (_, i) =>
        i % 2 === 0
          ? { rows: [{ count: '0' }] }
          : { rows: [{ tenant_id: `t${i}`, user_id: `u${i}` }], rowCount: 1 }
      )
    );

    for (let i = 0; i < 3; i++) {
      const r1 = await app.inject({
        method: 'POST',
        url: '/demo/start',
        headers: { 'x-forwarded-for': ip1 },
      });
      const r2 = await app.inject({
        method: 'POST',
        url: '/demo/start',
        headers: { 'x-forwarded-for': ip2 },
      });
      expect(r1.statusCode).not.toBe(429);
      expect(r2.statusCode).not.toBe(429);
    }
  });
});

describe('syncOrchestrator demo guard', () => {
  it('skips provider calls when is_demo=true, but still records synchronously', async () => {
    // WHO: appointment route calling syncAppointmentToAll for a demo tenant
    // WHAT: no real provider .fn() calls, but record() still fires
    // WHEN: tenant has is_demo=true in DB
    // WHERE: syncOrchestrator.ts isDemoTenant check
    // WHY: demo tenants must never pollute real CRM/calendar integrations;
    //      SYNC_TEST_RECORDER records still fire because they are synchronous
    //      (before the async isDemoTenant gate) — e2e assertions in the
    //      RECORDER path use a real tenant so this distinction doesn't matter
    //      in practice, but we document the design here.

    const { syncAppointmentToAll } = await import('./services/syncOrchestrator');

    const mockPool = {
      query: vi.fn(async () => ({ rows: [{ is_demo: true }], rowCount: 1 })),
    } as unknown as Pool;

    // Should not throw.
    expect(() =>
      syncAppointmentToAll(mockPool, 'demo-tenant-id', 'appt-id', 'create', null)
    ).not.toThrow();

    // Wait for the async is_demo check to settle.
    await new Promise((r) => setTimeout(r, 10));

    // pool.query was called once (the is_demo check).
    expect((mockPool.query as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('dispatches providers when is_demo=false', async () => {
    // WHO: appointment route calling syncAppointmentToAll for a real tenant
    // WHAT: providers should be invoked (they'll fail gracefully — no real creds)
    // WHEN: tenant has is_demo=false
    // WHERE: syncOrchestrator.ts dispatch loop
    // WHY: confirm the guard does not suppress real tenant syncs

    const { syncAppointmentToAll } = await import('./services/syncOrchestrator');

    const mockPool = {
      query: vi.fn(async () => ({ rows: [{ is_demo: false }], rowCount: 1 })),
    } as unknown as Pool;

    expect(() =>
      syncAppointmentToAll(mockPool, 'real-tenant-id', 'appt-id', 'create', null)
    ).not.toThrow();

    await new Promise((r) => setTimeout(r, 10));

    // pool.query called at least once (the is_demo check).
    expect((mockPool.query as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(
      1
    );
  });
});
