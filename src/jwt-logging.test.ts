/**
 * Tests for Fix #23: JWT failure logging.
 *
 * Integration coverage — exercises the JWT auth hook against an in-memory
 * Fastify built via inject() (not network fetch). Pre-2026-05-15 this file
 * tried `https://localhost:4001` with a try/catch swallowing connection
 * errors and `if (!res) return` silently skipping every assertion when the
 * server wasn't up. In CI no server runs, so every test silently passed.
 * The inject() migration removes the silent-skip vector.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// See token-refresh.test.ts for why this uses vi.hoisted instead of a
// plain top-of-file assignment.
vi.hoisted(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';
});

import Fastify, { type FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import { registerJwtAuthHook } from './middleware';
import { skipIfDbDown } from './test-utils';

const JWT_SECRET = process.env.JWT_SECRET as string;

describe('Fix #23: JWT failure logging', () => {
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
      await pool.query('SELECT 1');
      dbAvailable = true;
    } catch {
      return;
    }
    app = Fastify({ logger: false });
    registerJwtAuthHook(app, pool);
    // /health is in PUBLIC_ROUTES inside the JWT hook, so it bypasses auth
    // regardless of headers — pin that contract.
    app.get('/health', async () => ({ status: 'ok' }));
    // /shifts is a protected route — the JWT hook fires before any handler
    // logic, so a stub here is sufficient to exercise the 401-on-bad-token
    // branch. Real /shifts handler is exhaustively tested elsewhere.
    app.get('/shifts', async () => ({ success: true }));
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (pool) await pool.end();
  });

  it('HAPPY: /health is public and returns 200 with no token', async () => {
    // WHO: Anonymous request
    // WHAT: /health must remain reachable for liveness probes
    // WHY: Health checks don't carry JWTs; gating /health would break Railway readiness
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('SAD: expired token returns 401 with the documented error message', async () => {
    // WHO: User with expired JWT
    // WHAT: Should return 401 with error message
    // WHERE: JWT verification inside the onRequest hook (middleware.ts:438)
    // WHY: Expired tokens are invalid — middleware logs and rejects
    const token = jwt.sign(
      { tenant_id: 'test', user_id: 'test', email: 'test@test.com' },
      JWT_SECRET,
      { expiresIn: '-1s' }
    );

    const res = await app.inject({
      method: 'GET',
      url: '/shifts?tenant_id=test',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(401);
    const data = res.json();
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

    const res = await app.inject({
      method: 'GET',
      url: '/shifts?tenant_id=test',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(401);
  });

  it('HAPPY: source code logs warning on JWT failure', () => {
    // WHO: Backend middleware
    // WHAT: Should call request.log.warn when JWT verification fails
    // WHY: Failed auth attempts need to be visible in production logs
    // WHERE: The JWT auth hook lives in src/middleware.ts (registerJwtAuthHook),
    //        extracted from src/index.ts during the historical major refactor (see RESOLVED.md; originally tracked as NEEDS-REFACTORING #11).
    const src = fs.readFileSync('src/middleware.ts', 'utf8');
    expect(src).toContain('request.log.warn');
    expect(src).toContain('JWT verification failed');
  });
});

describe('Fix #13: Knowledge ingest auth header', () => {
  // Static-file tests — no server or DB needed.
  // After the api.ts namespace refactor, `ingest:` delegates to the shared
  // `apiUpload` helper which centralizes auth. The contract remains the same:
  // every upload carries a Bearer token in the Authorization header and does
  // NOT manually set Content-Type (FormData sets the boundary automatically).
  it('HAPPY: knowledge ingest sends Authorization header with token', () => {
    // WHO: Dashboard uploading a knowledge base file
    // WHAT: Fetch call should include Bearer token in headers
    // WHY: Without auth header, server rejects the upload (401)
    const src = fs.readFileSync('dashboard/lib/api.ts', 'utf8');

    // Auth lives in the shared apiUpload helper; ingest: calls it.
    const uploadIdx = src.indexOf('async function apiUpload');
    expect(uploadIdx).toBeGreaterThan(-1); // guard: marker must exist
    const uploadSection = src.substring(uploadIdx);
    expect(uploadSection).toContain('Authorization');
    expect(uploadSection).toContain('Bearer');
    expect(uploadSection).toContain('authToken');
    // ingest: must delegate to apiUpload (not inline its own fetch)
    const ingestIdx = src.indexOf('ingest:');
    expect(ingestIdx).toBeGreaterThan(-1); // guard: marker must exist
    const ingestSection = src.substring(ingestIdx);
    expect(ingestSection).toContain('apiUpload');
  });

  it('SAD: ingest does not use Content-Type header (FormData sets it automatically)', () => {
    // WHO: File upload via FormData
    // WHAT: Should NOT manually set Content-Type (browser sets boundary)
    // WHY: Setting Content-Type manually breaks multipart form boundary
    const src = fs.readFileSync('dashboard/lib/api.ts', 'utf8');

    // Auth header initialisation in the shared apiUpload helper uses an empty
    // headers object (no Content-Type) and conditionally adds Authorization.
    const uploadIdx = src.indexOf('async function apiUpload');
    expect(uploadIdx).toBeGreaterThan(-1); // guard: marker must exist
    const uploadSection = src.substring(uploadIdx);
    expect(uploadSection).toContain('const headers: Record<string, string> = {}');
  });
});
