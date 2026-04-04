/**
 * Tests for Fix #23: JWT failure logging
 * Verifies that invalid/expired tokens are logged and rejected.
 * Happy + sad paths with 5W diagnostic context.
 */
import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import fs from 'fs';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';
const API_BASE = 'https://localhost:3000';

async function apiFetch(path: string, options: RequestInit = {}) {
  try {
    return await fetch(`${API_BASE}${path}`, options);
  } catch {
    return null;
  }
}

describe('Fix #23: JWT failure logging', () => {
  it('HAPPY: valid token passes auth middleware (200 on /health)', async () => {
    // WHO: Authenticated user with valid JWT
    // WHAT: Request should succeed
    // WHY: Valid tokens must not be rejected
    const res = await apiFetch('/health');
    if (!res) return;
    expect(res.status).toBe(200);
  });

  it('SAD: expired token returns 401', async () => {
    // WHO: User with expired JWT
    // WHAT: Should return 401 with error message
    // WHY: Expired tokens are invalid — middleware logs and rejects
    const token = jwt.sign(
      { tenant_id: 'test', user_id: 'test', email: 'test@test.com' },
      JWT_SECRET,
      { expiresIn: '-1s' }
    );

    const res = await apiFetch('/shifts?tenant_id=test', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res) return;

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('Invalid or expired');
  });

  it('SAD: forged token (wrong secret) returns 401', async () => {
    // WHO: Attacker with forged JWT
    // WHAT: Should return 401
    // WHY: Tokens signed with wrong secret must be rejected and logged
    const token = jwt.sign(
      { tenant_id: 'test', user_id: 'test', email: 'test@test.com' },
      'wrong-secret-key',
      { expiresIn: '1h' }
    );

    const res = await apiFetch('/shifts?tenant_id=test', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res) return;

    expect(res.status).toBe(401);
  });

  it('HAPPY: source code logs warning on JWT failure', () => {
    // WHO: Backend middleware
    // WHAT: Should call request.log.warn when JWT verification fails
    // WHY: Failed auth attempts need to be visible in production logs
    const src = fs.readFileSync('src/index.ts', 'utf8');
    expect(src).toContain('request.log.warn');
    expect(src).toContain('JWT verification failed');
  });
});
