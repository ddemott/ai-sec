import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { type Client } from 'pg';
import type { FastifyReply } from 'fastify';
import type { AppRequest } from '../src/middleware';
import {
  getRootClient,
  clearDB,
  setupBasicTenant,
  beginTestTransaction,
  rollbackTestTransaction,
  createCustomerFull,
  skipIfDbDown,
} from './utils';

let root: Client;
let tenantId: string;
let dbAvailable = false;
beforeEach((ctx) => skipIfDbDown(ctx, () => dbAvailable));

beforeAll(async () => {
  try {
    root = await getRootClient();
    dbAvailable = true;
    await clearDB(root);
    const setup = await setupBasicTenant(root);
    tenantId = setup.tenantId;
  } catch {
    dbAvailable = false;
  }
});

afterAll(async () => {
  if (root) await root.end();
});

beforeEach(async () => {
  if (dbAvailable) await beginTestTransaction(root);
});

afterEach(async () => {
  if (dbAvailable) await rollbackTestTransaction(root);
});

describe('Middleware Helpers', () => {
  describe('withPoolClient', () => {
    it('executes query and releases connection', async () => {
      if (!dbAvailable) return;
      const { Pool } = await import('pg');
      const { withPoolClient } = await import('../src/middleware');

      const pool = new Pool({
        user: 'postgres',
        host: 'localhost',
        database: 'test_db',
        password: 'postgres',
        port: 5433,
      });

      try {
        const result = await withPoolClient(pool, async (client) => {
          return client.query('SELECT 1 as num');
        });
        expect(result.rows[0].num).toBe(1);
      } finally {
        await pool.end();
      }
    });

    it('releases connection even on error', async () => {
      if (!dbAvailable) return;
      const { Pool } = await import('pg');
      const { withPoolClient } = await import('../src/middleware');

      const pool = new Pool({
        user: 'postgres',
        host: 'localhost',
        database: 'test_db',
        password: 'postgres',
        port: 5433,
      });

      try {
        await expect(
          withPoolClient(pool, async () => {
            throw new Error('test error');
          })
        ).rejects.toThrow('test error');

        // Pool should still be usable (connection was released)
        const result = await withPoolClient(pool, async (client) => {
          return client.query('SELECT 1 as num');
        });
        expect(result.rows[0].num).toBe(1);
      } finally {
        await pool.end();
      }
    });
  });

  describe('requireTenantId', () => {
    it('returns tenantId from req.tenantId', async () => {
      const { requireTenantId } = await import('../src/middleware');

      const req = { tenantId: 'abc-123' } as unknown as AppRequest;
      const reply = { status: () => ({ send: () => {} }) } as unknown as FastifyReply;

      const result = requireTenantId(req, reply);
      expect(result).toBe('abc-123');
    });

    it('does NOT fall back to req.body.tenant_id (only the middleware-validated req.tenantId is trusted)', async () => {
      // 2026-05-21: the old body fallback let a route resolve a tenant
      // straight from the request body, bypassing tenantMiddleware's
      // JWT-vs-candidate validation — the same class of bug as the
      // anonymous-tenant hole. requireTenantId must trust ONLY req.tenantId.
      // auth is present here so we isolate the "body ignored" behavior from
      // the unauthenticated-401 branch.
      const { requireTenantId } = await import('../src/middleware');

      const req = {
        auth: { tenant_id: 'def-456', user_id: 'u', email: 'e' },
        body: { tenant_id: 'def-456' },
      } as unknown as AppRequest;
      let sentStatus = 0;
      const reply = {
        status: (code: number) => {
          sentStatus = code;
          return { send: () => {} };
        },
      } as unknown as FastifyReply;

      const result = requireTenantId(req, reply);
      expect(result).toBeNull(); // body.tenant_id is no longer read
      expect(sentStatus).toBe(400); // authed but no validated tenant → 400
    });

    it('prefers req.tenantId over body', async () => {
      const { requireTenantId } = await import('../src/middleware');

      const req = {
        tenantId: 'from-query',
        body: { tenant_id: 'from-body' },
      } as unknown as AppRequest;
      const reply = { status: () => ({ send: () => {} }) } as unknown as FastifyReply;

      const result = requireTenantId(req, reply);
      expect(result).toBe('from-query');
    });

    it('returns null and sends 401 when no tenantId AND no auth (unauthenticated)', async () => {
      // 2026-05-21: with no authenticated session the real failure is
      // authentication, not a missing field — say 401, not the misleading
      // 400 the route used to return.
      const { requireTenantId } = await import('../src/middleware');

      let sentStatus = 0;
      let sentBody: { error: string } | null = null;
      const req = { body: {} } as unknown as AppRequest;
      const reply = {
        status: (code: number) => {
          sentStatus = code;
          return {
            send: (body: { error: string }) => {
              sentBody = body;
            },
          };
        },
      } as unknown as FastifyReply;

      const result = requireTenantId(req, reply);
      expect(result).toBeNull();
      expect(sentStatus).toBe(401);
      expect(sentBody).toEqual({ success: false, error: 'Authentication required' });
    });

    it('returns null and sends 400 when authed but no validated tenant', async () => {
      // The 400 path still exists — but only for an authenticated caller
      // whose request somehow carries no validated tenant. That is a genuine
      // bad-request, distinct from the unauthenticated 401 above.
      const { requireTenantId } = await import('../src/middleware');

      let sentStatus = 0;
      let sentBody: { error: string } | null = null;
      const req = {
        auth: { tenant_id: 'x', user_id: 'u', email: 'e' },
        body: {},
      } as unknown as AppRequest;
      const reply = {
        status: (code: number) => {
          sentStatus = code;
          return {
            send: (body: { error: string }) => {
              sentBody = body;
            },
          };
        },
      } as unknown as FastifyReply;

      const result = requireTenantId(req, reply);
      expect(result).toBeNull();
      expect(sentStatus).toBe(400);
      expect(sentBody).toEqual({ success: false, error: 'tenant_id is required' });
    });
  });

  describe('requireTenantId — error message quality', () => {
    it('error response includes actionable message', async () => {
      const { requireTenantId } = await import('../src/middleware');

      let sentBody: { error: string } | null = null;
      // Authed-but-no-tenant so we exercise the 400 message branch (the
      // unauthenticated branch returns the 401 'Authentication required').
      const req = {
        auth: { tenant_id: 'x', user_id: 'u', email: 'e' },
      } as unknown as AppRequest;
      const reply = {
        status: () => ({
          send: (body: { error: string }) => {
            sentBody = body;
          },
        }),
      } as unknown as FastifyReply;

      requireTenantId(req, reply);
      expect(sentBody!.error).toBe('tenant_id is required');
      // Error message should be clear enough to debug — tells you exactly what's missing
      expect(sentBody!.error).toContain('tenant_id');
    });

    it('handles undefined body gracefully (no crash; 401 unauthenticated)', async () => {
      const { requireTenantId } = await import('../src/middleware');

      let sentStatus = 0;
      const req = { body: undefined } as unknown as AppRequest;
      const reply = {
        status: (code: number) => {
          sentStatus = code;
          return { send: () => {} };
        },
      } as unknown as FastifyReply;

      const result = requireTenantId(req, reply);
      expect(result).toBeNull();
      expect(sentStatus).toBe(401); // no auth context → authentication required
    });
  });

  describe('withPoolClient — error propagation', () => {
    it('propagates database query errors with original message', async () => {
      if (!dbAvailable) return;
      const { Pool } = await import('pg');
      const { withPoolClient } = await import('../src/middleware');

      const pool = new Pool({
        user: 'postgres',
        host: 'localhost',
        database: 'test_db',
        password: 'postgres',
        port: 5433,
      });

      try {
        await expect(
          withPoolClient(pool, async (client) => {
            return client.query('SELECT * FROM nonexistent_table_xyz');
          })
        ).rejects.toThrow(/nonexistent_table_xyz/);
      } finally {
        await pool.end();
      }
    });

    it('pool remains usable after query error', async () => {
      if (!dbAvailable) return;
      const { Pool } = await import('pg');
      const { withPoolClient } = await import('../src/middleware');

      const pool = new Pool({
        user: 'postgres',
        host: 'localhost',
        database: 'test_db',
        password: 'postgres',
        port: 5433,
      });

      try {
        // First call fails
        await withPoolClient(pool, async (client) => {
          return client.query('INVALID SQL SYNTAX HERE');
        }).catch(() => {}); // swallow

        // Second call should still work — connection was properly released
        const result = await withPoolClient(pool, async (client) => {
          return client.query('SELECT 42 as answer');
        });
        expect(result.rows[0].answer).toBe(42);
      } finally {
        await pool.end();
      }
    });
  });

  describe('Route integration', () => {
    it('customers list returns data with valid tenant_id', async () => {
      if (!dbAvailable) return;
      await createCustomerFull(root, tenantId, '+15559999999', 'Test Customer');

      const res = await root.query('SELECT * FROM customers WHERE tenant_id = $1', [tenantId]);
      expect(res.rows.length).toBeGreaterThanOrEqual(1);
      expect(res.rows.some((r: { name: string }) => r.name === 'Test Customer')).toBe(true);
    });
  });
});
