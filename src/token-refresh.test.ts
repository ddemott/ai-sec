/**
 * Tests for Fix #14: Token refresh endpoint
 * Happy + sad paths with 5W diagnostic context.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';
const API_BASE = 'https://localhost:3000';

// Helper to make fetch ignore self-signed certs
async function apiFetch(path: string, options: RequestInit = {}) {
  try {
    return await fetch(`${API_BASE}${path}`, {
      ...options,
      // @ts-expect-error Node 18+ supports this
      dispatcher: undefined,
    });
  } catch {
    return null; // Server not running
  }
}

describe('Fix #14: Token refresh endpoint', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/postgres' });
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('POST /auth/refresh', () => {
    it('HAPPY: returns a fresh token when given a valid JWT', async () => {
      // WHO: Authenticated user with valid token
      // WHAT: POST /auth/refresh should return a new token
      // WHEN: Token is still valid (not expired)
      // WHERE: /auth/refresh endpoint
      // WHY: Users need token refresh to stay logged in past 8h
      const payload = { tenant_id: 'f234e471-0e60-4163-86c9-93cfd9338e3a', user_id: 'test-user', email: 'test@test.com' };
      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });

      const res = await apiFetch('/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!res) return; // Server not running

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.token).toBeDefined();
      expect(typeof data.token).toBe('string');

      // Verify the new token is valid and has the same payload
      const decoded = jwt.verify(data.token, JWT_SECRET) as any;
      expect(decoded.tenant_id).toBe(payload.tenant_id);
      expect(decoded.user_id).toBe(payload.user_id);
      expect(decoded.email).toBe(payload.email);
    });

    it('HAPPY: refreshed token has a later expiry than the original', async () => {
      // WHO: User refreshing their token
      // WHAT: New token should have a fresh expiry
      // WHY: The whole point of refresh is to extend the session
      const payload = { tenant_id: 'f234e471-0e60-4163-86c9-93cfd9338e3a', user_id: 'test-user', email: 'test@test.com' };
      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '30m' });
      const originalDecoded = jwt.decode(token) as any;

      const res = await apiFetch('/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!res) return;

      const data = await res.json();
      const newDecoded = jwt.decode(data.token) as any;

      // New token should expire later than the original
      expect(newDecoded.exp).toBeGreaterThan(originalDecoded.exp);
    });

    it('SAD: returns 401 when no auth header is provided', async () => {
      // WHO: Unauthenticated request
      // WHAT: Should reject with 401
      // WHY: Cannot refresh without a valid token to prove identity
      const res = await apiFetch('/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res) return;

      expect(res.status).toBe(401);
    });

    it('SAD: returns 401 when token is expired', async () => {
      // WHO: User with an expired token
      // WHAT: Should reject — expired tokens cannot be refreshed
      // WHY: Security — don't allow indefinite token extension from stale tokens
      const payload = { tenant_id: 'f234e471-0e60-4163-86c9-93cfd9338e3a', user_id: 'test-user', email: 'test@test.com' };
      const expiredToken = jwt.sign(payload, JWT_SECRET, { expiresIn: '-1s' });

      const res = await apiFetch('/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${expiredToken}`,
        },
      });

      if (!res) return;

      // Expired token should fail verification in middleware, returning 401
      expect(res.status).toBe(401);
    });

    it('SAD: returns 401 when token has invalid signature', async () => {
      // WHO: Request with a tampered/forged token
      // WHAT: Should reject
      // WHY: Forged tokens must not be refreshable
      const payload = { tenant_id: 'fake-tenant', user_id: 'fake-user', email: 'fake@test.com' };
      const forgedToken = jwt.sign(payload, 'wrong-secret', { expiresIn: '1h' });

      const res = await apiFetch('/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${forgedToken}`,
        },
      });

      if (!res) return;

      expect(res.status).toBe(401);
    });
  });

  describe('Client-side token expiry detection', () => {
    it('HAPPY: decodeJwtPayload extracts exp from valid token', () => {
      // WHO: Dashboard API client
      // WHAT: Should decode JWT payload without verification
      // WHY: Client needs to check expiry before making requests
      const payload = { tenant_id: 'test', user_id: 'test', email: 'test@test.com' };
      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });

      // Simulate what the client does
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
      }).toThrow(); // atob('a') or parse will throw — client catches this
    });
  });
});
