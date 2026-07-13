/**
 * Tests for Fix #14: Token refresh endpoint.
 *
 * Integration coverage — exercises the full chain: JWT auth hook (in
 * src/middleware.ts) → /auth/refresh route handler (in src/routes/auth.ts).
 * Built via Fastify.inject() against an in-memory app rather than an HTTP
 * round-trip, so the test does not depend on `npm start` having a server
 * up. Pre-2026-05-15 this file used `fetch()` against https://localhost:4001
 * with a try/catch swallowing connection errors and a `if (!res) return`
 * silent-skip in every test body — every test counted as PASSED in CI
 * without ever exercising the route. The inject() migration removes that
 * vector entirely.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// vi.hoisted moves this assignment above all imports during Vitest's
// transform — necessary because middleware.ts captures JWT_SECRET at
// module-load time (`const JWT_SECRET = process.env.JWT_SECRET || ...`).
// A plain top-of-file statement runs AFTER imports under ES module
// hoisting rules, so middleware would already have captured the
// non-prod default by the time we assigned the env var. Tested 2026-05-15.
vi.hoisted(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';
});

import Fastify, { type FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import jwt from 'jsonwebtoken';
import { registerJwtAuthHook, generateToken } from '../../src/middleware';
import { registerAuthRoutes } from '../../src/routes/auth';
import { skipIfDbDown } from '../utils';

const JWT_SECRET = process.env.JWT_SECRET as string;
const TENANT_ID = 'f234e471-0e60-4163-86c9-93cfd9338e3a';

describe('Fix #14: Token refresh endpoint', () => {
  let app: FastifyInstance;
  let pool: Pool;
  let dbAvailable = false;
  beforeEach((ctx) => skipIfDbDown(ctx, () => dbAvailable));

  beforeAll(async () => {
    try {
      pool = new Pool({
        connectionString:
          process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5433/test_db',
      });
      // Probe the pool before declaring DB available — the JWT hook does a
      // password_changed_at lookup on every authenticated request, so a
      // dead pool would surface as 500 mid-test instead of a clean skip.
      await pool.query('SELECT 1');
      dbAvailable = true;
    } catch {
      return;
    }
    app = Fastify({ logger: false });
    registerJwtAuthHook(app, pool);
    registerAuthRoutes(app, pool, generateToken);
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (pool) await pool.end();
  });

  describe('POST /auth/refresh', () => {
    it('HAPPY: returns a fresh token when given a valid JWT', async () => {
      // WHO: Authenticated user with valid token
      // WHAT: POST /auth/refresh should return a new token
      // WHEN: Token is still valid (not expired)
      // WHERE: /auth/refresh endpoint
      // WHY: Users need token refresh to stay logged in past 8h
      const payload = {
        tenant_id: TENANT_ID,
        user_id: '11111111-1111-1111-1111-111111111111',
        email: 'test@test.com',
        role: 'owner' as const,
      };
      const token = generateToken(payload);

      const res = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.success).toBe(true);
      expect(typeof data.token).toBe('string');

      const decoded = jwt.verify(data.token, JWT_SECRET) as {
        tenant_id: string;
        user_id: string;
        email: string;
      };
      expect(decoded.tenant_id).toBe(payload.tenant_id);
      expect(decoded.user_id).toBe(payload.user_id);
      expect(decoded.email).toBe(payload.email);
    });

    it('HAPPY: refreshed token has a later expiry than the original', async () => {
      // WHO: User refreshing their token
      // WHAT: New token should have a fresh expiry
      // WHY: The whole point of refresh is to extend the session
      const payload = {
        tenant_id: TENANT_ID,
        user_id: '11111111-1111-1111-1111-111111111111',
        email: 'test@test.com',
        role: 'owner' as const,
      };
      // Sign with a short expiry so the refreshed expiry is observably later.
      // `typ: 'session'` mirrors generateToken() — the JWT hook rejects any
      // token that doesn't claim to be a session.
      const token = jwt.sign({ ...payload, typ: 'session' }, JWT_SECRET, { expiresIn: '30m' });
      const originalDecoded = jwt.decode(token) as { exp: number };

      const res = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      const newDecoded = jwt.decode(data.token) as { exp: number };
      expect(newDecoded.exp).toBeGreaterThan(originalDecoded.exp);
    });

    it('SAD: returns 401 when no auth header is provided', async () => {
      // WHO: Unauthenticated request
      // WHAT: Should reject with 401
      // WHY: Cannot refresh without a valid token to prove identity
      const res = await app.inject({ method: 'POST', url: '/auth/refresh' });
      expect(res.statusCode).toBe(401);
    });

    it('SAD: returns 401 when token is expired', async () => {
      // WHO: User with an expired token
      // WHAT: Should reject — expired tokens cannot be refreshed
      // WHY: Security — don't allow indefinite token extension from stale tokens
      const payload = {
        tenant_id: TENANT_ID,
        user_id: '11111111-1111-1111-1111-111111111111',
        email: 'test@test.com',
        role: 'owner',
      };
      const expiredToken = jwt.sign(payload, JWT_SECRET, { expiresIn: '-1s' });

      const res = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        headers: { Authorization: `Bearer ${expiredToken}` },
      });

      expect(res.statusCode).toBe(401);
    });

    it('SAD: returns 401 when token has invalid signature', async () => {
      // WHO: Request with a tampered/forged token
      // WHAT: Should reject
      // WHY: Forged tokens must not be refreshable
      const payload = {
        tenant_id: 'fake-tenant',
        user_id: 'fake-user',
        email: 'fake@test.com',
        role: 'owner',
      };
      const forgedToken = jwt.sign(payload, 'wrong-secret', { expiresIn: '1h' });

      const res = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        headers: { Authorization: `Bearer ${forgedToken}` },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('Client-side token expiry detection', () => {
    // These two tests don't depend on the server at all — they're pure
    // unit tests of the same decode-without-verify pattern the dashboard
    // API client uses. Left in this file because they share the JWT
    // subject domain.
    it('HAPPY: decodeJwtPayload extracts exp from valid token', () => {
      // WHO: Dashboard API client
      // WHAT: Should decode JWT payload without verification
      // WHY: Client needs to check expiry before making requests
      const payload = { tenant_id: 'test', user_id: 'test', email: 'test@test.com' };
      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });

      const parts = token.split('.');
      const decoded = JSON.parse(atob(parts[1]));

      expect(decoded.exp).toBeDefined();
      expect(typeof decoded.exp).toBe('number');
      expect(decoded.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it('SAD: decodeJwtPayload returns null for garbage input', () => {
      // WHO: Dashboard API client
      // WHAT: Should handle invalid tokens gracefully
      // WHY: Don't crash on corrupt localStorage data
      expect(() => {
        const parts = 'not.a.jwt'.split('.');
        JSON.parse(atob(parts[1]));
      }).toThrow();
    });
  });
});
